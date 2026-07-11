import { AppDataSource } from '../../config/database';
import { VRConfig } from '../../entities/vRouter/VRConfig';
import { getVR2QueryResult } from './vrController';
import { extractRoleFromVr2Config } from './ibrVrRoleResolve';

export type Vr2PlatformSyncResult = {
  ok: boolean;
  updated: number;
  noConfig: number;
  errors: number;
  queried: number;
  error?: string;
};

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * 从 CSMCTL VR2 批量回写平台 vr_config（config_json + role）。
 * 对端无 VR2 配置时保留既有 vr_config，不删除。
 */
export async function syncVr2ConfigsToPlatform(
  uuids: string[],
  options?: { concurrency?: number },
): Promise<Vr2PlatformSyncResult> {
  const unique = [...new Set(uuids.map((u) => String(u || '').trim()).filter(Boolean))];
  const result: Vr2PlatformSyncResult = {
    ok: false,
    updated: 0,
    noConfig: 0,
    errors: 0,
    queried: unique.length,
  };
  if (unique.length === 0) {
    result.ok = true;
    return result;
  }

  const configRepo = AppDataSource.getRepository(VRConfig);
  const concurrency = options?.concurrency ?? 6;

  await mapWithConcurrency(unique, concurrency, async (uuid) => {
    const r = await getVR2QueryResult(uuid);
    if (r.transportError) {
      result.errors += 1;
      return;
    }
    if (r.csmBizError || !r.config) {
      result.noConfig += 1;
      return;
    }

    const role = extractRoleFromVr2Config(r.config);
    const configJson = JSON.stringify(r.config);

    let row = await configRepo.findOne({ where: { uuid } });
    if (row) {
      row.config_json = configJson;
      if (role) row.role = role;
      await configRepo.save(row);
    } else {
      row = configRepo.create({
        uuid,
        config_json: configJson,
        role: role ?? undefined,
      });
      await configRepo.save(row);
    }
    result.updated += 1;
  });

  result.ok = result.errors < unique.length;
  if (!result.ok && result.updated === 0) {
    result.error = `VR2 同步全部失败（${result.errors}/${unique.length}）`;
  }
  return result;
}
