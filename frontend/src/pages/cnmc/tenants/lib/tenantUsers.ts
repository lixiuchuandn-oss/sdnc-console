export interface TenantUser {
  id: string;
  username: string;
  email: string;
  fullName: string;
  /** 历史字段，多为占位 `user`；真实 RBAC 角色见 rbacRoles */
  role: string;
  /** 来自 /api/users/tenant-users 聚合的租户 RBAC 角色 */
  rbacRoles?: Array<{ id: string; name: string; scope?: string }>;
  status: 'active' | 'inactive';
  createdAt: string;
  tenant: {
    id: string;
    name: string;
    description?: string;
  } | null;
  organization: {
    id: string;
    name: string;
    level: number;
  } | null;
}

export interface RBACRole {
  id: string;
  name: string;
  description: string;
  status: 'active' | 'inactive';
  type: 'system' | 'custom';
  scope?: 'system' | 'tenant';
}

export interface Assignment {
  id: string;
  roleId: string;
  userId: string;
}

export interface CreateUserFormValues {
  username: string;
  email: string;
  password: string;
  tenantId: string;
  organizationId?: string;
  role: string;
}

/** 列表展示用：优先接口返回的 rbacRoles，否则用目录匹配旧 role 占位字段 */
export function displayRolesForTenantUser(
  record: TenantUser,
  roleCatalog: RBACRole[],
): Array<{ id: string; name: string; scope?: string }> {
  const api = Array.isArray(record.rbacRoles) ? record.rbacRoles.filter((x) => x?.id && x?.name) : [];
  if (api.length > 0) return api;
  const raw = String(record.role || '').trim();
  if (!raw || raw === 'user') return [];
  const hit = roleCatalog.find((r) => r.id === raw || r.name === raw);
  if (hit) return [{ id: hit.id, name: hit.name, scope: hit.scope }];
  const looksUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw);
  return looksUuid ? [{ id: raw, name: `${raw.slice(0, 8)}…` }] : [{ id: raw, name: raw }];
}
