import { logger } from '../../../utils/logger';

const log = logger.child('DifyAdminSession');

const SESSION_TTL_MS = 50 * 60 * 1000;

type SessionEntry = {
  cookieHeader: string;
  at: number;
};

const sessions = new Map<string, SessionEntry>();

function parseSetCookieHeaders(res: Response): string[] {
  const anyHeaders = res.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof anyHeaders.getSetCookie === 'function') {
    return anyHeaders.getSetCookie();
  }
  const raw = res.headers.get('set-cookie');
  if (!raw) return [];
  return raw.split(/,(?=\s*[^;,]+=)/);
}

function toCookieHeader(setCookies: string[]): string {
  return setCookies
    .map((line) => line.split(';')[0]?.trim())
    .filter(Boolean)
    .join('; ');
}

export function getDifyAdminCookieHeader(poolId: string): string | undefined {
  const entry = sessions.get(poolId);
  if (!entry) return undefined;
  if (Date.now() - entry.at > SESSION_TTL_MS) {
    sessions.delete(poolId);
    return undefined;
  }
  return entry.cookieHeader;
}

export function clearDifyAdminSession(poolId: string): void {
  sessions.delete(poolId);
}

export function getDifyAdminEmailHint(): string | undefined {
  const email = process.env.EDGE_DIFY_ADMIN_EMAIL?.trim();
  return email || undefined;
}

export function isDifyAdminLoginConfigured(): boolean {
  return Boolean(
    process.env.EDGE_DIFY_ADMIN_EMAIL?.trim() && process.env.EDGE_DIFY_ADMIN_PASSWORD?.trim(),
  );
}

/** 服务端代登 Dify 控制台，Cookie 由 embed 反代注入（不依赖浏览器跨站 Cookie） */
export async function loginDifyAdminSession(
  poolId: string,
  upstreamOrigin: string,
): Promise<{ ok: boolean; message?: string }> {
  const email = process.env.EDGE_DIFY_ADMIN_EMAIL?.trim();
  const password = process.env.EDGE_DIFY_ADMIN_PASSWORD?.trim();
  if (!email || !password) {
    return {
      ok: false,
      message: '未配置 EDGE_DIFY_ADMIN_EMAIL / EDGE_DIFY_ADMIN_PASSWORD（backend/.env）',
    };
  }

  try {
    const res = await fetch(`${upstreamOrigin}/console/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, remember_me: true }),
    });

    const setCookies = parseSetCookieHeaders(res);
    const cookieHeader = toCookieHeader(setCookies);

    let body: { result?: string; message?: string; data?: string } = {};
    try {
      body = (await res.json()) as typeof body;
    } catch {
      /* non-json */
    }

    if (!res.ok) {
      const msg = body.message || body.data || res.statusText;
      log.warn('dify admin login http error', { poolId, status: res.status, msg });
      return { ok: false, message: `Dify 登录失败：${msg || res.status}` };
    }

    if (body.result === 'fail') {
      return { ok: false, message: body.message || body.data || 'Dify 登录被拒绝' };
    }

    if (!cookieHeader) {
      return { ok: false, message: 'Dify 未返回登录 Cookie，请检查账号或控制台地址' };
    }

    sessions.set(poolId, { cookieHeader, at: Date.now() });
    log.info('dify admin session established', { poolId, email });
    return { ok: true };
  } catch (error: unknown) {
    log.error('dify admin login failed', error instanceof Error ? error.message : String(error));
    return { ok: false, message: error instanceof Error ? error.message : '连接 Dify 失败' };
  }
}
