import { Router } from 'express';
import { AppDataSource } from '../../config/database';
import { VRCacheBasic } from '../../entities/vRouter/VRCacheBasic';
import { VRCacheExtended } from '../../entities/vRouter/VRCacheExtended';
import { VRCacheDevice } from '../../entities/vRouter/VRCacheDevice';
import { VRCacheService, type VrCacheSyncDiagnostics } from '../../services/vrouter/VRCacheService';
import {
  getVR2QueryResult,
  getVR3ListMeta,
  getVRListMeta,
} from '../../services/vrouter/vrController';
import { extractRows } from '../../utils/apiUtils';
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
  /** CSM VR2 查询明细（业务码/传输错误），与 vr2_info 分离 */
  vr2Query?: Record<string, unknown> | null;
  /** 最近一次 POST /vr-instances/refresh 触发的全量同步摘要 */
  vrSyncDiagnostics?: VrCacheSyncDiagnostics | null;
  /** 实时拉取 VR1 pagelist（仅当查询参数开启），原始 JSON + 匹配行 */
  vr1LiveCsm?: Record<string, unknown> | null;
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
  if (params.vr2Query != null) {
    merged._vr2_query = params.vr2Query;
  }
  if (params.vrSyncDiagnostics != null) {
    merged._vr_sync_diagnostics = params.vrSyncDiagnostics;
  }
  if (params.basicRow != null && params.basicRow.data != null) {
    merged._vr1_tower_db_storage_json_text =
      typeof params.basicRow.data === 'string'
        ? params.basicRow.data
        : JSON.stringify(params.basicRow.data);
  }
  if (params.vr1LiveCsm != null) {
    merged._vr1_live_csm_instant = params.vr1LiveCsm;
  }

  const bd =
    basicData && typeof basicData === 'object' && !Array.isArray(basicData) ? basicData : {};
  const nonEmptyKeys = Object.keys(bd).filter((k) => {
    const v = (bd as Record<string, unknown>)[k];
    return v !== null && v !== undefined && v !== '';
  });
  if (params.basicRow && nonEmptyKeys.length <= 2) {
    merged._vr1_row_hint =
      'VR1 是注册信息（列表侧关键基础/关键帧）。本条非空字段很少：若 vr1 同步成功，则与 CSM 注册列表当前返回一致；若对端本应带齐 name/mac 等，需在 CSM/注册接口侧排查，Tower 不会补造。';
  }

  return merged;
}

/** 从 CSM 拉回 VR1 注册信息、VR3 扩展、本地 device 镜像；失败侧清空，避免与对端不一致的旧快照 */
vrInstancesRoutes.post('/refresh', async (req, res) => {
  try {
    await VRCacheService.getInstance().syncAll();
    const diagnostics = VRCacheService.getInstance().getLastSyncDiagnostics();
    res.json({
      message: 'ok',
      status: 'ok',
      data: diagnostics,
    });
  } catch (err: any) {
    vrInstHttpLog.error('Manual sync error', err instanceof Error ? err.message : String(err));
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
    const all = req.query.all === '1' || req.query.all === 'true' || req.query.all === 'yes';

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
    const deviceMap = new Map(deviceRows.map((r) => [r.uuid, safeJsonParse(r.data, null as any)]));

    const mergedList = basicRows.map((basic) => {
      const uuid = basic.uuid;
      const basicData = safeJsonParse(basic.data, {});
      const extendedData = extendedMap.get(uuid) || null;
      const deviceData = deviceMap.get(uuid) || null;
      return mergeOne({ uuid, basicData, extendedData, deviceData });
    });

    /** 列表行数唯一来源：VR1 同步写入的 VRCacheBasic（与 CSMCTL VR1 pagelist 条数一致） */
    const listMeta = {
      list_row_source: 'vr1_basic_cache' as const,
      vr1_basic_row_count: basicRows.length,
    };

    if (all) {
      return res.json({
        code: 200,
        msg: 'ok',
        data: { total: mergedList.length, items: mergedList, _meta: listMeta },
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
        _meta: listMeta,
      },
    });
  } catch (err: any) {
    vrInstHttpLog.error('list error', err instanceof Error ? err.message : String(err));
    return res.status(500).json({ code: 500, msg: err?.message || 'internal error' });
  }
});

/**
 * GET /api/vr-instances/:uuid/csm-live-raw
 * 并行直连 CSM：返回 VR1 列表、VR2 单实例、VR3 列表三次调用的**真实 HTTP JSON**（与 csmRequest 收到的一致），用于排障。
 * 查询参数：page_size（默认 1000，上限 5000）、page_num（默认 1）
 */
