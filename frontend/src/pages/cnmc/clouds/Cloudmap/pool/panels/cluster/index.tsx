import React, { useEffect, useMemo } from 'react';
import { Empty } from 'antd';
import { createClusterTabOnRefresh } from '../../loaders/clusterRefresh';
import NodesSection from '../../../../Harvester/cluster/sections/NodesSection';
import NetworksSection from '../../../../Harvester/cluster/sections/NetworksSection';
import NadsSection from '../../../../Harvester/nad/sections/NadsSection';
import LoadBalancersSection from '../../../../Harvester/nad/sections/LoadBalancersSection';
import IPPoolsSection from '../../../../Harvester/nad/sections/IPPoolsSection';
import ProviderNetworksSection from '../../../../Harvester/kube-ovn/sections/ProviderNetworksSection';
import UnderlaySubnetsSection from '../../../../Harvester/kube-ovn/sections/UnderlaySubnetsSection';
import VlansSection from '../../../../Harvester/kube-ovn/sections/VlansSection';
import NamespacesSection from '../../../../Harvester/cluster/sections/NamespacesSection';
import StorageClassesSection from '../../../../Harvester/cluster/sections/StorageClassesSection';
import GpusSection from '../../../../Harvester/cluster/sections/GpusSection';
import UsbDevicesSection from '../../../../Harvester/cluster/sections/UsbDevicesSection';
import PciDevicesSection from '../../../../Harvester/cluster/sections/PciDevicesSection';
import PhysicalSwitchesSection from '../../../../Harvester/cluster/sections/PhysicalSwitchesSection';
import DrsSection from '../../../../Harvester/cluster/sections/DrsSection';
import FailureDomainSection from '../../../../Harvester/cluster/sections/FailureDomainSection';
import StorageDrsSection from '../../../../Harvester/cluster/sections/StorageDrsSection';
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
};

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
    rawNodes,
    harvesterClusterNetworks,
    rawClusterNetworks,
    harvesterNads,
    rawNads,
    harvesterLoadBalancers,
    rawLoadBalancers,
    harvesterIPPools,
    rawIPPools,
    harvesterKubeOvnProviderNetworks,
    harvesterVlans,
    rawVlans,
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
      cluster_nodes: createClusterTabOnRefresh('cluster_nodes', deps),
      namespaces: createClusterTabOnRefresh('namespaces', deps),
      gpu: createClusterTabOnRefresh('gpu', deps),
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
      case 'cluster_nodes':
        return (
          <>
            <NodesSection
              nodes={harvesterNodes}
              loading={resourceLoading.nodes}
              onRefresh={clusterTabOnRefresh.cluster_nodes}
              cloudId={cloudId}
              isTenant={isTenant}
              checkPerm={checkPerm}
            />
            <DebugJSON data={rawNodes} show={showLog} />
          </>
        );
      case 'cluster_physical_switches':
        return (
          <>
            <PhysicalSwitchesSection cloudId={cloudId} checkPerm={checkPerm} />
          </>
        );
      case 'kubeovn_public_networks':
        return (
          <>
            <ProviderNetworksSection
              cloudId={cloudId}
              parentNetworks={harvesterKubeOvnProviderNetworks}
              parentVlans={harvesterVlans}
              parentLoading={!!resourceLoading.providerNetworksTab}
              onParentRefresh={clusterTabOnRefresh.kubeovn_public_networks}
            />
            <DebugJSON data={rawSubnets} show={showLog} />
          </>
        );
      case 'namespaces':
        return (
          <NamespacesSection
            cloudId={cloudId}
            namespaces={harvesterNamespacesForManagement}
            loading={resourceLoading.namespaces}
            onRefresh={clusterTabOnRefresh.namespaces}
            isTenant={isTenant}
          />
        );
      case 'drs':
        return <DrsSection cloudId={cloudId} checkPerm={checkPerm} isTenant={isTenant} />;
      case 'failure_domains':
        return <FailureDomainSection cloudId={cloudId} checkPerm={checkPerm} />;
      case 'storage_drs':
        return <StorageDrsSection cloudId={cloudId} checkPerm={checkPerm} />;
      case 'kubeovn_public_subnets':
        return (
          <>
            <UnderlaySubnetsSection
              cloudId={cloudId}
              mode="public"
              onSubnetsChanged={() => void clusterTabOnRefresh.kubeovn_public_subnets(true, true)}
            />
            <DebugJSON data={rawSubnets} show={showLog} />
          </>
        );
      case 'cluster_vlans':
        return (
          <>
            <VlansSection
              cloudId={cloudId}
              vlans={harvesterVlans}
              providerNetworks={harvesterKubeOvnProviderNetworks}
              loading={resourceLoading.vlans}
              onRefresh={clusterTabOnRefresh.cluster_vlans}
            />
            <DebugJSON data={rawVlans} show={showLog} />
          </>
        );
      case 'gpu':
        return (
          <GpusSection
            cloudId={cloudId}
            resources={harvesterGpuResources}
            loading={resourceLoading.gpu}
            onRefresh={clusterTabOnRefresh.gpu}
            raw={rawGpu}
            showLog={showLog}
            isTenant={isTenant}
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
      case 'clusterNetworks':
        return (
          <>
            <NetworksSection
              cloudId={cloudId}
              clusterNetworks={harvesterClusterNetworks}
              loading={resourceLoading.clusterNetworks}
              onRefresh={clusterTabOnRefresh.clusterNetworks}
              isTenant={isTenant}
            />
            <DebugJSON data={rawClusterNetworks} show={showLog} />
          </>
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
      case 'nads':
        return (
          <>
            <NadsSection
              nads={harvesterNads}
              loading={resourceLoading.nads}
              onRefresh={clusterTabOnRefresh.nads}
              cloudId={cloudId}
            />
            <DebugJSON data={rawNads} show={showLog} />
          </>
        );
      case 'load_balancers':
        return (
          <>
            <LoadBalancersSection
              cloudId={cloudId}
              loadBalancers={harvesterLoadBalancers}
              loading={resourceLoading.loadBalancers}
              onRefresh={clusterTabOnRefresh.load_balancers}
            />
            <DebugJSON data={rawLoadBalancers} show={showLog} />
          </>
        );
      case 'ippools':
        return (
          <>
            <IPPoolsSection
              cloudId={cloudId}
              ippools={harvesterIPPools}
              loading={resourceLoading.ippools}
              onRefresh={clusterTabOnRefresh.ippools}
            />
            <DebugJSON data={rawIPPools} show={showLog} />
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
