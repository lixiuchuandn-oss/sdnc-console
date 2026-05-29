/**
 * 已移除的 FIP 原子权 clouds.fips.{flat|vpc}（角色配置已去掉，库内迁移到同域 EIP）
 */

const OBSOLETE_FIP_TO_EIP: Readonly<Record<string, string>> = {
  'clouds.fips.flat:read': 'clouds.eips.flat:read',
  'clouds.fips.flat:write': 'clouds.eips.flat:write',
  'clouds.fips.vpc:read': 'clouds.eips.vpc:read',
  'clouds.fips.vpc:write': 'clouds.eips.vpc:write',
};

/** 将历史 FIP 原子权迁移为 EIP，并去掉 FIP（保存角色 / 启动迁移用） */
export function expandObsoleteFipsToEips(permissions: string[]): string[] {
  const out = new Set(permissions);
  for (const [from, to] of Object.entries(OBSOLETE_FIP_TO_EIP)) {
    if (out.delete(from)) out.add(to);
  }
  return Array.from(out);
}
