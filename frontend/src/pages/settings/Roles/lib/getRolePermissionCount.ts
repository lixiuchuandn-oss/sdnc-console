import type { RBACRole } from '../types';

export function getRolePermissionCount(row: RBACRole): number {
  if (Array.isArray(row.actions) && row.actions.length > 0) {
    return row.actions.length;
  }
  try {
    const p = JSON.parse(String(row.permissions || '[]'));
    return Array.isArray(p) ? p.length : 0;
  } catch {
    return 0;
  }
}
