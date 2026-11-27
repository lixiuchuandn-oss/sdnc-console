/**
 * 角色向导在「已有 SRv6 基线 + 存活隧道」时，把向导增量写回 srv6BaselineJson。
 * 不得把生效配置里的隧道贡献（neighbor / SID 路由等）冻进基线。
 */

import { TOWER_HUB_INVENTORY_KEY, isHubInventory } from './srv6.hubInventory';

const IFACE_BUCKETS = [
  'interfaces_GigabitEthernet',
  'subinterfaces_GigabitEthernet',
  'interfaces_lo',
  'interfaces_Tunnel',
  'subinterfaces_Tunnel',
] as const;

const IFACE_ROLE_KEYS = ['ipv4_static', 'ipv6_static', 'vrf', 'status', 'ipv6_nd_proxy'] as const;

const text = (v: unknown) => String(v ?? '').trim();

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const isPublicBgp = (b: Record<string, unknown>) =>
  b.vrf === undefined || b.vrf === null || String(b.vrf).trim() === '' || Number(b.vrf) === 0;

const bgpVrfKey = (b: Record<string, unknown>) => `vrf:${text(b.vrf)}`;

const isPreservedTunnelIpv6Route = (row: Record<string, unknown>): boolean => {
  const vrf = row.vrf;
  if (vrf !== undefined && vrf !== null && String(vrf).trim() !== '' && Number(vrf) !== 0) {
    return true;
  }
  return /^nexthop-vrf/i.test(String(row.via ?? '').trim());
};

const ipv6Dest = (row: Record<string, unknown>) => text(row.destination);

const collectRoleWanDevs = (incoming: Record<string, unknown>): Set<string> => {
  const out = new Set<string>();
  const inv = incoming[TOWER_HUB_INVENTORY_KEY];
  if (isHubInventory(inv)) {
    for (const w of inv.wan) {
      const n = text(w.ifName);
      if (n) out.add(n);
    }
  }
  const pe = incoming.pe && typeof incoming.pe === 'object' ? (incoming.pe as Record<string, unknown>) : {};
  const pub =
    pe.publicConfig && typeof pe.publicConfig === 'object'
      ? (pe.publicConfig as Record<string, unknown>)
      : {};
  const wan = text(pub.wanName || pub.wanDev);
  if (wan) out.add(wan);
  return out;
};

const collectRoleIpv6Dests = (incoming: Record<string, unknown>): Set<string> => {
  const out = new Set<string>();
  const inv = incoming[TOWER_HUB_INVENTORY_KEY];
  if (isHubInventory(inv)) {
    for (const w of inv.wan) {
      const d = text(w.ipv6Dest);
      if (d) out.add(d);
    }
  }
  const pe = incoming.pe && typeof incoming.pe === 'object' ? (incoming.pe as Record<string, unknown>) : {};
  const pub =
    pe.publicConfig && typeof pe.publicConfig === 'object'
      ? (pe.publicConfig as Record<string, unknown>)
      : {};
  const d = text(pub.ipv6Dest);
  if (d) out.add(d);
  return out;
};

const mergeRoleInterfaces = (
  baseline: Record<string, unknown>,
  incoming: Record<string, unknown>,
): void => {
  for (const key of IFACE_BUCKETS) {
    const next = Array.isArray(incoming[key]) ? (incoming[key] as Record<string, unknown>[]) : [];
    if (!next.length) continue;
    const cur = Array.isArray(baseline[key]) ? [...(baseline[key] as Record<string, unknown>[])] : [];
    for (const item of next) {
      const name = text(item?.name);
      if (!name) continue;
      const idx = cur.findIndex((c) => text(c?.name) === name);
      if (idx < 0) {
        const copied: Record<string, unknown> = { name };
        for (const k of IFACE_ROLE_KEYS) {
          if (item[k] !== undefined) copied[k] = item[k];
        }
        cur.push(copied);
        continue;
      }
      const old = cur[idx];
      const merged: Record<string, unknown> = { ...old };
      for (const k of IFACE_ROLE_KEYS) {
        if (item[k] === undefined) continue;
        merged[k] = item[k];
      }
      cur[idx] = merged;
    }
    baseline[key] = cur;
  }
};

