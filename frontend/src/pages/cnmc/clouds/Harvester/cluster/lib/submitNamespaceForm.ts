/** 命名空间表单：键值对转换、校验与提交（Harvester cluster） */

import { message } from 'antd';
import { createHarvesterNamespace, updateHarvesterNamespace } from 'services/harvester/clusterInventory';
import { isSystemNamespace } from 'utils/harvesterUtils';
import { harvesterNamespacesListCachePath } from './clusterSectionRefresh';
import { clearGetCacheForPath } from 'utils/requestManager';

export type NamespaceKeyValuePair = { key?: string; value?: string };

export type NamespaceFormValues = {
  name?: string;
  labelPairs?: NamespaceKeyValuePair[];
  annotationPairs?: NamespaceKeyValuePair[];
};

export function labelPairsToRecord(
  pairs: Array<NamespaceKeyValuePair | undefined> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of pairs || []) {
    const k = String(p?.key ?? '').trim();
    if (!k) continue;
    out[k] = String(p?.value ?? '').trim();
  }
  return out;
}

export function collectDuplicatePairKeys(
  pairs: Array<{ key?: string } | undefined> | undefined,
): string[] {
  const keys = (pairs || []).map((p) => String(p?.key ?? '').trim()).filter(Boolean);
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const k of keys) {
    if (seen.has(k)) dup.add(k);
    seen.add(k);
  }
  return [...dup];
}

export async function validateNamespacePairKeyField(_: unknown, value: unknown) {
  const k = String(value || '').trim();
  if (!k) return;
  if (k.length > 253) throw new Error('键最长 253 个字符');
  if (/[\s=]/.test(k)) throw new Error('键不能包含空格或 =');
}

export function namespaceRecordToFormValues(record: unknown): {
  name?: string;
  labelPairs: NamespaceKeyValuePair[];
  annotationPairs: NamespaceKeyValuePair[];
} {
  const r = record as {
    metadata?: { name?: string; labels?: Record<string, string>; annotations?: Record<string, string> };
    name?: string;
  };
  const name = r?.metadata?.name || r?.name;
  const labels = r?.metadata?.labels || {};
  const annotations = r?.metadata?.annotations || {};
  const labelPairs = Object.keys(labels)
    .sort()
    .map((k) => ({ key: k, value: String(labels[k] ?? '') }));
  const annotationPairs = Object.keys(annotations)
    .sort()
    .map((k) => ({ key: k, value: String(annotations[k] ?? '') }));

  return {
    name,
    labelPairs: labelPairs.length ? labelPairs : [{ key: '', value: '' }],
    annotationPairs: annotationPairs.length ? annotationPairs : [{ key: '', value: '' }],
  };
}

export type SubmitNamespaceFormOpts = {
  cloudId: string;
  isEdit: boolean;
  values: NamespaceFormValues;
};

export type SubmitNamespaceFormResult =
  | { ok: true }
  | { ok: false; reason: 'validation' | 'api'; message: string };

export async function submitNamespaceForm(
  opts: SubmitNamespaceFormOpts,
): Promise<SubmitNamespaceFormResult> {
  const { cloudId, isEdit, values } = opts;
  const name = String(values.name || '').trim();

  if (isSystemNamespace(name)) {
    const msg = '禁止创建系统或受保护的项目';
    message.error(msg);
    return { ok: false, reason: 'validation', message: msg };
  }

  const labelDups = collectDuplicatePairKeys(values.labelPairs);
  if (labelDups.length > 0) {
    const msg = `标签键不能重复：${labelDups.join(', ')}`;
    message.error(msg);
    return { ok: false, reason: 'validation', message: msg };
  }
  const annotationDups = collectDuplicatePairKeys(values.annotationPairs);
  if (annotationDups.length > 0) {
    const msg = `注解键不能重复：${annotationDups.join(', ')}`;
    message.error(msg);
    return { ok: false, reason: 'validation', message: msg };
  }

  const parsedLabels = labelPairsToRecord(values.labelPairs);
  const parsedAnnotations = labelPairsToRecord(values.annotationPairs);

  const labels = isEdit
    ? parsedLabels
    : {
        ...parsedLabels,
        'kubernetes.io/metadata.name': name,
        'tower.io/managed': 'true',
        'tower.io/creator': 'compute-tower',
        'tower.io/scenario': 'admin',
      };

  const payload = {
    apiVersion: 'v1',
    kind: 'Namespace',
    metadata: {
      name,
      labels,
      annotations: parsedAnnotations,
    },
  };

  try {
    if (isEdit) {
      await updateHarvesterNamespace(cloudId, name, payload);
      message.success('更新成功');
    } else {
      await createHarvesterNamespace(cloudId, payload);
      message.success('创建成功');
    }
    clearGetCacheForPath(harvesterNamespacesListCachePath(cloudId));
    return { ok: true };
  } catch (e: unknown) {
    const err = e as { message?: string };
    const msg = err?.message || (isEdit ? '更新失败' : '创建失败');
    message.error(msg);
    return { ok: false, reason: 'api', message: msg };
  }
}
