import { Router } from 'express';
import { AppDataSource } from '../config/database';
import { VRCacheBasic } from '../entities/vRouter/VRCacheBasic';
import { VRCacheExtended } from '../entities/vRouter/VRCacheExtended';
import { VRCacheDevice } from '../entities/vRouter/VRCacheDevice';
import { VRCacheService } from '../services/VRCacheService';

export const vrCacheRoutes = Router();

// Trigger sync manually
vrCacheRoutes.post('/refresh', async (req, res) => {
  try {
    await VRCacheService.getInstance().syncAll();
    res.json({ message: '同步任务已触发', status: 'ok' });
  } catch (err: any) {
    console.error('[VR_SYNC] Manual sync error', err);
    res.status(500).json({ message: 'Sync failed', error: err.message });
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

    // 2. 建立索引
    const extendedMap = new Map(extendedRows.map((r) => [r.uuid, JSON.parse(r.data)]));
    const deviceMap = new Map(deviceRows.map((r) => [r.uuid, JSON.parse(r.data)]));

    // 3. 合并数据 (以 Basic 为主)
    const mergedList = basicRows.map((basic) => {
      const uuid = basic.uuid;
      const basicData = JSON.parse(basic.data);
      const extendedData = extendedMap.get(uuid) || null;
      const deviceData = deviceMap.get(uuid) || null; // 这里是 VRConfig 对象

      return {
        ...basicData,
        // 扩展信息合并到顶层 (resourceIndicators, interfaces)
        ...(extendedData || {}),

        // 确保关键字段存在
        uuid: uuid,
        // 合并本地/设备信息
        name: basicData.name || deviceData?.name || '未命名VR',
        vr_unique_id: deviceData?.uuid || uuid,
        tenant_id: deviceData?.tenantId || basicData.tenant_id,
        org_id: deviceData?.organizationId || basicData.org_id,
        bind_status: deviceData?.bindStatus || basicData.bind_status,
        role: deviceData?.role || basicData.role,

        // 原始信息
        _raw_csmctl_info: basicData,
        _raw_vrctl_info: deviceData,

        // 扩展信息
        vr3_info: extendedData,
      };
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
    console.error('[VR_CACHE] pagelist error', err);
    return res.status(500).json({ code: 500, msg: err?.message || 'internal error' });
  }
});