const mergeRoleVrfAndLanBgp = (
  baseline: Record<string, unknown>,
  incoming: Record<string, unknown>,
): void => {
  const nextVrf = Array.isArray(incoming.vrf) ? (incoming.vrf as unknown[]).map(Number) : [];
  if (nextVrf.length) {
    const curVrf = Array.isArray(baseline.vrf) ? (baseline.vrf as unknown[]).map(Number) : [];
    const extra = nextVrf.filter((v) => Number.isFinite(v) && !curVrf.includes(v));
    if (extra.length) baseline.vrf = [...curVrf, ...extra];
  }

  const nextBgp = Array.isArray(incoming.bgp) ? (incoming.bgp as Record<string, unknown>[]) : [];
  const curBgp = Array.isArray(baseline.bgp) ? [...(baseline.bgp as Record<string, unknown>[])] : [];
  const curKeys = new Set(curBgp.filter((b) => !isPublicBgp(b)).map(bgpVrfKey));
  let added = false;
  for (const b of nextBgp) {
    if (!b || typeof b !== 'object' || isPublicBgp(b)) continue;
    const k = bgpVrfKey(b);
    if (!text(b.vrf) || curKeys.has(k)) continue;
    curBgp.push(clone(b));
    curKeys.add(k);
    added = true;
  }
  if (added) baseline.bgp = curBgp;
};

const peLanConfigRows = (pe: Record<string, unknown> | undefined): Record<string, unknown>[] => {
  if (!pe) return [];
  const raw = pe.lanConfig ?? pe.lanConfigs;
  return Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
};

const lanVrfKey = (row: Record<string, unknown>) => text(row.vrf);

const unionLanConfigByVrf = (
  cur: Record<string, unknown>[],
  next: Record<string, unknown>[],
): Record<string, unknown>[] => {
  const byVrf = new Map<string, Record<string, unknown>>();
  for (const row of cur) {
    const k = lanVrfKey(row);
    if (k) byVrf.set(k, clone(row));
  }
  for (const row of next) {
    const k = lanVrfKey(row);
    if (!k) continue;
    byVrf.set(k, { ...(byVrf.get(k) || {}), ...clone(row) });
  }
  return [...byVrf.values()];
};

const unionInventoryByKeys = (
  cur: Record<string, unknown>,
  next: Record<string, unknown>,
): Record<string, unknown> => {
  const curWan = Array.isArray(cur.wan) ? (cur.wan as Record<string, unknown>[]) : [];
  const nextWan = Array.isArray(next.wan) ? (next.wan as Record<string, unknown>[]) : [];
  const wanByIf = new Map<string, Record<string, unknown>>();
  for (const w of curWan) {
    const k = text(w.ifName);
    if (k) wanByIf.set(k, clone(w));
  }
  for (const w of nextWan) {
    const k = text(w.ifName);
    if (!k) continue;
    wanByIf.set(k, { ...(wanByIf.get(k) || {}), ...clone(w) });
  }

  const curLan = Array.isArray(cur.lan) ? (cur.lan as Record<string, unknown>[]) : [];
  const nextLan = Array.isArray(next.lan) ? (next.lan as Record<string, unknown>[]) : [];
  const lanByVrf = new Map<string, Record<string, unknown>>();
  for (const l of curLan) {
    const k = text(l.vrf);
    if (k) lanByVrf.set(k, clone(l));
  }
  for (const l of nextLan) {
    const k = text(l.vrf);
    if (!k) continue;
    lanByVrf.set(k, { ...(lanByVrf.get(k) || {}), ...clone(l) });
  }

  return {
    ...cur,
    ...next,
    wan: [...wanByIf.values()],
    lan: [...lanByVrf.values()],
  };
};

/** 角色向导合并失败（含试图删掉基线已有 Hub WAN/LAN）→ upsert 须非 200 */
export class RoleWizardBaselineMergeError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 409) {
    super(message);
    this.name = 'RoleWizardBaselineMergeError';
    this.statusCode = statusCode;
  }
}

const baselineHubLanVrfs = (baseline: Record<string, unknown>): Set<string> => {
  const out = new Set<string>();
  const pe =
    baseline.pe && typeof baseline.pe === 'object' && !Array.isArray(baseline.pe)
      ? (baseline.pe as Record<string, unknown>)
      : undefined;
  for (const row of peLanConfigRows(pe)) {
    const k = lanVrfKey(row);
    if (k) out.add(k);
  }
  const inv = baseline[TOWER_HUB_INVENTORY_KEY];
  if (isHubInventory(inv)) {
    for (const l of inv.lan) {
      const k = text(l.vrf);
      if (k) out.add(k);
    }
  }
  return out;
};

