import React, { useEffect, useMemo } from 'react';
import { Empty } from 'antd';
import { createClusterTabOnRefresh } from '../../loaders/clusterRefresh';
import StorageClassesSection from '../../../../Harvester/cluster/sections/StorageClassesSection';
import UsbDevicesSection from '../../../../Harvester/cluster/sections/UsbDevicesSection';
import PciDevicesSection from '../../../../Harvester/cluster/sections/PciDevicesSection';
import NamespacesSection from '../../../../Harvester/cluster/sections/NamespacesSection';
import GpusSection from '../../../../Harvester/cluster/sections/GpusSection';
import ComputeClusterSection from '../../../../Harvester/cluster/sections/ComputeClusterSection';
import PhysicalNetworkSection from '../../../../Harvester/cluster/sections/PhysicalNetworkSection';
import PlatformNetworkSection from '../../../../Harvester/cluster/sections/PlatformNetworkSection';
import type { ComputeClusterOperateTabKey } from '../../../../Harvester/cluster/sections/computeCluster/computeClusterUiConstants';
import type { PhysicalNetworkOperateTabKey } from '../../../../Harvester/cluster/sections/physicalNetwork/physicalNetworkUiConstants';
import { legacyPhysicalNetworkOperateTab } from '../../../../Harvester/cluster/sections/physicalNetwork/physicalNetworkUiConstants';
import type { PlatformNetworkOperateTabKey } from '../../../../Harvester/cluster/sections/platformNetwork/platformNetworkUiConstants';
import { legacyPlatformNetworkOperateTab } from '../../../../Harvester/cluster/sections/platformNetwork/platformNetworkUiConstants';
import {
  isClusterCephPoolInnerSeg,
  isValidCloudmapPoolInnerSeg,
} from '../../../../../../../layouts/admin/cloudmap/cloudPoolSidebar';
import { canViewClusterSidebarLeaf } from '../../lib/clusterPageAccess';
import CloudmapUnifiedStorageRoutePanel from '../unified_storage';
import '../../styles/layout.css';

type ClusterSectionVisibleCtx = {
  checkPerm: (act: string) => boolean;
  canReadPublicSubnets: boolean;
  canReadNetworkScope: boolean;
  canReadLoadBalancers: boolean;
};

function isClusterSectionVisible(key: string, ctx: ClusterSectionVisibleCtx): boolean {
  return canViewClusterSidebarLeaf(key, ctx.checkPerm, ctx);
}

const DebugJSON: React.FC<{ data: any; show: boolean }> = ({ data, show }) => {
  if (!show) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <pre
        style={{
          background: '#f7f7f7',
          padding: 12,
          borderRadius: 8,
          maxHeight: 300,
          overflow: 'auto',
        }}
      >
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
};

export type CloudmapClusterRoutePanelProps = {
  cloudId: string;
  isTenant: boolean;
  showLog: boolean;
  checkPerm: (act: string) => boolean;
  canReadPublicSubnets: boolean;
  canReadNetworkScope: boolean;
  canReadLoadBalancers: boolean;
  /** 当前子路径 `/cluster/<seg>`，与云主机等域一致，一屏一块资源 */
  innerActiveKey: string;
  loadTabResource: (key: string, force?: boolean, skipSync?: boolean) => Promise<void>;
  loadResource: (
    key: string,
    fn: () => Promise<any>,
    cb: (json: any) => void,
    force?: boolean,
  ) => Promise<void>;
  harvesterNodes: any[];
  rawNodes: any;
  harvesterClusterNetworks: any[];
  rawClusterNetworks: any;
  harvesterNads: any[];
  rawNads: any;
  harvesterLoadBalancers: any[];
  rawLoadBalancers: any;
  harvesterIPPools: any[];
  rawIPPools: any;
  harvesterKubeOvnProviderNetworks: any[];
  harvesterVlans: any[];
  rawVlans: any;
  rawSubnets: any;
  setKubeOvnSubnets: (v: any[]) => void;
  setRawSubnets: (v: any) => void;
  harvesterNamespacesForManagement: any[];
  harvesterStorageClasses: any[];
  harvesterGpuResources: any[];
  rawGpu: any;
  harvesterUsbDevices: any[];
  rawUsbDevices: any;
  harvesterPciDevices: any[];
  rawPciDevices: any;
  cloudConfig: any | null;
  onReloadCloudMeta: () => Promise<void>;
  resourceLoading: Record<string, boolean>;
  /** 历史 compute_nodes / compute_drs_rules 等书签 → operateTab */
  initialComputeClusterTab?: ComputeClusterOperateTabKey;
  initialPhysicalNetworkTab?: PhysicalNetworkOperateTabKey;
  initialPlatformNetworkTab?: PlatformNetworkOperateTabKey;
};

