import { message } from 'antd';

/**
 * 集群（cluster）业务域统一刷新约定：
 * - 池层：一律 `loadTabResource(innerKey, force, skipSync)`，实现见 `pathResource/clusterPathLoads.ts`
 * - Section：工具栏 `createHarvesterToolbarRefresh(onRefresh)`；写成功/删改后**禁止**裸调 `onRefresh(...)`，一律 `runHarvesterSectionRefresh(onRefresh, { force: true [, silent: true] })`
 */
export type ClusterInnerTabKey =
  | 'cluster_nodes'
  | 'namespaces'
  | 'gpu'
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
    case 'namespaces':
      return async (force?: boolean, silent?: boolean) => {
        const shouldForce = force !== false;
        await loadTabResource('namespaces', shouldForce, silent);
        if (shouldForce && !silent) {
          message.success('刷新成功');
        }
      };
    case 'nads':
      return (force?: boolean, silent?: boolean) => {
        void loadTabResource('nads', force !== false, !!silent);
      };
    case 'cluster_vlans':
      return (force?: boolean, skipSync?: boolean) => {
        void loadTabResource('cluster_vlans', force !== false, skipSync);
      };
    case 'kubeovn_public_networks':
      return (force?: boolean, skipSync?: boolean) => {
        void loadTabResource(
          'kubeovn_public_networks',
          force !== false,
          skipSync,
        );
      };
    case 'kubeovn_public_subnets':
      return (force?: boolean) => {
        void loadTabResource('kubeovn_public_subnets', force !== false);
      };
    default:
      return (force?: boolean) => {
        void loadTabResource(tab, force !== false);
      };
  }
}
