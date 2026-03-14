/**
 * VmReconfigureModal.tsx
 * 
 * 虚拟机资源变配模态框 (VM Reconfiguration Modal)
 * 
 * 主要功能：
 * 1. 提供虚拟机规格变更、系统重装、磁盘管理等多种运维操作。
 * 2. 采用"单任务模式" (Single Task Mode)：
 *    - 左侧导航栏采用 Menu 单选模式，确保同一时间只能进行一种类型的变配操作。
 *    - 切换功能项时，自动重置表单，避免不同任务间的配置冲突。
 * 3. 样式冻结 (Style Freeze)：
 *    - 左侧导航栏的样式（圆角、展开分组、选中效果）由用户指定，严禁随意修改。
 */
import React, { useMemo } from 'react';
import { Modal, Form, Menu, Button, Tag, Tooltip, Checkbox, Card, Select, message, Row, Col } from 'antd';
import type { MenuProps } from 'antd';
import { 
  HddOutlined, GlobalOutlined, DashboardOutlined, LoadingOutlined, QuestionCircleOutlined
} from '@ant-design/icons';

import ChangeSpec from './VmReconfigure/ChangeSpec';
import HotPlugSettings from './VmReconfigure/HotPlugSettings';
import CpuAdvanced from './VmReconfigure/CpuAdvanced';
import ChangeGpu from './VmReconfigure/ChangeGpu';
import ChangeUsb from './VmReconfigure/ChangeUsb';
import ChangeOs from './VmReconfigure/ChangeOs';
import ChangeNodeScheduling from './VmReconfigure/ChangeNodeScheduling';
import ChangeNodeAffinity from './VmReconfigure/ChangeNodeAffinity';
import SystemDiskExpand from './VmReconfigure/SystemDiskExpand';
import AddDataDisk from './VmReconfigure/AddDataDisk';
import DetachDataDisk from './VmReconfigure/DetachDataDisk';
import ChangePrimaryNic from './VmReconfigure/ChangePrimaryNic';
import ChangeSecondaryNic from './VmReconfigure/ChangeSecondaryNic';
import { useVmReconfigure } from './VmReconfigure/useVmReconfigure';
import { isSystemStorageClass } from '../../../../utils/harvesterUtils';
import './VmCreateWizard/InstanceWizard.css';

/**
 * 组件入参说明：
 * - open: 模态框是否可见
 * - cloudId: 云 ID，用于后端请求
 * - record: 当前 VM 的记录（包含规格、磁盘、网络等信息）
 * - onClose: 关闭模态框回调
 * - onOk: 变配成功后的回调（通常用于刷新列表）
 * - storageClasses: 可选的存储类列表（外部可预加载传入）
 * - images: 可选的镜像列表
 * - gpuResources: 可选的 GPU 资源列表
 * - initialConfigType: 默认选中的变配功能 key
 */
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

