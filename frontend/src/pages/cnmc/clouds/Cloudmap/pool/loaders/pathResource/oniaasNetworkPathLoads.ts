import { fetchCloudProviderEcs, fetchHarvesterLoadBalancers } from '../../api';
import type { PoolPathResourceDeps } from '../poolDataDeps';

/**
 * 虚拟网元：与 `panels/oniaas_network`、侧�?`oniaas_network/*` 对齐�?
 * `slb` 与集群侧「负载均衡」同一 Harvester 数据源，便于在自有目录中独立呈现产品入口�?
 */
export async function tryLoadOniaasNetworkTab(
  key: string,
  force: boolean,
  _skipSync: boolean,
  deps: PoolPathResourceDeps,
): Promise<boolean> {
  const {
    cloudId,
    checkPerm,
    canReadLoadBalancers,
    loadResource,
    setEcs,
    setRawEcs,
    setHarvesterLoadBalancers,
    setRawLoadBalancers,
  } = deps;

  switch (key) {
    case 'slb':
      if (canReadLoadBalancers) {
        await loadResource(
          'loadBalancers',
          () => fetchHarvesterLoadBalancers(cloudId, force),
          (json) => {
            const list = Array.isArray((json as any)?.data?.items)
              ? (json as any).data.items
              : [];
            setHarvesterLoadBalancers(list);
            setRawLoadBalancers(json || null);
          },
          force,
        );
      }
      return true;
    case 'virtual_routers':
      if (checkPerm('clouds.ecs:read')) {
        await loadResource(
          'ecs',
          () => fetchCloudProviderEcs(cloudId, force),
          (json) => {
            const list: any[] = Array.isArray((json as any)?.data)
              ? (json as any).data
              : (json as any)?.data?.Instances?.Instance ||
                (json as any)?.data?.items ||
                (json as any)?.data?.data ||
                [];
            setEcs(Array.isArray(list) ? list : []);
            setRawEcs(json || null);
          },
          force,
        );
      }
      return true;
    default:
      return false;
  }
}
