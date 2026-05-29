import axios from 'axios';
import crypto from 'crypto';
import https from 'https';
import type { Cloud } from '../../../entities/Cloud';

export type MaasHttpContext = {
  baseUrl: string;
  consumerKey: string;
  token: string;
  secret: string;
  insecure: boolean;
};

export type MaasHttpResult = {
  ok: boolean;
  status: number;
  data?: unknown;
  message?: string;
};

export type MaasMachineOp =
  | 'commission'
  | 'deploy'
  | 'release'
  | 'power_on'
  | 'power_off'
  | 'power_cycle'
  | 'mark_broken'
  | 'mark_fixed'
  | 'abort';

/** endpoint 须以 `/MAAS` 结尾；仅去掉末尾 `/`，不自动补全路径 */
export function normalizeMaasEndpoint(raw: string): string | null {
  const s = String(raw || '').trim().replace(/\/+$/, '');
  if (!s) return null;
  if (!/\/MAAS$/i.test(s)) return null;
  if (!/^https?:\/\//i.test(s)) {
    return `http://${s}`.replace(/\/+$/, '');
  }
  return s;
}

export function validateMaasApiKey(raw: string): {
  consumerKey: string;
  token: string;
  secret: string;
} | null {
  const trimmed = String(raw || '').trim();
  const colonCount = (trimmed.match(/:/g) || []).length;
  if (colonCount !== 2) return null;
  const parts = trimmed.split(':');
  if (parts.length !== 3) return null;
  const [consumerKey, token, secret] = parts.map((p) => p.trim());
  if (!consumerKey || !token || !secret) return null;
  return { consumerKey, token, secret };
}

/** OAuth 1.0 PLAINTEXT：client_secret 为空时签名为 `&` + encodeURIComponent(token_secret) */
function buildOAuthPlaintextHeader(ctx: MaasHttpContext): string {
  const nonce = crypto.randomBytes(16).toString('hex');
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = `&${encodeURIComponent(ctx.secret)}`;
  const params = [
    ['oauth_version', '1.0'],
    ['oauth_signature_method', 'PLAINTEXT'],
    ['oauth_nonce', nonce],
    ['oauth_timestamp', timestamp],
    ['oauth_consumer_key', ctx.consumerKey],
    ['oauth_token', ctx.token],
    ['oauth_signature', signature],
  ]
    .map(([k, v]) => `${k}="${encodeURIComponent(v)}"`)
    .join(', ');
  return `OAuth ${params}`;
}

function httpsAgent(ctx: MaasHttpContext, url: string) {
  if (!url.startsWith('https:')) return undefined;
  return new https.Agent({ keepAlive: true, rejectUnauthorized: !ctx.insecure });
}

export function buildMaasContext(input: {
  endpoint: string;
  apiKey: string;
  ignoreTls?: boolean;
}): MaasHttpContext | null {
  const baseUrl = normalizeMaasEndpoint(input.endpoint);
  const parsed = validateMaasApiKey(input.apiKey);
  if (!baseUrl || !parsed) return null;
  return {
    baseUrl,
    ...parsed,
    insecure: !!input.ignoreTls,
  };
}

export function getMaasContext(cloud: Cloud): MaasHttpContext | null {
  const provider = String(cloud.config?.provider || '').toLowerCase();
  if (provider !== 'maas') return null;
  const cfg = (cloud.config || {}) as Record<string, unknown>;
  const endpoint = String(cloud.endpoint || cfg.endpoint || '').trim();
  const apiKey = String(cfg.apiKey || '').trim();
  if (!apiKey) return null;
  return buildMaasContext({
    endpoint,
    apiKey,
    ignoreTls: !!cfg.ignoreTls,
  });
}

export function extractMaasList(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>;
    for (const key of ['items', 'results', 'data']) {
      if (Array.isArray(o[key])) return o[key] as Record<string, unknown>[];
    }
  }
  return [];
}

