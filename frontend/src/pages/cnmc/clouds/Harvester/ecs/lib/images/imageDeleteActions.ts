import {
  findVmsReferencingHarvesterImage,
  formatHarvesterImageDeleteInUseMessage,
  stripHarvesterImageDeleteErrorPrefixes,
} from 'utils/harvesterUtils';
import {
  getImageDisplayAlias,
  getImageRowId,
  getImageRowNamespace,
  type ImageListRecord,
} from '../imagesSectionUtils';
import { TOWER_UPLOAD_TASK_ID_KEY } from './constants';

export type BatchImageDeleteResult = {
  ok: boolean;
  name: string;
  ns?: string;
  id?: string;
  err?: string;
};

export function getImageNsNameKey(r: ImageListRecord): string {
  return `${getImageRowNamespace(r)}/${getImageRowId(r)}`;
}

export function selectImagesByRowKeys(
  images: readonly ImageListRecord[],
  selectedKeys: Array<string | number>,
): ImageListRecord[] {
  const byImageId = new Map<string, ImageListRecord>();
  const byTaskId = new Map<string, ImageListRecord>();
  for (const r of images) {
    byImageId.set(getImageRowId(r), r);
    const fromRow = String((r as Record<string, unknown>)[TOWER_UPLOAD_TASK_ID_KEY] || '').trim();
    if (fromRow) byTaskId.set(fromRow, r);
    const name = String(getImageRowId(r) || '').trim();
    if (name.startsWith('tower-upload-')) {
      const virtualId = name.slice('tower-upload-'.length).trim();
      if (virtualId) byTaskId.set(virtualId, r);
    }
  }
  return selectedKeys
    .map((k) => {
      const key = String(k);
      return byTaskId.get(key) ?? byImageId.get(key);
    })
    .filter(Boolean) as ImageListRecord[];
}

export function assessImageDeleteBlockedByVms(
  r: ImageListRecord,
  vms: readonly any[],
): string | null {
  const name = getImageRowId(r);
  if (!name) return null;
  const ns = getImageRowNamespace(r);
  const used = findVmsReferencingHarvesterImage(ns, name, vms);
  if (used.length === 0) return null;
  return `镜像仍被以下虚拟机使用，无法删除：${used.map((u) => u.label).join('、')}`;
}

export function isImageDeleteInUseHttpError(err: unknown): boolean {
  const msg = extractImageDeleteErrorText(err).toLowerCase();
  const status = (err as { status?: number })?.status;
  return (
    status === 409 ||
    status === 422 ||
    msg.includes('422') ||
    msg.includes('in use') ||
    msg.includes('being used') ||
    msg.includes('cannot delete image') ||
    msg.includes('被使用') ||
    msg.includes('仍被')
  );
}

export function getImageDeleteInUseErrorMessage(): string {
  return '镜像仍被虚拟机使用，无法删除';
}

const IMAGE_IN_USE_FRIENDLY_RE =
  /^镜像仍被虚拟机「[^」]+」使用，无法删除$|^镜像仍被以下虚拟机使用，无法删除：/;

/** 将 Harvester 删除镜像 webhook / API 英文报错转为可读中文 */
export function formatHarvesterImageDeleteError(
  err: unknown,
  opts?: { vms?: any[] },
): string {
  const raw = extractImageDeleteErrorText(err);
  if (!raw) return '删除失败';

  if (IMAGE_IN_USE_FRIENDLY_RE.test(raw)) return raw;

  for (const candidate of collectImageDeleteErrorCandidates(err)) {
    const inUse = formatHarvesterImageDeleteInUseMessage(candidate, opts);
    if (inUse && !isGenericImageInUseMessage(inUse)) return inUse;
  }

  const stripped = stripHarvesterImageDeleteErrorPrefixes(raw);
  if (stripped && stripped !== raw) {
    const nested = formatHarvesterImageDeleteInUseMessage(stripped, opts);
    if (nested && !isGenericImageInUseMessage(nested)) return nested;
  }

  const friendlyFromRaw = formatHarvesterImageDeleteInUseMessage(raw, opts);
  if (friendlyFromRaw) return friendlyFromRaw;

  if (isImageDeleteInUseHttpError(err) || /cannot delete image/i.test(stripped || raw)) {
    return getImageDeleteInUseErrorMessage();
  }

  return raw.startsWith('删除') || raw.startsWith('镜像仍被') ? raw : `删除失败：${raw}`;
}

