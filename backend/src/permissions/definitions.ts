/**
 * SDNC 权限定义（由 ALL_PERMISSIONS 生成元数据）
 */

import { PermissionDefinition } from './types';
import {
  ALL_PERMISSIONS,
  getPlatformByPermission,
  getGroupByPermission,
} from '../constants/permissions';

const PERMISSION_NAMES: Record<string, string> = {
  users: '用户管理',
  'system.roles': '角色管理',
  'system.roles.assignments': '授予用户',
  'system.actions': '配置权限',
  'system.rbac': 'RBAC管理',
  'system.audit': '操作审计',
  'system.settings': '界面设置',
  'system.upgrade': '离线版本升级',
  'system.integration': '高级集成',
  'networks.vr-config': 'IBR实例',
  'networks.srv6': 'SRv6隧道',
  'networks.ipsec': 'IPsecVPN',
  'networks.acl': 'ACL访问控制',
  'networks.nat': 'NAT网关',
};

const PERMISSION_DESCRIPTIONS: Record<string, string> = {
  'users:read': '查看系统用户列表',
  'users:write': '创建、编辑、删除系统用户',
  'system.roles:read': '查看角色列表',
  'system.roles:write': '创建、编辑、删除角色',
  'system.upgrade:read': '查看当前运行版本与最近一次离线升级记录',
  'system.upgrade:write': '上传离线 zip 包并合并 public/server 进行版本更新',
  'networks.vr-config:read': '查看 IBR 实例列表',
  'networks.vr-config:write': '创建、编辑、删除 IBR 实例',
  'networks.srv6:read': '查看 SRv6 隧道列表',
  'networks.srv6:write': '创建、编辑、删除 SRv6 隧道',
  'networks.ipsec:read': '查看 IPsec VPN 连接列表',
  'networks.ipsec:write': '创建、编辑、删除 IPsec VPN 连接',
  'networks.acl:read': '查看 ACL 规则',
  'networks.acl:write': '创建、编辑、删除 ACL 规则',
  'networks.nat:read': '查看 NAT 规则',
  'networks.nat:write': '创建、编辑、删除 NAT 规则',
};

function generatePermissionDefinition(permissionId: string): PermissionDefinition {
  const [base, verb] = permissionId.split(':');
  if (!base || !verb) {
    throw new Error(`Invalid permission format: ${permissionId}`);
  }

  const platform = (getPlatformByPermission(permissionId) || 'SETTINGS') as
    | 'SDNCC'
    | 'SETTINGS';
  const group = getGroupByPermission(permissionId) || '其他';

  const baseName = PERMISSION_NAMES[base] || base;
  const verbName = verb === 'read' ? '查看' : verb === 'write' ? '管理' : verb;
  const name = `${baseName}${verbName === '查看' ? '' : '-' + verbName}`;
  const description = PERMISSION_DESCRIPTIONS[permissionId] || `${name}权限`;

  let category = 'management';
  if (base.startsWith('networks.')) {
    category = 'network';
  }

  const inherits: string[] = [];
  if (verb === 'write') {
    const readPerm = `${base}:read`;
    if (ALL_PERMISSIONS.includes(readPerm as (typeof ALL_PERMISSIONS)[number])) {
      inherits.push(readPerm);
    }
  }

  return {
    id: permissionId,
    name,
    description,
    platform,
    group,
    category,
    verb: verb as 'read' | 'write',
    inherits: inherits.length > 0 ? inherits : undefined,
    apiPatterns: undefined,
  };
}

export const PERMISSION_DEFINITIONS: PermissionDefinition[] = ALL_PERMISSIONS.map((perm) =>
  generatePermissionDefinition(perm as string),
);
