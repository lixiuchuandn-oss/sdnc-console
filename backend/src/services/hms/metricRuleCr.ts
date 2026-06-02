/**
 * DRS · MetricRule CR（hms.rivercloud.com/v1 MetricRule，CRD: metricrules.hms.rivercloud.com）。
 * 集群级（Cluster scope）；经 Rancher/Harvester 代理多路径探测列表。
 */
import {
  getJsonOnce,
  requestJson,
  resolveHarvesterCloudKubeToken,
} from '../clouds/harvester/utils';

/** 现网 CRD 组（与 kubectl get crd metricrules.hms.rivercloud.com 一致） */
export const METRIC_RULE_API_GROUP = 'hms.rivercloud.com';
/** 历史/兼容组 */
export const METRIC_RULE_LEGACY_API_GROUP = 'hci.manager.system';
export const METRIC_RULE_API_VERSION = 'v1';
export const METRIC_RULE_KIND = 'MetricRule';
export const METRIC_RULE_PLURAL = 'metricrules';

const METRIC_RULE_API_GROUPS = [METRIC_RULE_API_GROUP, METRIC_RULE_LEGACY_API_GROUP] as const;

export function metricRuleCrCollectionPath(apiGroup = METRIC_RULE_API_GROUP): string {
  return `/apis/${apiGroup}/${METRIC_RULE_API_VERSION}/${METRIC_RULE_PLURAL}`;
}

export function metricRuleCrItemPath(name: string, apiGroup = METRIC_RULE_API_GROUP): string {
  return `${metricRuleCrCollectionPath(apiGroup)}/${encodeURIComponent(String(name || '').trim())}`;
}

export type MetricRuleCrSpecInput = {
  metricType?: 'cpu' | 'memory' | string;
  metricSafeThreshold?: number;
  migrateConcurrentNum?: number;
  migrateMaxCount?: number;
  randTopN?: number;
};

export type MetricRuleCrBody = {
  name: string;
  spec: MetricRuleCrSpecInput;
};

export type ListMetricRuleCrsResult = {
  items: any[];
  apiAvailable: boolean;
  /** 成功解析列表时命中的 URL（便于与 kubectl 对照） */
  listSourceUrl?: string;
  error?: string;
};

function isMetricRuleLike(o: unknown): boolean {
  if (!o || typeof o !== 'object') return false;
  const row = o as { kind?: string; spec?: { metricType?: unknown } };
  const kind = String(row.kind || '').toLowerCase();
  if (kind === 'metricrule') return true;
  return row.spec?.metricType != null;
}

/** 仅当响应形态像 K8s/Steve 列表时才采纳，避免 200 错页被当成空列表 */
function parseMetricRuleListPayload(data: unknown): { items: any[]; valid: boolean } {
  if (!data || typeof data !== 'object') return { items: [], valid: false };
  const body = data as { kind?: string; items?: unknown[]; data?: unknown[] };

  if (Array.isArray(body.items)) {
    const kind = String(body.kind || '');
    if (kind && kind !== 'MetricRuleList' && kind !== 'List') {
      return { items: [], valid: false };
    }
    return { items: body.items, valid: true };
  }

  if (Array.isArray(body.data)) {
    if (body.data.length === 0) {
      return { items: [], valid: true };
    }
    const items = body.data.filter(isMetricRuleLike);
    if (items.length > 0) {
      return { items, valid: true };
    }
    return { items: [], valid: false };
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

  const endpoint = String(cloud.endpoint || '').trim().replace(/\/+$/, '');
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
    // 无 Rancher 列表权限时仍尝试 local
  }

  ids.add('local');
  return Array.from(ids);
}

/** 构建访问 K8s API 的代理根（含 Rancher /v3/k8s/clusters/{id}） */
async function buildHarvesterKubeProxyRoots(cloud: {
  endpoint?: string;
  config?: any;
}): Promise<string[]> {
  const endpoint = String(cloud.endpoint || '').trim().replace(/\/+$/, '');
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
  token: string,
  insecure: boolean,
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
  throw new Error('MetricRule CR API 不可用');
}

async function buildKubeApiUrls(cloud: { endpoint?: string; config?: any }, pathSuffix: string): Promise<string[]> {
  const roots = await buildHarvesterKubeProxyRoots(cloud);
  const seg = pathSuffix.startsWith('/') ? pathSuffix : `/${pathSuffix}`;
  return roots.map((root) => `${root.replace(/\/+$/, '')}${seg}`);
}

