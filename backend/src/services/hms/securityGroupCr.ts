/**
 * SecurityGroup CR（hms.rivercloud.com/v1 SecurityGroup，CRD: securitygroups.hms.rivercloud.com）。
 * 集群级（Cluster scope）；经 Rancher/Harvester 代理多路径探测列表。
 * Tower BFF 读写须以该 CR 为权威数据源（底座 controller 可选负责 ACL 下发）。
 */
import {
  getJsonOnce,
  requestJson,
  resolveHarvesterCloudKubeToken,
} from '../clouds/harvester/utils';

export const SECURITY_GROUP_API_GROUP = 'hms.rivercloud.com';
export const SECURITY_GROUP_API_VERSION = 'v1';
export const SECURITY_GROUP_KIND = 'SecurityGroup';
export const SECURITY_GROUP_PLURAL = 'securitygroups';

export const SECURITY_GROUP_CLOUD_ID_LABEL = 'tower.io/cloud-id';
export const SECURITY_GROUP_MANAGED_BY_LABEL = 'tower.io/managed-by';

export type SecurityGroupCrRuleInput = {
  id?: string;
  priority: number;
  direction: string;
  action: string;
  match: string;
};

export type SecurityGroupCrMemberInput = {
  id?: string;
  vmNamespace: string;
  vmName: string;
};

export type SecurityGroupCrSpecInput = {
  id?: string;
  cloudId: string;
  name: string;
  description?: string;
  subnetName: string;
  rules?: SecurityGroupCrRuleInput[];
  members?: SecurityGroupCrMemberInput[];
};

export type SecurityGroupCrBody = {
  name: string;
  spec: SecurityGroupCrSpecInput;
  labels?: Record<string, string>;
};

export type ListSecurityGroupCrsResult = {
  items: any[];
  apiAvailable: boolean;
  listSourceUrl?: string;
  error?: string;
};

function isSecurityGroupLike(o: unknown): boolean {
  if (!o || typeof o !== 'object') return false;
  const row = o as { kind?: string; spec?: { cloudId?: unknown; subnetName?: unknown } };
  const kind = String(row.kind || '').toLowerCase();
  if (kind === 'securitygroup') return true;
  return row.spec?.cloudId != null || row.spec?.subnetName != null;
}

function parseSecurityGroupListPayload(data: unknown): { items: any[]; valid: boolean } {
  if (!data || typeof data !== 'object') return { items: [], valid: false };
  const body = data as { kind?: string; items?: unknown[]; data?: unknown[] };

  if (Array.isArray(body.items)) {
    const kind = String(body.kind || '');
    if (kind && kind !== 'SecurityGroupList' && kind !== 'List') {
      return { items: [], valid: false };
    }
    return { items: body.items, valid: true };
  }

  if (Array.isArray(body.data)) {
    if (body.data.length === 0) return { items: [], valid: true };
    const items = body.data.filter(isSecurityGroupLike);
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
  throw new Error('SecurityGroup CR API 不可用');
}

async function buildKubeApiUrls(
  cloud: { endpoint?: string; config?: any },
  pathSuffix: string,
): Promise<string[]> {
  const roots = await buildHarvesterKubeProxyRoots(cloud);
  const seg = pathSuffix.startsWith('/') ? pathSuffix : `/${pathSuffix}`;
  return roots.map((root) => `${root.replace(/\/+$/, '')}${seg}`);
}

export function securityGroupCrCollectionPath(): string {
  return `/apis/${SECURITY_GROUP_API_GROUP}/${SECURITY_GROUP_API_VERSION}/${SECURITY_GROUP_PLURAL}`;
}

export function securityGroupCrItemPath(name: string): string {
  return `${securityGroupCrCollectionPath()}/${encodeURIComponent(String(name || '').trim())}`;
}

export function buildSecurityGroupCrManifest(
  name: string,
  specInput: SecurityGroupCrSpecInput,
  labels?: Record<string, string>,
) {
  const nameTrim = String(name || '').trim();
  if (!nameTrim) {
    throw Object.assign(new Error('缺少 SecurityGroup 名称'), { status: 400 });
  }

  const cloudId = String(specInput.cloudId || '').trim();
  const sgName = String(specInput.name || '').trim();
  const subnetName = String(specInput.subnetName || '').trim();
  if (!cloudId) throw Object.assign(new Error('spec.cloudId 不能为空'), { status: 400 });
  if (!sgName) throw Object.assign(new Error('spec.name 不能为空'), { status: 400 });
  if (!subnetName) throw Object.assign(new Error('spec.subnetName 不能为空'), { status: 400 });

  const spec: Record<string, unknown> = {
    cloudId,
    name: sgName,
    subnetName,
  };

  const id = String(specInput.id || nameTrim).trim();
  if (id) spec.id = id;

  const description = String(specInput.description || '').trim();
  if (description) spec.description = description;

  if (Array.isArray(specInput.rules)) {
    spec.rules = specInput.rules.map((r) => ({
      ...(r.id ? { id: String(r.id) } : {}),
      priority: r.priority,
      direction: r.direction,
      action: r.action,
      match: r.match,
    }));
  }

  if (Array.isArray(specInput.members)) {
    spec.members = specInput.members.map((m) => ({
      ...(m.id ? { id: String(m.id) } : {}),
      vmNamespace: m.vmNamespace,
      vmName: m.vmName,
    }));
  }

  const metaLabels: Record<string, string> = {
    [SECURITY_GROUP_CLOUD_ID_LABEL]: cloudId,
    [SECURITY_GROUP_MANAGED_BY_LABEL]: 'tower',
    ...(labels || {}),
  };

  return {
    apiVersion: `${SECURITY_GROUP_API_GROUP}/${SECURITY_GROUP_API_VERSION}`,
    kind: SECURITY_GROUP_KIND,
    metadata: { name: nameTrim, labels: metaLabels },
    spec,
  };
}

async function buildCandidateUrls(cloud: { endpoint?: string; config?: any }): Promise<string[]> {
  const urls = new Set<string>();
  const roots = await buildHarvesterKubeProxyRoots(cloud);
  const seg = securityGroupCrCollectionPath();

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
    urls.add(
      `${steveHost.replace(/\/+$/, '')}/v1/${SECURITY_GROUP_API_GROUP}.${SECURITY_GROUP_PLURAL}`,
    );
  }

  return Array.from(urls);
}

