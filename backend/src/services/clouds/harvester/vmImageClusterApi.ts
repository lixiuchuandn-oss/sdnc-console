/**
 * Harvester VirtualMachineImage 集群 API 路径与 virtualSize 读取。
 * 直连 Harvester 与 Rancher 代理（/k8s/clusters/{id}）共用。
 */
import { resolveHarvesterK8sApiBase } from '../../../routes/clouds/harvester/harvester.direct.helpers';
import { injectVmImageVirtualSize } from './qcow2VirtualSize';
import { getJsonOnce, requestJson, resolveHarvesterCloudKubeToken } from './utils';

export type HarvesterClusterApiRoots = {
  /** 带 /k8s/clusters/{id} 或直连 host 的 K8s API 根 */
  apiPrefix: string;
  /** 仅 protocol//host，用于 Steve /v1/harvester */
  hostRoot: string;
};

export function resolveHarvesterClusterApiRoots(
  endpoint: string,
  config?: { clusterId?: string },
): HarvesterClusterApiRoots {
  const base = resolveHarvesterK8sApiBase(endpoint).replace(/\/+$/, '');
  const hostRoot = (() => {
    try {
      const u = new URL(base.startsWith('http') ? base : `https://${base}`);
      return `${u.protocol}//${u.host}`;
    } catch {
      return base.replace(/\/v[0-9]+(\/harvester)?$/, '');
    }
  })();

  if (base.includes('/k8s/clusters/')) {
    return { apiPrefix: base, hostRoot };
  }

  const clusterId = String(config?.clusterId || '').trim();
  if (clusterId) {
    return {
      apiPrefix: `${hostRoot}/k8s/clusters/${encodeURIComponent(clusterId)}`,
      hostRoot,
    };
  }

  // 直连 Harvester：优先 /apis/...（与 kubectl 一致），不强行拼 /k8s/clusters/local
  return { apiPrefix: hostRoot, hostRoot };
}

export type HarvesterCloudEndpointLike = {
  endpoint?: string;
  secretKey?: string;
  config?: {
    clusterId?: string;
    endpoint?: string;
    ignoreTls?: boolean;
    apiToken?: string;
    token?: string;
  };
};

export function resolveHarvesterRancherOrigin(endpoint: string): string {
  const base = String(endpoint || '').replace(/\/+$/, '');
  try {
    const u = new URL(base.startsWith('http') ? base : `https://${base}`);
    return `${u.protocol}//${u.host}`;
  } catch {
    return base.replace(/\/v[0-9]+(\/harvester)?$/, '');
  }
}

/** Rancher 管理端（/v3）且尚未带 /k8s/clusters/{id} */
export function isLikelyRancherManagementEndpoint(endpoint: string): boolean {
  const e = String(endpoint || '').trim().replace(/\/+$/, '');
  if (!e) return false;
  if (e.includes('/k8s/clusters/')) return false;
  return /\/v\d+(\/harvester)?$/i.test(e) || e.includes('/v3');
}

/** config.clusterId 缺失时从 Rancher /v3/clusters 解析（与 peripherals/kubevirt 一致） */
export async function resolveRancherClusterIdForCloud(
  cloud: HarvesterCloudEndpointLike,
): Promise<string | null> {
  const cfgClusterId = String(cloud.config?.clusterId || '').trim();
  if (cfgClusterId) return cfgClusterId;

  const endpoint = String(cloud.endpoint || cloud.config?.endpoint || '').trim();
  if (!isLikelyRancherManagementEndpoint(endpoint)) return null;

  const origin = resolveHarvesterRancherOrigin(endpoint);
  const token = resolveHarvesterCloudKubeToken(cloud);
  const insecure = !!cloud.config?.ignoreTls;
  try {
    const json = await getJsonOnce(`${origin}/v3/clusters`, token, insecure, true);
    const items = Array.isArray(json?.data)
      ? json.data
      : Array.isArray(json?.items)
        ? json.items
        : [];
    const local = items.find(
      (c: { id?: string; Id?: string }) =>
        String(c?.id || c?.Id || '').toLowerCase() === 'local',
    );
    const any = local || items[0];
    return String(any?.id || any?.Id || '').trim() || null;
  } catch {
    return null;
  }
}

