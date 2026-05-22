import React from 'react';
import { Empty, message } from 'antd';
import UnderlaySubnetsSection from '../../../../Harvester/kube-ovn/sections/UnderlaySubnetsSection';
import SecurityGroupsSection from '../../../../Harvester/kube-ovn/sections/SecurityGroupsSection';
import EipSection from '../../../../Harvester/kube-ovn/sections/EipSection';
import SnatSection from '../../../../Harvester/kube-ovn/sections/SnatSection';
import DnatSection from '../../../../Harvester/kube-ovn/sections/DnatSection';
import {
  fetchCloudProviderOvnDnatRules,
  fetchCloudProviderOvnSnatRules,
  fetchKubeOvnSubnets,
} from '../../api';

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

export type CloudmapFlatNetworkGroupTabsProps = {
  cloudId: string;
  showLog: boolean;
  checkPerm: (act: string) => boolean;
  canReadFlatSubnets: boolean;
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
  setResourceLoading: React.Dispatch<
    React.SetStateAction<Record<string, boolean>>
  >;
  kubeOvnSubnets: any[];
  setKubeOvnSubnets: (v: any[]) => void;
  setRawSubnets: (v: any) => void;
  rawSubnets: any;
  kubeOvnFlatEips: any[];
  kubeOvnVpcs: any[];
  kubeOvnFlatSnatRules: any[];
  setKubeOvnFlatSnatRules: (v: any[]) => void;
  kubeOvnFlatDnatRules: any[];
  setKubeOvnFlatDnatRules: (v: any[]) => void;
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
  if (key === 'flat_kubeovn_fips') return false;
  if (key === 'flat_kubeovn_snat') {
    return checkPerm('clouds.snat.flat:read') || checkPerm('clouds:read');
  }
  if (key === 'flat_kubeovn_dnat') {
    return checkPerm('clouds.dnat.flat:read') || checkPerm('clouds:read');
  }
  return false;
}

const CloudmapFlatNetworkGroupTabs: React.FC<CloudmapFlatNetworkGroupTabsProps> = (
  props,
) => {
  const {
    cloudId,
    showLog,
    checkPerm,
    canReadFlatSubnets,
    innerActiveKey,
    loadResource,
    loadTabResource,
    setResourceLoading,
    kubeOvnSubnets,
    setKubeOvnSubnets,
    setRawSubnets,
    rawSubnets,
    kubeOvnFlatEips,
    kubeOvnVpcs,
    kubeOvnFlatSnatRules,
    setKubeOvnFlatSnatRules,
    kubeOvnFlatDnatRules,
    setKubeOvnFlatDnatRules,
    resourceLoading,
  } = props;

  if (!canViewFlatInner(innerActiveKey, checkPerm, canReadFlatSubnets)) {
    return <Empty description="无权限访问" style={{ marginTop: 48 }} />;
  }

  if (innerActiveKey === 'flat_public_subnets') {
    return (
      <>
        <UnderlaySubnetsSection
          cloudId={cloudId}
          mode="flat"
          onSubnetsChanged={() =>
            loadResource(
              'subnets',
              () => fetchKubeOvnSubnets(cloudId, true, false, 'underlay'),
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
        onRefresh={() => loadTabResource('flat_kubeovn_eips', true)}
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
        onRefresh={(force = true, silent = false) => {
          const skipSync = silent;
          void loadTabResource('flat_kubeovn_eips', force, skipSync);
          setResourceLoading((prev) => ({
            ...prev,
            flatSnatRules: true,
          }));
          fetchCloudProviderOvnSnatRules(cloudId, force, skipSync, 'flat')
            .then((json) => {
              const list: any[] = (json as any)?.data?.items || [];
              setKubeOvnFlatSnatRules(Array.isArray(list) ? list : []);
            })
            .catch((e) => {
              if (!silent) message.error('刷新失败: ' + (e?.message || '未知错误'));
            })
            .finally(() => {
              setResourceLoading((prev) => ({
                ...prev,
                flatSnatRules: false,
              }));
            });
        }}
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
        onRefresh={(force = true, silent = false) => {
          const skipSync = silent;
          void loadTabResource('flat_kubeovn_eips', force, skipSync);
          setResourceLoading((prev) => ({
            ...prev,
            flatDnatRules: true,
          }));
          fetchCloudProviderOvnDnatRules(cloudId, force, skipSync, 'flat')
            .then((json) => {
              const list: any[] = (json as any)?.data?.items || [];
              setKubeOvnFlatDnatRules(Array.isArray(list) ? list : []);
            })
            .catch((e) => {
              if (!silent) message.error('刷新失败: ' + (e?.message || '未知错误'));
            })
            .finally(() => {
              setResourceLoading((prev) => ({
                ...prev,
                flatDnatRules: false,
              }));
            });
        }}
      />
    );
  }
  return <Empty description="未知页面" style={{ marginTop: 48 }} />;
};

export default CloudmapFlatNetworkGroupTabs;
