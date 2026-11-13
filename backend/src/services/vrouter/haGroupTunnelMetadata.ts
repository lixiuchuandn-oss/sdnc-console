import type { SRv6Tunnel } from '../../entities/vRouter/SRv6Tunnel';
import type { Srv6EndpointFingerprint } from '../../entities/vRouter/srv6Tunnel.types';
import type { FindManyOptions } from 'typeorm';

type Srv6TunnelRepository = {
  find(options?: FindManyOptions<SRv6Tunnel>): Promise<SRv6Tunnel[]>;
  save(tunnels: SRv6Tunnel[]): Promise<unknown>;
};

export function detachHaGroupFromSrv6Fingerprint(
  fingerprint: Srv6EndpointFingerprint | null | undefined,
  groupId: string,
): Srv6EndpointFingerprint | null | undefined {
  if (!fingerprint) return fingerprint;

  let changed = false;
  const next = { ...fingerprint };
  for (const slot of ['ceA', 'ceB'] as const) {
    const endpoint = fingerprint[slot];
    if (!endpoint || String(endpoint.haGroupId || '').trim() !== groupId) continue;

    const detached = { ...endpoint };
    delete detached.haGroupId;
    delete detached.haGroupName;
    delete detached.backupVrUuid;
    next[slot] = detached;
    changed = true;
  }

  return changed ? next : fingerprint;
}

export async function detachSrv6TunnelsFromHaGroup(
  repository: Srv6TunnelRepository,
  groupId: string,
): Promise<number> {
  const tunnels = await repository.find({ select: ['id', 'endpointFingerprint'] });
  const changed: SRv6Tunnel[] = [];
  for (const tunnel of tunnels) {
    const fingerprint = tunnel.endpointFingerprint;
    const detached = detachHaGroupFromSrv6Fingerprint(fingerprint, groupId);
    if (detached === fingerprint) continue;
    tunnel.endpointFingerprint = detached;
    changed.push(tunnel);
  }

  if (changed.length > 0) await repository.save(changed);
  return changed.length;
}