/** 异步补全 Rancher clusterId，避免 Steve / subresources 打到 host 根路径 404 */
export async function resolveHarvesterClusterApiRootsAsync(
  cloud: HarvesterCloudEndpointLike,
): Promise<HarvesterClusterApiRoots> {
  const endpoint = String(cloud.endpoint || cloud.config?.endpoint || '').trim();
  const syncRoots = resolveHarvesterClusterApiRoots(endpoint, cloud.config);
  if (syncRoots.apiPrefix !== syncRoots.hostRoot) return syncRoots;

  const clusterId = await resolveRancherClusterIdForCloud(cloud);
  if (!clusterId) return syncRoots;

  return {
    apiPrefix: `${syncRoots.hostRoot}/k8s/clusters/${encodeURIComponent(clusterId)}`,
    hostRoot: syncRoots.hostRoot,
  };
}

export function normalizeHarvesterVmImageRecord(raw: unknown): any {
  if (!raw || typeof raw !== 'object') return raw;
  const r = raw as Record<string, any>;
  if (r.metadata?.name || r.kind === 'VirtualMachineImage') return r;
  if (r.data && typeof r.data === 'object') return normalizeHarvesterVmImageRecord(r.data);
  return r;
}

/** 云盘实例导出为镜像时 Harvester 写入的 spec.sourceType */
export const VOLUME_EXPORTED_VM_IMAGE_SOURCE_TYPE = 'export-from-volume';

/** 云盘导出为镜像，与 URL 导入/本地上传区分 */
export function isVolumeExportedVmImage(record: unknown): boolean {
  if (!record || typeof record !== 'object') return false;
  const r = record as Record<string, unknown>;
  const spec =
    r.spec && typeof r.spec === 'object' && !Array.isArray(r.spec)
      ? (r.spec as Record<string, unknown>)
      : {};
  const sourceType = String(spec.sourceType || r.sourceType || '').trim().toLowerCase();
  return sourceType === VOLUME_EXPORTED_VM_IMAGE_SOURCE_TYPE;
}

/**
 * 将镜像实际文件体积写入底座 status.size（等价 kubectl patch vmimage merge status.size）。
 * 仅用于云盘导出镜像在 Tower 拉取完成后回写稀疏 qcow2 体积。
 */
export async function patchHarvesterVmImageStatusSize(
  cloud: HarvesterCloudEndpointLike,
  namespace: string,
  name: string,
  sizeBytes: number,
  insecure?: boolean,
): Promise<any | null> {
  const size = Math.max(0, Math.floor(Number(sizeBytes) || 0));
  if (!size) return null;

  const insecureFlag = insecure ?? !!(cloud.config as { ignoreTls?: boolean })?.ignoreTls;
  const token = resolveHarvesterCloudKubeToken(cloud);
  const roots = await resolveHarvesterClusterApiRootsAsync(cloud);
  const body = { status: { size } };
  const urls = buildHarvesterVmImageDetailUrls(roots, namespace, name);
  let lastErr: unknown = null;

  for (const url of urls) {
    try {
      const raw = await requestJson('PATCH', url, token, insecureFlag, body, {
        'Content-Type': 'application/merge-patch+json',
      });
      return normalizeHarvesterVmImageRecord(raw);
    } catch (e) {
      lastErr = e;
    }
  }

  if (lastErr) throw lastErr;
  return null;
}

