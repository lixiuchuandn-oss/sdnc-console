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
import { Modal, Form, Space, Radio, Button, Alert } from 'antd';
import { 
  HddOutlined, GlobalOutlined, DashboardOutlined
} from '@ant-design/icons';

import ChangeSpec from './VmReconfigure/ChangeSpec';
import CpuAdvanced from './VmReconfigure/CpuAdvanced';
import MemAdvanced from './VmReconfigure/MemAdvanced';
import ChangeGpu from './VmReconfigure/ChangeGpu';
import ChangeOs from './VmReconfigure/ChangeOs';
import DiskOperations from './VmReconfigure/DiskOperations';
import ChangePrimaryNic from './VmReconfigure/ChangePrimaryNic';
import ChangeSecondaryNic from './VmReconfigure/ChangeSecondaryNic';
import { useVmReconfigure } from './VmReconfigure/useVmReconfigure';
import { isSystemStorageClass } from '../../../../utils/harvesterUtils';

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
    isHotPlugEnabledOnVm
  } = useVmReconfigure(props);

  // Watch form values for dynamic UI logic
  const cpu = Form.useWatch('cpu', form);
  const memory = Form.useWatch('memory', form);
  const enableHotPlug = Form.useWatch('enableHotPlug', form);
  
  // Calculate current specs
  const { cpu: currentCpuRaw, memory: currentMemoryRaw } = useMemo(() => {
     if (!getCurrentSpec) return { cpu: 0, memory: 0 };
     return getCurrentSpec();
  }, [getCurrentSpec, record]);
  
  const currentCpu = Number(currentCpuRaw || 0);
  const currentMemory = getMemoryInGi ? getMemoryInGi(currentMemoryRaw) : 0;
  
  // Calculate initial hotplug status
  const isHotPlugEnabledOnVmVal = useMemo(() => {
    return isHotPlugEnabledOnVm ? isHotPlugEnabledOnVm() : false;
  }, [isHotPlugEnabledOnVm, record]);

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
  const renderContent = () => {
        
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
      case 'add_disk':
        return (
          <DiskOperations 
            form={form}
            scOptions={scOptions}
            reloadScs={reloadScs}
            selectedKey={selectedKey}
            systemDisk={systemDisk}
            systemDiskSize={systemDiskSize}
            loading={systemDiskLoading}
          />
        );

      // --- Network Config ---
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

  // --- Alert & Footer Logic ---
  // Split Alert message out of Footer to place it in the body content
  const { alertMessage, okText } = useMemo(() => {
    let messageNode = null;
    let buttonText = "提交";

    if (selectedKey === 'change_spec') {
        // Scenario 3: Not Enabled in form OR Not Enabled on VM
        // If enableHotPlug (form) is true, but isHotPlugEnabledOnVmVal (VM) is false, it means we are turning it ON, which requires restart.
        // So effectively, we only support HotPlug if BOTH are true.
        const isActuallyHotPlug = enableHotPlug && isHotPlugEnabledOnVmVal;

        if (!enableHotPlug) {
           // Case A: Form switch is OFF -> Cold Plug
           buttonText = "提交（冷扩容）";
        } else if (enableHotPlug && !isHotPlugEnabledOnVmVal) {
           // Case B: Form switch is ON, but VM was OFF -> Cold Plug (Turning it on requires reboot)
           buttonText = "提交（冷扩容）";
        } else {
           // Case C: Both ON -> Potential Hot Plug (check limits)
           const limitCpu = currentCpu * 4;
           const limitMem = currentMemory * 4;
           
           const isOverLimit = (cpu !== undefined && cpu > limitCpu) || (memory !== undefined && memory > limitMem);
           const isInvalid = (cpu !== undefined && cpu < currentCpu) || (memory !== undefined && memory < currentMemory);
    
           if (isOverLimit || isInvalid) {
              // Scenario 2: Over limit
              buttonText = "提交（冷扩容）";
           } else {
              // Scenario 1: Within Range
              buttonText = "提交";
           }
        }
    }
    return { alertMessage: messageNode, okText: buttonText };
  }, [selectedKey, cpu, memory, enableHotPlug, currentCpu, currentMemory, isHotPlugEnabledOnVmVal]);

  const footer = (
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Button onClick={onClose}>取消</Button>
        <Button type="primary" onClick={handleSubmit}>{okText}</Button>
      </div>
  );

  return (
    <Modal
      title={menuGroups.flatMap(g => g.children).find(c => c.key === selectedKey)?.label ? `资源变配 - ${menuGroups.flatMap(g => g.children).find(c => c.key === selectedKey)?.label}` : '资源变配'}
      open={open}
      onCancel={onClose}
      footer={footer}
      destroyOnClose
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
        <div style={{ border: '1px solid #f0f0f0',borderRadius: '8px', flex: 1, padding: 24, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
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
