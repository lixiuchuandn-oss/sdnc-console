import { ReactNode } from 'react';

// ============================================================================
// 导航与功能目录配置 (Navigation & Feature Catalog)
// ============================================================================
// 本文件定义了平台(Platform)、分组(Group)以及功能模块(Feature/Route)的元数据。
// 主要用于：
// 1. 侧边栏(Sidebar)的分组排序与展示逻辑 (via GROUPS, PLATFORMS)
// 2. 权限管控(Access Control)中的资源与功能名称映射 (via ROUTE_CATALOG)
//
// 注意：实际的路由定义(Route Definition)在 src/routes/RouteSpec.ts 中。
// 本文件的 ROUTE_CATALOG 更多关注于“功能模块”或“权限资源”的逻辑分类与命名，
// 而非具体的 URL 路由路径。
// ============================================================================

export type Platform = 'CNMC' | 'SDNCC' | 'CNSOC' | '全部';

export type Group = 
  | '资源控制台' 
  | '租户管理' 
  | '售卖管理' 
  | '权限管控' 
  | '流量编排' 
  | '跨地域互联' 
  | '安全管理面' 
  | '安全运营' 
  | '安全控制台' 
  | '可信数据空间' 
  | '威胁数据预处理' 
  | '态势中心' 
  | '数据预处理' 
  | '威胁综合分析' 
  | '安全报告' 
  | '全部';

// 平台列表定义
export const PLATFORMS: Platform[] = ['全部', 'CNMC', 'SDNCC', 'CNSOC'];

// 平台显示名称映射
export const PLATFORM_LABELS: Record<Platform, string> = {
  'CNMC': '多云管理',
  'SDNCC': 'SDN管理',
  'CNSOC': 'AI SOC中心',
  '全部': '全部'
};

// 分组排序定义 (Sidebar 使用此顺序渲染分组)
export const GROUPS: Group[] = [
  '全部',
  '资源控制台',
  '租户管理',
  '售卖管理',
  '权限管控',
  '安全管理面',
  '跨地域互联',
  '流量编排',
  '安全运营',
  '安全控制台',
  '可信数据空间',
  '威胁数据预处理',
  '态势中心',
  '数据预处理',
  '威胁综合分析',
  '安全报告'
];

export type RouteItem = {
  prefix: string;   // 功能/资源前缀 (通常对应权限 Action 的前缀)
  label: string;    // 显示名称
  group: Group;     // 所属分组
  platform: Platform; // 所属平台
};

