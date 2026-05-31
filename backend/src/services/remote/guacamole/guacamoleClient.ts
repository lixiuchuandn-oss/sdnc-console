import axios, { AxiosError } from 'axios';
import { decryptSecret } from '../../../utils/secretCipher';
import type { GuacamoleInstance } from '../../../entities/GuacamoleInstance';

export type GuacamoleTokenCache = {
  token: string;
  expiresAt: number;
};

const tokenCache = new Map<string, GuacamoleTokenCache>();

function normalizeBaseUrl(raw: string): string {
  let url = String(raw || '')
    .trim()
    .replace(/\/+$/, '');
  if (!url) throw new Error('缺少云桌面网关地址');
  if (!/^https?:\/\//i.test(url)) {
    url = `http://${url}`;
  }
  if (!/\/guacamole$/i.test(url)) {
    url = `${url}/guacamole`;
  }
  return url.replace(/\/+$/, '');
}

export function getGuacamoleApiBase(instance: GuacamoleInstance): string {
  return `${normalizeBaseUrl(instance.baseUrl)}/api`;
}

export async function fetchGuacamoleToken(
  instance: GuacamoleInstance,
  forceRefresh = false,
): Promise<string> {
  const password = decryptSecret(instance.passwordEncrypted);
  return fetchGuacamoleTokenForCredentials(instance, instance.username, password, forceRefresh);
}

export async function fetchGuacamoleTokenForCredentials(
  instance: GuacamoleInstance,
  username: string,
  password: string,
  forceRefresh = false,
): Promise<string> {
  const cacheKey = `${instance.id}:${username}`;
  const cached = tokenCache.get(cacheKey);
  if (!cached?.token || forceRefresh || cached.expiresAt <= Date.now()) {
    const apiBase = getGuacamoleApiBase(instance);
    const body = new URLSearchParams({
      username,
      password,
    });
    const res = await axios.post(`${apiBase}/tokens`, body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15000,
      validateStatus: () => true,
    });
    if (res.status !== 200 || !res.data?.authToken) {
      throw new Error(res.data?.message || res.data?.error || `云桌面网关认证失败 (${res.status})`);
    }
    tokenCache.set(cacheKey, {
      token: String(res.data.authToken),
      expiresAt: Date.now() + 55 * 60 * 1000,
    });
  }
  return tokenCache.get(cacheKey)!.token;
}

export async function guacamoleRequest<T = unknown>(
  instance: GuacamoleInstance,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  data?: unknown,
): Promise<T> {
  const apiBase = getGuacamoleApiBase(instance);
  const ds = instance.dataSource || 'postgresql';
  const url = path.startsWith('http')
    ? path
    : `${apiBase}${path.startsWith('/') ? path : `/${path}`}`.replace('{ds}', ds);

  let token = await fetchGuacamoleToken(instance);
  const doRequest = async (authToken: string) =>
    axios.request({
      method,
      url,
      data,
      headers: {
        'Guacamole-Token': authToken,
        'Content-Type': 'application/json',
      },
      timeout: 20000,
      validateStatus: () => true,
    });

  let res = await doRequest(token);
  if (res.status === 401) {
    token = await fetchGuacamoleToken(instance, true);
    res = await doRequest(token);
  }
  if (res.status >= 400) {
    const msg =
      (res.data as any)?.message ||
      (res.data as any)?.error ||
      `云桌面网关 API ${method} ${path} failed (${res.status})`;
    throw new Error(msg);
  }
  return res.data as T;
}

export async function testGuacamoleInstance(instance: GuacamoleInstance): Promise<{
  ok: boolean;
  message: string;
}> {
  try {
    await fetchGuacamoleToken(instance, true);
    const ds = instance.dataSource || 'postgresql';
    await guacamoleRequest(instance, 'GET', `/session/data/${ds}/connections`);
    return { ok: true, message: '连接成功' };
  } catch (e: unknown) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : '连接失败',
    };
  }
}

export function buildClientUrl(
  instance: GuacamoleInstance,
  connectionId: string,
  userToken?: string,
): string {
  const base = normalizeBaseUrl(instance.baseUrl);
  const ds = instance.dataSource || 'postgresql';
  const raw = `${connectionId}\0c\0${ds}`;
  const ident = Buffer.from(raw, 'utf8').toString('base64');
  const url = `${base}/#/client/${ident}`;
  if (userToken) {
    return `${url}?token=${encodeURIComponent(userToken)}`;
  }
  return url;
}

export function normalizeGuacamoleBaseInput(raw: string): string {
  return normalizeBaseUrl(raw);
}

export function isAxiosLikeError(e: unknown): boolean {
  return e instanceof AxiosError || (typeof e === 'object' && e !== null && 'isAxiosError' in e);
}