export async function maasRequest(
  ctx: MaasHttpContext,
  method: 'GET' | 'POST' | 'DELETE',
  fullPath: string,
  opts?: { timeout?: number; body?: Record<string, string> },
): Promise<MaasHttpResult> {
  const url = `${ctx.baseUrl}${fullPath.startsWith('/') ? fullPath : `/${fullPath}`}`;
  const agent = httpsAgent(ctx, url);
  try {
    const res = await axios.request({
      method,
      url,
      headers: {
        Authorization: buildOAuthPlaintextHeader(ctx),
        ...(method === 'POST'
          ? { 'Content-Type': 'application/x-www-form-urlencoded' }
          : {}),
      },
      ...(method === 'POST' && opts?.body
        ? { data: new URLSearchParams(opts.body).toString() }
        : {}),
      ...(agent ? { httpsAgent: agent } : {}),
      timeout: opts?.timeout ?? 25_000,
      validateStatus: () => true,
    });
    if (res.status >= 200 && res.status < 300) {
      return { ok: true, status: res.status, data: res.data };
    }
    const msg =
      (res.data as { message?: string })?.message ||
      (typeof res.data === 'string' ? res.data : '') ||
      `HTTP ${res.status}`;
    return { ok: false, status: res.status, message: msg };
  } catch (err: unknown) {
    const e = err as { message?: string };
    return { ok: false, status: 0, message: e?.message || 'MAAS 请求失败' };
  }
}

export async function maasGetV2(
  ctx: MaasHttpContext,
  path: string,
  opts?: { timeout?: number },
): Promise<MaasHttpResult> {
  const apiPath = path.startsWith('/api/2.0')
    ? path
    : `/api/2.0${path.startsWith('/') ? path : `/${path}`}`;
  return maasRequest(ctx, 'GET', apiPath, opts);
}

async function maasGetV3(
  ctx: MaasHttpContext,
  path: string,
  query?: string,
  opts?: { timeout?: number },
): Promise<MaasHttpResult> {
  const base = path.startsWith('/a/v3') ? path : `/a/v3${path.startsWith('/') ? path : `/${path}`}`;
  const apiPath = query ? `${base}${query.startsWith('?') ? query : `?${query}`}` : base;
  return maasRequest(ctx, 'GET', apiPath, opts);
}

async function maasGetV3OrV2(
  ctx: MaasHttpContext,
  v3Path: string,
  v2Path: string,
  opts?: { timeout?: number },
): Promise<MaasHttpResult> {
  const v3 = await maasGetV3(ctx, v3Path, '', opts);
  if (v3.ok) return v3;
  return maasGetV2(ctx, v2Path, opts);
}

/** 连通性：仅 GET {endpoint}/api/2.0/machines/ */
export async function testMaasConnection(input: {
  endpoint?: string;
  apiKey?: string;
  ignoreTls?: boolean;
  config?: Record<string, unknown>;
}): Promise<{ ok: boolean; message: string; data?: { machineCount?: number } }> {
  const endpoint = String(input.endpoint || input.config?.endpoint || '').trim();
  const apiKey = String(input.apiKey || input.config?.apiKey || '').trim();
  const ignoreTls = input.ignoreTls ?? !!input.config?.ignoreTls;

  const baseUrl = normalizeMaasEndpoint(endpoint);
  if (!baseUrl) {
    return {
      ok: false,
      message: 'MAAS endpoint 必须以 /MAAS 结尾，例如 http://10.0.0.1:5240/MAAS',
    };
  }
  if (!validateMaasApiKey(apiKey)) {
    return {
      ok: false,
      message: 'MAAS apiKey 格式必须为 consumer_key:token:secret（恰好两个冒号、三段非空）',
    };
  }

  const ctx = buildMaasContext({ endpoint: baseUrl, apiKey, ignoreTls });
  if (!ctx) {
    return { ok: false, message: 'MAAS 配置无效' };
  }

  const res = await maasGetV2(ctx, '/machines/', { timeout: 20_000 });
  if (res.status === 401) {
    return { ok: false, message: '认证失败：MAAS API Key 无效或已过期' };
  }
  if (!res.ok) {
    return { ok: false, message: res.message || 'MAAS 连接失败' };
  }
  const items = extractMaasList(res.data);
  return {
    ok: true,
    message: '连接成功',
    data: { machineCount: items.length },
  };
}

