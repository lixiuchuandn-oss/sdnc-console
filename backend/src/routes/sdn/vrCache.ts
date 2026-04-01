import { Router } from 'express';
import { AppDataSource } from '../../config/database';
import { VRCacheBasic } from '../../entities/vRouter/VRCacheBasic';
import { VRCacheExtended } from '../../entities/vRouter/VRCacheExtended';
import { VRCacheDevice } from '../../entities/vRouter/VRCacheDevice';
import { VRCacheService } from '../../services/vrouter/VRCacheService';
import { logger } from '../../utils/logger';

const vrCacheHttpLog = logger.child('VR-Cache-HTTP');

export const vrCacheRoutes = Router();

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

  return {
    ...basicData,
    ...(extendedData || {}),
    uuid,
    // 合并本地/设备信息
    name: (basicData as any).name || deviceData?.name || '未命名VR',
    vr_unique_id: deviceData?.uuid || uuid,
    tenant_id: deviceData?.tenantId || (basicData as any).tenant_id,
    org_id: deviceData?.organizationId || (basicData as any).org_id,
    bind_status: deviceData?.bindStatus || (basicData as any).bind_status,
    role: deviceData?.role || (basicData as any).role,
    // 原始信息（便于前端展示 CSMCTL 基本信息）；VR3 扩展见 vr3_info
    _raw_csmctl_info: basicData,
    vr3_info: extendedData,
  };
}

// Trigger sync manually
vrCacheRoutes.post('/refresh', async (req, res) => {
  try {
    await VRCacheService.getInstance().syncAll();
    res.json({ message: '同步任务已触发', status: 'ok' });
  } catch (err: any) {
    vrCacheHttpLog.error(
      'Manual sync error',
      err instanceof Error ? err.message : String(err),
    );
    res.status(500).json({ message: 'Sync failed', error: err.message });
  }
});

/**
 * 合并查询（单个）：返回 VR1(基本) + VR3(扩展)；本地 VRConfig 已合并进顶层字段（role/tenant 等），不再单独返回原始块
 * GET /api/vr-cache/:uuid/merged
 */
vrCacheRoutes.get('/:uuid/merged', async (req, res) => {
  try {
    const uuid = String(req.params.uuid || '').trim();
    if (!uuid) return res.status(400).json({ code: 400, msg: 'uuid required' });

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

    const data = mergeOne({ uuid, basicRow, extendedRow, deviceRow });
    return res.json({ code: 200, msg: 'ok', data });
  } catch (err: any) {
    vrCacheHttpLog.error('merged(one) error', err instanceof Error ? err.message : String(err));
    return res.status(500).json({ code: 500, msg: err?.message || 'internal error' });
  }
});

/**
 * 合并查询（全部）：返回所有缓存的聚合结果列表
 * GET /api/vr-cache/merged
 */
vrCacheRoutes.get('/merged', async (req, res) => {
  try {
    const basicRepo = AppDataSource.getRepository(VRCacheBasic);
    const extendedRepo = AppDataSource.getRepository(VRCacheExtended);
    const deviceRepo = AppDataSource.getRepository(VRCacheDevice);

    const [basicRows, extendedRows, deviceRows] = await Promise.all([
      basicRepo.find(),
      extendedRepo.find(),
      deviceRepo.find(),
    ]);

    const extendedMap = new Map(extendedRows.map((r) => [r.uuid, safeJsonParse(r.data, null as any)]));
    const deviceMap = new Map(deviceRows.map((r) => [r.uuid, safeJsonParse(r.data, null as any)]));

    const items = basicRows.map((basic) => {
      const uuid = basic.uuid;
      const basicData = safeJsonParse(basic.data, {});
      const extendedData = extendedMap.get(uuid) || null;
      const deviceData = deviceMap.get(uuid) || null;
      return mergeOne({ uuid, basicData, extendedData, deviceData });
    });

    return res.json({ code: 200, msg: 'ok', data: { total: items.length, items } });
  } catch (err: any) {
    vrCacheHttpLog.error('merged(batch) error', err instanceof Error ? err.message : String(err));
    return res.status(500).json({ code: 500, msg: err?.message || 'internal error' });
  }
});

// Get paginated list from cache tables
vrCacheRoutes.get('/pagelist', async (req, res) => {
  try {
    const pageNum = Number(req.query.page_num || 1);
    const pageSize = Number(req.query.page_size || 50);

    // 1. 读取三个表的全量数据 (假设数据量不大，全部读入内存合并)
    // 如果数据量巨大，应该使用 SQL Join，但 TypeORM 对 JSON 字段的解析在 SQL 层比较麻烦
    // 且当前需求是 "以 VR1 为主键"，内存合并灵活性更高
    const basicRepo = AppDataSource.getRepository(VRCacheBasic);
    const extendedRepo = AppDataSource.getRepository(VRCacheExtended);
    const deviceRepo = AppDataSource.getRepository(VRCacheDevice);

    const [basicRows, extendedRows, deviceRows] = await Promise.all([
      basicRepo.find(),
      extendedRepo.find(),
      deviceRepo.find(),
    ]);

    // 2. 建立索引（解析 JSON）
    const extendedMap = new Map(extendedRows.map((r) => [r.uuid, safeJsonParse(r.data, null as any)]));
    const deviceMap = new Map(deviceRows.map((r) => [r.uuid, safeJsonParse(r.data, null as any)]));

    // 3. 合并数据 (以 Basic 为主)
    const mergedList = basicRows.map((basic) => {
      const uuid = basic.uuid;
      const basicData = safeJsonParse(basic.data, {});
      const extendedData = extendedMap.get(uuid) || null;
      const deviceData = deviceMap.get(uuid) || null;
      return mergeOne({ uuid, basicData, extendedData, deviceData });
    });

    // 4. 内存分页
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
        total: total,
        list: pageData,
      },
    });
  } catch (err: any) {
    vrCacheHttpLog.error('pagelist error', err instanceof Error ? err.message : String(err));
    return res.status(500).json({ code: 500, msg: err?.message || 'internal error' });
  }
});