/** 解析 K8s quantity / 数字字符串为字节数 */
export function parseKubernetesQuantityToBytes(raw: unknown): number | undefined {
  if (raw == null) return undefined;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw;
  const s = String(raw).trim();
  if (!s) return undefined;
  const plain = Number(s);
  if (Number.isFinite(plain) && plain > 0) return plain;

  const m = /^([\d.]+)\s*([KMGTPE]i?)?$/i.exec(s.replace(/\s+/g, ''));
  if (!m) return undefined;
  const amount = Number(m[1]);
  if (!Number.isFinite(amount) || amount <= 0) return undefined;
  const unit = (m[2] || '').toLowerCase();
  const binary: Record<string, number> = {
    '': 1,
    k: 1e3,
    ki: 1024,
    m: 1e6,
    mi: 1024 ** 2,
    g: 1e9,
    gi: 1024 ** 3,
    t: 1e12,
    ti: 1024 ** 4,
    p: 1e15,
    pi: 1024 ** 5,
    e: 1e18,
    ei: 1024 ** 6,
  };
  const mult = binary[unit];
  if (mult == null) return undefined;
  const bytes = Math.round(amount * mult);
  return bytes > 0 ? bytes : undefined;
}

function readVirtualSizeCandidate(obj: Record<string, unknown>, key: string): number | undefined {
  const status = obj.status as Record<string, unknown> | undefined;
  const spec = obj.spec as Record<string, unknown> | undefined;
  for (const raw of [obj[key], status?.[key], spec?.[key]]) {
    if (raw == null) continue;
    const parsed = parseKubernetesQuantityToBytes(raw);
    if (parsed != null) return parsed;
  }
  return undefined;
}

export function readVmImageVirtualSizeBytes(obj: unknown): number | undefined {
  const r = normalizeHarvesterVmImageRecord(obj);
  if (!r || typeof r !== 'object') return undefined;
  const record = r as Record<string, unknown>;
  for (const key of ['virtualSize', 'virtualsize', 'VirtualSize']) {
    const parsed = readVirtualSizeCandidate(record, key);
    if (parsed != null) return parsed;
  }
  return undefined;
}

function vmImageConditions(
  record: Record<string, unknown>,
): Array<{ type?: string; status?: string; reason?: string; message?: string }> {
  const status = record.status as Record<string, unknown> | undefined;
  if (Array.isArray(status?.conditions) && status!.conditions!.length > 0) {
    return status!.conditions as Array<{
      type?: string;
      status?: string;
      reason?: string;
      message?: string;
    }>;
  }
  if (Array.isArray(record.conditions) && record.conditions.length > 0) {
    return record.conditions as Array<{
      type?: string;
      status?: string;
      reason?: string;
      message?: string;
    }>;
  }
  return [];
}

/** 集群 status.progress（与 Harvester UI 上传进度一致） */
export function readVmImageImportProgress(obj: unknown): number | undefined {
  const r = normalizeHarvesterVmImageRecord(obj);
  if (!r || typeof r !== 'object') return undefined;
  const record = r as Record<string, unknown>;
  const status = record.status as Record<string, unknown> | undefined;
  const statusP = Number(status?.progress);
  const topP = Number(record.progress);
  if (Number.isFinite(statusP)) return statusP;
  if (Number.isFinite(topP)) return topP;
  return undefined;
}

function isHarvesterVmImageImportCompleteForProgressGate(obj: unknown): boolean {
  const r = normalizeHarvesterVmImageRecord(obj);
  if (!r || typeof r !== 'object') return false;
  const record = r as Record<string, unknown>;
  const conds = vmImageConditions(record);
  const imported = conds.find((c) => c?.type === 'Imported');
  if (imported?.status === 'True' || imported?.status === 'true') return true;
  const progressRaw = readVmImageImportProgress(obj);
  if (!Number.isFinite(progressRaw) || (progressRaw as number) < 100) return false;
  const status = record.status as Record<string, unknown> | undefined;
  const size = Number(status?.size ?? record.size);
  return size > 0;
}

const HARVESTER_IMPORT_FINALIZE_PROGRESS_MIN = 95;

/** progress≥95 收尾或 100% 未就绪：Imported=False 的 Failed/Cancelled 多为瞬态 */
export function isActiveHarvesterVmImageImportInProgress(obj: unknown): boolean {
  const progressRaw = readVmImageImportProgress(obj);
  if (!Number.isFinite(progressRaw)) return false;
  const progress = progressRaw as number;
  if (progress >= 100 && !isHarvesterVmImageImportCompleteForProgressGate(obj)) return true;
  if (progress >= HARVESTER_IMPORT_FINALIZE_PROGRESS_MIN && progress < 100) return true;
  return false;
}

