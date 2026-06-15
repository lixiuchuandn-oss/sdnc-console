import { apiRequest } from '../../../../services/api';
import type { Assignment, RBACRole, RbacAssignmentUserType, SysUser } from '../types';
import { rbacUserTypeForRole } from '../types';

export type RoleAssignUsersLoadResult = {
  userType: RbacAssignmentUserType;
  users: SysUser[];
  roles: RBACRole[];
  allAssignments: Assignment[];
  roleAssignments: Assignment[];
};

export function filterAssignableUsers(users: SysUser[], userType: RbacAssignmentUserType): SysUser[] {
  return users.filter((u) => {
    if (u.status !== 'active') return false;
    if (userType === 'system' && u.username === 'admin') return false;
    return true;
  });
}

async function fetchAssignableUsers(userType: RbacAssignmentUserType): Promise<SysUser[]> {
  if (userType === 'tenant') {
    const json = await apiRequest('/api/users/tenant-users', { skipCache: true });
    return Array.isArray(json) ? json : [];
  }
  const json = await apiRequest('/api/users', { skipCache: true });
  if (Array.isArray(json)) return json;
  if (Array.isArray((json as { users?: SysUser[] })?.users)) {
    return (json as { users: SysUser[] }).users;
  }
  return [];
}

function chunkUserIds(ids: string[], size = 400): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    out.push(ids.slice(i, i + size));
  }
  return out;
}

async function fetchAssignmentsByUsers(
  userType: RbacAssignmentUserType,
  userIds: string[],
): Promise<Assignment[]> {
  if (!userIds.length) return [];
  const chunks = chunkUserIds(userIds);
  const merged: Assignment[] = [];
  for (const part of chunks) {
    const json = await apiRequest(
      `/api/system/rbac/assignments/by-users?userType=${encodeURIComponent(userType)}&userIds=${encodeURIComponent(part.join(','))}`,
      { skipCache: true },
    );
    const rows = Array.isArray((json as { assignments?: Assignment[] })?.assignments)
      ? (json as { assignments: Assignment[] }).assignments
      : [];
    merged.push(...rows);
  }
  return merged;
}

export async function loadRoleAssignUsersData(role: RBACRole): Promise<RoleAssignUsersLoadResult> {
  const userType = rbacUserTypeForRole(role);
  const usersList = await fetchAssignableUsers(userType);
  const activeUsers = filterAssignableUsers(usersList, userType);
  const activeUserIds = activeUsers.map((u) => String(u.id));

  const rolesJson = await apiRequest('/api/system/rbac/roles', { skipCache: true });
  const rolesList: RBACRole[] = Array.isArray(rolesJson)
    ? rolesJson
    : Array.isArray((rolesJson as { roles?: RBACRole[] })?.roles)
      ? (rolesJson as { roles: RBACRole[] }).roles
      : [];

  const assignmentsJson = await apiRequest(
    `/api/system/rbac/assignments/by-role?roleId=${encodeURIComponent(role.id)}&userType=${encodeURIComponent(userType)}`,
    { skipCache: true },
  );
  const roleAssignments: Assignment[] = Array.isArray(
    (assignmentsJson as { assignments?: Assignment[] })?.assignments,
  )
    ? (assignmentsJson as { assignments: Assignment[] }).assignments
    : [];

  let allAssignments: Assignment[] = [];
  try {
    allAssignments = await fetchAssignmentsByUsers(userType, activeUserIds);
  } catch {
    allAssignments = [];
  }

  return {
    userType,
    users: usersList,
    roles: rolesList,
    allAssignments,
    roleAssignments,
  };
}
