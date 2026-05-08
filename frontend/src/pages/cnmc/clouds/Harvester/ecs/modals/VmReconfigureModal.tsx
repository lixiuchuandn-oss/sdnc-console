/**
 * VmReconfigureModal.tsx
 *
 * 虚拟机资源变配模态框 (VM Reconfiguration Modal)
 *
 * 主要功能：
 * 1. 提供虚拟机规格变更、系统重装、磁盘与光盘管理等多种运维操作。
 * 2. 采用"单任务模式" (Single Task Mode)：
 *    - 左侧导航栏采用 Menu 单选模式，确保同一时间只能进行一种类型的变配操作。
 *    - 切换功能项时，自动重置表单，避免不同任务间的配置冲突。
 * 3. 左侧导航：分组无图标；侧栏与菜单样式见同目录 `VmReconfigureModal.css`。
 *
 * 右侧表单与底部按钮见 `VmReconfigure/VmReconfigureModalContent.tsx`、`VmReconfigureModalFooter.tsx`。
 */
import React, { useMemo } from 'react';
import { Alert, Form, Layout, Menu, Modal, Space, Tag, Tooltip } from 'antd';
import type { MenuProps } from 'antd';
import { LoadingOutlined, QuestionCircleOutlined } from '@ant-design/icons';

import { useVmReconfigure } from './VmReconfigure/useVmReconfigure';
import { getVmRootImageIdFromVm } from '../lib/vmImageStatus';
import { VmReconfigureModalContent } from './VmReconfigure/VmReconfigureModalContent';
import { VmReconfigureModalFooter } from './VmReconfigure/VmReconfigureModalFooter';
import './VmReconfigureModal.css';

