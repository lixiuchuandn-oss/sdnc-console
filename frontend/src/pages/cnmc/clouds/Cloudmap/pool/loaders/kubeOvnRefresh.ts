/**
 * Kube-OVN 业务域统一刷新约定（与 compute/cluster 样板对称）：
 * - 池层：`loadTabResource(innerKey, force, skipSync)` → `kubeOvnPathLoads` / `flatNetworkPathLoads`
 * - Section：`createHarvesterToolbarRefresh` / `runHarvesterSectionRefresh`
 */
export type KubeOvnVpcInnerTabKey =
  | 'vpcs'
  | 'subnets'
  | 'kubeovn_eips'
  | 'kubeovn_snat'
  | 'kubeovn_dnat';

export type KubeOvnFlatInnerTabKey =
  | 'flat_kubeovn_eips'
  | 'flat_kubeovn_snat'
  | 'flat_kubeovn_dnat'
  | 'flat_public_subnets';

export type KubeOvnInnerTabKey = KubeOvnVpcInnerTabKey | KubeOvnFlatInnerTabKey;

export type KubeOvnTabRefreshDeps = {
  loadTabResource: (
    key: string,
    force?: boolean,
    skipSync?: boolean,
  ) => void | Promise<void>;
  /** VPC 列表「全部 scope」筛选；仅 `vpcs` Tab 在 `opts.vpcsAll` 时使用 */
  refreshVpcsAllScope?: (
    force: boolean,
    skipSync: boolean,
  ) => void | Promise<void>;
  /** `subnets` Tab 强制刷新时是否顺带拉 VPC */
  ovnVpcEnabled?: boolean;
};

export type KubeOvnSectionOnRefresh = (
  force?: boolean,
  silent?: boolean,
  opts?: { vpcsAll?: boolean },
) => void | Promise<void>;

export function createKubeOvnTabOnRefresh(
  tab: KubeOvnInnerTabKey,
  deps: KubeOvnTabRefreshDeps,
): KubeOvnSectionOnRefresh {
  const { loadTabResource, refreshVpcsAllScope, ovnVpcEnabled } = deps;

  switch (tab) {
    case 'vpcs':
      return async (force?: boolean, silent?: boolean, opts?) => {
        const shouldForce = force !== false;
        const skipSync = !!silent;
        if (opts?.vpcsAll && refreshVpcsAllScope) {
          await refreshVpcsAllScope(shouldForce, skipSync);
        } else {
          await loadTabResource('vpcs', shouldForce, skipSync);
        }
        await loadTabResource('subnets', shouldForce, skipSync);
      };
    case 'subnets':
      return async (force?: boolean) => {
        const shouldForce = force !== false;
        await loadTabResource('subnets', shouldForce);
        if (ovnVpcEnabled) {
          await loadTabResource('vpcs', shouldForce);
        }
      };
    case 'kubeovn_eips':
      return async (force?: boolean) => {
        await loadTabResource('kubeovn_eips', force !== false);
      };
    case 'kubeovn_snat':
      return async (force?: boolean, silent?: boolean) => {
        await loadTabResource('kubeovn_snat', force !== false, !!silent);
      };
    case 'kubeovn_dnat':
      return async (force?: boolean, silent?: boolean) => {
        await loadTabResource('kubeovn_dnat', force !== false, !!silent);
      };
    case 'flat_kubeovn_eips':
      return async (force?: boolean) => {
        await loadTabResource('flat_kubeovn_eips', force !== false);
      };
    case 'flat_kubeovn_snat':
      return async (force?: boolean, silent?: boolean) => {
        await loadTabResource('flat_kubeovn_snat', force !== false, !!silent);
      };
    case 'flat_kubeovn_dnat':
      return async (force?: boolean, silent?: boolean) => {
        await loadTabResource('flat_kubeovn_dnat', force !== false, !!silent);
      };
    case 'flat_public_subnets':
      return async (force?: boolean) => {
        await loadTabResource('flat_public_subnets', force !== false);
      };
    default:
      return async () => {};
  }
}
