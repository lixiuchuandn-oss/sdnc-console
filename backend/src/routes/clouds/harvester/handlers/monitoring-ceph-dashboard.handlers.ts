/**
 * Ceph mgr Dashboard：经 K8s Service 代理访问 mgr REST（summary、通用 proxy、DB 快照等）。
 * 独立文件，避免与 monitoring-overview（存储节点、Prometheus 等）混在同一 handler。
 */

import http from 'http';
import https from 'https';
import axios from 'axios';
import { Request, Response } from 'express';
import { AppDataSource } from '../../../../config/database';
import { CephMgrDashboardSnapshot } from '../../../../entities/harvester/CephMgrDashboardSnapshot';
import { getJsonOnce, resolveHarvesterCloudKubeToken } from '../../../../services/clouds/harvester/utils';
import { ensureProvider, isUnreachableError, normalizeOrigin } from './monitoring-helpers';

/**
 * K8s Service 代理到 Ceph mgr Dashboard：scheme:name:port（见 services/proxy）。
 * 顺序：先 HTTP + 常见监听端口；`https:…:https-dashboard` 很多集群 Service 上存在但 Endpoint 为空（会 503），故排在 HTTP 数字端口之后。
 */
const CEPH_DASH_PROXY_TRIES: readonly string[] = [
  'http:rook-ceph-mgr-dashboard:http-dashboard',
  'http:rook-ceph-mgr-dashboard:7000',
  'http:rook-ceph-mgr-dashboard:dashboard',
  'https:rook-ceph-mgr-dashboard:7000',
  'https:rook-ceph-mgr-dashboard:https-dashboard',
  'https:rook-ceph-mgr-dashboard:8443',
  'https:rook-ceph-mgr-dashboard:8440',
];

/** Dashboard REST 必须在 Accept 中带 ceph 版本媒体类型；勿混用通配 Accept 或仅 application/json，否则易 415 */
const CEPH_DASHBOARD_API_ACCEPTS: readonly string[] = [
  'application/vnd.ceph.api.v1.0+json',
  'application/vnd.ceph.api.v1.1+json',
];

/**
 * 本地 / 联调默认 Dashboard 账号（与 tools/ceph-dashboard-api-probe.ps1 演示一致）。
 * - 显式账号：CEPH_DASHBOARD_USER + CEPH_DASHBOARD_PASSWORD（任意环境优先）
 * - 否则：NODE_ENV 非 production 时自动用 admin/Cloudmap@123（npm run dev / 未设 NODE_ENV 的 npm start 均属此类；联调测试集群）
 * - 显式关闭默认登录：CEPH_DASHBOARD_DISABLE_DEV_DEFAULTS=1
 * - 生产（NODE_ENV=production）且未配账号：仅 Kube Bearer（Dashboard 常 401）
 * - 仅生产仍需演示会话：CEPH_DASHBOARD_DEV_AUTO_LOGIN=1
 */
const CEPH_DASHBOARD_DEV_DEFAULT_USER = 'admin';
const CEPH_DASHBOARD_DEV_DEFAULT_PASSWORD = 'Cloudmap@123';

function getCephDashboardLoginCredentials(): { user: string; password: string } | null {
  const u = process.env.CEPH_DASHBOARD_USER?.trim();
  const p = process.env.CEPH_DASHBOARD_PASSWORD;
  if (u && p !== undefined && String(p).length > 0) {
    return { user: u, password: String(p) };
  }
  if (process.env.CEPH_DASHBOARD_DISABLE_DEV_DEFAULTS === '1') {
    return null;
  }
  const isProd = process.env.NODE_ENV === 'production';
  const useDemoLogin =
    !isProd || process.env.CEPH_DASHBOARD_DEV_AUTO_LOGIN === '1';
  if (useDemoLogin) {
    return { user: CEPH_DASHBOARD_DEV_DEFAULT_USER, password: CEPH_DASHBOARD_DEV_DEFAULT_PASSWORD };
  }
  return null;
}

/** Bearer 串规范化：可能含 Bearer 前缀；令牌来源见 resolveHarvesterCloudKubeToken（资源池 config / secretKey） */
function normalizeHarvesterBearerToken(token: string): string {
  const t = String(token || '').trim();
  if (/^Bearer\s+/i.test(t)) {
    return t.replace(/^Bearer\s+/i, '').trim();
  }
  return t;
}

/**
 * 与 cluster-cache.handlers / listHarvesterNodesStandard 一致：从 /v3/clusters 取下游集群 ID（常为 c-m-xxx），
 * 避免写死 local 导致在非 local 段下 Service 代理 404/502，前端拿不到 summary。
 */
