/** 从 CSM BFF 响应中解析 items 列表（与各 Section 约定一致） */
export function extractCsmApiItems(res: unknown): any[] {
  if (Array.isArray(res)) return res;
  const r = res as Record<string, unknown> | null | undefined;
  if (!r) return [];
  if (Array.isArray(r.items)) return r.items;
  const data = r.data as Record<string, unknown> | unknown[] | undefined;
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>).items)) {
    return (data as Record<string, unknown>).items as any[];
  }
  return [];
}

export function formatCsmTimestamp(ts: unknown): string {
  if (ts == null || ts === '') return '-';
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return String(ts);
  const ms = n < 1e12 ? n * 1000 : n;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return String(ts);
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
