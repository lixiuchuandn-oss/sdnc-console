import { Router } from 'express';
import { AppDataSource } from '../../config/database';
import { VRCacheBasic } from '../../entities/vRouter/VRCacheBasic';
import { VRCacheExtended } from '../../entities/vRouter/VRCacheExtended';
import { VRCacheDevice } from '../../entities/vRouter/VRCacheDevice';
import { VRCacheService } from '../../services/vrouter/VRCacheService';
import { vrController } from '../../services/vrouter/vrController';
import { logger } from '../../utils/logger';

const vrInstHttpLog = logger.child('VR-Instances-HTTP');

export const vrInstancesRoutes = Router();

function safeJsonParse<T = any>(raw: any, fallback: T): T {
  try {
    if (typeof raw === 'string') return JSON.parse(raw) as T;
    if (raw && typeof raw === 'object') return raw as T;
    return fallback;
  } catch {
    return fallback;
  }
}

function mergeOne(params: {
  uuid: string;
  basicRow?: VRCacheBasic | null;
  extendedRow?: VRCacheExtended | null;
  deviceRow?: VRCacheDevice | null;
  basicData?: any;
  extendedData?: any;
  deviceData?: any;
  vr2Data?: any | null;
}) {
  const uuid = String(params.uuid || '').trim();
  const basicData =
    typeof params.basicData !== 'undefined'
      ? params.basicData
      : params.basicRow
        ? safeJsonParse(params.basicRow.data, {})
        : {};
  const extendedData =
    typeof params.extendedData !== 'undefined'
      ? params.extendedData
      : params.extendedRow
        ? safeJsonParse(params.extendedRow.data, null as any)
        : null;
  const deviceData =
    typeof params.deviceData !== 'undefined'
      ? params.deviceData
      : params.deviceRow
        ? safeJsonParse(params.deviceRow.data, null as any)
        : null;

  const merged: Record<string, any> = {
    ...basicData,
    ...(extendedData || {}),
    uuid,
    name: (basicData as any).name || deviceData?.name || '未命名VR',
    vr_unique_id: deviceData?.uuid || uuid,
    tenant_id: deviceData?.tenantId || (basicData as any).tenant_id,
    org_id: deviceData?.organizationId || (basicData as any).org_id,
    bind_status: deviceData?.bindStatus || (basicData as any).bind_status,
    role: deviceData?.role || (basicData as any).role,
    _raw_csmctl_info: basicData,
    vr3_info: extendedData,
  };
  if (typeof params.vr2Data !== 'undefined') {
    merged.vr2_info = params.vr2Data;
  }
  if (deviceData && typeof deviceData === 'object') {
    merged.vr_tower_vrctl = deviceData;
  }
  return merged;
}

/** 触发后台从 CSM 同步 VR1/VR3/本地 device 缓存 */
vrInstancesRoutes.post('/refresh', async (req, res) => {
  try {
    await VRCacheService.getInstance().syncAll();
    res.json({ message: '同步任务已触发', status: 'ok' });
  } catch (err: any) {
    vrInstHttpLog.error(
      'Manual sync error',
      err instanceof Error ? err.message : String(err),
    );
    res.status(500).json({ message: 'Sync failed', error: err.message });
  }
});

/**
 * GET /api/vr-instances
 * - ?all=1|true：全量合并列表
 * - 否则分页：page_num、page_size
 */
vrInstancesRoutes.get('/', async (req, res) => {
  try {
    const all =
      req.query.all === '1' ||
      req.query.all === 'true' ||
      req.query.all === 'yes';

    const basicRepo = AppDataSource.getRepository(VRCacheBasic);
    const extendedRepo = AppDataSource.getRepository(VRCacheExtended);
    const deviceRepo = AppDataSource.getRepository(VRCacheDevice);

    const [basicRows, extendedRows, deviceRows] = await Promise.all([
      basicRepo.find(),
      extendedRepo.find(),
      deviceRepo.find(),
    ]);

    const extendedMap = new Map(
      extendedRows.map((r) => [r.uuid, safeJsonParse(r.data, null as any)]),
    );
    const deviceMap = new Map(
      deviceRows.map((r) => [r.uuid, safeJsonParse(r.data, null as any)]),
    );

    const mergedList = basicRows.map((basic) => {
      const uuid = basic.uuid;
      const basicData = safeJsonParse(basic.data, {});
      const extendedData = extendedMap.get(uuid) || null;
      const deviceData = deviceMap.get(uuid) || null;
      return mergeOne({ uuid, basicData, extendedData, deviceData });
    });

    if (all) {
      return res.json({
        code: 200,
        msg: 'ok',
        data: { total: mergedList.length, items: mergedList },
      });
    }

    const pageNum = Number(req.query.page_num || 1);
    const pageSize = Number(req.query.page_size || 50);
    const total = mergedList.length;
    const startIndex = (pageNum - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    const pageData = mergedList.slice(startIndex, endIndex);

    return res.json({
      code: 200,
      msg: 'ok',
      data: {
        page_num: pageNum,
        page_size: pageSize,
        total,
        list: pageData,
      },
    });
  } catch (err: any) {
    vrInstHttpLog.error('list error', err instanceof Error ? err.message : String(err));
    return res.status(500).json({ code: 500, msg: err?.message || 'internal error' });
  }
});

/**
 * GET /api/vr-instances/:uuid
 * 单实例合并；?includeVr2=0|false 跳过 CSMCTL 实时 VR2
 */
vrInstancesRoutes.get('/:uuid', async (req, res) => {
  try {
    const uuid = String(req.params.uuid || '').trim();
    if (!uuid) return res.status(400).json({ code: 400, msg: 'uuid required' });

    const includeVr2 =
      req.query.includeVr2 !== 'false' && req.query.includeVr2 !== '0';

    const basicRepo = AppDataSource.getRepository(VRCacheBasic);
    const extendedRepo = AppDataSource.getRepository(VRCacheExtended);
    const deviceRepo = AppDataSource.getRepository(VRCacheDevice);

    const [basicRow, extendedRow, deviceRow] = await Promise.all([
      basicRepo.findOne({ where: { uuid } }),
      extendedRepo.findOne({ where: { uuid } }),
      deviceRepo.findOne({ where: { uuid } }),
    ]);

    if (!basicRow && !extendedRow && !deviceRow) {
      return res.status(404).json({ code: 404, msg: 'not found', data: null });
    }

    let vr2Data: any = null;
    if (includeVr2) {
      try {
        vr2Data = await vrController.getVRConfig(uuid);
      } catch (e: any) {
        vrInstHttpLog.debug(
          'VR2 skipped',
          e instanceof Error ? e.message : String(e),
        );
      }
    }

    const data = includeVr2
      ? mergeOne({ uuid, basicRow, extendedRow, deviceRow, vr2Data })
      : mergeOne({ uuid, basicRow, extendedRow, deviceRow });
    return res.json({ code: 200, msg: 'ok', data });
  } catch (err: any) {
    vrInstHttpLog.error('get one error', err instanceof Error ? err.message : String(err));
    return res.status(500).json({ code: 500, msg: err?.message || 'internal error' });
  }
});

/** 历史前端曾调用；当前未实现服务端写入 */
vrInstancesRoutes.post('/upsert', async (_req, res) => {
  res.status(501).json({
    code: 501,
    msg: '未实现：请使用 POST /api/vr-instances/refresh 触发 Tower 侧 VRCacheService 同步',
  });
});