async function resolveRancherK8sClusterSegment(
  origin: string,
  token: string,
  insecure: boolean,
): Promise<string | null> {
  try {
    const json = await getJsonOnce(`${origin}/v3/clusters`, token, insecure, true);
    const arr = Array.isArray(json?.data) ? json.data : Array.isArray(json?.items) ? json.items : [];
    const local = arr.find((c: any) => String(c?.id || c?.Id || '').toLowerCase() === 'local');
    const any = arr[0];
    const id = String(local?.id || local?.Id || any?.id || any?.Id || '').trim();
    return id || null;
  } catch {
    return null;
  }
}

function buildClusterSegmentsOrder(hint: string | undefined, resolved: string | null): string[] {
  const out: string[] = [];
  const push = (s: string) => {
    const t = String(s || '').trim();
    if (t && !out.includes(t)) out.push(t);
  };
  push(String(hint || '').trim());
  if (resolved) push(resolved);
  push('local');
  return out;
}

function buildCephDashboardProxyUrls(
  origin: string,
  namespace: string,
  subPath: string,
  clusterSegments: string[],
): string[] {
  const sub = String(subPath || '').replace(/^\/+/, '');
  const encNs = encodeURIComponent(namespace);
  const pathBases: string[] = [];
  for (const seg of clusterSegments) {
    const s = String(seg || '').trim();
    if (!s) continue;
    pathBases.push(`${origin}/k8s/clusters/${encodeURIComponent(s)}/api/v1/namespaces/${encNs}/services/`);
  }
  pathBases.push(`${origin}/api/v1/namespaces/${encNs}/services/`);
  const urls: string[] = [];
  for (const pb of pathBases) {
    for (const tri of CEPH_DASH_PROXY_TRIES) {
      urls.push(`${pb}${tri}/proxy/${sub}`);
    }
  }
  return urls;
}

function httpStatusFromErr(e: any): number | undefined {
  if (e == null) return undefined;
  if (typeof e.status === 'number' && Number.isFinite(e.status)) return e.status;
  const st = e?.response?.status;
  if (typeof st === 'number' && Number.isFinite(st)) return st;
  return undefined;
}

/** K8s Status / Ceph 错误体：优先 `message`，其次 `detail`（axios 不经 transform 时常为对象或 JSON 字符串） */
function cephDashboardProxyFailureMessage(data: unknown, httpStatus: number): string {
  let parsed: unknown = data;
  if (typeof data === 'string') {
    const t = data.trim();
    if (t.startsWith('{') || t.startsWith('[')) {
      try {
        parsed = JSON.parse(t);
      } catch {
        return t.length ? t.slice(0, 800) : `HTTP ${httpStatus}`;
      }
    } else if (t.length) {
      return t.slice(0, 800);
    }
  }
  if (parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const o = parsed as Record<string, unknown>;
    if (typeof o.message === 'string' && o.message.trim()) return o.message.trim();
    if (typeof o.detail === 'string' && o.detail.trim()) return o.detail.trim();
  }
  return `HTTP ${httpStatus}`;
}

/** 与 tools/ceph-dashboard-api-probe.ps1 Get-DashboardJwtFromJson 一致 */
function cephDashboardJwtFromAuthBody(body: unknown): string {
  if (body == null || typeof body !== 'object') return '';
  const o = body as Record<string, unknown>;
  if (typeof o.token === 'string' && o.token.trim()) return o.token.trim();
  const d = o.data;
  if (d != null && typeof d === 'object' && typeof (d as Record<string, unknown>).token === 'string') {
    const t = String((d as Record<string, unknown>).token).trim();
    if (t) return t;
  }
  return '';
}

function cookieHeaderFromSetCookie(setCookie: string | string[] | undefined): string | undefined {
  if (!setCookie) return undefined;
  const parts = Array.isArray(setCookie) ? setCookie : [setCookie];
  const pairs = parts.map((line) => line.split(';')[0].trim()).filter(Boolean);
  return pairs.length ? pairs.join('; ') : undefined;
}

/** 校验并规范化经 Service 代理的 Dashboard 子路径：`api/...` 或只读 UI 助手 `ui/pool/...` */
function normalizeCephDashboardProxyPath(raw: string): string | null {
  const s = String(raw || '').trim().replace(/^\/+/, '');
  if (!s || s.includes('..') || /[\r\n]/.test(s)) return null;
  const lower = s.toLowerCase();
  const qIdx = s.indexOf('?');
  const pathPart = qIdx >= 0 ? s.slice(0, qIdx) : s;
  const queryPart = qIdx >= 0 ? s.slice(qIdx + 1) : '';
  if (lower.startsWith('ui/pool/')) {
    if (!/^ui\/pool\/[a-zA-Z0-9/_-]+$/.test(pathPart)) return null;
    if (queryPart) return null;
    return pathPart;
  }
  if (!lower.startsWith('api/')) return null;
  // 允许 %xx（池名等路径段的 URL 编码，如 api/pool/foo%20bar/configuration）
  if (!/^api\/[a-zA-Z0-9/_.@$%-]+$/.test(pathPart)) return null;
  if (queryPart && !/^[a-zA-Z0-9&=_%.+~:@/-]+$/.test(queryPart)) return null;
  return queryPart ? `${pathPart}?${queryPart}` : pathPart;
}

