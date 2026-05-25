import { findVmsReferencingHarvesterImage } from 'utils/harvesterUtils';
import type { HarvesterImageUploadTask } from '../../../../../../services/harvesterApi';
import {
  getImageDisplayAlias,
  getImageRowId,
  getImageRowNamespace,
  type ImageListRecord,
} from './imagesSectionUtils';

export type BatchImageDeleteResult = {
  ok: boolean;
  name: string;
  ns?: string;
  id?: string;
  err?: string;
};

export const IMAGE_LIST_PROGRESS_REFRESH_STATES = [
  'downloading',
  'uploading',
  'importing',
  'exporting',
  'pending',
] as const;

export function getImageNsNameKey(r: ImageListRecord): string {
  return `${getImageRowNamespace(r)}/${getImageRowId(r)}`;
}

export function selectImagesByRowKeys(
  images: readonly ImageListRecord[],
  selectedKeys: Array<string | number>,
): ImageListRecord[] {
  const map = new Map<string, ImageListRecord>();
  for (const r of images) map.set(getImageRowId(r), r);
  return selectedKeys.map((k) => map.get(String(k))).filter(Boolean) as ImageListRecord[];
}

export function assessImageDeleteBlockedByVms(
  r: ImageListRecord,
  vms: ImageListRecord[],
): string | null {
  const name = getImageRowId(r);
  if (!name) return null;
  const ns = getImageRowNamespace(r);
  const used = findVmsReferencingHarvesterImage(ns, name, vms);
  if (used.length === 0) return null;
  return `镜像仍被以下虚拟机使用，无法删除：${used.map((u) => u.label).join('、')}`;
}

export function isImageDeleteInUseHttpError(err: unknown): boolean {
  const e = err as { message?: string; status?: number };
  const errMsg = e?.message || '';
  return (
    e?.status === 422 ||
    errMsg.includes('422') ||
    errMsg.toLowerCase().includes('in use') ||
    errMsg.includes('被使用')
  );
}

export function getImageDeleteInUseErrorMessage(): string {
  return '删除镜像失败: 当前镜像正在被虚拟机使用，请先删除引用该镜像的虚拟机';
}

export function getImageBatchDeleteLabel(r: ImageListRecord): string {
  const name = getImageRowId(r);
  const alias = getImageDisplayAlias(r);
  return alias ? `${alias} (${name})` : name;
}

export async function mapBatchImageDelete(
  targets: readonly ImageListRecord[],
  deleteOne: (r: ImageListRecord) => Promise<void>,
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
        err: (e as { message?: string })?.message || String(e),
      });
    }
  }
  return results;
}

export function summarizeBatchImageDeleteMessage(results: readonly BatchImageDeleteResult[]): {
  success?: string;
  error?: string;
  deletedKeys: Set<string>;
} {
  const okResults = results.filter((x) => x.ok);
  const fail = results.filter((x) => !x.ok);
  const deletedKeys = new Set(
    okResults.filter((r) => r.ns && r.id).map((r) => `${r.ns}/${r.id}`),
  );
  return {
    success: okResults.length > 0 ? `删除成功 ${okResults.length} 条` : undefined,
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

export function mergeUploadTasksSorted(
  prev: readonly HarvesterImageUploadTask[],
  incoming: HarvesterImageUploadTask | readonly HarvesterImageUploadTask[],
): HarvesterImageUploadTask[] {
  const map = new Map(prev.map((x) => [x.id, x]));
  const list = Array.isArray(incoming) ? incoming : [incoming];
  for (const task of list) {
    if (task?.id) map.set(task.id, task);
  }
  return Array.from(map.values()).sort(
    (a, b) =>
      new Date(b.createdAt || b.updatedAt || 0).getTime() -
      new Date(a.createdAt || a.updatedAt || 0).getTime(),
  );
}
