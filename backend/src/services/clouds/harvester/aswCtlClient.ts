/**
 * ASW-CTL 北向 HTTP 客户端（集群侧部署的接入交换机只读探测服务）。
 * 北向契约以运行实例与部署文档为准（Tower 聚合探测不拉取根路径 /openapi.yaml）。
 *
 * 使用 Node 原生 http/https，避免 axios 受 HTTP(S)_PROXY、重定向丢头等影响导致 /v1 鉴权头未到达 ASW-CTL。
 */
import http from 'http';
import https from 'https';
import { URL } from 'url';

export type AswCtlFetchResult =
  | { ok: true; data: any }
  | { ok: false; status?: number; data?: any; message: string };

/** 设为1 时 API Key 仅 trim，不做引号/BOM/整行 env 清洗（排查「清洗后与 ASW_CTL_API_KEY 不一致」） */
const RAW_API_KEY = process.env.ASW_CTL_RAW_API_KEY === '1';

/** 从 ASW-CTL JSON 错误体中取出可读字符串（避免 error 为对象时变成 [object Object]） */
function formatAswCtlErrorBody(data: unknown): string {
  if (data == null) return '';
  if (typeof data === 'string') return data.trim();
  if (typeof data !== 'object') return String(data);
  const o = data as Record<string, unknown>;
  const msg = o.message;
  if (typeof msg === 'string' && msg.trim()) return msg.trim();
  const err = o.error;
  if (typeof err === 'string' && err.trim()) return err.trim();
  if (err && typeof err === 'object') {
    const eo = err as Record<string, unknown>;
    const em =
      (typeof eo.message === 'string' && eo.message) ||
      (typeof eo.msg === 'string' && eo.msg) ||
      '';
    const code = typeof eo.code === 'string' ? eo.code : '';
    if (em && code) return `${code}: ${em}`;
    if (em) return String(em);
    if (code) return String(code);
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  try {
    return JSON.stringify(o);
  } catch {
    return `HTTP 错误体无法解析`;
  }
}

/**
 * 规范化用户粘贴的 API Key，尽量与对端环境变量 ASW_CTL_API_KEY 字节一致。
 * ASW-CTL 侧为逐字节比对、不剥引号；此处主要纠正常见粘贴误差（引号/BOM/整行 env）。
 * 若进程里密钥含非常规字符，请勿过度依赖清洗，以与 env 完全一致为准。
 */
export function normalizeAswCtlApiKeySecret(raw: unknown): string | undefined {
  if (raw == null) return undefined;
  if (RAW_API_KEY) {
    const s = String(raw).trim();
    return s || undefined;
  }
  let s = String(raw)
    .replace(/^\uFEFF/, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
  if (!s) return undefined;
  const stripQuotes = (t: string) => {
    if (t.length >= 2) {
      const a = t[0];
      const b = t[t.length - 1];
      if ((a === '"' && b === '"') || (a === "'" && b === "'") || (a === '\u201c' && b === '\u201d')) {
        return t.slice(1, -1).trim();
      }
    }
    return t;
  };
  s = stripQuotes(s);
  if (!s) return undefined;
  const lineMatch = s.match(/^\s*ASW_CTL_API_KEY\s*=\s*(.+?)\s*$/im);
  if (lineMatch) {
    s = stripQuotes(lineMatch[1].trim());
  }
  return s || undefined;
}

/**
 * 与 ASW-CTL（Go 参考实现）一致：可同时带 X-API-Key 与 Authorization: Bearer；
 * 服务端先比对 X-API-Key，不通过再比对 Bearer token（常量时间、非 JWT）。
 */
function aswCtlAuthHeaders(k: string): Record<string, string> {
  return {
    'X-API-Key': k,
    Authorization: `Bearer ${k}`,
  };
}

/**
 * 规范化用户填写的 ASW-CTL 根地址：
 * - 全角冒号 「：」→ 「:」
 * - 无协议时补 http://（避免被当成相对路径或异常解析）
 * - 只保留 origin（scheme+host+port），去掉 path；末尾无 `/`，与 `/v1/...` 拼接不会出现 `//v1`
 */
/**
 * 北向业务 API 路径前缀（无末尾 `/`）。
 * - 默认 `/v1`：旧版 ASW-CTL，如 `/v1/switch/info`。
 * - 集群 HSM：`/v1/hms`，如 `/v1/hms/switch/info`（与对端 SwitchRouter 前缀一致）。
 * 覆盖：环境变量 `ASW_CTL_V1_PREFIX`（例：`/v1/hms`）。
 */
export function getAswCtlNorthApiPrefix(): string {
  const raw = process.env.ASW_CTL_V1_PREFIX;
  if (raw != null && String(raw).trim()) {
    let p = String(raw).trim().replace(/\/+$/, '');
    if (!p.startsWith('/')) p = `/${p}`;
    return p;
  }
  return '/v1';
}

function normalizeNorthPrefix(raw: string): string {
  let p = String(raw || '').trim().replace(/\/+$/, '');
  if (!p.startsWith('/')) p = `/${p}`;
  return p;
}

/** 拼接北向业务路径，如 `northApiPath('/switch/info')` → `/v1/switch/info` 或 `/v1/hms/switch/info` */
export function northApiPath(pathAfterPrefix: string): string {
  const pfx = normalizeNorthPrefix(getAswCtlNorthApiPrefix());
  const seg = pathAfterPrefix.startsWith('/') ? pathAfterPrefix : `/${pathAfterPrefix}`;
  return `${pfx}${seg}`;
}

/** 显式指定前缀（用于「集群内置 HSM」固定 `/v1/hms`，与独立 ASW-CTL 的 env 前缀区分） */
export function northApiPathWithPrefix(pathAfterPrefix: string, northPrefix: string): string {
  const pfx = normalizeNorthPrefix(northPrefix);
  const seg = pathAfterPrefix.startsWith('/') ? pathAfterPrefix : `/${pathAfterPrefix}`;
  return `${pfx}${seg}`;
}

/** 与 Harvester 控制面探测一致：从资源池 endpoint 得到 scheme+host+port，供 HSM 北向根地址 */
export function harvesterControlPlaneOrigin(endpoint: string): string {
  return sanitizeAswCtlBaseUrl(String(endpoint || '').trim());
}

export function sanitizeAswCtlBaseUrl(raw: string): string {
  let s = String(raw || '')
    .trim()
    .replace(/\uFF1A/g, ':');
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) {
    s = `http://${s}`;
  }
  try {
    const u = new URL(s);
    return u.origin.replace(/\/+$/, '');
  } catch {
    return s.replace(/\/+$/, '');
  }
}

function parseJsonLoose(body: string): any {
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

/**
 * 直连 ASW-CTL（不走代理、不跟随重定向），保证鉴权头原样到达对端。
 */
function aswCtlNodeGet(
  fullUrl: string,
  headers: Record<string, string>,
  insecureTls: boolean,
  timeoutMs: number,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    let u: URL;
    try {
      u = new URL(fullUrl);
    } catch (e: any) {
      reject(new Error(e?.message || 'URL 无效'));
      return;
    }
    const isHttps = u.protocol === 'https:';
    const port =
      u.port !== '' ? parseInt(u.port, 10) : isHttps ? 443 : 80;
    const pathQuery = `${u.pathname}${u.search}`;

    const base: http.RequestOptions = {
      hostname: u.hostname,
      port,
      path: pathQuery,
      method: 'GET',
      headers,
      timeout: timeoutMs,
      agent: false,
    };

    const onResponse = (res: http.IncomingMessage) => {
      const chunks: Buffer[] = [];
      res.on('data', (ch) => chunks.push(ch as Buffer));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode || 0, body });
      });
    };

    let req: http.ClientRequest;
    if (isHttps) {
      req = https.request(
        {
          ...base,
          ...(insecureTls ? { rejectUnauthorized: false } : {}),
        } as https.RequestOptions,
        onResponse,
      );
    } else {
      req = http.request(base, onResponse);
    }

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`ASW-CTL 请求超时（${timeoutMs}ms）`));
    });
    req.end();
  });
}

