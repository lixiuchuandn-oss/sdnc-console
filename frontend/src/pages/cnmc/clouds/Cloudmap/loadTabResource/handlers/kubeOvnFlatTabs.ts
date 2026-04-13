import {
  fetchCloudProviderOvnEips,
  fetchCloudProviderOvnSnatRules,
  fetchCloudProviderOvnDnatRules,
} from '../../runtime/api';
import type { LoadTabResourceDeps } from '../types';

/** 扁平子网分组：扁平 EIP/SNAT/DNAT（及内层 Tab 别名） */
export async function tryLoadKubeOvnFlatTab(
  key: string,
  force: boolean,
  _skipSync: boolean,
  deps: LoadTabResourceDeps,
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
    case 'flat_network_group':
      if (!canViewFlatNetworkGroup) return true;
      if (checkPerm('clouds.eips.flat:read')) {
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
      /* Cloudmap：FIP 入口暂缓联调，恢复时取消注释
      if (checkPerm('clouds.fips.flat:read')) { ... }
      */
      if (checkPerm('clouds.snat.flat:read')) {
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
      if (checkPerm('clouds.dnat.flat:read')) {
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
