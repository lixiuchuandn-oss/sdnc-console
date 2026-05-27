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
          void loadTabResource('vpcs', shouldForce, skipSync);
        }
        void loadTabResource('subnets', shouldForce, skipSync);
      };
    case 'subnets':
      return (force?: boolean) => {
        const shouldForce = force !== false;
        void loadTabResource('subnets', shouldForce);
        if (ovnVpcEnabled) {
          void loadTabResource('vpcs', shouldForce);
        }
      };
    case 'kubeovn_eips':
      return (force?: boolean) => {
        void loadTabResource('kubeovn_eips', force !== false);
      };
    case 'kubeovn_snat':
      return (force?: boolean, silent?: boolean) => {
        void loadTabResource('kubeovn_snat', force !== false, !!silent);
      };
    case 'kubeovn_dnat':
      return (force?: boolean, silent?: boolean) => {
        void loadTabResource('kubeovn_dnat', force !== false, !!silent);
      };
    case 'flat_kubeovn_eips':
      return (force?: boolean) => {
        void loadTabResource('flat_kubeovn_eips', force !== false);
      };
    case 'flat_kubeovn_snat':
      return (force?: boolean, silent?: boolean) => {
        void loadTabResource('flat_kubeovn_snat', force !== false, !!silent);
      };
    case 'flat_kubeovn_dnat':
      return (force?: boolean, silent?: boolean) => {
        void loadTabResource('flat_kubeovn_dnat', force !== false, !!silent);
      };
    case 'flat_public_subnets':
      return (force?: boolean) => {
        void loadTabResource('flat_public_subnets', force !== false);
      };
    default:
      return () => {};
  }
}
