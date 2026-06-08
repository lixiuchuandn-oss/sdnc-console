/**
 * DeploySet CR（hms.rivercloud.com/v1 DeploySet，CRD: deploysets.hms.rivercloud.com）。
 * 集群级（Cluster scope）；经 Rancher/Harvester 代理多路径探测列表。
 */
import {
  getJsonOnce,
  requestJson,
  resolveHarvesterCloudKubeToken,
} from '../clouds/harvester/utils';

export const DEPLOY_SET_API_GROUP = 'hms.rivercloud.com';
export const DEPLOY_SET_API_VERSION = 'v1';
export const DEPLOY_SET_KIND = 'DeploySet';
export const DEPLOY_SET_PLURAL = 'deploysets';

export type DeploySetCrPlacementPolicy = 'None' | 'Affinity' | 'AntiAffinity';
export type DeploySetCrPlacementStrength = 'Preferred' | 'Required';

export type DeploySetCrSpecInput = {
  description?: string;
  projectNamespace?: string;
  sortOrder?: number;
  podTemplateLabels?: Record<string, string>;
  placement: {
    policy: DeploySetCrPlacementPolicy;
    strength?: DeploySetCrPlacementStrength;
    topologyKey?: string;
  };
};

export type DeploySetCrBody = {
  name: string;
  spec: DeploySetCrSpecInput;
};

export type ListDeploySetCrsResult = {
  items: any[];
  apiAvailable: boolean;
  listSourceUrl?: string;
  error?: string;
};

function isDeploySetLike(o: unknown): boolean {
  if (!o || typeof o !== 'object') return false;
  const row = o as { kind?: string; spec?: { placement?: unknown } };
  const kind = String(row.kind || '').toLowerCase();
  if (kind === 'deployset') return true;
  return row.spec?.placement != null;
}

function parseDeploySetListPayload(data: unknown): { items: any[]; valid: boolean } {
  if (!data || typeof data !== 'object') return { items: [], valid: false };
  const body = data as { kind?: string; items?: unknown[]; data?: unknown[] };

  if (Array.isArray(body.items)) {
    const kind = String(body.kind || '');
    if (kind && kind !== 'DeploySetList' && kind !== 'List') {
      return { items: [], valid: false };
    }
    return { items: body.items, valid: true };
  }

  if (Array.isArray(body.data)) {
    if (body.data.length === 0) return { items: [], valid: true };
    const items = body.data.filter(isDeploySetLike);
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
  throw new Error('DeploySet CR API 不可用');
}

async function buildKubeApiUrls(
  cloud: { endpoint?: string; config?: any },
  pathSuffix: string,
): Promise<string[]> {
  const roots = await buildHarvesterKubeProxyRoots(cloud);
  const seg = pathSuffix.startsWith('/') ? pathSuffix : `/${pathSuffix}`;
  return roots.map((root) => `${root.replace(/\/+$/, '')}${seg}`);
}

export function deploySetCrCollectionPath(): string {
  return `/apis/${DEPLOY_SET_API_GROUP}/${DEPLOY_SET_API_VERSION}/${DEPLOY_SET_PLURAL}`;
}

export function deploySetCrItemPath(name: string): string {
  return `${deploySetCrCollectionPath()}/${encodeURIComponent(String(name || '').trim())}`;
}

export function buildDeploySetCrManifest(name: string, specInput: DeploySetCrSpecInput) {
  const nameTrim = String(name || '').trim();
  if (!nameTrim) {
    throw Object.assign(new Error('缺少 DeploySet 名称'), { status: 400 });
  }

  const policy = String(specInput.placement?.policy || 'None') as DeploySetCrPlacementPolicy;
  if (!['None', 'Affinity', 'AntiAffinity'].includes(policy)) {
    throw Object.assign(new Error('placement.policy 无效'), { status: 400 });
  }

  const placement: Record<string, string> = { policy };
  if (policy !== 'None') {
    const strength = String(specInput.placement?.strength || '') as DeploySetCrPlacementStrength;
    const topologyKey = String(specInput.placement?.topologyKey || '').trim();
    if (!['Preferred', 'Required'].includes(strength)) {
      throw Object.assign(new Error('placement.strength 须为 Preferred 或 Required'), { status: 400 });
    }
    if (!topologyKey) {
      throw Object.assign(new Error('placement.topologyKey 不能为空'), { status: 400 });
    }
    placement.strength = strength;
    placement.topologyKey = topologyKey;
  }

  const spec: Record<string, unknown> = {
    placement,
  };

  const description = String(specInput.description || '').trim();
  if (description) spec.description = description;

  const projectNamespace = String(specInput.projectNamespace || '').trim();
  if (projectNamespace) spec.projectNamespace = projectNamespace;

  if (specInput.sortOrder != null && Number.isFinite(Number(specInput.sortOrder))) {
    spec.sortOrder = Math.max(0, Math.floor(Number(specInput.sortOrder)));
  }

  const podTemplateLabels = specInput.podTemplateLabels;
  if (podTemplateLabels && Object.keys(podTemplateLabels).length > 0) {
    spec.podTemplateLabels = podTemplateLabels;
  }

  return {
    apiVersion: `${DEPLOY_SET_API_GROUP}/${DEPLOY_SET_API_VERSION}`,
    kind: DEPLOY_SET_KIND,
    metadata: { name: nameTrim },
    spec,
  };
}

async function buildCandidateUrls(cloud: { endpoint?: string; config?: any }): Promise<string[]> {
  const urls = new Set<string>();
  const roots = await buildHarvesterKubeProxyRoots(cloud);
  const seg = deploySetCrCollectionPath();

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
    urls.add(`${steveHost.replace(/\/+$/, '')}/v1/${DEPLOY_SET_API_GROUP}.${DEPLOY_SET_PLURAL}`);
  }

  return Array.from(urls);
}

