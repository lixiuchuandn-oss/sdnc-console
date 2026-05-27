/**
 * Cloudmap 详情 — Kube-OVN / VPC 网络：侧栏路径驱动，刷新经 `kubeOvnRefresh` → `loadTabResource`。
 */
import React, { useEffect, useMemo } from 'react';
import { Empty } from 'antd';
import KubeOvnVpcsSection from '../../../../Harvester/kube-ovn/sections/VpcsSection';
import VpcSubnetsSection from '../../../../Harvester/kube-ovn/sections/VpcSubnetsSection';
import EipSection from '../../../../Harvester/kube-ovn/sections/EipSection';
import SnatSection from '../../../../Harvester/kube-ovn/sections/SnatSection';
import DnatSection from '../../../../Harvester/kube-ovn/sections/DnatSection';
import { createKubeOvnTabOnRefresh } from '../../loaders/kubeOvnRefresh';
import { fetchKubeOvnVpcs } from '../../api';
import type { HarvesterSectionOnRefresh } from '../../../../Harvester/kube-ovn/lib/kubeOvnSectionRefresh';

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

export type CloudmapKubeOvnRoutePanelProps = {
  cloudId: string;
  showLog: boolean;
  checkPerm: (act: string) => boolean;
  ovnVpcEnabled: boolean;
  canReadVpcSubnets: boolean;
  innerActiveKey: string;
  loadResource: (
    key: string,
    fn: () => Promise<any>,
    cb: (json: any) => void,
    force?: boolean,
  ) => Promise<void>;
  loadTabResource: (
    key: string,
    force?: boolean,
    skipSync?: boolean,
  ) => Promise<void>;
  kubeOvnVpcs: any[];
  setKubeOvnVpcs: (v: any[]) => void;
  setRawVpcs: (v: any) => void;
  kubeOvnSubnets: any[];
  setKubeOvnSubnets: (v: any[]) => void;
  setRawSubnets: (v: any) => void;
  kubeOvnEips: any[];
  kubeOvnSnatRules: any[];
  setKubeOvnSnatRules: (v: any[]) => void;
  setRawSnatRules: (v: any) => void;
  kubeOvnDnatRules: any[];
  setKubeOvnDnatRules: (v: any[]) => void;
  setRawDnatRules: (v: any) => void;
  resourceLoading: Record<string, boolean>;
  rawVpcs: any;
  rawSubnets: any;
  rawEips: any;
  rawSnatRules: any;
  rawDnatRules: any;
};

function canViewKubeOvnInner(
  key: string,
  checkPerm: (a: string) => boolean,
  canReadVpcSubnets: boolean,
): boolean {
  if (key === 'subnets')
    return canReadVpcSubnets || checkPerm('clouds:read');
  if (key === 'vpcs') {
    return (
      checkPerm('clouds.vpcs:read') ||
      canReadVpcSubnets ||
      checkPerm('clouds:read')
    );
  }
  if (key === 'kubeovn_eips') {
    return checkPerm('clouds.eips.vpc:read') || checkPerm('clouds:read');
  }
  if (key === 'kubeovn_fips') return false;
  if (key === 'kubeovn_snat') {
    return checkPerm('clouds.snat.vpc:read') || checkPerm('clouds:read');
  }
  if (key === 'kubeovn_dnat') {
    return checkPerm('clouds.dnat.vpc:read') || checkPerm('clouds:read');
  }
  return checkPerm('clouds:read');
}

const KUBE_OVN_TABS_REQUIRE_VPC_LICENSE = new Set([
  'vpcs',
  'subnets',
  'kubeovn_eips',
  'kubeovn_snat',
  'kubeovn_dnat',
]);

