import axios from 'axios';
import https from 'https';
import type { Cloud } from '../../../entities/Cloud';

export type RancherHttpContext = {
  origin: string;
  token: string;
  insecure: boolean;
};

export function getRancherContext(cloud: Cloud): RancherHttpContext | null {
  const provider = String(cloud.config?.provider || '').toLowerCase();
  if (provider !== 'rancher') return null;
  let base = String(
    (cloud as any).endpoint || (cloud as any).config?.rancherUrl || '',
  )
    .trim()
    .replace(/\/+$/, '');
  if (base && !/^https?:\/\//i.test(base)) {
    base = `https://${base}`;
  }
  const token = String(
    cloud.secretKey ||
      (cloud as any).config?.apiToken ||
      (cloud as any).config?.token ||
      '',
  ).trim();
  const insecure = !!(cloud.config as any)?.ignoreTls;
  if (!base || !token) return null;
  let origin = base;
  try {
    origin = new URL(base).origin;
  } catch {
    /* keep base */
  }
  return { origin, token, insecure };
}

export async function rancherGet(
  ctx: RancherHttpContext,
  path: string,
  opts?: { timeout?: number },
): Promise<{ ok: boolean; status: number; data?: any; message?: string }> {
  const p = path.startsWith('/') ? path : `/${path}`;
  const url = `${ctx.origin}${p}`;
  const isHttps = url.startsWith('https:');
  const agent = isHttps
    ? new https.Agent({ keepAlive: true, rejectUnauthorized: !ctx.insecure })
    : undefined;
  try {
    const res = await axios.get(url, {
      headers: { Authorization: `Bearer ${ctx.token}` },
      ...(isHttps && agent ? { httpsAgent: agent } : {}),
      timeout: opts?.timeout ?? 30000,
      validateStatus: () => true,
    });
    if (res.status === 401) {
      return { ok: false, status: 401, message: 'Rancher 认证失败：令牌无效或已过期' };
    }
    if (res.status < 200 || res.status >= 300) {
      const msg =
        res.data?.message ||
        res.data?.error ||
        `Rancher 请求失败: HTTP ${res.status}`;
      return { ok: false, status: res.status, message: String(msg) };
    }
    return { ok: true, status: res.status, data: res.data };
  } catch (e: any) {
    return {
      ok: false,
      status: 0,
      message: e?.message || 'Rancher 请求异常',
    };
  }
}

export async function rancherPost(
  ctx: RancherHttpContext,
  path: string,
  data: unknown,
  opts?: { timeout?: number },
): Promise<{ ok: boolean; status: number; data?: any; message?: string }> {
  const p = path.startsWith('/') ? path : `/${path}`;
  const url = `${ctx.origin}${p}`;
  const isHttps = url.startsWith('https:');
  const agent = isHttps
    ? new https.Agent({ keepAlive: true, rejectUnauthorized: !ctx.insecure })
    : undefined;
  try {
    const res = await axios.post(url, data, {
      headers: {
        Authorization: `Bearer ${ctx.token}`,
        'Content-Type': 'application/json',
      },
      ...(isHttps && agent ? { httpsAgent: agent } : {}),
      timeout: opts?.timeout ?? 60000,
      validateStatus: () => true,
    });
    if (res.status === 401) {
      return { ok: false, status: 401, message: 'Rancher 认证失败：令牌无效或已过期' };
    }
    if (res.status < 200 || res.status >= 300) {
      const msg =
        res.data?.message ||
        res.data?.error ||
        res.data?.reason ||
        (typeof res.data === 'string' ? res.data : null) ||
        `Rancher 请求失败: HTTP ${res.status}`;
      return { ok: false, status: res.status, message: String(msg), data: res.data };
    }
    return { ok: true, status: res.status, data: res.data };
  } catch (e: any) {
    return {
      ok: false,
      status: 0,
      message: e?.message || 'Rancher 请求异常',
    };
  }
}

/** Norman / Steve 列表常见 data / items 解析 */
export function rancherListItems(body: any): any[] {
  if (Array.isArray(body?.data)) return body.data;
  if (Array.isArray(body?.items)) return body.items;
  return [];
}
