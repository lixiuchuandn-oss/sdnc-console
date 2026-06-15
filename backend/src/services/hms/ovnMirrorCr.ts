/**
 * OvnMirror CR（hms.rivercloud.com/v1 OvnMirror，CRD: ovnmirrors.hms.rivercloud.com）。
 * 集群级（Cluster scope）；经 Rancher/Harvester 代理多路径探测列表。
 */
import {
  getJsonOnce,
  requestJson,
  resolveHarvesterCloudKubeToken,
} from '../clouds/harvester/utils';

export const OVN_MIRROR_API_GROUP = 'hms.rivercloud.com';
export const OVN_MIRROR_API_VERSION = 'v1';
export const OVN_MIRROR_KIND = 'OvnMirror';
export const OVN_MIRROR_PLURAL = 'ovnmirrors';

export type OvnMirrorDirect = 'inbound' | 'outbound' | 'all';
export type OvnMirrorProtocol = 'udp' | 'tcp' | 'all';

export type OvnMirrorEndpointInput = {
  vmName: string;
  namespace: string;
  networkNad: string;
};

export type OvnMirrorRuleInput = {
  networkNad: string;
  /** string；空字符串表示 any（不限） */
  targetIp: string;
  endpoints: OvnMirrorEndpointInput[];
  port?: number;
  direct?: OvnMirrorDirect;
  protocol?: OvnMirrorProtocol;
  targetPort?: number;
};

export type OvnMirrorCrSpecInput = {
  vmName: string;
  namespace: string;
  rules: OvnMirrorRuleInput[];
};

export type OvnMirrorCrBody = {
  name: string;
  spec: OvnMirrorCrSpecInput;
};

export type ListOvnMirrorCrsResult = {
  items: any[];
  apiAvailable: boolean;
  listSourceUrl?: string;
  error?: string;
};

function isOvnMirrorLike(o: unknown): boolean {
  if (!o || typeof o !== 'object') return false;
  const row = o as { kind?: string; spec?: { vmName?: unknown; rules?: unknown } };
  const kind = String(row.kind || '').toLowerCase();
  if (kind === 'ovnmirror') return true;
  return row.spec?.vmName != null || Array.isArray(row.spec?.rules);
}

function parseOvnMirrorListPayload(data: unknown): { items: any[]; valid: boolean } {
  if (!data || typeof data !== 'object') return { items: [], valid: false };
  const body = data as { kind?: string; items?: unknown[]; data?: unknown[] };

  if (Array.isArray(body.items)) {
    const kind = String(body.kind || '');
    if (kind && kind !== 'OvnMirrorList' && kind !== 'List') {
      return { items: [], valid: false };
    }
    return { items: body.items, valid: true };
  }

  if (Array.isArray(body.data)) {
    if (body.data.length === 0) return { items: [], valid: true };
    const items = body.data.filter(isOvnMirrorLike);
    return items.length > 0 ? { items, valid: true } : { items: [], valid: false };
  }

  return { items: [], valid: false };
}

async function resolveRancherClusterIds(cloud: {
  endpoint?: string;
  secretKey?: string | null;
  config?: any;
}): Promise<string[]> {
  const config = cloud.config || {};
  const fromConfig = String(config.clusterId || config.rancherClusterId || '').trim();
  const ids = new Set<string>();
  if (fromConfig) ids.add(fromConfig);

  const endpoint = String(cloud.endpoint || '')
    .trim()
    .replace(/\/+$/, '');
  let origin = endpoint;
  try {
    const u = new URL(endpoint);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = endpoint.replace(/\/v[0-9].*$/, '');
  }

  const v3Root = /\/v\d+$/.test(endpoint) ? endpoint : `${origin}/v3`;
  const token = resolveHarvesterCloudKubeToken(cloud);
  const insecure = !!config.ignoreTls;

  try {
    const clusters = await getJsonOnce(`${v3Root}/clusters`, token, insecure, true);
    const cItems = Array.isArray((clusters as any)?.data)
      ? (clusters as any).data
      : Array.isArray((clusters as any)?.items)
        ? (clusters as any).items
        : [];
    const local = cItems.find((c: any) => String(c?.id || c?.Id || '').toLowerCase() === 'local');
    const pick = local || cItems[0];
    const cid = String(pick?.id || pick?.Id || '').trim();
    if (cid) ids.add(cid);
  } catch {
    // ignore
  }

  ids.add('local');
  return Array.from(ids);
}

async function buildHarvesterKubeProxyRoots(cloud: {
  endpoint?: string;
  config?: any;
}): Promise<string[]> {
  const endpoint = String(cloud.endpoint || '')
    .trim()
    .replace(/\/+$/, '');
  if (!endpoint) return [];

  const roots = new Set<string>();
  roots.add(endpoint);

  let origin = endpoint;
  try {
    const u = new URL(endpoint);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = endpoint.replace(/\/v[0-9].*$/, '');
  }
  roots.add(origin);

  const stripped = endpoint.replace(/\/v[0-9]+(\/harvester)?$/, '');
  const v3Root = /\/v\d+$/.test(endpoint) ? endpoint : `${origin}/v3`;
  roots.add(v3Root);
  roots.add(stripped);

  if (endpoint.includes('/k8s/clusters/')) {
    return Array.from(roots);
  }

  const clusterIds = await resolveRancherClusterIds(cloud);
  for (const cid of clusterIds) {
    for (const base of [origin, stripped, v3Root]) {
      roots.add(`${base.replace(/\/+$/, '')}/k8s/clusters/${encodeURIComponent(cid)}`);
    }
  }

  return Array.from(roots);
}

