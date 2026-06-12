import {
  CSM_FALLBACK_WEB_PORTS,
  csmPreAuthLogin,
  csmRequest,
  csmWebSessionLogin,
  type CsmConfig,
} from './client';
import { resolveCsmPasswordEncrypted } from './csmWebPassword';
import { logger } from '../../../utils/logger';

const csmV2Log = logger.child('CSM-V2');

export type CsmPagedResponse<T = unknown> = {
  success?: boolean;
  errCode?: number;
  message?: string;
  data?: T[];
  pagination?: { current?: number; pageSize?: number; total?: number };
};

export type CsmRepairAuthOptions = {
  /** 运营侧 Web 登录用户名（cloud.config.csmRepairUsername） */
  username?: string;
  /** RSA 密文（cloud.config.csmRepairPasswordEncrypted） */
  passwordEncrypted?: string;
  webPort?: string;
};

function isCsmAuthFailureMessage(msg: unknown): boolean {
  return /未登录|登录状态已过期|用户名或密码不正确|password|Decryption error/i.test(
    String(msg || ''),
  );
}

function isCsmResponseOk(raw: CsmPagedResponse | null | undefined): boolean {
  if (!raw) return false;
  if (raw.success === false) return false;
  const code = Number((raw as { code?: unknown })?.code);
  if (Number.isFinite(code) && code >= 400) return false;
  if (isCsmAuthFailureMessage(raw.message)) return false;
  if (raw.success === true) return true;
  if (raw.errCode === 0 && Array.isArray(raw.data)) return true;
  if (Array.isArray(raw.data)) return true;
  return false;
}

/** 从 preAuth 响应提取运营侧 token（SSO authentication/auth；拒绝 object 型 data） */
export function extractCsmAuthToken(resp: unknown): string | null {
  if (!resp || typeof resp !== 'object') return null;
  const r = resp as Record<string, unknown>;
  if (r.success === false) return null;
  if (isCsmAuthFailureMessage(r.message)) return null;

  const data = r.data;
  if (typeof data === 'string') {
    const t = data.trim();
    return t.length > 0 ? t : null;
  }
  if (data && typeof data === 'object') {
    const nested = data as Record<string, unknown>;
    if (typeof nested.token === 'string' && nested.token.trim()) return nested.token.trim();
    if (typeof nested.data === 'string' && nested.data.trim()) return nested.data.trim();
  }
  return null;
}

function extractPageItems(raw: CsmPagedResponse): unknown[] {
  if (Array.isArray(raw?.data)) return raw.data;
  return [];
}

