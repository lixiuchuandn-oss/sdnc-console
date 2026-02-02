/**
 * VmReconfigureModal.tsx
 * 
 * 虚拟机资源变配模态框 (VM Reconfiguration Modal)
 * 
 * 主要功能：
 * 1. 提供虚拟机规格变更、系统重装、磁盘管理等多种运维操作。
 * 2. 采用"单任务模式" (Single Task Mode)：
 *    - 左侧导航栏采用 Radio.Group 单选模式，确保同一时间只能进行一种类型的变配操作。
 *    - 切换功能项时，自动重置表单，避免不同任务间的配置冲突。
 * 3. 样式冻结 (Style Freeze)：
 *    - 左侧导航栏的样式（圆角、展开分组、选中效果）由用户指定，严禁随意修改。
 */
import React, { useEffect, useState } from 'react';
import { Modal, Form, InputNumber, Select, Input, Space, message, Switch, Button, Table, Radio } from 'antd';
import { 
  SlidersOutlined, SettingOutlined, DatabaseOutlined, RobotOutlined, 
  HddOutlined, GlobalOutlined, AppstoreOutlined, DashboardOutlined
} from '@ant-design/icons';
import { 
  updateHarvesterVmSpec, createHarvesterVolume, attachHarvesterVolumeToVmByName, 
  updateHarvesterVolume, detachHarvesterVolumeFromVm, createHarvesterVm, 
  deleteCloudProviderEcs, fetchHarvesterGpuResources 
} from '../../../../services/api';

const parseQuantity = (s: string | number | undefined): number => {
  if (typeof s === 'number') return s;
  if (!s) return 0;
  const str = String(s);
  const units: Record<string, number> = {
    'Ki': 1024, 'Mi': 1024**2, 'Gi': 1024**3, 'Ti': 1024**4, 'Pi': 1024**5,
    'k': 1000, 'M': 1000**2, 'G': 1000**3, 'T': 1000**4, 'P': 1000**5
  };
  for (const [u, m] of Object.entries(units)) {
    if (str.endsWith(u)) {
      return parseFloat(str.slice(0, -u.length)) * m;
    }
  }
  return parseFloat(str);
};

type Props = {
  open: boolean;
  cloudId: string;
  record: any | null;
  onClose: () => void;
  onOk: () => void;
  storageClasses?: any[];
  images?: any[];
  gpuResources?: any[];
  initialConfigType?: string;
};