const CloudmapKubeOvnRoutePanel: React.FC<CloudmapKubeOvnRoutePanelProps> = (
  props,
) => {
  const {
    cloudId,
    showLog,
    checkPerm,
    ovnVpcEnabled,
    canReadVpcSubnets,
    innerActiveKey,
    loadResource,
    loadTabResource,
    kubeOvnVpcs,
    setKubeOvnVpcs,
    setRawVpcs,
    kubeOvnSubnets,
    setKubeOvnSubnets,
    setRawSubnets,
    kubeOvnEips,
    kubeOvnSnatRules,
    kubeOvnDnatRules,
    resourceLoading,
    rawVpcs,
    rawSubnets,
    rawEips,
    rawSnatRules,
    rawDnatRules,
  } = props;

  const kubeOvnTabRefreshDeps = useMemo(
    () => ({
      loadTabResource,
      ovnVpcEnabled,
      refreshVpcsAllScope: async (force: boolean, skipSync: boolean) => {
        await loadResource(
          'vpcs',
          () => fetchKubeOvnVpcs(cloudId, force, skipSync, 'all'),
          (json) => {
            setKubeOvnVpcs((json as any)?.data?.items || []);
            setRawVpcs(json || null);
          },
          true,
        );
      },
    }),
    [cloudId, loadResource, loadTabResource, ovnVpcEnabled, setKubeOvnVpcs, setRawVpcs],
  );

  const kubeOvnTabOnRefresh = useMemo(
    () => ({
      vpcs: createKubeOvnTabOnRefresh('vpcs', kubeOvnTabRefreshDeps),
      subnets: createKubeOvnTabOnRefresh('subnets', kubeOvnTabRefreshDeps),
      kubeovn_eips: createKubeOvnTabOnRefresh('kubeovn_eips', kubeOvnTabRefreshDeps),
      kubeovn_snat: createKubeOvnTabOnRefresh('kubeovn_snat', kubeOvnTabRefreshDeps),
      kubeovn_dnat: createKubeOvnTabOnRefresh('kubeovn_dnat', kubeOvnTabRefreshDeps),
    }),
    [kubeOvnTabRefreshDeps],
  );

  useEffect(() => {
    const key = innerActiveKey as keyof typeof kubeOvnTabOnRefresh;
    if (key in kubeOvnTabOnRefresh) {
      void loadTabResource(innerActiveKey, false);
    }
  }, [innerActiveKey, cloudId, loadTabResource, kubeOvnTabOnRefresh]);

  if (!canViewKubeOvnInner(innerActiveKey, checkPerm, canReadVpcSubnets)) {
    return <Empty description="无权限访问" style={{ marginTop: 48 }} />;
  }

  if (KUBE_OVN_TABS_REQUIRE_VPC_LICENSE.has(innerActiveKey) && !ovnVpcEnabled) {
    return (
      <Empty
        description="当前未开通 VPC 网络能力，请在许可证中启用 network.ovn.vpc"
        style={{ marginTop: 48 }}
      />
    );
  }

  if (innerActiveKey === 'vpcs') {
    const onRefresh: HarvesterSectionOnRefresh = kubeOvnTabOnRefresh.vpcs;
    return (
      <>
        <KubeOvnVpcsSection
          vpcs={kubeOvnVpcs}
          subnets={kubeOvnSubnets}
          loading={resourceLoading.vpcs || resourceLoading.subnets}
          onRefresh={onRefresh}
        />
        <DebugJSON data={rawVpcs} show={showLog} />
      </>
    );
  }
  if (innerActiveKey === 'subnets') {
    return (
      <>
        <VpcSubnetsSection
          subnets={(kubeOvnSubnets || []).filter(
            (s: any) =>
              String(
                s?.metadata?.annotations?.['tower.io/subnet-type'] || '',
              )
                .trim()
                .toLowerCase() === 'vpc',
          )}
          vpcList={kubeOvnVpcs}
          loading={resourceLoading.subnets}
          onRefresh={kubeOvnTabOnRefresh.subnets}
        />
        <DebugJSON data={rawSubnets} show={showLog} />
      </>
    );
  }
  if (innerActiveKey === 'kubeovn_eips') {
    return (
      <>
        <EipSection
          cloudId={cloudId}
          eips={kubeOvnEips}
          subnets={kubeOvnSubnets}
          vpcs={kubeOvnVpcs}
          loading={resourceLoading.eips}
          onRefresh={kubeOvnTabOnRefresh.kubeovn_eips}
          networkScope="vpc"
        />
        <DebugJSON data={rawEips} show={showLog} />
      </>
    );
  }
  if (innerActiveKey === 'kubeovn_snat') {
    return (
      <>
        <SnatSection
          cloudId={cloudId}
          snatRules={kubeOvnSnatRules}
          eips={kubeOvnEips}
          vpcs={kubeOvnVpcs}
          subnets={kubeOvnSubnets}
          loading={resourceLoading.snatRules}
          networkScope="vpc"
          onRefresh={kubeOvnTabOnRefresh.kubeovn_snat}
        />
        <DebugJSON data={rawSnatRules} show={showLog} />
      </>
    );
  }
  if (innerActiveKey === 'kubeovn_dnat') {
    return (
      <>
        <DnatSection
          cloudId={cloudId}
          dnatRules={kubeOvnDnatRules}
          eips={kubeOvnEips}
          vpcs={kubeOvnVpcs}
          subnets={kubeOvnSubnets}
          loading={resourceLoading.dnatRules}
          networkScope="vpc"
          onRefresh={kubeOvnTabOnRefresh.kubeovn_dnat}
        />
        <DebugJSON data={rawDnatRules} show={showLog} />
      </>
    );
  }
  return <Empty description="未知页面" style={{ marginTop: 48 }} />;
};

export default CloudmapKubeOvnRoutePanel;
