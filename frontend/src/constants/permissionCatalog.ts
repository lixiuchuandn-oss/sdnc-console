// ============================================================================
// 权限目录配置 (Permission Catalog Configuration)
// ============================================================================
// 本文件定义了权限资源前缀到元数据的映射关系：
// - 权限前缀 (prefix) -> 显示名称 (label)
// - 权限前缀 (prefix) -> 所属分组 (group)
// - 权限前缀 (prefix) -> 所属平台 (platform)
//
// 【数据来源】
// 1. 后端 API（优先）：从 /api/system/rbac/permissions 获取完整的权限定义
// 2. 回退机制：如果后端数据不可用，使用命名规则推断（向后兼容）
//
// 【与新权限体系的关系】
// - 后端新权限体系：backend/src/permissions/definitions.ts 是权限元数据的单一数据源
// - 前端权限目录：本文件从后端 API 获取权限元数据，确保数据一致性
// - 使用 usePermissionDefinitions hook 来获取后端数据
//
// 【使用位置】
// - components/TreeTransfer.tsx - 权限树形选择器
// - pages/Access/Actions.tsx - 权限动作管理页面
// - pages/Access/Roles.tsx - 角色管理页面
//
// 【注意】
// - 本文件提供的函数是同步的，但实际数据来自异步的 hook
// - 组件中应使用 usePermissionDefinitions hook 直接获取数据
// - 本文件保留用于向后兼容和回退场景
// ============================================================================

import type { Platform, Group } from './navigation';
import { routeSpecs } from '../routes/RouteSpec';
import type { PermissionDefinition } from '../hooks/usePermissionDefinitions';

export type PermissionRouteItem = {
  prefix: string;   // 功能/资源前缀 (通常对应权限 Action 的前缀，如 'clouds.ecs')
  label: string;    // 显示名称 (如 '云主机')
  group: Group;     // 所属分组 (如 '资源控制台')
  platform: Platform; // 所属平台 (如 'CNMC')
};

// ============================================================================
// 1. 从 RouteSpec 自动生成（有路由定义的权限）
// ============================================================================
function generateFromRouteSpecs(): Map<string, PermissionRouteItem> {
  const catalogMap = new Map<string, PermissionRouteItem>();

  routeSpecs.forEach(spec => {
    if (spec.hidden || spec.deprecated) return;

    const actions = spec.requiredActions || {};
    const allActions: string[] = [];
    if (actions.page) allActions.push(actions.page);
    if (actions.read) allActions.push(actions.read);
    if (actions.write) allActions.push(actions.write);

    if (allActions.length === 0) return;

    const platform = spec.platform as Platform | undefined;
    const group = spec.group as Group | undefined;
    const title = spec.title;
    
    if (!platform || !group || !title) return;

    allActions.forEach(action => {
      const prefix = action.split(':')[0];
      if (!catalogMap.has(prefix)) {
        catalogMap.set(prefix, {
          prefix,
          label: title,
          group,
          platform,
        });
      }
    });
  });

  return catalogMap;
}

// ============================================================================
// 2. 命名规则映射（根据权限前缀推断平台和分组）
// ============================================================================
/**
 * 根据权限前缀推断平台
 */
function inferPlatform(prefix: string): Platform {
  // CNMC (多云管理)
  if (prefix.startsWith('clouds.') || prefix.startsWith('clouds:') || 
      prefix.startsWith('ops.') || prefix.startsWith('ops:') ||
      prefix.startsWith('tenants.') || prefix.startsWith('tenants:') ||
      prefix.startsWith('organizations') ||
      prefix.startsWith('users') || prefix.startsWith('user-') ||
      prefix.startsWith('access.') || prefix.startsWith('access:')) {
    return 'CNMC';
  }
  
  // SDNCC (SDN管理)
  if (prefix.startsWith('networks.') || prefix.startsWith('networks:') ||
      prefix.startsWith('security.') || prefix.startsWith('security:') ||
      prefix.startsWith('security.traffic.')) {
    return 'SDNCC';
  }
  
  // CNSOC (AI SOC中心)
  if (prefix.startsWith('secops.') || prefix.startsWith('secops:')) {
    return 'CNSOC';
  }
  
  // SETTINGS (系统设置)
  // system.* 权限（如 system.rbac, system.roles, system.settings）属于 SETTINGS 平台
  if (prefix.startsWith('system.')) {
    return 'SETTINGS';
  }
  if (prefix.startsWith('settings.') || prefix.startsWith('settings:')) {
    return 'SETTINGS';
  }
  
  // 默认返回 CNMC
  return 'CNMC';
}

