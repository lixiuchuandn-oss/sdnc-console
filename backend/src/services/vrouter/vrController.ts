/**
 * CSMCTL 虚拟路由控制面客户端。
 *
 * - **读**：VR1/VR3 列表与 VR2 单条查询统一走 `csmRequest`（本地 HMAC 签名，见 `clouds/csm/client`）。
 * - **写**：VR2 配置推送仍走历史路径：`POST /api/sign` 取 Authorization，再 `axios.post` 到 CSMCTL（与旧版 ctl 兼容）。
 *
 * | 能力 | HTTP |
 * |------|------|
 * | VR1 注册列表（分页） | `GET /V2/ctcontrol/VR1/pagelist` |
 * | VR2 单实例配置 | `GET/POST /V2/ctcontrol/VR2/VRConfig` |
 * | VR3 扩展列表（分页） | `GET /V2/ctcontrol/VR3/VRConfig/list` |
 */
import axios from 'axios';
import https from 'https';
import { getSystemSetting } from '../../config/systemSettings';
import { extractRows } from '../../utils/apiUtils';
import { logger } from '../../utils/logger';
import { csmRequest, CsmConfig } from '../clouds/csm/client';

const vrCtlLog = logger.child('VR-Ctl');

const ACCESS_KEY = 'Cloudmap%23123';
const SECRET_KEY = 'Cloudmap%23123';

const PATH_VR1_PAGELIST = '/V2/ctcontrol/VR1/pagelist';
const PATH_VR2_CONFIG = '/V2/ctcontrol/VR2/VRConfig';
const PATH_VR3_LIST = '/V2/ctcontrol/VR3/VRConfig/list';

const MAX_VR_LIST_PAGES = 500;

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** 历史 VR2 POST 前向 CSMCTL `/api/sign` 换回的鉴权头（仅本模块内部使用） */
interface LegacyCsmAuthHeaders {
  Authorization: string;
  tonce: number;
}

/** CSM 业务层错误（HTTP 200 时仍可能返回非 200 的 code） */
export type CsmVrBizError = {
  code: number;
  msg?: string;
  data?: unknown;
  requestId?: string;
};

/** VR1/VR3 分页接口：解析后的 data 区 + 业务错误 + 原始 HTTP JSON */
export type CsmVrListMetaResult = {
  payload: any;
  bizError: CsmVrBizError | null;
  rawHttpBody: unknown;
};

export type FetchAllVrRowsFromCsmResult = {
  rows: any[];
  bizError: CsmVrBizError | null;
  pagesFetched: number;
  reportedTotal?: number;
};

// ---------------------------------------------------------------------------
// CSM 基址与客户端
// ---------------------------------------------------------------------------

function getCsmctlBaseUrl(): string {
  const raw = String(getSystemSetting('CSMCTL_ADDRESS') || '').trim();
  if (!raw) {
    throw new Error('CSMCTL_ADDRESS 未配置，请在系统设置中配置 CSMCTL 地址');
  }
  const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withProto.replace(/\/+$/, '');
}