function isGenericImageInUseMessage(msg: string): boolean {
  return msg === getImageDeleteInUseErrorMessage();
}

function collectImageDeleteErrorCandidates(err: unknown): string[] {
  const e = err as {
    message?: string;
    responseData?: { message?: string; error?: string };
  };
  const out: string[] = [];
  const push = (v: unknown) => {
    const s = typeof v === 'string' ? v.trim() : '';
    if (s && !out.includes(s)) out.push(s);
  };
  push(e?.responseData?.message);
  push(e?.responseData?.error);
  push(e?.message);
  return out;
}

function extractImageDeleteErrorText(err: unknown): string {
  const candidates = collectImageDeleteErrorCandidates(err);
  const detailed = candidates.find((m) =>
    /cannot delete image|being used by volume|admission webhook/i.test(m),
  );
  if (detailed) return detailed;

  const friendly = candidates.find((m) => IMAGE_IN_USE_FRIENDLY_RE.test(m));
  if (friendly) return friendly;

  return String(candidates[0] || err || '').trim();
}

export function getImageBatchDeleteLabel(r: ImageListRecord): string {
  const name = getImageRowId(r);
  const alias = getImageDisplayAlias(r);
  return alias ? `${alias} (${name})` : name;
}

export async function mapBatchImageDelete(
  targets: readonly ImageListRecord[],
  deleteOne: (r: ImageListRecord) => Promise<void>,
  opts?: { vms?: any[] },
): Promise<BatchImageDeleteResult[]> {
  const results: BatchImageDeleteResult[] = [];
  for (const r of targets) {
    const ns = getImageRowNamespace(r);
    const name = getImageRowId(r);
    const label = getImageBatchDeleteLabel(r);
    try {
      await deleteOne(r);
      results.push({ ok: true, name: label, ns, id: name });
    } catch (e: unknown) {
      results.push({
        ok: false,
        name: label,
        err: formatHarvesterImageDeleteError(e, opts),
      });
    }
  }
  return results;
}

export type BatchImageDeleteSummary = {
  success?: string;
  warning?: string;
  error?: string;
  deletedKeys: Set<string>;
};

export function summarizeBatchImageDeleteMessage(
  results: readonly BatchImageDeleteResult[],
  opts?: { taskDeleteFailedCount?: number; clusterNotFoundCount?: number },
): BatchImageDeleteSummary {
  const okResults = results.filter((x) => x.ok);
  const fail = results.filter((x) => !x.ok);
  const deletedKeys = new Set(
    okResults.filter((r) => r.ns && r.id).map((r) => `${r.ns}/${r.id}`),
  );
  const taskDeleteFailedCount = Math.max(0, Number(opts?.taskDeleteFailedCount) || 0);
  const clusterNotFoundCount = Math.max(0, Number(opts?.clusterNotFoundCount) || 0);
  let warning: string | undefined;
  if (taskDeleteFailedCount > 0) {
    warning = `${taskDeleteFailedCount} 条镜像的集群资源已删除，但上传任务记录删除失败，请稍后在「镜像上传任务」中重试`;
  } else if (clusterNotFoundCount > 0 && okResults.length > 0) {
    warning = `${clusterNotFoundCount} 条镜像在集群中已不存在，其余已清理`;
  }
  return {
    success: okResults.length > 0 ? `删除成功 ${okResults.length} 条` : undefined,
    warning,
    error:
      fail.length > 0
        ? `删除失败 ${fail.length} 条：${fail.map((f) => (f.err ? `${f.name}（${f.err}）` : f.name)).join('；')}`
        : undefined,
    deletedKeys,
  };
}

export function filterImageListAfterDelete(
  prev: readonly ImageListRecord[],
  deletedKeys: ReadonlySet<string>,
): ImageListRecord[] {
  return prev.filter((img) => !deletedKeys.has(getImageNsNameKey(img)));
}