function isExplicitUserHarvesterVmImageImportCancel(obj: unknown): boolean {
  const r = normalizeHarvesterVmImageRecord(obj);
  if (!r || typeof r !== 'object') return false;
  const record = r as Record<string, unknown>;
  const conds = vmImageConditions(record);
  const imported = conds.find((c) => c?.type === 'Imported');
  if (imported?.status === 'False' || imported?.status === 'false') {
    const msg = String(imported?.message || '').toLowerCase();
    if (
      msg.includes('user cancel') ||
      msg.includes('cancelled by user') ||
      msg.includes('用户取消') ||
      msg.includes('用户中止')
    ) {
      return true;
    }
  }
  const status = record.status as Record<string, unknown> | undefined;
  const statusMsg = String(status?.message || '').toLowerCase();
  return (
    statusMsg.includes('user cancel') ||
    statusMsg.includes('cancelled by user') ||
    statusMsg.includes('用户取消')
  );
}

/** Imported=False 是否为底座已确认的终态失败（非导入中瞬态/陈旧库存） */
export function isHarvesterVmImageImportedTerminalFailure(obj: unknown): boolean {
  const r = normalizeHarvesterVmImageRecord(obj);
  if (!r || typeof r !== 'object') return false;
  const record = r as Record<string, unknown>;
  const conds = vmImageConditions(record);
  const imported = conds.find((c) => c?.type === 'Imported');
  if (imported?.status !== 'False' && imported?.status !== 'false') return false;

  if (isActiveHarvesterVmImageImportInProgress(obj)) return false;

  const reason = String(imported?.reason || '').trim();
  const msg = String(imported?.message || '').trim();
  const terminalReasons = ['UploadFailed', 'ImportFailed', 'Canceled', 'Cancelled', 'UploadCanceled'];
  if (terminalReasons.includes(reason)) return true;

  const lower = `${msg} ${reason}`.toLowerCase();
  if (
    lower.includes('context canceled') ||
    lower.includes('context cancelled') ||
    lower.includes('operation canceled') ||
    lower.includes('operation cancelled')
  ) {
    return false;
  }
  if (
    lower.includes('upload failed') ||
    lower.includes('import failed') ||
    lower.includes('connection refused') ||
    lower.includes('proxy error') ||
    lower.includes(' i/o timeout') ||
    lower.includes('eof') ||
    lower.includes('larger than the reported available storage') ||
    lower.includes('larger pvc is required')
  ) {
    return true;
  }
  if (
    lower.includes('user cancel') ||
    lower.includes('cancelled by user') ||
    lower.includes('用户取消') ||
    lower.includes('用户中止')
  ) {
    return false;
  }

  const progress = readVmImageImportProgress(obj);
  if (Number.isFinite(progress) && (progress as number) < 100) return false;

  return false;
}

/** 底座 CR 是否为用户/系统取消导入 */
export function isHarvesterVmImageImportCancelled(obj: unknown): boolean {
  const r = normalizeHarvesterVmImageRecord(obj);
  if (!r || typeof r !== 'object') return false;
  if (isActiveHarvesterVmImageImportInProgress(obj) && !isExplicitUserHarvesterVmImageImportCancel(obj)) {
    return false;
  }
  const record = r as Record<string, unknown>;
  const status = record.status as Record<string, unknown> | undefined;
  const statusStr = String(status?.state ?? record.state ?? status?.phase ?? '').toLowerCase();
  if (statusStr === 'cancelled') return true;

  const conds = vmImageConditions(record);
  const cancelledCondition = conds.find((c) => c?.type === 'Cancelled');
  if (cancelledCondition?.status === 'True' || cancelledCondition?.status === 'true') return true;

  const imported = conds.find((c) => c?.type === 'Imported');
  if (imported?.status === 'False' || imported?.status === 'false') {
    const reason = String(imported?.reason || '').trim();
    if (['Canceled', 'Cancelled', 'UploadCanceled'].includes(reason)) return true;
    const msg = String(imported?.message || '').toLowerCase();
    if (
      msg.includes('user cancel') ||
      msg.includes('cancelled by user') ||
      msg.includes('用户取消') ||
      msg.includes('用户中止')
    ) {
      return true;
    }
  }
  return false;
}

