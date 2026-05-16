import React, { useEffect } from 'react';
import { Empty, message } from 'antd';
import NodesSection from '../../../../Harvester/cluster/sections/NodesSection';
import ServicesSection from '../../../../Harvester/cluster/sections/ServicesSection';
import ClusterNetworksSection from '../../../../Harvester/cluster/sections/ClusterNetworksSection';
import NadsSection from '../../../../Harvester/nad/sections/NadsSection';
import LoadBalancersSection from '../../../../Harvester/nad/sections/LoadBalancersSection';
import IPPoolsSection from '../../../../Harvester/nad/sections/IPPoolsSection';
import ProviderNetworksSection from '../../../../Harvester/kube-ovn/sections/ProviderNetworksSection';
import UnderlaySubnetsSection from '../../../../Harvester/kube-ovn/sections/UnderlaySubnetsSection';
import VlansSection from '../../../../Harvester/kube-ovn/sections/VlansSection';
import NamespacesTab from '../../../../Harvester/cluster/NamespacesTab';
import StorageClassesSection from '../../../../Harvester/cluster/sections/StorageClassesSection';
import CephPoolSection from '../../../../Harvester/ceph/sections/CephPoolSection';
import GpusSection from '../../../../Harvester/cluster/sections/GpusSection';
import UsbDevicesSection from '../../../../Harvester/cluster/sections/UsbDevicesSection';
import PciDevicesSection from '../../../../Harvester/cluster/sections/PciDevicesSection';
import PhysicalSwitchesSection from '../../../../Harvester/cluster/sections/PhysicalSwitchesSection';
import { fetchKubeOvnSubnets } from '../../api';
import { CLOUD_PROVIDER_NETWORKS_READ } from '../../../../../../../constants/cloudPermissions';
import { isValidCloudmapPoolInnerSeg } from '../../../../../../../layouts/admin/cloudmap/cloudPoolSidebar';
import { canReadContainerTab } from '../../../../../../../utils/permissionUtils';
import '../../styles/layout.css';

type ClusterSectionVisibleCtx = {
  checkPerm: (act: string) => boolean;
  canReadPublicSubnets: boolean;
  canReadNetworkScope: boolean;
  canReadLoadBalancers: boolean;
};

