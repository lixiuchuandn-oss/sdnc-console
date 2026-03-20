/**
 * 权限定义数据
 * 
 * 将现有的权限字符串转换为完整的权限定义，包含元数据和 API 映射
 */

import { PermissionDefinition } from './types';
import { ALL_PERMISSIONS, PERMISSION_GROUPS, getPlatformByPermission, getGroupByPermission } from '../constants/permissions';

/**
 * 权限名称映射（用于生成显示名称）
 */
const PERMISSION_NAMES: Record<string, string> = {
  // CNMC - 资源控制台
  'clouds.dashboard': '资源总览',
  'clouds': '资源池管理',
  'clouds.ecs': '云主机管理',
  'clouds.vpcs': '虚拟私有云',
  'clouds.eips': '弹性公网IP',
  'clouds.disks': '云硬盘',
  'clouds.security-groups': '安全组',
  'clouds.load-balancers': '负载均衡',
  'clouds.images': '镜像管理',
  'clouds.sshkeys': 'SSH密钥',
  'clouds.nads': '网络附加定义',
  'clouds.schedules': '定时任务',
  'clouds.namespaces': '命名空间',
  'clouds.vswitches': '虚拟交换机',
  'clouds.enis': '弹性网卡',
  'clouds.network-acls': '网络ACL',
  'clouds.snapshots': '快照',
  'clouds.route-tables': '路由表',
  'clouds.route-entries': '路由条目',
  'clouds.nat-gateways': 'NAT网关',
  'clouds.vlans': 'VLAN网络',
  'clouds.ippools': 'IP地址池',
  'clouds.console': '云主机控制台',
  
  // CNMC - 租户管理
  'tenants': '租户管理',
  'organizations': '组织管理',
  'tenant-users': '组织用户管理',
  'users': '用户管理',
  'user-spaces': '用户空间管理',
  
  // CNMC - 权限管控
  'system.roles': '角色管理',
  'system.roles.assignments': '角色分配',
  'system.actions': '权限动作',
  'system.rbac': 'RBAC管理',
  'system.audit': '操作审计',
  'system.settings': '界面设置',
  'system.license': '授权管理',
  'system.integration': '高级集成',
  
  // SDNCC - 安全管理面
  'networks.security-domain': '安全域',
  'networks.cen': '云企业网',
  'networks.cen.attachments': 'CEN连接',
  'security.services': '安全服务',
  'security.apps': '安全应用',
  
  // SDNCC - 跨域互联
  'networks.srv6': 'SRv6网络',
  'networks.vr-config': 'VR配置',
  'networks.acl': '访问控制列表',
  'networks.ipsec': 'IPsecVPN',
  'networks.nat': 'NAT网关',
  
  // CNSOC - 态势中心
  'secops.dashboard': '安全态势总览',
  'secops.alerts': '安全告警',
  'secops.rules': '安全规则',
};

/**
 * 权限描述映射
 */
const PERMISSION_DESCRIPTIONS: Record<string, string> = {
  'clouds.dashboard:read': '查看资源总览页面',
  'clouds.dashboard:write': '编辑资源总览配置',
  'clouds:read': '查看资源池列表',
  'clouds:write': '创建、编辑、删除资源池',
  'clouds.ecs:read': '查看云主机列表和详情',
  'clouds.ecs:write': '创建、启动、停止、删除云主机',
  'clouds.console:read': '访问云主机控制台',
  'clouds.console:write': '在云主机控制台中执行操作',
  'tenants:read': '查看租户列表',
  'tenants:write': '创建、编辑、删除租户',
  'organizations:read': '查看组织架构树',
  'organizations:write': '创建、编辑、删除组织，管理组织下的用户和资源分配',
  'tenant-users:read': '查看租户组织用户列表',
  'tenant-users:write': '创建、编辑、删除租户组织用户，重置密码',
  'users:read': '查看系统用户列表',
  'users:write': '创建、编辑、删除系统用户，重置密码',
  'system.roles:read': '查看角色列表',
  'system.roles:write': '创建、编辑、删除角色',
  
  // SDNCC - 跨域互联
  'networks.vr-config:read': '查看 VR 实例列表',
  'networks.vr-config:write': '创建、编辑、删除 VR 实例',
  'networks.ipsec:read': '查看 IPsec VPN 连接列表',
  'networks.ipsec:write': '创建、编辑、删除 IPsec VPN 连接',
  'networks.nat:read': '查看 NAT 网关列表',
  'networks.nat:write': '创建、编辑、删除 NAT 网关规则',
};

