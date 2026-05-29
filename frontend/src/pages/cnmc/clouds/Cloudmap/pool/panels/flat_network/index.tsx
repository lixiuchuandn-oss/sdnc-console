/**
 * Cloudmap 详情 — 扁平网络：刷新经 `kubeOvnRefresh` → `loadTabResource` / `flatNetworkPathLoads`。
 */
import React, { useEffect, useMemo } from 'react';
import { Empty } from 'antd';
import UnderlaySubnetsSection from '../../../../Harvester/kube-ovn/sections/UnderlaySubnetsSection';
import SecurityGroupsSection from '../../../../Harvester/kube-ovn/sections/SecurityGroupsSection';
import EipSection from '../../../../Harvester/kube-ovn/sections/EipSection';
import SnatSection from '../../../../Harvester/kube-ovn/sections/SnatSection';
import DnatSection from '../../../../Harvester/kube-ovn/sections/DnatSection';
import { createKubeOvnTabOnRefresh } from '../../loaders/kubeOvnRefresh';
import {
  runHarvesterSectionRefresh,
  type HarvesterSectionOnRefresh,
} from '../../../../Harvester/kube-ovn/lib/kubeOvnSectionRefresh';

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

export type CloudmapFlatNetworkRoutePanelProps = {
  cloudId: string;
  showLog: boolean;
  checkPerm: (act: string) => boolean;
  canReadFlatSubnets: boolean;
  innerActiveKey: string;
  loadTabResource: (
    key: string,
    force?: boolean,
    skipSync?: boolean,
  ) => Promise<void>;
  kubeOvnSubnets: any[];
  rawSubnets: any;
  kubeOvnFlatEips: any[];
  kubeOvnVpcs: any[];
  kubeOvnFlatSnatRules: any[];
  kubeOvnFlatDnatRules: any[];
  resourceLoading: Record<string, boolean>;
};

function canViewFlatInner(
  key: string,
  checkPerm: (a: string) => boolean,
  canReadFlatSubnets: boolean,
): boolean {
  if (key === 'flat_public_subnets') return canReadFlatSubnets;
  if (key === 'security_groups') {
    return checkPerm('clouds.security-groups.flat:read') || checkPerm('clouds:read');
  }
  if (key === 'flat_kubeovn_eips') {
    return checkPerm('clouds.eips.flat:read') || checkPerm('clouds:read');
  }
  if (key === 'flat_kubeovn_snat') {
    return checkPerm('clouds.snat.flat:read') || checkPerm('clouds:read');
  }
  if (key === 'flat_kubeovn_dnat') {
    return checkPerm('clouds.dnat.flat:read') || checkPerm('clouds:read');
  }
  return false;
}

const FLAT_TAB_KEYS = [
  'flat_public_subnets',
  'flat_kubeovn_eips',
  'flat_kubeovn_snat',
  'flat_kubeovn_dnat',
] as const;

const CloudmapFlatNetworkRoutePanel: React.FC<CloudmapFlatNetworkRoutePanelProps> = (
  props,
) => {
  const {
    cloudId,
    showLog,
    checkPerm,
    canReadFlatSubnets,
    innerActiveKey,
    loadTabResource,
    rawSubnets,
    kubeOvnFlatEips,
    kubeOvnVpcs,
    kubeOvnSubnets,
    kubeOvnFlatSnatRules,
    kubeOvnFlatDnatRules,
    resourceLoading,
  } = props;

  const flatTabOnRefresh = useMemo(
    () => ({
      flat_public_subnets: createKubeOvnTabOnRefresh('flat_public_subnets', {
        loadTabResource,
      }),
      flat_kubeovn_eips: createKubeOvnTabOnRefresh('flat_kubeovn_eips', {
        loadTabResource,
      }),
      flat_kubeovn_snat: createKubeOvnTabOnRefresh('flat_kubeovn_snat', {
        loadTabResource,
      }),
      flat_kubeovn_dnat: createKubeOvnTabOnRefresh('flat_kubeovn_dnat', {
        loadTabResource,
      }),
    }),
    [loadTabResource],
  );

  useEffect(() => {
    if ((FLAT_TAB_KEYS as readonly string[]).includes(innerActiveKey)) {
      void loadTabResource(innerActiveKey, false);
    }
  }, [innerActiveKey, cloudId, loadTabResource]);

  if (!canViewFlatInner(innerActiveKey, checkPerm, canReadFlatSubnets)) {
    return <Empty description="无权限访问" style={{ marginTop: 48 }} />;
  }

  if (innerActiveKey === 'flat_public_subnets') {
    const onPoolSubnetsChanged: HarvesterSectionOnRefresh =
      flatTabOnRefresh.flat_public_subnets;
    return (
      <>
        <UnderlaySubnetsSection
          cloudId={cloudId}
          mode="flat"
          onSubnetsChanged={() =>
            runHarvesterSectionRefresh(onPoolSubnetsChanged, { force: true, silent: true })
          }
        />
        <DebugJSON data={rawSubnets} show={showLog} />
      </>
    );
  }
  if (innerActiveKey === 'security_groups') {
    return (
      <>
        <SecurityGroupsSection cloudId={cloudId} />
        <DebugJSON data={rawSubnets} show={showLog} />
      </>
    );
  }
  if (innerActiveKey === 'flat_kubeovn_eips') {
    return (
      <EipSection
        cloudId={cloudId}
        eips={kubeOvnFlatEips}
        subnets={kubeOvnSubnets}
        loading={!!resourceLoading.flatEips}
        networkScope="flat"
        onRefresh={flatTabOnRefresh.flat_kubeovn_eips}
      />
    );
  }
  if (innerActiveKey === 'flat_kubeovn_snat') {
    return (
      <SnatSection
        cloudId={cloudId}
        snatRules={kubeOvnFlatSnatRules}
        eips={kubeOvnFlatEips}
        vpcs={kubeOvnVpcs}
        subnets={kubeOvnSubnets}
        loading={!!resourceLoading.flatSnatRules}
        networkScope="flat"
        onRefresh={flatTabOnRefresh.flat_kubeovn_snat}
      />
    );
  }
  if (innerActiveKey === 'flat_kubeovn_dnat') {
    return (
      <DnatSection
        cloudId={cloudId}
        dnatRules={kubeOvnFlatDnatRules}
        eips={kubeOvnFlatEips}
        vpcs={kubeOvnVpcs}
        subnets={kubeOvnSubnets}
        loading={!!resourceLoading.flatDnatRules}
        networkScope="flat"
        onRefresh={flatTabOnRefresh.flat_kubeovn_dnat}
      />
    );
  }
  return <Empty description="未知页面" style={{ marginTop: 48 }} />;
};

export default CloudmapFlatNetworkRoutePanel;