/**
 * 镜像是否已在 Harvester 导入完成。
 * Steve metadata.state.name=active 仅表示 CR 已创建，上传中也会是 active，不能当作已就绪。
 */
export function isHarvesterVmImageImportComplete(obj: unknown): boolean {
  const r = normalizeHarvesterVmImageRecord(obj);
  if (!r || typeof r !== 'object') return false;
  const record = r as Record<string, unknown>;
  const conds = vmImageConditions(record);
  const imported = conds.find((c) => c?.type === 'Imported');
  if (imported?.status === 'True' || imported?.status === 'true') return true;
  // Imported=False 仅在底座已确认终态失败时阻断就绪；CDI 转换中可能长期为 False
  if (
    (imported?.status === 'False' || imported?.status === 'false') &&
    isHarvesterVmImageImportedTerminalFailure(obj)
  ) {
    return false;
  }

  const progressRaw = readVmImageImportProgress(obj);
  if (!Number.isFinite(progressRaw)) return false;
  const progress = progressRaw as number;
  if (progress < 100) return false;
  if (progress >= 100) {
    const status = record.status as Record<string, unknown> | undefined;
    const size = Number(status?.size ?? record.size);
    return size > 0;
  }
  return false;
}

function vmImageRecordSortMs(item: Record<string, unknown>): number {
  const meta = (item.metadata || {}) as Record<string, unknown>;
  const ts = meta.creationTimestamp || item.createdAt;
  const ms = ts ? Date.parse(String(ts)) : NaN;
  return Number.isFinite(ms) ? ms : 0;
}

/** 已向 Harvester 导入完成 — 可向集群拉详情补 virtualSize */
export function isVmImageReadyForVirtualSize(obj: unknown): boolean {
  return isHarvesterVmImageImportComplete(obj);
}

function vmImageRecordIdentity(detail: any): boolean {
  return Boolean(detail?.metadata?.name || detail?.name);
}

/** 合并多条 GET 响应，优先保留 virtualSize 与更完整的 status */
export function mergeHarvesterVmImageDetailRecords(primary: any, incoming: any): any {
  if (!primary) return incoming;
  if (!incoming) return primary;
  const vs = readVmImageVirtualSizeBytes(incoming) ?? readVmImageVirtualSizeBytes(primary);
  const status = {
    ...(primary?.status && typeof primary.status === 'object' ? primary.status : {}),
    ...(incoming?.status && typeof incoming.status === 'object' ? incoming.status : {}),
    ...(vs != null ? { virtualSize: vs } : {}),
  };
  return {
    ...primary,
    ...incoming,
    status,
    ...(vs != null ? { virtualSize: vs } : {}),
  };
}

export function buildHarvesterVmImageDetailUrls(
  roots: HarvesterClusterApiRoots,
  namespace: string,
  name: string,
): string[] {
  const encNs = encodeURIComponent(namespace);
  const encName = encodeURIComponent(name);
  const { apiPrefix, hostRoot } = roots;
  const out: string[] = [
    `${apiPrefix}/apis/harvesterhci.io/v1beta1/namespaces/${encNs}/virtualmachineimages/${encName}`,
    `${apiPrefix}/apis/harvesterhci.io/v1/namespaces/${encNs}/virtualmachineimages/${encName}`,
  ];
  if (apiPrefix !== hostRoot) {
    out.push(
      `${hostRoot}/apis/harvesterhci.io/v1beta1/namespaces/${encNs}/virtualmachineimages/${encName}`,
      `${hostRoot}/apis/harvesterhci.io/v1/namespaces/${encNs}/virtualmachineimages/${encName}`,
    );
  }
  out.push(
    `${hostRoot}/k8s/clusters/local/apis/harvesterhci.io/v1beta1/namespaces/${encNs}/virtualmachineimages/${encName}`,
    `${hostRoot}/k8s/clusters/local/apis/harvesterhci.io/v1/namespaces/${encNs}/virtualmachineimages/${encName}`,
    `${hostRoot}/v1/harvester/harvesterhci.io.virtualmachineimages/${encNs}/${encName}`,
  );
  return [...new Set(out)];
}

