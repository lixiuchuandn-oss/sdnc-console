/** 解析 `fetchHarvesterNamespaces` 响应为命名空间名称列表 */
export function parseHarvesterNamespaceNames(res: unknown): string[] {
  const payload = res as { data?: { items?: unknown[] }; items?: unknown[] };
  const items = payload?.data?.items || payload?.items || [];
  if (!Array.isArray(items)) return [];
  return items
    .map((x: unknown) => {
      const row = x as { metadata?: { name?: string }; name?: string };
      return row?.metadata?.name || row?.name;
    })
    .filter(Boolean) as string[];
}
