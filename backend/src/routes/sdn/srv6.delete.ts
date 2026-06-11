import { AppDataSource } from '../../config/database';
import { SRv6Tunnel, SRv6Status } from '../../entities/vRouter/SRv6Tunnel';
import { VRConfig } from '../../entities/vRouter/VRConfig';
import { vrController } from '../../services/vrouter/vrController';
import type { Srv6EndpointSlot, Srv6InjectedDelta } from '../../entities/vRouter/srv6Tunnel.types';
import { ejectInjectedDeltaFromConfig } from './srv6.eject';

const vrRepo = () => AppDataSource.getRepository(VRConfig);

const stripMeta = (obj: Record<string, unknown>) => {
  const {
    msg: _msg,
    code: _code,
    report_config_status: _report_config_status,
    updateDate: _updateDate,
    createDate: _createDate,
    _id,
    requestId: _requestId,
    ...rest
  } = obj;
  return rest;
};

const sanitizeConfig = (config: Record<string, unknown>) => {
  if (config.ipv4_route) {
    if (!Array.isArray(config.ipv4_route) || config.ipv4_route.length === 0) {
      delete config.ipv4_route;
    }
  }
  return config;
};

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

export const revertSrv6TunnelInjections = async (
  tunnel: SRv6Tunnel,
  options: { revertDevice: boolean },
): Promise<RevertResult> => {
  const warnings: string[] = [];
  const devicePushErrors: string[] = [];
  const delta = tunnel.injectedDelta as Srv6InjectedDelta | null | undefined;

  if (!delta || typeof delta !== 'object') {
    const err = new Error(
      `该隧道缺少创建时的配置变更记录（多为历史数据），无法自动回退四端 VR 配置。${LEGACY_TUNNEL_DELETE_HINT}`,
    );
    (err as Error & { statusCode: number }).statusCode = 400;
    throw err;
  }

  const prepared: PreparedRevert[] = [];
  for (const { slot, vrId } of slotEndpoints(tunnel)) {
    const entry = delta[slot];
    if (!entry) {
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

    let cfg: Record<string, unknown>;
    try {
      cfg = JSON.parse(record.config_json);
    } catch {
      const err = new Error(`${slotLabel(slot)}：VR 配置格式异常，无法执行删除回退`);
      (err as Error & { statusCode: number }).statusCode = 409;
      throw err;
    }

    const { config: nextCfg, skipped } = ejectInjectedDeltaFromConfig(cfg, entry);
    if (skipped.length) {
      const err = new Error(
        `${slotLabel(slot)}：回退时未能在当前配置中找到创建时下发的对应项（${skipped.join('；')}），已中止删除。请确认四端配置未被手工修改。`,
      );
      (err as Error & { statusCode: number }).statusCode = 409;
      throw err;
    }

    prepared.push({ slot, vrId, record, originalConfig: cfg, nextConfig: nextCfg });
  }

  const pushed: PreparedRevert[] = [];
  if (options.revertDevice) {
    for (const item of prepared) {
      try {
        const clean = sanitizeConfig(
          stripMeta(JSON.parse(JSON.stringify(item.nextConfig))) as Record<string, unknown>,
        );
        const updateResp = await vrController.updateVRConfig(item.vrId, clean);
        const respData = updateResp.data || {};
        if (
          respData &&
          typeof respData.code !== 'undefined' &&
          respData.code != 0 &&
          respData.code != 200
        ) {
          throw new Error(respData.msg || respData.message || JSON.stringify(respData));
        }
        pushed.push(item);
      } catch (e: any) {
        devicePushErrors.push(`${item.slot}：${e?.message || String(e)}`);
        break;
      }
    }
  }

  if (devicePushErrors.length) {
    for (const item of pushed.reverse()) {
      try {
        const clean = sanitizeConfig(
          stripMeta(JSON.parse(JSON.stringify(item.originalConfig))) as Record<string, unknown>,
        );
        await vrController.updateVRConfig(item.vrId, clean);
      } catch (e: any) {
        warnings.push(`${item.slot}：设备回滚原配置失败（${e?.message || String(e)}）`);
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
  } catch (e: any) {
    if (options.revertDevice) {
      for (const item of prepared.slice().reverse()) {
        try {
          const clean = sanitizeConfig(
            stripMeta(JSON.parse(JSON.stringify(item.originalConfig))) as Record<string, unknown>,
          );
          await vrController.updateVRConfig(item.vrId, clean);
        } catch (rollbackErr: any) {
          warnings.push(
            `${item.slot}：数据库失败后设备回滚原配置失败（${rollbackErr?.message || String(rollbackErr)}）`,
          );
        }
      }
    }
    const err = new Error(`删除回退已下发但平台库事务失败：${e?.message || String(e)}`);
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
