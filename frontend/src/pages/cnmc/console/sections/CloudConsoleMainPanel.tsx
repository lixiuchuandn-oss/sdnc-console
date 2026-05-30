/**
 * Cloudmap 云主机控制台 — 主内容区（类目 + 资源二级导航，透传数据与各 Section）
 *
 * 数据由上层 `CloudConsole.tsx` 拉取后注入；本组件只负责导航与渲染子模块。
 */
import React, { useCallback, useEffect, useMemo } from 'react';
import { Empty } from 'antd';
import { useAuth } from '../../../../contexts/AuthContext';
import { useLicense } from '../../../../contexts/LicenseContext';
import { isSystemNamespace } from '../../../../utils/harvesterUtils';
import VmSection from '../../clouds/Harvester/ecs/sections/VmSection';
import RecycleBinSection from '../../clouds/Harvester/ecs/sections/RecycleBinSection';
import TemplatesSection from '../../clouds/Harvester/ecs/sections/TemplatesSection';
import SshKeysSection from '../../clouds/Harvester/ecs/sections/SshKeysSection';
import VolumesSection from '../../clouds/Harvester/ebs/sections/VolumesSection';
import ImagesSection from '../../clouds/Harvester/ecs/sections/ImagesSection';
import BackupsSection from '../../clouds/Harvester/cbr/sections/BackupsSection';
import ScheduleVmBackupsSection from '../../clouds/Harvester/cbr/sections/ScheduleVmBackupsSection';
import SnapshotsSection from '../../clouds/Harvester/ebs/sections/SnapshotsSection';
import CloudInitsSection from '../../clouds/Harvester/ecs/sections/CloudInitsSection';
import GpuSection from '../../clouds/Harvester/cluster/sections/GpusSection';
import EipSection from '../../clouds/Harvester/kube-ovn/sections/EipSection';
import SnatSection from '../../clouds/Harvester/kube-ovn/sections/SnatSection';
import DnatSection from '../../clouds/Harvester/kube-ovn/sections/DnatSection';
import VpcsSection from '../../clouds/Harvester/kube-ovn/sections/VpcsSection';
import UnderlaySubnetsSection from '../../clouds/Harvester/kube-ovn/sections/UnderlaySubnetsSection';
import type { BackupsSectionOnRefresh } from '../../clouds/Cloudmap/pool/loaders/backupsRefresh';
import {
  buildMainNavCategories,
  type NavCategory,
  type NavResource,
} from '../lib/tenantConsoleSiderNav';

/** 左侧导航决定的顶部类目范围：`host`=云主机/云盘/整机，`flat`/`vpc`=对应网络，`all`=不过滤（兼容旧用法） */
export type CloudConsoleLeftNavScope = 'host' | 'flat' | 'vpc' | 'all';

/**
 * CloudConsoleMainPanel Props
 */
interface Props {
  /** 与控制台左侧「产品」导航联动，过滤顶部 Tabs */
  leftNavScope?: CloudConsoleLeftNavScope;
  /** 主面板资源读权限（与 cloudmapPoolNavRows.poolPageAction 对齐） */
  canAccessMainResource?: (resourceKey: string) => boolean;
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
  backupsTabOnRefresh?: {
    backups: BackupsSectionOnRefresh;
    vm_snapshots: BackupsSectionOnRefresh;
    schedule_vm_backups: BackupsSectionOnRefresh;
  };
  onRefreshCloudInits?: () => void;
  onRefreshGpus?: () => void;
  onRefreshVpcs?: () => void;
  onRefreshEips?: (force?: boolean) => void;
  onRefreshSnatRules?: (force?: boolean) => void;
  onRefreshDnatRules?: (force?: boolean, silent?: boolean) => void;

  showYaml?: boolean;
}

