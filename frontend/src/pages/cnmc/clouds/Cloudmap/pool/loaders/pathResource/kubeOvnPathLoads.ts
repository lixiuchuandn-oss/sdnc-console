import {
  fetchCloudProviderOvnDnatRules,
  fetchCloudProviderOvnEips,
  fetchCloudProviderOvnSnatRules,
  fetchKubeOvnSubnets,
  fetchKubeOvnVpcs,
} from '../../api';
import type { PoolPathResourceDeps } from '../poolDataDeps';

/** Kube-OVN / VPC 域（`panels/kube_ovn`）：VPC、子网、EIP/SNAT/DNAT 与路径别名 */
export async function tryLoadKubeOvnVpcTab(
  key: string,
  force: boolean,
  skipSync: boolean,
  deps: PoolPathResourceDeps,
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
        if (ovnVpcEnabled) {
          loadResource(
            'vpcs',
            () => fetchKubeOvnVpcs(cloudId, force, skipSync, 'vpc'),
            (json) => {
              const list: any[] = (json as any)?.data?.items || [];
              setKubeOvnVpcs(Array.isArray(list) ? list : []);
              setRawVpcs(json || null);
            },
            force,
          );
        }
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
        const needsEipSubnetContext =
          key === 'eips' ||
          key === 'kubeovn_eips' ||
          key === 'snat' ||
          key === 'kubeovn_snat' ||
          key === 'dnat' ||
          key === 'kubeovn_dnat';
        if (needsEipSubnetContext && checkPerm('clouds.networks:read')) {
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
        if (
          needsEipSubnetContext &&
          checkPerm('clouds.networks:read') &&
          ovnVpcEnabled
        ) {
          loadResource(
            'vpcs',
            () => fetchKubeOvnVpcs(cloudId, force, skipSync, 'vpc'),
            (json) => {
              const list: any[] = (json as any)?.data?.items || [];
              setKubeOvnVpcs(Array.isArray(list) ? list : []);
              setRawVpcs(json || null);
            },
            force,
          );
        }
        if (
          key === 'eips' ||
          key === 'kubeovn_eips' ||
          key === 'snat' ||
          key === 'kubeovn_snat' ||
          key === 'dnat' ||
          key === 'kubeovn_dnat'
        ) {
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
        /* Cloudmapï¼šFIP å…¥å£æš‚ç¼“è”è°ƒ
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
