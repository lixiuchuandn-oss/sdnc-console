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

/** CPU / 内存安全阈值下限（%） */
export const METRIC_SAFE_THRESHOLD_MIN = 50;
export const METRIC_SCORE_SUM = 10;
/** 关闭调度条件时的默认安全阈值 / 占用比例 */
export const METRIC_DISABLED_SAFE_THRESHOLD = 500;
export const METRIC_DISABLED_SCORE = 0;
/** 集群级 MetricRule 仅允许一条 */
export const METRIC_RULE_MAX_COUNT = 1;

const METRIC_RULE_API_GROUPS = [METRIC_RULE_API_GROUP, METRIC_RULE_LEGACY_API_GROUP] as const;

export function metricRuleCrCollectionPath(apiGroup = METRIC_RULE_API_GROUP): string {
  return `/apis/${apiGroup}/${METRIC_RULE_API_VERSION}/${METRIC_RULE_PLURAL}`;
}

export function metricRuleCrItemPath(name: string, apiGroup = METRIC_RULE_API_GROUP): string {
  return `${metricRuleCrCollectionPath(apiGroup)}/${encodeURIComponent(String(name || '').trim())}`;
}

export type MetricRuleCrSpecInput = {
  cpuSafeThreshold?: number;
  cpuScore?: number;
  memorySafeThreshold?: number;
  memoryScore?: number;
  migrateConcurrentNum?: number;
  migrateMaxCount?: number;
  randTopN?: number;
  maxMigratePeriod?: number;
  /** 旧版字段，仅读取兼容 */
  metricType?: 'cpu' | 'memory' | string;
  metricSafeThreshold?: number;
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
  const row = o as {
    kind?: string;
    spec?: {
      metricType?: unknown;
      cpuSafeThreshold?: unknown;
      memorySafeThreshold?: unknown;
    };
  };
  const kind = String(row.kind || '').toLowerCase();
  if (kind === 'metricrule') return true;
  const spec = row.spec || {};
  return (
    spec.metricType != null ||
    spec.cpuSafeThreshold != null ||
    spec.memorySafeThreshold != null
  );
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

async function buildKubeApiUrls(
  cloud: { endpoint?: string; config?: any },
  pathSuffix: string,
): Promise<string[]> {
  const roots = await buildHarvesterKubeProxyRoots(cloud);
  const seg = pathSuffix.startsWith('/') ? pathSuffix : `/${pathSuffix}`;
  return roots.map((root) => `${root.replace(/\/+$/, '')}${seg}`);
}

function isCpuEnabled(specInput: MetricRuleCrSpecInput): boolean {
  return Number(specInput.cpuScore) > METRIC_DISABLED_SCORE;
}

function isMemoryEnabled(specInput: MetricRuleCrSpecInput): boolean {
  return Number(specInput.memoryScore) > METRIC_DISABLED_SCORE;
}

function validateSafeThreshold(label: string, value: number): string | undefined {
  if (Number.isNaN(value)) return `${label} 无效`;
  if (value < METRIC_SAFE_THRESHOLD_MIN || value > 100) {
    return `${label} 须在 ${METRIC_SAFE_THRESHOLD_MIN}–100 之间`;
  }
  return undefined;
}

function validateDisabledMetric(
  label: string,
  threshold: number,
  score: number,
): string | undefined {
  if (threshold !== METRIC_DISABLED_SAFE_THRESHOLD) {
    return `关闭 ${label} 时安全阈值须为 ${METRIC_DISABLED_SAFE_THRESHOLD}`;
  }
  if (score !== METRIC_DISABLED_SCORE) {
    return `关闭 ${label} 时占用比例须为 ${METRIC_DISABLED_SCORE}`;
  }
  return undefined;
}

function validateScores(
  cpuEnabled: boolean,
  memoryEnabled: boolean,
  cpuScore: number,
  memoryScore: number,
): string | undefined {
  if (cpuEnabled && !memoryEnabled) {
    if (cpuScore !== METRIC_SCORE_SUM) {
      return `仅配置 CPU 时 cpuScore 须为 ${METRIC_SCORE_SUM}`;
    }
    if (memoryScore !== METRIC_DISABLED_SCORE) {
      return `关闭内存时 memoryScore 须为 ${METRIC_DISABLED_SCORE}`;
    }
    return undefined;
  }
  if (!cpuEnabled && memoryEnabled) {
    if (memoryScore !== METRIC_SCORE_SUM) {
      return `仅配置内存时 memoryScore 须为 ${METRIC_SCORE_SUM}`;
    }
    if (cpuScore !== METRIC_DISABLED_SCORE) {
      return `关闭 CPU 时 cpuScore 须为 ${METRIC_DISABLED_SCORE}`;
    }
    return undefined;
  }
  if (cpuEnabled && memoryEnabled) {
    if (Number.isNaN(cpuScore) || Number.isNaN(memoryScore)) {
      return 'cpuScore / memoryScore 无效';
    }
    if (cpuScore + memoryScore !== METRIC_SCORE_SUM) {
      return `cpuScore 与 memoryScore 之和须为 ${METRIC_SCORE_SUM}`;
    }
    if (cpuScore < 1 || memoryScore < 1) {
      return '占用比例须大于 0';
    }
  }
  return undefined;
}

export function buildMetricRuleCrManifest(name: string, specInput: MetricRuleCrSpecInput) {
  const nameTrim = String(name || '').trim();
  if (!nameTrim) {
    throw Object.assign(new Error('缺少 MetricRule 名称'), { status: 400 });
  }

  const cpuScore = Number(specInput.cpuScore);
  const memoryScore = Number(specInput.memoryScore);
  const cpuEnabled = isCpuEnabled(specInput);
  const memoryEnabled = isMemoryEnabled(specInput);
  if (!cpuEnabled && !memoryEnabled) {
    throw Object.assign(
      new Error('请至少配置 CPU 或内存其中一种调度条件（两者为或关系）'),
      { status: 400 },
    );
  }

  const scoreErr = validateScores(cpuEnabled, memoryEnabled, cpuScore, memoryScore);
  if (scoreErr) {
    throw Object.assign(new Error(scoreErr), { status: 400 });
  }

  const cpuSafeThreshold = Number(specInput.cpuSafeThreshold);
  const memorySafeThreshold = Number(specInput.memorySafeThreshold);

  if (cpuEnabled) {
    const thresholdErr = validateSafeThreshold('cpuSafeThreshold', cpuSafeThreshold);
    if (thresholdErr) {
      throw Object.assign(new Error(thresholdErr), { status: 400 });
    }
  } else {
    const disabledErr = validateDisabledMetric('CPU', cpuSafeThreshold, cpuScore);
    if (disabledErr) {
      throw Object.assign(new Error(disabledErr), { status: 400 });
    }
  }

  if (memoryEnabled) {
    const thresholdErr = validateSafeThreshold('memorySafeThreshold', memorySafeThreshold);
    if (thresholdErr) {
      throw Object.assign(new Error(thresholdErr), { status: 400 });
    }
  } else {
    const disabledErr = validateDisabledMetric('内存', memorySafeThreshold, memoryScore);
    if (disabledErr) {
      throw Object.assign(new Error(disabledErr), { status: 400 });
    }
  }

  const spec: Record<string, number> = {
    cpuSafeThreshold: Math.floor(cpuSafeThreshold),
    cpuScore: Math.floor(cpuScore),
    memorySafeThreshold: Math.floor(memorySafeThreshold),
    memoryScore: Math.floor(memoryScore),
  };

  const migrateConcurrentNum = Number(specInput.migrateConcurrentNum ?? 1);
  const migrateMaxCount = Number(specInput.migrateMaxCount ?? 1);
  const randTopN = Number(specInput.randTopN ?? 1);
  const maxMigratePeriod = Number(specInput.maxMigratePeriod ?? 24);
  if ([migrateConcurrentNum, migrateMaxCount, randTopN, maxMigratePeriod].some((n) => !Number.isFinite(n) || n < 1)) {
    throw Object.assign(
      new Error(
        'migrateConcurrentNum / migrateMaxCount / randTopN / maxMigratePeriod 须为大于 0 的整数',
      ),
      { status: 400 },
    );
  }

  spec.migrateConcurrentNum = Math.floor(migrateConcurrentNum);
  spec.migrateMaxCount = Math.floor(migrateMaxCount);
  spec.randTopN = Math.floor(randTopN);
  spec.maxMigratePeriod = Math.floor(maxMigratePeriod);

  return {
    apiVersion: `${METRIC_RULE_API_GROUP}/${METRIC_RULE_API_VERSION}`,
    kind: METRIC_RULE_KIND,
    metadata: { name: nameTrim },
    spec,
  };
}

async function buildCandidateUrls(cloud: { endpoint?: string; config?: any }): Promise<string[]> {
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
  const existing = await listMetricRuleCrs(cloud);
  if (existing.apiAvailable && existing.items.length >= METRIC_RULE_MAX_COUNT) {
    throw Object.assign(
      new Error(`集群仅允许配置 ${METRIC_RULE_MAX_COUNT} 条调度规则，请先编辑或删除已有规则`),
      { status: 409 },
    );
  }

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

  const built = buildMetricRuleCrManifest(nameTrim, body.spec);
  const manifest = {
    ...existing,
    ...built,
    metadata: {
      ...(existing?.metadata || {}),
      name: nameTrim,
    },
    spec: built.spec,
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
