import { AppDataSource } from '../../config/database';
import { SRv6Tunnel, SRv6Status } from '../../entities/vRouter/SRv6Tunnel';
import { VRConfig } from '../../entities/vRouter/VRConfig';
import { pushVRConfig } from '../../services/vrouter/vrConfigDeploy';
import type { Srv6EndpointSlot } from '../../entities/vRouter/srv6Tunnel.types';
import { parseSrv6Baseline } from './srv6.baseline';
import { resetSrv6BaselineWhenNoTunnels } from './srv6.baseline';
import { recomputeVrEffectiveConfig } from './srv6.recompute';

const vrRepo = () => AppDataSource.getRepository(VRConfig);

type RevertResult = {
  warnings: string[];
  devicePushErrors: string[];
};

type PreparedRevert = {
  slot: Srv6EndpointSlot;
  vrId: string;
  record: VRConfig;
  originalConfig: Record<string, unknown>;
  nextConfig: Record<string, unknown>;
};

const slotEndpoints = (
  tunnel: SRv6Tunnel,
): { slot: Srv6EndpointSlot; vrId: string }[] => [
  { slot: 'peA', vrId: tunnel.peA },
  { slot: 'peB', vrId: tunnel.peB },
  { slot: 'ceA', vrId: tunnel.ceA },
  { slot: 'ceB', vrId: tunnel.ceB },
];

const slotLabel = (slot: Srv6EndpointSlot) =>
  ({ peA: 'PE-A', peB: 'PE-B', ceA: 'CE-A', ceB: 'CE-B' } as const)[slot];

/** 历史隧道无变更清单时，引导用户仅删记录或手工清理 */
const LEGACY_TUNNEL_DELETE_HINT =
  '请取消勾选「回退平台库中的隧道注入项」后仅删除隧道记录，或由管理员在四端 VR 上手工还原配置。';

const BASELINE_MISSING_HINT =
  '该设备尚未保存向导基线（多为历史隧道），无法自动回退配置。请取消勾选「回退平台库」后仅删除记录，或使用「配置对账」处理。';

