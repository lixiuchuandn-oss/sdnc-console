/**
 * 集群 · 物理网络（Cloudmap `cluster/cluster_physical_network`）。
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Tabs } from 'antd';
import { useSearchParams } from 'react-router-dom';
import PageDetailSection from 'components/PageDetailSection';
import { CLOUD_PROVIDER_NETWORKS_READ } from 'constants/cloudPermissions';
import type { HarvesterSectionOnRefresh } from '../../ceph/lib/cephSectionRefresh';
import PhysicalSwitchesSection from './PhysicalSwitchesSection';
import ProviderNetworksSection from '../../kube-ovn/sections/ProviderNetworksSection';
import UnderlaySubnetsSection from '../../kube-ovn/sections/UnderlaySubnetsSection';
import VlansSection from '../../kube-ovn/sections/VlansSection';
import PhysicalNetworkStatusHero from './physicalNetwork/PhysicalNetworkStatusHero';
import {
  PHYSICAL_NETWORK_TAB_LOAD_KEY,
  parsePhysicalNetworkOperateTabKey,
  type PhysicalNetworkOperateTabKey,
} from './physicalNetwork/physicalNetworkUiConstants';

export type PhysicalNetworkSectionProps = {
  cloudId: string;
  checkPerm: (act: string) => boolean;
  canReadPublicSubnets: boolean;
  loadTabResource: (key: string, force?: boolean, skipSync?: boolean) => void | Promise<void>;
  providerNetworks: any[];
  vlans: any[];
  publicSubnetCount: number;
  providerNetworksLoading: boolean;
  vlansLoading: boolean;
  onRefreshProviderNetworks?: HarvesterSectionOnRefresh;
  onRefreshPublicSubnets?: HarvesterSectionOnRefresh;
  onRefreshVlans?: HarvesterSectionOnRefresh;
  initialOperateTab?: PhysicalNetworkOperateTabKey;
};

const PhysicalNetworkSection: React.FC<PhysicalNetworkSectionProps> = ({
  cloudId,
  checkPerm,
  canReadPublicSubnets,
  loadTabResource,
  providerNetworks,
  vlans,
  publicSubnetCount,
  providerNetworksLoading,
  vlansLoading,
  onRefreshProviderNetworks,
  onRefreshPublicSubnets,
  onRefreshVlans,
  initialOperateTab,
}) => {
  const canReadSwitches = checkPerm('clouds.cluster-networks:read');
  const canReadProviderNetworks = checkPerm(CLOUD_PROVIDER_NETWORKS_READ);
  const canReadVlans =
    checkPerm('clouds.vlans:read') || checkPerm(CLOUD_PROVIDER_NETWORKS_READ);
  const canRead =
    canReadSwitches || canReadProviderNetworks || canReadPublicSubnets || canReadVlans;

  const [searchParams] = useSearchParams();
  const operateTabFromQuery = parsePhysicalNetworkOperateTabKey(searchParams.get('operateTab'));
  const [operateTabKey, setOperateTabKey] = useState<PhysicalNetworkOperateTabKey>('switches');

  useEffect(() => {
    setOperateTabKey(initialOperateTab ?? operateTabFromQuery ?? 'switches');
  }, [cloudId, initialOperateTab, operateTabFromQuery]);

  const tabItems = useMemo(
    () =>
      [
        {
          key: 'switches' as const,
          label: '交换机',
          visible: canReadSwitches,
          children: <PhysicalSwitchesSection cloudId={cloudId} checkPerm={checkPerm} />,
        },
        {
          key: 'provider_networks' as const,
          label: '物理网络',
          visible: canReadProviderNetworks,
          children: (
            <ProviderNetworksSection
              cloudId={cloudId}
              parentNetworks={providerNetworks}
              parentVlans={vlans}
              parentLoading={providerNetworksLoading}
              onParentRefresh={onRefreshProviderNetworks}
            />
          ),
        },
        {
          key: 'public_subnets' as const,
          label: '公共子网',
          visible: canReadPublicSubnets,
          children: (
            <UnderlaySubnetsSection
              cloudId={cloudId}
              mode="public"
              onSubnetsChanged={() => void onRefreshPublicSubnets?.(true, true)}
            />
          ),
        },
        {
          key: 'vlans' as const,
          label: 'VLAN',
          visible: canReadVlans,
          children: (
            <VlansSection
              cloudId={cloudId}
              vlans={vlans}
              providerNetworks={providerNetworks}
              loading={vlansLoading}
              onRefresh={onRefreshVlans}
            />
          ),
        },
      ].filter((item) => item.visible),
    [
      canReadProviderNetworks,
      canReadPublicSubnets,
      canReadSwitches,
      canReadVlans,
      checkPerm,
      cloudId,
      onRefreshProviderNetworks,
      onRefreshPublicSubnets,
      onRefreshVlans,
      providerNetworks,
      providerNetworksLoading,
      vlans,
      vlansLoading,
    ],
  );

  useEffect(() => {
    if (!tabItems.some((item) => item.key === operateTabKey)) {
      setOperateTabKey((tabItems[0]?.key as PhysicalNetworkOperateTabKey) ?? 'switches');
    }
  }, [operateTabKey, tabItems]);

  useEffect(() => {
    const loadKey = PHYSICAL_NETWORK_TAB_LOAD_KEY[operateTabKey];
    if (!loadKey) return;
    void loadTabResource(loadKey, false);
  }, [cloudId, loadTabResource, operateTabKey]);

  const heroStats = useMemo(
    () => ({
      providerNetworkCount: providerNetworks?.length ?? 0,
      publicSubnetCount,
      vlanCount: vlans?.length ?? 0,
    }),
    [providerNetworks, publicSubnetCount, vlans],
  );

  if (!canRead) {
    return (
      <PageDetailSection contentPadding={16}>
        <Alert type="warning" showIcon message="无权限查看物理网络" />
      </PageDetailSection>
    );
  }

  return (
    <PageDetailSection contentPadding={16}>
      <PhysicalNetworkStatusHero
        loading={providerNetworksLoading || vlansLoading}
        stats={heroStats}
      />
      <Tabs
        activeKey={operateTabKey}
        onChange={(key) => setOperateTabKey(key as PhysicalNetworkOperateTabKey)}
        items={tabItems.map(({ key, label, children }) => ({ key, label, children }))}
      />
    </PageDetailSection>
  );
};

export default PhysicalNetworkSection;
