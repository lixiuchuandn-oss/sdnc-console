/**
 * 安全域 `category` 单字段：格式 `kind:子类`（如 `vpc:公有云VPC网络`），兼容旧值纯 `vpc` / `flat` / `container`。
 */

export type SecurityDomainKind = 'vpc' | 'flat' | 'container' | 'unbound';

const HEAD = (raw: string) => {
  const s = String(raw || '').trim();
  if (!s) return '';
  const i = s.indexOf(':');
  return (i >= 0 ? s.slice(0, i) : s).toLowerCase().trim();
};

export function getDomainKindFromCategory(raw?: string | null): SecurityDomainKind {
  const s = String(raw || '').trim();
  if (!s) return 'unbound';
  const h = HEAD(s);
  if (h === 'vpc' || s === 'vpc') return 'vpc';
  if (h === 'flat' || s === 'flat') return 'flat';
  if (h === 'container' || s === 'container') return 'container';
  return 'unbound';
}

/** 展示用：去掉 kind 前缀，只显示子类文案 */
export function formatCategoryLabel(raw?: string | null): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  const i = s.indexOf(':');
  if (i >= 0) return s.slice(i + 1).trim() || s;
  if (s === 'vpc' || s === 'flat' || s === 'container') return s;
  return s;
}

export function isContainerCategory(raw?: string | null): boolean {
  return getDomainKindFromCategory(raw) === 'container';
}
