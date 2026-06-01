/**
 * Tower 侧为每个 CephObjectStore 保存「S3 客户端访问」网关参数（落 clouds.config，非集群 CR）。
 */

import { AppDataSource } from '../config/database';
import { Cloud } from '../entities/Cloud';

export const TOWER_RGW_S3_CLIENT_BY_STORE_KEY = 'towerRgwS3ClientByStore';

export type TowerRgwS3ClientGatewayStored = {
  endpoint: string;
  region?: string;
  forcePathStyle?: boolean;
};

export function readTowerRgwS3ClientByStore(
  config: unknown,
): Record<string, TowerRgwS3ClientGatewayStored> {
  const c = config && typeof config === 'object' ? (config as Record<string, unknown>) : {};
  const m = c[TOWER_RGW_S3_CLIENT_BY_STORE_KEY];
  if (!m || typeof m !== 'object' || Array.isArray(m)) return {};
  const out: Record<string, TowerRgwS3ClientGatewayStored> = {};
  for (const [k, v] of Object.entries(m as Record<string, unknown>)) {
    if (!k?.trim() || !v || typeof v !== 'object' || Array.isArray(v)) continue;
    const ep = String((v as any).endpoint ?? '').trim();
    if (!ep) continue;
    out[k] = {
      endpoint: ep,
      region: String((v as any).region ?? '').trim() || 'us-east-1',
      forcePathStyle: (v as any).forcePathStyle !== false,
    };
  }
  return out;
}

export async function upsertTowerRgwS3ClientGateway(
  cloudId: string,
  namespace: string,
  objectStoreName: string,
  payload: TowerRgwS3ClientGatewayStored | null,
): Promise<Cloud> {
  const repo = AppDataSource.getRepository(Cloud);
  const cloud = await repo.findOne({ where: { id: cloudId } });
  if (!cloud) throw Object.assign(new Error('云资源不存在'), { status: 404 });
  const ns = namespace.trim();
  const nm = objectStoreName.trim();
  if (!ns || !nm)
    throw Object.assign(new Error('缺少 namespace 或 objectStoreName'), { status: 400 });

  const cfg = { ...(cloud.config || {}) };
  const prev = readTowerRgwS3ClientByStore(cfg);
  const storeKey = `${ns}/${nm}`;

  if (!payload || !payload.endpoint?.trim()) {
    delete prev[storeKey];
  } else {
    prev[storeKey] = {
      endpoint: payload.endpoint.trim(),
      region: (payload.region || '').trim() || 'us-east-1',
      forcePathStyle: payload.forcePathStyle !== false,
    };
  }

  cfg[TOWER_RGW_S3_CLIENT_BY_STORE_KEY] = prev;
  cloud.config = cfg;
  await repo.save(cloud);
  return cloud;
}
