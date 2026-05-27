import {
  fetchCloudProviderOvnEips,
  fetchCloudProviderOvnSnatRules,
  fetchCloudProviderOvnDnatRules,
  fetchKubeOvnSubnets,
  fetchKubeOvnVpcs,
} from '../../api';
import type { PoolPathResourceDeps } from '../poolDataDeps';

/** 扁平子网域（`panels/flat_network`）：扁平 EIP/SNAT/DNAT 与路径别名 */
export async function tryLoadKubeOvnFlatTab(
  key: string,
  force: boolean,
  skipSync: boolean,
  deps: PoolPathResourceDeps,
): Promise<boolean> {
  const {
    cloudId,
    checkPerm,
    loadResource,
    canViewFlatNetworkGroup,
    setKubeOvnSubnets,
    setRawSubnets,
    setKubeOvnFlatEips,
    setKubeOvnFlatSnatRules,
    setKubeOvnFlatDnatRules,
    setKubeOvnVpcs,
    setRawVpcs,
  } = deps;

  switch (key) {
    case 'flat_public_subnets':
      if (canViewFlatNetworkGroup && checkPerm('clouds.networks:read')) {
        loadResource(
          'subnets',
          () => fetchKubeOvnSubnets(cloudId, force, skipSync, 'underlay'),
          (json) => {
            const list: any[] = (json as any)?.data?.items || [];
            setKubeOvnSubnets(Array.isArray(list) ? list : []);
            setRawSubnets(json || null);
          },
          force,
        );
      }
      return true;
    case 'flat_kubeovn_eips':
    case 'flat_kubeovn_fips':
    case 'flat_kubeovn_snat':
    case 'flat_kubeovn_dnat':
      if (!canViewFlatNetworkGroup) return true;

      const needsFlatSubnetForTab =
        (key === 'flat_kubeovn_eips' && checkPerm('clouds.eips.flat:read')) ||
        (key === 'flat_kubeovn_snat' && checkPerm('clouds.snat.flat:read')) ||
        (key === 'flat_kubeovn_dnat' && checkPerm('clouds.dnat.flat:read'));

      if (needsFlatSubnetForTab && checkPerm('clouds.networks:read')) {
        loadResource(
          'subnets',
          () => fetchKubeOvnSubnets(cloudId, force, skipSync, 'underlay'),
          (json) => {
            const list: any[] = (json as any)?.data?.items || [];
            setKubeOvnSubnets(Array.isArray(list) ? list : []);
            setRawSubnets(json || null);
          },
          force,
        );
        loadResource(
          'vpcs',
          () => fetchKubeOvnVpcs(cloudId, force, skipSync, 'underlay'),
          (json) => {
            const list: any[] = (json as any)?.data?.items || [];
            setKubeOvnVpcs(Array.isArray(list) ? list : []);
            setRawVpcs(json || null);
          },
          force,
        );
      }

      if (
        (key === 'flat_kubeovn_eips' ||
          key === 'flat_kubeovn_snat' ||
          key === 'flat_kubeovn_dnat') &&
        checkPerm('clouds.eips.flat:read')
      ) {
        loadResource(
          'flatEips',
          () => fetchCloudProviderOvnEips(cloudId, force, 'flat'),
          (json) => {
            const list: any[] = (json as any)?.data?.items || [];
            setKubeOvnFlatEips(Array.isArray(list) ? list : []);
          },
          force,
        );
      }
      /* Cloudmap：FIP 入口暂缓联调
      if (key === 'flat_kubeovn_fips' && checkPerm('clouds.fips.flat:read')) { ... }
      */
      if (
        key === 'flat_kubeovn_snat' &&
        checkPerm('clouds.snat.flat:read')
      ) {
        loadResource(
          'flatSnatRules',
          () =>
            fetchCloudProviderOvnSnatRules(cloudId, force, false, 'flat'),
          (json) => {
            const list: any[] = (json as any)?.data?.items || [];
            setKubeOvnFlatSnatRules(Array.isArray(list) ? list : []);
          },
          force,
        );
      }
      if (
        key === 'flat_kubeovn_dnat' &&
        checkPerm('clouds.dnat.flat:read')
      ) {
        loadResource(
          'flatDnatRules',
          () =>
            fetchCloudProviderOvnDnatRules(cloudId, force, false, 'flat'),
          (json) => {
            const list: any[] = (json as any)?.data?.items || [];
            setKubeOvnFlatDnatRules(Array.isArray(list) ? list : []);
          },
          force,
        );
      }
      return true;
    default:
      return false;
  }
}
