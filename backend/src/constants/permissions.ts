/**
 * SDNC 权限原子（Single Source of Truth）
 *
 * 默认产品形态仅 IBR 管理 + 系统设置；不含 CNMC / 租户管理 UI 权限。
 * 数据流：constants/permissions.ts → permissions/definitions.ts → registry / checker
 */

/** 所有权限原子 */
export const ALL_PERMISSIONS = [
  // SETTINGS — 权限管控
  'users:read',
  'users:write',
  'system.roles:read',
  'system.roles:write',
  'system.roles.assignments:read',
  'system.roles.assignments:write',
  'system.actions:read',
  'system.actions:write',
  'system.rbac:read',
  'system.rbac:write',
  // SETTINGS — 通用 / 审计 / 集成 / 升级 / 授权
  'system.settings:read',
  'system.settings:write',
  'system.audit:read',
  'system.audit:write',
  'system.upgrade:read',
  'system.upgrade:write',
  'system.integration:read',
  'system.integration:write',

  // SDNCC — IBR 管理（跨域互联）
  'networks.vr-config:read',
  'networks.vr-config:write',
  'networks.srv6:read',
  'networks.srv6:write',
  'networks.ipsec:read',
  'networks.ipsec:write',
  'networks.acl:read',
  'networks.acl:write',
  'networks.nat:read',
  'networks.nat:write',
] as const;

export const PERMISSION_GROUPS = {
  SETTINGS: {
    权限管控: [
      'system.roles',
      'system.roles.assignments',
      'system.actions',
      'system.rbac',
      'users',
    ],
    通用设置: ['system.settings'],
    版本升级: ['system.upgrade'],
    操作审计: ['system.audit'],
    高级集成: ['system.integration'],
  },
  SDNCC: {
    IBR管理: [
      'networks.vr-config',
      'networks.srv6',
      'networks.ipsec',
      'networks.acl',
      'networks.nat',
    ],
  },
} as const;

export function getPlatformByPermission(permission: string): string | null {
  const prefix = permission.split(':')[0];
  if (prefix.startsWith('system.') || prefix.startsWith('users')) {
    return 'SETTINGS';
  }
  if (prefix.startsWith('networks.')) {
    return 'SDNCC';
  }
  return null;
}

export function getGroupByPermission(permission: string): string | null {
  const prefix = permission.split(':')[0];

  if (prefix === 'system.settings') {
    return '通用设置';
  }
  if (prefix === 'system.integration') {
    return '高级集成';
  }
  if (prefix === 'system.upgrade') {
    return '版本升级';
  }
  if (prefix === 'system.audit') {
    return '操作审计';
  }
  if (prefix.startsWith('system.') || prefix.startsWith('users')) {
    return '权限管控';
  }

  if (
    prefix.startsWith('networks.vr-config') ||
    prefix.startsWith('networks.srv6') ||
    prefix.startsWith('networks.acl') ||
    prefix.startsWith('networks.ipsec') ||
    prefix.startsWith('networks.nat')
  ) {
    return 'IBR管理';
  }

  return null;
}
