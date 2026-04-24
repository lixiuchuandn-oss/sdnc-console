import {
  fetchHarvesterCloudInits,
  fetchHarvesterSshKeys,
  fetchHarvesterTemplates,
} from '../../api';
import type { PoolPathResourceDeps } from '../poolDataDeps';

/** 云主机域（`panels/compute`）：`CLOUDMAP_COMPUTE_INNER_MENU` 中按需项 */
export async function tryLoadComputeTab(
  key: string,
  force: boolean,
  _skipSync: boolean,
  deps: PoolPathResourceDeps,
): Promise<boolean> {
  const {
    cloudId,
    checkPerm,
    loadResource,
    setHarvesterSshKeys,
    setRawSshKeys,
    setHarvesterCloudInits,
    setRawCloudInits,
    setHarvesterTemplates,
    setRawTemplates,
  } = deps;

  switch (key) {
    case 'ssh_keys':
      if (checkPerm('clouds.sshkeys:read')) {
        loadResource(
          'sshKeys',
          () => fetchHarvesterSshKeys(cloudId, force),
          (json) => {
            const list: any[] = Array.isArray((json as any)?.data?.items)
              ? (json as any).data.items
              : [];
            setHarvesterSshKeys(Array.isArray(list) ? list : []);
            setRawSshKeys(json || null);
          },
          force,
        );
      }
      return true;
    case 'cloud_inits':
      if (checkPerm('clouds.cloudinits:read')) {
        loadResource(
          'cloudInits',
          () => fetchHarvesterCloudInits(cloudId, force),
          (json) => {
            const list: any[] = Array.isArray((json as any)?.data?.items)
              ? (json as any).data.items
              : [];
            setHarvesterCloudInits(Array.isArray(list) ? list : []);
            setRawCloudInits(json || null);
          },
          force,
        );
      }
      return true;
    case 'templates':
      if (checkPerm('clouds.templates:read')) {
        loadResource(
          'templates',
          () => fetchHarvesterTemplates(cloudId, force, false),
          (json) => {
            const list: any[] = Array.isArray((json as any)?.data?.items)
              ? (json as any).data.items
              : [];
            setHarvesterTemplates(Array.isArray(list) ? list : []);
            setRawTemplates(json || null);
          },
          force,
        );
      }
      return true;
    default:
      return false;
  }
}
