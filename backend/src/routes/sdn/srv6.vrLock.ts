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

