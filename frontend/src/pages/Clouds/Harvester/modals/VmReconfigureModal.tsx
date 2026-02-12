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
import { Modal, Form, InputNumber, Select, Input, Space, message, Switch, Button, Table, Radio, Row, Col, Card, Collapse, Typography, Checkbox } from 'antd';
import { 
  SlidersOutlined, SettingOutlined, DatabaseOutlined, RobotOutlined, 
  HddOutlined, GlobalOutlined, AppstoreOutlined, DashboardOutlined
} from '@ant-design/icons';
import { deleteCloudProviderEcs } from '../../../../services/api';
import { 
  updateHarvesterVmSpec, createHarvesterVolume, attachHarvesterVolumeToVmByName, 
  updateHarvesterVolume, detachHarvesterVolumeFromVm, createHarvesterVm, 
  fetchHarvesterGpuResources, patchHarvesterVm, stopHarvesterVm, startHarvesterVm, fetchHarvesterNads,
  fetchKubeOvnVpcs, fetchKubeOvnSubnets
} from '../../../../services/harvesterApi';
import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';

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
  const [nads, setNads] = useState<any[]>([]);
  const [vpcs, setVpcs] = useState<any[]>([]);
  const [subnets, setSubnets] = useState<any[]>([]);

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

  const reloadNads = async () => {
    try {
      const res = await fetchHarvesterNads(cloudId);
      const items = res?.data?.items || res?.items || [];
      setNads(items);
    } catch (e) { console.error(e); }
  };

  const reloadVpcs = async () => {
    try { const res = await fetchKubeOvnVpcs(cloudId); setVpcs(res?.items || []); } catch (e) { console.error(e); }
  };
  const reloadSubnets = async () => {
    try { const res = await fetchKubeOvnSubnets(cloudId); setSubnets(res?.items || []); } catch (e) { console.error(e); }
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
      case 'change_primary_nic': {
        reloadNads();
        reloadVpcs();
        reloadSubnets();
        // Initialize with current primary NIC
        const networks = record?.spec?.template?.spec?.networks || [];
        const interfaces = record?.spec?.template?.spec?.domain?.devices?.interfaces || [];
        
        if (interfaces.length > 0) {
          const iface = interfaces[0];
          const net = networks.find((n: any) => n.name === iface.name);
          const networkName = net?.multus?.networkName || '';
          
          // Determine type
          let type = 'bridge';
          if (iface.masquerade) type = 'masquerade';
          else if (iface.sriov) type = 'sriov';
          else if (iface.macvtap) type = 'macvtap';
          
          // Check if it looks like a VPC subnet (heuristic or just default to flat if unsure)
          // Since we can't easily distinguish without checking subnets list, we might default to flat
          // or check if networkName exists in subnets list.
          // For now, let's default to flat, but if the user toggles to VPC, we can't easily auto-detect
          // unless we wait for subnets to load.
          // Let's just set the values.
          
          form.setFieldsValue({
            netMode: 'flat', // Default to flat view for simplicity
            primaryNic: {
              name: networkName, // For flat mode
              type: type,
              model: iface.model || 'virtio',
              macAddress: iface.macAddress,
              ipAddress: undefined // Hard to extract static IP from cloud-init without parsing
            }
          });
        } else {
           // No nic, set default
           form.setFieldsValue({
             netMode: 'flat',
             primaryNic: { type: 'bridge', model: 'virtio' }
           });
        }
        break;
      }
      case 'change_secondary_nic': {
        reloadNads();
        reloadVpcs();
        reloadSubnets();
        // Initialize with secondary NICs
        const networks = record?.spec?.template?.spec?.networks || [];
        const interfaces = record?.spec?.template?.spec?.domain?.devices?.interfaces || [];
        
        const secondary = interfaces.slice(1).map((iface: any) => {
          const net = networks.find((n: any) => n.name === iface.name);
          const networkName = net?.multus?.networkName || '';
          
          let type = 'bridge';
          if (iface.masquerade) type = 'masquerade';
          else if (iface.sriov) type = 'sriov';
          else if (iface.macvtap) type = 'macvtap';

          return {
            mode: 'flat',
            name: networkName,
            type: type,
            model: iface.model || 'virtio',
            macAddress: iface.macAddress,
          };
        });
        form.setFieldsValue({ secondaryNics: secondary });
        break;
      }
      case 'cpu_advanced': {
        const cpu = record?.spec?.template?.spec?.domain?.cpu || {};
        const resources = record?.spec?.template?.spec?.domain?.resources || {};
        form.setFieldsValue({
          cpuSockets: cpu.sockets || 1,
          cpuCores: cpu.cores || 1,
          cpuThreads: cpu.threads || 1,
          dedicatedCPUPlacement: !!cpu.dedicatedCpuPlacement,
          cpuRequest: resources.requests?.cpu,
          cpuLimit: resources.limits?.cpu,
          cpuModel: cpu.mode || 'host-passthrough',
          cpuModelCustom: cpu.model,
          isolateEmulatorThread: !!cpu.isolateEmulatorThread,
          cpuBurstUnlimited: false, // 暂无法从 record 直接推断，默认为 false
        });
        break;
      }
      case 'mem_advanced': {
        const resources = record?.spec?.template?.spec?.domain?.resources || {};
        const req = getMemoryInGi(resources.requests?.memory);
        const lim = getMemoryInGi(resources.limits?.memory);
        form.setFieldsValue({
          memoryRequestGi: req || undefined,
          memoryLimitGi: lim || undefined,
          memoryBurstUnlimited: false,
        });
        break;
      }
      case 'change_gpu': {
        const gpus = record?.spec?.template?.spec?.domain?.devices?.gpus || [];
        const gpu = gpus.length > 0 ? gpus[0] : null;
        form.setFieldsValue({
          gpuMode: gpu ? 'passthrough' : undefined, 
          gpuResourceName: gpu?.deviceName,
        });
        break;
      }
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
      let iid = String(record?.InstanceId || record?.id || '');
      // 兼容直接包含 metadata 的对象结构
      if ((!iid || !iid.includes('/')) && record?.metadata?.namespace && record?.metadata?.name) {
        iid = `${record.metadata.namespace}/${record.metadata.name}`;
      }

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
          const vals = await form.validateFields([
            'cpuSockets', 'cpuCores', 'cpuThreads', 'dedicatedCPUPlacement', 
            'cpuRequest', 'cpuLimit', 'cpuModel', 'cpuModelCustom', 
            'isolateEmulatorThread', 'cpuBurstUnlimited'
          ]);
          await updateHarvesterVmSpec(cloudId, ns, name, { 
            cpuSockets: vals.cpuSockets, cpuCores: vals.cpuCores, cpuThreads: vals.cpuThreads, 
            dedicatedCPUPlacement: vals.dedicatedCPUPlacement, cpuRequest: vals.cpuRequest, cpuLimit: vals.cpuLimit,
            cpuModel: vals.cpuModel, cpuModelCustom: vals.cpuModelCustom,
            isolateEmulatorThread: vals.isolateEmulatorThread, cpuBurstUnlimited: vals.cpuBurstUnlimited
          });
          message.success('CPU高级配置已更新');
          break;
        }
        case 'mem_advanced': {
          // 内存高级配置 (Limit/Request/Burst)
          const vals = await form.validateFields(['memoryRequestGi', 'memoryLimitGi', 'memoryBurstUnlimited']);
          const payload: any = {
             memoryBurstUnlimited: vals.memoryBurstUnlimited
          };
          if (vals.memoryRequestGi !== undefined && vals.memoryRequestGi !== null) payload.memoryRequest = `${vals.memoryRequestGi}Gi`;
          if (vals.memoryLimitGi !== undefined && vals.memoryLimitGi !== null) payload.memoryLimit = `${vals.memoryLimitGi}Gi`;
          
          await updateHarvesterVmSpec(cloudId, ns, name, payload);
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
          // 更换操作系统 (Safe Rebuild: Stop -> Create New PVC -> Swap -> Start)
          const vals = await form.validateFields(['newOsImage', 'newOsRootSize', 'newOsBus', 'newOsSc']);
          
          // 1. Stop VM
          await stopHarvesterVm(cloudId, ns, name);
          
          // 2. Create new root PVC
          const timestamp = new Date().getTime();
          const newDiskName = `disk-${name}-${timestamp}-root`;
          // Create Volume from Image (Harvester convention)
          await createHarvesterVolume(cloudId, {
            namespace: ns, 
            name: newDiskName, 
            size: vals.newOsRootSize, 
            storageClassName: vals.newOsSc,
            annotations: {
              'harvesterhci.io/imageId': vals.newOsImage
            }
          });

          // 3. Swap Boot Disk in VM Spec
          // Need to find the current boot volume (usually first one or by name)
          const currentVolumes = record?.spec?.template?.spec?.volumes || [];
          const newVolumes = currentVolumes.map((vol: any, index: number) => {
             // Assuming first volume is root, or check name
             if (index === 0) { // Simple assumption for now, robust logic might need to check persistentVolumeClaim.claimName
                return {
                  name: vol.name, // Keep the volume name in VM spec (e.g. "disk-0")
                  persistentVolumeClaim: { claimName: newDiskName }
                };
             }
             return vol;
          });

          await patchHarvesterVm(cloudId, ns, name, {
            spec: { template: { spec: { volumes: newVolumes } } }
          });

          // 4. Start VM
          await startHarvesterVm(cloudId, ns, name);
          
          message.success('操作系统更换已提交（Safe Rebuild）');
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
        case 'change_primary_nic': {
          const vals = await form.validateFields(['primaryNic']);
          const nic = vals.primaryNic;
          const currentNetworks = record?.spec?.template?.spec?.networks || [];
          const currentInterfaces = record?.spec?.template?.spec?.domain?.devices?.interfaces || [];
          
          // Ensure we have at least one nic/interface slot to modify
          const primaryIfName = currentInterfaces.length > 0 ? currentInterfaces[0].name : 'nic-0';
          
          const newNetwork = {
             name: primaryIfName,
             ...(nic.name ? { multus: { networkName: nic.name } } : { pod: {} })
          };
          
          const newInterface = {
             name: primaryIfName,
             model: nic.model || 'virtio',
             macAddress: nic.macAddress,
             [nic.type === 'masquerade' ? 'masquerade' : nic.type === 'sriov' ? 'sriov' : nic.type === 'macvtap' ? 'macvtap' : 'bridge']: {}
          };
          
          const newNetworks = [newNetwork, ...currentNetworks.slice(1)];
          const newInterfaces = [newInterface, ...currentInterfaces.slice(1)];
          
          await patchHarvesterVm(cloudId, ns, name, {
            spec: { template: { spec: { networks: newNetworks, domain: { devices: { interfaces: newInterfaces } } } } }
          });
          message.success('主网卡配置已更新（需重启生效）');
          break;
        }
        case 'change_secondary_nic': {
           const vals = await form.validateFields(['secondaryNics']);
           const currentNetworks = record?.spec?.template?.spec?.networks || [];
           const currentInterfaces = record?.spec?.template?.spec?.domain?.devices?.interfaces || [];
           
           const primaryNet = currentNetworks.length > 0 ? currentNetworks[0] : null;
           const primaryIf = currentInterfaces.length > 0 ? currentInterfaces[0] : null;
           
           // Keep primary as is
           const newNetworks = primaryNet ? [primaryNet] : [];
           const newInterfaces = primaryIf ? [primaryIf] : [];
           
           (vals.secondaryNics || []).forEach((item: any, idx: number) => {
              const nicName = `nic-${idx + 1}`; // nic-1, nic-2...
              
              newNetworks.push({
                 name: nicName,
                 multus: { networkName: item.name }
              });
              
              newInterfaces.push({
                 name: nicName,
                 model: item.model || 'virtio',
                 macAddress: item.macAddress,
                 [item.type === 'masquerade' ? 'masquerade' : item.type === 'sriov' ? 'sriov' : item.type === 'macvtap' ? 'macvtap' : 'bridge']: {}
              });
           });
           
           await patchHarvesterVm(cloudId, ns, name, {
            spec: { template: { spec: { networks: newNetworks, domain: { devices: { interfaces: newInterfaces } } } } }
          });
          message.success('辅助网卡配置已更新（需重启生效）');
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
              ]}
            >
              <InputNumber min={1} precision={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item 
              name="memory" 
              label="内存(GiB)" 
              rules={[
                { required: true, message: '请输入内存' },
              ]}
            >
              <InputNumber min={1} precision={0} style={{ width: '100%' }} addonAfter="GiB" />
            </Form.Item>
            <div style={{ color: '#999', marginTop: 16 }}>调整实例的CPU和内存规格（修改后可能需要重启生效）</div>
          </>
        );
      case 'cpu_advanced':
        return (
          <div style={{ padding: '0 8px' }}>
            <Form.Item label="CPU 拓扑">
              <Space>
                <Typography.Text>插槽</Typography.Text>
                <Form.Item noStyle name="cpuSockets">
                  <InputNumber min={1} max={8} style={{ width: 100 }} />
                </Form.Item>
                <Typography.Text>每插槽</Typography.Text>
                <Form.Item noStyle name="cpuCores">
                  <InputNumber min={1} max={64} style={{ width: 100 }} />
                </Form.Item>
                <Typography.Text>核</Typography.Text>
                <Typography.Text>线程</Typography.Text>
                <Form.Item noStyle name="cpuThreads">
                  <InputNumber min={1} max={8} style={{ width: 100 }} />
                </Form.Item>
              </Space>
            </Form.Item>
            <Form.Item label="CPU 模式" name="cpuModel" initialValue="host-passthrough">
              <Select options={[{ label: 'Host-Passthrough', value: 'host-passthrough' }, { label: 'Host-Model', value: 'host-model' }, { label: '自定义', value: 'custom' }]} style={{ width: 220 }} />
            </Form.Item>
            <Form.Item noStyle shouldUpdate={(prev, curr) => prev.cpuModel !== curr.cpuModel}>
              {({ getFieldValue }) => (getFieldValue('cpuModel') === 'custom' ? (
                <Form.Item label="自定义模型" name="cpuModelCustom" extra={<Typography.Text type="secondary">指定 CPU 型号名称，例如 Skylake-Client-IBRS</Typography.Text>}>
                  <Input placeholder="如：Skylake-Client-IBRS" />
                </Form.Item>
              ) : null)}
            </Form.Item>
            <Form.Item label="CPU 绑定" name="dedicatedCPUPlacement" valuePropName="checked">
              <Space>
                <Checkbox>启用</Checkbox>
                <Typography.Text type="secondary">保证用固定的物理 CPU 核心，减少切换损耗</Typography.Text>
              </Space>
            </Form.Item>
            <Form.Item label="CPU 隔离" name="isolateEmulatorThread" valuePropName="checked">
              <Space>
                <Checkbox>启用</Checkbox>
                <Typography.Text type="secondary">启用后 QEMU 模拟器线程与来宾 vCPU 隔离，降低干扰</Typography.Text>
              </Space>
            </Form.Item>
            <Form.Item label="CPU QoS">
              <Space>
                <Typography.Text>平时至少需要</Typography.Text>
                <Form.Item noStyle name="cpuRequest">
                  <InputNumber min={0} max={512} precision={0} style={{ width: 100 }} />
                </Form.Item>
                <Typography.Text>核，最多使用</Typography.Text>
                <Form.Item noStyle name="cpuLimit">
                  <InputNumber min={0} max={512} precision={0} style={{ width: 100 }} />
                </Form.Item>
                <Typography.Text>核</Typography.Text>
              </Space>
            </Form.Item>
            <Form.Item label="CPU 峰值保护" name="cpuBurstUnlimited" valuePropName="checked">
              <Space>
                <Checkbox>启用</Checkbox>
                <Typography.Text type="secondary">业务峰值时自动取消最多使用核数限制</Typography.Text>
              </Space>
            </Form.Item>
          </div>
        );
      case 'mem_advanced':
        return (
          <>
            <Form.Item label="内存 QoS">
              <Space>
                <Typography.Text>平时至少需要</Typography.Text>
                <Form.Item noStyle name="memoryRequestGi">
                  <InputNumber min={0} max={2048} precision={0} style={{ width: 100 }} />
                </Form.Item>
                <Typography.Text>GiB，最多使用</Typography.Text>
                <Form.Item noStyle name="memoryLimitGi">
                  <InputNumber min={0} max={4096} precision={0} style={{ width: 100 }} />
                </Form.Item>
                <Typography.Text>GiB</Typography.Text>
              </Space>
            </Form.Item>
            <Form.Item label="内存峰值保护" name="memoryBurstUnlimited" valuePropName="checked">
              <Space>
                <Checkbox>启用</Checkbox>
                <Typography.Text type="secondary">业务峰值时自动取消最多使用内存限制</Typography.Text>
              </Space>
            </Form.Item>
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
      case 'change_primary_nic': {
        const nadOptions = (nads || []).map((n: any) => ({ 
           label: n?.spec?.config ? `${n.name} (VLAN ${JSON.parse(n.spec.config).vlan})` : n.name, 
           value: n.name 
        }));
        const kubeVpcOptions = (vpcs || []).map((v: any) => ({ label: v.name, value: v.name }));
        
        return (
          <>
             <div style={{ marginBottom: 16, color: '#999' }}>变更主网卡将修改 eth0 接口配置（需重启生效）</div>
             <Row gutter={12}>
                <Col span={8}>
                  <Form.Item label="网络类型" name="netMode" initialValue="flat" rules={[{ required: true, message: '请选择网络类型' }]}>
                    <Select
                      options={[{ label: '扁平网络', value: 'flat' }, { label: 'VPC网络', value: 'vpc' }]}
                      placeholder="选择网络类型"
                      onChange={(v) => { 
                         // Clear fields when switching mode
                         const curr = form.getFieldValue('primaryNic') || {};
                         form.setFieldsValue({ primaryNic: { ...curr, name: undefined, vpc: undefined, subnet: undefined } });
                         // Force update to re-render
                         setVpcs([...vpcs]); 
                      }}
                    />
                  </Form.Item>
                </Col>
                
                <Form.Item noStyle shouldUpdate={(prev, curr) => prev.netMode !== curr.netMode}>
                   {({ getFieldValue }) => {
                      const mode = getFieldValue('netMode') || 'flat';
                      return mode === 'flat' ? (
                        <Col span={16}>
                          <Form.Item label="选择网络" name={["primaryNic", 'name']}>
                            <Select
                              placeholder="选择网络 (留空则使用 Pod Network)"
                              options={[{ label: 'Management Network (Pod Network)', value: '' }, ...(nadOptions || [])]}
                              onDropdownVisibleChange={(open) => { if (open) reloadNads(); }}
                              allowClear
                            />
                          </Form.Item>
                        </Col>
                      ) : (
                         <>
                            <Col span={8}>
                              <Form.Item label="VPC" name={["primaryNic", 'vpc']}>
                                <Select
                                  placeholder="选择 VPC"
                                  options={kubeVpcOptions}
                                  onDropdownVisibleChange={(open) => { if (open) reloadVpcs(); }}
                                  onChange={(val) => { 
                                     const curr = form.getFieldValue('primaryNic') || {}; 
                                     // Reset subnet when VPC changes
                                     form.setFieldsValue({ primaryNic: { ...curr, vpc: val, subnet: undefined, name: undefined, type: 'bridge' } }); 
                                  }}
                                />
                              </Form.Item>
                            </Col>
                            <Col span={8}>
                              <Form.Item label="子网" name={["primaryNic", 'subnet']} rules={[{ required: true, message: '请选择子网' }]}>
                                <Select
                                  placeholder="选择 VPC 子网"
                                  options={(function () { 
                                      const vpc = form.getFieldValue(['primaryNic', 'vpc']); 
                                      const list = subnets || []; 
                                      const filtered = vpc ? list.filter((x: any) => x?.spec?.vpc === vpc) : list; 
                                      return filtered.map((x: any) => ({ label: `${x?.metadata?.name || '-'}`, value: x?.metadata?.name })); 
                                  })()}
                                  onDropdownVisibleChange={(open) => { if (open) reloadSubnets(); }}
                                  onChange={(val) => { 
                                      const curr = form.getFieldValue('primaryNic') || {}; 
                                      // Subnet name IS the network name in Harvester/Kube-OVN
                                      form.setFieldsValue({ primaryNic: { ...curr, name: val, type: 'bridge' } }); 
                                  }}
                                />
                              </Form.Item>
                            </Col>
                         </>
                      );
                   }}
                </Form.Item>

                <Form.Item noStyle shouldUpdate={(prev, curr) => prev.netMode !== curr.netMode}>
                   {({ getFieldValue }) => {
                       const mode = getFieldValue('netMode') || 'flat';
                       return mode === 'flat' ? (
                         <>
                            <Col span={8}>
                              <Form.Item label="类型" name={["primaryNic", 'type']} initialValue="masquerade">
                                <Select options={[{ label: 'masquerade', value: 'masquerade' }, { label: 'bridge', value: 'bridge' }, { label: 'sriov', value: 'sriov' }, { label: 'macvtap', value: 'macvtap' }]} />
                              </Form.Item>
                            </Col>
                            <Col span={8}>
                              <Form.Item label="模型" name={["primaryNic", 'model']} initialValue="virtio">
                                <Select options={[{ label: 'virtio', value: 'virtio' }, { label: 'e1000', value: 'e1000' }, { label: 'e1000e', value: 'e1000e' }, { label: 'rtl8139', value: 'rtl8139' }]} />
                              </Form.Item>
                            </Col>
                         </>
                       ) : (
                          <>
                            <Col span={8}>
                              <Form.Item label="类型" name={["primaryNic", 'type']} initialValue="bridge">
                                <Select options={[{ label: 'masquerade', value: 'masquerade' }, { label: 'bridge', value: 'bridge' }, { label: 'sriov', value: 'sriov' }, { label: 'macvtap', value: 'macvtap' }]} />
                              </Form.Item>
                            </Col>
                            <Col span={8}>
                              <Form.Item label="模型" name={["primaryNic", 'model']} initialValue="virtio">
                                <Select options={[{ label: 'virtio', value: 'virtio' }, { label: 'e1000', value: 'e1000' }, { label: 'e1000e', value: 'e1000e' }, { label: 'rtl8139', value: 'rtl8139' }]} />
                              </Form.Item>
                            </Col>
                          </>
                       );
                   }}
                </Form.Item>

                <Col span={8}>
                  <Form.Item label="MAC 地址" name={["primaryNic", 'macAddress']} rules={[{ pattern: /^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/, message: '格式如 52:54:00:12:34:56' }]}>
                    <Input placeholder="52:54:00:12:34:56" />
                  </Form.Item>
                </Col>
             </Row>
          </>
        );
      }
      case 'change_secondary_nic': {
        const nadOptions = (nads || []).map((n: any) => ({ 
           label: n?.spec?.config ? `${n.name} (VLAN ${JSON.parse(n.spec.config).vlan})` : n.name, 
           value: n.name 
        }));
        const kubeVpcOptions = (vpcs || []).map((v: any) => ({ label: v.name, value: v.name }));

        return (
          <>
             <div style={{ marginBottom: 16, color: '#999' }}>变更辅助网卡（eth1+），修改后需重启生效</div>
             <Form.List name="secondaryNics">
               {(fields, { add, remove }) => (
                 <div>
                   {fields.map(({ key, name, ...restField }, idx) => {
                     return (
                       <Card
                         key={key}
                         size="small"
                         title={`网卡 #${idx + 2}`}
                         extra={
                           <Button type="text" icon={<MinusCircleOutlined />} onClick={() => remove(name)} danger />
                         }
                         style={{ marginBottom: 12 }}
                       >
                         <Row gutter={12}>
                           <Col span={8}>
                             <Form.Item 
                                {...restField}
                                label="网络类型" 
                                name={[name, 'mode']} 
                                initialValue="flat"
                             >
                               <Select
                                 options={[{ label: '扁平网络', value: 'flat' }, { label: 'VPC网络', value: 'vpc' }]}
                                 onChange={(v) => { 
                                     // Trigger update
                                     const curr = form.getFieldValue(['secondaryNics', name]) || {};
                                     // Clear subnet/vpc if switching
                                     const next = { ...curr, mode: v, name: undefined, vpc: undefined, subnet: undefined };
                                     const list = form.getFieldValue('secondaryNics');
                                     list[name] = next;
                                     form.setFieldsValue({ secondaryNics: list });
                                     setVpcs([...vpcs]); // force update
                                 }}
                               />
                             </Form.Item>
                           </Col>
                           
                           <Form.Item noStyle shouldUpdate>
                             {({ getFieldValue }) => {
                                const mode = getFieldValue(['secondaryNics', name, 'mode']) || 'flat';
                                return mode === 'flat' ? (
                                   <Col span={16}>
                                     <Form.Item {...restField} label="选择网络" name={[name, 'name']} rules={[{ required: true, message: '请选择网络' }]}>
                                       <Select
                                         placeholder="选择网络"
                                         options={nadOptions}
                                         onDropdownVisibleChange={(open) => { if (open) reloadNads(); }}
                                       />
                                     </Form.Item>
                                   </Col>
                                ) : (
                                   <>
                                     <Col span={8}>
                                       <Form.Item {...restField} label="VPC" name={[name, 'vpc']}>
                                         <Select
                                           placeholder="选择 VPC"
                                           options={kubeVpcOptions}
                                           onDropdownVisibleChange={(open) => { if (open) reloadVpcs(); }}
                                           onChange={(val) => { 
                                               const list = form.getFieldValue('secondaryNics');
                                               list[name] = { ...list[name], vpc: val, subnet: undefined, name: undefined };
                                               form.setFieldsValue({ secondaryNics: list });
                                           }}
                                         />
                                       </Form.Item>
                                     </Col>
                                     <Col span={8}>
                                       <Form.Item {...restField} label="子网" name={[name, 'subnet']} rules={[{ required: true, message: '请选择子网' }]}>
                                         <Select
                                           placeholder="选择子网"
                                           options={(function () { 
                                              const vpc = getFieldValue(['secondaryNics', name, 'vpc']); 
                                              const list = subnets || []; 
                                              const filtered = vpc ? list.filter((x: any) => x?.spec?.vpc === vpc) : list; 
                                              return filtered.map((x: any) => ({ label: `${x?.metadata?.name || '-'}`, value: x?.metadata?.name })); 
                                           })()}
                                           onDropdownVisibleChange={(open) => { if (open) reloadSubnets(); }}
                                           onChange={(val) => { 
                                               const list = form.getFieldValue('secondaryNics');
                                               list[name] = { ...list[name], name: val }; // Set name to subnet name
                                               form.setFieldsValue({ secondaryNics: list });
                                           }}
                                         />
                                       </Form.Item>
                                     </Col>
                                   </>
                                );
                             }}
                           </Form.Item>
                           
                           <Col span={8}>
                             <Form.Item {...restField} label="类型" name={[name, 'type']} initialValue="masquerade">
                               <Select options={[{ label: 'masquerade', value: 'masquerade' }, { label: 'bridge', value: 'bridge' }, { label: 'sriov', value: 'sriov' }, { label: 'macvtap', value: 'macvtap' }]} />
                             </Form.Item>
                           </Col>
                           <Col span={8}>
                             <Form.Item {...restField} label="模型" name={[name, 'model']} initialValue="virtio">
                               <Select options={[{ label: 'virtio', value: 'virtio' }, { label: 'e1000', value: 'e1000' }, { label: 'e1000e', value: 'e1000e' }, { label: 'rtl8139', value: 'rtl8139' }]} />
                             </Form.Item>
                           </Col>
                           <Col span={8}>
                             <Form.Item {...restField} label="MAC 地址" name={[name, 'macAddress']} rules={[{ pattern: /^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/, message: '格式如 52:54:00:12:34:56' }]}>
                               <Input placeholder="52:54:00:12:34:56" />
                             </Form.Item>
                           </Col>
                         </Row>
                       </Card>
                     );
                   })}
                   <Button type="dashed" onClick={() => add({ mode: 'flat', type: 'masquerade', model: 'virtio' })} block icon={<PlusOutlined />}>
                     添加辅助网卡
                   </Button>
                 </div>
               )}
             </Form.List>
          </>
        );
      }

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
                        marginBottom: 6,
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
