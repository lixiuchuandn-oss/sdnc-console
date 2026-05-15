/**
 * 安全域 `category` 单字段：格式 `kind:子类`，与 backend/src/utils/securityDomainKind.ts 保持一致。
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

export function formatCategoryLabel(raw?: string | null): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  const i = s.indexOf(':');
  if (i >= 0) return s.slice(i + 1).trim() || s;
  if (s === 'vpc' || s === 'flat' || s === 'container') return s;
  return s;
}

/**
 * 新建/编辑类型（与提交存库 `category` 单字段一致）。
 * 说明：子类仅用于展示与归一化；`getDomainKindFromCategory` 只看 `kind` 段。
 */
export const SECURITY_DOMAIN_CATEGORY_VALUE_OPTIONS: { value: string; label: string }[] = [
  { value: 'vpc:VPC网络', label: 'VPC网络' },
  { value: 'flat:扁平网络(资源池)', label: '扁平网络' },
  { value: 'container:容器网络', label: '容器网络' },
  { value: 'flat:自定义网络', label: '自定义网络' },
];

/** 是否「自定义网段」类扁平网络（不强制归属资源池） */
export function isFlatCustomNetworkCategory(raw?: string | null): boolean {
  const s = String(raw || '').trim();
  if (getDomainKindFromCategory(s) !== 'flat') return false;
  const i = s.indexOf(':');
  const sub = i >= 0 ? s.slice(i + 1).trim() : s;
  if (sub === '自定义网络') return true;
  if (sub.includes('资源池')) return false;
  return /自定义/.test(sub);
}

/**
 * 将历史 category 值映射为当前 4 类下拉的 value，供编辑回显
 */
export function normalizeCategoryForForm(raw?: string | null): string {
  const c = String(raw || '').trim();
  if (!c) return c;
  const k = getDomainKindFromCategory(c);
  if (k === 'vpc') return 'vpc:VPC网络';
  if (k === 'container') return 'container:容器网络';
  if (k === 'flat') {
    if (isFlatCustomNetworkCategory(c)) return 'flat:自定义网络';
    return 'flat:扁平网络(资源池)';
  }
  return c;
}