async function requestFirstOk<T>(
  urls: string[],
  fn: (url: string) => Promise<T>,
): Promise<T> {
  let lastErr: any = null;
  for (const url of urls) {
    try {
      return await fn(url);
    } catch (e: any) {
      lastErr = e;
      if (e?.status === 404) continue;
      if (e?.status === 403) continue;
    }
  }
  if (lastErr) throw lastErr;
  throw new Error('OvnMirror CR API 不可用');
}

async function buildKubeApiUrls(
  cloud: { endpoint?: string; config?: any },
  pathSuffix: string,
): Promise<string[]> {
  const roots = await buildHarvesterKubeProxyRoots(cloud);
  const seg = pathSuffix.startsWith('/') ? pathSuffix : `/${pathSuffix}`;
  return roots.map((root) => `${root.replace(/\/+$/, '')}${seg}`);
}

export function ovnMirrorCrCollectionPath(): string {
  return `/apis/${OVN_MIRROR_API_GROUP}/${OVN_MIRROR_API_VERSION}/${OVN_MIRROR_PLURAL}`;
}

export function ovnMirrorCrItemPath(name: string): string {
  return `${ovnMirrorCrCollectionPath()}/${encodeURIComponent(String(name || '').trim())}`;
}

function clampPort(v: unknown, fallback = 0): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(65535, Math.max(0, Math.floor(n)));
}

function uint32ToIpv4(n: number): string {
  const u = n >>> 0;
  return [(u >>> 24) & 255, (u >>> 16) & 255, (u >>> 8) & 255, u & 255].join('.');
}

function normalizeTargetIp(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v <= 0) return '';
    return uint32ToIpv4(v);
  }
  const s = String(v).trim();
  if (!s || s === '0') return '';
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    if (n <= 0) return '';
    return uint32ToIpv4(n);
  }
  return s;
}

function normalizeDirect(v: unknown): OvnMirrorDirect {
  const s = String(v || 'all').trim() as OvnMirrorDirect;
  return s === 'inbound' || s === 'outbound' ? s : 'all';
}

function normalizeProtocol(v: unknown): OvnMirrorProtocol {
  const s = String(v || 'all').trim() as OvnMirrorProtocol;
  return s === 'tcp' || s === 'udp' ? s : 'all';
}

function normalizeEndpoint(raw: unknown): OvnMirrorEndpointInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const vmName = String(o.vmName || '').trim();
  const namespace = String(o.namespace || '').trim();
  const networkNad = String(o.networkNad || '').trim();
  if (!vmName || !namespace || !networkNad) return null;
  return { vmName, namespace, networkNad };
}

function normalizeRule(raw: unknown): OvnMirrorRuleInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const networkNad = String(o.networkNad || '').trim();
  const endpointsRaw = Array.isArray(o.endpoints) ? o.endpoints : [];
  const endpoints = endpointsRaw
    .map(normalizeEndpoint)
    .filter((x): x is OvnMirrorEndpointInput => x != null);
  if (!networkNad || endpoints.length === 0) return null;
  return {
    networkNad,
    targetIp: normalizeTargetIp(o.targetIp),
    endpoints,
    port: clampPort(o.port, 0),
    direct: normalizeDirect(o.direct),
    protocol: normalizeProtocol(o.protocol),
    targetPort: clampPort(o.targetPort, 0),
  };
}

export function normalizeOvnMirrorSpecInput(raw: unknown): OvnMirrorCrSpecInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw Object.assign(new Error('spec 无效'), { status: 400 });
  }
  const o = raw as Record<string, unknown>;
  const vmName = String(o.vmName || '').trim();
  const namespace = String(o.namespace || '').trim();
  if (!vmName || !namespace) {
    throw Object.assign(new Error('spec.vmName 与 spec.namespace 不能为空'), { status: 400 });
  }
  const rulesRaw = Array.isArray(o.rules) ? o.rules : [];
  const rules = rulesRaw.map(normalizeRule).filter((x): x is OvnMirrorRuleInput => x != null);
  if (rules.length === 0) {
    throw Object.assign(new Error('至少配置一条有效镜像规则'), { status: 400 });
  }
  return { vmName, namespace, rules };
}

