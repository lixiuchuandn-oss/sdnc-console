/** 打开/保存角色授权时的权限 ID 规范化（SDNC：透传，后端定义为准） */
export function normalizeRoleGrantIds(ids: string[]): string[] {
  return [...ids];
}

export function normalizeRoleGrantForBackendSave(
  ids: string[],
  _backendSupportsSubnetSplit?: boolean,
): string[] {
  return [...ids];
}

export function expandActionAtomsForDrawer(
  actionAtoms: string[],
  _backendSupportsSubnetSplit?: boolean,
): string[] {
  return [...actionAtoms];
}