export async function aswCtlGetJson(
  baseUrl: string,
  path: string,
  apiKey?: string,
  insecureTls = false,
  timeoutMs = 120000,
): Promise<AswCtlFetchResult> {
  const root = sanitizeAswCtlBaseUrl(baseUrl);
  if (!root) {
    return { ok: false, message: 'ASW-CTL baseUrl 为空或无效' };
  }
  const p = path.startsWith('/') ? path : `/${path}`;
  const url = `${root}${p}`;
  const k = normalizeAswCtlApiKeySecret(apiKey);

  const baseHeaders: Record<string, string> = { Accept: 'application/json' };

  try {
    let { status, body } = await aswCtlNodeGet(
      url,
      k ? { ...baseHeaders, ...aswCtlAuthHeaders(k) } : baseHeaders,
      insecureTls,
      timeoutMs,
    );

    if (k && status === 401) {
      ({ status, body } = await aswCtlNodeGet(
        url,
        {
          ...baseHeaders,
          Authorization: `Bearer ${k}`,
        },
        insecureTls,
        timeoutMs,
      ));
    }
    if (k && status === 401) {
      ({ status, body } = await aswCtlNodeGet(
        url,
        { ...baseHeaders, 'X-API-Key': k },
        insecureTls,
        timeoutMs,
      ));
    }

    const data = parseJsonLoose(body);
    if (status >= 200 && status < 300) {
      return { ok: true, data };
    }
    const fromBody = formatAswCtlErrorBody(data);
    let msg = fromBody || `HTTP ${status}`;
    if (status === 401) {
      msg = fromBody
        ? `HTTP 401：${fromBody}`
        : 'HTTP 401：ASW-CTL 需要 API Key。请在资源池「物理交换机 → 临时配置」中填写与 ASW-CTL 环境变量 ASW_CTL_API_KEY 一致的密钥；若服务端未设置该变量则不应出现 401，请检查 ASW-CTL 部署。';
    }
    return {
      ok: false,
      status,
      data,
      message: String(msg),
    };
  } catch (e: any) {
    return { ok: false, message: e?.message || String(e) };
  }
}

