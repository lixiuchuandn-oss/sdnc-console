import { AppDataSource } from '../../config/database';
import { VRConfig } from '../../entities/vRouter/VRConfig';
import { isSemanticEmpty } from '../../utils/configSemanticEqual';
import { extractRoleFromVr2Config } from './ibrVrRoleResolve';
import { stripMeta } from './vrConfigDeploy';
import { getVR2QueryResult } from './vrController';

export class RolePreSnapshotError extends Error {
  statusCode = 503;

  constructor(message: string) {
    super(message);
    this.name = 'RolePreSnapshotError';
  }
}

const text = (value: unknown): string => String(value ?? '').trim();

type RoleSnapshotFields = {
  role?: string | null;
  rolePreSnapshot?: string | null;
};

export const hasRolePreSnapshot = (row: RoleSnapshotFields | null | undefined): boolean =>
  Boolean(text(row?.rolePreSnapshot));

export const hasPlatformRole = (row: RoleSnapshotFields | null | undefined): boolean =>
  Boolean(text(row?.role));

/** 快照空 + 平台 role 空时才去 GET VR2 */
export const shouldAttemptRolePreSnapshotCapture = (
  row: RoleSnapshotFields | null | undefined,
): boolean => !hasRolePreSnapshot(row) && !hasPlatformRole(row);

export const serializeRolePreSnapshot = (config: unknown): string => JSON.stringify(stripMeta(config));

export const parseRolePreSnapshot = (raw: string | null | undefined): Record<string, unknown> | null => {
  const s = text(raw);
  if (!s) return null;
  try {
    const parsed = JSON.parse(s) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
};

/**
 * 第一次写角色之前捕获实时 VR2。不满足三条件则跳过且不 GET。
 * 应捕获但 GET 失败 / VR2 空：抛 503，调用方不得写库。
 */
export async function captureRolePreSnapshotIfEmpty(uuid: string): Promise<'captured' | 'skipped'> {
  const id = text(uuid);
  if (!id) {
    throw new RolePreSnapshotError('缺少 uuid，无法捕获角色前快照');
  }

  const repo = AppDataSource.getRepository(VRConfig);
  const row = await repo.findOne({ where: { uuid: id } });
  if (!shouldAttemptRolePreSnapshotCapture(row)) {
    return 'skipped';
  }

  const r = await getVR2QueryResult(id);
  if (r.transportError) {
    throw new RolePreSnapshotError(`无法读取设备当前配置，已中止角色前快照捕获：${r.transportError}`);
  }
  if (r.csmBizError || !r.config || typeof r.config !== 'object' || Array.isArray(r.config)) {
    throw new RolePreSnapshotError('设备当前配置为空，无法捕获角色前快照');
  }

  const stripped = stripMeta(r.config);
  if (isSemanticEmpty(stripped) || Object.keys(stripped).length === 0) {
    throw new RolePreSnapshotError('设备当前配置为空，无法捕获角色前快照');
  }
  if (extractRoleFromVr2Config(r.config) || extractRoleFromVr2Config(stripped)) {
    return 'skipped';
  }

  const payload = JSON.stringify(stripped);
  if (row) {
    row.rolePreSnapshot = payload;
    await repo.save(row);
  } else {
    await repo.save(
      repo.create({
        uuid: id,
        config_json: '{}',
        rolePreSnapshot: payload,
      }),
    );
  }
  return 'captured';
}
