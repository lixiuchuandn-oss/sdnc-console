// ============================================================================
// 权限目录配置 (Permission Catalog Configuration)
// ============================================================================
// 本文件定义了权限资源前缀到元数据的映射关系：
// - 权限前缀 (prefix) -> 显示名称 (label)
// - 权限前缀 (prefix) -> 所属分组 (group)
// - 权限前缀 (prefix) -> 所属平台 (platform)
//
// 数据来源优先级：
// 1. RouteSpec（有路由定义的权限，包含完整信息）
// 2. 命名规则映射（根据权限前缀推断平台和分组）
// 3. 手动补充（特殊情况的权限）
// ============================================================================

import type { Platform, Group } from './navigation';
import { routeSpecs } from '../routes/RouteSpec';

export type PermissionRouteItem = {
  prefix: string;   // 功能/资源前缀 (通常对应权限 Action 的前缀，如 'clouds.instances')
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
  if (prefix.startsWith('settings.') || prefix.startsWith('settings:') ||
      prefix.startsWith('system.')) {
    return 'SETTINGS';
  }
  
  // 默认返回 CNMC
  return 'CNMC';
}

/**
 * 根据权限前缀推断分组
 */
function inferGroup(prefix: string, platform: Platform): Group {
  // CNMC 平台
  if (platform === 'CNMC') {
    if (prefix.startsWith('ops.')) return '资源控制台';
    if (prefix.startsWith('clouds.')) return '资源控制台';
    if (prefix.startsWith('tenants.') || prefix.startsWith('tenants:') || 
        prefix.startsWith('users') || prefix.startsWith('user-')) return '租户管理';
    if (prefix.startsWith('access.')) return '权限管控';
  }
  
  // SDNCC 平台
  if (platform === 'SDNCC') {
    if (prefix.startsWith('networks.')) {
      if (prefix.includes('cen') || prefix.includes('security-domain')) return '安全管理面';
      return '跨域互联';
    }
    if (prefix.startsWith('security.traffic.')) return '流量编排';
    if (prefix.startsWith('security.')) return '安全管理面';
  }
  
  // CNSOC 平台
  if (platform === 'CNSOC') {
    if (prefix.startsWith('secops.dashboard')) return '态势中心';
    if (prefix.startsWith('secops.')) return '威胁综合分析';
  }
  
  // SETTINGS 平台
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
  
  // 常见映射
  const labelMap: Record<string, string> = {
    'instances': '云主机',
    'vpcs': 'VPC',
    'eips': '弹性公网IP',
    'disks': '云盘',
    'security-groups': '安全组',
    'load-balancers': '负载均衡',
    'images': '镜像',
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
    'users': '子用户管理',
    'user-spaces': '用户空间',
    'roles': '角色管理',
    'actions': '权限原子',
  };
  
  if (labelMap[lastPart]) {
    return labelMap[lastPart];
  }
  
  // 如果没有映射，返回前缀本身
  return prefix;
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
 * 根据权限资源前缀获取完整的权限目录项信息
 * 如果 RouteSpec 中没有，则根据命名规则推断（带缓存）
 */
export function getPermissionItem(prefix: string): PermissionRouteItem {
  // 1. 优先从 RouteSpec 生成的目录中查找
  const routeSpecItem = routeSpecCatalog.get(prefix);
  if (routeSpecItem) {
    return routeSpecItem;
  }
  
  // 2. 检查缓存
  const cached = inferredCache.get(prefix);
  if (cached) {
    return cached;
  }
  
  // 3. 检查手动覆盖
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
    // 4. 使用命名规则推断
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
 * 根据权限资源前缀获取其所属平台
 */
export const platformOf = (prefix: string): Platform => {
  return getPermissionItem(prefix).platform;
};

/**
 * 根据权限资源前缀获取其所属分组
 */
export const groupOf = (prefix: string): Group => {
  return getPermissionItem(prefix).group;
};

/**
 * 根据权限资源前缀获取其显示名称(Label)
 */
export const featureLabelOf = (prefix: string): string => {
  return getPermissionItem(prefix).label;
};
