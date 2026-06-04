import { csmPreAuthLogin, csmRequest, type CsmConfig } from './client';
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
  /** 运营侧 token 登录用户名（cloud.config.csmRepairUsername） */
  username?: string;
  /** 已加密的密码（cloud.config.csmRepairPasswordEncrypted） */
  passwordEncrypted?: string;
  webPort?: string;
};

function isCsmResponseOk(raw: CsmPagedResponse | null | undefined): boolean {
  if (!raw) return false;
  if (raw.success === true) return true;
  if (raw.errCode === 0) return true;
  return false;
}

function extractPageItems(raw: CsmPagedResponse): unknown[] {
  if (Array.isArray(raw?.data)) return raw.data;
  return [];
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
  const token = String((resp as any)?.data ?? '').trim();
  return token || null;
}

async function csmPostJson<T extends CsmPagedResponse>(
  config: CsmConfig,
  path: string,
  body: Record<string, unknown>,
  auth?: CsmRepairAuthOptions,
): Promise<T> {
  const tryOnce = async (extraHeaders?: Record<string, string>) => {
    return (await csmRequest(config, path, {}, 'POST', body, {
      extraHeaders,
    })) as T;
  };

  let raw = await tryOnce();
  if (isCsmResponseOk(raw)) return raw;

  const token = await obtainCsmToken(config, auth);
  if (token) {
    raw = await tryOnce({ token });
    if (isCsmResponseOk(raw)) return raw;
  }

  const msg = String(raw?.message || `CSM 请求失败: ${path}`);
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