function getSignedRequestClient() {
  return axios.create({
    baseURL: getCsmctlBaseUrl(),
    httpsAgent,
    timeout: 20000,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

function csmVrConfig(): CsmConfig {
  return {
    endpoint: getCsmctlBaseUrl(),
    accessKey: ACCESS_KEY,
    secretKey: SECRET_KEY,
    ignoreTls: true,
  };
}

function detectCsmBizError(obj: unknown): CsmVrBizError | null {
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  const c = o.code;
  if (typeof c !== 'number') return null;
  if (c === 200 || c === 0) return null;
  return {
    code: c,
    msg: typeof o.msg === 'string' ? o.msg : o.msg != null ? String(o.msg) : undefined,
    data: o.data,
    requestId: typeof o.requestId === 'string' ? o.requestId : undefined,
  };
}

/**
 * 将 CSM 列表类 GET 的原始 JSON 解包为「内层 data」（与历史实现对齐：先取 .data，再 code===200 时再取 .data）。
 */
function parseCsmListMetaEnvelope(raw: unknown): { payload: any; bizError: CsmVrBizError | null } {
  let inner: any =
    raw != null && typeof raw === 'object' && (raw as any).data != null ? (raw as any).data : raw;

  let biz = detectCsmBizError(inner);
  if (biz) return { payload: null, bizError: biz };

  if (
    inner &&
    typeof inner === 'object' &&
    inner.code === 200 &&
    Object.prototype.hasOwnProperty.call(inner, 'data') &&
    inner.data != null
  ) {
    inner = inner.data;
    biz = detectCsmBizError(inner);
    if (biz) return { payload: null, bizError: biz };
  }

  return { payload: inner, bizError: null };
}

async function requestCsmVrPagelist(
  path: string,
  pageSize: number,
  pageNum: number,
): Promise<CsmVrListMetaResult> {
  const cfg = csmVrConfig();
  const raw = await csmRequest(cfg, path, { page_size: pageSize, page_num: pageNum }, 'GET');
  const { payload, bizError } = parseCsmListMetaEnvelope(raw);
  if (bizError) {
    return { payload: null, bizError, rawHttpBody: raw };
  }
  return { payload, bizError: null, rawHttpBody: raw };
}

// ---------------------------------------------------------------------------
// VR1 / VR3：单页与全量分页
// ---------------------------------------------------------------------------

/** VR1 注册列表（单页） */
export async function getVRListMeta(
  pageSize: number = 1000,
  pageNum: number = 1,
): Promise<CsmVrListMetaResult> {
  return requestCsmVrPagelist(PATH_VR1_PAGELIST, pageSize, pageNum);
}

/** VR3 扩展列表（单页） */
export async function getVR3ListMeta(
  pageSize: number = 1000,
  pageNum: number = 1,
): Promise<CsmVrListMetaResult> {
  return requestCsmVrPagelist(PATH_VR3_LIST, pageSize, pageNum);
}

function extractTotalFromListPayload(payload: any): number | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  const o = payload as Record<string, unknown>;
  for (const k of ['total', 'total_count', 'totalCount', 'count'] as const) {
    const v = o[k];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return Math.floor(v);
  }
  return undefined;
}

/** 按接口返回顺序去重，主键优先 uuid，其次 id，再次 vm_id */
function dedupeVrRowsById(rows: any[]): any[] {
  const seen = new Set<string>();
  const out: any[] = [];
  for (const row of rows) {
    const id = String(row?.uuid || row?.id || row?.vm_id || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(row);
  }
  return out;
}

async function fetchAllVrRowsFromPagelist(
  pathLabel: 'VR1' | 'VR3',
  fetchPage: (pageSize: number, pageNum: number) => Promise<CsmVrListMetaResult>,
  pageSize: number,
): Promise<FetchAllVrRowsFromCsmResult> {
  const cap = Math.min(Math.max(pageSize, 1), 2000);
  let pageNum = 1;
  const rawOrdered: any[] = [];
  let reportedTotal: number | undefined;

  for (;;) {
    const { payload, bizError } = await fetchPage(cap, pageNum);
    if (bizError) {
      return { rows: [], bizError, pagesFetched: pageNum - 1, reportedTotal };
    }
    const t = extractTotalFromListPayload(payload);
    if (t != null && reportedTotal === undefined) reportedTotal = t;

    const pageRows = extractRows(payload);
    rawOrdered.push(...pageRows);

    if (pageRows.length === 0) break;
    if (pageRows.length < cap) break;
    if (pageNum >= MAX_VR_LIST_PAGES) {
      vrCtlLog.warn(`${pathLabel} pagelist 已达最大分页次数 ${MAX_VR_LIST_PAGES}，停止拉取`);
      break;
    }
    pageNum += 1;
  }

  const rows = dedupeVrRowsById(rawOrdered);
  if (reportedTotal != null && rows.length !== reportedTotal) {
    vrCtlLog.warn(
      `${pathLabel} 去重后行数 ${rows.length} 与对端声明 total=${reportedTotal} 不一致，以实际返回行为准`,
    );
  }

  return { rows, bizError: null, pagesFetched: pageNum, reportedTotal };
}

/** VR1 全部分页（Tower 缓存同步主路径） */
export async function fetchAllVR1RowsFromCsm(
  pageSize: number = 1000,
): Promise<FetchAllVrRowsFromCsmResult> {
  return fetchAllVrRowsFromPagelist('VR1', getVRListMeta, pageSize);
}

/** VR3 全部分页 */
export async function fetchAllVR3RowsFromCsm(
  pageSize: number = 1000,
): Promise<FetchAllVrRowsFromCsmResult> {
  return fetchAllVrRowsFromPagelist('VR3', getVR3ListMeta, pageSize);
}

// ---------------------------------------------------------------------------
// VR2：读（csmRequest）与写（/api/sign + axios）
// ---------------------------------------------------------------------------

/**
 * VR2 单次查询：解析后的配置体、业务错误、传输错误、原始 HTTP JSON（供路由聚合与排障）。
 */
export async function getVR2QueryResult(uuid: string): Promise<{
  config: any | null;
  csmBizError: CsmVrBizError | null;
  transportError: string | null;
  csm_http_body_raw: unknown;
}> {
  const u = String(uuid || '').trim();
  if (!u) {
    return {
      config: null,
      csmBizError: null,
      transportError: 'empty uuid',
      csm_http_body_raw: null,
    };
  }

  const config = csmVrConfig();
  const query = { uuid: u };

  let lastError: unknown = null;
  let lastRaw: unknown = null;

  for (let i = 0; i < 3; i++) {
    try {
      const raw = await csmRequest(config, PATH_VR2_CONFIG, query, 'GET');
      lastRaw = raw;

      let dataField: any =
        raw != null && typeof raw === 'object' && 'data' in raw && (raw as any).data != null
          ? (raw as any).data
          : raw;

      if (dataField && typeof dataField === 'object' && dataField.code === 10005) {
        throw new Error(`签名不匹配: ${dataField.msg}`);
      }

      if (
        dataField &&
        typeof dataField === 'object' &&
        dataField.code === 200 &&
        Object.prototype.hasOwnProperty.call(dataField, 'data') &&
        dataField.data != null
      ) {
        dataField = dataField.data;
      }

      const biz = detectCsmBizError(dataField);
      if (biz) {
        return {
          config: null,
          csmBizError: biz,
          transportError: null,
          csm_http_body_raw: lastRaw,
        };
      }

      return {
        config: dataField,
        csmBizError: null,
        transportError: null,
        csm_http_body_raw: lastRaw,
      };
    } catch (e: unknown) {
      lastError = e;
      const msg = e instanceof Error ? e.message : String(e);
      vrCtlLog.debug(`VR2 query attempt ${i + 1}/3 failed (${u}): ${msg}`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  const transportError =
    lastError instanceof Error
      ? lastError.message
      : String(lastError || '重试后仍无法获取 VR 配置');
  return {
    config: null,
    csmBizError: null,
    transportError,
    csm_http_body_raw: lastRaw,
  };
}

/** 向 CSMCTL `/api/sign` 申请 POST 用 Authorization（仅 updateVRConfig 使用） */
async function fetchLegacyPostAuthHeaders(
  path: string,
  method: string,
  other: string,
  body?: unknown,
): Promise<LegacyCsmAuthHeaders> {
  const authUrl =
    `/api/sign?` +
    `url=${encodeURIComponent(path)}&` +
    `method=${method}&` +
    `other=${encodeURIComponent(other)}&` +
    `accessKey=${ACCESS_KEY}&` +
    `secretKey=${SECRET_KEY}`;

  const client = getSignedRequestClient();
  const response = await client.post(authUrl, body != null ? body : '');

  if (!response.data?.data) {
    throw new Error('认证响应格式无效');
  }

  return response.data.data as LegacyCsmAuthHeaders;
}

// ---------------------------------------------------------------------------
// 门面：供 sdn 路由使用的稳定入口（避免在 route 层散落 csmRequest 细节）
// ---------------------------------------------------------------------------

export const vrController = {
  /**
   * VR1 分页 payload；业务失败或传输失败时返回 `null`（与历史行为一致）。
   * 全量列表请用 `fetchAllVR1RowsFromCsm` 或 Tower `/api/vr-instances` 缓存。
   */
  getVRList: async (pageSize: number = 50, pageNum: number = 1) => {
    try {
      vrCtlLog.debug('getVRList', { pageSize, pageNum });
      const { payload, bizError } = await getVRListMeta(pageSize, pageNum);
      if (bizError) {
        vrCtlLog.warn('VR1 CSM 业务错误', bizError);
        return null;
      }
      return payload;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      vrCtlLog.debug('获取 VR1 列表失败:', msg);
      throw error;
    }
  },

  /** 拉取 VR2 配置体；业务错误返回 null；传输错误抛错 */
  getVRConfig: async (uuid: string) => {
    const r = await getVR2QueryResult(uuid);
    if (r.config != null) return r.config;
    if (r.csmBizError != null) return null;
    if (r.transportError) throw new Error(r.transportError);
    return null;
  },

  /** 推送 VR2 全量配置到 CSMCTL */
  updateVRConfig: async (
    uuid: string,
    data: any,
  ): Promise<{ status: number; headers: any; data: any }> => {
    const method = 'POST';
    const other = `uuid=${uuid}`;
    const body = { uuid, ...data };

    vrCtlLog.debug(`POST ${PATH_VR2_CONFIG}?${other}`, JSON.stringify(body));

    const auth = await fetchLegacyPostAuthHeaders(PATH_VR2_CONFIG, method, other, body);

    const client = getSignedRequestClient();
    const response = await client.post(`${PATH_VR2_CONFIG}?${other}`, body, {
      headers: {
        Authorization: auth.Authorization,
        tonce: auth.tonce,
      },
    });

    return {
      status: response.status,
      headers: response.headers,
      data: response.data,
    };
  },
};
