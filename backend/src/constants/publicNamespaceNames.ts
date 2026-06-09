/**
 * 无 `tower.io/scenario=public` 标签时仍视为「公共项目」的命名空间（与前端 `harvesterUtils.isPublicNamespace` 对齐）
 */
export const LEGACY_PUBLIC_NAMESPACE_NAMES = [
  'cloud-public',
  'default',
  'harvester-public',
  'log-audit-system',
  'compute-tower-system',
] as const;

const LEGACY_PUBLIC_NAMESPACE_NAME_SET = new Set<string>(
  LEGACY_PUBLIC_NAMESPACE_NAMES.map((n) => n.toLowerCase()),
);

export function isLegacyPublicNamespaceName(name: string): boolean {
  return LEGACY_PUBLIC_NAMESPACE_NAME_SET.has(String(name || '').trim().toLowerCase());
}
