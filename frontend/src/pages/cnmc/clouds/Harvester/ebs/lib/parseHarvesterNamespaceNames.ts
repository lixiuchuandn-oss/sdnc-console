function namespaceNameFromRow(row: unknown): string {
  const r = row as {
    id?: string;
    metadata?: { name?: string };
    name?: string;
  };
  return String(r?.metadata?.name || r?.name || r?.id || '').trim();
}

/** 解析 `fetchHarvesterNamespaces` 响应为命名空间名称列表 */
export function parseHarvesterNamespaceNames(res: unknown): string[] {
  let items: unknown[] = [];
  if (Array.isArray(res)) {
    items = res;
  } else {
    const payload = res as { data?: { items?: unknown[] }; items?: unknown[] };
    items = payload?.data?.items || payload?.items || [];
  }
  if (!Array.isArray(items)) return [];
  const names = items.map(namespaceNameFromRow).filter(Boolean);
  return Array.from(new Set(names));
}