function countPublicSubnetsFromRaw(rawSubnets: unknown): number {
  const items: any[] = Array.isArray((rawSubnets as any)?.data?.items)
    ? (rawSubnets as any).data.items
    : Array.isArray((rawSubnets as any)?.items)
      ? (rawSubnets as any).items
      : [];
  return items.length;
}

const CloudmapClusterRoutePanel: React.FC<CloudmapClusterRoutePanelProps> = (props) => {
  const {
    cloudId,
    isTenant,
    showLog,
    checkPerm,
    canReadPublicSubnets,
    canReadNetworkScope,
    canReadLoadBalancers,
    innerActiveKey,
    loadTabResource,
    harvesterNodes,
    rawNodes: _rawNodes,
    harvesterClusterNetworks,
    rawClusterNetworks: _rawClusterNetworks,
    harvesterNads,
    rawNads: _rawNads,
    harvesterLoadBalancers,
    rawLoadBalancers: _rawLoadBalancers,
    harvesterIPPools,
    rawIPPools: _rawIPPools,
    harvesterKubeOvnProviderNetworks,
    harvesterVlans,
    rawVlans: _rawVlans,
    rawSubnets,
    harvesterNamespacesForManagement,
    harvesterStorageClasses,
    harvesterGpuResources,
    rawGpu,
    harvesterUsbDevices,
    rawUsbDevices,
    harvesterPciDevices,
    rawPciDevices,
    resourceLoading,
    initialComputeClusterTab,
    initialPhysicalNetworkTab,
    initialPlatformNetworkTab,
  } = props;

  const visCtx = {
    checkPerm,
    canReadPublicSubnets,
    canReadNetworkScope,
    canReadLoadBalancers,
  };

  const section = innerActiveKey;

  useEffect(() => {
    if (!section) return;
    if (!isClusterSectionVisible(section, visCtx)) return;
    if (isClusterCephPoolInnerSeg(section)) return;
    void loadTabResource(section, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 门控对象按字段展开会冗长；与切换子路径/池一致即可
  }, [section, cloudId, loadTabResource]);

  const clusterTabOnRefresh = useMemo(() => {
    const deps = { loadTabResource };
    return {
      compute_cluster: createClusterTabOnRefresh('compute_nodes', deps),
      compute_nodes: createClusterTabOnRefresh('compute_nodes', deps),
      compute_projects: createClusterTabOnRefresh('compute_projects', deps),
      compute_drs_rules: createClusterTabOnRefresh('compute_drs_rules', deps),
      compute_migrations: createClusterTabOnRefresh('compute_migrations', deps),
      compute_gpu: createClusterTabOnRefresh('compute_gpu', deps),
      cluster_usb: createClusterTabOnRefresh('cluster_usb', deps),
      clusterNetworks: createClusterTabOnRefresh('clusterNetworks', deps),
      storage_classes: createClusterTabOnRefresh('storage_classes', deps),
      nads: createClusterTabOnRefresh('nads', deps),
      load_balancers: createClusterTabOnRefresh('load_balancers', deps),
      ippools: createClusterTabOnRefresh('ippools', deps),
      cluster_pci: createClusterTabOnRefresh('cluster_pci', deps),
      cluster_sriov: createClusterTabOnRefresh('cluster_sriov', deps),
      cluster_vlans: createClusterTabOnRefresh('cluster_vlans', deps),
      kubeovn_public_networks: createClusterTabOnRefresh('kubeovn_public_networks', deps),
      kubeovn_public_subnets: createClusterTabOnRefresh('kubeovn_public_subnets', deps),
    };
  }, [loadTabResource]);

  const sectionBody = (seg: string): React.ReactNode => {
    switch (seg) {
      case 'compute_cluster':
        return (
          <ComputeClusterSection
            cloudId={cloudId}
            checkPerm={checkPerm}
            nodes={harvesterNodes as any[]}
            nodesLoading={resourceLoading.nodes}
            nodesOnRefresh={clusterTabOnRefresh.compute_cluster}
            isTenant={isTenant}
            initialOperateTab={initialComputeClusterTab}
          />
        );
      case 'compute_nodes':
        return (
          <ComputeClusterSection
            cloudId={cloudId}
            checkPerm={checkPerm}
            nodes={harvesterNodes as any[]}
            nodesLoading={resourceLoading.nodes}
            nodesOnRefresh={clusterTabOnRefresh.compute_nodes}
            isTenant={isTenant}
            initialOperateTab="nodes"
          />
        );
      case 'compute_failure_domains':
        return (
          <ComputeClusterSection
            cloudId={cloudId}
            checkPerm={checkPerm}
            nodes={harvesterNodes as any[]}
            nodesLoading={resourceLoading.nodes}
            nodesOnRefresh={clusterTabOnRefresh.compute_nodes}
            isTenant={isTenant}
            initialOperateTab="failure_domains"
          />
        );
      case 'compute_deployment_sets':
        return (
          <ComputeClusterSection
            cloudId={cloudId}
            checkPerm={checkPerm}
            nodes={harvesterNodes as any[]}
            nodesLoading={resourceLoading.nodes}
            nodesOnRefresh={clusterTabOnRefresh.compute_nodes}
            isTenant={isTenant}
            initialOperateTab="deployment_sets"
          />
        );
      case 'compute_projects':
        return (
          <NamespacesSection
            cloudId={cloudId}
            namespaces={harvesterNamespacesForManagement as any[]}
            loading={resourceLoading.namespaces}
            onRefresh={clusterTabOnRefresh.compute_projects}
            isTenant={isTenant}
          />
        );
      case 'compute_drs_rules':
        return (
          <ComputeClusterSection
            cloudId={cloudId}
            checkPerm={checkPerm}
            nodes={harvesterNodes as any[]}
            nodesLoading={resourceLoading.nodes}
            nodesOnRefresh={clusterTabOnRefresh.compute_nodes}
            isTenant={isTenant}
            initialOperateTab="drs_rules"
          />
        );
      case 'compute_migrations':
        return (
          <ComputeClusterSection
            cloudId={cloudId}
            checkPerm={checkPerm}
            nodes={harvesterNodes as any[]}
            nodesLoading={resourceLoading.nodes}
            nodesOnRefresh={clusterTabOnRefresh.compute_nodes}
            isTenant={isTenant}
            initialOperateTab="migrations"
          />
        );
      case 'compute_gpu':
        return (
          <GpusSection
            cloudId={cloudId}
            resources={harvesterGpuResources}
            loading={resourceLoading.gpu}
            onRefresh={clusterTabOnRefresh.compute_gpu}
            raw={rawGpu}
            showLog={showLog}
            isTenant={isTenant}
          />
        );
      case 'cluster_physical_network':
      case 'cluster_physical_switches':
      case 'kubeovn_public_networks':
      case 'kubeovn_public_subnets':
      case 'cluster_vlans':
        return (
          <PhysicalNetworkSection
            cloudId={cloudId}
            checkPerm={checkPerm}
            canReadPublicSubnets={canReadPublicSubnets}
            loadTabResource={loadTabResource}
            providerNetworks={harvesterKubeOvnProviderNetworks}
            vlans={harvesterVlans}
            publicSubnetCount={countPublicSubnetsFromRaw(rawSubnets)}
            providerNetworksLoading={!!resourceLoading.providerNetworksTab}
            vlansLoading={!!resourceLoading.vlans}
            onRefreshProviderNetworks={clusterTabOnRefresh.kubeovn_public_networks}
            onRefreshPublicSubnets={clusterTabOnRefresh.kubeovn_public_subnets}
            onRefreshVlans={clusterTabOnRefresh.cluster_vlans}
            initialOperateTab={
              seg === 'cluster_physical_network'
                ? initialPhysicalNetworkTab
                : legacyPhysicalNetworkOperateTab(seg) ?? initialPhysicalNetworkTab
            }
          />
        );
      case 'cluster_usb':
        return (
          <UsbDevicesSection
            cloudId={cloudId}
            usbDevices={harvesterUsbDevices}
            loading={resourceLoading.usbDevices}
            onRefresh={clusterTabOnRefresh.cluster_usb}
            raw={rawUsbDevices}
            showLog={showLog}
            isTenant={isTenant}
          />
        );
      case 'cluster_platform_network':
      case 'clusterNetworks':
      case 'nads':
      case 'load_balancers':
      case 'ippools':
        return (
          <PlatformNetworkSection
            cloudId={cloudId}
            checkPerm={checkPerm}
            canReadNetworkScope={canReadNetworkScope}
            canReadLoadBalancers={canReadLoadBalancers}
            isTenant={isTenant}
            loadTabResource={loadTabResource}
            clusterNetworks={harvesterClusterNetworks}
            clusterNetworksLoading={!!resourceLoading.clusterNetworks}
            nads={harvesterNads}
            nadsLoading={!!resourceLoading.nads}
            loadBalancers={harvesterLoadBalancers}
            loadBalancersLoading={!!resourceLoading.loadBalancers}
            ippools={harvesterIPPools}
            ippoolsLoading={!!resourceLoading.ippools}
            onRefreshClusterNetworks={clusterTabOnRefresh.clusterNetworks}
            onRefreshNads={clusterTabOnRefresh.nads}
            onRefreshLoadBalancers={clusterTabOnRefresh.load_balancers}
            onRefreshIppools={clusterTabOnRefresh.ippools}
            initialOperateTab={
              seg === 'cluster_platform_network'
                ? initialPlatformNetworkTab
                : legacyPlatformNetworkOperateTab(seg) ?? initialPlatformNetworkTab
            }
          />
        );
      case 'storage_classes':
        return (
          <>
            <StorageClassesSection
              cloudId={cloudId}
              storageClasses={harvesterStorageClasses}
              loading={resourceLoading.storageClasses}
              onRefresh={clusterTabOnRefresh.storage_classes}
            />
            <DebugJSON data={harvesterStorageClasses} show={showLog} />
          </>
        );
      case 'cluster_pci':
        return (
          <>
            <PciDevicesSection
              cloudId={cloudId}
              devices={harvesterPciDevices}
              loading={resourceLoading.pciDevices}
              onRefresh={clusterTabOnRefresh.cluster_pci}
              raw={rawPciDevices}
              showLog={showLog}
              isTenant={isTenant}
            />
            <DebugJSON data={rawPciDevices} show={showLog} />
          </>
        );
      case 'cluster_sriov':
        return (
          <>
            <PciDevicesSection
              cloudId={cloudId}
              devices={harvesterPciDevices}
              loading={resourceLoading.pciDevices}
              onRefresh={clusterTabOnRefresh.cluster_sriov}
              raw={rawPciDevices}
              showLog={showLog}
              variant="sriov_vf"
              isTenant={isTenant}
            />
            <DebugJSON data={rawPciDevices} show={showLog} />
          </>
        );
      default:
        return <Empty description="未知区块" />;
    }
  };

  if (!section) {
    return (
      <div className="cloudmap-cluster-pane">
        <Empty description="加载中…" style={{ marginTop: 48 }} />
      </div>
    );
  }

  if (!isValidCloudmapPoolInnerSeg('cluster', section)) {
    return (
      <div className="cloudmap-cluster-pane">
        <Empty description="未知页面" style={{ marginTop: 48 }} />
      </div>
    );
  }

  if (!isClusterSectionVisible(section, visCtx)) {
    return (
      <div className="cloudmap-cluster-pane">
        <Empty description="无权限访问该页面" style={{ marginTop: 48 }} />
      </div>
    );
  }

  if (isClusterCephPoolInnerSeg(section)) {
    return (
      <div className="cloudmap-cluster-pane">
        <CloudmapUnifiedStorageRoutePanel
          cloudId={cloudId}
          checkPerm={checkPerm}
          innerActiveKey={section}
          loadTabResource={loadTabResource}
        />
      </div>
    );
  }

  return (
    <div className="cloudmap-cluster-pane">
      <div className="cloudmap-cluster-section-body">{sectionBody(section)}</div>
    </div>
  );
};

export default CloudmapClusterRoutePanel;