const CEPH_PROXY_SESSION_TTL_MS = 50_000;
const cephProxySessionCache = new Map<string, { cookie?: string; jwt?: string; exp: number }>();

function cephProxySessionCacheKey(cloudId: string, namespace: string): string {
  return `${cloudId}\x1e${namespace}`;
}

/**
 * POST api/auth 获取 Dashboard Cookie + JWT，供通用代理复用（与 fetchCephDashboardWithSession 同源）。
 */
async function loginCephDashboardForProxy(
  origin: string,
  kubeToken: string,
  insecure: boolean,
  namespace: string,
  login: { user: string; password: string },
  clusterSegments: string[],
): Promise<{ cookie?: string; jwt?: string } | null> {
  const bareKube = normalizeHarvesterBearerToken(kubeToken);
  const authUrls = buildCephDashboardProxyUrls(origin, namespace, 'api/auth', clusterSegments);
  const authBody = JSON.stringify({ username: login.user, password: login.password });
  const authAccept = 'application/vnd.ceph.api.v1.0+json';
  const contentTypeVariants = ['application/json', 'application/json; charset=utf-8'];

  for (const authUrl of authUrls) {
    const axiosOpts = axiosOptsForDashboardUrl(authUrl, insecure);
    let authRes: { status: number; data: any; headers: any } | null = null;
    let authOk = false;
    for (const ct of contentTypeVariants) {
      const res = await axios.post(authUrl, authBody, {
        ...axiosOpts,
        headers: {
          Authorization: `Bearer ${bareKube}`,
          Accept: authAccept,
          'Content-Type': ct,
        },
      });
      authRes = res;
      if (res.status === 200 || res.status === 201) {
        authOk = true;
        break;
      }
      const rawDetail = typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? {});
      if (res.status === 400 && /invalid_credentials/i.test(rawDetail)) {
        return null;
      }
    }
    if (!authOk || !authRes) continue;
    const cookie = cookieHeaderFromSetCookie(authRes.headers['set-cookie']);
    const jwt = cephDashboardJwtFromAuthBody(authRes.data);
    if (!cookie && !jwt) continue;
    return { cookie: cookie || undefined, jwt: jwt || undefined };
  }
  return null;
}

function serializeProxyRequestBody(body: unknown, contentType: string | undefined): string | undefined {
  if (body === undefined || body === null) return undefined;
  const ct = String(contentType || '').toLowerCase();
  if (typeof body === 'string') return body;
  if (Buffer.isBuffer(body)) return body.toString('utf8');
  if (ct.includes('application/json') || !ct) {
    return JSON.stringify(body);
  }
  return String(body);
}

/**
 * 将任意 HTTP 方法转发到 mgr Dashboard（路径须 api/...）。
 * 依次尝试：Kube+Cookie → 仅 Kube → Dashboard JWT（及 Cookie）。
 */
async function cephDashboardHttpProxy(
  origin: string,
  kubeToken: string,
  insecure: boolean,
  namespace: string,
  apiPath: string,
  method: string,
  reqBody: unknown,
  incomingContentType: string | undefined,
  incomingAccept: string | undefined,
  clusterSegments: string[],
  session: { cookie?: string; jwt?: string } | null,
): Promise<{ status: number; contentType: string; raw: Buffer }> {
  const bareKube = normalizeHarvesterBearerToken(kubeToken);
  const urls = buildCephDashboardProxyUrls(origin, namespace, apiPath, clusterSegments);
  const m = method.toUpperCase();
  const bodyStr = ['POST', 'PUT', 'PATCH'].includes(m)
    ? serializeProxyRequestBody(reqBody, incomingContentType)
    : undefined;
  const accepts =
    incomingAccept && incomingAccept.trim()
      ? [incomingAccept.trim()]
      : [...CEPH_DASHBOARD_API_ACCEPTS, 'application/json'];

  type AuthMode = { bearer: string; cookie?: string };
  const authModes: AuthMode[] = [];
  if (session?.cookie) authModes.push({ bearer: bareKube, cookie: session.cookie });
  authModes.push({ bearer: bareKube });
  if (session?.jwt) {
    authModes.push({ bearer: session.jwt, cookie: session.cookie });
    authModes.push({ bearer: session.jwt });
  }

  let last: { status: number; contentType: string; raw: Buffer } = {
    status: 502,
    contentType: 'application/json',
    raw: Buffer.from(JSON.stringify({ message: '无法连接 Ceph mgr Dashboard' })),
  };

  urlLoop: for (const url of urls) {
    const axiosOpts = axiosOptsForDashboardUrl(url, insecure);
    for (const mode of authModes) {
      for (const accept of accepts) {
        const headers: Record<string, string> = {
          Authorization: `Bearer ${mode.bearer}`,
          Accept: accept,
        };
        if (mode.cookie) headers.Cookie = mode.cookie;
        if (bodyStr != null) {
          headers['Content-Type'] =
            incomingContentType && incomingContentType.trim()
              ? incomingContentType.trim()
              : 'application/json';
        }
        try {
          const res = await axios.request({
            method: m as any,
            url,
            data: bodyStr,
            ...axiosOpts,
            headers,
            responseType: 'arraybuffer',
            transformResponse: [(d) => d],
          });
          const buf = Buffer.isBuffer(res.data) ? res.data : Buffer.from(res.data || []);
          const contentType = String(res.headers['content-type'] || 'application/octet-stream').split(';')[0].trim();
          last = { status: res.status, contentType, raw: buf };
          if (res.status === 404) continue urlLoop;
          if (res.status === 415) continue;
          if (res.status === 401) break;
          return last;
        } catch (e: any) {
          if (axios.isAxiosError(e) && e.response?.status === 404) continue urlLoop;
          throw e;
        }
      }
    }
  }

  return last;
}

