/**
 * Harvester 镜像库存 → 列表 API 项映射（含 listStateKey）。
 */
import { HarvesterImageInventory } from '../../../../../entities/harvester/HarvesterImageInventory';
import {
  fetchHarvesterVmImageDetailFromCluster,
  isHarvesterVmImageImportCancelled,
  isHarvesterVmImageImportComplete,
  isHarvesterVmImageImportedTerminalFailure,
  isActiveHarvesterVmImageImportInProgress,
  readVmImageImportProgress,
  readVmImageVirtualSizeBytes,
} from '../../../../../services/clouds/harvester/vmImageClusterApi';
import { upsertHarvesterImageInventoryItems } from '../../../../../services/clouds/harvester/inventory';
import { resolveHarvesterImageListStateKey } from '../../../../../services/clouds/harvester/vmImageListState';
import type { ImageUploadTask } from '../../../../../entities/harvester/ImageUploadTask';

function deriveLonghornImageStorageClassFromName(name: string): string | undefined {
  const n = String(name || '').trim();
  const m = /^image-([a-z0-9]+)$/i.exec(n);
  if (m?.[1]) return `longhorn-image-${m[1]}`;
  return undefined;
}

function resolveImageStorageClassName(i: HarvesterImageInventory, r: Record<string, any>): string {
  const name = String(r.metadata?.name || r.name || i.name || '').trim();
  const ann = (r.metadata?.annotations || {}) as Record<string, string>;

  const statusSc = String(r.status?.storageClassName || '').trim();
  if (statusSc) return statusSc;

  const derived = deriveLonghornImageStorageClassFromName(name);
  if (derived) return derived;

  const specSc = String(r.spec?.storageClassName || r.spec?.targetStorageClassName || '').trim();
  if (specSc && specSc !== 'longhorn') return specSc;

  for (const candidate of [
    String(r.storageClassName || '').trim(),
    String(i.storageClassName || '').trim(),
    String(ann['harvesterhci.io/storageClassName'] || '').trim(),
  ]) {
    if (candidate.startsWith('longhorn-image-')) return candidate;
  }

  if (specSc) return specSc;
  if (derived) return derived;

  const annSc = String(ann['harvesterhci.io/storageClassName'] || '').trim();
  const invSc = String(i.storageClassName || r.storageClassName || '').trim();
  if (invSc && invSc !== 'longhorn') return invSc;
  if (annSc && annSc !== 'longhorn') return annSc;
  return annSc || invSc || String(r.storageClassName || '').trim();
}

export function isCephLikeImageStorageClass(storageClassName: string): boolean {
  const sc = String(storageClassName || '').trim();
  if (!sc) return false;
  if (sc === 'longhorn' || sc.startsWith('longhorn-image-')) return false;
  return /ceph/i.test(sc);
}

/** Ceph/CDI 同步完成后 status.size 常为 PVC 虚拟盘容量，而非 qcow2 稀疏文件体积 */
export function clusterReportedSizeLooksLikeVirtualCapacity(
  reportedBytes: number | undefined,
  virtualBytes: number | undefined,
  fileBytesHint?: number,
): boolean {
  if (reportedBytes == null || !Number.isFinite(reportedBytes) || reportedBytes <= 0) {
    return false;
  }
  if (virtualBytes != null && virtualBytes > 0 && reportedBytes >= virtualBytes * 0.9) {
    return true;
  }
  if (
    fileBytesHint != null &&
    fileBytesHint > 0 &&
    reportedBytes > fileBytesHint * 1.5
  ) {
    return true;
  }
  return false;
}

function resolveImageInventoryDisplayFields(
  i: HarvesterImageInventory,
  r: Record<string, any>,
): { size: number; virtualSize?: number; storageClassName: string } {
  const invSizeNum = Number(i.size);
  const statusSizeRaw = r.status?.size ?? r.status?.downloadedBytes;
  const statusSizeNum = Number(statusSizeRaw);
  const topSizeNum = Number(r.size);
  const virtualSize = readVmImageVirtualSizeBytes(r);
  let size =
    (Number.isFinite(statusSizeNum) && statusSizeNum > 0 ? statusSizeNum : 0) ||
    (Number.isFinite(invSizeNum) && invSizeNum > 0 ? invSizeNum : 0) ||
    (Number.isFinite(topSizeNum) && topSizeNum > 0 ? topSizeNum : 0);

  const storageClassName = resolveImageStorageClassName(i, r);
  const cephLike = isCephLikeImageStorageClass(storageClassName);
  const sizeLooksLikeVirtual =
    virtualSize != null &&
    virtualSize > 0 &&
    size > 0 &&
    clusterReportedSizeLooksLikeVirtualCapacity(size, virtualSize);

  // CDI 同步中/完成后（Ceph）status.size 常为 PVC 虚拟盘容量，不能当作稀疏 qcow2 文件体积
  if (sizeLooksLikeVirtual && (isActiveHarvesterVmImageImportInProgress(r) || cephLike)) {
    if (Number.isFinite(invSizeNum) && invSizeNum > 0 && invSizeNum < size) {
      size = invSizeNum;
    } else {
      size = 0;
    }
  }
  return { size, virtualSize, storageClassName };
}