// 统一功能目录 (Feature Catalog)
// 用于根据资源前缀查找其所属的平台、分组和友好名称
export const ROUTE_CATALOG: RouteItem[] = [
  // 资源控制台 (CNMC)
  { prefix: 'ops.dashboard', label: '仪表盘', group: '资源控制台', platform: 'CNMC' },

  // 租户管理 (CNMC)
  { prefix: 'tenants', label: '租户管理', group: '租户管理', platform: 'CNMC' },
  { prefix: 'tenants.leased-lines', label: '租户专线管理', group: '租户管理', platform: 'CNMC' },
  { prefix: 'tenants.users', label: '子用户管理', group: '租户管理', platform: 'CNMC' },

  // 权限管控 (CNMC)
  { prefix: 'access', label: '权限管控', group: '权限管控', platform: 'CNMC' },
  { prefix: 'access.policies', label: '策略管理', group: '权限管控', platform: 'CNMC' },
  { prefix: 'access.roles', label: '角色管理', group: '权限管控', platform: 'CNMC' },
  { prefix: 'access.users', label: '用户管理', group: '权限管控', platform: 'CNMC' },
  { prefix: 'access.actions', label: '权限原子', group: '权限管控', platform: 'CNMC' },

  // 资源池 (CNMC)
  { prefix: 'clouds', label: '资源池管理', group: '资源控制台', platform: 'CNMC' },
  { prefix: 'clouds.instances', label: '云主机', group: '资源控制台', platform: 'CNMC' },
  { prefix: 'clouds.vpcs', label: 'VPC', group: '资源控制台', platform: 'CNMC' },
  { prefix: 'clouds.route-tables', label: '路由表', group: '资源控制台', platform: 'CNMC' },
  { prefix: 'clouds.eips', label: '弹性公网IP', group: '资源控制台', platform: 'CNMC' },
  { prefix: 'clouds.disks', label: '云盘', group: '资源控制台', platform: 'CNMC' },
  { prefix: 'clouds.security-groups', label: '安全组', group: '资源控制台', platform: 'CNMC' },
  { prefix: 'clouds.load-balancers', label: '负载均衡', group: '资源控制台', platform: 'CNMC' },
  { prefix: 'clouds.images', label: '镜像', group: '资源控制台', platform: 'CNMC' },
  { prefix: 'clouds.vswitches', label: '交换机', group: '资源控制台', platform: 'CNMC' },
  { prefix: 'clouds.enis', label: '弹性网卡', group: '资源控制台', platform: 'CNMC' },
  { prefix: 'clouds.network-acls', label: '网络ACL', group: '资源控制台', platform: 'CNMC' },
  { prefix: 'clouds.snapshots', label: '快照', group: '资源控制台', platform: 'CNMC' },
  { prefix: 'clouds.route-entries', label: '路由条目', group: '资源控制台', platform: 'CNMC' },
  { prefix: 'clouds.nat-gateways', label: 'NAT网关', group: '资源控制台', platform: 'CNMC' },

  // SDN 控制中心 (SDNCC)
  { prefix: 'networks.vr-config', label: 'VR实例管理', group: '跨地域互联', platform: 'SDNCC' },
  { prefix: 'networks.cen', label: '级联通道管理', group: '安全管理面', platform: 'SDNCC' },
  { prefix: 'networks.cen.attachments', label: 'CEN连接', group: '跨地域互联', platform: 'SDNCC' },

  { prefix: 'networks.srv6', label: 'SRv6隧道管理', group: '跨地域互联', platform: 'SDNCC' },
  { prefix: 'networks.ipsec', label: 'IPsecVPN管理', group: '跨地域互联', platform: 'SDNCC' },
  { prefix: 'networks.route-tables', label: '路由表', group: '跨地域互联', platform: 'SDNCC' },
  { prefix: 'networks.vswitches', label: '交换机', group: '跨地域互联', platform: 'SDNCC' },
  { prefix: 'networks.acl', label: '网络ACL', group: '跨地域互联', platform: 'SDNCC' },
  { prefix: 'networks.nat', label: 'NAT管理', group: '跨地域互联', platform: 'SDNCC' },
  { prefix: 'networks.security-domain', label: '安全域管理', group: '安全管理面', platform: 'SDNCC' },
  { prefix: 'security.services', label: '应用管理', group: '安全管理面', platform: 'SDNCC' },

  // 流量编排 (SDNCC)
  { prefix: 'security.traffic.protected-objects', label: '引流对象管理', group: '流量编排', platform: 'SDNCC' },
  { prefix: 'security.traffic.service-chains', label: '服务链编排', group: '流量编排', platform: 'SDNCC' },
  { prefix: 'security.traffic.policies', label: '引流策略管理', group: '流量编排', platform: 'SDNCC' },
];

/**
 * 根据资源前缀获取其所属平台
 * @param prefix 资源前缀 (e.g., 'clouds.instances')
 */
export const platformOf = (prefix: string): Platform | undefined => {
  return ROUTE_CATALOG.find(item => item.prefix === prefix)?.platform;
};

/**
 * 根据资源前缀获取其所属分组
 * @param prefix 资源前缀
 */
export const groupOf = (prefix: string): Group | undefined => {
  return ROUTE_CATALOG.find(item => item.prefix === prefix)?.group;
};

/**
 * 根据资源前缀获取其显示名称(Label)
 * 如果未找到，则返回前缀本身
 * @param prefix 资源前缀
 */
export const featureLabelOf = (prefix: string): string => {
  return ROUTE_CATALOG.find(item => item.prefix === prefix)?.label || prefix;
};
