export type Platform = 'CNMC' | 'SDNCC' | 'CNSOC' | '全部';
export type Group = '资源控制台' | '租户管理' | '售卖管理' | '访问控制' | '流量编排' | '跨地域互联' | '安全管理面' | '安全运营' | '安全控制台' | '可信数据空间' | '全部';

export const PLATFORMS: Platform[] = ['全部','CNMC','SDNCC','CNSOC'];
export const GROUPS: Group[] = ['全部','资源控制台','租户管理','售卖管理','访问控制','流量编排','跨地域互联','安全管理面','安全运营','安全控制台','可信数据空间'];

export type FeatureCatalogItem = {
  prefix: string; // 权限资源前缀，如 'ops.dashboard' 或 'clouds.instances'
  label: string;  // 功能显示名称，如 '仪表板'、'云主机'
  group: Group;   // 所属分组
  platform: Platform; // 所属平台
};

// 统一功能目录，用于将权限资源或路由资源映射到平台/分组/功能
export const FEATURE_CATALOG: FeatureCatalogItem[] = [
  // 资源控制台（CNMC）
  { prefix:'ops.dashboard', label:'仪表板', group:'资源控制台', platform:'CNMC' },
  { prefix:'ops.topology', label:'算力网络拓扑', group:'资源控制台', platform:'CNMC' },

  // 系统/租户（CNMC）
  { prefix:'tenants', label:'租户管理', group:'租户管理', platform:'CNMC' },
  { prefix:'tenants.leased-lines', label:'租户专线管理', group:'租户管理', platform:'CNMC' },
  { prefix:'tenants.users', label:'子用户管理', group:'租户管理', platform:'CNMC' },

  // 访问控制（CNMC）
  { prefix:'access', label:'访问控制', group:'访问控制', platform:'CNMC' },

  // 资源池（CNMC）
  { prefix:'clouds', label:'资源池管理', group:'资源控制台', platform:'CNMC' },
  { prefix:'clouds.instances', label:'云主机', group:'资源控制台', platform:'CNMC' },
  { prefix:'clouds.vpcs', label:'VPC', group:'资源控制台', platform:'CNMC' },
  { prefix:'clouds.route-tables', label:'路由表', group:'资源控制台', platform:'CNMC' },
  { prefix:'clouds.eips', label:'弹性公网IP', group:'资源控制台', platform:'CNMC' },
  { prefix:'clouds.disks', label:'云盘', group:'资源控制台', platform:'CNMC' },
  { prefix:'clouds.security-groups', label:'安全组', group:'资源控制台', platform:'CNMC' },
  { prefix:'clouds.load-balancers', label:'负载均衡', group:'资源控制台', platform:'CNMC' },
  { prefix:'clouds.images', label:'镜像', group:'资源控制台', platform:'CNMC' },
  { prefix:'clouds.vswitches', label:'交换机', group:'资源控制台', platform:'CNMC' },
  { prefix:'clouds.enis', label:'弹性网卡', group:'资源控制台', platform:'CNMC' },
  { prefix:'clouds.network-acls', label:'网络ACL', group:'资源控制台', platform:'CNMC' },
  { prefix:'clouds.snapshots', label:'快照', group:'资源控制台', platform:'CNMC' },
  { prefix:'clouds.route-entries', label:'路由条目', group:'资源控制台', platform:'CNMC' },
  { prefix:'clouds.nat-gateways', label:'NAT网关', group:'资源控制台', platform:'CNMC' },

  // SDN 控制中心（SDNCC）
  { prefix:'networks.vr-config', label:'VR实例管理', group:'跨地域互联', platform:'SDNCC' },
  { prefix:'networks.cen', label:'实例管理', group:'安全管理面', platform:'SDNCC' },
  { prefix:'networks.cen.attachments', label:'CEN连接', group:'跨地域互联', platform:'SDNCC' },

  { prefix:'networks.srv6', label:'SRv6隧道管理', group:'跨地域互联', platform:'SDNCC' },
  { prefix:'networks.ipsec', label:'IPsecVPN管理', group:'跨地域互联', platform:'SDNCC' },
  { prefix:'networks.route-tables', label:'路由表', group:'跨地域互联', platform:'SDNCC' },
  { prefix:'networks.vswitches', label:'交换机', group:'跨地域互联', platform:'SDNCC' },
  { prefix:'networks.acl', label:'网络ACL', group:'跨地域互联', platform:'SDNCC' },
  { prefix:'networks.nat', label:'NAT管理', group:'跨地域互联', platform:'SDNCC' },
  { prefix:'networks.info-domain', label:'信息域', group:'安全管理面', platform:'SDNCC' },
  { prefix:'security.services', label:'服务目录管理', group:'安全管理面', platform:'SDNCC' },
  { prefix:'security.policies', label:'授权策略', group:'安全管理面', platform:'SDNCC' },
  { prefix:'security.apps', label:'服务目录', group:'安全管理面', platform:'SDNCC' },

  // SSLO 流量编排
  { prefix:'security.traffic.vsw', label:'VSW集群管理', group:'流量编排', platform:'SDNCC' },
  { prefix:'security.traffic.security-zones', label:'安全域管理', group:'流量编排', platform:'SDNCC' },
  { prefix:'security.traffic.protected-objects', label:'防护对象管理', group:'流量编排', platform:'SDNCC' },
  { prefix:'security.traffic.service-chains', label:'服务链管理', group:'流量编排', platform:'SDNCC' },
];

