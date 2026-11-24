import { AppDataSource } from '../../config/database';
import { VRConfig } from '../../entities/vRouter/VRConfig';
import { findSrv6TunnelsReferencingVr } from '../../routes/sdn/srv6.references';
import { freezeSrv6BaselineJson } from '../../utils/stripVrrpOwnedFields';
import { assertCsmUpdateSuccess } from './vrConfigDeploy';
import { captureRolePreSnapshotIfEmpty } from './rolePreSnapshot';
import { vrController } from './vrController';

export class VrConfigExpertError extends Error {
  statusCode = 409;

  constructor(message: string, statusCode = 409) {
    super(message);
    this.name = 'VrConfigExpertError';
    this.statusCode = statusCode;
  }
}

export async function assertExpertVrConfigWriteAllowed(uuid: string): Promise<void> {
  const refs = await findSrv6TunnelsReferencingVr(uuid);
  if (!refs.length) return;
  const names = [...new Set(refs.map((r) => r.tunnelName).filter(Boolean))];
  const suffix = names.length ? `引用隧道：${names.join('、')}` : '当前 IBR 已被 SRv6 隧道引用';
  throw new VrConfigExpertError(`该 IBR 仍被 SRv6 隧道引用，请改/删隧道后再用专家模式。${suffix}`);
}

const toJsonString = (config: unknown): string =>
  typeof config === 'string' ? config : JSON.stringify(config);

const toObject = (config: unknown): Record<string, unknown> => {
  if (config && typeof config === 'object' && !Array.isArray(config)) {
    return config as Record<string, unknown>;
  }
  if (typeof config === 'string') {
    const parsed = JSON.parse(config) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  }
  throw new VrConfigExpertError('专家配置无法解析', 400);
};

export async function persistExpertVrConfig(
  uuid: string,
  config: unknown,
  meta?: { cloudId?: string; cloudName?: string; vmId?: string },
): Promise<void> {
  await captureRolePreSnapshotIfEmpty(uuid);
  const repo = AppDataSource.getRepository(VRConfig);
  let record = await repo.findOne({ where: { uuid } });
  const jsonStr = toJsonString(config);
  if (record) {
    record.config_json = jsonStr;
    if (record.srv6BaselineJson?.trim()) {
      record.srv6BaselineJson = freezeSrv6BaselineJson(jsonStr);
      record.srv6BaselineAt = new Date();
      record.srv6BaselineTunnelId = null;
    }
    if (meta?.cloudId !== undefined) record.cloudId = meta.cloudId;
    if (meta?.cloudName !== undefined) record.cloudName = meta.cloudName;
    if (meta?.vmId !== undefined) record.vmId = meta.vmId;
    await repo.save(record);
    return;
  }
  await repo.save(
    repo.create({
      uuid,
      config_json: jsonStr,
      cloudId: meta?.cloudId,
      cloudName: meta?.cloudName,
      vmId: meta?.vmId,
    }),
  );
}

/** 保存到平台后再全量 POST VR2；CSM 接受即返回，不等 applied */
export async function dispatchExpertVrConfig(
  uuid: string,
  config: unknown,
): Promise<unknown> {
  await assertExpertVrConfigWriteAllowed(uuid);
  await persistExpertVrConfig(uuid, config);
  const body = toObject(config);
  const resp = await vrController.updateVRConfig(uuid, { ...body, uuid });
  assertCsmUpdateSuccess(resp.data);
  return resp.data;
}