function agentForDashboard(url: string, insecure: boolean) {
  if (url.startsWith('https://')) {
    return new https.Agent({ keepAlive: true, rejectUnauthorized: !insecure });
  }
  return new http.Agent({ keepAlive: true });
}

function axiosOptsForDashboardUrl(url: string, insecure: boolean) {
  const isHttps = url.startsWith('https://');
  const agent = agentForDashboard(url, insecure);
  return {
    ...(isHttps ? { httpsAgent: agent } : { httpAgent: agent }),
    timeout: 25000,
    maxRedirects: 5,
    validateStatus: () => true,
  };
}

/** 仅 K8s Bearer，不经 Dashboard 登录（多数生产环境 Dashboard 会 401） */
async function fetchCephDashboardGetKubeOnly(
  origin: string,
  token: string,
  insecure: boolean,
  namespace: string,
  apiSubPath: string,
  clusterSegments: string[],
): Promise<any> {
  const sub = String(apiSubPath || 'api/summary').replace(/^\/+/, '');
  const urls = buildCephDashboardProxyUrls(origin, namespace, sub, clusterSegments);
  const bare = normalizeHarvesterBearerToken(token);

  let lastErr: any = null;
  urlLoop: for (const url of urls) {
    const axiosOpts = axiosOptsForDashboardUrl(url, insecure);

    for (const accept of CEPH_DASHBOARD_API_ACCEPTS) {
      try {
        const res = await axios.get(url, {
          ...axiosOpts,
          headers: {
            Authorization: `Bearer ${bare}`,
            Accept: accept,
          },
        });
        if (res.status >= 200 && res.status < 300) {
          return res.data;
        }
        if (res.status === 404) {
          continue urlLoop;
        }
        const detailMsg = cephDashboardProxyFailureMessage(res.data, res.status);
        lastErr = {
          status: res.status,
          message: detailMsg,
          body: res.data,
        };
        if (res.status === 415) {
          continue;
        }
        continue urlLoop;
      } catch (e: any) {
        lastErr = e;
        if (axios.isAxiosError(e) && e.response?.status === 404) {
          continue urlLoop;
        }
      }
    }
  }
  const st = httpStatusFromErr(lastErr);
  if (st != null) {
    const body = lastErr?.body ?? lastErr?.response?.data;
    const msgFromBody = cephDashboardProxyFailureMessage(body, st);
    const msg =
      msgFromBody && msgFromBody !== `HTTP ${st}`
        ? msgFromBody
        : typeof lastErr?.message === 'string' && lastErr.message
          ? lastErr.message
          : `HTTP ${st}`;
    throw {
      status: st,
      message: msg || 'Ceph Dashboard API 请求失败',
      body: lastErr?.body ?? lastErr?.response?.data,
    };
  }
  throw lastErr || { status: 502, message: '无法经 Service 代理访问 Ceph mgr Dashboard' };
}

/**
 * POST /api/auth 后与 probe 一致：
 * - 请求体为纯 JSON 字符串 + Content-Type: application/json（避免 axios 对 object 序列化时带 charset=utf-8，部分 Quincy mgr 会 500）
 * - 优先 kube Bearer + Set-Cookie 拉 summary；若无 Cookie 或仍失败，再用响应体中的 Dashboard JWT 作为 Authorization（probe 第二阶段）
 */