const baselineHubWanIfNames = (baseline: Record<string, unknown>): Set<string> => {
  const out = new Set<string>();
  const inv = baseline[TOWER_HUB_INVENTORY_KEY];
  if (isHubInventory(inv)) {
    for (const w of inv.wan) {
      const k = text(w.ifName);
      if (k) out.add(k);
    }
  }
  const pe =
    baseline.pe && typeof baseline.pe === 'object' && !Array.isArray(baseline.pe)
      ? (baseline.pe as Record<string, unknown>)
      : undefined;
  const pub =
    pe?.publicConfig && typeof pe.publicConfig === 'object' && !Array.isArray(pe.publicConfig)
      ? (pe.publicConfig as Record<string, unknown>)
      : {};
  const wan = text(pub.wanName || pub.wanDev);
  if (wan) out.add(wan);
  return out;
};

/**
 * 有存活隧道时禁止提交缩减基线已有 Hub WAN/LAN（删 Tab 会整表盖掉 pe.lanConfig / inventory）。
 */
export const assertRoleWizardDoesNotDropBaselineHubRows = (
  baseline: Record<string, unknown>,
  incoming: Record<string, unknown>,
): void => {
  const requiredLan = baselineHubLanVrfs(baseline);
  const requiredWan = baselineHubWanIfNames(baseline);
  if (!requiredLan.size && !requiredWan.size) return;

  const nextPe =
    incoming.pe && typeof incoming.pe === 'object' && !Array.isArray(incoming.pe)
      ? (incoming.pe as Record<string, unknown>)
      : undefined;
  const nextInv = incoming[TOWER_HUB_INVENTORY_KEY];
  const hasLanPayload = Boolean(nextPe && (nextPe.lanConfig != null || nextPe.lanConfigs != null));
  const hasInvPayload = isHubInventory(nextInv);

  if (requiredLan.size && (hasLanPayload || hasInvPayload)) {
    const got = new Set<string>();
    if (hasLanPayload) {
      for (const row of peLanConfigRows(nextPe)) {
        const k = lanVrfKey(row);
        if (k) got.add(k);
      }
    }
    if (hasInvPayload) {
      for (const l of (nextInv as { lan: Array<{ vrf?: unknown }> }).lan) {
        const k = text(l.vrf);
        if (k) got.add(k);
      }
    }
    const missing = [...requiredLan].filter((v) => !got.has(v));
    if (missing.length) {
      throw new RoleWizardBaselineMergeError(
        `已被隧道引用的 LAN VRF 不可删除：${missing.join('、')}。如需调整，请先删除相关隧道。`,
      );
    }
  }

  if (requiredWan.size && hasInvPayload) {
    const got = new Set<string>();
    for (const w of (nextInv as { wan: Array<{ ifName?: unknown }> }).wan) {
      const k = text(w.ifName);
      if (k) got.add(k);
    }
    const missing = [...requiredWan].filter((v) => !got.has(v));
    if (missing.length) {
      throw new RoleWizardBaselineMergeError(
        `已被隧道引用的 WAN 接口不可删除：${missing.join('、')}。如需调整，请先删除相关隧道。`,
      );
    }
  }
};

const mergeRolePeAndInventory = (
  baseline: Record<string, unknown>,
  incoming: Record<string, unknown>,
): void => {
  if (incoming.pe && typeof incoming.pe === 'object' && !Array.isArray(incoming.pe)) {
    const curPe =
      baseline.pe && typeof baseline.pe === 'object' && !Array.isArray(baseline.pe)
        ? { ...(baseline.pe as Record<string, unknown>) }
        : {};
    const nextPe = incoming.pe as Record<string, unknown>;
    const curPub =
      curPe.publicConfig && typeof curPe.publicConfig === 'object' && !Array.isArray(curPe.publicConfig)
        ? { ...(curPe.publicConfig as Record<string, unknown>) }
        : {};
    const nextPub =
      nextPe.publicConfig && typeof nextPe.publicConfig === 'object' && !Array.isArray(nextPe.publicConfig)
        ? (nextPe.publicConfig as Record<string, unknown>)
        : {};
    const curLan = peLanConfigRows(curPe);
    const nextLan = peLanConfigRows(nextPe);
    const nextPeRest = { ...nextPe };
    delete nextPeRest.lanConfig;
    delete nextPeRest.lanConfigs;
    baseline.pe = {
      ...curPe,
      ...nextPeRest,
      publicConfig: { ...curPub, ...nextPub },
      lanConfig: unionLanConfigByVrf(curLan, nextLan.length ? nextLan : curLan),
    };
  }

  const inv = incoming[TOWER_HUB_INVENTORY_KEY];
  if (isHubInventory(inv)) {
    const curInv = baseline[TOWER_HUB_INVENTORY_KEY];
    baseline[TOWER_HUB_INVENTORY_KEY] = isHubInventory(curInv)
      ? unionInventoryByKeys(curInv as unknown as Record<string, unknown>, inv as unknown as Record<string, unknown>)
      : clone(inv);
  }

  if (incoming.role != null) baseline.role = incoming.role;
  if (incoming.segment_routing_srv6 && typeof incoming.segment_routing_srv6 === 'object') {
    baseline.segment_routing_srv6 = clone(incoming.segment_routing_srv6);
  }
};