function isClusterSectionVisible(key: string, ctx: ClusterSectionVisibleCtx): boolean {
  const {
    checkPerm,
    canReadPublicSubnets,
    canReadNetworkScope,
    canReadLoadBalancers,
  } = ctx;
  switch (key) {
    case 'cluster_nodes':
      return (
        checkPerm('clouds.cluster-nodes:read') || checkPerm('clouds.ecs:read')
      );
    case 'cluster_physical_switches':
      return checkPerm('clouds.cluster-networks:read');
    case 'kubeovn_public_networks':
      return checkPerm(CLOUD_PROVIDER_NETWORKS_READ);
    case 'namespaces':
      return (
        checkPerm('clouds.namespaces:read') ||
        checkPerm('clouds:read') ||
        checkPerm('clouds.ecs:read')
      );
    case 'kubeovn_public_subnets':
      return canReadPublicSubnets;
    case 'cluster_vlans':
      return (
        checkPerm('clouds.vlans:read') || checkPerm(CLOUD_PROVIDER_NETWORKS_READ)
      );
    case 'gpu':
      return checkPerm('clouds.gpus:read') || checkPerm('clouds.ecs:read');
    case 'cluster_usb':
      return (
        checkPerm('clouds.usb-devices:read') || checkPerm('clouds.ecs:read')
      );
    case 'clusterNetworks':
      return checkPerm('clouds.cluster-networks:read');
    case 'cluster_services':
      return (
        checkPerm('clouds.cluster-services:read') ||
        checkPerm('clouds.services:read') ||
        canReadContainerTab(checkPerm, 'services') ||
        checkPerm('clouds:read')
      );
    case 'storage_pools':
      return (
        checkPerm('clouds.disks:read') ||
        checkPerm('clouds.cluster-nodes:read') ||
        checkPerm('clouds:read')
      );
    case 'storage_classes':
      return (
        checkPerm('clouds.storage-classes:read') ||
        checkPerm('clouds.ecs:read') ||
        checkPerm('clouds:read')
      );
    case 'nads':
      return canReadNetworkScope;
    case 'load_balancers':
      return canReadLoadBalancers;
    case 'ippools':
      return checkPerm('clouds.nads:read');
    case 'cluster_pci':
      return checkPerm('clouds.pci-devices:read');
    case 'cluster_sriov':
      return checkPerm('clouds.pci-devices:read');
    default:
      return false;
  }
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

export type CloudmapClusterTabsProps = {
  cloudId: string;
  isTenant: boolean;
  showLog: boolean;
  checkPerm: (act: string) => boolean;
  canReadPublicSubnets: boolean;
  canReadNetworkScope: boolean;
  canReadLoadBalancers: boolean;
  /** 当前子路径 `/cluster/<seg>`，与云主机等域一致，一屏一块资源 */
  innerActiveKey: string;
  loadTabResource: (
    key: string,
    force?: boolean,
    skipSync?: boolean,
  ) => Promise<void>;
  loadResource: (
    key: string,
    fn: () => Promise<any>,
    cb: (json: any) => void,
    force?: boolean,
  ) => Promise<void>;
  harvesterNodes: any[];
  nodesLoading: boolean;
  refreshNodes: (force?: boolean) => void | Promise<void>;
  rawNodes: any;
  harvesterServices: any[];
  rawServices: any;
  harvesterPods: any[];
  namespacesOptions: string[];
  nsFilter: string;
  setNsFilter: (v: string) => void;
  harvesterClusterNetworks: any[];
  rawClusterNetworks: any;
  harvesterNads: any[];
  nadsLoading: boolean;
  refreshNads: (force?: boolean, silent?: boolean) => Promise<void>;
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
  refreshVlans: (force?: boolean, skipSync?: boolean) => void | Promise<void>;
  harvesterNamespacesForManagement: any[];
  rawNamespaces: any;
  harvesterStorageClasses: any[];
  harvesterGpuResources: any[];
  rawGpu: any;
  harvesterUsbDevices: any[];
  rawUsbDevices: any;
  harvesterPciDevices: any[];
  rawPciDevices: any;
  aswSwitchSummary: any | null;
  cloudConfig: any | null;
  onReloadCloudMeta: () => Promise<void>;
  resourceLoading: Record<string, boolean>;
};

const CloudmapClusterTabs: React.FC<CloudmapClusterTabsProps> = (props) => {
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
    loadResource,
    harvesterNodes,
    nodesLoading,
    refreshNodes,
    rawNodes,
    harvesterServices,
    rawServices,
    harvesterPods,
    namespacesOptions,
    nsFilter,
    setNsFilter,
    harvesterClusterNetworks,
    rawClusterNetworks,
    harvesterNads,
    nadsLoading,
    refreshNads,
    rawNads,
    harvesterLoadBalancers,
    rawLoadBalancers,
    harvesterIPPools,
    rawIPPools,
    harvesterKubeOvnProviderNetworks,
    harvesterVlans,
    rawVlans,
    rawSubnets,
    setKubeOvnSubnets,
    setRawSubnets,
    refreshVlans,
    harvesterNamespacesForManagement,
    rawNamespaces,
    harvesterStorageClasses,
    harvesterGpuResources,
    rawGpu,
    harvesterUsbDevices,
    rawUsbDevices,
    harvesterPciDevices,
    rawPciDevices,
    aswSwitchSummary,
    cloudConfig,
    onReloadCloudMeta,
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
    void loadTabResource(section, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 门控对象按字段展开会冗长；与切换子路径/池一致即可
  }, [section, cloudId, loadTabResource]);

  const sectionBody = (seg: string): React.ReactNode => {
    switch (seg) {
      case 'cluster_nodes':
        return (
          <>
            <NodesSection
              nodes={harvesterNodes}
              loading={resourceLoading.nodes || nodesLoading}
              onRefresh={refreshNodes}
              cloudId={cloudId}
            />
            <DebugJSON data={rawNodes} show={showLog} />
          </>
        );
      case 'cluster_physical_switches':
        return (
          <>
            <PhysicalSwitchesSection
              cloudId={cloudId}
              cloudConfig={cloudConfig}
              checkPerm={checkPerm}
              onReloadCloudMeta={onReloadCloudMeta}
              summary={aswSwitchSummary}
              loading={!!resourceLoading.aswSwitches}
              onRefresh={() => void loadTabResource('cluster_physical_switches', true)}
            />
            <DebugJSON data={aswSwitchSummary} show={showLog} />
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
              onParentRefresh={(f, s) => {
                void loadTabResource('kubeovn_public_networks', f ?? false, s ?? false);
              }}
            />
            <DebugJSON data={rawSubnets} show={showLog} />
          </>
        );
      case 'namespaces':
        return (
          <NamespacesTab
            cloudId={cloudId}
            namespaces={harvesterNamespacesForManagement}
            loading={resourceLoading.namespaces}
            onRefresh={async (force = false, silent = false) => {
              await loadTabResource('namespaces', force, silent);
              if (force && !silent) {
                message.success('刷新成功');
              }
            }}
            showLog={showLog}
            raw={rawNamespaces}
            isTenant={isTenant}
          />
        );
      case 'kubeovn_public_subnets':
        return (
          <>
            <UnderlaySubnetsSection
              cloudId={cloudId}
              mode="public"
              onSubnetsChanged={() =>
                loadResource(
                  'subnets',
                  () => fetchKubeOvnSubnets(cloudId, true),
                  (json) => {
                    const list: any[] = (json as any)?.data?.items || [];
                    setKubeOvnSubnets(Array.isArray(list) ? list : []);
                    setRawSubnets(json || null);
                  },
                  true,
                )
              }
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
              onRefresh={refreshVlans}
            />
            <DebugJSON data={rawVlans} show={showLog} />
          </>
        );
      case 'gpu':
        return (
          <GpusSection
            cloudId={cloudId}
            resources={harvesterGpuResources}
            onRefresh={() => loadTabResource('gpu', true)}
            raw={rawGpu}
            showLog={showLog}
          />
        );
      case 'cluster_usb':
        return (
          <UsbDevicesSection
            cloudId={cloudId}
            usbDevices={harvesterUsbDevices}
            loading={resourceLoading.usbDevices}
            onRefresh={() => loadTabResource('cluster_usb', true)}
            raw={rawUsbDevices}
            showLog={showLog}
            bordered={false}
          />
        );
      case 'clusterNetworks':
        return (
          <>
            <ClusterNetworksSection
              cloudId={cloudId}
              clusterNetworks={harvesterClusterNetworks}
              loading={resourceLoading.clusterNetworks}
              onRefresh={() => loadTabResource('clusterNetworks', true)}
              isTenant={isTenant}
            />
            <DebugJSON data={rawClusterNetworks} show={showLog} />
          </>
        );
      case 'cluster_services':
        return (
          <>
            <ServicesSection
              cloudId={cloudId}
              services={harvesterServices}
              loading={resourceLoading.services}
              onRefresh={() => loadTabResource('cluster_services', true)}
              namespacesOptions={namespacesOptions}
              nsValue={nsFilter || undefined}
              onNsChange={(v) => setNsFilter(v || '')}
              pods={harvesterPods}
            />
            <DebugJSON data={rawServices} show={showLog} />
          </>
        );
      case 'storage_pools':
        return <CephPoolSection cloudId={cloudId} applicationsScope="cloud" />;
      case 'storage_classes':
        return (
          <>
            <StorageClassesSection
              cloudId={cloudId}
              storageClasses={harvesterStorageClasses}
              loading={resourceLoading.storageClasses}
              onRefresh={() => loadTabResource('storage_classes', true)}
            />
            <DebugJSON data={harvesterStorageClasses} show={showLog} />
          </>
        );
      case 'nads':
        return (
          <>
            <NadsSection
              nads={harvesterNads}
              loading={resourceLoading.nads || nadsLoading}
              onRefresh={refreshNads}
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
              onRefresh={() => loadTabResource('load_balancers', true)}
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
              onRefresh={() => loadTabResource('ippools', true)}
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
              onRefresh={() => loadTabResource('cluster_pci', true)}
              raw={rawPciDevices}
              showLog={showLog}
              bordered={false}
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
              onRefresh={() => loadTabResource('cluster_sriov', true)}
              raw={rawPciDevices}
              showLog={showLog}
              bordered={false}
              variant="sriov_vf"
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

  return (
    <div className="cloudmap-cluster-pane">
      <div className="cloudmap-cluster-section-body">{sectionBody(section)}</div>
    </div>
  );
};

export default CloudmapClusterTabs;
