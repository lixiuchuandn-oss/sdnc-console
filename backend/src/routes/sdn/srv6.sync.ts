import { AppDataSource } from '../../config/database';
import { SRv6Tunnel } from '../../entities/vRouter/SRv6Tunnel';
import { VRConfig } from '../../entities/vRouter/VRConfig';
import type { Srv6EndpointSlot } from '../../entities/vRouter/srv6Tunnel.types';
import { configBusinessEqual } from '../../utils/configSemanticEqual';
import { withSqliteWriteLock } from '../../utils/sqliteWriteLock';
import { captureSrv6BaselinesForTunnel } from './srv6.baseline';
import { mergeBaselineWithContributions } from './srv6.merge';
import { listAliveContributionsForVr, recomputeVrEffectiveConfig } from './srv6.recompute';

const vrRepo = () => AppDataSource.getRepository(VRConfig);

const slotLabel = (slot: Srv6EndpointSlot) =>
  ({ peA: 'PE-A', peB: 'PE-B', ceA: 'CE-A', ceB: 'CE-B' } as const)[slot];

export const tunnelEndpointRefs = (tunnel: SRv6Tunnel) => [
  { slot: 'peA' as const, vrId: tunnel.peA },
  { slot: 'peB' as const, vrId: tunnel.peB },
  { slot: 'ceA' as const, vrId: tunnel.ceA },
  { slot: 'ceB' as const, vrId: tunnel.ceB },
];

/** 将重算结果写入 VRConfig.config_json（SQLite 串行写，避免并行隧道交错） */
export const persistSrv6VrEffectiveConfig = async (
  vrUuid: string,
): Promise<Record<string, unknown>> => {
  return withSqliteWriteLock(`srv6-vr:${vrUuid}`, async () => {
    const effective = await recomputeVrEffectiveConfig(vrUuid);
    const record = await vrRepo().findOne({ where: { uuid: vrUuid } });
    if (!record) {
      const err = new Error('VR 配置不存在');
      (err as Error & { statusCode: number }).statusCode = 404;
      throw err;
    }
    record.config_json = JSON.stringify(effective);
    await vrRepo().save(record);
    return effective;
  });
};

/**
 * P2：按隧道四端重算并落库，保证 config_json ≡ baseline + Σcontrib。
 */
export const syncSrv6TunnelPlatformConfigs = async (tunnel: SRv6Tunnel): Promise<void> => {
  const endpoints = tunnelEndpointRefs(tunnel);
  await captureSrv6BaselinesForTunnel(tunnel.id, endpoints);

  for (const { slot, vrId } of endpoints) {
    try {
      await persistSrv6VrEffectiveConfig(vrId);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const err = new Error(`${slotLabel(slot)}：写入平台生效配置失败（${msg}）`);
      (err as Error & { statusCode: number }).statusCode = 409;
      throw err;
    }
  }
};

/** 校验库内 config_json 是否与 baseline+Σcontrib 一致（测试/诊断用） */
export const assertSrv6VrConfigInvariant = async (vrUuid: string): Promise<void> => {
  const record = await vrRepo().findOne({ where: { uuid: vrUuid } });
  if (!record?.config_json) {
    const err = new Error('VR 配置不存在');
    (err as Error & { statusCode: number }).statusCode = 404;
    throw err;
  }

  const expected = await recomputeVrEffectiveConfig(vrUuid);
  let actual: Record<string, unknown>;
  try {
    actual = JSON.parse(record.config_json) as Record<string, unknown>;
  } catch {
    const err = new Error('VR 配置 JSON 无法解析');
    (err as Error & { statusCode: number }).statusCode = 409;
    throw err;
  }

  if (!configBusinessEqual(actual, expected)) {
    const err = new Error('平台账本与「向导基线 + 存活隧道叠加」不一致');
    (err as Error & { statusCode: number }).statusCode = 409;
    throw err;
  }
};

/** 纯函数：给定基线与贡献列表，判断生效配置是否一致 */
export const effectiveConfigMatches = (
  actual: Record<string, unknown>,
  baseline: Record<string, unknown>,
  contributions: Parameters<typeof mergeBaselineWithContributions>[1],
): boolean => {
  const expected = mergeBaselineWithContributions(baseline, contributions);
  return configBusinessEqual(actual, expected);
};

/** 列出某 VR 当前存活贡献（供 upsert 分支判断） */
export { listAliveContributionsForVr };
