import React from 'react';
import { Tabs, message } from 'antd';
import UnderlaySubnetsSection from '../../../Harvester/kube-ovn/sections/UnderlaySubnetsSection';
import SecurityGroupsSection from '../../../Harvester/kube-ovn/sections/SecurityGroupsSection';
import EipSection from '../../../Harvester/kube-ovn/sections/EipSection';
import SnatSection from '../../../Harvester/kube-ovn/sections/SnatSection';
import DnatSection from '../../../Harvester/kube-ovn/sections/DnatSection';
import {
  fetchCloudProviderOvnDnatRules,
  fetchCloudProviderOvnSnatRules,
  fetchKubeOvnSubnets,
} from '../../runtime/api';

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
  mode: 'standard' | 'ops';
  showLog: boolean;
  checkPerm: (act: string) => boolean;
  canReadFlatSubnets: boolean;
  handleTabChange: (key: string) => void;
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

const CloudmapFlatNetworkGroupTabs: React.FC<
  CloudmapFlatNetworkGroupTabsProps
> = (props) => {
  const {
    cloudId,
    mode,
    showLog,
    checkPerm,
    canReadFlatSubnets,
    handleTabChange,
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

  return (
    <Tabs
      type="line"
      destroyOnHidden
      defaultActiveKey="flat_public_subnets"
      onChange={handleTabChange}
      items={[
        {
          key: 'flat_public_subnets',
          label: '扁平子网',
          children: (
            <>
              <UnderlaySubnetsSection
                cloudId={cloudId}
                mode="flat"
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
          key: 'security_groups',
          label: '安全组',
          children: (
            <>
              <SecurityGroupsSection cloudId={cloudId} />
              <DebugJSON data={rawSubnets} show={showLog} />
            </>
          ),
        },
        {
          key: 'flat_kubeovn_eips',
          label: '公网IP',
          children: (
            <>
              <EipSection
                cloudId={cloudId}
                eips={kubeOvnFlatEips}
                subnets={kubeOvnSubnets}
                loading={!!resourceLoading.flatEips}
                networkScope="flat"
                onRefresh={() =>
                  loadTabResource('flat_kubeovn_eips', true)
                }
              />
            </>
          ),
        },
        {
          key: 'flat_kubeovn_snat',
          label: 'SNAT 网关',
          children: (
            <>
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
                  setResourceLoading((prev) => ({
                    ...prev,
                    flatSnatRules: true,
                  }));
                  fetchCloudProviderOvnSnatRules(
                    cloudId,
                    force,
                    skipSync,
                    'flat',
                  )
                    .then((json) => {
                      const list: any[] = (json as any)?.data?.items || [];
                      setKubeOvnFlatSnatRules(Array.isArray(list) ? list : []);
                      if (force && !silent) message.success('刷新成功');
                    })
                    .catch((e) => {
                      if (!silent)
                        message.error(
                          '刷新失败: ' + (e?.message || '未知错误'),
                        );
                    })
                    .finally(() => {
                      setResourceLoading((prev) => ({
                        ...prev,
                        flatSnatRules: false,
                      }));
                    });
                }}
              />
            </>
          ),
        },
        {
          key: 'flat_kubeovn_dnat',
          label: 'DNAT 网关',
          children: (
            <>
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
                  setResourceLoading((prev) => ({
                    ...prev,
                    flatDnatRules: true,
                  }));
                  fetchCloudProviderOvnDnatRules(
                    cloudId,
                    force,
                    skipSync,
                    'flat',
                  )
                    .then((json) => {
                      const list: any[] = (json as any)?.data?.items || [];
                      setKubeOvnFlatDnatRules(Array.isArray(list) ? list : []);
                      if (force && !silent) message.success('刷新成功');
                    })
                    .catch((e) => {
                      if (!silent)
                        message.error(
                          '刷新失败: ' + (e?.message || '未知错误'),
                        );
                    })
                    .finally(() => {
                      setResourceLoading((prev) => ({
                        ...prev,
                        flatDnatRules: false,
                      }));
                    });
                }}
              />
            </>
          ),
        },
      ].filter((i: any) => {
        if (i.key === 'flat_public_subnets') return canReadFlatSubnets;
        if (i.key === 'security_groups') {
          return (
            checkPerm('clouds.security-groups.flat:read') ||
            checkPerm('clouds:read')
          );
        }
        if (i.key === 'flat_kubeovn_eips') {
          return (
            checkPerm('clouds.eips.flat:read') || checkPerm('clouds:read')
          );
        }
        if (i.key === 'flat_kubeovn_fips') {
          return false;
        }
        if (i.key === 'flat_kubeovn_snat') {
          return (
            checkPerm('clouds.snat.flat:read') || checkPerm('clouds:read')
          );
        }
        if (i.key === 'flat_kubeovn_dnat') {
          return (
            checkPerm('clouds.dnat.flat:read') || checkPerm('clouds:read')
          );
        }
        return true;
      })}
    />
  );
};

export default CloudmapFlatNetworkGroupTabs;