/**
 * 根据权限前缀推断分组
 * 分组结构按照 RouteSpec 的分组进行组织
 */
function inferGroup(prefix: string, platform: Platform): Group {
  // CNMC 平台 (多云管理)
  if (platform === 'CNMC') {
    // 分组：资源控制台
    if (prefix.startsWith('ops.')) return '资源控制台';
    if (prefix.startsWith('clouds.')) return '资源控制台';
    
    // 分组：租户管理
    if (prefix.startsWith('tenants.') || prefix.startsWith('tenants:') || 
        prefix.startsWith('organizations') ||
        prefix.startsWith('users') || prefix.startsWith('user-')) return '租户管理';
  }
  
  // SETTINGS 平台 (系统设置)
  if (platform === 'SETTINGS') {
    // 分组：权限管控
    if (prefix.startsWith('system.roles') || 
        prefix.startsWith('system.actions') || 
        prefix.startsWith('system.rbac')) return '权限管控';
    
    // 分组：通用设置
    if (prefix === 'system.settings') return '通用设置';
    
    // 分组：操作审计
    if (prefix === 'system.audit') return '操作审计';
    
    // 分组：高级集成
    if (prefix === 'system.integration') return '高级集成';
    
    // 默认：权限管控
    if (prefix.startsWith('system.')) return '权限管控';
  }
  
  // SDNCC 平台 (SDN管理)
  if (platform === 'SDNCC') {
    if (prefix.startsWith('networks.')) {
      // 分组：安全管理面
      if (prefix.includes('cen') || prefix.includes('security-domain')) return '安全管理面';
      // 分组：跨域互联
      return '跨域互联';
    }
    if (prefix.startsWith('security.traffic.')) return '流量编排';
    // 分组：安全管理面
    if (prefix.startsWith('security.')) return '安全管理面';
  }
  
  // CNSOC 平台 (AI SOC中心)
  if (platform === 'CNSOC') {
    // 分组：态势中心
    if (prefix.startsWith('secops.dashboard')) return '态势中心';
    // 分组：威胁综合分析
    if (prefix.startsWith('secops.')) return '威胁综合分析';
  }
  
  // SETTINGS 平台 (系统设置)
  if (platform === 'SETTINGS') {
    if (prefix.startsWith('settings.license')) return '授权管理';
    if (prefix.startsWith('settings.advanced')) return '高级集成';
    if (prefix.startsWith('settings.')) return '通用设置';
  }
  
  // 默认返回"资源控制台"（作为兜底）
  return '资源控制台';
}

/**
 * 根据权限前缀生成友好的显示名称
 */