vrInstancesRoutes.get('/:uuid/csm-live-raw', async (req, res) => {
  try {
    const uuid = String(req.params.uuid || '').trim();
    if (!uuid) return res.status(400).json({ code: 400, msg: 'uuid required' });

    const pageSize = Math.min(Math.max(Number(req.query.page_size ?? 1000) || 1000, 1), 5000);
    const pageNum = Math.min(Math.max(Number(req.query.page_num ?? 1) || 1, 1), 100);

    const vr1Promise = getVRListMeta(pageSize, pageNum).then((m) => {
      const rows = extractRows(m.payload);
      const match = rows.find(
        (row: any) => String(row?.uuid || row?.id || row?.vm_id || '').trim() === uuid,
      );
      return {
        csm_path: '/V2/ctcontrol/VR1/pagelist',
        csm_query: { page_size: pageSize, page_num: pageNum },
        /** csmRequest 收到的响应体，原样 */
        raw_http_response_json: m.rawHttpBody,
        tower_unwrapped_payload: m.payload,
        csm_business_error: m.bizError,
        list_row_matching_uuid: match ?? null,
      };
    });

    const vr2Promise = getVR2QueryResult(uuid).then((r) => ({
      csm_path: '/V2/ctcontrol/VR2/VRConfig',
      csm_query: { uuid },
      raw_http_response_json: r.csm_http_body_raw,
      tower_parsed_config: r.config,
      csm_business_error: r.csmBizError,
      transport_error: r.transportError,
    }));

    const vr3Promise = getVR3ListMeta(pageSize, pageNum).then((m) => {
      const rows = extractRows(m.payload);
      const match = rows.find((row: any) => String(row?.uuid || row?.id || '').trim() === uuid);
      return {
        csm_path: '/V2/ctcontrol/VR3/VRConfig/list',
        csm_query: { page_size: pageSize, page_num: pageNum },
        raw_http_response_json: m.rawHttpBody,
        tower_unwrapped_payload: m.payload,
        csm_business_error: m.bizError,
        list_row_matching_uuid: match ?? null,
      };
    });

    const settled = await Promise.allSettled([vr1Promise, vr2Promise, vr3Promise]);

    const pick = (i: 0 | 1 | 2, label: string) => {
      const s = settled[i];
      if (s.status === 'fulfilled') return s.value;
      const reason = s.reason;
      const msg = reason instanceof Error ? reason.message : String(reason ?? 'unknown');
      vrInstHttpLog.warn(`csm-live-raw ${label} failed`, msg);
      return { transport_error: msg };
    };

    return res.json({
      code: 200,
      msg: 'ok',
      data: {
        probed_at: new Date().toISOString(),
        uuid,
        vr1_pagelist: pick(0, 'vr1'),
        vr2_vrconfig: pick(1, 'vr2'),
        vr3_config_list: pick(2, 'vr3'),
      },
    });
  } catch (err: any) {
    vrInstHttpLog.error('csm-live-raw error', err instanceof Error ? err.message : String(err));
    return res.status(500).json({ code: 500, msg: err?.message || 'internal error' });
  }
});

/**
 * GET /api/vr-instances/:uuid
 * - ?includeVr2=0|false：跳过 CSM 实时 VR2
 * - ?includeLiveVr1Raw=1|true：额外实时请求 VR1 pagelist，原始 JSON 写入 _vr1_live_csm_instant（略增负载）
 */
vrInstancesRoutes.get('/:uuid', async (req, res) => {
  try {
    const uuid = String(req.params.uuid || '').trim();
    if (!uuid) return res.status(400).json({ code: 400, msg: 'uuid required' });

    const includeVr2 = req.query.includeVr2 !== 'false' && req.query.includeVr2 !== '0';
    const includeLiveVr1Raw =
      req.query.includeLiveVr1Raw === '1' || req.query.includeLiveVr1Raw === 'true';

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
    let vr2Query: Record<string, unknown> | null = null;
    if (includeVr2) {
      const r = await getVR2QueryResult(uuid);
      vr2Data = r.config;
      vr2Query = {
        vr2_config_present: r.config != null,
        csm_business_error: r.csmBizError,
        transport_error: r.transportError,
        /** CSM `/V2/ctcontrol/VR2/VRConfig` 返回的原始 JSON（与 csmRequest 一致，未再封装） */
        csm_http_response_body: r.csm_http_body_raw,
      };
    } else {
      vr2Query = {
        skipped: true,
      };
    }

    const vrSyncDiagnostics = VRCacheService.getInstance().getLastSyncDiagnostics();

    let vr1LiveCsm: Record<string, unknown> | null = null;
    if (includeLiveVr1Raw) {
      try {
        const m = await getVRListMeta(1000, 1);
        const rows = extractRows(m.payload);
        const match = rows.find(
          (row: any) => String(row?.uuid || row?.id || row?.vm_id || '').trim() === uuid,
        );
        vr1LiveCsm = {
          csm_http_response_body: m.rawHttpBody,
          csm_business_error: m.bizError,
          matching_list_row: match ?? null,
        };
      } catch (e: any) {
        vr1LiveCsm = { transport_error: e?.message || String(e) };
      }
    }

    const data = mergeOne({
      uuid,
      basicRow,
      extendedRow,
      deviceRow,
      vr2Data,
      vr2Query,
      vrSyncDiagnostics,
      vr1LiveCsm,
    });

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
