/** 创建/编辑存储池表单：人类可读容量、配额换算（对齐 Ceph Dashboard 行为） */

export const QUOTA_UNIT_OPTIONS = ['GiB', 'MiB', 'TiB', 'KiB', 'B'] as const;
export type QuotaUnit = (typeof QUOTA_UNIT_OPTIONS)[number];

const UNIT_TO_BYTES: Record<QuotaUnit, number> = {
  B: 1,
  KiB: 1024,
  MiB: 1024 ** 2,
  GiB: 1024 ** 3,
  TiB: 1024 ** 4,
};

/** 将「数值 + 单位」转为字节；无效则 undefined（表示不设置配额） */
export function quotaBytesFromAmountAndUnit(
  amount: number | null | undefined,
  unit: string | undefined,
): number | undefined {
  if (amount == null || !Number.isFinite(amount) || amount <= 0) return undefined;
  const u = (UNIT_TO_BYTES as Record<string, number>)[unit || 'GiB'];
  if (!u) return undefined;
  return Math.floor(amount * u);
}

/** 字节拆成展示用数量+单位（编辑回填） */
export function bytesToQuotaAmountAndUnit(bytes: unknown): { amount: number | null; unit: QuotaUnit } {
  const n = typeof bytes === 'number' ? bytes : Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return { amount: null, unit: 'GiB' };
  if (n % 1024 ** 3 === 0) return { amount: n / 1024 ** 3, unit: 'GiB' };
  if (n % 1024 ** 2 === 0) return { amount: n / 1024 ** 2, unit: 'MiB' };
  if (n % 1024 === 0) return { amount: n / 1024, unit: 'KiB' };
  return { amount: n, unit: 'B' };
}

/** 解析「10 GiB」「128KiB」等为字节（压缩 blob 占位符） */
export function parseHumanDataSizeToBytes(input: string): number | null {
  const s = input.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s) return null;
  const m = /^(\d+(?:\.\d+)?)\s*([a-z]+)$/i.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 0) return null;
  const u = m[2].toLowerCase();
  const map: Record<string, number> = {
    b: 1,
    kib: 1024,
    kb: 1000,
    mib: 1024 ** 2,
    mb: 1000 ** 2,
    gib: 1024 ** 3,
    gb: 1000 ** 3,
    tib: 1024 ** 4,
    tb: 1000 ** 4,
  };
  const mult = map[u];
  if (!mult) return null;
  return Math.floor(n * mult);
}

export function crushRuleOptionLabel(rule: { rule_name?: string; name?: string }): string {
  return String(rule.rule_name ?? rule.name ?? '').trim();
}
