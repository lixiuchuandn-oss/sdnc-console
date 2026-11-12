import { In } from 'typeorm';
import { AppDataSource } from '../../config/database';
import { IbrHaGroup } from '../../entities/vRouter/IbrHaGroup';
import { IbrHaGroupMember } from '../../entities/vRouter/IbrHaGroupMember';
import type { Srv6EndpointFingerprint } from '../../entities/vRouter/srv6Tunnel.types';

export type HaGroupLite = {
  id: string;
  name: string;
  members: Array<{ role: string; vrUuid: string }>;
};

export type HaFpLite = {
  haGroupId?: string | null;
  /** 同组另一台成员（不论本端是主还是备） */
  backupVrUuid?: string | null;
};

const norm = (v: unknown) => String(v ?? '').trim();

function membersOf(group: HaGroupLite, role: 'primary' | 'backup'): string {
  return norm(group.members.find((m) => m.role === role)?.vrUuid);
}

function memberUuids(group: HaGroupLite): string[] {
  return (group.members || []).map((m) => norm(m.vrUuid)).filter(Boolean);
}

function homeGroupOf(groups: HaGroupLite[], ceUuid: string): HaGroupLite | undefined {
  const ce = norm(ceUuid);
  if (!ce) return undefined;
  return groups.find((g) => memberUuids(g).includes(ce));
}

/**
 * 隧道 CE 与 HA 组：HA 仅作指纹标注。
 * - 同一 HA 组的主备不能作为一条隧道的两端 CE（同组另一台须另建隧道）。
 * - CE 属于某组时必须写入该组标注，避免保存时抹掉解散门闩。
 * - 有 haGroupId 时校验端点属于该组成员，peer（backupVrUuid）为同组另一台。
 * - 无组成员关系且无标注则放行。不强制两端同为 HA，不强制逻辑主。
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
  const byId = new Map(input.groups.map((g) => [g.id, g]));

  for (const g of input.groups) {
    const members = memberUuids(g);
    if (ceA && ceB && members.includes(ceA) && members.includes(ceB)) {
      return {
        ok: false,
        message: `CE-A 与 CE-B 不能是同一高可用组「${g.name}」的主备成员；同组另一台请另建隧道单独下发`,
      };
    }
  }

  const checkSide = (
    label: 'CE-A' | 'CE-B',
    ceUuid: string,
    fp?: HaFpLite | null,
  ): string | null => {
    const ce = norm(ceUuid);
    const groupId = norm(fp?.haGroupId);
    const home = homeGroupOf(input.groups, ce);
    if (home && !groupId) {
      return `${label} 属于高可用组「${home.name}」，须写入组标注`;
    }
    if (!groupId) return null;
    const g = byId.get(groupId);
    if (!g) return `${label} 标注的高可用组不存在`;
    const primary = membersOf(g, 'primary');
    const backup = membersOf(g, 'backup');
    if (!primary || !backup) {
      return `${label} 高可用组「${g.name}」主备成员不完整`;
    }
    const members = memberUuids(g);
    if (!members.includes(ce)) {
      return `${label} 须为高可用组「${g.name}」的成员`;
    }
    const peer = norm(fp?.backupVrUuid);
    if (peer) {
      const expectedPeer = ce === primary ? backup : primary;
      if (peer !== expectedPeer) {
        return `${label} 同组另一台成员与高可用组「${g.name}」不一致`;
      }
    }
    return null;
  };

  const aErr = checkSide('CE-A', ceA, input.fpA);
  if (aErr) return { ok: false, message: aErr };
  const bErr = checkSide('CE-B', ceB, input.fpB);
  if (bErr) return { ok: false, message: bErr };
  return { ok: true };
}

function toLite(g: IbrHaGroup): HaGroupLite {
  return {
    id: g.id,
    name: g.name,
    members: (g.members || []).map((m) => ({ role: m.role, vrUuid: m.vrUuid })),
  };
}

export async function assertSrv6TunnelHaCePair(tunnel: {
  ceA: string;
  ceB: string;
  endpointFingerprint?: Srv6EndpointFingerprint | null;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const fpA = tunnel.endpointFingerprint?.ceA ?? null;
  const fpB = tunnel.endpointFingerprint?.ceB ?? null;
  const ceIds = [norm(tunnel.ceA), norm(tunnel.ceB)].filter(Boolean);
  const fpIds = [norm(fpA?.haGroupId), norm(fpB?.haGroupId)].filter(Boolean);

  let memberGroupIds: string[] = [];
  if (ceIds.length > 0) {
    const hits = await AppDataSource.getRepository(IbrHaGroupMember).find({
      where: { vrUuid: In(ceIds) },
    });
    memberGroupIds = hits.map((h) => h.groupId);
  }

  const ids = [...new Set([...fpIds, ...memberGroupIds].filter(Boolean))];
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
    groups: groups.map(toLite),
  });
}
