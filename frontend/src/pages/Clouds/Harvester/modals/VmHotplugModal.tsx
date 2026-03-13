/**
 * VmHotplugModal.tsx
 * 
 * 虚拟机热插拔模态框 (VM Hotplug Modal)
 * 
 * 主要功能：
 * 1. 提供虚拟机运行时热插拔操作，无需重启即可生效。
 * 2. 采用"单任务模式" (Single Task Mode)：
 *    - 左侧导航栏采用 Menu 单选模式，确保同一时间只能进行一种类型的操作。
 *    - 切换功能项时，自动重置表单，避免不同任务间的配置冲突。
 * 3. 与资源变配分离：
 *    - 资源变配：修改 spec 配置，需要重启生效
 *    - 热插拔：运行时操作，无需重启，通过迁移实现
 */
import React, { useMemo } from 'react';
import { Modal, Menu, Button, Card, Space, Typography, Tag } from 'antd';
import type { MenuProps } from 'antd';
import { ThunderboltOutlined, HddOutlined, WifiOutlined, CustomerServiceOutlined } from '@ant-design/icons';

import HotplugNic from './VmHotplug/HotplugNic';
import HotplugVolume from './VmHotplug/HotplugVolume';
import HotplugCpuMemory from './VmHotplug/HotplugCpuMemory';
import HotplugCdrom from './VmHotplug/HotplugCdrom';
import { useVmHotplug } from './VmHotplug/useVmHotplug';
import './VmCreateWizard/InstanceWizard.css';

type Props = {
  open: boolean;
  cloudId: string;
  record: any | null;
  onClose: () => void;
  onOk: () => void;
  initialConfigType?: string;
};

