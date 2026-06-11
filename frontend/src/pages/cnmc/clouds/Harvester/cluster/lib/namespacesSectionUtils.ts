/**
 * Harvester cluster · NamespacesSection 纯逻辑（表格过滤、YAML link）。
 */

import type { NamespaceSectionKind } from 'utils/harvesterUtils';
import { namespaceSectionType } from 'utils/harvesterUtils';

/** 表格行最小形态（Kubernetes Namespace / Tower 摘要） */
export type NamespaceListRow = {
  metadata?: {
    name?: string;
    uid?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    finalizers?: string[];
    creationTimestamp?: string;
  };
  name?: string;
  status?: { phase?: string };
  links?: { view?: string };
};

export const DEFAULT_NAMESPACE_TYPE_FILTERS: NamespaceSectionKind[] = ['tenant'];

/**
 * Steve `links.view` 或 `/api/v1/namespaces/{name}`。
 * Namespace 集群资源无嵌套命名空间前缀，仅用 name 分段。
 */
export function namespaceRowToViewLink(row: unknown): string | undefined {
  const r = row as NamespaceListRow;
  if (r?.links?.view) return String(r.links.view).trim();
  const n = r?.metadata?.name || r?.name;
  if (n) return `/api/v1/namespaces/${encodeURIComponent(String(n).trim())}`;
  return undefined;
}

export function getNamespaceDisplayName(row: unknown): string {
  const r = row as NamespaceListRow;
  return String(r?.metadata?.name || r?.name || '').trim();
}

function getNamespacePhase(row: NamespaceListRow): string {
  const p = row?.status?.phase;
  return String(p ?? 'Unknown');
}

export type NamespaceTableFilters = {
  keyword: string;
  /** 表格「项目类型」多选；每项为 `NamespaceSectionKind` */
  filterTypes: readonly string[];
  filterStatus: string;
};

/**
 * 表格数据流水线：剔除系统命名空间 → 类型并集筛选 → Phase → 名称 / 标签键关键字。
 */
export function filterNamespacesForTable(
  namespaces: readonly unknown[],
  f: NamespaceTableFilters,
): NamespaceListRow[] {
  let res: NamespaceListRow[] = Array.isArray(namespaces)
    ? (namespaces as NamespaceListRow[])
    : [];
  res = res.filter(row => namespaceSectionType(row) !== 'system');

  const typeFilters = f.filterTypes.filter(t => t !== 'system');
  if (typeFilters.length > 0) {
    res = res.filter(row => typeFilters.includes(namespaceSectionType(row)));
  }

  const statusSel = String(f.filterStatus || '').trim();
  if (statusSel) {
    res = res.filter(row => getNamespacePhase(row) === statusSel);
  }

  const kw = f.keyword.trim().toLowerCase();
  if (!kw) return res;

  return res.filter(row => {
    const name = String(row.metadata?.name || row.name || '').toLowerCase();
    const labels = row.metadata?.labels ?? {};
    const labelKeys = Object.keys(labels).map(k => k.toLowerCase());
    return name.includes(kw) || labelKeys.some(k => k.includes(kw));
  });
}
