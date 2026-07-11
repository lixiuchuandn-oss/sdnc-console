import { AppDataSource } from '../../config/database';
import { VRConfig } from '../../entities/vRouter/VRConfig';
import { VRCacheExtended } from '../../entities/vRouter/VRCacheExtended';
import { vrController } from '../vrouter/vrController';
import { logger } from '../../utils/logger';

const log = logger.child('SDNC-Northbound');

export type NorthboundVrInstance = {
  uuid: string;
  name: string;
  tenant_id?: string | null;
  organization_id?: string | null;
  role?: string | null;
  bind_status?: string | null;
  created_at?: Date;
  updated_at?: Date;
  is_deleted?: boolean;
  resourceIndicators?: unknown;
};

export async function listVrInstancesByTenant(params: {
  tenantId: string;
  organizationId?: string;
}): Promise<NorthboundVrInstance[]> {
  const tenantId = String(params.tenantId || '').trim();
  if (!tenantId) return [];

  const repository = AppDataSource.getRepository(VRConfig);
  const where: { tenantId: string; organizationId?: string } = { tenantId };
  if (params.organizationId) {
    where.organizationId = String(params.organizationId).trim();
  }

  const list = await repository.find({ where, order: { created_at: 'DESC' } });

  const extendedRepo = AppDataSource.getRepository(VRCacheExtended);
  const extendedRows = await extendedRepo.find();
  const extendedMap: Record<string, unknown> = {};
  extendedRows.forEach((row) => {
    try {
      extendedMap[row.uuid] = JSON.parse(row.data);
    } catch {
      // ignore invalid cache row
    }
  });

  let liveUuids: Set<string> | null = null;
  try {
    const liveData = await vrController.getVRList(2000, 1);
    let items: unknown[] = [];
    if (Array.isArray(liveData)) items = liveData;
    else if (Array.isArray((liveData as { page?: unknown[] })?.page))
      items = (liveData as { page: unknown[] }).page;
    else if (Array.isArray((liveData as { items?: unknown[] })?.items))
      items = (liveData as { items: unknown[] }).items;
    else if (Array.isArray((liveData as { data?: unknown[] })?.data))
      items = (liveData as { data: unknown[] }).data;

    if (items.length > 0) {
      liveUuids = new Set(
        items
          .map((it) => {
            const row = it as Record<string, unknown>;
            return String(row.uuid || row.vr_unique_id || row.id || '').trim();
          })
          .filter(Boolean),
      );
    }
  } catch (e) {
    log.warn('live VR list unavailable for northbound', e instanceof Error ? e.message : String(e));
  }

  return list.map((item) => {
    const uid = String(item.uuid).trim();
    const isDeleted = liveUuids ? !liveUuids.has(uid) : false;
    return {
      uuid: uid,
      name: item.name || uid,
      tenant_id: item.tenantId ?? null,
      organization_id: item.organizationId ?? null,
      role: item.role ?? null,
      bind_status: item.bindStatus ?? null,
      created_at: item.created_at,
      updated_at: item.updated_at,
      is_deleted: isDeleted,
      resourceIndicators: (extendedMap[uid] as { resourceIndicators?: unknown })?.resourceIndicators,
    };
  });
}