export function buildMetricRuleCrManifest(name: string, specInput: MetricRuleCrSpecInput) {
  const nameTrim = String(name || '').trim();
  if (!nameTrim) {
    throw Object.assign(new Error('缺少 MetricRule 名称'), { status: 400 });
  }
  const metricType = String(specInput.metricType || '').trim().toLowerCase();
  if (metricType !== 'cpu' && metricType !== 'memory') {
    throw Object.assign(new Error('metricType 须为 cpu 或 memory'), { status: 400 });
  }
  const threshold = Number(specInput.metricSafeThreshold);
  if (Number.isNaN(threshold) || threshold < 0 || threshold > 100) {
    throw Object.assign(new Error('metricSafeThreshold 须在 0–100 之间'), { status: 400 });
  }
  const migrateConcurrentNum = Number(specInput.migrateConcurrentNum ?? 1);
  const migrateMaxCount = Number(specInput.migrateMaxCount ?? 1);
  const randTopN = Number(specInput.randTopN ?? 1);
  if ([migrateConcurrentNum, migrateMaxCount, randTopN].some((n) => !Number.isFinite(n) || n < 1)) {
    throw Object.assign(new Error('migrateConcurrentNum / migrateMaxCount / randTopN 须为大于 0 的整数'), {
      status: 400,
    });
  }

  return {
    apiVersion: `${METRIC_RULE_API_GROUP}/${METRIC_RULE_API_VERSION}`,
    kind: METRIC_RULE_KIND,
    metadata: { name: nameTrim },
    spec: {
      metricType,
      metricSafeThreshold: threshold,
      migrateConcurrentNum: Math.floor(migrateConcurrentNum),
      migrateMaxCount: Math.floor(migrateMaxCount),
      randTopN: Math.floor(randTopN),
    },
  };
}

async function buildCandidateUrls(cloud: {
  endpoint?: string;
  config?: any;
}): Promise<string[]> {
  const urls = new Set<string>();
  const roots = await buildHarvesterKubeProxyRoots(cloud);

  for (const group of METRIC_RULE_API_GROUPS) {
    const seg = metricRuleCrCollectionPath(group);
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
      urls.add(`${steveHost.replace(/\/+$/, '')}/v1/${group}.${METRIC_RULE_PLURAL}`);
    }
  }

  return Array.from(urls);
}

export async function listMetricRuleCrs(cloud: {
  endpoint?: string;
  secretKey?: string | null;
  config?: any;
}): Promise<ListMetricRuleCrsResult> {
  const token = resolveHarvesterCloudKubeToken(cloud);
  const insecure = !!cloud.config?.ignoreTls;
  const urls = await buildCandidateUrls(cloud);

  let lastErr: any = null;
  for (const url of urls) {
    try {
      const data = await getJsonOnce(url, token, insecure, true);
      const parsed = parseMetricRuleListPayload(data);
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
      error: lastErr?.message || 'MetricRule CR API 不可用（全部候选 URL 404）',
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
    error: 'MetricRule CR API 不可用（无可用列表 URL）',
  };
}

export async function getMetricRuleCr(
  cloud: { endpoint?: string; secretKey?: string | null; config?: any },
  name: string,
): Promise<any> {
  const token = resolveHarvesterCloudKubeToken(cloud);
  const insecure = !!cloud.config?.ignoreTls;
  const urls = await buildKubeApiUrls(cloud, metricRuleCrItemPath(name));

  return requestFirstOk(urls, token, insecure, (url) => getJsonOnce(url, token, insecure, true));
}

export async function createMetricRuleCr(
  cloud: { endpoint?: string; secretKey?: string | null; config?: any },
  body: MetricRuleCrBody,
): Promise<any> {
  const token = resolveHarvesterCloudKubeToken(cloud);
  const insecure = !!cloud.config?.ignoreTls;
  const manifest = buildMetricRuleCrManifest(body.name, body.spec);
  const urls = await buildKubeApiUrls(cloud, metricRuleCrCollectionPath());

  return requestFirstOk(urls, token, insecure, (url) =>
    requestJson('POST', url, token, insecure, manifest),
  );
}

export async function updateMetricRuleCr(
  cloud: { endpoint?: string; secretKey?: string | null; config?: any },
  name: string,
  body: { spec: MetricRuleCrSpecInput },
): Promise<any> {
  const token = resolveHarvesterCloudKubeToken(cloud);
  const insecure = !!cloud.config?.ignoreTls;
  const nameTrim = String(name || '').trim();
  const urls = await buildKubeApiUrls(cloud, metricRuleCrItemPath(nameTrim));

  const existing = await requestFirstOk(urls, token, insecure, (url) =>
    getJsonOnce(url, token, insecure, true),
  );

  const manifest = {
    ...existing,
    ...buildMetricRuleCrManifest(nameTrim, {
      ...(existing?.spec || {}),
      ...body.spec,
    }),
    metadata: {
      ...(existing?.metadata || {}),
      name: nameTrim,
    },
  };

  return requestFirstOk(urls, token, insecure, (url) =>
    requestJson('PUT', url, token, insecure, manifest),
  );
}

export async function deleteMetricRuleCr(
  cloud: { endpoint?: string; secretKey?: string | null; config?: any },
  name: string,
): Promise<void> {
  const token = resolveHarvesterCloudKubeToken(cloud);
  const insecure = !!cloud.config?.ignoreTls;
  const urls = await buildKubeApiUrls(cloud, metricRuleCrItemPath(name));

  await requestFirstOk(urls, token, insecure, (url) =>
    requestJson('DELETE', url, token, insecure).then(() => undefined),
  );
}