export async function listMaasMachines(ctx: MaasHttpContext): Promise<{
  ok: boolean;
  items: Record<string, unknown>[];
  message?: string;
}> {
  const res = await maasGetV2(ctx, '/machines/', { timeout: 30_000 });
  if (res.status === 401) {
    return { ok: false, items: [], message: '认证失败：MAAS API Key 无效或已过期' };
  }
  if (!res.ok) {
    return { ok: false, items: [], message: res.message || '拉取机器列表失败' };
  }
  return { ok: true, items: extractMaasList(res.data) };
}

export async function getMaasMachine(
  ctx: MaasHttpContext,
  systemId: string,
): Promise<{ ok: boolean; machine?: Record<string, unknown>; message?: string }> {
  const sid = encodeURIComponent(systemId);
  const res = await maasGetV2(ctx, `/machines/${sid}/`, { timeout: 20_000 });
  if (!res.ok) {
    return { ok: false, message: res.message || '拉取机器详情失败' };
  }
  const data = res.data;
  const machine = Array.isArray(data)
    ? (data[0] as Record<string, unknown>)
    : (data as Record<string, unknown>);
  return { ok: true, machine };
}

export async function getMaasMachineHardware(
  ctx: MaasHttpContext,
  systemId: string,
): Promise<{
  ok: boolean;
  blockdevices: Record<string, unknown>[];
  interfaces: Record<string, unknown>[];
  message?: string;
}> {
  const sid = encodeURIComponent(systemId);
  const [bd, iface] = await Promise.all([
    maasGetV2(ctx, `/nodes/${sid}/blockdevices/`, { timeout: 20_000 }),
    maasGetV2(ctx, `/nodes/${sid}/interfaces/`, { timeout: 20_000 }),
  ]);
  if (!bd.ok && !iface.ok) {
    return {
      ok: false,
      blockdevices: [],
      interfaces: [],
      message: bd.message || iface.message || '拉取硬件信息失败',
    };
  }
  return {
    ok: true,
    blockdevices: bd.ok ? extractMaasList(bd.data) : [],
    interfaces: iface.ok ? extractMaasList(iface.data) : [],
  };
}

export async function listMaasDiscoveries(ctx: MaasHttpContext): Promise<{
  ok: boolean;
  items: Record<string, unknown>[];
  message?: string;
  apiVersion?: string;
}> {
  const v3 = await maasGetV3(ctx, '/discoveries', '', { timeout: 25_000 });
  if (v3.ok) {
    return { ok: true, items: extractMaasList(v3.data), apiVersion: 'v3' };
  }
  const v2 = await maasGetV2(ctx, '/discovery/', { timeout: 25_000 });
  if (v2.ok) {
    return { ok: true, items: extractMaasList(v2.data), apiVersion: 'v2' };
  }
  return { ok: false, items: [], message: v3.message || v2.message || '拉取网络发现失败' };
}

export async function listMaasEvents(
  ctx: MaasHttpContext,
  limit = 50,
): Promise<{
  ok: boolean;
  items: Record<string, unknown>[];
  message?: string;
}> {
  const v3 = await maasGetV3(ctx, '/events', `limit=${limit}`, { timeout: 25_000 });
  if (v3.ok) {
    return { ok: true, items: extractMaasList(v3.data) };
  }
  const v2 = await maasGetV2(ctx, `/events/?limit=${limit}`, { timeout: 25_000 });
  if (v2.ok) {
    return { ok: true, items: extractMaasList(v2.data) };
  }
  return { ok: false, items: [], message: v3.message || v2.message || '拉取事件失败' };
}

