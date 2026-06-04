import { AppDataSource } from '../../config/database';
import { SRv6Tunnel } from '../../entities/vRouter/SRv6Tunnel';
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

const expectedRoleForSlot = (slot: Srv6EndpointSlot) =>
  slot === 'peA' || slot === 'peB' ? 'PE' : 'CE';

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
    const nextRole = String(nextCfg.role || '').toUpperCase();
    const expectedRole = expectedRoleForSlot(ref.slot);
    if (nextRole && nextRole !== expectedRole) {
      conflicts.push(`隧道「${tunnel.name}」(${ref.slot})：role 应为 ${expectedRole}，当前提交为 ${nextRole}`);
      continue;
    }
    const expected = getStoredFingerprintForSlot(tunnel, ref.slot);
    if (!expected) {
      conflicts.push(`隧道「${tunnel.name}」(${ref.slot})：缺少 endpointFingerprint 档案`);
      continue;
    }

    const live = computeLiveFingerprintForSlot(ref.slot, nextCfg, tunnel);
    const fields = diffFingerprintFields(
      expected as Record<string, unknown>,
      live as Record<string, unknown>,
    );
    if (fields.length) {
      conflicts.push(`隧道「${tunnel.name}」(${ref.slot})：${fields.join(', ')}`);
    }
  }

  if (conflicts.length) {
    const err = new Error(
      `该 VR 已被 SRv6 隧道引用，关键配置不可变更。请先删除或重建相关隧道。详情：${conflicts.join('；')}`,
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
  const normalizedRole = String(nextRole || '').toUpperCase();
  if (normalizedRole && refs.every((r) => expectedRoleForSlot(r.slot) === normalizedRole)) {
    return;
  }
  const names = [...new Set(refs.map((r) => r.tunnelName))];
  const suffix = nextRole ? `目标角色：${nextRole}。` : '';
  const err = new Error(
    `该 VR 已被 SRv6 隧道引用（${names.join('、')}），不可变更角色。${suffix}请先删除或重建相关隧道。`,
  );
  (err as Error & { statusCode: number }).statusCode = 409;
  throw err;
};

