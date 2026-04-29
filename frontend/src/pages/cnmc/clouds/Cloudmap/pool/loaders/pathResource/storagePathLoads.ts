import {
  fetchCloudProviderEcs,
  fetchHarvesterSnapshots,
  fetchHarvesterVolumes,
} from '../../api';
import type { PoolPathResourceDeps } from '../poolDataDeps';

/** 云存储域（`panels/storage`）：`CLOUDMAP_STORAGE_INNER_MENU`（volumes / snapshots） */
export async function tryLoadStorageTab(
  key: string,
  force: boolean,
  _skipSync: boolean,
  deps: PoolPathResourceDeps,
): Promise<boolean> {
  const {
    cloudId,
    checkPerm,
    loadResource,
    setEcs,
    setRawEcs,
    setHarvesterVolumes,
    setRawVolumes,
    setHarvesterSnapshots,
    setRawSnapshots,
  } = deps;

  switch (key) {
    case 'volumes':
      if (checkPerm('clouds.disks:read')) {
        loadResource(
          'volumes',
          () => fetchHarvesterVolumes(cloudId, force),
          (json) => {
            const list: any[] = Array.isArray((json as any)?.data?.items)
              ? (json as any).data.items
              : Array.isArray((json as any)?.items)
                ? (json as any).items
                : [];
            setHarvesterVolumes(Array.isArray(list) ? list : []);
            setRawVolumes(json || null);
          },
          force,
        );
      }
      if (checkPerm('clouds.ecs:read')) {
        loadResource(
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
    case 'snapshots':
      if (checkPerm('clouds.snapshots:read')) {
        loadResource(
          'snapshots',
          () => fetchHarvesterSnapshots(cloudId, force),
          (json) => {
            const list: any[] = Array.isArray((json as any)?.data?.items)
              ? (json as any).data.items
              : [];
            setHarvesterSnapshots(Array.isArray(list) ? list : []);
            setRawSnapshots(json || null);
          },
          force,
        );
      }
      return true;
    case 'longhorn':
      /** 页面内自拉 `/monitoring/storage-nodes`，池级无需预加载 */
      return true;
    case 'ceph':
      /** 页面内自拉 `/monitoring/ceph-clusters` */
      return true;
    default:
      return false;
  }
}
