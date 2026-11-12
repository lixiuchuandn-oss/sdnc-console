import { In } from 'typeorm';
import { AppDataSource } from '../../config/database';
import { IbrHaGroup } from '../../entities/vRouter/IbrHaGroup';
import type { Srv6EndpointFingerprint } from '../../entities/vRouter/srv6Tunnel.types';

export type HaGroupLite = {
  id: string;
  name: string;
  members: Array<{ role: string; vrUuid: string }>;
};

export type HaFpLite = {
  haGroupId?: string | null;
  backupVrUuid?: string | null;
};

const norm = (v: unknown) => String(v ?? '').trim();

function membersOf(group: HaGroupLite, role: 'primary' | 'backup'): string {
  return norm(group.members.find((m) => m.role === role)?.vrUuid);
}

/**
 * 隧道 CE 接入：两端同为高可用组，或同为单台 CE。
 * HA 时隧道端点必须是各组逻辑主；备机不下发、不进四端档案。
 */
export function evaluateSrv6HaCePair(input: {
  ceA: string;
  ceB: string;
  fpA?: HaFpLite | null;
  fpB?: HaFpLite | null;
  groups: HaGroupLite[];
}): { ok: true } | { ok: false; message: string } {
  const ceA = norm(input.ceA);
  const ceB = norm(input.ceB);
  const haA = norm(input.fpA?.haGroupId);
  const haB = norm(input.fpB?.haGroupId);

  if (!haA && !haB) return { ok: true };
  if (!haA || !haB) {
    return { ok: false, message: 'CE 接入须两端同为高可用组，或同为单台 CE；不能一端 HA、一端标准' };
  }
  if (haA === haB) {
    return { ok: false, message: '两端不能选择同一高可用组' };
  }

  const byId = new Map(input.groups.map((g) => [g.id, g]));

  const checkSide = (
    label: 'CE-A' | 'CE-B',
    ceUuid: string,
    groupId: string,
    fp?: HaFpLite | null,
  ): string | null => {
    const g = byId.get(groupId);
    if (!g) return `${label} 绑定的高可用组不存在`;
    const primary = membersOf(g, 'primary');
    const backup = membersOf(g, 'backup');
    if (!primary || !backup) {
      return `${label} 高可用组「${g.name}」主备成员不完整`;
    }
    if (primary !== ceUuid) {
      return `${label} 须为高可用组「${g.name}」的逻辑主（备机不下发、不作为隧道端点）`;
    }
    const fpBackup = norm(fp?.backupVrUuid);
    if (fpBackup && fpBackup !== backup) {
      return `${label} 备机与高可用组「${g.name}」不一致`;
    }
    return null;
  };

  const aErr = checkSide('CE-A', ceA, haA, input.fpA);
  if (aErr) return { ok: false, message: aErr };
  const bErr = checkSide('CE-B', ceB, haB, input.fpB);
  if (bErr) return { ok: false, message: bErr };

  const gA = byId.get(haA)!;
  const gB = byId.get(haB)!;
  if (membersOf(gA, 'primary') === membersOf(gB, 'primary')) {
    return { ok: false, message: '两端高可用组的主 CE 不能相同' };
  }
  if (ceB === membersOf(gA, 'backup') || ceA === membersOf(gB, 'backup')) {
    return { ok: false, message: '隧道 CE 端点不能使用对端高可用组的备机' };
  }
  return { ok: true };
}

export async function assertSrv6TunnelHaCePair(tunnel: {
  ceA: string;
  ceB: string;
  endpointFingerprint?: Srv6EndpointFingerprint | null;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const fpA = tunnel.endpointFingerprint?.ceA ?? null;
  const fpB = tunnel.endpointFingerprint?.ceB ?? null;
  const haA = norm(fpA?.haGroupId);
  const haB = norm(fpB?.haGroupId);
  if (!haA && !haB) return { ok: true };

  const ids = [...new Set([haA, haB].filter(Boolean))];
  const groups =
    ids.length > 0
      ? await AppDataSource.getRepository(IbrHaGroup).find({
          where: { id: In(ids) },
          relations: ['members'],
        })
      : [];
  return evaluateSrv6HaCePair({
    ceA: tunnel.ceA,
    ceB: tunnel.ceB,
    fpA,
    fpB,
    groups: groups.map((g) => ({
      id: g.id,
      name: g.name,
      members: (g.members || []).map((m) => ({ role: m.role, vrUuid: m.vrUuid })),
    })),
  });
}
