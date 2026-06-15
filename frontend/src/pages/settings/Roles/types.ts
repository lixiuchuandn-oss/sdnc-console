export type RBACRole = {
  id: string;
  name: string;
  description?: string;
  scope: 'system' | 'tenant';
  permissions?: string;
  actions?: string[];
  type?: '系统策略' | '自定义策略';
  status: 'active' | 'inactive';
  createdAt?: string;
  updatedAt?: string;
  grantedUserCount?: number;
};

export type SysUser = {
  id: string;
  username: string;
  email: string;
  fullName: string;
  role: 'super_admin' | 'admin' | 'tenant';
  status: 'active' | 'inactive' | 'suspended';
  createdAt?: string;
  builtIn?: boolean;
  tenant?: { id: string; name: string } | null;
  organization?: { id: string; name: string } | null;
};

export type RbacAssignmentUserType = 'system' | 'tenant';

/** 与 RBAC 分配、角色 scope 一致的用户类型 */
export function rbacUserTypeForRole(role: Pick<RBACRole, 'scope'>): RbacAssignmentUserType {
  return role.scope === 'tenant' ? 'tenant' : 'system';
}

export type Assignment = {
  id: string;
  roleId: string;
  userType: 'system' | 'tenant';
  userId: string;
  createdAt: string;
};