async function fetchCephDashboardWithSession(
  origin: string,
  kubeToken: string,
  insecure: boolean,
  namespace: string,
  apiSubPath: string,
  login: { user: string; password: string },
  clusterSegments: string[],
): Promise<any> {
  const bareKube = normalizeHarvesterBearerToken(kubeToken);
  const sub = String(apiSubPath || 'api/summary').replace(/^\/+/, '');
  const authUrls = buildCephDashboardProxyUrls(origin, namespace, 'api/auth', clusterSegments);
  const getUrls = buildCephDashboardProxyUrls(origin, namespace, sub, clusterSegments);

  let lastErr: any = null;
  for (let i = 0; i < authUrls.length; i++) {
    const authUrl = authUrls[i];
    const getUrl = getUrls[i];
    const axiosOpts = axiosOptsForDashboardUrl(authUrl, insecure);

    try {
      const authBody = JSON.stringify({
        username: login.user,
        password: login.password,
      });
      const authAccept = 'application/vnd.ceph.api.v1.0+json';
      const contentTypeVariants = ['application/json', 'application/json; charset=utf-8'];
      let authRes: { status: number; data: any; headers: any } | null = null;
      let authOk = false;
      for (const ct of contentTypeVariants) {
        const res = await axios.post(authUrl, authBody, {
          ...axiosOpts,
          headers: {
            Authorization: `Bearer ${bareKube}`,
            Accept: authAccept,
            'Content-Type': ct,
          },
        });
        authRes = res;
        if (res.status === 200 || res.status === 201) {
          authOk = true;
          break;
        }
        const rawDetail =
          typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? {});
        if (res.status === 400 && /invalid_credentials/i.test(rawDetail)) {
          lastErr = {
            status: 400,
            message: 'Dashboard invalid_credentials（与 probe 一致：请使用 REST 本地密码，非浏览器 SSO）',
            body: res.data,
          };
          authOk = false;
          break;
        }
      }
      if (!authOk || !authRes) {
        if (!lastErr && authRes) {
          lastErr = {
            status: authRes.status,
            message: cephDashboardProxyFailureMessage(authRes.data, authRes.status),
            body: authRes.data,
          };
        }
        if (authRes?.status === 404) continue;
        continue;
      }

      const cookie = cookieHeaderFromSetCookie(authRes.headers['set-cookie']);
      const dashboardJwt = cephDashboardJwtFromAuthBody(authRes.data);

      let summaryPayload: any;
      const attemptGetSummary = async (baseHeaders: Record<string, string>): Promise<'ok' | '404' | 'fail'> => {
        const getAxiosOpts = axiosOptsForDashboardUrl(getUrl, insecure);
        for (const accept of CEPH_DASHBOARD_API_ACCEPTS) {
          const getRes = await axios.get(getUrl, {
            ...getAxiosOpts,
            headers: {
              ...baseHeaders,
              Accept: accept,
            },
          });
          if (getRes.status >= 200 && getRes.status < 300) {
            summaryPayload = getRes.data;
            return 'ok';
          }
          if (getRes.status === 404) return '404';
          if (getRes.status === 415) continue;
          lastErr = {
            status: getRes.status,
            message: cephDashboardProxyFailureMessage(getRes.data, getRes.status),
            body: getRes.data,
          };
          return 'fail';
        }
        return 'fail';
      };

      if (cookie) {
        const r = await attemptGetSummary({
          Authorization: `Bearer ${bareKube}`,
          Cookie: cookie,
        });
        if (r === 'ok') return summaryPayload;
        if (r === '404') continue;
      }

      if (dashboardJwt) {
        const r = await attemptGetSummary({
          Authorization: `Bearer ${dashboardJwt}`,
        });
        if (r === 'ok') return summaryPayload;
        if (r === '404') continue;
      }

      if (!cookie && !dashboardJwt) {
        lastErr = {
          status: 502,
          message: 'Dashboard 登录成功但未返回 Set-Cookie 且响应体无 token',
          body: authRes.data,
        };
        continue;
      }
    } catch (e: any) {
      lastErr = e;
    }
  }

  const st = httpStatusFromErr(lastErr);
  if (st != null) {
    const body = lastErr?.body ?? lastErr?.response?.data;
    const msgFromBody = cephDashboardProxyFailureMessage(body, st);
    const msg =
      msgFromBody && msgFromBody !== `HTTP ${st}`
        ? msgFromBody
        : typeof lastErr?.message === 'string' && lastErr.message
          ? lastErr.message
          : 'Ceph Dashboard 会话请求失败';
    throw {
      status: st,
      message: msg,
      body: lastErr?.body ?? lastErr?.response?.data,
    };
  }
  throw lastErr || { status: 502, message: 'Ceph Dashboard 登录会话不可用' };
}

/**
 * 经 Kubernetes API `services/proxy` 调用 Ceph Dashboard REST。
 * 非 production（或未显式 production）默认 admin/Cloudmap@123 先登录再拉取；生产用 CEPH_DASHBOARD_USER/PASSWORD 或仅 Bearer。
 */
