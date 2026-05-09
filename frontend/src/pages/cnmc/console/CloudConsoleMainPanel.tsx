/**
 * Cloudmap 云主机控制台 — 主内容区（类目 + 资源二级导航，透传数据与各 Section）
 *
 * 数据由上层 `CloudConsole.tsx` 拉取后注入；本组件只负责导航与渲染子模块。
 */
import React, { useCallback, useEffect, useMemo } from 'react';
import { Tabs, Empty, Dropdown, Space } from 'antd';
import { CaretDownFilled } from '@ant-design/icons';
import { useAuth } from '../../../contexts/AuthContext';
import { useLicense } from '../../../contexts/LicenseContext';
import { isSystemNamespace } from '../../../utils/harvesterUtils';
import VmSection from '../clouds/Harvester/ecs/sections/VmSection';
import RecycleBinSection from '../clouds/Harvester/ecs/sections/RecycleBinSection';
import TemplatesSection from '../clouds/Harvester/ecs/sections/TemplatesSection';
import SshKeysSection from '../clouds/Harvester/ecs/sections/SshKeysSection';
import VolumesSection from '../clouds/Harvester/ebs/sections/VolumesSection';
import ImagesSection from '../clouds/Harvester/ecs/sections/ImagesSection';
import BackupsSection from '../clouds/Harvester/cbr/sections/BackupsSection';
import ScheduleVmBackupsSection from '../clouds/Harvester/cbr/sections/ScheduleVmBackupsSection';
import SnapshotsSection from '../clouds/Harvester/ebs/sections/SnapshotsSection';
import CloudInitsSection from '../clouds/Harvester/ecs/sections/CloudInitsSection';
import GpuSection from '../clouds/Harvester/cluster/sections/GpusSection';
import EipSection from '../clouds/Harvester/kube-ovn/sections/EipSection';
import SnatSection from '../clouds/Harvester/kube-ovn/sections/SnatSection';
import DnatSection from '../clouds/Harvester/kube-ovn/sections/DnatSection';
import VpcsSection from '../clouds/Harvester/kube-ovn/sections/VpcsSection';
import UnderlaySubnetsSection from '../clouds/Harvester/kube-ovn/sections/UnderlaySubnetsSection';

type NavResource = { key: string; label: string };

type NavCategory = {
  key: string;
  label: string;
  resources: NavResource[];
};

/** 左侧导航决定的顶部类目范围：`host`=云主机/云盘/整机，`flat`/`vpc`=对应网络，`all`=不过滤（兼容旧用法） */
export type CloudConsoleLeftNavScope = 'host' | 'flat' | 'vpc' | 'all';

/**
 * CloudConsoleMainPanel Props
 */
interface Props {
  /** 与控制台左侧「产品」导航联动，过滤顶部 Tabs */
  leftNavScope?: CloudConsoleLeftNavScope;
  cloudId: string;
  /** GET /resources/harvester/capabilities 的 data；与资源池详情页一致，供快速创建 VM（machine.type 等） */
  harvesterCapabilities?: any | null;
  vms: any[];
  templates: any[];
  sshKeys: any[];
  volumes?: any[];
  images?: any[];
  snapshots?: any[];
  backups?: any[];
  schedules?: any[];
  cloudInits?: any[];
  gpus?: any[];
  vpcs?: any[];
  subnets?: any[];
  /** NAD 列表：快速创建虚拟机判断扁平子网 Multus 是否就绪（勿长期传空数组） */
  harvesterNads?: any[];
  eips?: any[];
  snatRules?: any[];
  dnatRules?: any[];
  storageClasses?: any[];
  loading: boolean;

  activeCategory: string;
  setActiveCategory: (category: string) => void;
  activeResource: string;
  setActiveResource: (resource: string) => void;

  namespacesOptions: string[];
  namespaces?: any[];
  nodesOptions: string[];
  nsValue?: string;
  nodeValue?: string;
  onNsChange: (v?: string) => void;
  onNodeChange: (v?: string) => void;
  onRefreshVms: (force?: boolean) => void | Promise<void>;
  onOpenReconfigure: (vm: any) => void;
  onStart: (iid: string) => void;
  onStop: (iid: string) => void;
  onReboot: (iid: string) => void;
  onSoftReboot?: (iid: string) => void;
  onPause?: (iid: string) => void;
  onUnpause?: (iid: string) => void;
  onDelete: (iid: string, deleteImage?: boolean) => void;