/** PVC Steve action=export（卷导出为镜像）候选 URL */
export function buildPvcExportImageActionUrls(
  roots: HarvesterClusterApiRoots,
  namespace: string,
  pvcName: string,
  endpoint?: string,
): string[] {
  const encNs = encodeURIComponent(namespace);
  const encName = encodeURIComponent(pvcName);
  const { apiPrefix, hostRoot } = roots;
  const host = hostRoot.replace(/\/+$/, '');
  const api = apiPrefix.replace(/\/+$/, '');
  const stevePaths = [
    `/v1/harvester/persistentvolumeclaims/${encNs}/${encName}?action=export`,
    `/v1/harvester/core.v1.persistentvolumeclaims/${encNs}/${encName}?action=export`,
  ];
  const out: string[] = [];
  for (const path of stevePaths) {
    out.push(`${host}${path}`);
    if (api !== host) {
      out.push(`${api}${path}`);
    }
    if (isLikelyRancherManagementEndpoint(endpoint || '')) {
      out.push(`${host}/k8s/clusters/local${path}`);
    }
  }
  return [...new Set(out)];
}

export function buildHarvesterVmImageListUrls(roots: HarvesterClusterApiRoots): string[] {
  const { apiPrefix, hostRoot } = roots;
  const out: string[] = [
    `${apiPrefix}/apis/harvesterhci.io/v1beta1/virtualmachineimages`,
    `${apiPrefix}/apis/harvesterhci.io/v1/virtualmachineimages`,
  ];
  if (apiPrefix !== hostRoot) {
    out.push(
      `${hostRoot}/apis/harvesterhci.io/v1beta1/virtualmachineimages`,
      `${hostRoot}/apis/harvesterhci.io/v1/virtualmachineimages`,
    );
  }
  out.push(
    `${hostRoot}/k8s/clusters/local/apis/harvesterhci.io/v1beta1/virtualmachineimages`,
    `${hostRoot}/v1/harvester/harvesterhci.io.virtualmachineimages`,
  );
  return [...new Set(out)];
}

export async function fetchHarvesterVmImageDetailFromCluster(
  cloud: { endpoint?: string; secretKey?: string; config?: any },
  namespace: string,
  name: string,
  insecure: boolean,
): Promise<any | null> {
  const roots = resolveHarvesterClusterApiRoots(cloud.endpoint || '', cloud.config);
  const token = resolveHarvesterCloudKubeToken(cloud);
  let merged: any | null = null;

  for (const url of buildHarvesterVmImageDetailUrls(roots, namespace, name)) {
    try {
      const raw = await getJsonOnce(url, token, insecure, true);
      const detail = normalizeHarvesterVmImageRecord(raw);
      if (!vmImageRecordIdentity(detail)) continue;
      merged = merged ? mergeHarvesterVmImageDetailRecords(merged, detail) : detail;
    } catch {
      /* try next */
    }
  }

  return merged;
}

