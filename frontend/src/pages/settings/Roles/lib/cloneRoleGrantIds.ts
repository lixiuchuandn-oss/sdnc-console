import type { RBACRole } from '../types';
import { normalizeRoleGrantIds } from './roleGrantNormalize';

/** 从源角色解析权限原子，供复制后赋权抽屉初始勾选 */
export function cloneRoleGrantIds(source: RBACRole): string[] {
  return normalizeRoleGrantIds(source.actions || []);
}
