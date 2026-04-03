import { TOWER_ALIAS_ANNOTATION } from './underlay-subnet/constants';

/** 列表/下拉展示：优先注解 tower.io/alias，否则 metadata.name */
export function ovnDisplayName(record: any): string {
  const alias = String(record?.metadata?.annotations?.[TOWER_ALIAS_ANNOTATION] ?? '').trim();
  if (alias) return alias;
  return String(record?.metadata?.name ?? '—');
}

/** 关键字筛选：同时匹配资源名与别名 */
export function ovnKeywordMatches(record: any, kwLower: string): boolean {
  const name = String(record?.metadata?.name ?? '').toLowerCase();
  const alias = String(record?.metadata?.annotations?.[TOWER_ALIAS_ANNOTATION] ?? '')
    .trim()
    .toLowerCase();
  return name.includes(kwLower) || (alias.length > 0 && alias.includes(kwLower));
}

/** 列表「名称」列：有别名时主显别名、次显 metadata.name */
export function ovnPrimarySecondaryName(record: any): { primary: string; secondary: string } {
  const tech = String(record?.metadata?.name ?? '').trim() || '—';
  const alias = String(record?.metadata?.annotations?.[TOWER_ALIAS_ANNOTATION] ?? '').trim();
  if (alias) return { primary: alias, secondary: tech };
  return { primary: tech, secondary: '' };
}
