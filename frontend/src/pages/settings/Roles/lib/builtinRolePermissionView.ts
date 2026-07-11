import type { RBACRole } from '../types';

/** 系统预置角色（type=系统策略）：不可删除、不可改名、不可改权限 */
export function isBuiltInRbacRole(
  role: Partial<Pick<RBACRole, 'type' | 'name'>> | null | undefined,
): boolean {
  return role?.type === '系统策略';
}