export function buildOvnMirrorCrManifest(name: string, specInput: OvnMirrorCrSpecInput) {
  const nameTrim = String(name || '').trim();
  if (!nameTrim) {
    throw Object.assign(new Error('缺少 OvnMirror 名称'), { status: 400 });
  }
  const spec = normalizeOvnMirrorSpecInput(specInput);
  return {
    apiVersion: `${OVN_MIRROR_API_GROUP}/${OVN_MIRROR_API_VERSION}`,
    kind: OVN_MIRROR_KIND,
    metadata: { name: nameTrim },
    spec,
  };
}

async function buildCandidateUrls(cloud: { endpoint?: string; config?: any }): Promise<string[]> {
  const urls = new Set<string>();
  const roots = await buildHarvesterKubeProxyRoots(cloud);
  const seg = ovnMirrorCrCollectionPath();

  for (const root of roots) {
    urls.add(`${root.replace(/\/+$/, '')}${seg}`);
  }

  for (const root of [roots[0], ...roots].slice(0, 3)) {
    if (!root) continue;
    let steveHost = root;
    try {
      const u = new URL(root);
      steveHost = `${u.protocol}//${u.host}`;
    } catch {
      steveHost = root.replace(/\/v[0-9].*$/, '');
    }
    urls.add(`${steveHost.replace(/\/+$/, '')}/v1/${OVN_MIRROR_API_GROUP}.${OVN_MIRROR_PLURAL}`);
  }

  return Array.from(urls);
}

export async function listOvnMirrorCrs(cloud: {
  endpoint?: string;
  secretKey?: string | null;
  config?: any;
}): Promise<ListOvnMirrorCrsResult> {
  const token = resolveHarvesterCloudKubeToken(cloud);
  const insecure = !!cloud.config?.ignoreTls;
  const urls = await buildCandidateUrls(cloud);

  let lastErr: any = null;
  for (const url of urls) {
    try {
      const data = await getJsonOnce(url, token, insecure, true);
      const parsed = parseOvnMirrorListPayload(data);
      if (!parsed.valid) continue;
      return {
        items: parsed.items,
        apiAvailable: true,
        listSourceUrl: url,
      };
    } catch (e: any) {
      lastErr = e;
      if (e?.status === 404) continue;
      if (e?.status === 403) continue;
    }
  }

  if (lastErr?.status === 404) {
    return {
      items: [],
      apiAvailable: false,
      error: lastErr?.message || 'OvnMirror CR API 不可用（全部候选 URL 404）',
    };
  }

  if (lastErr) {
    return {
      items: [],
      apiAvailable: false,
      error: lastErr?.message || String(lastErr),
    };
  }

  return {
    items: [],
    apiAvailable: false,
    error: 'OvnMirror CR API 不可用（无可用列表 URL）',
  };
}

export async function getOvnMirrorCr(
  cloud: { endpoint?: string; secretKey?: string | null; config?: any },
  name: string,
): Promise<any> {
  const token = resolveHarvesterCloudKubeToken(cloud);
  const insecure = !!cloud.config?.ignoreTls;
  const urls = await buildKubeApiUrls(cloud, ovnMirrorCrItemPath(name));

  return requestFirstOk(urls, (url) => getJsonOnce(url, token, insecure, true));
}

export async function createOvnMirrorCr(
  cloud: { endpoint?: string; secretKey?: string | null; config?: any },
  body: OvnMirrorCrBody,
): Promise<any> {
  const token = resolveHarvesterCloudKubeToken(cloud);
  const insecure = !!cloud.config?.ignoreTls;
  const manifest = buildOvnMirrorCrManifest(body.name, body.spec);
  const urls = await buildKubeApiUrls(cloud, ovnMirrorCrCollectionPath());

  return requestFirstOk(urls, (url) => requestJson('POST', url, token, insecure, manifest));
}

export async function updateOvnMirrorCr(
  cloud: { endpoint?: string; secretKey?: string | null; config?: any },
  name: string,
  body: { spec: OvnMirrorCrSpecInput },
): Promise<any> {
  const token = resolveHarvesterCloudKubeToken(cloud);
  const insecure = !!cloud.config?.ignoreTls;
  const nameTrim = String(name || '').trim();
  const urls = await buildKubeApiUrls(cloud, ovnMirrorCrItemPath(nameTrim));

  const existing = await requestFirstOk(urls, (url) => getJsonOnce(url, token, insecure, true));
  const built = buildOvnMirrorCrManifest(nameTrim, body.spec);
  const manifest = {
    ...existing,
    ...built,
    metadata: {
      ...(existing?.metadata || {}),
      name: nameTrim,
    },
    spec: built.spec,
  };

  return requestFirstOk(urls, (url) => requestJson('PUT', url, token, insecure, manifest));
}

export async function deleteOvnMirrorCr(
  cloud: { endpoint?: string; secretKey?: string | null; config?: any },
  name: string,
): Promise<void> {
  const token = resolveHarvesterCloudKubeToken(cloud);
  const insecure = !!cloud.config?.ignoreTls;
  const urls = await buildKubeApiUrls(cloud, ovnMirrorCrItemPath(name));

  await requestFirstOk(urls, (url) =>
    requestJson('DELETE', url, token, insecure).then(() => undefined),
  );
}