  onRefreshTemplates: (force?: boolean) => void;
  onRefreshSshKeys: () => void;
  onRefreshVolumes?: () => void;
  onRefreshStorageClasses?: (force?: boolean, skipSync?: boolean) => void;
  onRefreshImages?: (force?: boolean) => void;
  onRefreshSnapshots?: () => void;
  onRefreshBackups?: () => void;
  onRefreshSchedules?: () => void;
  onRefreshCloudInits?: () => void;
  onRefreshGpus?: () => void;
  onRefreshVpcs?: () => void;
  onRefreshEips?: (force?: boolean) => void;
  onRefreshSnatRules?: (force?: boolean) => void;
  onRefreshDnatRules?: (force?: boolean, silent?: boolean) => void;

  bordered?: boolean;
  showYaml?: boolean;
}

const CloudConsoleMainPanel: React.FC<Props> = ({
  leftNavScope = 'all',
  cloudId,
  harvesterCapabilities = null,
  vms,
  templates,
  sshKeys,
  volumes = [],
  images = [],
  snapshots = [],
  backups = [],
  schedules = [],
  cloudInits = [],
  gpus = [],
  vpcs = [],
  subnets = [],
  harvesterNads = [],
  eips = [],
  snatRules = [],
  dnatRules = [],
  storageClasses = [],
  loading,

  activeCategory,
  setActiveCategory,
  activeResource,
  setActiveResource,

  namespacesOptions,
  namespaces,
  nodesOptions,
  nsValue,
  nodeValue,
  onNsChange,
  onNodeChange,
  onRefreshVms,
  onOpenReconfigure,
  onStart,
  onStop,
  onReboot,
  onSoftReboot,
  onPause,
  onUnpause,
  onDelete,
  onRefreshTemplates,
  onRefreshSshKeys,
  onRefreshVolumes,
  onRefreshStorageClasses,
  onRefreshImages,
  onRefreshSnapshots,
  onRefreshBackups,
  onRefreshSchedules,
  onRefreshCloudInits,
  onRefreshGpus,
  onRefreshVpcs,
  onRefreshEips,
  onRefreshSnatRules,
  onRefreshDnatRules,
  bordered = true,
  showYaml = true,
}) => {
  const { user } = useAuth();
  const { hasFeature } = useLicense();
  const ovnVpcEnabled = hasFeature('network.ovn.vpc');

  const isTenantUser = useMemo(() => {
    return user?.role === 'tenant' || !!user?.tenantId;
  }, [user]);

  const namespaceObjects = useMemo(() => {
    return namespacesOptions.map((ns) => ({ metadata: { name: ns } }));
  }, [namespacesOptions]);

  const filteredNamespaces = useMemo(() => {
    return (namespaces || []).filter((n: any) => {
      const name = n?.metadata?.name || n?.name || '';
      return name && !isSystemNamespace(name);
    });
  }, [namespaces]);

  const fullTabConfig = useMemo((): NavCategory[] => {
    const base: NavCategory[] = [
      {
        key: 'compute',
        label: '云主机',
        resources: [
          { key: 'vm', label: '实例' },
          { key: 'recycle-bin', label: '回收站' },
          { key: 'template', label: '模板' },
          { key: 'image', label: '镜像' },
          { key: 'ssh', label: 'SSH密钥' },
        ],
      },
      {
        key: 'storage',
        label: '云盘',
        resources: [
          { key: 'volume', label: '实例' },
          { key: 'volume-snapshot', label: '快照' },
        ],
      },
      {
        key: 'backup',
        label: '整机',
        resources: [
          { key: 'snapshot', label: '快照' },
          { key: 'backup', label: '备份' },
          { key: 'schedule', label: '定时策略' },
        ],
      },
      {
        key: 'flatnet',
        label: '扁平',
        resources: [{ key: 'flat-subnet', label: '子网' }],
      },
    ];
    if (ovnVpcEnabled) {
      base.push(
        {
          key: 'vpc-net',
          label: 'VPC',
          resources: [{ key: 'vpc-subnet', label: '网络' }],
        },
        {
          key: 'vpc-nat',
          label: 'NAT',
          resources: [
            { key: 'eip', label: 'EIP' },
            { key: 'snat', label: 'SNAT' },
            { key: 'dnat', label: 'DNAT' },
          ],
        },
      );
    }
    return base;
  }, [ovnVpcEnabled]);

  const tabConfig = useMemo((): NavCategory[] => {
    if (leftNavScope === 'all') return fullTabConfig;
    if (leftNavScope === 'host') {
      return fullTabConfig.filter((c) => ['compute', 'storage', 'backup'].includes(c.key));
    }
    if (leftNavScope === 'flat') {
      return fullTabConfig.filter((c) => c.key === 'flatnet');
    }
    if (leftNavScope === 'vpc') {
      return fullTabConfig.filter((c) => c.key === 'vpc-net' || c.key === 'vpc-nat');
    }
    return fullTabConfig;
  }, [fullTabConfig, leftNavScope]);

  /** 左侧切换或过滤变化时，保证当前类目仍存在于 tabConfig */
  useEffect(() => {
    if (tabConfig.length === 0) return;
    const keys = tabConfig.map((c) => c.key);
    if (!keys.includes(activeCategory)) {
      const first = tabConfig[0];
      setActiveCategory(first.key);
      setActiveResource(first.resources[0]?.key ?? '');
    }
  }, [tabConfig, activeCategory, setActiveCategory, setActiveResource]);

  useEffect(() => {
    if (!ovnVpcEnabled && (activeCategory === 'vpc-net' || activeCategory === 'vpc-nat' || activeCategory === 'vpc')) {
      setActiveCategory('compute');
      setActiveResource('vm');
    }
  }, [activeCategory, ovnVpcEnabled, setActiveCategory, setActiveResource]);

  /** 旧版单一 VPC 类目迁移为 VPC网络 / VPC NAT */
  useEffect(() => {
    if (activeCategory !== 'vpc') return;
    setActiveCategory('vpc-net');
    const next =
      activeResource === 'fip'
        ? 'eip'
        : ['vpc-subnet', 'eip', 'snat', 'dnat'].includes(activeResource)
          ? activeResource
          : 'vpc-subnet';
    setActiveResource(next);
  }, [activeCategory, activeResource, setActiveCategory, setActiveResource]);

  /** NAD/VLAN、SLB、地址池、扁平安全组 已从控制台目录下线，旧状态迁到「扁平 子网」 */
  useEffect(() => {
    if (
      activeResource === 'nad' ||
      activeResource === 'lb' ||
      activeResource === 'ippool' ||
      activeResource === 'flat-sg'
    ) {
      setActiveResource('flat-subnet');
    }
  }, [activeResource, setActiveResource]);

  const getDefaultResource = useCallback(
    (catKey: string) => {
      const cat = tabConfig.find((c) => c.key === catKey);
      return cat?.resources[0]?.key ?? '';
    },
    [tabConfig],
  );

  const renderContent = useCallback(() => {
    if (!ovnVpcEnabled && ['vpc-subnet', 'eip', 'snat', 'dnat'].includes(activeResource)) {
      return <Empty description="未授权" />;
    }
    switch (activeResource) {
      case 'vm':
        return (
          <VmSection
            vms={vms}
            images={images}
            volumes={volumes}
            loading={loading}
            namespacesOptions={namespacesOptions}
            namespaces={filteredNamespaces}
            nodesOptions={nodesOptions}
            cloudId={cloudId}
            nsValue={nsValue}
            nodeValue={nodeValue}
            onNsChange={onNsChange}
            onNodeChange={onNodeChange}
            onRefresh={onRefreshVms}
            onOpenReconfigure={onOpenReconfigure}
            onStart={onStart}
            onStop={onStop}
            onReboot={onReboot}
            onSoftReboot={onSoftReboot}
            onPause={onPause}
            onUnpause={onUnpause}
            onDelete={onDelete}
            isTenant={isTenantUser}
            bordered={bordered}
            storageClasses={storageClasses}
            kubeSubnets={subnets}
            harvesterNads={harvesterNads}
            capabilities={harvesterCapabilities}
            onReloadQuickCreateSubnets={onRefreshVpcs}
            onReloadQuickCreateImages={onRefreshImages}
          />
        );
      case 'recycle-bin':
        return (
          <RecycleBinSection
            vms={vms}
            loading={loading}
            cloudId={cloudId}
            onRefresh={onRefreshVms}
            namespaces={filteredNamespaces}
            volumes={volumes}
            images={images}
            isTenant={isTenantUser}
          />
        );
      case 'template':
        return (
          <TemplatesSection
            cloudId={cloudId}
            templates={templates}
            loading={loading}
            onRefresh={onRefreshTemplates}
            isTenant={isTenantUser}
            workspaceVmNamespace={isTenantUser ? nsValue : undefined}
            bordered={bordered}
          />
        );
      case 'ssh':
        return (
          <SshKeysSection
            cloudId={cloudId}
            sshKeys={sshKeys}
            loading={loading}
            onRefresh={onRefreshSshKeys}
            isTenant={isTenantUser}
            bordered={bordered}
          />
        );
      case 'cloudinit':
        return (
          <CloudInitsSection
            cloudId={cloudId}
            cloudInits={cloudInits}
            loading={loading}
            onRefresh={onRefreshCloudInits}
            isTenant={isTenantUser}
          />
        );
      case 'gpu':
        return (
          <GpuSection
            cloudId={cloudId}
            resources={gpus}
            loading={loading}
            onRefresh={onRefreshGpus || (() => Promise.resolve())}
          />
        );

      case 'volume':
        return (
          <VolumesSection
            volumes={volumes}
            loading={loading}
            onRefresh={onRefreshVolumes}
            onRefreshStorageClasses={onRefreshStorageClasses}
            cloudId={cloudId}
            vms={vms}
            storageClasses={storageClasses}
            namespacesOptions={namespacesOptions}
            isTenant={isTenantUser}
            bordered={bordered}
          />
        );
      case 'volume-snapshot':
        return (
          <SnapshotsSection
            snapshots={snapshots}
            loading={loading}
            onRefresh={onRefreshSnapshots}
            cloudId={cloudId}
            isTenant={isTenantUser}
            namespaces={namespaceObjects}
            bordered={bordered}
          />
        );
      case 'image':
        return (
          <ImagesSection
            images={images}
            loading={loading}
            onRefresh={onRefreshImages}
            cloudId={cloudId}
            vms={vms}
            isTenant={isTenantUser}
            bordered={bordered}
          />
        );

      case 'snapshot':
        return (
          <BackupsSection
            backups={backups}
            loading={loading}
            onRefresh={onRefreshBackups}
            cloudId={cloudId}
            namespaces={namespaceObjects}
            vms={vms}
            type="snapshot"
            isTenant={isTenantUser}
            bordered={bordered}
          />
        );
      case 'backup':
        return (
          <BackupsSection
            backups={backups}
            loading={loading}
            onRefresh={onRefreshBackups}
            cloudId={cloudId}
            namespaces={namespaceObjects}
            vms={vms}
            isTenant={isTenantUser}
            bordered={bordered}
          />
        );
      case 'schedule':
        return (
          <ScheduleVmBackupsSection
            data={schedules}
            loading={loading}
            onRefresh={onRefreshSchedules}
            cloudId={cloudId}
            vms={vms}
            isTenant={isTenantUser}
            bordered={bordered}
          />
        );

      case 'flat-subnet':
        return (
          <UnderlaySubnetsSection cloudId={cloudId} mode="flat" displayMode="standard" showYaml={showYaml} />
        );
      case 'vpc-subnet':
        return (
          <VpcsSection
            cloudId={cloudId}
            vpcs={vpcs}
            subnets={subnets}
            namespaces={filteredNamespaces}
            loading={loading}
            onRefresh={onRefreshVpcs}
            bordered={bordered}
            showYaml={showYaml}
          />
        );

      case 'eip':
        return (
          <EipSection
            cloudId={cloudId}
            networkScope="vpc"
            eips={eips}
            subnets={subnets}
            vpcs={vpcs}
            loading={loading}
            onRefresh={onRefreshEips || (() => {})}
            bordered={bordered}
          />
        );
      case 'snat':
        return (
          <SnatSection
            cloudId={cloudId}
            networkScope="vpc"
            snatRules={snatRules}
            eips={eips}
            vpcs={vpcs}
            subnets={subnets}
            loading={loading}
            onRefresh={onRefreshSnatRules || (() => {})}
            bordered={bordered}
          />
        );
      case 'dnat':
        return (
          <DnatSection
            cloudId={cloudId}
            networkScope="vpc"
            dnatRules={dnatRules}
            eips={eips}
            vpcs={vpcs}
            subnets={subnets}
            loading={loading}
            onRefresh={onRefreshDnatRules || (() => {})}
            bordered={bordered}
          />
        );
      default:
        return <Empty description="该功能暂未实现" />;
    }
  }, [
    ovnVpcEnabled,
    activeResource,
    harvesterCapabilities,
    vms,
    templates,
    sshKeys,
    volumes,
    images,
    snapshots,
    backups,
    schedules,
    cloudInits,
    gpus,
    vpcs,
    subnets,
    eips,
    snatRules,
    dnatRules,
    storageClasses,
    loading,
    cloudId,
    isTenantUser,
    namespacesOptions,
    namespaceObjects,
    filteredNamespaces,
    nodesOptions,
    nsValue,
    nodeValue,
    onNsChange,
    onNodeChange,
    onRefreshVms,
    onOpenReconfigure,
    onStart,
    onStop,
    onReboot,
    onSoftReboot,
    onPause,
    onUnpause,
    onDelete,
    onRefreshTemplates,
    onRefreshSshKeys,
    onRefreshVolumes,
    onRefreshStorageClasses,
    onRefreshImages,
    onRefreshSnapshots,
    onRefreshBackups,
    onRefreshSchedules,
    onRefreshCloudInits,
    onRefreshGpus,
    onRefreshVpcs,
    onRefreshEips,
    onRefreshSnatRules,
    onRefreshDnatRules,
    bordered,
    showYaml,
  ]);

  const tabItems = useMemo(() => {
    return tabConfig.map((cat) => {
      const isActive = cat.key === activeCategory;
      const currentResKey = isActive ? activeResource : cat.resources[0].key;
      const currentResLabel =
        cat.resources.find((r) => r.key === currentResKey)?.label ?? cat.resources[0].label;

      return {
        key: cat.key,
        label: (
          <Space size={4} align="center">
            <span>
              {cat.label} {currentResLabel}
            </span>
            <Dropdown
              menu={{
                items: cat.resources.map((res) => ({
                  key: res.key,
                  label: res.label,
                  onClick: (e: { domEvent: { stopPropagation: () => void } }) => {
                    e.domEvent.stopPropagation();
                    setActiveCategory(cat.key);
                    setActiveResource(res.key);
                  },
                })),
                selectedKeys: [isActive ? activeResource : ''],
              }}
              trigger={['click']}
            >
              <span onClick={(e) => e.stopPropagation()} className="cloud-console-main-panel-dropdown-trigger">
                <CaretDownFilled style={{ fontSize: 12 }} />
              </span>
            </Dropdown>
          </Space>
        ),
        children: <div>{isActive ? renderContent() : null}</div>,
      };
    });
  }, [tabConfig, activeCategory, activeResource, setActiveCategory, setActiveResource, renderContent]);

  if (tabConfig.length === 0) {
    return (
      <div className="cloud-console-panel-root">
        <Empty description="当前未开通 VPC 网络能力，请在许可证中启用 network.ovn.vpc" />
      </div>
    );
  }

  return (
    <div className="cloud-console-panel-root">
      <Tabs
        type="card"
        activeKey={activeCategory}
        onChange={(key) => {
          setActiveCategory(key);
          setActiveResource(getDefaultResource(key));
        }}
        items={tabItems}
      />
    </div>
  );
};

export { shouldMergePublicScenarioForTenantConsole } from './tenantConsolePaths';

export default CloudConsoleMainPanel;
