import { AppDataSource } from '../../config/database';
import { SRv6Tunnel } from '../../entities/vRouter/SRv6Tunnel';

export type Srv6TunnelEndpointLite = {
  id: string;
  name: string;
  peA: string;
  peB: string;
  ceA: string;
  ceB: string;
};

const norm = (v: unknown) => String(v ?? '').trim();

export function toSrv6TunnelEndpointLite(t: {
  id: string;
  name: string;
  peA: string;
  peB: string;
  ceA: string;
  ceB: string;
}): Srv6TunnelEndpointLite {
  return {
    id: String(t.id),
    name: String(t.name || t.id),
    peA: norm(t.peA),
    peB: norm(t.peB),
    ceA: norm(t.ceA),
    ceB: norm(t.ceB),
  };
}

/**
 * 主备是否同一条隧道的 CE-A / CE-B（或对调）——硬禁止。
 */
export function findOppositeCePairTunnelNames(
  tunnels: Srv6TunnelEndpointLite[],
  uuidA: string,
  uuidB: string,
): string[] {
  const a = norm(uuidA);
  const b = norm(uuidB);
  if (!a || !b || a === b) return [];
  const names: string[] = [];
  for (const t of tunnels) {
    const pair =
      (t.ceA === a && t.ceB === b) || (t.ceA === b && t.ceB === a);
    if (pair) names.push(t.name);
  }
  return [...new Set(names)];
}

function slotsOf(t: Srv6TunnelEndpointLite, uuid: string): string[] {
  const id = norm(uuid);
  if (!id) return [];
  const slots: string[] = [];
  if (t.peA === id) slots.push('PE-A');
  if (t.peB === id) slots.push('PE-B');
  if (t.ceA === id) slots.push('CE-A');
  if (t.ceB === id) slots.push('CE-B');
  return slots;
}

/**
 * 软提示：成员已是存活隧道端点时，建组不会自动改隧道指纹。
 */
export function buildHaMemberTunnelEndpointWarnings(
  tunnels: Srv6TunnelEndpointLite[],
  primaryUuid: string,
  backupUuid: string,
): string[] {
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const role of [
    { label: '主节点', uuid: primaryUuid },
    { label: '备节点', uuid: backupUuid },
  ]) {
    const hits: string[] = [];
    for (const t of tunnels) {
      const slots = slotsOf(t, role.uuid);
      if (!slots.length) continue;
      hits.push(`「${t.name}」${slots.join('/')}`);
    }
    if (!hits.length) continue;
    const key = `${role.label}:${hits.join('|')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    warnings.push(
      `${role.label}已被 SRv6 隧道引用（${hits.join('、')}）。建组/下发 VRRP 不会自动改隧道档案；隧道端点仍为所选 CE，指纹可标注所属 HA 组。`,
    );
  }
  return warnings;
}

async function loadTunnelLites(): Promise<Srv6TunnelEndpointLite[]> {
  const list = await AppDataSource.getRepository(SRv6Tunnel).find({
    select: ['id', 'name', 'peA', 'peB', 'ceA', 'ceB'],
  });
  return list.map(toSrv6TunnelEndpointLite);
}

export async function assertHaMembersNotOppositeCesOnSameTunnel(
  primaryUuid: string,
  backupUuid: string,
): Promise<void> {
  const tunnels = await loadTunnelLites();
  const names = findOppositeCePairTunnelNames(tunnels, primaryUuid, backupUuid);
  if (!names.length) return;
  const err = new Error(
    `主备不能是同一条 SRv6 隧道的两端 CE（${names.join('、')}）。对端两台请分别建组，或先调整隧道端点。`,
  );
  (err as Error & { statusCode: number }).statusCode = 409;
  throw err;
}

export async function collectHaMemberTunnelEndpointWarnings(
  primaryUuid: string,
  backupUuid: string,
): Promise<string[]> {
  const tunnels = await loadTunnelLites();
  return buildHaMemberTunnelEndpointWarnings(tunnels, primaryUuid, backupUuid);
}