export const platformOf = (resourceOrAction: string): Platform => {
  const res = String(resourceOrAction || '');
  const item = FEATURE_CATALOG.find(it => res.startsWith(it.prefix));
  return item ? item.platform : 'CNMC';
};

export const groupOf = (resourceOrAction: string): Group => {
  const res = String(resourceOrAction || '');
  const item = FEATURE_CATALOG.find(it => res.startsWith(it.prefix));
  return item ? item.group : '资源控制台';
};

export const featureLabelOf = (resourceOrAction: string): string => {
  const res = String(resourceOrAction || '');
  const item = FEATURE_CATALOG.find(it => res.startsWith(it.prefix));
  return item ? item.label : res.replace(/^\w+\./, '');
};

export type RouteItem = {
  path: string;
  label: string;
  platform: Platform;
  group: Group;
  icon?: string;
};

export const ROUTE_CATALOG: RouteItem[] = [
  { path: '/admin/dashboard', label: '仪表板', platform: 'CNMC', group: '资源控制台', icon: 'AppstoreOutlined' },
  { path: '/admin/topology', label: '算力网络拓扑', platform: 'CNMC', group: '资源控制台', icon: 'DeploymentUnitOutlined' },
  { path: '/admin/clouds', label: '资源池管理', platform: 'CNMC', group: '资源控制台', icon: 'CloudUploadOutlined' },
  { path: '/admin/clouds/console', label: '控制台pro', platform: 'CNMC', group: '资源控制台', icon: 'DesktopOutlined' },

  { path: '/admin/tenants', label: '租户管理', platform: 'CNMC', group: '租户管理', icon: 'TeamOutlined' },
  { path: '/admin/tenants/users', label: '子用户管理', platform: 'CNMC', group: '租户管理', icon: 'UserOutlined' },
  { path: '/admin/tenants/leased-lines', label: '租户专线管理', platform: 'CNMC', group: '租户管理', icon: 'GatewayOutlined' },

  { path: '/admin/access/policies', label: '授权策略', platform: 'CNMC', group: '访问控制', icon: 'LockOutlined' },
  { path: '/admin/access/actions', label: '权限原子', platform: 'CNMC', group: '访问控制', icon: 'ApiOutlined' },
  { path: '/admin/access/roles', label: '角色管理', platform: 'CNMC', group: '访问控制', icon: 'UserSwitchOutlined' },
  { path: '/admin/access/users', label: '用户管理', platform: 'CNMC', group: '访问控制', icon: 'UserOutlined' },

  { path: '/admin/interconnect/vr', label: 'VR实例管理', platform: 'SDNCC', group: '跨地域互联', icon: 'GatewayOutlined' },
  { path: '/admin/interconnect/srv6', label: 'SRv6隧道管理', platform: 'SDNCC', group: '跨地域互联', icon: 'ShareAltOutlined' },
  { path: '/admin/interconnect/ipsec', label: 'IPsecVPN管理', platform: 'SDNCC', group: '跨地域互联', icon: 'NodeIndexOutlined' },
  { path: '/admin/interconnect/acl', label: '网络ACL', platform: 'SDNCC', group: '跨地域互联', icon: 'SecurityScanOutlined' },
  { path: '/admin/interconnect/nat', label: 'NAT管理', platform: 'SDNCC', group: '跨地域互联', icon: 'SwapOutlined' },
  
  
  { path: '/admin/sec-mgr-plane/instances', label: '实例管理', platform: 'SDNCC', group: '安全管理面', icon: 'GlobalOutlined' },
  { path: '/admin/sec-mgr-plane/info-domain', label: '信息域管理', platform: 'SDNCC', group: '安全管理面', icon: 'EnvironmentOutlined' },
  { path: '/admin/sec-mgr-plane/apps', label: '服务目录管理', platform: 'SDNCC', group: '安全管理面', icon: 'AppstoreOutlined' },

  // SSLO 流量编排 (Traffic Orchestration)
  { path: '/admin/security/traffic/vsw', label: 'VSW集群管理', platform: 'SDNCC', group: '流量编排', icon: 'ClusterOutlined' },
  { path: '/admin/security/traffic/security-zones', label: '安全域管理', platform: 'SDNCC', group: '流量编排', icon: 'SecurityScanOutlined' },
  { path: '/admin/security/traffic/protected-objects', label: '防护对象管理', platform: 'SDNCC', group: '流量编排', icon: 'SafetyCertificateOutlined' },
  { path: '/admin/security/traffic/service-chains', label: '服务链管理', platform: 'SDNCC', group: '流量编排', icon: 'NodeIndexOutlined' },
];

export const findRouteItem = (path: string): RouteItem | undefined => {
  const pure = String(path || '').split('?')[0];
  return ROUTE_CATALOG.find(it => it.path === pure);
};
