/**
 * 资源总览（resource_hub / `hsm`）统一刷新约定（与 compute/cluster 样板对称）：
 * - 池层：`loadTabResource('datacenter_topology' | 'network_topology', force)`
 * - Section：`createHarvesterToolbarRefresh` / `runHarvesterSectionRefresh`
 */
export type ResourceHubInnerTabKey = 'datacenter_topology' | 'network_topology';

export type ResourceHubTabRefreshDeps = {
  loadTabResource: (
    key: string,
    force?: boolean,
    skipSync?: boolean,
  ) => void | Promise<void>;
};

export type ResourceHubSectionOnRefresh = (
  force?: boolean,
  silent?: boolean,
) => void | Promise<void>;

export function createResourceHubTabOnRefresh(
  tab: ResourceHubInnerTabKey,
  deps: ResourceHubTabRefreshDeps,
): ResourceHubSectionOnRefresh {
  const { loadTabResource } = deps;
  return async (force?: boolean) => {
    await loadTabResource(tab, force !== false);
  };
}
