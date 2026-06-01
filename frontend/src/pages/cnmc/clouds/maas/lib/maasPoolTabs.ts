/** MAAS 裸金属资源池 Tab（与侧栏、?tab= 对齐） */
export const MAAS_POOL_TAB_KEYS = [
  'dashboard',
  'machines',
  'discoveries',
  'images',
  'network',
] as const;

export type MaasPoolTabKey = (typeof MAAS_POOL_TAB_KEYS)[number];

/** 已并入概览；保留兼容旧书签 ?tab=settings */
export const MAAS_POOL_TAB_LEGACY_ALIASES: Record<string, MaasPoolTabKey> = {
  settings: 'dashboard',
};
