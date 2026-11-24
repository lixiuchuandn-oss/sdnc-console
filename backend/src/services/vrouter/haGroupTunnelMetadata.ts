import type { SRv6Tunnel } from '../../entities/vRouter/SRv6Tunnel';
import type { Srv6EndpointFingerprint } from '../../entities/vRouter/srv6Tunnel.types';
import type { FindManyOptions } from 'typeorm';

type Srv6TunnelRepository = {
  find(options?: FindManyOptions<SRv6Tunnel>): Promise<SRv6Tunnel[]>;
  save(tunnels: SRv6Tunnel[]): Promise<unknown>;
};

export type Srv6CeHaAnnotation = {
  haGroupId: string;
  haGroupName: string;
  backupVrUuid: string;
};

export type HaGroupSrv6AttachSpec = {
  groupId: string;
  groupName: string;
  primaryUuid: string;
  backupUuid: string;
};

const norm = (v: unknown) => String(v ?? '').trim();

function annotationEquals(
  endpoint: Srv6EndpointFingerprint['ceA'] | undefined,
  annotation: Srv6CeHaAnnotation,
): boolean {
  return (
    Boolean(endpoint) &&
    norm(endpoint?.haGroupId) === annotation.haGroupId &&
    norm(endpoint?.haGroupName) === annotation.haGroupName &&
    norm(endpoint?.backupVrUuid) === annotation.backupVrUuid
  );
}

export function buildCeHaAnnotationIndex(
  groups: Array<{
    id?: string | null;
    name?: string | null;
    members?: Array<{ role?: string | null; vrUuid?: string | null }>;
  }>,
): Map<string, Srv6CeHaAnnotation> {
  const index = new Map<string, Srv6CeHaAnnotation>();
  for (const group of groups || []) {
    const groupId = norm(group.id);
    const groupName = norm(group.name);
    const members = group.members || [];
    const primaryUuid = norm(members.find((m) => m.role === 'primary')?.vrUuid);
    const backupUuid = norm(members.find((m) => m.role === 'backup')?.vrUuid);
    if (!groupId || !primaryUuid || !backupUuid || primaryUuid === backupUuid) continue;
    index.set(primaryUuid, {
      haGroupId: groupId,
      haGroupName: groupName,
      backupVrUuid: backupUuid,
    });
    index.set(backupUuid, {
      haGroupId: groupId,
      haGroupName: groupName,
      backupVrUuid: primaryUuid,
    });
  }
  return index;
}

export function annotationIndexFromHaGroupSpec(
  spec: HaGroupSrv6AttachSpec,
): Map<string, Srv6CeHaAnnotation> {
  return buildCeHaAnnotationIndex([
    {
      id: spec.groupId,
      name: spec.groupName,
      members: [
        { role: 'primary', vrUuid: spec.primaryUuid },
        { role: 'backup', vrUuid: spec.backupUuid },
      ],
    },
  ]);
}

/**
 * 按隧道 CE uuid 写入/刷新 HA 标注。只动 ceA/ceB 指纹，不改隧道端点本身。
 */
export function annotateSrv6FingerprintByCeUuid(
  fingerprint: Srv6EndpointFingerprint | null | undefined,
  endpoints: { ceA?: string | null; ceB?: string | null },
  byVrUuid: ReadonlyMap<string, Srv6CeHaAnnotation>,
): Srv6EndpointFingerprint | null | undefined {
  if (!byVrUuid.size) return fingerprint;

  let changed = false;
  const next: Srv6EndpointFingerprint = fingerprint ? { ...fingerprint } : {};
  for (const slot of ['ceA', 'ceB'] as const) {
    const uuid = norm(endpoints[slot]);
    if (!uuid) continue;
    const annotation = byVrUuid.get(uuid);
    if (!annotation) continue;
    const current = next[slot];
    if (annotationEquals(current, annotation)) continue;
    next[slot] = { ...(current || {}), ...annotation };
    changed = true;
  }

  if (!changed) return fingerprint;
  return next;
}

export function presentSrv6TunnelsWithLiveHa<
  T extends {
    ceA?: string | null;
    ceB?: string | null;
    endpointFingerprint?: Srv6EndpointFingerprint | null;
  },
>(tunnels: T[], byVrUuid: ReadonlyMap<string, Srv6CeHaAnnotation>): T[] {
  if (!byVrUuid.size) return tunnels;
  return tunnels.map((tunnel) => {
    const fingerprint = annotateSrv6FingerprintByCeUuid(
      tunnel.endpointFingerprint,
      { ceA: tunnel.ceA, ceB: tunnel.ceB },
      byVrUuid,
    );
    if (fingerprint === tunnel.endpointFingerprint) return tunnel;
    return { ...tunnel, endpointFingerprint: fingerprint };
  });
}

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

export async function attachSrv6TunnelsToHaGroup(
  repository: Srv6TunnelRepository,
  spec: HaGroupSrv6AttachSpec,
): Promise<number> {
  const byVrUuid = annotationIndexFromHaGroupSpec(spec);
  if (!byVrUuid.size) return 0;

  const tunnels = await repository.find({
    select: ['id', 'ceA', 'ceB', 'endpointFingerprint'],
  });
  const changed: SRv6Tunnel[] = [];
  for (const tunnel of tunnels) {
    const fingerprint = tunnel.endpointFingerprint;
    const annotated = annotateSrv6FingerprintByCeUuid(
      fingerprint,
      { ceA: tunnel.ceA, ceB: tunnel.ceB },
      byVrUuid,
    );
    if (annotated === fingerprint) continue;
    tunnel.endpointFingerprint = annotated;
    changed.push(tunnel);
  }

  if (changed.length > 0) await repository.save(changed);
  return changed.length;
}
