import {
  fetchCloudProviderOvnEips,
  fetchCloudProviderOvnSnatRules,
  fetchCloudProviderOvnDnatRules,
} from '../../api';
import type { PoolPathResourceDeps } from '../poolDataDeps';

/** 扁平子网域（`panels/flat_network`）：扁平 EIP/SNAT/DNAT 与路径别名 */
export async function tryLoadKubeOvnFlatTab(
  key: string,
  force: boolean,
  _skipSync: boolean,
  deps: PoolPathResourceDeps,
): Promise<boolean> {
  const {
    cloudId,
    checkPerm,
    loadResource,
    canViewFlatNetworkGroup,
    setKubeOvnFlatEips,
    setKubeOvnFlatSnatRules,
    setKubeOvnFlatDnatRules,
  } = deps;

  switch (key) {
    case 'flat_kubeovn_eips':
    case 'flat_kubeovn_fips':
    case 'flat_kubeovn_snat':
    case 'flat_kubeovn_dnat':
      if (!canViewFlatNetworkGroup) return true;
      if (key === 'flat_kubeovn_eips' && checkPerm('clouds.eips.flat:read')) {
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
      /* Cloudmapï¼šFIP å…¥å£æš‚ç¼“è”è°ƒ
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
