import React from 'react';
import { Tabs, Segmented, message } from 'antd';
import NodesSection from '../../../Harvester/cluster/sections/NodesSection';
import ServicesSection from '../../../Harvester/cluster/sections/ServicesSection';
import ClusterNetworksSection from '../../../Harvester/cluster/sections/ClusterNetworksSection';
import NadsSection from '../../../Harvester/nad/sections/NadsSection';
import LoadBalancersSection from '../../../Harvester/nad/sections/LoadBalancersSection';
import IPPoolsSection from '../../../Harvester/nad/sections/IPPoolsSection';
import ProviderNetworksSection from '../../../Harvester/kube-ovn/sections/ProviderNetworksSection';
import UnderlaySubnetsSection from '../../../Harvester/kube-ovn/sections/UnderlaySubnetsSection';
import VlansSection from '../../../Harvester/kube-ovn/sections/VlansSection';
import NamespacesTab from '../../../Harvester/cluster/NamespacesTab';
import StorageClassesSection from '../../../Harvester/cluster/sections/StorageClassesSection';
import GpusSection from '../../../Harvester/cluster/sections/GpusSection';
import UsbDevicesSection from '../../../Harvester/cluster/sections/UsbDevicesSection';
import PciDevicesSection from '../../../Harvester/cluster/sections/PciDevicesSection';
// 物理交换机（ASW-CTL）：实现放在 Harvester/cluster（ASW-CTL 在集群内以容器+Service 暴露 API，与节点/服务同属集群能力）；此处仅复用 Section。
import PhysicalSwitchesSection from '../../../Harvester/cluster/sections/PhysicalSwitchesSection';
import { fetchKubeOvnSubnets } from '../../runtime/api';
import {
  isCloudmapClusterMainTabVisible,
} from '../../cloudmapClusterTabVisibility';
import '../../cloudmap-cluster-inner-tabs.css';

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
  mode: 'standard' | 'ops';
  isTenant: boolean;
  showLog: boolean;
  checkPerm: (act: string) => boolean;
  canReadPublicSubnets: boolean;
  /** 受控：与 URL `cluster_sub`、父级状态同步，避免父级高频重渲染时 rc-tabs 失稳 */
  clusterInnerActiveKey: string;
  onClusterInnerTabChange: (key: string) => void;
  /** Cluster Info 内 Segmented 切换：同步 URL `cluster_segment` 并拉数 */
  onClusterInfoSegmentChange: (segmentKey: string) => void;
  clusterNetworkSegmentKey: string;
  clusterNetworkSegmentOptions: { value: string; label: string }[];
  handleTabChange: (key: string) => void;
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
  /** 资源池 config（物理交换机 Tab 内临时 ASW-CTL 配置） */
  cloudConfig: any | null;
  onReloadCloudMeta: () => Promise<void>;
  resourceLoading: Record<string, boolean>;
};

/**
 * =========================================================================
 * File: frontend/src/pages/cnmc/clouds/Cloudmap/tabs/cluster/index.tsx
 * Component: CloudmapClusterTabs
 * =========================================================================
 */
