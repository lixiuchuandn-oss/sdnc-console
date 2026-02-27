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
import React, { useMemo } from 'react';
import { Modal, Form, Space, Radio, Button, Tag, Tooltip } from 'antd';
import { 
  HddOutlined, GlobalOutlined, DashboardOutlined, LoadingOutlined, QuestionCircleOutlined
} from '@ant-design/icons';

import ChangeSpec from './VmReconfigure/ChangeSpec';
import CpuAdvanced from './VmReconfigure/CpuAdvanced';
import MemAdvanced from './VmReconfigure/MemAdvanced';
import ChangeGpu from './VmReconfigure/ChangeGpu';
import ChangeOs from './VmReconfigure/ChangeOs';
import SystemDiskExpand from './VmReconfigure/SystemDiskExpand';
import AddDataDisk from './VmReconfigure/AddDataDisk';
import ChangePrimaryNic from './VmReconfigure/ChangePrimaryNic';
import ChangeSecondaryNic from './VmReconfigure/ChangeSecondaryNic';
import { useVmReconfigure } from './VmReconfigure/useVmReconfigure';
import { isSystemStorageClass } from '../../../../utils/harvesterUtils';

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
    open, record, onClose
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
    scs, images, gpuResources, selectedGpuKey, setSelectedGpuKey,
    nads, vpcs, subnets, setVpcs,
    gpuKeyword, setGpuKeyword, gpuLoading,
    reloadScs, reloadImages, reloadGpuResources, reloadNads, reloadVpcs, reloadSubnets,
    handleSubmit,
    systemDisk,
    systemDiskSize,
    systemDiskLoading,
    getCurrentSpec,
    getMemoryInGi,
    isHotPlugEnabledOnVm,
    isRestartRequired,
    isHotPlugInProgress
  } = useVmReconfigure(props);

  // 监听表单中的 CPU / 内存 / 热扩容开关，用于动态计算按钮文案等
  const cpu = Form.useWatch('cpu', form);
  const memory = Form.useWatch('memory', form);
  const enableHotPlug = Form.useWatch('enableHotPlug', form);
  
  // 计算当前实例规格（作为“变配前”的基准值）
  const { cpu: currentCpuRaw, memory: currentMemoryRaw, maxSockets, maxMemory: maxMemoryRaw } = useMemo(() => {
     if (!getCurrentSpec) return { cpu: 0, memory: 0, maxSockets: undefined, maxMemory: undefined };
     return getCurrentSpec();
  }, [getCurrentSpec, record]);
  
  const currentCpu = Number(currentCpuRaw || 0);
  const currentMemory = getMemoryInGi(currentMemoryRaw);
  const maxMemory = maxMemoryRaw ? getMemoryInGi(maxMemoryRaw) : undefined;
  const architecture = record?.spec?.template?.spec?.architecture || record?.spec?.architecture;
  
  // 当前 VM 是否已启用 CPU / 内存热扩容能力（基于注解/feature 判断）
  const isHotPlugEnabledOnVmVal = useMemo(() => {
    return isHotPlugEnabledOnVm ? isHotPlugEnabledOnVm() : false;
  }, [isHotPlugEnabledOnVm, record]);

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
        { key: 'cpu_advanced', label: 'CPU高级配置' },
        { key: 'mem_advanced', label: '内存高级配置' },
        { key: 'change_gpu', label: '变更GPU' },
      ]
    },
    {
      title: '系统与存储',
      icon: <HddOutlined />,
      children: [
        { key: 'change_os', label: '更换系统镜像' },
        { key: 'expand_system_disk', label: '系统盘扩容' },
        { key: 'add_disk', label: '添加数据盘' },
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
            isHotPlugEnabledOnVm={isHotPlugEnabledOnVmVal}
            isRestartRequired={isRestartRequired}
            maxSockets={maxSockets}
            maxMemory={maxMemory}
            architecture={architecture}
            disabled={isHotPlugInProgress}
          />
        );
      case 'cpu_advanced':
        return <CpuAdvanced form={form} />;
      case 'mem_advanced':
        return <MemAdvanced form={form} />;
      case 'change_gpu':
        return (
          <ChangeGpu 
            form={form} 
            gpuResources={gpuResources}
            selectedGpuKey={selectedGpuKey}
            setSelectedGpuKey={setSelectedGpuKey}
            gpuKeyword={gpuKeyword}
            setGpuKeyword={setGpuKeyword}
            gpuLoading={gpuLoading}
            reloadGpuResources={reloadGpuResources}
          />
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
  // The user has explicitly requested this specific visual design (Radio Group with rounded corners, expanded groups).
  // Any changes to the layout, spacing, or visual appearance must be approved by the user.
  // -----------------------------------------------------

  // --- Alert & Footer Logic (提示信息与底部按钮文案计算) ---
  // 这里根据 CPU/内存热扩容配置，动态决定按钮文案：普通“提交”或“提交（冷扩容）”
  // 同时预留 alertMessage 以便在未来增加风险提示文案。
  const { alertMessage, okText } = useMemo(() => {
    let messageNode = null;
    let buttonText = "提交";

    if (selectedKey === 'change_spec') {
        // 仅在“变更实例规格”任务下，才需要根据热扩容能力调整按钮文案
        // 场景：
        // - 表单未开启热扩容开关 -> 冷扩容；
        // - VM 本身未启用热扩容能力 -> 冷扩容；
        // - 虽然表单与 VM 均支持热扩容，但超过 4 倍上限或缩配 -> 强制冷扩容。
        if (!enableHotPlug) {
           buttonText = "提交（冷扩容）";
        } else if (enableHotPlug && !isHotPlugEnabledOnVmVal) {
           buttonText = "提交（冷扩容）";
        } else {
           const limitCpu = maxSockets || (currentCpu * 4);
           const limitMem = currentMemory * 4;
           
           const isOverLimit = (cpu !== undefined && cpu > limitCpu) || (memory !== undefined && memory > limitMem);
           const isInvalid = (cpu !== undefined && cpu < currentCpu) || (memory !== undefined && memory < currentMemory);
    
           if (isOverLimit || isInvalid) {
              buttonText = "提交（冷扩容）";
           } else {
              buttonText = "提交";
           }
        }
    }
    return { alertMessage: messageNode, okText: buttonText };
  }, [selectedKey, cpu, memory, enableHotPlug, currentCpu, currentMemory, isHotPlugEnabledOnVmVal, maxSockets]);

  // 底部按钮区域，仅保留“取消 + 提交”两种操作
  const footer = (
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Button onClick={onClose}>取消</Button>
        <Button type="primary" onClick={handleSubmit} disabled={isHotPlugInProgress}>{okText}</Button>
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
        <div style={{ width: 180,  overflowY: 'auto', marginRight: 40 }}>
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
                <Space direction="vertical" style={{ width: '100%', gap: 4 }}>
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
        <div style={{ border: '1px solid #f0f0f0',borderRadius: '8px', flex: 1, padding: 24, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
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