export async function listMaasBootResources(ctx: MaasHttpContext): Promise<{
  ok: boolean;
  items: Record<string, unknown>[];
  message?: string;
}> {
  const res = await maasGetV3OrV2(ctx, '/boot-resources', '/boot-resources/', {
    timeout: 30_000,
  });
  if (!res.ok) {
    return { ok: false, items: [], message: res.message || '拉取镜像失败' };
  }
  return { ok: true, items: extractMaasList(res.data) };
}

export async function listMaasSubnets(ctx: MaasHttpContext): Promise<{
  ok: boolean;
  subnets: Record<string, unknown>[];
  vlans: Record<string, unknown>[];
  message?: string;
}> {
  const [subRes, vlanRes] = await Promise.all([
    maasGetV3OrV2(ctx, '/subnets', '/subnets/', { timeout: 25_000 }),
    maasGetV2(ctx, '/vlans/', { timeout: 25_000 }),
  ]);
  if (!subRes.ok && !vlanRes.ok) {
    return {
      ok: false,
      subnets: [],
      vlans: [],
      message: subRes.message || vlanRes.message || '拉取网络资源失败',
    };
  }
  return {
    ok: true,
    subnets: subRes.ok ? extractMaasList(subRes.data) : [],
    vlans: vlanRes.ok ? extractMaasList(vlanRes.data) : [],
  };
}

function machineStatusCode(m: Record<string, unknown>): number | null {
  const s = m.status;
  if (typeof s === 'number') return s;
  if (typeof s === 'string' && /^\d+$/.test(s)) return Number(s);
  return null;
}

export async function listMaasRackControllersV2(ctx: MaasHttpContext): Promise<{
  ok: boolean;
  items: Record<string, unknown>[];
  message?: string;
}> {
  const res = await maasGetV2(ctx, '/rackcontrollers/', { timeout: 20_000 });
  if (!res.ok) {
    return { ok: false, items: [], message: res.message || '拉取 Rack 控制器失败' };
  }
  return { ok: true, items: extractMaasList(res.data) };
}

export async function listMaasRegionControllersV2(ctx: MaasHttpContext): Promise<{
  ok: boolean;
  items: Record<string, unknown>[];
  message?: string;
}> {
  const res = await maasGetV2(ctx, '/regioncontrollers/', { timeout: 20_000 });
  if (!res.ok) {
    return { ok: false, items: [], message: res.message || '拉取 Region 控制器失败' };
  }
  return { ok: true, items: extractMaasList(res.data) };
}

export type MaasControllerView = {
  system_id: string;
  hostname: string;
  status: string;
  online: boolean;
  ip: string;
  version: string;
};

function maasControllerIp(row: Record<string, unknown>): string {
  const addrs = row.ip_addresses;
  if (Array.isArray(addrs) && addrs.length > 0) {
    const first = addrs[0];
    if (first && typeof first === 'object') {
      const ip = (first as Record<string, unknown>).ip;
      if (ip != null && String(ip).trim()) return String(ip).trim();
    }
    if (typeof first === 'string' && first.trim()) return first.trim();
  }
  const cur = row.current_commissioning_ip ?? row.ip;
  return cur != null && String(cur).trim() ? String(cur).trim() : '—';
}

/** §14.6：`service_set` 全部 running 为在线 */
export function isMaasControllerOnline(row: Record<string, unknown>): boolean {
  const sets = row.service_set;
  if (Array.isArray(sets) && sets.length > 0) {
    return sets.every((s) => {
      if (!s || typeof s !== 'object') return false;
      return String((s as Record<string, unknown>).status).toLowerCase() === 'running';
    });
  }
  const name = String(row.status_name ?? row.status ?? '').toLowerCase();
  if (name.includes('online')) return true;
  if (name.includes('offline') || name.includes('down')) return false;
  return row.connected === true || row.connection_status === 'connected';
}