/** 供同步入库等复用；与 GET/POST ceph-dashboard/summary 同源拉取逻辑 */
export async function fetchCephDashboardApi(
  origin: string,
  token: string,
  insecure: boolean,
  namespace: string,
  apiSubPath: string,
  options?: {
    rancherClusterIdHint?: string;
    /** 页面 / 调用方显式传入时优先生效；未传则仍走 CEPH_DASHBOARD_* / 开发默认 */
    dashboardLogin?: { user: string; password: string };
  },
): Promise<any> {
  token = normalizeHarvesterBearerToken(token);
  let resolved: string | null = null;
  try {
    resolved = await resolveRancherK8sClusterSegment(origin, token, insecure);
  } catch {
    resolved = null;
  }
  const clusterSegments = buildClusterSegmentsOrder(options?.rancherClusterIdHint, resolved);

  const ex = options?.dashboardLogin;
  const creds =
    ex && String(ex.user || '').trim() && String(ex.password || '').length > 0
      ? { user: String(ex.user).trim(), password: String(ex.password) }
      : getCephDashboardLoginCredentials();
  if (creds) {
    try {
      return await fetchCephDashboardWithSession(
        origin,
        token,
        insecure,
        namespace,
        apiSubPath,
        creds,
        clusterSegments,
      );
    } catch {
      /* 会话失败时回退为仅 Kube Token（与旧行为一致） */
    }
  }
  return fetchCephDashboardGetKubeOnly(origin, token, insecure, namespace, apiSubPath, clusterSegments);
}

type CephDashboardSummaryOverrides = {
  kubeToken?: string;
  dashboardUsername?: string;
  dashboardPassword?: string;
  namespace?: string;
  path?: string;
};

async function fetchCephDashboardSummaryPayload(
  cloud: any,
  req: Request,
  overrides?: CephDashboardSummaryOverrides,
): Promise<{ data: any; namespace: string; path: string }> {
  const insecure = !!(cloud.config as any)?.ignoreTls;
  const origin = normalizeOrigin(cloud.endpoint || '');
  const token =
    String(overrides?.kubeToken ?? '').trim() || resolveHarvesterCloudKubeToken(cloud);
  const q = (req.query || {}) as Record<string, string | undefined>;
  const namespace =
    String(
      overrides?.namespace || q.namespace || (cloud.config as any)?.cephRookNamespace || 'rook-ceph',
    ).trim() || 'rook-ceph';
  let path = String(overrides?.path || q.path || 'api/summary').trim() || 'api/summary';
  path = path.replace(/^\/+/, '');
  if (!/^api\/[a-zA-Z0-9/_-]+$/.test(path)) {
    throw { status: 400, message: 'path 仅允许 api/ 下的只读子路径' };
  }
  const rancherHint = String((cloud.config as any)?.rancherClusterId || '').trim() || undefined;
  const du = String(overrides?.dashboardUsername ?? '').trim();
  const dp = overrides?.dashboardPassword;
  const dashboardLogin =
    du && dp !== undefined && String(dp).length > 0
      ? { user: du, password: String(dp) }
      : undefined;

  const data = await fetchCephDashboardApi(origin, token, insecure, namespace, path, {
    rancherClusterIdHint: rancherHint,
    dashboardLogin,
  });
  return { data, namespace, path };
}

function respondCephDashboardSummaryError(res: Response, e: any) {
  if (isUnreachableError(e)) {
    return res.status(200).json({
      data: null,
      _tower: { cephDashboardError: 'unreachable', message: e?.message || '网络不可达' },
    });
  }
  if (res.headersSent) return;
  const st = (e as any).status || 502;
  let msg =
    (e as any).message ||
    'Ceph Dashboard API 不可用（可能需 Dashboard 登录或 Rook 命名空间/Service 不一致）';
  if (st === 502 || st === 503) {
    msg += ` 联调：请确认云账号 Token 与 probe 脚本一致、endpoint 为集群 API 根地址且已勾选忽略 TLS（自签证书）；若后端为 NODE_ENV=production，须设置 CEPH_DASHBOARD_USER/PASSWORD 或 CEPH_DASHBOARD_DEV_AUTO_LOGIN=1，或在页面 POST 凭据拉取。`;
  }
  return res.status(200).json({
    data: null,
    _tower: {
      cephDashboardError: true,
      status: st,
      message: msg,
    },
  });
}

/**
 * GET /api/clouds/:id/monitoring/ceph-dashboard/summary
 * Query: namespace（默认 rook-ceph）、path（默认 api/summary，仅允许白名单前缀）
 */
export async function harvesterMonitoringCephDashboardSummaryHandler(req: Request, res: Response) {
  try {
    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;

    const { data, namespace, path } = await fetchCephDashboardSummaryPayload(cloud, req);
    res.json({
      data,
      _tower: { source: 'ceph-mgr-dashboard', proxyPath: path, namespace },
    });
  } catch (e: any) {
    if ((e as any)?.status === 400) {
      return res.status(400).json({ message: (e as any).message || '请求无效' });
    }
    return respondCephDashboardSummaryError(res, e);
  }
}