export async function listDeploySetCrs(cloud: {
  endpoint?: string;
  secretKey?: string | null;
  config?: any;
}): Promise<ListDeploySetCrsResult> {
  const token = resolveHarvesterCloudKubeToken(cloud);
  const insecure = !!cloud.config?.ignoreTls;
  const urls = await buildCandidateUrls(cloud);

  let lastErr: any = null;
  for (const url of urls) {
    try {
      const data = await getJsonOnce(url, token, insecure, true);
      const parsed = parseDeploySetListPayload(data);
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
      error: lastErr?.message || 'DeploySet CR API 不可用（全部候选 URL 404）',
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
    error: 'DeploySet CR API 不可用（无可用列表 URL）',
  };
}

export async function getDeploySetCr(
  cloud: { endpoint?: string; secretKey?: string | null; config?: any },
  name: string,
): Promise<any> {
  const token = resolveHarvesterCloudKubeToken(cloud);
  const insecure = !!cloud.config?.ignoreTls;
  const urls = await buildKubeApiUrls(cloud, deploySetCrItemPath(name));

  return requestFirstOk(urls, (url) => getJsonOnce(url, token, insecure, true));
}

export async function createDeploySetCr(
  cloud: { endpoint?: string; secretKey?: string | null; config?: any },
  body: DeploySetCrBody,
): Promise<any> {
  const token = resolveHarvesterCloudKubeToken(cloud);
  const insecure = !!cloud.config?.ignoreTls;
  const manifest = buildDeploySetCrManifest(body.name, body.spec);
  const urls = await buildKubeApiUrls(cloud, deploySetCrCollectionPath());

  return requestFirstOk(urls, (url) => requestJson('POST', url, token, insecure, manifest));
}

export async function updateDeploySetCr(
  cloud: { endpoint?: string; secretKey?: string | null; config?: any },
  name: string,
  body: { spec: DeploySetCrSpecInput },
): Promise<any> {
  const token = resolveHarvesterCloudKubeToken(cloud);
  const insecure = !!cloud.config?.ignoreTls;
  const nameTrim = String(name || '').trim();
  const urls = await buildKubeApiUrls(cloud, deploySetCrItemPath(nameTrim));

  const existing = await requestFirstOk(urls, (url) => getJsonOnce(url, token, insecure, true));
  const built = buildDeploySetCrManifest(nameTrim, body.spec);
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

export async function deleteDeploySetCr(
  cloud: { endpoint?: string; secretKey?: string | null; config?: any },
  name: string,
): Promise<void> {
  const token = resolveHarvesterCloudKubeToken(cloud);
  const insecure = !!cloud.config?.ignoreTls;
  const urls = await buildKubeApiUrls(cloud, deploySetCrItemPath(name));

  await requestFirstOk(urls, (url) =>
    requestJson('DELETE', url, token, insecure).then(() => undefined),
  );
}