export function enrichImageListItemSizeFromUploadTask(
  item: Record<string, unknown>,
  task: Pick<ImageUploadTask, 'fileSize' | 'virtualSizeBytes'>,
): Record<string, unknown> {
  const fileSize = Math.max(0, Math.floor(Number(task.fileSize) || 0));
  if (!fileSize) return item;

  const status =
    item.status && typeof item.status === 'object' && !Array.isArray(item.status)
      ? ({ ...(item.status as Record<string, unknown>) } as Record<string, unknown>)
      : ({} as Record<string, unknown>);
  const clusterBytes = Number(status.size ?? item.size ?? 0);
  const virtualBytes =
    readVmImageVirtualSizeBytes(item) ??
    (Number(task.virtualSizeBytes) > 0 ? Number(task.virtualSizeBytes) : undefined);
  const preferTaskFileSize =
    clusterReportedSizeLooksLikeVirtualCapacity(
      Number.isFinite(clusterBytes) && clusterBytes > 0 ? clusterBytes : undefined,
      virtualBytes,
      fileSize,
    ) || !Number.isFinite(clusterBytes) || clusterBytes <= 0;

  if (!preferTaskFileSize) return item;

  return {
    ...item,
    size: fileSize,
    status: { ...status, size: fileSize },
  };
}

export function enrichImageListItemsFromUploadTasks(
  items: Record<string, unknown>[],
  tasks: Pick<
    ImageUploadTask,
    'createdImageName' | 'createdImageNamespace' | 'namespace' | 'displayName' | 'filename' | 'fileSize' | 'virtualSizeBytes'
  >[],
): Record<string, unknown>[] {
  if (!items.length || !tasks.length) return items;

  const taskByImageKey = new Map<string, (typeof tasks)[number]>();
  for (const task of tasks) {
    const name = String(task.createdImageName || '').trim();
    const ns = String(task.createdImageNamespace || task.namespace || '').trim();
    if (!name || !ns) continue;
    const key = `${ns}/${name}`;
    const existing = taskByImageKey.get(key);
    if (!existing || Number(task.fileSize || 0) > Number(existing.fileSize || 0)) {
      taskByImageKey.set(key, task);
    }
  }

  return items.map((item) => {
    const name = String(item.name || (item.metadata as any)?.name || '').trim();
    const namespace = String(item.namespace || (item.metadata as any)?.namespace || '').trim();
    if (!name || !namespace) return item;
    const task = taskByImageKey.get(`${namespace}/${name}`);
    return task ? enrichImageListItemSizeFromUploadTask(item, task) : item;
  });
}

/** Steve 风格 state 字段（兼容旧客户端）；UI 应优先 listStateKey */
function resolveLegacySteveState(r: Record<string, any>, sourceType: string): string {
  const conditions = (
    Array.isArray(r.status?.conditions)
      ? r.status.conditions
      : Array.isArray(r.conditions)
        ? r.conditions
        : []
  ) as Array<{ type?: string; status?: string }>;
  const imported = conditions.find((c) => c?.type === 'Imported');
  const effectiveProgress = readVmImageImportProgress(r) ?? 0;

  if (imported?.status === 'True' || imported?.status === 'true') return 'Active';
  if (isActiveHarvesterVmImageImportInProgress(r)) {
    if (sourceType === 'upload') return 'Uploading';
    if (sourceType === 'export') return 'Exporting';
    if (sourceType === 'download') return 'Importing';
    return 'Downloading';
  }
  if (isHarvesterVmImageImportCancelled(r)) return 'Cancelled';
  if (
    (imported?.status === 'False' || imported?.status === 'false') &&
    isHarvesterVmImageImportedTerminalFailure(r)
  ) {
    return 'Failed';
  }
  if (effectiveProgress >= 100 && isHarvesterVmImageImportComplete(r)) return 'Active';
  if (sourceType === 'download') return 'Importing';
  if (sourceType === 'upload') return 'Uploading';
  return 'Unknown';
}

