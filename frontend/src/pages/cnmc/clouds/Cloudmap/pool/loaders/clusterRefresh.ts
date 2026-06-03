import { message } from 'antd';

/**
 * 集群（cluster）业务域统一刷新约定：
 * - 池层：一律 `loadTabResource(innerKey, force, skipSync)`，实现见 `pathResource/clusterPathLoads.ts`
 * - Section：工具栏 `createHarvesterToolbarRefresh(onRefresh)`；写成功/删改后**禁止**裸调 `onRefresh(...)`，一律 `runHarvesterSectionRefresh(onRefresh, { force: true [, silent: true] })`
 */
export type ClusterInnerTabKey =
  | 'compute_nodes'
  | 'compute_projects'
  | 'compute_drs_rules'
  | 'compute_migrations'
  | 'compute_gpu'
  | 'cluster_usb'
  | 'clusterNetworks'
  | 'storage_classes'
  | 'nads'
  | 'load_balancers'
  | 'ippools'
  | 'cluster_pci'
  | 'cluster_sriov'
  | 'cluster_vlans'
  | 'kubeovn_public_networks'
  | 'kubeovn_public_subnets';

export type ClusterTabRefreshDeps = {
  loadTabResource: (
    key: string,
    force?: boolean,
    skipSync?: boolean,
  ) => void | Promise<void>;
};

export type ClusterSectionOnRefresh = (
  force?: boolean,
  silent?: boolean,
) => void | Promise<void>;

export function createClusterTabOnRefresh(
  tab: ClusterInnerTabKey,
  deps: ClusterTabRefreshDeps,
): ClusterSectionOnRefresh {
  const { loadTabResource } = deps;

  switch (tab) {
    case 'compute_projects':
      return async (force?: boolean, silent?: boolean) => {
        const shouldForce = force !== false;
        await loadTabResource('compute_projects', shouldForce, silent);
        if (shouldForce && !silent) {
          message.success('刷新成功');
        }
      };
    case 'nads':
      return async (force?: boolean, silent?: boolean) => {
        await loadTabResource('nads', force !== false, !!silent);
      };
    case 'cluster_vlans':
      return async (force?: boolean, skipSync?: boolean) => {
        await loadTabResource('cluster_vlans', force !== false, skipSync);
      };
    case 'kubeovn_public_networks':
      return async (force?: boolean, skipSync?: boolean) => {
        await loadTabResource(
          'kubeovn_public_networks',
          force !== false,
          skipSync,
        );
      };
    case 'kubeovn_public_subnets':
      return async (force?: boolean) => {
        await loadTabResource('kubeovn_public_subnets', force !== false);
      };
    default:
      return async (force?: boolean) => {
        await loadTabResource(tab, force !== false);
      };
  }
}