export async function listSecurityGroupCrs(cloud: {
  endpoint?: string;
  secretKey?: string | null;
  config?: any;
}): Promise<ListSecurityGroupCrsResult> {
  const token = resolveHarvesterCloudKubeToken(cloud);
  const insecure = !!cloud.config?.ignoreTls;
  const urls = await buildCandidateUrls(cloud);

  let lastErr: any = null;
  for (const url of urls) {
    try {
      const data = await getJsonOnce(url, token, insecure, true);
      const parsed = parseSecurityGroupListPayload(data);
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
      error: lastErr?.message || 'SecurityGroup CR API 不可用（全部候选 URL 404）',
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
    error: 'SecurityGroup CR API 不可用（无可用列表 URL）',
  };
}

export async function getSecurityGroupCr(
  cloud: { endpoint?: string; secretKey?: string | null; config?: any },
  name: string,
): Promise<any> {
  const token = resolveHarvesterCloudKubeToken(cloud);
  const insecure = !!cloud.config?.ignoreTls;
  const urls = await buildKubeApiUrls(cloud, securityGroupCrItemPath(name));

  return requestFirstOk(urls, (url) => getJsonOnce(url, token, insecure, true));
}

export async function createSecurityGroupCr(
  cloud: { endpoint?: string; secretKey?: string | null; config?: any },
  body: SecurityGroupCrBody,
): Promise<any> {
  const token = resolveHarvesterCloudKubeToken(cloud);
  const insecure = !!cloud.config?.ignoreTls;
  const manifest = buildSecurityGroupCrManifest(body.name, body.spec, body.labels);
  const urls = await buildKubeApiUrls(cloud, securityGroupCrCollectionPath());

  return requestFirstOk(urls, (url) => requestJson('POST', url, token, insecure, manifest));
}

export async function updateSecurityGroupCr(
  cloud: { endpoint?: string; secretKey?: string | null; config?: any },
  name: string,
  body: { spec: SecurityGroupCrSpecInput; labels?: Record<string, string> },
): Promise<any> {
  const token = resolveHarvesterCloudKubeToken(cloud);
  const insecure = !!cloud.config?.ignoreTls;
  const nameTrim = String(name || '').trim();
  const urls = await buildKubeApiUrls(cloud, securityGroupCrItemPath(nameTrim));

  const existing = await requestFirstOk(urls, (url) => getJsonOnce(url, token, insecure, true));
  const built = buildSecurityGroupCrManifest(nameTrim, body.spec, body.labels);
  const manifest = {
    ...existing,
    ...built,
    metadata: {
      ...(existing?.metadata || {}),
      name: nameTrim,
      labels: {
        ...(existing?.metadata?.labels || {}),
        ...(built.metadata?.labels || {}),
      },
    },
    spec: built.spec,
  };

  return requestFirstOk(urls, (url) => requestJson('PUT', url, token, insecure, manifest));
}

export async function deleteSecurityGroupCr(
  cloud: { endpoint?: string; secretKey?: string | null; config?: any },
  name: string,
): Promise<void> {
  const token = resolveHarvesterCloudKubeToken(cloud);
  const insecure = !!cloud.config?.ignoreTls;
  const urls = await buildKubeApiUrls(cloud, securityGroupCrItemPath(name));

  await requestFirstOk(urls, (url) =>
    requestJson('DELETE', url, token, insecure).then(() => undefined),
  );
}

/** 按云实例 ID 过滤 SecurityGroup CR（spec.cloudId 或 label tower.io/cloud-id）。 */
export function filterSecurityGroupCrsByCloudId(items: any[], cloudId: string): any[] {
  const cid = String(cloudId || '').trim();
  if (!cid) return items;
  return items.filter((item) => {
    const specCloud = String(item?.spec?.cloudId || '').trim();
    const labelCloud = String(item?.metadata?.labels?.[SECURITY_GROUP_CLOUD_ID_LABEL] || '').trim();
    return specCloud === cid || labelCloud === cid;
  });
}