const VmReconfigureModal: React.FC<Props> = (props) => {
  const { 
    open, cloudId, record, onClose
  } = props;

  /**
   * useVmReconfigure Hook 统一封装了所有与“变配”相关的状态与方法：
   * - form: Antd Form 实例；
   * - selectedKey: 当前选中的变配菜单项 key；
   * - scs/images/gpuResources/nads/vpcs/subnets: 各类下拉资源数据；
   * - reloadXXX: 对应资源的刷新函数；
   * - systemDisk/systemDiskSize/systemDiskLoading: 系统盘信息及加载状态；
   * - getCurrentSpec/getMemoryInGi/isHotPlugEnabledOnVm: 用于计算当前规格与热扩容能力的工具函数；
   * - handleSubmit: 提交当前选中任务的统一入口。
   */
  const {
    form,
    selectedKey, setSelectedKey,
    scs, images, gpuResources, selectedGpuKeys, setSelectedGpuKeys,
    usbResources, selectedUsbKeys, setSelectedUsbKeys,
    nads, vpcs, subnets, setVpcs,
    nodes, reloadNodes,
    gpuLoading,
    usbLoading,
    reloadScs, reloadImages, reloadGpuResources, reloadUsbResources, reloadNads, reloadVpcs, reloadSubnets,
    handleSubmit,
    systemDisk,
    systemDiskSize,
    systemDiskLoading,
    getCurrentSpec,
    getMemoryInGi,
    isHotPlugEnabledOnVm,
    isHotPlugConfiguredOnVm,
    isRestartRequired,
    isHotPlugInProgress,
    latestVm,
    // add disk split actions
    diskCreating,
    diskAttaching,
    handleCreateDisk,
    handleAttachDisk,
    availableDiskPvcs,
    // detach disk actions
    diskDetaching,
    handleDetachDisk,
    refreshVm,
  } = useVmReconfigure(props);

  // 监听表单中的 CPU / 内存，用于动态计算按钮文案等
  const cpu = Form.useWatch('cpu', form);
  const memory = Form.useWatch('memory', form);
  // 添加数据盘两步按钮：监听创建状态
  const newDiskCreated = Form.useWatch('newDiskCreated', form);
  const newDiskSource = Form.useWatch('newDiskSource', form);
  const changeOsConfirmed = Form.useWatch('changeOsConfirmed', form);
  // [移除] enableHotPlug 已拆分为独立功能，不再在 change_spec 中监听
  // const enableHotPlug = Form.useWatch('enableHotPlug', form);
  
  // 计算当前实例规格（作为“变配前”的基准值）
  // [修复] getCurrentSpec 内部依赖最新 VM 状态，确保当 VM 数据更新时重新计算规格
  const { cpu: currentCpuRaw, memory: currentMemoryRaw, maxSockets, maxMemory: maxMemoryRaw } = useMemo(() => {
     if (!getCurrentSpec) return { cpu: 0, memory: 0, maxSockets: undefined, maxMemory: undefined };
     return getCurrentSpec();
  }, [getCurrentSpec]);
  
  const currentCpu = Number(currentCpuRaw || 0);
  const currentMemory = getMemoryInGi(currentMemoryRaw);
  const maxMemory = maxMemoryRaw ? getMemoryInGi(maxMemoryRaw) : undefined;
  const architecture = record?.spec?.template?.spec?.architecture || record?.spec?.architecture;
  
  // 当前 VM 的热扩容状态：
  // - isHotPlugConfiguredOnVm：仅根据 Annotation 判断是否“已配置”热扩容（用于 UI 展示/布局）
  // - isHotPlugEnabledOnVm：已配置且当前可进行热扩容（无 RestartRequired / 热扩容进行中，用于本次是否真正走热扩容路径）
  const isHotPlugConfiguredOnVmVal = isHotPlugConfiguredOnVm || false;
  const isHotPlugActiveOnVmVal = isHotPlugEnabledOnVm || false;

  /**
   * 左侧菜单分组：
   * - 资源配置：规格、CPU 高级、内存高级、GPU 变更；
   * - 系统与存储：更换系统镜像、系统盘扩容、添加数据盘；
   * - 网络配置：主网卡/辅助网卡变更。
   *
   * 注意：该菜单结构与文案属于“样式冻结”范围，修改前需与产品确认。
   */
  const menuGroups = [
    {
      title: '资源配置',
      icon: <DashboardOutlined />,
      children: [
        { key: 'change_spec', label: '变更实例规格' },
        { key: 'hotplug_settings', label: '热扩容设置' },
        { key: 'cpu_advanced', label: '性能设置' },
        { key: 'vm_policy', label: '高可用设置' },
        { key: 'change_node_scheduling', label: '节点调度' },
        { key: 'change_node_affinity', label: '节点亲和性' },
      ]
    },
    {
      title: '系统与存储',
      icon: <HddOutlined />,
      children: [
        { key: 'change_os', label: '更换系统镜像' },
        { key: 'expand_system_disk', label: '系统盘扩容' },
        { key: 'add_disk', label: '添加数据盘' },
        { key: 'detach_disk', label: '解绑数据盘' },
      ]
    },
    {
      title: '网络与设备',
      icon: <GlobalOutlined />,
      children: [
        { key: 'change_primary_nic', label: '变更主网卡' },
        { key: 'change_secondary_nic', label: '变更辅助网卡' },
        { key: 'change_gpu', label: '变更GPU' },
        { key: 'change_usb', label: '变更USB' },
      ]
    }
  ];

  // --- Dynamic Form Rendering (动态表单渲染) ---
  /**
   * 根据当前选中的菜单 key 动态渲染右侧内容区域：
   * - 每个子组件仅关注自己职责范围内的表单字段；
   * - 通过 props 传入所需的资源列表及刷新函数；
   * - 保证不同任务之间的表单字段互不干扰。
   */
  const renderContent = () => {
    
    // 过滤掉系统存储类，仅允许用户选择业务存储类
    const scOptions = (scs || [])
      .filter((x: any) => !isSystemStorageClass(x?.metadata?.name || x?.name))
      .map((x: any) => ({ value: x?.metadata?.name || x?.name, label: x?.metadata?.name || x?.name }));

    switch (selectedKey) {
      // --- Resource Config (资源配置) ---
      case 'change_spec':
        return (
          <ChangeSpec 
            form={form} 
            currentCpu={currentCpu} 
            currentMemory={currentMemory}
            // 这里用"是否已配置热扩容"来决定界面布局和表单校验
            isHotPlugEnabledOnVm={isHotPlugConfiguredOnVmVal}
            isRestartRequired={isRestartRequired}
            maxSockets={maxSockets}
            maxMemory={maxMemory}
            architecture={architecture}
            disabled={isHotPlugInProgress}
          />
        );
      case 'hotplug_settings':
        return (
          <HotPlugSettings 
            form={form} 
            currentCpu={currentCpu} 
            currentMemory={currentMemory}
            isHotPlugEnabledOnVm={isHotPlugConfiguredOnVmVal}
            maxSockets={maxSockets}
            maxMemory={maxMemory}
            architecture={architecture}
            disabled={isHotPlugInProgress}
          />
        );
      case 'cpu_advanced': {
        const domain = (latestVm || record)?.spec?.template?.spec?.domain;
        const cpuSpec = domain?.cpu;
        const resources = domain?.resources;
        const vmCpuState = {
          cpu: cpuSpec || null,
          resources: resources || null,
        };
        return (
          <CpuAdvanced 
            form={form}
            cloudId={cloudId}
            vmCpuState={vmCpuState}
            vmCpuDebugText={JSON.stringify(vmCpuState, null, 2)} 
          />
        );
      }
      case 'change_gpu': {
        // 获取当前VM正在使用的GPU资源名列表
        // 使用与 useVmReconfigure hook 相同的逻辑来确保一致性
        const activeVm = latestVm || record;
        const domain = activeVm?.spec?.template?.spec?.domain;
        const hostDevices = domain?.devices?.hostDevices || [];
        const gpus = domain?.devices?.gpus || [];
        // 判断GPU模式：优先检查gpus，再检查hostDevices
        const inferredMode = gpus.length > 0 ? 'vgpu' : (hostDevices.length > 0 ? 'passthrough' : 'none');
        const currentMode = form.getFieldValue('gpuMode') || inferredMode;
        const effectiveMode = currentMode === 'none' ? inferredMode : currentMode;
        const vmAssigned = (effectiveMode === 'vgpu' ? gpus : hostDevices);
        const currentVmGpuResourceNames = (Array.isArray(vmAssigned) ? vmAssigned : []).map((x: any) => x?.deviceName).filter(Boolean);
        return (
          <ChangeGpu 
            form={form} 
            gpuResources={gpuResources}
            selectedGpuKeys={selectedGpuKeys}
            setSelectedGpuKeys={setSelectedGpuKeys}
            gpuLoading={gpuLoading}
            reloadGpuResources={reloadGpuResources}
            currentVmGpuResourceNames={currentVmGpuResourceNames}
          />
        );
      }
      case 'change_usb': {
        // 获取当前VM正在使用的USB资源名列表
        const activeVm = latestVm || record;
        const domain = activeVm?.spec?.template?.spec?.domain;
        const hostDevices = domain?.devices?.hostDevices || [];
        const usb = (Array.isArray(hostDevices) ? hostDevices : []).filter((d: any) => {
          const n = String(d?.name || '').toLowerCase();
          const dn = String(d?.deviceName || '').toLowerCase();
          return n.startsWith('usb') || dn.includes('usb');
        });
        const currentVmUsbResourceNames = usb.map((x: any) => x?.deviceName).filter(Boolean);
        return (
          <ChangeUsb
            form={form}
            usbResources={usbResources}
            selectedUsbKeys={selectedUsbKeys}
            setSelectedUsbKeys={setSelectedUsbKeys}
            usbLoading={usbLoading}
            reloadUsbResources={reloadUsbResources}
            currentVmUsbResourceNames={currentVmUsbResourceNames}
          />
        );
      }
      case 'change_node_scheduling':
        return (
          <ChangeNodeScheduling
            form={form}
            cloudId={cloudId}
            record={latestVm || record}
            nodes={nodes}
            reloadNodes={reloadNodes}
            nodesLoading={false}
          />
        );
      case 'change_node_affinity':
        return (
          <ChangeNodeAffinity
            form={form}
            cloudId={cloudId}
            record={latestVm || record}
          />
        );
      case 'vm_policy':
        return (
          <>
            <div>
              <Row gutter={12} style={{ marginBottom: 0 }}>
                <Col span={6}>
                  <div style={{ lineHeight: '32px' }}>运行策略</div>
                </Col>
                <Col span={18}>
                  <Form.Item name="runStrategy" rules={[{ required: true, message: '请选择运行策略' }]} noStyle>
                    <Select
                      placeholder="选择运行策略"
                      style={{ width: 320 }}
                      options={[
                        { value: 'Always', label: 'Always（始终运行）' },
                        { value: 'RerunOnFailure', label: 'RerunOnFailure（失败自动重启）' },
                        { value: 'Manual', label: 'Manual（手动控制）' },
                        { value: 'Halted', label: 'Halted（保持停止）' },
                      ]}
                      onChange={(v) => {
                        if (String(v) === 'Halted') message.warning('设置为 Halted 后实例将保持停止状态');
                      }}
                    />
                  </Form.Item>
                  <div style={{ marginBottom: 24 }} />
                </Col>
              </Row>

              <Row gutter={12} style={{ marginBottom: 0 }}>
                <Col span={6}>
                  <div style={{ lineHeight: '32px' }}>驱逐策略</div>
                </Col>
                <Col span={18}>
                  <Form.Item name="evictionStrategy" noStyle>
                    <Select
                      placeholder="选择驱逐策略"
                      allowClear
                      style={{ width: 320 }}
                      options={[
                        { value: 'LiveMigrateIfPossible', label: 'LiveMigrateIfPossible（尽可能热迁移）' },
                        { value: 'LiveMigrate', label: 'LiveMigrate（强制热迁移）' },
                        { value: 'None', label: 'None（不迁移）' },
                      ]}
                      onChange={(v) => {
                        if (String(v) === 'None') message.warning('驱逐策略为 None 时，节点维护/驱逐可能导致实例不可用');
                      }}
                    />
                  </Form.Item>
                  <div style={{ marginBottom: 24 }} />
                </Col>
              </Row>
            </div>
          </>
        );
      
      // --- System & Storage Config (系统与存储配置) ---
      case 'change_os':
        return (
          <ChangeOs 
            form={form}
            images={images}
            reloadImages={reloadImages}
            storageClasses={scs}
            reloadStorageClasses={reloadScs}
            defaultStorageClassName={scs.find(x => x?.metadata?.annotations?.['storageclass.kubernetes.io/is-default-class'] === 'true')?.metadata?.name}
          />
        );
      case 'expand_system_disk':
        return (
          <SystemDiskExpand 
            form={form}
            scOptions={scOptions}
            reloadScs={reloadScs}
            selectedKey={selectedKey}
            systemDisk={systemDisk}
            systemDiskSize={systemDiskSize}
            loading={systemDiskLoading}
          />
        );
      case 'add_disk':
        return (
          <AddDataDisk 
            form={form}
            scOptions={scOptions}
            reloadScs={reloadScs}
            pvcOptions={availableDiskPvcs}
          />
        );
      case 'detach_disk':
        return (
          <DetachDataDisk 
            record={latestVm || record}
            cloudId={cloudId}
            onDetach={handleDetachDisk}
            onRefresh={refreshVm}
            loading={diskDetaching}
          />
        );

      // --- Network Config (网络配置) ---
      case 'change_primary_nic':
        return (
          <ChangePrimaryNic
            form={form}
            nads={nads}
            vpcs={vpcs}
            subnets={subnets}
            reloadNads={reloadNads}
            reloadVpcs={reloadVpcs}
            reloadSubnets={reloadSubnets}
            setVpcs={setVpcs}
          />
        );
      case 'change_secondary_nic':
        return (
          <ChangeSecondaryNic
            form={form}
            nads={nads}
            vpcs={vpcs}
            subnets={subnets}
            reloadNads={reloadNads}
            reloadVpcs={reloadVpcs}
            reloadSubnets={reloadSubnets}
            setVpcs={setVpcs}
          />
        );

      default:
        return null;
    }
  };

  // --- Style Freeze: Do NOT modify the styles below ---
  // The user has explicitly requested this specific visual design (Menu with rounded corners, expanded groups).
  // Any changes to the layout, spacing, or visual appearance must be approved by the user.
  // -----------------------------------------------------

  // --- Alert & Footer Logic (提示信息与底部按钮文案计算) ---
  // 这里根据 CPU/内存热扩容配置，动态决定按钮文案：普通“提交”或“提交（冷扩容）”
  // 同时预留 alertMessage 以便在未来增加风险提示文案。
  const { alertMessage, okText } = useMemo(() => {
    let messageNode = null;
    let buttonText = "提交";

    if (selectedKey === 'change_spec') {
        // 仅在"变更实例规格"任务下，才需要根据热扩容能力调整按钮文案
        // 场景：
        // - VM 本身未启用热扩容能力 -> 冷扩容；
        // - VM 已启用热扩容，但超过上限或缩配 -> 强制冷扩容。
        // 按钮文案需要看“当前这次变更是否可以走热扩容路径”，因此用 Active 状态
        if (!isHotPlugActiveOnVmVal) {
           buttonText = "提交（冷扩容）";
        } else {
           const limitCpu = maxSockets || (currentCpu * 4);
           const limitMem = maxMemory || (currentMemory * 4);
           
           const isOverLimit = (cpu !== undefined && cpu > limitCpu) || (memory !== undefined && memory > limitMem);
           const isInvalid = (cpu !== undefined && cpu < currentCpu) || (memory !== undefined && memory < currentMemory);
    
           if (isOverLimit || isInvalid) {
              buttonText = "提交（冷扩容）";
           } else {
              buttonText = "提交（热扩容）";
           }
        }
    }
    return { alertMessage: messageNode, okText: buttonText };
  }, [selectedKey, cpu, memory, currentCpu, currentMemory, isHotPlugActiveOnVmVal, maxSockets, maxMemory]);

  const showChangeOsRisk = () => {
    Modal.info({
      title: '更换系统盘风险说明',
      width: 520,
      content: (
        <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.6 }}>
          <p style={{ marginBottom: 4 }}>• 更换操作系统将删除当前的系统盘并重建实例，系统盘数据将会丢失。</p>
          <p style={{ marginBottom: 4 }}>• 挂载的数据盘将被保留，但在新系统启动后可能需要手动重新挂载。</p>
          <p style={{ marginBottom: 0 }}>• 虚拟机将会强制重启以应用更改，请在业务低峰期执行。</p>
        </div>
      ),
      okText: '我已知晓',
      onOk: () => {
        try {
          form.setFieldsValue({ changeOsConfirmed: true });
        } catch {}
      },
    });
  };

  // 底部按钮区域，仅保留“取消 + 提交”两种操作
  const footer = (
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8 }}>
        {selectedKey === 'add_disk' ? (
          <>
            <Button onClick={onClose}>取消</Button>
            <Button
              type="primary"
              onClick={handleCreateDisk}
              loading={diskCreating}
              disabled={diskAttaching || !!newDiskCreated || newDiskSource === 'existing'}
            >
              创建磁盘
            </Button>
            <Button
              type="primary"
              onClick={handleAttachDisk}
              loading={diskAttaching}
              disabled={diskCreating || !newDiskCreated}
            >
              挂载磁盘
            </Button>
          </>
        ) : selectedKey === 'change_os' ? (
          <>

            <Checkbox checked={!!changeOsConfirmed} disabled>
              已确认风险
            </Checkbox>
            <Button type="link" onClick={showChangeOsRisk} style={{ paddingLeft: 0 }}>
              查看风险信息
            </Button>
            <Button onClick={onClose}>取消</Button>
            <Button
              type="primary"
              onClick={handleSubmit}
              disabled={isHotPlugInProgress || !changeOsConfirmed}
            >
              {okText}
            </Button>
          </>
        ) : (
          <>
            <Button onClick={onClose}>取消</Button>
            <Button type="primary" onClick={handleSubmit} disabled={isHotPlugInProgress}>{okText}</Button>
          </>
        )}
      </div>
  );

  const renderTopAlert = () => {
    if (isHotPlugInProgress) {
       return (
         <div
           style={{
             marginBottom: 12,
             background: '#fffbe6',
             border: '1px solid #ffe58f',
             borderRadius: 8,
             padding: '8px 12px',
             display: 'flex',
             alignItems: 'center',
             justifyContent: 'space-between',
             gap: 12,
           }}
         >
           <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
             <LoadingOutlined style={{ color: '#faad14' }} />
             <span style={{ fontWeight: 500 }}>热扩容进行中</span>
             <span style={{ color: 'rgba(0,0,0,0.65)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
               暂不可提交新的规格变更
             </span>
           </div>
           <Tooltip
             title={
               <div>
                 <div>1. 当前虚拟机正在执行 CPU 或内存热扩容。</div>
                 <div>2. 操作完成前禁止再次变配，避免后端并发失败。</div>
                 <div>3. 可在详情页事件/状态中确认进度，必要时点击刷新。</div>
               </div>
             }
           >
             <QuestionCircleOutlined style={{ color: 'rgba(0,0,0,0.45)', flex: 'none' }} />
           </Tooltip>
         </div>
       );
    }
    return null;
  };

  return (
    <Modal
      zIndex={1001} // Ensure it is above the Detail Drawer (z-index 1000)
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>资源变配</span>
          {isRestartRequired && <Tag color="warning" style={{ fontWeight: 'normal', margin: 0 }}>需重启</Tag>}
          {isHotPlugInProgress && <Tag color="processing" style={{ fontWeight: 'normal', margin: 0 }}>热扩容中</Tag>}
        </div>
      }
      open={open}
      onCancel={onClose}
      footer={footer}
      width={900}
      styles={{ body: { padding: 0 } }}
    >
      <div style={{ display: 'flex', height: '70vh' }}>
        <div style={{ width: 200,  overflowY: 'auto', marginRight: 24 }}>
          <Menu
            mode="inline"
            style={{ paddingInlineEnd: 24 }}
            selectedKeys={[selectedKey]}
            onClick={({ key }) => setSelectedKey(String(key))}
            items={menuGroups.map((group, groupIndex) => ({
              key: `group_${groupIndex}`,
              type: 'group',
              label: group.title,
              children: group.children.map((child) => ({
                key: child.key,
                label: child.label,
              })),
            })) as MenuProps['items']}
          />
        </div>
        <div style={{ flex: 1, padding: 10, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          {renderTopAlert()}
          <div style={{ flex: 1 }}>
            <Form
              form={form}
              layout="vertical"
              wrapperCol={{ span: 24 }}
            >
              {renderContent()}
            </Form>
          </div>
          {alertMessage}
        </div>
      </div>
    </Modal>
  );
};

export default VmReconfigureModal;