/** GET文本（如 OpenAPI YAML）；不走系统 HTTP代理 */
export async function aswCtlGetText(
  baseUrl: string,
  path: string,
  apiKey?: string,
  insecureTls = false,
  timeoutMs = 15000,
): Promise<
  | { ok: true; data: string }
  | { ok: false; status?: number; data?: string; message: string }
> {
  const root = sanitizeAswCtlBaseUrl(baseUrl);
  if (!root) {
    return { ok: false, message: 'ASW-CTL baseUrl 为空或无效' };
  }
  const p = path.startsWith('/') ? path : `/${path}`;
  const url = `${root}${p}`;
  const k = normalizeAswCtlApiKeySecret(apiKey);
  const acceptYaml =
    'application/yaml, text/yaml;q=0.9, text/plain;q=0.8, */*;q=0.5';
  const baseHeaders: Record<string, string> = { Accept: acceptYaml };

  try {
    let { status, body } = await aswCtlNodeGet(
      url,
      k ? { ...baseHeaders, ...aswCtlAuthHeaders(k) } : baseHeaders,
      insecureTls,
      timeoutMs,
    );

    if (k && status === 401) {
      ({ status, body } = await aswCtlNodeGet(
        url,
        {
          ...baseHeaders,
          Authorization: `Bearer ${k}`,
        },
        insecureTls,
        timeoutMs,
      ));
    }
    if (k && status === 401) {
      ({ status, body } = await aswCtlNodeGet(
        url,
        { ...baseHeaders, 'X-API-Key': k },
        insecureTls,
        timeoutMs,
      ));
    }

    if (status >= 200 && status < 300) {
      return { ok: true, data: body };
    }
    const raw = body.trim().slice(0, 800) || formatAswCtlErrorBody(parseJsonLoose(body));
    let msg = raw || `HTTP ${status}`;
    if (status === 401) {
      msg = raw
        ? `HTTP 401：${raw}`
        : 'HTTP 401：ASW-CTL 需要 API Key。请在「临时配置」中填写与 ASW_CTL_API_KEY 一致的密钥。';
    }
    return {
      ok: false,
      status,
      data: body,
      message: String(msg),
    };
  } catch (e: any) {
    return { ok: false, message: e?.message || String(e) };
  }
}

