/**
 * 集群 · 集群网络（Cloudmap `cluster/cluster_platform_network`）。
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Tabs } from 'antd';
import { useSearchParams } from 'react-router-dom';
import PageDetailSection from 'components/PageDetailSection';
import type { HarvesterSectionOnRefresh } from '../../ceph/lib/cephSectionRefresh';
import NetworksSection from './NetworksSection';
import NadsSection from '../../nad/sections/NadsSection';
import LoadBalancersSection from '../../nad/sections/LoadBalancersSection';
import IPPoolsSection from '../../nad/sections/IPPoolsSection';
import PlatformNetworkStatusHero from './platformNetwork/PlatformNetworkStatusHero';
import {
  PLATFORM_NETWORK_TAB_LOAD_KEY,
  parsePlatformNetworkOperateTabKey,
  type PlatformNetworkOperateTabKey,
} from './platformNetwork/platformNetworkUiConstants';

export type PlatformNetworkSectionProps = {
  cloudId: string;
  checkPerm: (act: string) => boolean;
  canReadNetworkScope: boolean;
  canReadLoadBalancers: boolean;
  isTenant?: boolean;
  loadTabResource: (key: string, force?: boolean, skipSync?: boolean) => void | Promise<void>;
  clusterNetworks: any[];
  clusterNetworksLoading: boolean;
  nads: any[];
  nadsLoading: boolean;
  loadBalancers: any[];
  loadBalancersLoading: boolean;
  ippools: any[];
  ippoolsLoading: boolean;
  onRefreshClusterNetworks?: HarvesterSectionOnRefresh;
  onRefreshNads?: HarvesterSectionOnRefresh;
  onRefreshLoadBalancers?: HarvesterSectionOnRefresh;
  onRefreshIppools?: HarvesterSectionOnRefresh;
  initialOperateTab?: PlatformNetworkOperateTabKey;
};

const PlatformNetworkSection: React.FC<PlatformNetworkSectionProps> = ({
  cloudId,
  checkPerm,
  canReadNetworkScope,
  canReadLoadBalancers,
  isTenant = false,
  loadTabResource,
  clusterNetworks,
  clusterNetworksLoading,
  nads,
  nadsLoading,
  loadBalancers,
  loadBalancersLoading,
  ippools,
  ippoolsLoading,
  onRefreshClusterNetworks,
  onRefreshNads,
  onRefreshLoadBalancers,
  onRefreshIppools,
  initialOperateTab,
}) => {
  const canReadClusterNetworks = checkPerm('clouds.cluster-networks:read');
  const canReadIppools = checkPerm('clouds.ip-pools:read');
  const canRead =
    canReadClusterNetworks || canReadNetworkScope || canReadLoadBalancers || canReadIppools;

  const [searchParams] = useSearchParams();
  const operateTabFromQuery = parsePlatformNetworkOperateTabKey(searchParams.get('operateTab'));
  const [operateTabKey, setOperateTabKey] = useState<PlatformNetworkOperateTabKey>('cluster_networks');

  useEffect(() => {
    setOperateTabKey(initialOperateTab ?? operateTabFromQuery ?? 'cluster_networks');
  }, [cloudId, initialOperateTab, operateTabFromQuery]);

  const tabItems = useMemo(
    () =>
      [
        {
          key: 'cluster_networks' as const,
          label: '集群网络',
          visible: canReadClusterNetworks,
          children: (
            <NetworksSection
              cloudId={cloudId}
              clusterNetworks={clusterNetworks}
              loading={clusterNetworksLoading}
              onRefresh={onRefreshClusterNetworks}
              isTenant={isTenant}
            />
          ),
        },
        {
          key: 'nads' as const,
          label: 'NAD 网络',
          visible: canReadNetworkScope,
          children: (
            <NadsSection
              nads={nads}
              loading={nadsLoading}
              onRefresh={onRefreshNads}
              cloudId={cloudId}
            />
          ),
        },
        {
          key: 'load_balancers' as const,
          label: '负载均衡',
          visible: canReadLoadBalancers,
          children: (
            <LoadBalancersSection
              cloudId={cloudId}
              loadBalancers={loadBalancers}
              loading={loadBalancersLoading}
              onRefresh={onRefreshLoadBalancers}
            />
          ),
        },
        {
          key: 'ippools' as const,
          label: 'IP 地址池',
          visible: canReadIppools,
          children: (
            <IPPoolsSection
              cloudId={cloudId}
              ippools={ippools}
              loading={ippoolsLoading}
              onRefresh={onRefreshIppools}
            />
          ),
        },
      ].filter((item) => item.visible),
    [
      canReadClusterNetworks,
      canReadIppools,
      canReadLoadBalancers,
      canReadNetworkScope,
      cloudId,
      clusterNetworks,
      clusterNetworksLoading,
      ippools,
      ippoolsLoading,
      isTenant,
      loadBalancers,
      loadBalancersLoading,
      nads,
      nadsLoading,
      onRefreshClusterNetworks,
      onRefreshIppools,
      onRefreshLoadBalancers,
      onRefreshNads,
    ],
  );

  useEffect(() => {
    if (!tabItems.some((item) => item.key === operateTabKey)) {
      setOperateTabKey((tabItems[0]?.key as PlatformNetworkOperateTabKey) ?? 'cluster_networks');
    }
  }, [operateTabKey, tabItems]);

  useEffect(() => {
    const loadKey = PLATFORM_NETWORK_TAB_LOAD_KEY[operateTabKey];
    if (!loadKey) return;
    void loadTabResource(loadKey, false);
  }, [cloudId, loadTabResource, operateTabKey]);

  const heroStats = useMemo(
    () => ({
      clusterNetworkCount: clusterNetworks?.length ?? 0,
      nadCount: nads?.length ?? 0,
      loadBalancerCount: loadBalancers?.length ?? 0,
      ipPoolCount: ippools?.length ?? 0,
    }),
    [clusterNetworks, ippools, loadBalancers, nads],
  );

  if (!canRead) {
    return (
      <PageDetailSection contentPadding={16}>
        <Alert type="warning" showIcon message="无权限查看集群网络" />
      </PageDetailSection>
    );
  }

  return (
    <PageDetailSection contentPadding={16}>
      <PlatformNetworkStatusHero
        loading={
          clusterNetworksLoading || nadsLoading || loadBalancersLoading || ippoolsLoading
        }
        stats={heroStats}
      />
      <Tabs
        activeKey={operateTabKey}
        onChange={(key) => setOperateTabKey(key as PlatformNetworkOperateTabKey)}
        items={tabItems.map(({ key, label, children }) => ({ key, label, children }))}
      />
    </PageDetailSection>
  );
};

export default PlatformNetworkSection;