export function normalizeMaasControllerView(row: Record<string, unknown>): MaasControllerView {
  const hostname = String(row.hostname ?? row.fqdn ?? row.name ?? '—');
  const systemId = String(row.system_id ?? row.id ?? hostname);
  const status = String(row.status_name ?? row.status ?? '—');
  return {
    system_id: systemId,
    hostname,
    status,
    online: isMaasControllerOnline(row),
    ip: maasControllerIp(row),
    version: String(row.version ?? '—'),
  };
}

export async function getMaasVersion(ctx: MaasHttpContext): Promise<{
  ok: boolean;
  version?: string;
  message?: string;
}> {
  const res = await maasGetV2(ctx, '/version/', { timeout: 15_000 });
  if (!res.ok) {
    return { ok: false, message: res.message || '拉取 MAAS 版本失败' };
  }
  const data = res.data;
  if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>;
    const v = String(o.version ?? o.capabilities ?? '').trim();
    if (v) return { ok: true, version: v };
  }
  if (typeof data === 'string' && data.trim()) {
    return { ok: true, version: data.trim() };
  }
  return { ok: true, version: undefined };
}

export async function getMaasRegionStatus(ctx: MaasHttpContext): Promise<{
  ok: boolean;
  message?: string;
  version?: string;
  machineCount: number;
  regionControllers: MaasControllerView[];
  rackControllers: MaasControllerView[];
  partialErrors: string[];
}> {
  const [versionRes, regions, racks, machines] = await Promise.all([
    getMaasVersion(ctx),
    listMaasRegionControllersV2(ctx),
    listMaasRackControllersV2(ctx),
    listMaasMachines(ctx),
  ]);

  const partialErrors: string[] = [];
  if (!versionRes.ok && versionRes.message) partialErrors.push(versionRes.message);
  if (!regions.ok && regions.message) partialErrors.push(regions.message);
  if (!racks.ok && racks.message) partialErrors.push(racks.message);

  if (!machines.ok) {
    return {
      ok: false,
      message: machines.message || '无法连接 MAAS Region',
      machineCount: 0,
      regionControllers: [],
      rackControllers: [],
      partialErrors,
    };
  }

  return {
    ok: true,
    version: versionRes.version,
    machineCount: machines.items.length,
    regionControllers: (regions.ok ? regions.items : []).map(normalizeMaasControllerView),
    rackControllers: (racks.ok ? racks.items : []).map(normalizeMaasControllerView),
    partialErrors,
    message: partialErrors.length ? '部分 Region 信息不可用' : undefined,
  };
}

export async function maasMachineOperation(
  ctx: MaasHttpContext,
  systemId: string,
  op: MaasMachineOp,
  form?: Record<string, string>,
): Promise<{ ok: boolean; message: string; data?: unknown }> {
  const sid = encodeURIComponent(systemId);
  const path = `/api/2.0/machines/${sid}/?op=${encodeURIComponent(op)}`;
  const res = await maasRequest(ctx, 'POST', path, { body: form || {}, timeout: 60_000 });
  if (res.status === 401) {
    return { ok: false, message: '认证失败：MAAS API Key 无效或已过期' };
  }
  if (res.status === 409) {
    return { ok: false, message: res.message || '当前状态不允许该操作' };
  }
  if (!res.ok) {
    return { ok: false, message: res.message || `操作 ${op} 失败` };
  }
  return {
    ok: true,
    message: '操作已提交',
    data: res.data,
  };
}

export async function maasDeleteMachine(
  ctx: MaasHttpContext,
  systemId: string,
): Promise<{ ok: boolean; message: string }> {
  const sid = encodeURIComponent(systemId);
  const res = await maasRequest(ctx, 'DELETE', `/api/2.0/machines/${sid}/`, { timeout: 60_000 });
  if (res.status === 401) {
    return { ok: false, message: '认证失败：MAAS API Key 无效或已过期' };
  }
  if (res.status === 409) {
    return { ok: false, message: res.message || '当前状态不允许删除该机器' };
  }
  if (!res.ok) {
    return { ok: false, message: res.message || '删除机器失败' };
  }
  return { ok: true, message: '机器已删除' };
}