export const revertSrv6TunnelInjections = async (
  tunnel: SRv6Tunnel,
  options: { revertDevice: boolean },
): Promise<RevertResult> => {
  const warnings: string[] = [];
  const devicePushErrors: string[] = [];
  const delta = tunnel.injectedDelta;

  if (!delta || typeof delta !== 'object') {
    const err = new Error(
      `该隧道缺少创建时的配置变更记录（多为历史数据），无法自动回退四端 VR 配置。${LEGACY_TUNNEL_DELETE_HINT}`,
    );
    (err as Error & { statusCode: number }).statusCode = 400;
    throw err;
  }

  const prepared: PreparedRevert[] = [];
  for (const { slot, vrId } of slotEndpoints(tunnel)) {
    if (!delta[slot]) {
      const err = new Error(
        `${slotLabel(slot)}：缺少该端的配置变更记录，无法执行删除回退。${LEGACY_TUNNEL_DELETE_HINT}`,
      );
      (err as Error & { statusCode: number }).statusCode = 400;
      throw err;
    }

    const record = await vrRepo().findOne({ where: { uuid: vrId } });
    if (!record?.config_json) {
      const err = new Error(`${slotLabel(slot)}：对应 VR 配置不存在，无法执行删除回退`);
      (err as Error & { statusCode: number }).statusCode = 409;
      throw err;
    }

    if (!parseSrv6Baseline(record)) {
      const err = new Error(`${slotLabel(slot)}：${BASELINE_MISSING_HINT}`);
      (err as Error & { statusCode: number }).statusCode = 409;
      throw err;
    }

    let originalConfig: Record<string, unknown>;
    try {
      originalConfig = JSON.parse(record.config_json) as Record<string, unknown>;
    } catch {
      const err = new Error(`${slotLabel(slot)}：VR 配置格式异常，无法执行删除回退`);
      (err as Error & { statusCode: number }).statusCode = 409;
      throw err;
    }

    let nextConfig: Record<string, unknown>;
    try {
      nextConfig = await recomputeVrEffectiveConfig(vrId, { excludeTunnelId: tunnel.id });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const err = new Error(`${slotLabel(slot)}：重算生效配置失败（${msg}）`);
      (err as Error & { statusCode: number }).statusCode = 409;
      throw err;
    }

    prepared.push({ slot, vrId, record, originalConfig, nextConfig });
  }

  const pushed: PreparedRevert[] = [];
  if (options.revertDevice) {
    for (const item of prepared) {
      try {
        await pushVRConfig({
          vrId: item.vrId,
          domain: 'srv6',
          platformConfig: item.nextConfig as Record<string, unknown>,
          acknowledgeDrift: true,
        });
        pushed.push(item);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        devicePushErrors.push(`${item.slot}：${msg}`);
        break;
      }
    }
  }

  if (devicePushErrors.length) {
    for (const item of pushed.reverse()) {
      try {
        await pushVRConfig({
          vrId: item.vrId,
          domain: 'srv6',
          platformConfig: item.originalConfig as Record<string, unknown>,
          acknowledgeDrift: true,
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        warnings.push(`${item.slot}：设备回滚原配置失败（${msg}）`);
      }
    }
    return { warnings, devicePushErrors };
  }

  try {
    await AppDataSource.transaction(async (manager) => {
      for (const item of prepared) {
        item.record.config_json = JSON.stringify(item.nextConfig);
        await manager.save(VRConfig, item.record);
      }
      await manager.delete(SRv6Tunnel, { id: tunnel.id });
    });
    for (const item of prepared) {
      try {
        await resetSrv6BaselineWhenNoTunnels(item.vrId);
      } catch {
        warnings.push(`${item.slot}：零隧道基线对齐失败（可通过对账工具修复）`);
      }
    }
  } catch (e: unknown) {
    if (options.revertDevice) {
      for (const item of prepared.slice().reverse()) {
        try {
          await pushVRConfig({
            vrId: item.vrId,
            domain: 'srv6',
            platformConfig: item.originalConfig as Record<string, unknown>,
            acknowledgeDrift: true,
          });
        } catch (rollbackErr: unknown) {
          const msg = rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr);
          warnings.push(`${item.slot}：数据库失败后设备回滚原配置失败（${msg}）`);
        }
      }
    }
    const msg = e instanceof Error ? e.message : String(e);
    const err = new Error(`删除回退已下发但平台库事务失败：${msg}`);
    (err as Error & { statusCode: number; warnings: string[] }).statusCode = 409;
    (err as Error & { warnings: string[] }).warnings = warnings;
    throw err;
  }

  return { warnings, devicePushErrors };
};

export const deleteSrv6TunnelWithRevert = async (
  tunnel: SRv6Tunnel,
  options: { revertPlatform: boolean; revertDevice: boolean },
): Promise<{ warnings: string[]; devicePushErrors: string[] }> => {
  const repo = AppDataSource.getRepository(SRv6Tunnel);
  let warnings: string[] = [];
  let devicePushErrors: string[] = [];

  if (options.revertPlatform) {
    const revert = await revertSrv6TunnelInjections(tunnel, {
      revertDevice: options.revertDevice !== false,
    });
    warnings = revert.warnings;
    devicePushErrors = revert.devicePushErrors;
    if (devicePushErrors.length) {
      await repo.update({ id: tunnel.id }, { status: SRv6Status.ERROR });
      const err = new Error(`删除前回退未完全成功：${devicePushErrors.join('；')}`);
      (err as Error & { statusCode: number; warnings: string[] }).statusCode = 409;
      (err as Error & { warnings: string[] }).warnings = warnings;
      throw err;
    }
  }

  if (!options.revertPlatform) {
    await repo.delete({ id: tunnel.id });
  }
  return { warnings, devicePushErrors };
};
