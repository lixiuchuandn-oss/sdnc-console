import {
  fetchCloudProviderOvnDnatRules,
  fetchCloudProviderOvnEips,
  fetchCloudProviderOvnSnatRules,
  fetchKubeOvnSubnets,
  fetchKubeOvnVpcs,
} from '../../runtime/api';
import type { LoadTabResourceDeps } from '../types';

/** VPC 分组：VPC、子网、EIP/SNAT/DNAT（及内层 Tab 别名） */
export async function tryLoadKubeOvnVpcTab(
  key: string,
  force: boolean,
  skipSync: boolean,
  deps: LoadTabResourceDeps,
): Promise<boolean> {
  const {
    cloudId,
    checkPerm,
    loadResource,
    ovnVpcEnabled,
    canViewKubeOvnGroup,
    setKubeOvnVpcs,
    setRawVpcs,
    setKubeOvnSubnets,
    setRawSubnets,
    setKubeOvnEips,
    setRawEips,
    setKubeOvnSnatRules,
    setRawSnatRules,
    setKubeOvnDnatRules,
    setRawDnatRules,
  } = deps;

  switch (key) {
    case 'vpcs':
      if (checkPerm('clouds.networks:read') && ovnVpcEnabled) {
        loadResource(
          'vpcs',
          () => fetchKubeOvnVpcs(cloudId, force, skipSync),
          (json) => {
            const list: any[] = (json as any)?.data?.items || [];
            setKubeOvnVpcs(Array.isArray(list) ? list : []);
            setRawVpcs(json || null);
          },
          force,
        );
      }
      return true;
    case 'subnets':
      if (checkPerm('clouds.networks:read')) {
        loadResource(
          'subnets',
          () => fetchKubeOvnSubnets(cloudId, force, skipSync),
          (json) => {
            const list: any[] = (json as any)?.data?.items || [];
            setKubeOvnSubnets(Array.isArray(list) ? list : []);
            setRawSubnets(json || null);
          },
          force,
        );
      }
      return true;
    case 'kube_ovn_group':
      if (!canViewKubeOvnGroup) return true;
      if (checkPerm('clouds.eips.vpc:read')) {
        loadResource(
          'eips',
          () => fetchCloudProviderOvnEips(cloudId, force, 'vpc'),
          (json) => {
            const list: any[] = (json as any)?.data?.items || [];
            setKubeOvnEips(Array.isArray(list) ? list : []);
            setRawEips(json || null);
          },
          force,
        );
      }
      /* Cloudmap：FIP 入口暂缓联调，恢复时取消注释
      if (checkPerm('clouds.fips.vpc:read')) {
        loadResource(
          'fips',
          () => fetchCloudProviderOvnFips(cloudId, force, 'vpc'),
          ...
        );
      }
      */
      if (checkPerm('clouds.snat.vpc:read')) {
        loadResource(
          'snatRules',
          () => fetchCloudProviderOvnSnatRules(cloudId, force, false, 'vpc'),
          (json) => {
            const list: any[] = (json as any)?.data?.items || [];
            setKubeOvnSnatRules(Array.isArray(list) ? list : []);
            setRawSnatRules(json || null);
          },
          force,
        );
      }
      if (checkPerm('clouds.dnat.vpc:read')) {
        loadResource(
          'dnatRules',
          () =>
            fetchCloudProviderOvnDnatRules(cloudId, force, false, 'vpc'),
          (json) => {
            const list: any[] = (json as any)?.data?.items || [];
            setKubeOvnDnatRules(Array.isArray(list) ? list : []);
            setRawDnatRules(json || null);
          },
          force,
        );
      }
      return true;
    case 'eips':
    case 'kubeovn_eips':
    case 'fips':
    case 'kubeovn_fips':
    case 'snat':
    case 'kubeovn_snat':
    case 'dnat':
    case 'kubeovn_dnat':
      if (canViewKubeOvnGroup) {
        if (key === 'eips' || key === 'kubeovn_eips') {
          loadResource(
            'eips',
            () => fetchCloudProviderOvnEips(cloudId, force, 'vpc'),
            (json) => {
              const list: any[] = (json as any)?.data?.items || [];
              setKubeOvnEips(Array.isArray(list) ? list : []);
              setRawEips(json || null);
            },
            force,
          );
        }
        /* Cloudmap：FIP 入口暂缓联调
        if (key === 'fips' || key === 'kubeovn_fips') { ... }
        */
        if (key === 'snat' || key === 'kubeovn_snat') {
          loadResource(
            'snatRules',
            () =>
              fetchCloudProviderOvnSnatRules(cloudId, force, false, 'vpc'),
            (json) => {
              const list: any[] = (json as any)?.data?.items || [];
              setKubeOvnSnatRules(Array.isArray(list) ? list : []);
              setRawSnatRules(json || null);
            },
            force,
          );
        }
        if (key === 'dnat' || key === 'kubeovn_dnat') {
          loadResource(
            'dnatRules',
            () =>
              fetchCloudProviderOvnDnatRules(cloudId, force, false, 'vpc'),
            (json) => {
              const list: any[] = (json as any)?.data?.items || [];
              setKubeOvnDnatRules(Array.isArray(list) ? list : []);
              setRawDnatRules(json || null);
            },
            force,
          );
        }
      }
      return true;
    default:
      return false;
  }
}