/**
 * 生成权限的 API 路径模式
 * 
 * 注意：不再硬编码 API 路径，改为完全依赖路径推断机制
 * 路径推断在 registry.ts 的 resolveFromApi 中实现
 */
function generateApiPatterns(permissionId: string): Array<{ method: string; pathPattern: string }> {
  // 不再硬编码，完全依赖路径推断
  return [];
}

/**
 * 生成权限定义
 */
function generatePermissionDefinition(permissionId: string): PermissionDefinition {
  const [base, verb] = permissionId.split(':');
  if (!base || !verb) {
    throw new Error(`Invalid permission format: ${permissionId}`);
  }

  const platform = getPlatformByPermission(permissionId) as 'CNMC' | 'SDNCC' | 'CNSOC' | 'SETTINGS' | null;
  const group = getGroupByPermission(permissionId);

  // 生成显示名称
  const baseName = PERMISSION_NAMES[base] || base;
  const verbName = verb === 'read' ? '查看' : verb === 'write' ? '管理' : verb;
  const name = `${baseName}${verbName === '查看' ? '' : '-' + verbName}`;

  // 获取描述
  const description = PERMISSION_DESCRIPTIONS[permissionId] || `${name}权限`;

  // 确定分类
  let category = 'general';
  if (base.startsWith('clouds.ecs') || base === 'clouds.console') {
    category = 'compute';
  } else if (base.includes('network') || base.includes('vpc') || base.includes('vswitch')) {
    category = 'network';
  } else if (base.includes('disk') || base.includes('snapshot')) {
    category = 'storage';
  } else if (base.startsWith('system.') || base.startsWith('tenants') || base.startsWith('users')) {
    category = 'management';
  }

  // 生成继承关系
  const inherits: string[] = [];
  
  // 层级继承：clouds.ecs:read 继承 clouds:read
  if (base.includes('.') && base !== 'clouds.console') {
    const segments = base.split('.');
    if (segments.length >= 2) {
      const parentBase = segments[0];
      const parentPerm = `${parentBase}:${verb}`;
      if (ALL_PERMISSIONS.includes(parentPerm as any)) {
        inherits.push(parentPerm);
      }
    }
  }

  // write 权限继承 read 权限
  if (verb === 'write') {
    const readPerm = `${base}:read`;
    if (ALL_PERMISSIONS.includes(readPerm as any)) {
      inherits.push(readPerm);
    }
  }

  // 如果无法识别平台，使用默认值（向后兼容）
  // 注意：这不应该发生，但如果发生了，使用 CNMC 作为默认值
  const finalPlatform = platform || 'CNMC';
  
  // 如果无法识别分组，使用默认值
  const finalGroup = group || '其他';

  return {
    id: permissionId,
    name,
    description,
    platform: finalPlatform,
    group: finalGroup,
    category,
    verb: verb as 'read' | 'write',
    inherits: inherits.length > 0 ? inherits : undefined,
    // 不再生成硬编码的 apiPatterns，完全依赖路径推断
    apiPatterns: undefined,
  };
}

/**
 * 所有权限定义
 */
export const PERMISSION_DEFINITIONS: PermissionDefinition[] = ALL_PERMISSIONS.map(perm => 
  generatePermissionDefinition(perm as string)
);