const VmHotplugModal: React.FC<Props> = (props) => {
  const { 
    open, cloudId, record, onClose, onOk
  } = props;
  const { Text } = Typography;

  // 检查是否启用了CPU/内存热插拔，决定默认选中项
  const isHotPlugEnabled = useMemo(() => {
    const annotations = record?.metadata?.annotations || {};
    return annotations['harvesterhci.io/enableCPUAndMemoryHotplug']?.toLowerCase() === 'true';
  }, [record]);

  const {
    form,
    selectedKey, setSelectedKey,
    nads, vpcs, subnets,
    reloadNads, reloadVpcs, reloadSubnets,
    volumes, storageClasses,
    reloadVolumes, reloadStorageClasses,
    images, reloadImages,
    handleSubmit,
    hotUnpluggableNics,
    reloadHotUnpluggableNics,
    isHotplugSupported,
    isMigratable,
  } = useVmHotplug({
    ...props,
    initialConfigType: isHotPlugEnabled ? 'hotplug_cpu_memory' : 'hotplug_volume',
  });

  // 检查VM是否处于运行状态（所有热插拔功能的基本要求）
  const isVmRunning = useMemo(() => {
    return record?.status?.printableStatus === 'Running';
  }, [record]);

  const isArm = useMemo(() => {
    const architecture = record?.spec?.template?.spec?.domain?.machine?.type || '';
    return architecture.includes('arm') || architecture.includes('aarch64');
  }, [record]);

  const headerMeta = useMemo(() => {
    const base = {
      title: '热插拔操作',
      description: '在不重启虚拟机的情况下，动态调整资源与设备。部分操作需要虚拟机处于运行状态。',
      icon: <ThunderboltOutlined />,
    };

    switch (selectedKey) {
      case 'hotplug_cpu_memory':
        return {
          title: 'CPU/内存热插拔',
          description: isHotPlugEnabled
            ? '仅支持增加 CPU/内存，且不能超过上限；内存热插拔通常要求虚拟机可迁移。'
            : '当前虚拟机未启用 CPU/内存热插拔，可在资源变配中开启后再使用。',
          icon: <ThunderboltOutlined />,
        };
      case 'hotplug_volume':
        return {
          title: '数据盘热插拔',
          description: '为虚拟机添加/移除数据盘。建议使用支持热插拔的数据盘与总线类型。',
          icon: <HddOutlined />,
        };
      case 'hotplug_nic':
        return {
          title: '网卡热插拔',
          description: '为虚拟机添加/移除网卡。操作完成后请在系统内确认网卡状态与网络配置。',
          icon: <WifiOutlined />,
        };
      case 'hotplug_cdrom':
        return {
          title: '光盘更换',
          description: '插入/弹出/更换 CD-ROM 镜像。更换后请在系统内重新挂载或确认盘符。',
          icon: <CustomerServiceOutlined />,
        };
      default:
        return base;
    }
  }, [selectedKey, isHotPlugEnabled]);

  const vmStatusTag = useMemo(() => {
    const status = record?.status?.printableStatus || '-';
    const color =
      status === 'Running'
        ? 'success'
        : status === 'Stopped'
        ? 'default'
        : status === 'Starting' || status === 'Stopping'
        ? 'processing'
        : 'warning';
    return <Tag color={color}>{status}</Tag>;
  }, [record]);

  const supportTags = useMemo(() => {
    switch (selectedKey) {
      case 'hotplug_cpu_memory': {
        const cpuSupported = isVmRunning && isHotPlugEnabled && !isArm;
        const memorySupported = isVmRunning && isHotPlugEnabled && isMigratable;
        return (
          <Space size={8}>
            <Tag color={cpuSupported ? 'success' : 'warning'}>
              CPU热插拔{cpuSupported ? '可用' : '不可用'}
            </Tag>
            <Tag color={memorySupported ? 'success' : 'warning'}>
              内存热插拔{memorySupported ? '可用' : '不可用'}
            </Tag>
          </Space>
        );
      }
      case 'hotplug_nic': {
        return (
          <Tag color={isHotplugSupported ? 'success' : 'warning'}>
            网卡热插拔{isHotplugSupported ? '可用' : '不可用'}
          </Tag>
        );
      }
      case 'hotplug_volume': {
        return (
          <Tag color={isVmRunning ? 'success' : 'warning'}>
            数据盘热插拔{isVmRunning ? '可用' : '不可用'}
          </Tag>
        );
      }
      case 'hotplug_cdrom': {
        return (
          <Tag color={isVmRunning ? 'success' : 'warning'}>
            光盘更换{isVmRunning ? '可用' : '不可用'}
          </Tag>
        );
      }
      default:
        return null;
    }
  }, [selectedKey, isVmRunning, isHotPlugEnabled, isArm, isMigratable, isHotplugSupported]);

  /**
   * 左侧菜单项（平铺显示，无分组）：
   * - CPU/内存热插拔：调整CPU和内存（仅在启用热插拔时显示）
   * - 数据盘热插拔：添加/移除数据盘
   * - 网卡热插拔：添加/移除网卡
   * - 更换光盘：插入/弹出/更换CD-ROM光盘
   */
  const menuItems: MenuProps['items'] = [
    ...(isHotPlugEnabled ? [{
      key: 'hotplug_cpu_memory',
      label: 'CPU/内存热插拔',
    }] : []),
    {
      key: 'hotplug_volume',
      label: '数据盘热插拔',
    },
    {
      key: 'hotplug_nic',
      label: '网卡热插拔',
    },
    {
      key: 'hotplug_cdrom',
      label: '光盘更换',
    },
  ];

  // 动态渲染右侧内容区域
  const renderContent = () => {
    switch (selectedKey) {
      case 'hotplug_nic':
        return (
          <HotplugNic
            form={form}
            cloudId={cloudId}
            nads={nads}
            vpcs={vpcs}
            subnets={subnets}
            reloadNads={reloadNads}
            reloadVpcs={reloadVpcs}
            reloadSubnets={reloadSubnets}
            hotUnpluggableNics={hotUnpluggableNics}
            reloadHotUnpluggableNics={reloadHotUnpluggableNics}
            record={record}
            onSuccess={onOk}
          />
        );

      case 'hotplug_volume':
        return (
          <HotplugVolume
            form={form}
            cloudId={cloudId}
            volumes={volumes}
            storageClasses={storageClasses}
            reloadVolumes={reloadVolumes}
            reloadStorageClasses={reloadStorageClasses}
            record={record}
            onSuccess={onOk}
          />
        );

      case 'hotplug_cpu_memory':
        return (
          <HotplugCpuMemory
            form={form}
            cloudId={cloudId}
            record={record}
            onSuccess={onOk}
          />
        );

      case 'hotplug_cdrom':
        return (
          <HotplugCdrom
            form={form}
            cloudId={cloudId}
            record={record}
            images={images}
            reloadImages={reloadImages}
            onSuccess={onOk}
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

  // 底部按钮区域
  const footer = (
    <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8 }}>
      <Button onClick={onClose}>取消</Button>
      {(selectedKey === 'hotplug_nic' || selectedKey === 'hotplug_volume' || selectedKey === 'hotplug_cpu_memory' || selectedKey === 'hotplug_cdrom') ? (
        // 热插拔操作不需要统一的提交按钮，由子组件内部处理
        null
      ) : (
        <Button type="primary" onClick={handleSubmit}>
          提交
        </Button>
      )}
    </div>
  );

  if (!record) {
    return null;
  }

  return (
    <Modal
      zIndex={1001} // Ensure it is above the Detail Drawer (z-index 1000)
      title="热插拔操作"
      open={open}
      onCancel={onClose}
      footer={footer}
      width={900}
      styles={{ body: { padding: 0 } }}
      destroyOnClose
    >
      <div style={{ display: 'flex', height: '70vh' }}>
        {/* 左侧菜单 */}
        <div style={{ width: 200, overflowY: 'auto', marginRight: 24 }}>
          <Menu
            mode="inline"
            style={{ paddingInlineEnd: 0, borderInlineEnd: 0 }}
            selectedKeys={[selectedKey]}
            onClick={({ key }) => {
              setSelectedKey(String(key));
              form.resetFields();
            }}
            items={menuItems}
          />
        </div>

        {/* 右侧内容区域 */}
        <div
          style={{
            flex: 1,
            padding: 16,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            background: '#F5F7FA',
          }}
        >
          <Card
            size="small"
            title={
              <Space size={8}>
                {headerMeta.icon}
                <span>{headerMeta.title}</span>
              </Space>
            }
            extra={
              <Space size={8}>
                {vmStatusTag}
                <Tag color={isVmRunning ? 'success' : 'warning'}>{isVmRunning ? '运行中' : '非运行中'}</Tag>
                {supportTags}
                <Tag color={isMigratable ? 'success' : 'warning'}>{isMigratable ? '可迁移' : '不可迁移'}</Tag>
              </Space>
            }
            styles={{
              header: { background: '#FFFFFF' },
              body: { background: '#FFFFFF' },
            }}
            style={{
              borderRadius: 10,
              boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
              marginBottom: 12,
            }}
          >
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              <Text type="secondary">{headerMeta.description}</Text>
              <Text type="secondary">
                目标虚拟机：{record?.metadata?.name || '-'}
                {record?.metadata?.namespace ? `（${record?.metadata?.namespace}）` : ''}
              </Text>
            </Space>
          </Card>

          <div style={{ flex: 1, overflowY: 'auto', paddingRight: 4 }}>
            {renderContent()}
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default VmHotplugModal;