const CloudmapClusterTabs: React.FC<CloudmapClusterTabsProps> = (props) => {
  const {
    cloudId,
    mode,
    isTenant,
    showLog,
    checkPerm,
    canReadPublicSubnets,
    clusterInnerActiveKey,
    onClusterInnerTabChange,
    onClusterInfoSegmentChange,
    clusterNetworkSegmentKey,
    clusterNetworkSegmentOptions,
    handleTabChange,
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

  return (
    <Tabs
      type="line"
      destroyOnHidden
      rootClassName="cloudmap-cluster-inner-tabs"
      activeKey={clusterInnerActiveKey}
      onChange={(key) => onClusterInnerTabChange(key)}
      items={[
        {
          key: 'cluster_nodes',
          label: '物理节点',
          children: (
            <>
              <NodesSection
                nodes={harvesterNodes}
                loading={resourceLoading.nodes || nodesLoading}
                onRefresh={refreshNodes}
                cloudId={cloudId}
                mode={mode}
              />
              <DebugJSON data={rawNodes} show={showLog} />
            </>
          ),
        },
        {
          key: 'cluster_physical_switches',
          label: '物理交换机',
          children: (
            <>
              {/* ASW-CTL：实现见 Harvester/cluster/sections/PhysicalSwitchesSection；summary 来自父级 CloudDetailCloudmap */}
              <PhysicalSwitchesSection
                cloudId={cloudId}
                cloudConfig={cloudConfig}
                checkPerm={checkPerm}
                onReloadCloudMeta={onReloadCloudMeta}
                summary={aswSwitchSummary}
                loading={!!resourceLoading.aswSwitches}
                onRefresh={() =>
                  void loadTabResource('cluster_physical_switches', true)
                }
              />
              <DebugJSON data={aswSwitchSummary} show={showLog} />
            </>
          ),
        },
        {
          key: 'kubeovn_public_networks',
          label: '物理网络',
          children: (
            <>
              <ProviderNetworksSection
                cloudId={cloudId}
                mode={mode}
                parentNetworks={harvesterKubeOvnProviderNetworks}
                parentVlans={harvesterVlans}
                parentLoading={!!resourceLoading.providerNetworksTab}
                onParentRefresh={(f, s) => {
                  void loadTabResource(
                    'kubeovn_public_networks',
                    f ?? false,
                    s ?? false,
                  );
                }}
              />
              <DebugJSON data={rawSubnets} show={showLog} />
            </>
          ),
        },
        {
          key: 'namespaces',
          label: '命名空间',
          children: (
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
              mode={mode}
            />
          ),
        },
        {
          key: 'kubeovn_public_subnets',
          label: '公共子网',
          children: (
            <>
              <UnderlaySubnetsSection
                cloudId={cloudId}
                mode="public"
                displayMode={mode}
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
          ),
        },
        {
          key: 'cluster_vlans',
          label: 'VLANs',
          children: (
            <>
              <VlansSection
                cloudId={cloudId}
                vlans={harvesterVlans}
                providerNetworks={harvesterKubeOvnProviderNetworks}
                loading={resourceLoading.vlans}
                onRefresh={refreshVlans}
                mode={mode}
              />
              <DebugJSON data={rawVlans} show={showLog} />
            </>
          ),
        },
        {
          key: 'gpu',
          label: 'GPU',
          children: (
            <GpusSection
              cloudId={cloudId}
              resources={harvesterGpuResources}
              onRefresh={() => loadTabResource('gpu', true)}
              raw={rawGpu}
              showLog={showLog}
            />
          ),
        },
        {
          key: 'cluster_usb',
          label: 'USB',
          children: (
            <UsbDevicesSection
              cloudId={cloudId}
              usbDevices={harvesterUsbDevices}
              loading={resourceLoading.usbDevices}
              onRefresh={() => loadTabResource('usb_devices', true)}
              raw={rawUsbDevices}
              showLog={showLog}
              bordered={false}
            />
          ),
        },
        {
          key: 'clusterNetworks',
          label: 'Cluster Info',
          children: (
            <>
              <Segmented
                style={{ marginBottom: 12 }}
                options={clusterNetworkSegmentOptions}
                value={clusterNetworkSegmentKey}
                onChange={(value) =>
                  onClusterInfoSegmentChange(String(value))
                }
              />
              {clusterNetworkSegmentKey === 'clusterNetworks' && (
                <>
                  <ClusterNetworksSection
                    cloudId={cloudId}
                    clusterNetworks={harvesterClusterNetworks}
                    loading={resourceLoading.clusterNetworks}
                    onRefresh={() => loadTabResource('clusterNetworks', true)}
                    mode={mode}
                    isTenant={isTenant}
                  />
                  <DebugJSON data={rawClusterNetworks} show={showLog} />
                </>
              )}
              {clusterNetworkSegmentKey === 'cluster_services' && (
                <>
                  <ServicesSection
                    cloudId={cloudId}
                    services={harvesterServices}
                    loading={resourceLoading.services}
                    onRefresh={() => loadTabResource('services', true)}
                    namespacesOptions={namespacesOptions}
                    nsValue={nsFilter || undefined}
                    onNsChange={(v) => setNsFilter(v || '')}
                    pods={harvesterPods}
                    mode={mode}
                  />
                  <DebugJSON data={rawServices} show={showLog} />
                </>
              )}
              {clusterNetworkSegmentKey === 'storage_classes' && (
                <>
                  <StorageClassesSection
                    cloudId={cloudId}
                    storageClasses={harvesterStorageClasses}
                    loading={resourceLoading.storageClasses}
                    onRefresh={() => loadTabResource('storage_classes', true)}
                    mode={mode}
                  />
                  <DebugJSON data={harvesterStorageClasses} show={showLog} />
                </>
              )}
              {clusterNetworkSegmentKey === 'nads' && (
                <>
                  <NadsSection
                    nads={harvesterNads}
                    loading={resourceLoading.nads || nadsLoading}
                    onRefresh={refreshNads}
                    cloudId={cloudId}
                    mode={mode}
                  />
                  <DebugJSON data={rawNads} show={showLog} />
                </>
              )}
              {clusterNetworkSegmentKey === 'load_balancers' && (
                <>
                  <LoadBalancersSection
                    cloudId={cloudId}
                    loadBalancers={harvesterLoadBalancers}
                    loading={resourceLoading.loadBalancers}
                    onRefresh={() => loadTabResource('load_balancers', true)}
                    mode={mode}
                  />
                  <DebugJSON data={rawLoadBalancers} show={showLog} />
                </>
              )}
              {clusterNetworkSegmentKey === 'ippools' && (
                <>
                  <IPPoolsSection
                    cloudId={cloudId}
                    ippools={harvesterIPPools}
                    loading={resourceLoading.ippools}
                    onRefresh={() => loadTabResource('ippools', true)}
                    mode={mode}
                  />
                  <DebugJSON data={rawIPPools} show={showLog} />
                </>
              )}
              {clusterNetworkSegmentKey === 'cluster_pci' && (
                <>
                  <PciDevicesSection
                    cloudId={cloudId}
                    devices={harvesterPciDevices}
                    loading={resourceLoading.pciDevices}
                    onRefresh={() => loadTabResource('pci_devices', true)}
                    raw={rawPciDevices}
                    showLog={showLog}
                    bordered={false}
                  />
                  <DebugJSON data={rawPciDevices} show={showLog} />
                </>
              )}
            </>
          ),
        },
      ].filter((i: any) =>
        isCloudmapClusterMainTabVisible(i.key, {
          checkPerm,
          canReadPublicSubnets,
          clusterNetworkSegmentOptionsLength: clusterNetworkSegmentOptions.length,
        }),
      )}
    />
  );
};

export default CloudmapClusterTabs;