/**
 * POST /api/clouds/:id/monitoring/ceph-dashboard/summary
 * Body（均为可选）：kubeToken、dashboardUsername、dashboardPassword、namespace、path
 * 用于页面显式填写与 probe 一致的 Kube Token / Dashboard 账号，避免仅依赖云平台保存的 secretKey。
 */
export async function harvesterMonitoringCephDashboardSummaryPostHandler(req: Request, res: Response) {
  try {
    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;

    const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
    const overrides: CephDashboardSummaryOverrides = {
      kubeToken: typeof body.kubeToken === 'string' ? body.kubeToken : undefined,
      dashboardUsername: typeof body.dashboardUsername === 'string' ? body.dashboardUsername : undefined,
      dashboardPassword: typeof body.dashboardPassword === 'string' ? body.dashboardPassword : undefined,
      namespace: typeof body.namespace === 'string' ? body.namespace : undefined,
      path: typeof body.path === 'string' ? body.path : undefined,
    };

    const { data, namespace, path } = await fetchCephDashboardSummaryPayload(cloud, req, overrides);
    res.json({
      data,
      _tower: { source: 'ceph-mgr-dashboard', proxyPath: path, namespace, credentialMode: 'request-body' },
    });
  } catch (e: any) {
    if ((e as any)?.status === 400) {
      return res.status(400).json({ message: (e as any).message || '请求无效' });
    }
    return respondCephDashboardSummaryError(res, e);
  }
}

/**
 * POST /api/clouds/:id/monitoring/ceph-dashboard/sync
 * 拉取 mgr /api/summary 并写入 ceph_mgr_dashboard_snapshot（按 cloudId+namespace 覆盖）。
 * Query: namespace（可选，默认 rook-ceph）
 */
export async function harvesterMonitoringCephDashboardSyncHandler(req: Request, res: Response) {
  try {
    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = normalizeOrigin(cloud.endpoint || '');
    const token = resolveHarvesterCloudKubeToken(cloud);
    const q = (req.query || {}) as Record<string, string | undefined>;
    const namespace = String(q.namespace || (cloud.config as any)?.cephRookNamespace || 'rook-ceph').trim() || 'rook-ceph';
    const rancherHint = String((cloud.config as any)?.rancherClusterId || '').trim() || undefined;

    const repo = AppDataSource.getRepository(CephMgrDashboardSnapshot);

    const persistFailure = async (message: string, httpStatus?: number) => {
      let row = await repo.findOne({ where: { cloudId: cloud.id, namespace } });
      if (!row) {
        row = repo.create({ cloudId: cloud.id, namespace });
      }
      row.fetchError = message.slice(0, 8000);
      row.lastHttpStatus = httpStatus ?? null;
      row.updatedAt = new Date();
      await repo.save(row);
    };

    try {
      const data = await fetchCephDashboardApi(origin, token, insecure, namespace, 'api/summary', {
        rancherClusterIdHint: rancherHint,
      });
      let row = await repo.findOne({ where: { cloudId: cloud.id, namespace } });
      if (!row) {
        row = repo.create({ cloudId: cloud.id, namespace });
      }
      row.summaryJson = JSON.stringify(data);
      row.healthStatus = typeof data?.health_status === 'string' ? data.health_status : null;
      row.mgrId = typeof data?.mgr_id === 'string' ? data.mgr_id : null;
      row.cephVersion =
        typeof data?.version === 'string' ? data.version.slice(0, 1024) : null;
      row.fetchError = null;
      row.lastHttpStatus = 200;
      row.fetchedAt = new Date();
      row.updatedAt = new Date();
      await repo.save(row);
      return res.json({
        ok: true,
        cloudId: cloud.id,
        namespace,
        healthStatus: row.healthStatus,
        mgrId: row.mgrId,
        fetchedAt: row.fetchedAt,
      });
    } catch (e: any) {
      const st = typeof e?.status === 'number' ? e.status : undefined;
      const msg = e?.message || String(e);
      await persistFailure(msg, st);
      return res.status(200).json({
        ok: false,
        cloudId: cloud.id,
        namespace,
        message: msg,
        status: st,
      });
    }
  } catch (e: any) {
    if (res.headersSent) return;
    return res.status(500).json({ message: e?.message || 'Ceph 快照同步失败' });
  }
}

/**
 * GET /api/clouds/:id/monitoring/ceph-dashboard/cache
 * 读取库内最近一次同步的 summary（未同步过则 404）。
 */
