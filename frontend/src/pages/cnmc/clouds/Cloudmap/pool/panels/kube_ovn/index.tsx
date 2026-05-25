import React from 'react';
import { Empty, message } from 'antd';
import KubeOvnVpcsSection from '../../../../Harvester/kube-ovn/sections/VpcsSection';
import VpcSubnetsSection from '../../../../Harvester/kube-ovn/sections/VpcSubnetsSection';
import EipSection from '../../../../Harvester/kube-ovn/sections/EipSection';
import SnatSection from '../../../../Harvester/kube-ovn/sections/SnatSection';
import DnatSection from '../../../../Harvester/kube-ovn/sections/DnatSection';
import {
  fetchCloudProviderOvnDnatRules,
  fetchCloudProviderOvnSnatRules,
  fetchKubeOvnSubnets,
  fetchKubeOvnVpcs,
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

export type CloudmapKubeOvnRoutePanelProps = {
  cloudId: string;
  showLog: boolean;
  checkPerm: (act: string) => boolean;
  /** 许可证 network.ovn.vpc；业务 VPC / VPC 域 EIP·NAT 等 Tab 门控，与子网 RBAC 解耦 */
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
  setResourceLoading: React.Dispatch<
    React.SetStateAction<Record<string, boolean>>
  >;
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

/** 须 network.ovn.vpc 许可证的池内 Tab（与 cloudmapPoolNavRows.requiredFeature 对齐） */
const KUBE_OVN_TABS_REQUIRE_VPC_LICENSE = new Set([
  'vpcs',
  'subnets',
  'kubeovn_eips',
  'kubeovn_snat',
  'kubeovn_dnat',
]);

function kubeOvnTabNeedsVpcLicense(key: string): boolean {
  return KUBE_OVN_TABS_REQUIRE_VPC_LICENSE.has(key);
}

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
    setResourceLoading,
    kubeOvnVpcs,
    setKubeOvnVpcs,
    setRawVpcs,
    kubeOvnSubnets,
    setKubeOvnSubnets,
    setRawSubnets,
    kubeOvnEips,
    kubeOvnSnatRules,
    setKubeOvnSnatRules,
    setRawSnatRules,
    kubeOvnDnatRules,
    setKubeOvnDnatRules,
    setRawDnatRules,
    resourceLoading,
    rawVpcs,
    rawSubnets,
    rawEips,
    rawSnatRules,
    rawDnatRules,
  } = props;

  if (!canViewKubeOvnInner(innerActiveKey, checkPerm, canReadVpcSubnets)) {
    return <Empty description="无权限访问" style={{ marginTop: 48 }} />;
  }

  if (kubeOvnTabNeedsVpcLicense(innerActiveKey) && !ovnVpcEnabled) {
    return (
      <Empty
        description="当前未开通 VPC 网络能力，请在许可证中启用 network.ovn.vpc"
        style={{ marginTop: 48 }}
      />
    );
  }

  if (innerActiveKey === 'vpcs') {
    return (
      <>
        <KubeOvnVpcsSection
          vpcs={kubeOvnVpcs}
          subnets={kubeOvnSubnets}
          loading={resourceLoading.vpcs || resourceLoading.subnets}
          onRefresh={async (force = false, silent = false, opts) => {
            const skipSync = silent;
            const vpcsAll = opts?.vpcsAll === true;
            loadResource(
              'vpcs',
              () =>
                fetchKubeOvnVpcs(
                  cloudId,
                  force,
                  skipSync,
                  vpcsAll ? 'all' : 'vpc',
                ),
              (json) => {
                setKubeOvnVpcs(json?.data?.items || []);
                setRawVpcs(json || null);
              },
              true,
            );
            loadResource(
              'subnets',
              () => fetchKubeOvnSubnets(cloudId, force, skipSync, 'vpc'),
              (json) => {
                setKubeOvnSubnets(json?.data?.items || []);
                setRawSubnets(json || null);
              },
              true,
            );
          }}
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
          onRefresh={() => {
            loadResource(
              'subnets',
              () => fetchKubeOvnSubnets(cloudId, true, false, 'vpc'),
              (json) => {
                setKubeOvnSubnets(json?.data?.items || []);
                setRawSubnets(json || null);
              },
              true,
            );
            if (ovnVpcEnabled) {
              loadResource(
                'vpcs',
                () => fetchKubeOvnVpcs(cloudId, true, false, 'vpc'),
                (json) => {
                  setKubeOvnVpcs(json?.data?.items || []);
                  setRawVpcs(json || null);
                },
                true,
              );
            }
          }}
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
          onRefresh={() => {
            void loadTabResource('eips', true);
            void loadTabResource('vpcs', true);
            void loadTabResource('subnets', true);
          }}
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
          onRefresh={(force = true, silent = false) => {
            const skipSync = silent;
            void loadTabResource('eips', force, skipSync);
            setResourceLoading((prev) => ({
              ...prev,
              snatRules: true,
            }));
            fetchCloudProviderOvnSnatRules(cloudId, force, skipSync, 'vpc')
              .then((json) => {
                const list: any[] = (json as any)?.data?.items || [];
                setKubeOvnSnatRules(Array.isArray(list) ? list : []);
                setRawSnatRules(json || null);
              })
              .catch((e) => {
                if (!silent)
                  message.error('刷新失败: ' + (e?.message || '未知错误'));
              })
              .finally(() => {
                setResourceLoading((prev) => ({
                  ...prev,
                  snatRules: false,
                }));
              });
          }}
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
          onRefresh={(force = true, silent = false) => {
            const skipSync = silent;
            void loadTabResource('eips', force, skipSync);
            setResourceLoading((prev) => ({
              ...prev,
              dnatRules: true,
            }));
            fetchCloudProviderOvnDnatRules(cloudId, force, skipSync, 'vpc')
              .then((json) => {
                const list: any[] = (json as any)?.data?.items || [];
                setKubeOvnDnatRules(Array.isArray(list) ? list : []);
                setRawDnatRules(json || null);
              })
              .catch((e) => {
                if (!silent)
                  message.error('刷新失败: ' + (e?.message || '未知错误'));
              })
              .finally(() => {
                setResourceLoading((prev) => ({
                  ...prev,
                  dnatRules: false,
                }));
              });
          }}
        />
        <DebugJSON data={rawDnatRules} show={showLog} />
      </>
    );
  }
  return <Empty description="未知页面" style={{ marginTop: 48 }} />;
};

export default CloudmapKubeOvnRoutePanel;