const VmReconfigureModal: React.FC<Props> = ({ 
  open, cloudId, record, onClose, onOk, 
  storageClasses: propStorageClasses, images: propImages, gpuResources: propGpuResources, 
  initialConfigType 
}) => {
  const [form] = Form.useForm();
  
  // Flattened state: just track the selected menu key
  const [selectedKey, setSelectedKey] = useState<string>('change_spec');
  
  // Resource states
  const [scs, setScs] = useState<any[]>([]);
  const [images, setImages] = useState<any[]>([]);
  const [gpuResources, setGpuResources] = useState<any[]>([]);
  const [selectedGpuKey, setSelectedGpuKey] = useState<string | null>(null);

  // --- State Sync & Initialization (状态同步与初始化) ---
  // Sync props to state (同步外部资源数据)
  useEffect(() => { setScs(propStorageClasses || []); }, [propStorageClasses]);
  useEffect(() => { setImages(propImages || []); }, [propImages]);
  useEffect(() => { setGpuResources(propGpuResources || []); }, [propGpuResources]);

  // Handle initial config type (处理初始选中项)
  useEffect(() => {
    if (open && initialConfigType) {
      setSelectedKey(initialConfigType);
    } else if (open && !initialConfigType) {
      setSelectedKey('change_spec');
    }
  }, [open, initialConfigType]);

  // --- Single Task Isolation Logic (单任务隔离逻辑) ---

  const getCurrentSpec = () => {
    let cpu = record?.Extra?.CPU;
    let mem = record?.Extra?.Memory;
    
    if (cpu === undefined || cpu === null) {
       cpu = record?.spec?.template?.spec?.domain?.cpu?.cores;
    }
    if (mem === undefined || mem === null) {
       mem = record?.spec?.template?.spec?.domain?.memory?.guest;
       if (!mem) mem = record?.spec?.template?.spec?.domain?.resources?.requests?.memory;
    }
    return { cpu: Number(cpu || 0), memory: mem };
  };

  const getMemoryInGi = (memStr: string | number | undefined): number => {
    const bytes = parseQuantity(memStr);
    if (!bytes) return 0;
    // Always round up to next GiB to ensure user sees integer GiB if close enough, or CEIL if it was MiB
    return Math.ceil(bytes / (1024 ** 3));
  };

  // Handle form reset and initialization on tab switch
  useEffect(() => {
    if (!open) return;
    
    // Reset all fields when switching tabs to ensure "Single Selection" / "Single Task" isolation
    // 切换功能菜单时，强制重置表单，防止配置冲突
    form.resetFields();
    setSelectedGpuKey(null);

    if (!record) return;

    // Re-populate initial values for specific tabs
    switch (selectedKey) {
      case 'change_spec': {
        const { cpu, memory } = getCurrentSpec();
        const memGi = getMemoryInGi(memory);
        form.setFieldsValue({ cpu, memory: memGi });
        break;
      }
      // Add other cases if they need initialization from record
      // e.g. cpu_advanced might need current values if available in record
    }
  }, [selectedKey, open, record, form]);

  const menuLabelMap: Record<string, string> = {
    'change_spec': '变更实例规格',
    'cpu_advanced': 'CPU高级配置',
    'mem_advanced': '内存高级配置',
    'change_gpu': '变更GPU',
    'change_os': '更换操作系统',
    'expand_system_disk': '系统盘扩容',
    'add_disk': '添加数据盘',
    'resize_disk': '数据盘扩容',
    'remove_disk': '移除数据盘',
    'change_primary_nic': '变更主网卡',
    'change_secondary_nic': '变更辅助网卡',
  };

  const handleOk = async () => {
    try {
      const iid = String(record?.InstanceId || record?.id || '');
      if (!iid || !iid.includes('/')) { message.error('实例ID缺失'); return; }
      const ns = iid.split('/')[0];
      const name = iid.split('/')[1];

      // Dispatch based on selectedKey (根据选中的功能项分发请求)
      switch (selectedKey) {
        case 'change_spec': {
          // 变更实例规格 (CPU/Memory)
          const vals = await form.validateFields(['cpu', 'memory']);
          const memVal = `${vals.memory}Gi`; // Force Gi unit
          await updateHarvesterVmSpec(cloudId, ns, name, { cpu: vals.cpu, memory: memVal });
          message.success('实例规格已更新');
          break;
        }
        case 'cpu_advanced': {
          // CPU 高级配置 (Topology/QoS)
          const vals = await form.validateFields(['cpuSockets', 'cpuCores', 'cpuThreads', 'dedicatedCPUPlacement', 'cpuRequest', 'cpuLimit']);
          await updateHarvesterVmSpec(cloudId, ns, name, { 
            cpuSockets: vals.cpuSockets, cpuCores: vals.cpuCores, cpuThreads: vals.cpuThreads, 
            dedicatedCPUPlacement: vals.dedicatedCPUPlacement, cpuRequest: vals.cpuRequest, cpuLimit: vals.cpuLimit 
          });
          message.success('CPU高级配置已更新');
          break;
        }
        case 'mem_advanced': {
          // 内存高级配置 (Limit)
          const vals = await form.validateFields(['memoryLimit']);
          await updateHarvesterVmSpec(cloudId, ns, name, { memoryLimit: vals.memoryLimit });
          message.success('内存高级配置已更新');
          break;
        }
        case 'change_gpu': {
          // 变更 GPU (Passthrough/vGPU)
          const vals = await form.validateFields(['gpuMode', 'gpuResourceName']);
          await updateHarvesterVmSpec(cloudId, ns, name, { 
            gpuMode: vals.gpuMode, gpuResourceName: vals.gpuResourceName, gpuCount: undefined 
          });
          message.success('GPU配置已更新');
          break;
        }
        case 'change_os': {
          // 更换操作系统 (Rebuild VM)
          const vals = await form.validateFields(['newOsImage', 'newOsRootSize', 'newOsBus', 'newOsSc']);
          const cpu = Number(record?.Extra?.CPU || 0) || 1;
          const mem = String(record?.Extra?.Memory || '1Gi') || '1Gi';
          const networks: string[] = Array.isArray(record?.Extra?.Networks) ? record.Extra.Networks : [];
          
          try {
            await deleteCloudProviderEcs(cloudId, iid);
          } catch (e: any) {
            const msg = String(e?.message || '').toLowerCase();
            if (!msg.includes('not found') && !msg.includes('404')) { throw e; }
          }
          await createHarvesterVm(cloudId, {
            namespace: ns, name, cpu, memory: mem, image: vals.newOsImage, networks,
            rootSourceType: 'image', rootImage: vals.newOsImage, rootSize: vals.newOsRootSize,
            rootBus: vals.newOsBus || 'virtio', storageClassName: vals.newOsSc
          });
          message.success('更换操作系统已提交（重建实例）');
          break;
        }
        case 'expand_system_disk': {
          // 系统盘扩容 (Resize Root Volume)
          const vals = await form.validateFields(['systemDiskSize']);
          const claims: string[] = Array.isArray(record?.Extra?.VolumeClaims) ? record?.Extra?.VolumeClaims : [];
          const rootPvc = claims.length ? claims[0] : '';
          if (!rootPvc) { message.error('未找到系统盘PVC'); return; }
          await updateHarvesterVolume(cloudId, ns, rootPvc, { size: vals.systemDiskSize });
          message.success('系统盘扩容已提交');
          break;
        }
        case 'add_disk': {
          // 添加数据盘 (Create & Attach Volume)
          const vals = await form.validateFields(['newDiskName', 'newDiskSize', 'newDiskSc', 'newDiskBus']);
          await createHarvesterVolume(cloudId, { 
            namespace: ns, name: vals.newDiskName, size: vals.newDiskSize, storageClassName: vals.newDiskSc 
          });
          await attachHarvesterVolumeToVmByName(cloudId, ns, name, { 
            diskName: vals.newDiskName, bus: vals.newDiskBus || 'virtio', pvcNamespace: ns, pvcName: vals.newDiskName 
          });
          message.success('数据盘创建并挂载成功');
          break;
        }
        case 'resize_disk': {
          // 数据盘扩容 (Resize Data Volume)
          const vals = await form.validateFields(['expandDiskPvc', 'expandDiskSize']);
          await updateHarvesterVolume(cloudId, ns, vals.expandDiskPvc, { size: vals.expandDiskSize });
          message.success('数据盘扩容已提交');
          break;
        }
        case 'remove_disk': {
          // 移除数据盘 (Detach Volume)
          const vals = await form.validateFields(['removeDiskName']);
          await detachHarvesterVolumeFromVm(cloudId, iid, { name: vals.removeDiskName });
          message.success('数据盘移除已提交');
          break;
        }
        case 'change_primary_nic':
        case 'change_secondary_nic': {
          message.info('网络配置变更需要后端支持，当前为占位界面');
          break;
        }
        default:
          break;
      }
      onOk();
      onClose();
    } catch (e: any) {
      console.error(e);
      // 如果不是表单校验错误，则提示后端/逻辑异常
      if (!e?.errorFields) {
        message.error(e?.message || '操作失败');
      }
    }
  };

  const menuGroups = [
    {
      title: '资源配置',
      icon: <DashboardOutlined />,
      children: [
        { key: 'change_spec', label: '变更实例规格' },
        { key: 'cpu_advanced', label: 'CPU高级配置' },
        { key: 'mem_advanced', label: '内存高级配置' },
        { key: 'change_gpu', label: '变更GPU' },
      ]
    },
    {
      title: '系统与存储',
      icon: <HddOutlined />,
      children: [
        { key: 'change_os', label: '更换操作系统' },
        { key: 'expand_system_disk', label: '系统盘扩容' },
        { key: 'add_disk', label: '添加数据盘' },
        { key: 'resize_disk', label: '数据盘扩容' },
        { key: 'remove_disk', label: '移除数据盘' },
      ]
    },
    {
      title: '网络配置',
      icon: <GlobalOutlined />,
      children: [
        { key: 'change_primary_nic', label: '变更主网卡' },
        { key: 'change_secondary_nic', label: '变更辅助网卡' },
      ]
    }
  ];

  // --- Dynamic Form Rendering (动态表单渲染) ---
  const renderContent = () => {
    const claims: string[] = Array.isArray(record?.Extra?.VolumeClaims) ? record?.Extra?.VolumeClaims : [];
    const scOptions = (scs || []).map((x: any) => ({ value: x?.metadata?.name || x?.name, label: x?.metadata?.name || x?.name }));

    switch (selectedKey) {
      // --- Resource Config (资源配置) ---
      case 'change_spec':
        return (
          <>
            <Form.Item 
              name="cpu" 
              label="CPU(核)" 
              rules={[
                { required: true, message: '请输入CPU核数' },
                () => ({
                  validator(_, value) {
                    const { cpu: currentCpu } = getCurrentSpec();
                    if (value && value < currentCpu) {
                      return Promise.reject(new Error(`CPU核数不能小于当前值 (${currentCpu}核)`));
                    }
                    return Promise.resolve();
                  },
                }),
              ]}
            >
              <InputNumber min={1} precision={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item 
              name="memory" 
              label="内存(GiB)" 
              rules={[
                { required: true, message: '请输入内存' },
                () => ({
                  validator(_, value) {
                    const { memory: currentMemStr } = getCurrentSpec();
                    const currentGi = getMemoryInGi(currentMemStr);
                    // value is number (GiB) from InputNumber
                    
                    if (value && value < currentGi) {
                      return Promise.reject(new Error(`内存不能小于当前值 (${currentGi} GiB)`));
                    }
                    return Promise.resolve();
                  },
                }),
              ]}
            >
              <InputNumber min={1} precision={0} style={{ width: '100%' }} addonAfter="GiB" />
            </Form.Item>
            <div style={{ color: '#999', marginTop: 16 }}>升级实例的规格配置（仅支持扩容）</div>
          </>
        );
      case 'cpu_advanced':
        return (
          <>
            <Form.Item name="cpuSockets" label="Sockets"><InputNumber min={1} precision={0} style={{ width: '100%' }} /></Form.Item>
            <Form.Item name="cpuCores" label="Cores"><InputNumber min={1} precision={0} style={{ width: '100%' }} /></Form.Item>
            <Form.Item name="cpuThreads" label="Threads"><InputNumber min={1} precision={0} style={{ width: '100%' }} /></Form.Item>
            <Form.Item name="dedicatedCPUPlacement" label="CPU绑定" valuePropName="checked"><Switch /></Form.Item>
            <Form.Item name="cpuRequest" label="CPU Request"><InputNumber min={0} precision={0} style={{ width: '100%' }} /></Form.Item>
            <Form.Item name="cpuLimit" label="CPU Limit"><InputNumber min={0} precision={0} style={{ width: '100%' }} /></Form.Item>
            <div style={{ color: '#999', marginTop: 16 }}>支持CPU拓扑、绑定、QoS等高级配置</div>
          </>
        );
      case 'mem_advanced':
        return (
          <>
            <Form.Item name="memoryLimit" label="内存上限" rules={[{ required: true, message: '请输入内存上限' }]}>
              <Input placeholder="例如 8Gi" style={{ width: '100%' }} />
            </Form.Item>
            <div style={{ color: '#999', marginTop: 16 }}>支持QoS高级配置</div>
          </>
        );
      case 'change_gpu':
        return (
          <>
            <Form.Item name="gpuMode" label="GPU模式" rules={[{ required: true, message: '请选择GPU模式' }]}>
              <Select allowClear options={['passthrough', 'vgpu', 'sriov'].map(s => ({ value: s, label: s }))} />
            </Form.Item>
            <Form.Item label="选择GPU" required>
              {(() => {
                const mode = form.getFieldValue('gpuMode') || 'passthrough';
                const list = Array.isArray(gpuResources) ? gpuResources : [];
                // 筛选匹配模式的 GPU 资源 (Filter GPUs by mode)
                const filtered = list.filter((x: any) => String(x?.type) === mode);
                const data = (filtered.length ? filtered : list).map((x: any) => ({
                  key: `${x?.resourceName}|${x?.node || x?.nodeName}|${x?.pciAddress || x?.address || x?.pci}`,
                  node: x?.node || x?.nodeName || '-',
                  bus: x?.pciAddress || x?.address || x?.pci || '-',
                  resourceName: x?.resourceName
                }));
                return (
                  <Table
                    size="small"
                    rowKey="key"
                    columns={[
                      { title: '节点', dataIndex: 'node' },
                      { title: '总线', dataIndex: 'bus' },
                      { title: 'GPU名称', dataIndex: 'resourceName' }
                    ]}
                    dataSource={data}
                    pagination={false}
                    locale={{
                      emptyText: (
                        <Space>
                          <span>暂无可用 GPU 资源</span>
                          <Button size="small" onClick={async () => {
                            try {
                              const res = await fetchHarvesterGpuResources(cloudId);
                              const items = Array.isArray(res?.data?.items) ? res.data.items : (Array.isArray(res?.items) ? res.items : []);
                              setGpuResources(items);
                            } catch (e: any) { message.error(e?.message || '刷新失败'); }
                          }}>刷新</Button>
                        </Space>
                      )
                    }}
                    rowSelection={{
                      type: 'radio',
                      selectedRowKeys: selectedGpuKey ? [selectedGpuKey] : [],
                      onChange: (keys: any[], rows: any[]) => {
                        const k = keys && keys.length ? String(keys[0]) : null;
                        setSelectedGpuKey(k);
                        const row = rows && rows.length ? rows[0] : null;
                        form.setFieldsValue({ gpuResourceName: row?.resourceName });
                      }
                    }}
                    onRow={(record: any) => ({
                      onClick: () => {
                        setSelectedGpuKey(String(record?.key));
                        form.setFieldsValue({ gpuResourceName: record?.resourceName });
                      }
                    })}
                  />
                );
              })()}
            </Form.Item>
            <Form.Item name="gpuResourceName" hidden rules={[{ required: true, message: '请选择GPU资源' }]}><Input /></Form.Item>
          </>
        );
      
      // --- System & Storage Config (系统与存储配置) ---
      case 'change_os':
        return (
          <>
            <Form.Item name="newOsImage" label="目标镜像" rules={[{ required: true, message: '请选择镜像' }]}>
              <Select showSearch options={(images || []).map((img: any) => ({
                label: img?.displayName || img?.spec?.displayName || img?.metadata?.name,
                value: `${img?.metadata?.namespace}/${img?.metadata?.name}`
              }))} />
            </Form.Item>
            <Form.Item name="newOsRootSize" label="系统盘容量" initialValue="40Gi" rules={[{ required: true }]}>
              <Input placeholder="例如 40Gi" />
            </Form.Item>
            <Form.Item name="newOsBus" label="总线类型" initialValue="virtio">
              <Select options={['virtio', 'scsi', 'sata'].map(v => ({ label: v, value: v }))} />
            </Form.Item>
            <Form.Item name="newOsSc" label="StorageClass">
              <Select allowClear options={scOptions} />
            </Form.Item>
            <div style={{ color: '#faad14', marginTop: 16 }}>注意：更换操作系统将会删除并重建实例，数据盘将被保留但需要重新挂载。</div>
          </>
        );
      case 'expand_system_disk':
        return (
          <>
            <Form.Item label="当前系统盘">{claims[0] || 'Unknown'}</Form.Item>
            <Form.Item name="systemDiskSize" label="新容量" rules={[{ required: true, message: '请输入新容量' }]}>
              <Input placeholder="例如 60Gi" />
            </Form.Item>
            <div style={{ color: '#999' }}>仅支持扩容，不可缩容。</div>
          </>
        );
      case 'add_disk':
        return (
          <>
            <Form.Item name="newDiskName" label="磁盘名称" rules={[{ required: true }]}>
              <Input placeholder="disk-name" />
            </Form.Item>
            <Form.Item name="newDiskSize" label="容量" rules={[{ required: true }]}>
              <Input placeholder="10Gi" />
            </Form.Item>
            <Form.Item name="newDiskSc" label="StorageClass" rules={[{ required: true }]}>
              <Select options={scOptions} />
            </Form.Item>
            <Form.Item name="newDiskBus" label="总线类型" initialValue="virtio">
              <Select options={['virtio', 'scsi', 'sata'].map(v => ({ label: v, value: v }))} />
            </Form.Item>
          </>
        );
      case 'resize_disk':
        return (
          <>
            <Form.Item name="expandDiskPvc" label="选择数据盘" rules={[{ required: true }]}>
              <Select options={claims.filter((_, i) => i > 0).map(c => ({ label: c, value: c }))} />
            </Form.Item>
            <Form.Item name="expandDiskSize" label="新容量" rules={[{ required: true }]}>
              <Input placeholder="例如 20Gi" />
            </Form.Item>
          </>
        );
      case 'remove_disk':
        return (
          <>
            <Form.Item name="removeDiskName" label="选择数据盘" rules={[{ required: true }]}>
              <Select options={claims.filter((_, i) => i > 0).map(c => ({ label: c, value: c }))} />
            </Form.Item>
            <div style={{ color: 'red', marginTop: 16 }}>危险操作：移除后数据盘将从实例卸载，但不会被物理删除。</div>
          </>
        );

      // --- Network Config ---
      case 'change_primary_nic':
      case 'change_secondary_nic':
        return (
          <div style={{ textAlign: 'center', marginTop: 40, color: '#999' }}>
            <GlobalOutlined style={{ fontSize: 40, marginBottom: 16 }} />
            <p>网络配置功能正在开发中...</p>
          </div>
        );

      default:
        return null;
    }
  };

  // --- Style Freeze: Do NOT modify the styles below ---
  // The user has explicitly requested this specific visual design (Radio Group with rounded corners, expanded groups).
  // Any changes to the layout, spacing, or visual appearance must be approved by the user.
  // -----------------------------------------------------
  return (
    <Modal
      title={menuLabelMap[selectedKey] ? `资源变配 - ${menuLabelMap[selectedKey]}` : '资源变配'}
      open={open}
      onCancel={onClose}
      onOk={handleOk}
      okText="提交"
      destroyOnClose
      width={900}
      styles={{ body: { padding: 0 } }}
    >
      <div style={{ display: 'flex', height: '70vh' }}>
        <div style={{ width: 220,  overflowY: 'auto', marginRight: 40 }}>
          <Radio.Group 
            value={selectedKey} 
            onChange={(e) => setSelectedKey(e.target.value)} 
            style={{ width: '100%' }} 
          >
            {menuGroups.map((group, gIndex) => (
              <div key={group.title} style={{ marginBottom: 10 }}>
                <div style={{ 
                  lineHeight: '40px', 
                  marginBottom: 10,
                  borderBottom: '1px solid #e6e6e6',
                  fontSize: 14, 
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8
                }}>
                  {group.icon}
                  <span>{group.title}</span>
                </div>
                <Space direction="vertical" style={{ width: '100%', gap: 0 }}>
                  {group.children.map(child => (
                    <Radio 
                      key={child.key} 
                      value={child.key} 
                      style={{ 
                        display: 'flex', 
                        lineHeight: '32px', 
                        padding: '0 10px',
                        marginBottom: 10,
                        borderRadius: '8px',
                        background: selectedKey === child.key ? '#e6f7ff' : 'transparent',
                        color: selectedKey === child.key ? '#1677ff' : 'inherit',
                      }}
                    >
                      {child.label}
                    </Radio>
                  ))}
                </Space>
              </div>
            ))}
          </Radio.Group>
        </div>
        <div style={{ border: '1px solid #f0f0f0',borderRadius: '8px', flex: 1, padding: 24, overflowY: 'auto' }}>
          <Form
            form={form}
            layout="vertical"
            wrapperCol={{ span: 24 }}
          >
            {renderContent()}
          </Form>
        </div>
      </div>
    </Modal>
  );
};

export default VmReconfigureModal;
