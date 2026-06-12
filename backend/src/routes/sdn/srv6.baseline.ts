import { AppDataSource } from '../../config/database';
import { VRConfig } from '../../entities/vRouter/VRConfig';
import type { Srv6EndpointSlot } from '../../entities/vRouter/srv6Tunnel.types';
import { listAliveContributionsForVr } from './srv6.recompute';

const vrRepo = () => AppDataSource.getRepository(VRConfig);

const slotLabel = (slot: Srv6EndpointSlot) =>
  ({ peA: 'PE-A', peB: 'PE-B', ceA: 'CE-A', ceB: 'CE-B' } as const)[slot];

export type Srv6TunnelEndpointRef = {
  slot: Srv6EndpointSlot;
  vrId: string;
};

/**
 * 隧道创建时捕获四端 VR 当前 config_json 为基线（仅首次写入）。
 * 须在平台库被隧道注入覆盖之前调用。
 */
export const captureSrv6BaselinesForTunnel = async (
  tunnelId: string,
  endpoints: Srv6TunnelEndpointRef[],
): Promise<void> => {
  const now = new Date();
  for (const { slot, vrId } of endpoints) {
    const record = await vrRepo().findOne({ where: { uuid: vrId } });
    if (!record?.config_json) {
      const err = new Error(`${slotLabel(slot)}：对应 VR 配置不存在，无法捕获 SRv6 基线`);
      (err as Error & { statusCode: number }).statusCode = 409;
      throw err;
    }
    if (record.srv6BaselineJson) continue;

    record.srv6BaselineJson = record.config_json;
    record.srv6BaselineAt = now;
    record.srv6BaselineTunnelId = tunnelId;
    await vrRepo().save(record);
  }
};

export const parseSrv6Baseline = (record: VRConfig): Record<string, unknown> | null => {
  const raw = record.srv6BaselineJson;
  if (!raw || typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

/**
 * P4：零隧道时将基线对齐为当前 config_json（向导态为权威）。
 * @returns 是否执行了重置
 */
export const resetSrv6BaselineWhenNoTunnels = async (vrUuid: string): Promise<boolean> => {
  const id = String(vrUuid || '').trim();
  if (!id) return false;

  const alive = await listAliveContributionsForVr(id);
  if (alive.length > 0) return false;

  const record = await vrRepo().findOne({ where: { uuid: id } });
  if (!record?.config_json) return false;

  record.srv6BaselineJson = record.config_json;
  record.srv6BaselineAt = new Date();
  record.srv6BaselineTunnelId = null;
  await vrRepo().save(record);
  return true;
};

/** P4：强制将基线重置为当前 config_json（须无存活隧道引用） */
export const forceResetSrv6BaselineFromConfig = async (vrUuid: string): Promise<void> => {
  const id = String(vrUuid || '').trim();
  const alive = await listAliveContributionsForVr(id);
  if (alive.length > 0) {
    const names = [...new Set(alive.map((c) => c.tunnelName))].join('、');
    const err = new Error(
      `该 VR 仍被 ${alive.length} 条存活隧道引用（${names}），无法重置基线。请先删除相关隧道。`,
    );
    (err as Error & { statusCode: number }).statusCode = 409;
    throw err;
  }
  const ok = await resetSrv6BaselineWhenNoTunnels(id);
  if (!ok) {
    const err = new Error('VR 配置不存在或无法重置基线');
    (err as Error & { statusCode: number }).statusCode = 404;
    throw err;
  }
};
