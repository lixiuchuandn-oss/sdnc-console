/** 物理节点详情抽屉 · 纯格式化与节点字段读取（Harvester cluster） */

export function safeNodeName(r: unknown): string {
  const row = r as { name?: string; metadata?: { name?: string } };
  return String(row?.name || row?.metadata?.name || '').trim();
}

export function collectNodeRoles(r: unknown): string[] {
  const row = r as {
    roles?: string[];
    metadata?: { labels?: Record<string, string> };
  };
  const base: string[] = (Array.isArray(row?.roles) ? row.roles : []).map((s: string) => {
    if (String(s).startsWith('node-role.kubernetes.io/')) return String(s).split('/').pop() || s;
    return String(s);
  });
  const labels: Record<string, string> = row?.metadata?.labels || {};
  const legacy = String(labels?.['kubernetes.io/role'] || '').trim();
  const extra = Object.keys(labels || {})
    .filter((k) => k.startsWith('node-role.kubernetes.io/'))
    .map((k) => k.split('/').pop() || k);
  return Array.from(
    new Set([...base, ...(legacy ? [legacy] : []), ...extra].map((x) => String(x || '').trim()).filter(Boolean)),
  );
}

export function parseCpuToCoresLoose(s?: string | number): number {
  if (s === undefined || s === null) return 0;
  const t = String(s).trim();
  if (!t) return 0;
  if (/m$/i.test(t)) {
    const v = Number(t.replace(/m$/i, ''));
    return Number.isFinite(v) ? v / 1000 : 0;
  }
  if (/n$/i.test(t)) {
    const v = Number(t.replace(/n$/i, ''));
    return Number.isFinite(v) ? v / 1e9 : 0;
  }
  if (/u$/i.test(t)) {
    const v = Number(t.replace(/u$/i, ''));
    return Number.isFinite(v) ? v / 1e6 : 0;
  }
  const v = Number(t);
  return Number.isFinite(v) ? v : 0;
}

export function parseMemoryToBytesLoose(s?: string | number): number {
  if (s === undefined || s === null) return 0;
  const t = String(s).trim();
  if (!t) return 0;
  const m = t.match(/^(\d+(?:\.\d+)?)([KMGTP]i?)?$/i);
  if (!m) {
    const v = Number(t);
    return Number.isFinite(v) ? v : 0;
  }
  const val = Number(m[1]);
  const unit = (m[2] || '').toLowerCase();
  let bytes = val;
  if (unit === 'ki') bytes = val * 1024;
  else if (unit === 'mi') bytes = val * 1024 * 1024;
  else if (unit === 'gi') bytes = val * 1024 * 1024 * 1024;
  else if (unit === 'ti') bytes = val * 1024 * 1024 * 1024 * 1024;
  else if (unit === 'pi') bytes = val * 1024 * 1024 * 1024 * 1024 * 1024;
  else if (unit === 'k') bytes = val * 1000;
  else if (unit === 'm') bytes = val * 1e6;
  else if (unit === 'g') bytes = val * 1e9;
  else if (unit === 't') bytes = val * 1e12;
  else if (unit === 'p') bytes = val * 1e15;
  return bytes;
}

export function safeJsonParse<T>(raw: unknown): T | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'object') return raw as T;
  const s = String(raw || '').trim();
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

export function formatBytesToGiB(bytesLike: unknown): string {
  const n = Number(bytesLike);
  if (!Number.isFinite(n) || n <= 0) return '';
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}

export function formatCpuToCoresText(cpuLike: unknown): string {
  const s = String(cpuLike ?? '').trim();
  if (!s) return '';
  if (/m$/i.test(s)) {
    const v = Number(s.replace(/m$/i, ''));
    if (!Number.isFinite(v)) return '';
    return `${(v / 1000).toFixed(2)} 核`;
  }
  const v = Number(s);
  if (Number.isFinite(v)) return `${v.toFixed(2)} 核`;
  return '';
}