export function mapImageInventoryToListItem(
  i: HarvesterImageInventory,
  publicScenarioNsSet: Set<string>,
): Record<string, unknown> {
  const r = (i.rawData || {}) as Record<string, any>;
  const name = r.metadata?.name || i.name || '';
  const namespace = r.metadata?.namespace || i.namespace || '';
  const displayName = r.spec?.displayName || i.displayName || name;
  const { size, virtualSize, storageClassName } = resolveImageInventoryDisplayFields(i, r);
  const conditions = (
    Array.isArray(r.status?.conditions)
      ? r.status.conditions
      : Array.isArray(r.conditions)
        ? r.conditions
        : []
  ) as Array<{ type?: string; status?: string }>;
  const sourceType = r.spec?.sourceType || r.sourceType || '';
  const clusterProgress = readVmImageImportProgress(r);
  const effectiveProgress: number =
    typeof clusterProgress === 'number' && Number.isFinite(clusterProgress) && clusterProgress >= 0
      ? clusterProgress
      : 0;

  const listStateKey = resolveHarvesterImageListStateKey({
    ...r,
    sourceType,
    spec: { ...(r.spec && typeof r.spec === 'object' ? r.spec : {}), sourceType },
  });
  const state = resolveLegacySteveState(r, String(sourceType));

  return {
    ...r,
    id: r.metadata?.uid || i.uid,
    name,
    namespace,
    namespacePublicByScenario: publicScenarioNsSet.has(namespace),
    displayName,
    size,
    ...(virtualSize != null ? { virtualSize } : {}),
    storageClassName,
    progress: effectiveProgress,
    listStateKey,
    state,
    sourceType,
    createdAt: r.metadata?.creationTimestamp,
    conditions,
    status: {
      ...(r.status && typeof r.status === 'object' && !Array.isArray(r.status) ? r.status : {}),
      ...(size > 0 ? { size } : {}),
      ...(virtualSize != null && virtualSize > 0 ? { virtualSize } : {}),
      ...(storageClassName ? { storageClassName } : {}),
      ...(Number.isFinite(effectiveProgress) ? { progress: effectiveProgress } : {}),
    },
    spec: {
      ...(r.spec && typeof r.spec === 'object' ? r.spec : {}),
      ...(storageClassName ? { storageClassName } : {}),
    },
  };
}

/** 列表/轮询：仅对进行中镜像拉底座 live 详情写库存 */
export async function refreshInProgressHarvesterImageInventoryFromCluster(
  cloud: any,
  items: HarvesterImageInventory[],
  insecure: boolean,
): Promise<void> {
  const cloudId = String(cloud?.id || '').trim();
  if (!cloudId || !items.length) return;

  const targets = items.filter((inv) => {
    const r = (inv.rawData || {}) as Record<string, unknown>;
    if (isHarvesterVmImageImportComplete(r)) return false;
    if (isHarvesterVmImageImportedTerminalFailure(r)) return false;
    if (isHarvesterVmImageImportCancelled(r)) return false;
    return true;
  });
  if (!targets.length) return;

  const concurrency = 4;
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, targets.length) }, async () => {
    while (cursor < targets.length) {
      const inv = targets[cursor++];
      const ns = String(inv.namespace || '').trim();
      const name = String(inv.name || '').trim();
      if (!ns || !name) continue;
      try {
        const live = await fetchHarvesterVmImageDetailFromCluster(cloud, ns, name, insecure);
        if (live) await upsertHarvesterImageInventoryItems(cloudId, [live]);
      } catch {
        /* 单条刷新失败不阻断列表 */
      }
    }
  });
  await Promise.all(workers);
}

/** 集群创建镜像 API 返回后写入 Tower 库存（失败不阻断创建响应） */
export async function persistHarvesterImageInventoryFromClusterCreate(
  cloudId: string,
  created: unknown,
  opts?: { imageNameHint?: string },
): Promise<void> {
  const json = created as Record<string, any>;
  const cid = String(cloudId || '').trim();
  if (!cid || !json) return;

  const uid = String(json?.metadata?.uid || '').trim();
  if (!uid) {
    const nameHint = opts?.imageNameHint || json?.metadata?.name || '';
    console.warn(
      `[Image-Create] 创建成功但返回数据缺少 uid，跳过入库，cloudId: ${cid}, name: ${nameHint}`,
    );
    return;
  }

  try {
    await upsertHarvesterImageInventoryItems(cid, [json]);
    console.log(
      `[Image-Create] 镜像已入库，cloudId: ${cid}, name: ${json?.metadata?.name || ''}`,
    );
  } catch (e: any) {
    console.error('[Image-Create] 入库镜像失败:', e?.message || e);
  }
}