export async function harvesterMonitoringCephDashboardCacheHandler(req: Request, res: Response) {
  try {
    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;

    const q = (req.query || {}) as Record<string, string | undefined>;
    const namespace = String(q.namespace || (cloud.config as any)?.cephRookNamespace || 'rook-ceph').trim() || 'rook-ceph';

    const repo = AppDataSource.getRepository(CephMgrDashboardSnapshot);
    const row = await repo.findOne({ where: { cloudId: cloud.id, namespace } });
    if (!row) {
      return res.status(404).json({ message: '暂无快照，请先 POST .../monitoring/ceph-dashboard/sync' });
    }
    let summary: unknown = null;
    if (row.summaryJson) {
      try {
        summary = JSON.parse(row.summaryJson);
      } catch {
        summary = null;
      }
    }
    return res.json({
      cloudId: cloud.id,
      namespace,
      healthStatus: row.healthStatus,
      mgrId: row.mgrId,
      cephVersion: row.cephVersion,
      fetchError: row.fetchError,
      lastHttpStatus: row.lastHttpStatus,
      fetchedAt: row.fetchedAt,
      updatedAt: row.updatedAt,
      summary,
    });
  } catch (e: any) {
    if (res.headersSent) return;
    return res.status(500).json({ message: e?.message || '读取 Ceph 快照失败' });
  }
}

/**
 * 通用代理：将 Ceph mgr Dashboard 下任意 `api/...` REST 转发到集群（经 K8s Service proxy）。
 * GET/HEAD/POST/PUT/PATCH/DELETE
 * Query: path（必填，如 api/summary、api/health/full、api/docs、api/prometheus/...）、namespace（可选）
 * 请求体：与直连 Dashboard 一致（JSON 等）；需 Tower 管理员权限。
 * 会话：在配置了 CEPH_DASHBOARD_* 或开发默认登录时，后端会缓存 Dashboard Cookie/JWT 约 50s。
 */
export async function harvesterMonitoringCephDashboardProxyHandler(req: Request, res: Response) {
  try {
    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;

    const method = String(req.method || 'GET').toUpperCase();
    if (method === 'OPTIONS') {
      res.setHeader('Allow', 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS');
      return res.status(204).end();
    }

    const allowed = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);
    if (!allowed.has(method)) {
      return res.status(405).json({ message: `HTTP ${method} 不支持` });
    }

    const q = (req.query || {}) as Record<string, string | undefined>;
    const pathNorm = normalizeCephDashboardProxyPath(String(q.path || ''));
    if (!pathNorm) {
      return res.status(400).json({
        message:
          '缺少或非法的 query path（须为 api/... 或 ui/pool/...，例如 api/summary、ui/pool/info）',
      });
    }

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = normalizeOrigin(cloud.endpoint || '');
    const token = resolveHarvesterCloudKubeToken(cloud);
    const namespace = String(q.namespace || (cloud.config as any)?.cephRookNamespace || 'rook-ceph').trim() || 'rook-ceph';
    const rancherHint = String((cloud.config as any)?.rancherClusterId || '').trim() || undefined;

    let resolved: string | null = null;
    try {
      resolved = await resolveRancherK8sClusterSegment(origin, normalizeHarvesterBearerToken(token), insecure);
    } catch {
      resolved = null;
    }
    const clusterSegments = buildClusterSegmentsOrder(rancherHint, resolved);

    const ck = cephProxySessionCacheKey(cloud.id, namespace);
    let session: { cookie?: string; jwt?: string } | null = null;
    const cached = cephProxySessionCache.get(ck);
    if (cached && cached.exp > Date.now()) {
      session = { cookie: cached.cookie, jwt: cached.jwt };
    } else {
      const creds = getCephDashboardLoginCredentials();
      if (creds) {
        const logged = await loginCephDashboardForProxy(origin, token, insecure, namespace, creds, clusterSegments);
        if (logged && (logged.cookie || logged.jwt)) {
          session = logged;
          cephProxySessionCache.set(ck, {
            cookie: logged.cookie,
            jwt: logged.jwt,
            exp: Date.now() + CEPH_PROXY_SESSION_TTL_MS,
          });
        }
      }
    }

    const acceptIn = typeof req.headers.accept === 'string' ? req.headers.accept : undefined;
    const ctIn =
      typeof req.headers['content-type'] === 'string' ? req.headers['content-type'] : undefined;

    const payload =
      method === 'GET' || method === 'HEAD' ? undefined : (req as any).body;

    const out = await cephDashboardHttpProxy(
      origin,
      token,
      insecure,
      namespace,
      pathNorm,
      method,
      payload,
      ctIn,
      acceptIn,
      clusterSegments,
      session,
    );

    res.status(out.status);
    if (out.contentType) res.setHeader('Content-Type', out.contentType);
    return res.send(out.raw);
  } catch (e: any) {
    if (res.headersSent) return;
    return res.status(500).json({ message: e?.message || 'Ceph Dashboard 代理失败' });
  }
}