const { Sider, Content: LayoutContent } = Layout;

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
  const { open, cloudId, record, onClose } = props;

  const {
    form,
    selectedKey,
    setSelectedKey,
    scs,
    images,
    gpuResources,
    selectedGpuKeys,
    setSelectedGpuKeys,
    usbResources,
    selectedUsbKeys,
    setSelectedUsbKeys,
    nads,
    vpcs,
    subnets,
    setVpcs,
    nodes,
    reloadNodes,
    gpuLoading,
    usbLoading,
    reloadScs,
    reloadImages,
    reloadGpuResources,
    reloadUsbResources,
    reloadNads,
    reloadVpcs,
    reloadSubnets,
    handleSubmit,
    systemDiskSize,
    systemDiskLoading,
    expandDiskCandidates,
    loadExpandDiskSize,
    getCurrentSpec,
    getMemoryInGi,
    isHotPlugEnabledOnVm,
    isHotPlugConfiguredOnVm,
    isRestartRequired,
    isHotPlugInProgress,
    latestVm,
    diskCreating,
    diskAttaching,
    handleCreateDisk,
    handleAttachDisk,
    cdromCreating,
    cdromAttaching,
    handleCreateCdrom,
    handleAttachCdrom,
    availableDiskPvcs,
    diskDetaching,
    handleDetachDisk,
    refreshVm,
  } = useVmReconfigure(props);

  const cpu = Form.useWatch('cpu', form);
  const memory = Form.useWatch('memory', form);
  const newDiskCreated = Form.useWatch('newDiskCreated', form);
  const newCdromCreated = Form.useWatch('newCdromCreated', form);
  const newDiskSource = Form.useWatch('newDiskSource', form);
  const changeOsConfirmed = Form.useWatch('changeOsConfirmed', form);

  const { cpu: currentCpuRaw, memory: currentMemoryRaw, maxSockets, maxMemory: maxMemoryRaw } = useMemo(() => {
    if (!getCurrentSpec) return { cpu: 0, memory: 0, maxSockets: undefined, maxMemory: undefined };
    return getCurrentSpec();
  }, [getCurrentSpec]);

  const currentCpu = Number(currentCpuRaw || 0);
  const currentMemory = getMemoryInGi(currentMemoryRaw);
  const maxMemory = maxMemoryRaw ? getMemoryInGi(maxMemoryRaw) : undefined;
  const architecture = record?.spec?.template?.spec?.architecture || record?.spec?.architecture;

  const isArm64Vm = useMemo(
    () => String(architecture || '').toLowerCase().includes('arm'),
    [architecture],
  );

  const currentOsImageId = useMemo(() => {
    const vm = latestVm || record;
    const rid = getVmRootImageIdFromVm(vm);
    return String(rid || '').trim() || undefined;
  }, [latestVm, record]);

  const currentOsImageResolvedLabel = useMemo(() => {
    const id = currentOsImageId || '';
    if (!id) return '';
    const hit = (images || []).find((x: any) => {
      const name = x?.metadata?.name || x?.name;
      const ns = x?.metadata?.namespace || x?.namespace;
      const v = ns && name ? `${ns}/${name}` : name;
      return v === id;
    });
    if (!hit) return id;
    const ann = hit?.metadata?.annotations || {};
    return String(
      hit?.spec?.displayName ||
        ann['field.cattle.io/displayName'] ||
        ann['harvesterhci.io/image-name'] ||
        hit?.metadata?.name ||
        id,
    );
  }, [currentOsImageId, images]);

  const isHotPlugConfiguredOnVmVal = isHotPlugConfiguredOnVm || false;
  const isHotPlugActiveOnVmVal = isHotPlugEnabledOnVm || false;

  const menuGroups = [
    {
      title: '资源配置',
      children: [
        { key: 'change_spec', label: '变更实例规格' },
        { key: 'hotplug_settings', label: '热扩容设置' },
        { key: 'cpu_advanced', label: '性能设置' },
        { key: 'vm_policy', label: '高可用设置' },
        { key: 'change_node_scheduling', label: '节点调度' },
        { key: 'change_node_affinity', label: '节点亲和性' },
      ],
    },
    {
      title: '系统与存储',
      children: [
        { key: 'change_os', label: '更换系统镜像' },
        { key: 'add_disk', label: '添加云硬盘' },
        { key: 'expand_disk', label: '云硬盘扩容' },
        { key: 'detach_disk', label: '解绑云硬盘' },
      ],
    },
    {
      title: '网络与设备',
      children: [
        { key: 'change_primary_nic', label: '变更主网卡' },
        { key: 'change_secondary_nic', label: '变更辅助网卡' },
        { key: 'change_gpu', label: '变更GPU' },
        { key: 'change_usb', label: '变更USB' },
      ],
    },
  ];

  const { alertMessage, okText } = useMemo(() => {
    let messageNode = null;
    let buttonText = '提交';

    if (selectedKey === 'change_spec') {
      if (!isHotPlugActiveOnVmVal) {
        buttonText = '提交（冷扩容）';
      } else {
        const limitCpu = maxSockets || currentCpu * 4;
        const limitMem = maxMemory || currentMemory * 4;

        const isOverLimit = (cpu !== undefined && cpu > limitCpu) || (memory !== undefined && memory > limitMem);
        const isInvalid = (cpu !== undefined && cpu < currentCpu) || (memory !== undefined && memory < currentMemory);

        if (isOverLimit || isInvalid) {
          buttonText = '提交（冷扩容）';
        } else {
          buttonText = '提交（热扩容）';
        }
      }
    }
    return { alertMessage: messageNode, okText: buttonText };
  }, [selectedKey, cpu, memory, currentCpu, currentMemory, isHotPlugActiveOnVmVal, maxSockets, maxMemory]);

  const footer = (
    <VmReconfigureModalFooter
      form={form}
      selectedKey={selectedKey}
      onClose={onClose}
      handleSubmit={handleSubmit}
      okText={okText}
      isHotPlugInProgress={isHotPlugInProgress}
      newDiskCreated={newDiskCreated}
      newCdromCreated={newCdromCreated}
      newDiskSource={newDiskSource}
      changeOsConfirmed={changeOsConfirmed}
      diskCreating={diskCreating}
      diskAttaching={diskAttaching}
      cdromCreating={cdromCreating}
      cdromAttaching={cdromAttaching}
      handleCreateDisk={handleCreateDisk}
      handleAttachDisk={handleAttachDisk}
      handleCreateCdrom={handleCreateCdrom}
      handleAttachCdrom={handleAttachCdrom}
    />
  );

  const renderTopAlert = () => {
    if (!isHotPlugInProgress) return null;
    return (
      <Alert
        type="warning"
        showIcon
        icon={<LoadingOutlined />}
        message="热扩容进行中"
        description="暂不可提交新的规格变更"
        style={{ marginBottom: 12 }}
        action={
          <Tooltip
            title={
              <div>
                <div>1. 当前虚拟机正在执行 CPU 或内存热扩容。</div>
                <div>2. 操作完成前禁止再次变配，避免后端并发失败。</div>
                <div>3. 可在详情页事件/状态中确认进度，必要时点击刷新。</div>
              </div>
            }
          >
            <QuestionCircleOutlined style={{ color: 'rgba(0,0,0,0.45)' }} />
          </Tooltip>
        }
      />
    );
  };

  return (
    <Modal
      zIndex={1001}
      title={
        <Space size={8} align="center">
          <span>资源变配</span>
          {isRestartRequired && <Tag color="warning" style={{ margin: 0 }}>需重启</Tag>}
          {isHotPlugInProgress && <Tag color="processing" style={{ margin: 0 }}>热扩容中</Tag>}
        </Space>
      }
      open={open}
      onCancel={onClose}
      footer={footer}
      width={900}
      styles={{ body: { padding: 0 } }}
    >
      <Layout style={{ minHeight: '70vh', height: '70vh', background: 'transparent' }}>
        <Sider
          theme="light"
          width={200}
          className="vm-reconfigure-sidebar-scroll"
          style={{ overflow: 'auto', marginRight: 24, height: '100%' }}
        >
          <Menu
            mode="inline"
            className="vm-reconfigure-sider-menu"
            style={{ paddingInlineEnd: 24 }}
            selectedKeys={[selectedKey]}
            onClick={({ key }) => setSelectedKey(String(key))}
            items={
              menuGroups.map((group, groupIndex) => ({
                key: `group_${groupIndex}`,
                type: 'group',
                label: group.title,
                children: group.children.map((child) => ({
                  key: child.key,
                  label: child.label,
                })),
              })) as MenuProps['items']
            }
          />
        </Sider>
        <Layout style={{ flex: 1, minWidth: 0, background: 'transparent' }}>
          <LayoutContent
            style={{
              display: 'flex',
              flexDirection: 'column',
              margin: 0,
              padding: 10,
              overflow: 'auto',
              background: 'transparent',
            }}
          >
          {renderTopAlert()}
          <div style={{ flex: 1, minHeight: 0 }}>
            <Form form={form} layout="vertical" wrapperCol={{ span: 24 }}>
              <VmReconfigureModalContent
                form={form}
                selectedKey={selectedKey}
                cloudId={cloudId}
                record={record}
                latestVm={latestVm}
                scs={scs}
                images={images}
                gpuResources={gpuResources}
                usbResources={usbResources}
                nads={nads}
                vpcs={vpcs}
                subnets={subnets}
                setVpcs={setVpcs}
                nodes={nodes}
                reloadNodes={reloadNodes}
                gpuLoading={gpuLoading}
                usbLoading={usbLoading}
                reloadScs={reloadScs}
                reloadImages={reloadImages}
                reloadGpuResources={reloadGpuResources}
                reloadUsbResources={reloadUsbResources}
                reloadNads={reloadNads}
                reloadVpcs={reloadVpcs}
                reloadSubnets={reloadSubnets}
                selectedGpuKeys={selectedGpuKeys}
                setSelectedGpuKeys={setSelectedGpuKeys}
                selectedUsbKeys={selectedUsbKeys}
                setSelectedUsbKeys={setSelectedUsbKeys}
                currentCpu={currentCpu}
                currentMemory={currentMemory}
                isHotPlugConfiguredOnVmVal={isHotPlugConfiguredOnVmVal}
                isRestartRequired={isRestartRequired}
                maxSockets={maxSockets}
                maxMemory={maxMemory}
                architecture={architecture}
                isHotPlugInProgress={isHotPlugInProgress}
                expandDiskCandidates={expandDiskCandidates}
                loadExpandDiskSize={loadExpandDiskSize}
                systemDiskSize={systemDiskSize}
                systemDiskLoading={systemDiskLoading}
                availableDiskPvcs={availableDiskPvcs}
                handleDetachDisk={handleDetachDisk}
                refreshVm={refreshVm}
                diskDetaching={diskDetaching}
                currentOsImageId={currentOsImageId}
                currentOsImageResolvedLabel={currentOsImageResolvedLabel}
                isArm64Vm={isArm64Vm}
              />
            </Form>
          </div>
          {alertMessage}
          </LayoutContent>
        </Layout>
      </Layout>
    </Modal>
  );
};

export default VmReconfigureModal;
