import {
  fetchHarvesterCloudInits,
  fetchHarvesterImages,
  fetchHarvesterSshKeys,
  fetchHarvesterTemplates,
  fetchKubeOvnSubnets,
} from '../../api';
import type { PoolPathResourceDeps } from '../poolDataDeps';
import {
  fetchComputeEcsList,
  parseEcsListFromJson,
  syncCloudEcsBeforeLoad,
} from './computeEcsListLoad';
import { fetchComputeMigrationsList } from './computeMigrationsLoad';
import { fetchComputeOvnMirrorsList } from './computeOvnMirrorsLoad';

/** ?????`panels/compute`??`CLOUDMAP_COMPUTE_INNER_MENU` ?????*/
export async function tryLoadComputeTab(
  key: string,
  force: boolean,
  skipSync: boolean,
  deps: PoolPathResourceDeps,
): Promise<boolean> {
  const {
    cloudId,
    checkPerm,
    loadResource,
    setEcs,
    setRawEcs,
    setHarvesterSshKeys,
    setRawSshKeys,
    setHarvesterCloudInits,
    setRawCloudInits,
    setHarvesterTemplates,
    setRawTemplates,
    setHarvesterImages,
    setRawImages,
    setHarvesterMigrations,
    setRawMigrations,
    setHarvesterOvnMirrors,
    setRawOvnMirrors,
    setKubeOvnSubnets,
  } = deps;

  switch (key) {
    case 'ecs':
      if (checkPerm('clouds.ecs:read')) {
        await loadResource(
          'ecs',
          async () => {
            await syncCloudEcsBeforeLoad(cloudId, force, skipSync);
            return fetchComputeEcsList(cloudId, force);
          },
          (json) => {
            setEcs(parseEcsListFromJson(json));
            setRawEcs(json || null);
          },
          force,
        );
      }
      return true;
    case 'migrations':
      if (
        checkPerm('clouds.migrations:read') ||
        checkPerm('clouds.ecs:read')
      ) {
        await loadResource(
          'migrations',
          () => fetchComputeMigrationsList(cloudId, force),
          (list) => {
            setHarvesterMigrations(Array.isArray(list) ? list : []);
            setRawMigrations({ items: list });
          },
          force,
        );
      }
      return true;
    case 'traffic_mirror':
      if (
        checkPerm('clouds.traffic-mirroring.vpc:read') ||
        checkPerm('clouds.traffic-mirroring.flat:read') ||
        checkPerm('clouds.ecs:read')
      ) {
        if (checkPerm('clouds.ecs:read')) {
          await loadResource(
            'ecs',
            async () => {
              await syncCloudEcsBeforeLoad(cloudId, force, skipSync);
              return fetchComputeEcsList(cloudId, force);
            },
            (json) => {
              setEcs(parseEcsListFromJson(json));
              setRawEcs(json || null);
            },
            force,
          );
        }
        await loadResource(
          'subnets',
          () => fetchKubeOvnSubnets(cloudId, force),
          (json) => {
            const list: unknown[] = (json as { data?: { items?: unknown[] } })?.data?.items || [];
            setKubeOvnSubnets(Array.isArray(list) ? list : []);
          },
          force,
        );
        await loadResource(
          'ovnMirrors',
          () => fetchComputeOvnMirrorsList(cloudId, force),
          (result) => {
            const payload = result || { items: [], available: true };
            setHarvesterOvnMirrors(Array.isArray(payload.items) ? payload.items : []);
            setRawOvnMirrors(payload);
          },
          force,
        );
      }
      return true;
    case 'images':
      if (checkPerm('clouds.images:read') || checkPerm('clouds.ecs:read')) {
        await loadResource(
          'images',
          () => fetchHarvesterImages(cloudId, force, skipSync),
          (json) => {
            const list: any[] = Array.isArray((json as any)?.data?.items)
              ? (json as any).data.items
              : [];
            setHarvesterImages(Array.isArray(list) ? list : []);
            setRawImages(json || null);
          },
          force,
        );
      }
      return true;
    case 'ssh_keys':
      if (checkPerm('clouds.sshkeys:read')) {
        await loadResource(
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
        await loadResource(
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
        await loadResource(
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