const mergeRoleRoutes = (
  baseline: Record<string, unknown>,
  incoming: Record<string, unknown>,
): void => {
  const roleDevs = collectRoleWanDevs(incoming);
  if (Array.isArray(incoming.ipv4_route) && roleDevs.size) {
    const incomingV4 = incoming.ipv4_route.filter(
      (r): r is Record<string, unknown> => !!r && typeof r === 'object' && !Array.isArray(r),
    );
    const fromIncoming = incomingV4.filter((r) => {
      const dev = text(r.dev);
      return !dev || roleDevs.has(dev);
    });
    const keep = Array.isArray(baseline.ipv4_route)
      ? (baseline.ipv4_route as unknown[]).filter((r) => {
          if (!r || typeof r !== 'object' || Array.isArray(r)) return true;
          const dev = text((r as Record<string, unknown>).dev);
          return !dev || !roleDevs.has(dev);
        })
      : [];
    baseline.ipv4_route = [...keep, ...fromIncoming];
  }

  const roleDests = collectRoleIpv6Dests(incoming);
  if (Array.isArray(incoming.ipv6_route) && roleDests.size) {
    const incomingV6 = incoming.ipv6_route.filter(
      (r): r is Record<string, unknown> => !!r && typeof r === 'object' && !Array.isArray(r),
    );
    const fromIncoming = incomingV6.filter(
      (r) => !isPreservedTunnelIpv6Route(r) && roleDests.has(ipv6Dest(r)),
    );
    const keep = Array.isArray(baseline.ipv6_route)
      ? (baseline.ipv6_route as unknown[]).filter((r) => {
          if (!r || typeof r !== 'object' || Array.isArray(r)) return true;
          const row = r as Record<string, unknown>;
          if (isPreservedTunnelIpv6Route(row)) return true;
          return !roleDests.has(ipv6Dest(row));
        })
      : [];
    // 去重：多 WAN 行同目的/同网关只保留一条（也清理历史重复）
    const seen6 = new Set<string>();
    baseline.ipv6_route = [...keep, ...fromIncoming].filter((r) => {
      if (!r || typeof r !== 'object' || Array.isArray(r)) return true;
      const row = r as Record<string, unknown>;
      const key = `${ipv6Dest(row)}|${text(row.via)}|${text(row.vrf)}`;
      if (seen6.has(key)) return false;
      seen6.add(key);
      return true;
    });
  }
};

/**
 * 将角色向导提交的增量合并进 SRv6 向导基线（不覆盖隧道贡献字段）。
 * 调用方须先保证 baseline 可解析；本函数会拒绝缩减已有 Hub WAN/LAN。
 */
export const mergeRoleWizardIntentIntoBaseline = (
  baseline: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> => {
  if (!baseline || typeof baseline !== 'object' || Array.isArray(baseline)) {
    throw new RoleWizardBaselineMergeError('SRv6 基线无效，无法合并角色向导增量', 500);
  }
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
    throw new RoleWizardBaselineMergeError('角色向导提交配置无效', 400);
  }
  assertRoleWizardDoesNotDropBaselineHubRows(baseline, incoming);
  const next = clone(baseline);
  mergeRoleInterfaces(next, incoming);
  mergeRoleVrfAndLanBgp(next, incoming);
  mergeRolePeAndInventory(next, incoming);
  mergeRoleRoutes(next, incoming);
  return next;
};