function inferLabel(prefix: string): string {
  // 移除常见前缀，提取功能名称
  const parts = prefix.split('.');
  const lastPart = parts[parts.length - 1];
  
  // 完整前缀映射（优先级最高，用于特殊情况的完整前缀）
  const fullPrefixMap: Record<string, string> = {
    'clouds.dashboard': '资源总览',
    'ops': '运维平台',
    'system.rbac': 'RBAC 权限管理',
    'system.roles': '角色管理',
    'system.roles.assignments': '角色分配',
    'system.actions': '权限原子',
    'networks.cen': '云企业网 (CEN)',
    'networks.cen.attachments': 'CEN 连接',
    'networks.security-domain': '安全域',
    'networks.srv6': 'SRv6',
    'networks.vr-config': 'VR 配置',
    'networks.acl': '访问控制列表',
    'networks.ipsec': 'IPsecVPN',
    'networks.nat': 'NAT网关',
    'security.services': '安全服务',
    'security.logs': '安全日志',
    'security.policies': '安全策略',
    'security.apps': '安全应用',
    'secops.dashboard': '安全运营仪表盘',
    'secops.alerts': '安全告警',
    'secops.rules': '安全规则',
  };
  
  // 如果完整前缀有映射，直接返回
  if (fullPrefixMap[prefix]) {
    return fullPrefixMap[prefix];
  }
  
  // 常见映射（lastPart 映射）
  const labelMap: Record<string, string> = {
    // 基础资源
    'clouds': '资源池管理',
    'ecs': '云主机',
    'vpcs': 'VPC',
    'eips': '弹性公网IP',
    'disks': '云盘',
    'security-groups': '安全组',
    'load-balancers': '负载均衡',
    'images': '镜像',
    'sshkeys': 'SSH 密钥',
    'nads': 'NAD (网络附件定义)',
    'schedules': '定时备份策略',
    'namespaces': '命名空间',
    'vswitches': '交换机',
    'enis': '弹性网卡',
    'network-acls': '网络ACL',
    'snapshots': '快照',
    'route-entries': '路由条目',
    'nat-gateways': 'NAT网关',
    'route-tables': '路由表',
    'vlans': 'VLAN (L2)',
    'ippools': 'IP 地址池',
    'console': '云主机控制台',
    'dashboard': '仪表盘',
    // 用户与租户
    'users': '组织用户管理',
    'user-spaces': '用户空间',
    'tenants': '租户管理',
    'organizations': '组织管理',
    // 权限管理
    'roles': '角色管理',
    'actions': '权限原子',
    'rbac': 'RBAC 权限管理',
    'assignments': '角色分配',
    // 网络相关
    'cen': '云企业网 (CEN)',
    'attachments': 'CEN 连接',
    'security-domain': '安全域',
    'srv6': 'SRv6',
    'vr-config': 'VR 配置',
    'acl': '访问控制列表',
    'ipsec': 'IPsecVPN',
    'nat': 'NAT网关',
    // 安全服务
    'services': '安全服务',
    'logs': '安全日志',
    'policies': '安全策略',
    'apps': '安全应用',
    // 安全运营
    'alerts': '安全告警',
    'rules': '安全规则',
  };
  
  if (labelMap[lastPart]) {
    return labelMap[lastPart];
  }
  
  // 如果还是没有映射，尝试将 lastPart 转换为友好的中文名称
  // 将连字符和驼峰命名转换为空格，然后首字母大写
  const friendlyName = lastPart
    .replace(/-/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
  
  // 如果转换后的名称和原始 lastPart 相同，说明可能是单个单词，直接返回
  // 否则返回转换后的友好名称
  if (friendlyName === lastPart) {
    // 如果还是找不到，返回前缀本身（但这种情况应该很少）
    return prefix;
  }
  
  return friendlyName;
}

// ============================================================================
// 3. 手动补充（特殊情况）
// ============================================================================
const MANUAL_OVERRIDES: Partial<Record<string, Partial<PermissionRouteItem>>> = {
  'user-spaces': {
    label: '用户空间',
    group: '租户管理',
    platform: 'CNMC',
  },
  // system.* 权限属于 CNMC 平台的权限管控分组
  'system.rbac': {
    label: 'RBAC 权限管理',
    group: '权限管控',
    platform: 'CNMC',
  },
  'system.roles.assignments': {
    label: '角色分配',
    group: '权限管控',
    platform: 'CNMC',
  },
  // 可以在这里添加其他特殊情况的覆盖
};

// ============================================================================
// 合并所有数据源
// ============================================================================
const routeSpecCatalog = generateFromRouteSpecs();
const finalCatalog = new Map<string, PermissionRouteItem>();

// 先添加从 RouteSpec 生成的
routeSpecCatalog.forEach((item, prefix) => {
  finalCatalog.set(prefix, item);
});

// 对于没有在 RouteSpec 中的权限，使用命名规则推断
// 这里我们只提供推断函数，不预先生成所有可能的权限
// 而是在查询时动态推断

export const PERMISSION_CATALOG: PermissionRouteItem[] = Array.from(finalCatalog.values());

// ============================================================================
// 查询函数（动态推断 + 缓存）
// ============================================================================
// 缓存推断结果，避免重复计算
const inferredCache = new Map<string, PermissionRouteItem>();

/**
 * 从后端权限定义转换为前端权限目录项
 */
function definitionToItem(def: PermissionDefinition): PermissionRouteItem {
  const prefix = def.id.split(':')[0];
  return {
    prefix,
    label: def.name,
    group: def.group as Group,
    platform: def.platform as Platform,
  };
}

/**
 * 根据权限资源前缀获取完整的权限目录项信息（回退版本）
 * 当后端数据不可用时，使用命名规则推断（带缓存）
 * 
 * @deprecated 建议使用 usePermissionDefinitions hook 直接获取后端数据
 */
export function getPermissionItem(prefix: string, definitions?: PermissionDefinition[]): PermissionRouteItem {
  // 1. 如果提供了后端定义，优先使用
  if (definitions && definitions.length > 0) {
    // 查找匹配的定义（优先使用 write，如果没有则使用 read）
    const matched = definitions.filter(d => d.id.startsWith(prefix + ':'));
    if (matched.length > 0) {
      // 优先使用 write 权限的定义（通常更完整）
      const writeDef = matched.find(d => d.verb === 'write');
      const def = writeDef || matched[0];
      return definitionToItem(def);
    }
  }
  // 2. 优先从 RouteSpec 生成的目录中查找
  const routeSpecItem = routeSpecCatalog.get(prefix);
  if (routeSpecItem) {
    return routeSpecItem;
  }
  
  // 3. 检查缓存
  const cached = inferredCache.get(prefix);
  if (cached) {
    return cached;
  }
  
  // 4. 检查手动覆盖
  const manualOverride = MANUAL_OVERRIDES[prefix];
  let item: PermissionRouteItem;
  
  if (manualOverride) {
    const platform = manualOverride.platform || inferPlatform(prefix);
    const group = manualOverride.group || inferGroup(prefix, platform);
    const label = manualOverride.label || inferLabel(prefix);
    item = {
      prefix,
      label,
      group,
      platform,
    };
  } else {
    // 5. 使用命名规则推断
    const platform = inferPlatform(prefix);
    const group = inferGroup(prefix, platform);
    const label = inferLabel(prefix);
    item = {
      prefix,
      label,
      group,
      platform,
    };
  }
  
  // 缓存推断结果
  inferredCache.set(prefix, item);
  return item;
}

/**
 * 根据权限资源前缀获取其所属平台（回退版本）
 * 
 * @deprecated 建议使用 usePermissionDefinitions hook 直接获取后端数据
 */
export const platformOf = (prefix: string, definitions?: PermissionDefinition[]): Platform => {
  return getPermissionItem(prefix, definitions).platform;
};

/**
 * 根据权限资源前缀获取其所属分组（回退版本）
 * 
 * @deprecated 建议使用 usePermissionDefinitions hook 直接获取后端数据
 */
export const groupOf = (prefix: string, definitions?: PermissionDefinition[]): Group => {
  return getPermissionItem(prefix, definitions).group;
};

/**
 * 根据权限资源前缀获取其显示名称(Label)（回退版本）
 * 
 * @deprecated 建议使用 usePermissionDefinitions hook 直接获取后端数据
 */
export const featureLabelOf = (prefix: string, definitions?: PermissionDefinition[]): string => {
  return getPermissionItem(prefix, definitions).label;
};

/**
 * 根据权限ID获取权限定义（从后端数据中查找）
 */
export function getPermissionDefinitionById(
  permissionId: string,
  definitions: PermissionDefinition[]
): PermissionDefinition | undefined {
  return definitions.find(d => d.id === permissionId);
}

/**
 * 根据权限前缀获取权限定义列表（从后端数据中查找）
 */
export function getPermissionDefinitionsByPrefix(
  prefix: string,
  definitions: PermissionDefinition[]
): PermissionDefinition[] {
  return definitions.filter(d => d.id.startsWith(prefix + ':'));
}
