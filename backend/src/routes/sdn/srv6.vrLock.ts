import { AppDataSource } from '../../config/database';
import { SRv6Tunnel } from '../../entities/vRouter/SRv6Tunnel';
import { VRConfig } from '../../entities/vRouter/VRConfig';
import { isSrv6PeRole, normalizeVrRole } from './srv6.roles';
import {
  computeLiveFingerprintForSlot,
  diffFingerprintFields,
  getStoredFingerprintForSlot,
} from './srv6.archive';
import type { Srv6EndpointSlot } from './srv6.archive.types';
import { findSrv6TunnelsReferencingVr } from './srv6.references';
import { resolveHubLanIfFromTunnel } from './srv6.hub';
import { TOWER_HUB_INVENTORY_KEY } from './srv6.hubInventory';

const parseConfig = (json: string | null | undefined): Record<string, unknown> | null => {
  if (!json) return null;
  try {
    const o = JSON.parse(json);
    return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

const slotDisplay = (slot: Srv6EndpointSlot) =>
  ({ peA: 'PE-A', peB: 'PE-B', ceA: 'CE-A', ceB: 'CE-B' } as const)[slot];

const fingerprintFieldLabel: Record<string, string> = {
  publicIpv6: '公网 IPv6',
  publicIpv4: '公网 IPv4',
  publicBgpAsn: '公网 BGP 自治号',
  sidPrefix: 'SRv6 SID 前缀',
  innerIf: '内网接口',
  innerIp: '内网 IP',
  innerVrf: '内网 VRF',
  innerBgpAsn: '内网 BGP 自治号',
  wanIf: 'Hub WAN 接口',
  peerPublicNeighbor: 'Hub 对端公网邻居',
};

const hubPeLockedFingerprintFields = (
  tunnel: SRv6Tunnel,
  slot: Srv6EndpointSlot,
): Set<string> | null => {
  if (tunnel.tunnelTopology !== 'H' || !tunnel.hubPeSlot || tunnel.hubPeSlot !== slot) return null;
  if (!tunnel.hubBindings?.wanIf) return null;
  return new Set(['wanIf', 'peerPublicNeighbor', 'publicIpv6', 'sidPrefix']);
};

const ifNamesMatch = (a: unknown, b: unknown): boolean => {
  const n = (v: unknown) =>
    String(v ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  const left = n(a);
  const right = n(b);
  if (!left || !right) return false;
  return left === right || left.replace(/\s/g, '') === right.replace(/\s/g, '');
};

const trimIpHost = (raw: unknown): string => {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const slash = s.indexOf('/');
  return slash >= 0 ? s.slice(0, slash) : s;
};

export const collectHubLanIfNamesFromConfig = (cfg: Record<string, unknown>): string[] => {
  const out: string[] = [];
  const pe =
    cfg.pe && typeof cfg.pe === 'object' && !Array.isArray(cfg.pe)
      ? (cfg.pe as Record<string, unknown>)
      : {};
  const list = [pe.lanConfig, pe.LanConfig, pe.lanConfigs].find(Array.isArray) as
    | Record<string, unknown>[]
    | undefined;
  (list || []).forEach((r) => {
    const n = String(r?.lanName || r?.ifName || '').trim();
    if (n) out.push(n);
  });
  const inv = cfg[TOWER_HUB_INVENTORY_KEY];
  if (inv && typeof inv === 'object' && !Array.isArray(inv)) {
    const lan = (inv as { lan?: unknown }).lan;
    if (Array.isArray(lan)) {
      lan.forEach((row) => {
        if (!row || typeof row !== 'object') return;
        const n = String((row as Record<string, unknown>).ifName || '').trim();
        if (n) out.push(n);
      });
    }
  }
  return out;
};

const ifaceIpv4Host = (cfg: Record<string, unknown>, ifName: string): string => {
  if (!ifName) return '';
  for (const k of Object.keys(cfg)) {
    if (!k.startsWith('interfaces_') && !k.startsWith('subinterfaces_')) continue;
    const arr = cfg[k];
    if (!Array.isArray(arr)) continue;
    for (const it of arr) {
      if (!it || typeof it !== 'object') continue;
      if (!ifNamesMatch((it as Record<string, unknown>).name, ifName)) continue;
      return trimIpHost(
        (it as Record<string, unknown>).ipv4_static ?? (it as Record<string, unknown>).ipv4,
      );
    }
  }
  return '';
};

const lanConfigIpv4Host = (cfg: Record<string, unknown>, ifName: string): string => {
  const pe =
    cfg.pe && typeof cfg.pe === 'object' && !Array.isArray(cfg.pe)
      ? (cfg.pe as Record<string, unknown>)
      : {};
  const list = [pe.lanConfig, pe.LanConfig, pe.lanConfigs].find(Array.isArray) as
    | Record<string, unknown>[]
    | undefined;
  for (const r of list || []) {
    const n = String(r?.lanName || r?.ifName || '').trim();
    if (!ifNamesMatch(n, ifName)) continue;
    return trimIpHost(r.ipv4);
  }
  return '';
};

/** CE 公网 WAN 口名：ce.publicConfig.wanName / wanDev */
export const ceWanNameFromConfig = (cfg: Record<string, unknown> | null | undefined): string => {
  const ce =
    cfg?.ce && typeof cfg.ce === 'object' && !Array.isArray(cfg.ce) ? (cfg.ce as Record<string, unknown>) : {};
  const pub =
    ce.publicConfig && typeof ce.publicConfig === 'object' && !Array.isArray(ce.publicConfig)
      ? (ce.publicConfig as Record<string, unknown>)
      : {};
  return String(pub.wanName ?? pub.wanDev ?? ce.wanDev ?? '').trim();
};

/** Hub：已绑定 LAN 的口名 / 主 IPv4 相对提交配置的差异（不锁定未绑定的额外 LAN） */
export const hubBoundLanIdentityDiffs = (
  nextCfg: Record<string, unknown>,
  boundLanIf: string | undefined,
  expectedInnerIp?: string,
): string[] => {
  const want = String(boundLanIf || '').trim();
  if (!want) return [];
  const diffs: string[] = [];
  const names = collectHubLanIfNamesFromConfig(nextCfg);
  if (!names.some((n) => ifNamesMatch(n, want))) diffs.push('innerIf');
  const expectedHost = trimIpHost(expectedInnerIp);
  if (expectedHost) {
    const fromIface = ifaceIpv4Host(nextCfg, want);
    const fromLan = lanConfigIpv4Host(nextCfg, want);
    // 接口表或 pe.lanConfig 任一相对指纹漂移即拦；两边都空视为主 IPv4 被清掉
    if (
      (fromIface && fromIface !== expectedHost) ||
      (fromLan && fromLan !== expectedHost) ||
      (!fromIface && !fromLan)
    ) {
      diffs.push('innerIp');
    }
  }
  return diffs;
};

const formatFingerprintDiff = (fields: string[]) =>
  fields.map((f) => fingerprintFieldLabel[f] || f).join('、');

/**
 * 问题 2 · 策略 A：被 SRv6 隧道引用的 VR，关键指纹字段不可通过 upsert 变更。
 */
export const assertSrv6VrConfigUpsertAllowed = async (
  vrUuid: string,
  nextConfigJson: string,
): Promise<void> => {
  const refs = await findSrv6TunnelsReferencingVr(vrUuid);
  if (!refs.length) return;

  const nextCfg = parseConfig(nextConfigJson);
  if (!nextCfg) {
    const err = new Error('配置无法解析，无法保存');
    (err as Error & { statusCode: number }).statusCode = 400;
    throw err;
  }

  const repo = AppDataSource.getRepository(SRv6Tunnel);
  const conflicts: string[] = [];
  // CE：WAN 口与其 IPv4 共同构成隧道身份，口名变更也拦（对比平台已保存配置）
  const savedRecord = await AppDataSource.getRepository(VRConfig).findOne({ where: { uuid: vrUuid } });
  const savedCfg = parseConfig(savedRecord?.config_json);
  const prevCeWan = ceWanNameFromConfig(savedCfg);
  const nextCeWan = ceWanNameFromConfig(nextCfg);
  const ceWanChanged = Boolean(prevCeWan) && !ifNamesMatch(prevCeWan, nextCeWan);

  for (const ref of refs) {
    const tunnel = await repo.findOne({ where: { id: ref.tunnelId } });
    if (!tunnel) continue;
    const nextRole = normalizeVrRole(nextCfg.role);
    if (ref.slot === 'peA' || ref.slot === 'peB') {
      if (nextRole && !isSrv6PeRole(nextRole)) {
        conflicts.push(
          `隧道「${tunnel.name}」（${slotDisplay(ref.slot)}）：角色应为 SPOKE_PE 或 HUB_PE，当前提交为 ${nextRole}`,
        );
        continue;
      }
    } else if (nextRole && nextRole !== 'CE') {
      conflicts.push(`隧道「${tunnel.name}」（${slotDisplay(ref.slot)}）：角色应为 CE，当前提交为 ${nextRole}`);
      continue;
    } else if (ceWanChanged) {
      conflicts.push(
        `隧道「${tunnel.name}」（${slotDisplay(ref.slot)}）：CE WAN 接口不可修改（${prevCeWan} → ${nextCeWan || '-'}）`,
      );
      continue;
    }
    const expected = getStoredFingerprintForSlot(tunnel, ref.slot);
    if (!expected) {
      conflicts.push(`隧道「${tunnel.name}」（${slotDisplay(ref.slot)}）：缺少端点配置指纹`);
      continue;
    }

    const live = computeLiveFingerprintForSlot(ref.slot, nextCfg, tunnel);
    let fields = diffFingerprintFields(
      expected as Record<string, unknown>,
      live as Record<string, unknown>,
    );
    const hubLock = hubPeLockedFingerprintFields(tunnel, ref.slot);
    if (hubLock) {
      fields = fields.filter((f) => hubLock.has(f));
      const boundLanIf =
        resolveHubLanIfFromTunnel(tunnel) ||
        (ref.slot === 'peA'
          ? tunnel.peAInnerIf
          : ref.slot === 'peB'
            ? tunnel.peBInnerIf
            : undefined) ||
        (expected as { innerIf?: string }).innerIf;
      const extra = hubBoundLanIdentityDiffs(
        nextCfg,
        boundLanIf || undefined,
        (expected as { innerIp?: string }).innerIp,
      );
      extra.forEach((f) => {
        if (!fields.includes(f)) fields.push(f);
      });
    }
    if (fields.length) {
      conflicts.push(
        `隧道「${tunnel.name}」（${slotDisplay(ref.slot)}）：以下关键项与创建时不一致：${formatFingerprintDiff(fields)}`,
      );
    }
  }

  if (conflicts.length) {
    const tunnelNames = [...new Set(refs.map((r) => r.tunnelName).filter(Boolean))];
    const namesPart = tunnelNames.length ? `引用隧道：${tunnelNames.join('、')}。` : '';
    const detailPart = `变更冲突：${conflicts.join('；')}`;
    const err = new Error(
      `当前 IBR 实例已被 SRv6 隧道引用，关键配置不允许修改。如需调整，请先删除相关隧道后再保存。${namesPart}${detailPart}`,
    );
    (err as Error & { statusCode: number }).statusCode = 409;
    throw err;
  }
};

/** 策略 A：被隧道引用时禁止变更 VR 角色（set-role） */
export const assertSrv6VrSetRoleAllowed = async (
  vrUuid: string,
  nextRole?: string,
): Promise<void> => {
  const refs = await findSrv6TunnelsReferencingVr(vrUuid);
  if (!refs.length) return;
  const repo = AppDataSource.getRepository(VRConfig);
  const record = await repo.findOne({ where: { uuid: vrUuid } });
  const currentRole = normalizeVrRole(record?.role);
  const normalizedRole = normalizeVrRole(nextRole);
  if (normalizedRole && normalizedRole === currentRole) return;
  const names = [...new Set(refs.map((r) => r.tunnelName).filter(Boolean))];
  const namesPart = names.length ? `引用隧道：${names.join('、')}。` : '';
  const rolePart = nextRole ? `目标角色：${nextRole}。` : '';
  const err = new Error(
    `当前 IBR 实例已被 SRv6 隧道引用，角色不允许修改。如需调整，请先删除相关隧道后再保存。${namesPart}${rolePart}`,
  );
  (err as Error & { statusCode: number }).statusCode = 409;
  throw err;
};

