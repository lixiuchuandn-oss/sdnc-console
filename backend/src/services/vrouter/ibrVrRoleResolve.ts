import { In } from 'typeorm';
import { AppDataSource } from '../../config/database';
import { VRCacheBasic } from '../../entities/vRouter/VRCacheBasic';
import { VRConfig } from '../../entities/vRouter/VRConfig';
import { getVR2QueryResult } from './vrController';

/** 从 CSMCTL VR2 配置体提取 role（与 IBR Console「VR2 实时配置」同源） */
export function extractRoleFromVr2Config(config: unknown): string | null {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return null;
  const role = String((config as Record<string, unknown>).role ?? '').trim();
  return role || null;
}

function parseVrCacheBasicData(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

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
 * 批量从 VR2 实时查询角色（权威来源：CSMCTL VR2/VRConfig）。
 */
export async function resolveVrRolesFromVr2(
  uuids: string[],
  options?: { concurrency?: number },
): Promise<Record<string, string>> {
  const unique = [...new Set(uuids.map((u) => String(u || '').trim()).filter(Boolean))];
  const roles: Record<string, string> = {};
  if (unique.length === 0) return roles;

  await mapWithConcurrency(unique, options?.concurrency ?? 8, async (uuid) => {
    const r = await getVR2QueryResult(uuid);
    const role = extractRoleFromVr2Config(r.config);
    if (role) roles[uuid] = role;
    return null;
  });

  return roles;
}

/**
 * HA 组等场景：VR2 优先，其次平台 vr_config.role，再次 VR1 缓存 JSON。
 */
export async function resolveVrRolesWithFallback(uuids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(uuids.map((u) => String(u || '').trim()).filter(Boolean))];
  const map = new Map<string, string>();
  if (unique.length === 0) return map;

  const vr2Roles = await resolveVrRolesFromVr2(unique);
  for (const [uuid, role] of Object.entries(vr2Roles)) {
    map.set(uuid, role);
  }

  const missingAfterVr2 = unique.filter((u) => !map.has(u));
  if (missingAfterVr2.length > 0) {
    const configRepo = AppDataSource.getRepository(VRConfig);
    const configs = await configRepo.find({
      where: { uuid: In(missingAfterVr2) },
      select: ['uuid', 'role'],
    });
    for (const row of configs) {
      const role = String(row.role ?? '').trim();
      if (role) map.set(row.uuid, role);
    }
  }

  const missingAfterConfig = unique.filter((u) => !map.has(u));
  if (missingAfterConfig.length > 0) {
    const basicRepo = AppDataSource.getRepository(VRCacheBasic);
    const basics = await basicRepo.find({ where: { uuid: In(missingAfterConfig) } });
    for (const row of basics) {
      const data = parseVrCacheBasicData(row.data);
      const role = String(data.role ?? '').trim();
      if (role) map.set(row.uuid, role);
    }
  }

  return map;
}
