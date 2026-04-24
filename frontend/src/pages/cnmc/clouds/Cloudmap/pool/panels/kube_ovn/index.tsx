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

export type CloudmapKubeOvnGroupTabsProps = {
  cloudId: string;
  mode: 'standard' | 'ops';
  showLog: boolean;
  checkPerm: (act: string) => boolean;
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

const CloudmapKubeOvnGroupTabs: React.FC<CloudmapKubeOvnGroupTabsProps> = (
  props,
) => {
  const {
    cloudId,
    mode,
    showLog,
    checkPerm,
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

  if (innerActiveKey === 'vpcs') {
    return (
      <>
        <KubeOvnVpcsSection
          vpcs={kubeOvnVpcs}
          subnets={kubeOvnSubnets}
          loading={resourceLoading.vpcs || resourceLoading.subnets}
          showYaml={mode === 'ops'}
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
              () => fetchKubeOvnSubnets(cloudId, force, skipSync),
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
          showYaml={mode === 'ops'}
          displayMode={mode === 'ops' ? 'ops' : 'standard'}
          onRefresh={() =>
            loadResource(
              'subnets',
              () => fetchKubeOvnSubnets(cloudId, true),
              (json) => {
                setKubeOvnSubnets(json?.data?.items || []);
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
            setResourceLoading((prev) => ({
              ...prev,
              snatRules: true,
            }));
            fetchCloudProviderOvnSnatRules(cloudId, force, skipSync, 'vpc')
              .then((json) => {
                const list: any[] = (json as any)?.data?.items || [];
                setKubeOvnSnatRules(Array.isArray(list) ? list : []);
                setRawSnatRules(json || null);
                if (force && !silent) message.success('刷新成功');
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
            setResourceLoading((prev) => ({
              ...prev,
              dnatRules: true,
            }));
            fetchCloudProviderOvnDnatRules(cloudId, force, skipSync, 'vpc')
              .then((json) => {
                const list: any[] = (json as any)?.data?.items || [];
                setKubeOvnDnatRules(Array.isArray(list) ? list : []);
                setRawDnatRules(json || null);
                if (force && !silent) message.success('刷新成功');
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

export default CloudmapKubeOvnGroupTabs;