/** Longhorn BackingImage.status.virtualSize（VMImage 未写入时兜底） */
export async function tryFetchLonghornBackingImageVirtualSize(
  cloud: { endpoint?: string; secretKey?: string; config?: any },
  imageName: string,
  insecure: boolean,
): Promise<number | undefined> {
  const name = String(imageName || '').trim();
  if (!name) return undefined;
  const roots = resolveHarvesterClusterApiRoots(cloud.endpoint || '', cloud.config);
  const token = resolveHarvesterCloudKubeToken(cloud);
  const enc = encodeURIComponent(name);
  const urls = [
    `${roots.apiPrefix}/apis/longhorn.io/v1beta2/namespaces/longhorn-system/backingimages/${enc}`,
    `${roots.hostRoot}/apis/longhorn.io/v1beta2/namespaces/longhorn-system/backingimages/${enc}`,
    `${roots.apiPrefix}/apis/longhorn.io/v1beta1/namespaces/longhorn-system/backingimages/${enc}`,
  ];
  for (const url of [...new Set(urls)]) {
    try {
      const raw = await getJsonOnce(url, token, insecure, true);
      const json = normalizeHarvesterVmImageRecord(raw);
      const st = (json as Record<string, unknown>)?.status as Record<string, unknown> | undefined;
      const parsed = parseKubernetesQuantityToBytes(
        st?.virtualSize ?? st?.virtualsize ?? st?.VirtualSize,
      );
      if (parsed != null) return parsed;
    } catch {
      /* try next */
    }
  }
  return undefined;
}

/** 从 VMImage 详情 + Longhorn 解析 virtualSize */
export async function resolveVmImageVirtualSizeFromCluster(
  cloud: { endpoint?: string; secretKey?: string; config?: any },
  namespace: string,
  name: string,
  insecure: boolean,
  detailHint?: unknown,
): Promise<{ detail: any | null; virtualSize?: number }> {
  let detail =
    detailHint != null
      ? normalizeHarvesterVmImageRecord(detailHint)
      : await fetchHarvesterVmImageDetailFromCluster(cloud, namespace, name, insecure);
  let virtualSize = readVmImageVirtualSizeBytes(detail);
  if (virtualSize == null) {
    virtualSize = await tryFetchLonghornBackingImageVirtualSize(cloud, name, insecure);
  }
  if (virtualSize != null) {
    const base =
      detail && typeof detail === 'object'
        ? detail
        : {
            metadata: { name, namespace },
            spec: {},
            status: {},
          };
    detail = injectVmImageVirtualSize(base, virtualSize);
  }
  return { detail, virtualSize };
}

/**
 * 集群列表/Steve 响应常缺 status.virtualSize；对已就绪条目逐条 GET 详情补全（仅 sync 时调用）。
 */
export async function backfillVmImageVirtualSizeFromClusterDetail(
  cloud: { endpoint?: string; secretKey?: string; config?: any },
  items: any[],
  insecure: boolean,
  cap = 24,
): Promise<any[]> {
  if (!items?.length) return items;
  const need = [...items]
    .filter(
      (item) => readVmImageVirtualSizeBytes(item) == null && isVmImageReadyForVirtualSize(item),
    )
    .sort(
      (a, b) =>
        vmImageRecordSortMs(b as Record<string, unknown>) -
        vmImageRecordSortMs(a as Record<string, unknown>),
    )
    .slice(0, cap);
  if (!need.length) return items;

  const patchByKey = new Map<string, any>();
  const concurrency = 4;
  for (let i = 0; i < need.length; i += concurrency) {
    const batch = need.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (item) => {
        const ns = String(item?.metadata?.namespace || item?.namespace || '').trim();
        const name = String(item?.metadata?.name || item?.name || '').trim();
        if (!ns || !name) return;
        const { detail, virtualSize } = await resolveVmImageVirtualSizeFromCluster(
          cloud,
          ns,
          name,
          insecure,
        );
        if (!detail || virtualSize == null) return;
        patchByKey.set(`${ns}/${name}`, detail);
      }),
    );
  }

  if (!patchByKey.size) return items;
  return items.map((item) => {
    const ns = String(item?.metadata?.namespace || item?.namespace || '').trim();
    const name = String(item?.metadata?.name || item?.name || '').trim();
    const detail = patchByKey.get(`${ns}/${name}`);
    if (!detail) return item;
    const vs = readVmImageVirtualSizeBytes(detail);
    const status = {
      ...(item?.status && typeof item.status === 'object' ? item.status : {}),
      ...(detail?.status && typeof detail.status === 'object' ? detail.status : {}),
      ...(vs != null ? { virtualSize: vs } : {}),
    };
    return {
      ...item,
      ...detail,
      status,
      ...(vs != null ? { virtualSize: vs } : {}),
    };
  });
}