function uniqueNonEmpty(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const s = String(v || '').trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

async function obtainCsmToken(
  config: CsmConfig,
  auth?: CsmRepairAuthOptions,
): Promise<string | null> {
  const username = String(auth?.username || 'admin').trim();
  const passwordEncrypted = String(auth?.passwordEncrypted || '').trim();
  if (!passwordEncrypted) return null;
  const webPort = auth?.webPort ? String(auth.webPort) : undefined;
  const resp = await csmPreAuthLogin(config, username, passwordEncrypted, webPort);
  return extractCsmAuthToken(resp);
}

const CSM_V2_AUTH_CONFIG_HINT =
  '请在资源池接入时填写控制台用户名与密码（与 CSM Web 控制台一致）';

async function obtainCsmWebSessionCookie(
  config: CsmConfig,
  auth?: CsmRepairAuthOptions,
): Promise<{ cookie: string | null; loginError?: string }> {
  const username = String(auth?.username || 'admin').trim() || 'admin';
  const passwordEncrypted = String(auth?.passwordEncrypted || '').trim();
  if (!passwordEncrypted) {
    return { cookie: null, loginError: '未配置控制台密码' };
  }

  const portCandidates = uniqueNonEmpty([
    auth?.webPort ? String(auth.webPort) : '',
    ...CSM_FALLBACK_WEB_PORTS,
  ]);

  let lastLoginError = '';
  for (const webPort of portCandidates) {
    const login = await csmWebSessionLogin(config, username, passwordEncrypted, webPort);
    if (login.success && login.cookie) {
      csmV2Log.debug(`web session ok (webPort=${webPort})`);
      return { cookie: login.cookie };
    }
    lastLoginError = String(login.message || '').trim();
  }
  return {
    cookie: null,
    loginError: lastLoginError || '控制台登录失败',
  };
}

async function csmPostJson<T extends CsmPagedResponse>(
  config: CsmConfig,
  path: string,
  body: Record<string, unknown>,
  auth?: CsmRepairAuthOptions,
): Promise<T> {
  const tryOnce = async (opts?: {
    extraHeaders?: Record<string, string>;
    basicAuth?: boolean;
    webPort?: string;
    cookie?: string;
    noAuth?: boolean;
  }) => {
    return (await csmRequest(config, path, {}, 'POST', body, {
      extraHeaders: opts?.extraHeaders,
      basicAuth: opts?.basicAuth,
      webPort: opts?.webPort,
      cookie: opts?.cookie,
      noAuth: opts?.noAuth,
    })) as T;
  };

  // 租户等 v2 Web API 须先控制台登录拿 Cookie；勿先用 AK/SK（会固定返回「登录状态已过期」误导排查）
  const session = await obtainCsmWebSessionCookie(config, auth);
  if (session.cookie) {
    const withCookie = await tryOnce({
      cookie: session.cookie,
      noAuth: true,
      webPort: auth?.webPort,
    });
    if (isCsmResponseOk(withCookie)) return withCookie;
  }

  let raw = await tryOnce();
  if (isCsmResponseOk(raw)) return raw;

  raw = await tryOnce({ basicAuth: true, webPort: auth?.webPort });
  if (isCsmResponseOk(raw)) return raw;

  const token = await obtainCsmToken(config, auth);
  if (token) {
    for (const extraHeaders of [{ token }, { data: token }] as Array<Record<string, string>>) {
      raw = await tryOnce({ extraHeaders });
      if (isCsmResponseOk(raw)) return raw;
    }
  }

  const csmMsg = String(raw?.message || '').trim();
  const loginErr = String(session.loginError || '').trim();
  const authFailed = !session.cookie || isCsmAuthFailureMessage(csmMsg);
  const detail = loginErr || csmMsg;
  const msg = authFailed
    ? detail
      ? `CSM 运营接口鉴权失败：${detail}。${CSM_V2_AUTH_CONFIG_HINT}`
      : `CSM 运营接口鉴权失败。${CSM_V2_AUTH_CONFIG_HINT}`
    : String(csmMsg || `CSM 请求失败: ${path}`);
  throw Object.assign(new Error(msg), { status: 502, csmRaw: raw });
}

/** 分页拉取 CSM v2 POST 列表，直至读完 pagination.total */
export async function fetchCsmV2AllPages<TItem = unknown>(
  config: CsmConfig,
  path: string,
  buildBody: (current: number, pageSize: number) => Record<string, unknown>,
  options?: { pageSize?: number; auth?: CsmRepairAuthOptions },
): Promise<TItem[]> {
  const pageSize = Math.min(1000, Math.max(1, Number(options?.pageSize ?? 500)));
  const all: TItem[] = [];
  let current = 1;
  let total = Number.POSITIVE_INFINITY;

  while ((current - 1) * pageSize < total) {
    const body = buildBody(current, pageSize);
    const raw = await csmPostJson<CsmPagedResponse<TItem>>(config, path, body, options?.auth);
    const page = extractPageItems(raw) as TItem[];
    all.push(...page);
    const reportedTotal = Number(raw?.pagination?.total);
    if (Number.isFinite(reportedTotal) && reportedTotal >= 0) {
      total = reportedTotal;
    } else if (page.length < pageSize) {
      break;
    }
    if (page.length === 0) break;
    current += 1;
  }

  csmV2Log.info(`Fetched ${all.length} item(s) from ${path}`);
  return all;
}

export type CsmTenantPageRow = {
  orgId?: string;
  orgName?: string;
  username?: string;
  accountName?: string;
  email?: string;
  phone?: string;
  lockStatus?: number;
  createTime?: number;
};

export type CsmSecurityDomainRow = {
  id?: string;
  name?: string;
  orgId?: string;
  orgName?: string;
  companyId?: string;
  companyName?: string;
  networkCidrs?: string[];
  networkAllNums?: number;
  flowStatus?: number;
  createTime?: number;
  updateTime?: number;
};

export async function listCsmTenantsPaged(
  config: CsmConfig,
  auth?: CsmRepairAuthOptions,
  pageSize = 500,
): Promise<CsmTenantPageRow[]> {
  return fetchCsmV2AllPages<CsmTenantPageRow>(
    config,
    '/csm/api/v2.0/tenant/page',
    (current, ps) => ({
      current,
      pageSize: ps,
      field: '',
      value: '',
    }),
    { pageSize, auth },
  );
}

export async function listCsmSecurityDomainsPaged(
  config: CsmConfig,
  auth?: CsmRepairAuthOptions,
  pageSize = 500,
): Promise<CsmSecurityDomainRow[]> {
  return fetchCsmV2AllPages<CsmSecurityDomainRow>(
    config,
    '/csm/api/v2.0/security/domain/search',
    (current, ps) => ({
      current,
      pageSize: ps,
      isOperate: true,
      needAssistField: true,
    }),
    { pageSize, auth },
  );
}

/** 从 cloud.config 解析控制台 RSA 密文（支持明文或误填密文框的明文） */
export function csmRepairAuthFromConfig(
  config: Record<string, unknown> | undefined,
  endpoint?: string,
): CsmRepairAuthOptions {
  const cfg = config || {};
  const username = String(cfg.csmRepairUsername ?? cfg.csmApiUsername ?? 'admin').trim() || 'admin';
  const passwordEncrypted = resolveCsmPasswordEncrypted(cfg);
  let webPort = '';
  try {
    const ep = String(endpoint ?? cfg.endpoint ?? '').trim();
    if (ep) {
      const u = new URL(ep.startsWith('http') ? ep : `https://${ep}`);
      webPort = u.port || '';
    }
  } catch {
    webPort = '';
  }
  return {
    username,
    passwordEncrypted: passwordEncrypted || undefined,
    webPort: webPort || undefined,
  };
}