const CloudConsoleMainPanel: React.FC<Props> = ({
  leftNavScope = 'all',
  canAccessMainResource,
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
  backupsTabOnRefresh,
  onRefreshCloudInits,
  onRefreshGpus,
  onRefreshVpcs,
  onRefreshEips,
  onRefreshSnatRules,
  onRefreshDnatRules,
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

  const fullTabConfig = useMemo((): NavCategory[] => buildMainNavCategories(ovnVpcEnabled), [ovnVpcEnabled]);

  const filterResourcesByPerm = useCallback(
    (resources: NavResource[]) => {
      if (!canAccessMainResource) return resources;
      return resources.filter((r) => canAccessMainResource(r.key));
    },
    [canAccessMainResource],
  );

  const tabConfig = useMemo((): NavCategory[] => {
    let scoped: NavCategory[];
    if (leftNavScope === 'all') scoped = fullTabConfig;
    else if (leftNavScope === 'host') {
      scoped = fullTabConfig.filter((c) => ['compute', 'storage', 'backup'].includes(c.key));
    } else if (leftNavScope === 'flat') {
      scoped = fullTabConfig.filter((c) => c.key === 'flatnet');
    } else if (leftNavScope === 'vpc') {
      scoped = fullTabConfig.filter((c) => c.key === 'vpc-net' || c.key === 'vpc-nat');
    } else scoped = fullTabConfig;

    if (!canAccessMainResource) return scoped;

    return scoped
      .map((cat) => ({
        ...cat,
        resources: filterResourcesByPerm(cat.resources),
      }))
      .filter((cat) => cat.resources.length > 0);
  }, [fullTabConfig, leftNavScope, canAccessMainResource, filterResourcesByPerm]);

  /** 左侧切换或过滤变化时，保证当前类目/资源仍存在于 tabConfig */
  useEffect(() => {
    if (tabConfig.length === 0) return;
    const keys = tabConfig.map((c) => c.key);
    if (!keys.includes(activeCategory)) {
      const first = tabConfig[0];
      setActiveCategory(first.key);
      setActiveResource(first.resources[0]?.key ?? '');
      return;
    }
    const cat = tabConfig.find((c) => c.key === activeCategory);
    if (cat && !cat.resources.some((r) => r.key === activeResource)) {
      setActiveResource(cat.resources[0]?.key ?? '');
    }
  }, [tabConfig, activeCategory, activeResource, setActiveCategory, setActiveResource]);

  useEffect(() => {
    if (!ovnVpcEnabled && (activeCategory === 'vpc-net' || activeCategory === 'vpc-nat' || activeCategory === 'vpc')) {
      if (tabConfig.length > 0) {
        setActiveCategory(tabConfig[0].key);
        setActiveResource(tabConfig[0].resources[0]?.key ?? '');
      }
    }
  }, [activeCategory, ovnVpcEnabled, tabConfig, setActiveCategory, setActiveResource]);

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

  const renderContent = useCallback(() => {
    if (canAccessMainResource && !canAccessMainResource(activeResource)) {
      return <Empty description="无权限访问该页面" />;
    }
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
            onStart={onStart}
            onStop={onStop}
            onReboot={onReboot}
            onSoftReboot={onSoftReboot}
            onPause={onPause}
            onUnpause={onUnpause}
            onDelete={onDelete}
            isTenant={isTenantUser}
            storageClasses={storageClasses}
            kubeSubnets={subnets}
            harvesterNads={harvesterNads}
            capabilities={harvesterCapabilities}
            onReloadQuickCreateSubnets={onRefreshVpcs}
            onReloadQuickCreateImages={onRefreshImages}
            onBackupsInventoryChanged={backupsTabOnRefresh?.backups}
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
            isTenant={isTenantUser}
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
          />
        );

      case 'snapshot':
        return (
          <BackupsSection
            backups={backups}
            loading={loading}
            onRefresh={backupsTabOnRefresh?.vm_snapshots}
            cloudId={cloudId}
            namespaces={namespaceObjects}
            vms={vms}
            type="snapshot"
            isTenant={isTenantUser}
          />
        );
      case 'backup':
        return (
          <BackupsSection
            backups={backups}
            loading={loading}
            onRefresh={backupsTabOnRefresh?.backups}
            cloudId={cloudId}
            namespaces={namespaceObjects}
            vms={vms}
            isTenant={isTenantUser}
          />
        );
      case 'schedule':
        return (
          <ScheduleVmBackupsSection
            data={schedules}
            loading={loading}
            onRefresh={backupsTabOnRefresh?.schedule_vm_backups}
            cloudId={cloudId}
            vms={vms}
            isTenant={isTenantUser}
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
    harvesterNads,
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
    backupsTabOnRefresh,
    onRefreshCloudInits,
    onRefreshGpus,
    onRefreshVpcs,
    onRefreshEips,
    onRefreshSnatRules,
    onRefreshDnatRules,
    showYaml,
    canAccessMainResource,
  ]);

  if (tabConfig.length === 0) {
    return (
      <div className="cloud-console-panel-root">
        <Empty
          description={
            leftNavScope === 'vpc' && !ovnVpcEnabled
              ? '当前未开通 VPC 网络能力，请在许可证中启用 network.ovn.vpc'
              : '当前账号无本区域页面读权限'
          }
        />
      </div>
    );
  }

  return <div className="cloud-console-panel-root">{renderContent()}</div>;
};

export default CloudConsoleMainPanel;