/**
 * 依次探测存活路径；404 则试下一个。
 * ASW-CTL 官方为 GET /healthz（无需鉴权）；仍尝试 /health 等以兼容其他发行。
 * ok: null 表示均未实现（不作为失败）。
 */
export async function aswCtlProbeHealth(
  baseUrl: string,
  apiKey?: string,
  insecureTls = false,
): Promise<
  | { ok: true; path: string; data: any }
  | { ok: false; path: string; message: string; status?: number }
  | { ok: null; message: string }
> {
  const paths = ['/healthz', '/health', '/ready', '/live'];
  for (const path of paths) {
    const r = await aswCtlGetJson(baseUrl, path, apiKey, insecureTls, 8000);
    if (r.ok) return { ok: true, path, data: r.data };
    if (r.status === 404) continue;
    return { ok: false, path, message: r.message, status: r.status };
  }
  return {
    ok: null,
    message:
      '未提供 /healthz、/health、/ready 或 /live（不影响交换机业务探测）',
  };
}

export type NormalizedAswEndpoint = {
  name: string;
  baseUrl: string;
  apiKey?: string;
};

/**
 * 解析资源池 config.aswCtl 中的全部端点（含历史多行 endpoints）。
 * 业务上每资源池仅一台 ASW-CTL，见 {@link normalizeAswCtlEndpoints}。
 */
export function normalizeAswCtlEndpointsAll(cfg: unknown): NormalizedAswEndpoint[] {
  if (!cfg || typeof cfg !== 'object') return [];
  const c = cfg as Record<string, unknown>;
  const eps = c.endpoints;
  if (Array.isArray(eps) && eps.length > 0) {
    const out: NormalizedAswEndpoint[] = [];
    eps.forEach((raw, i) => {
      if (!raw || typeof raw !== 'object') return;
      const e = raw as Record<string, unknown>;
      const baseUrl = sanitizeAswCtlBaseUrl(
        String(e.baseUrl || e.url || '').trim(),
      );
      if (!baseUrl) return;
      const name = String(e.name || e.label || `交换机-${i + 1}`).trim();
      const apiKey = normalizeAswCtlApiKeySecret(e.apiKey);
      out.push({ name, baseUrl, apiKey });
    });
    return out;
  }
  const baseUrl = sanitizeAswCtlBaseUrl(
    String(c.baseUrl || c.url || '').trim(),
  );
  if (!baseUrl) return [];
  const name = String(c.name || 'ASW-CTL').trim();
  const apiKey = normalizeAswCtlApiKeySecret(c.apiKey);
  return [{ name, baseUrl, apiKey }];
}

/** 每资源池仅关联一台 ASW-CTL：只取规范化后的第一条。 */
export function normalizeAswCtlEndpoints(cfg: unknown): NormalizedAswEndpoint[] {
  const all = normalizeAswCtlEndpointsAll(cfg);
  return all.length ? [all[0]!] : [];
}
