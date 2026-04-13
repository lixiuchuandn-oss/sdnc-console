import {
  fetchCloudProviderEcs,
  fetchHarvesterBackups,
  fetchHarvesterCloudInits,
  fetchHarvesterScheduleVmBackups,
  fetchHarvesterSnapshots,
  fetchHarvesterSshKeys,
  fetchHarvesterTemplates,
} from '../../runtime/api';
import type { LoadTabResourceDeps } from '../types';

/** 卷快照、备份、SSH、Cloud-init、模板等存储/算力周边 Tab */
export async function tryLoadStorageTab(
  key: string,
  force: boolean,
  _skipSync: boolean,
  deps: LoadTabResourceDeps,
): Promise<boolean> {
  const {
    cloudId,
    checkPerm,
    loadResource,
    setEcs,
    setRawEcs,
    setHarvesterSnapshots,
    setRawSnapshots,
    setHarvesterBackups,
    setRawBackups,
    setHarvesterScheduleVmBackups,
    setRawScheduleVmBackups,
    setHarvesterSshKeys,
    setRawSshKeys,
    setHarvesterCloudInits,
    setRawCloudInits,
    setHarvesterTemplates,
    setRawTemplates,
  } = deps;

  switch (key) {
    case 'volumes':
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
    case 'backups':
      if (checkPerm('clouds.backups:read')) {
        loadResource(
          'backups',
          () => fetchHarvesterBackups(cloudId, force),
          (json) => {
            const list: any[] = Array.isArray((json as any)?.data?.items)
              ? (json as any).data.items
              : [];
            setHarvesterBackups(Array.isArray(list) ? list : []);
            setRawBackups(json || null);
          },
          force,
        );
        loadResource(
          'scheduleVmBackups',
          () => fetchHarvesterScheduleVmBackups(cloudId, force),
          (json) => {
            const list: any[] = Array.isArray((json as any)?.data?.items)
              ? (json as any).data.items
              : [];
            setHarvesterScheduleVmBackups(Array.isArray(list) ? list : []);
            setRawScheduleVmBackups(json || null);
          },
          force,
        );
      }
      return true;
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
