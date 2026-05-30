import { CLOUDMAP_POOL_NAV_ROWS } from './cloudmapPoolNavRows';

export interface RouteSpec {
  id: string;
  path: string;
  element: string;
  layout?: 'default' | 'admin';
  guard?: 'private' | 'public';
  backgroundCapable?: boolean;
  modalElement?: string;
  platform?: string;
  group?: string;
  title?: string;
  breadcrumbLabel?: string;
  icon?: string;
  order?: number;
  hidden?: boolean;
  requiredActions?: Record<string, string>;
  parentId?: string;
  subtitle?: string;
  requiredFeature?: string;
  /** @deprecated 标记为废弃的路由 */
  deprecated?: boolean;
  /**
   * 首页优先级（可选）
   * - 数值越小优先级越高
   * - 只有设置了此字段的路由才会被考虑作为首页候选
   * - 如果未设置，则不会作为首页候选
   */
  homePagePriority?: number;
  /** 为 true 时：即使 `hidden` 也参与首页顺位（仍不出侧栏） */
  homePageCandidate?: boolean;
  /**
   * 首页顺位：仅当 `hasFeature(feature)` 为 **false** 时本候选才参与（与 `requiredFeature` 不同）
   * 例：`platform.multi-cloud` → 未开通「多云管理」授权时才可走该首页
   */
  homePageOnlyWithoutFeature?: string;
  /** 首页返回路径时，将 `path` 中的 `:cloudId` 替换为上下文中的收藏池 ID */
  homePageReplaceParamFrom?: 'favoriteCloudId';
  /** 首页顺位仅限这些角色（小写）；未设置则不限制 */
  homePageAllowedRoles?: string[];
  /** 为 true 时：首页顺位跳过 `requiredActions` 的 RBAC 检查（仍校验授权类字段） */
  homePageSkipPermissionCheck?: boolean;
  /**
   * 租户控制台入口（/console）：由账号类型或 TenantConsoleRoute 守卫，不参与 AdminRoute 路径→RBAC 映射。
   */
  tenantAccountEntry?: boolean;
  /**
   * `cloudmap-pool`：仅用于 Cloudmap 资源池侧栏与面包屑元数据；
   * 不参与管理端顶栏平台菜单；池内路径仍写入路径→权限映射（`clouds.console:read`）。
   */
  navScope?: 'default' | 'cloudmap-pool';
  /** Cloudmap 池侧栏分组标题（中文） */
  poolNavGroup?: string;
  /** Cloudmap 池侧栏 Ant Menu 父级 key（非路径） */
  poolMenuParentKey?: string;
  /** Cloudmap 池内：侧栏二级分组键（与 `cloudmapPoolNavRows.poolNavSubgroup` 一致） */
  poolNavSubgroup?: string;
  /** Cloudmap 池侧栏：满足任一 read 即可展示（见 `cloudmapPoolNavRows.poolPageReadAnyOf`） */
  poolPageReadAnyOf?: readonly string[];
}

function toCloudmapPoolRouteSpec(
  r: (typeof CLOUDMAP_POOL_NAV_ROWS)[number],
): RouteSpec {
  const page = r.poolPageAction ?? 'clouds.console:read';
  const write =
    page === 'clouds.console:read'
      ? 'clouds.console:write'
      : page.endsWith(':read')
        ? `${page.slice(0, -(':read'.length))}:write`
        : 'clouds.console:write';
  return {
    id: r.id,
    path: `/admin/clouds/:cloudId/${r.pathSuffix}`,
    element: 'Clouds',
    layout: 'admin',
    platform: 'CNMC',
    group: r.routeSpecGroup ?? 'Cloudmap资源池',
    hidden: true,
    navScope: 'cloudmap-pool',
    poolNavGroup: r.poolNavGroup,
    poolMenuParentKey: r.poolMenuParentKey || undefined,
    poolNavSubgroup: r.poolNavSubgroup,
    poolPageReadAnyOf: r.poolPageReadAnyOf,
    title: r.title,
    breadcrumbLabel: r.title,
    subtitle: `${r.poolNavGroup} · ${r.title}`,
    icon: r.icon,
    order: r.order,
    /** 池内页：默认控制台读；容器各 Tab 绑定 clouds.containers.{子域}:read（与后端 registry 一致） */
    requiredActions: {
      page,
      read: page,
      write,
    },
    requiredFeature: r.requiredFeature,
    homePagePriority: r.homePagePriority,
    homePageCandidate: r.homePageCandidate,
    homePageReplaceParamFrom: r.homePageReplaceParamFrom,
    homePageAllowedRoles: r.homePageAllowedRoles,
    homePageOnlyWithoutFeature: r.homePageOnlyWithoutFeature,
  };
}

const cloudmapPoolRouteSpecs: RouteSpec[] = CLOUDMAP_POOL_NAV_ROWS.map(toCloudmapPoolRouteSpec);

export const routeSpecs: RouteSpec[] = [
  // ============================================================================
  // CNMC 平台 (多云管理平台)
  // ============================================================================

  /** 工作台开荒页：首页顺位见 `homePagePriority`；访问控制见 `AdminRoute` */
  {
    id: 'admin-welcome',
    path: '/admin/welcome',
    element: 'AdminWelcomePage',
    layout: 'admin',
    platform: 'SETTINGS',
    group: '授权管理',
    title: '工作台',
    breadcrumbLabel: '工作台',
    subtitle: '首次进入或尚未开通多云管理时的引导与授权入口。',
    icon: 'RocketOutlined',
    hidden: true,
    homePageCandidate: true,
    homePagePriority: 0,
    homePageOnlyWithoutFeature: 'platform.multi-cloud',
    homePageAllowedRoles: ['super_admin', 'admin'],
    homePageSkipPermissionCheck: true,
    requiredActions: {
      page: 'system.license:read',
      read: 'system.license:read',
      write: 'system.license:write',
    },
  },

  // Group: 多云管理（平台级：多云总览、资源池列表）
  {
    id: 'dashboard',
    path: '/admin/dashboard',
    element: 'OverviewDashboard',
    layout: 'admin',
    platform: 'CNMC',
    group: '多云管理',
    title: '多云总览',
    subtitle: '展示全局资源统计概览，包括资源池数量、云主机数量、容器集群数量、VPC网络数量等关键指标，提供多维度数据可视化与实时监控。',
    icon: 'DashboardOutlined',
    order: 0,
    requiredActions: {
      page: 'clouds.dashboard:read',
      read: 'clouds.dashboard:read',
    },
    requiredFeature: 'sys.dashboard',
    homePagePriority: 1
  },
  {
    id: 'clouds-list',
    path: '/admin/clouds',
    element: 'Clouds',
    layout: 'admin',
    platform: 'CNMC',
    group: '多云管理',
    title: '资源池管理',
    requiredActions: {
      page: 'clouds.resource-pools:read',
      read: 'clouds.resource-pools:read',
      write: 'clouds.resource-pools:write'
    },
    breadcrumbLabel: '资源池管理',
    subtitle: '统一管理各云资源的接入、状态监控与资源统计，支持连接测试、资源池编辑、批量删除等运维操作。',
    icon: 'CloudUploadOutlined',
    order: 3,
    /** 默认授权不含此项；需「多云管理」授权才开放资源池列表与完整运维入口 */
    requiredFeature: 'platform.multi-cloud',
    homePagePriority: 2
  },
  /** 与 App.tsx 中 Route 一致；用于路径权限映射（避免落入 /admin/clouds 列表的 resource-pools 权限） */
  {
    id: 'rancher-cluster-workspace',
    path: '/admin/clouds/:poolId/clusters/:clusterId',
    element: 'RancherClusterWorkspace',
    layout: 'admin',
    platform: 'CNMC',
    group: 'Cloudmap资源池',
    hidden: true,
    title: 'Rancher 集群工作台',
    requiredActions: {
      page: 'clouds.console:read',
      read: 'clouds.console:read',
      write: 'clouds.console:write',
    },
  },
  {
    id: 'pool-vendor-huawei',
    path: '/admin/clouds/vendor/huawei/:cloudId',
    element: 'Clouds',
    layout: 'admin',
    platform: 'CNMC',
    group: 'Cloudmap资源池',
    hidden: true,
    title: '华为云资源池详情',
    requiredActions: {
      page: 'clouds.console:read',
      read: 'clouds.console:read',
      write: 'clouds.console:write',
    },
  },
  {
    id: 'pool-vendor-aliyun',
    path: '/admin/clouds/vendor/aliyun/:cloudId',
    element: 'Clouds',
    layout: 'admin',
    platform: 'CNMC',
    group: 'Cloudmap资源池',
    hidden: true,
    title: '阿里云资源池详情',
    requiredActions: {
      page: 'clouds.console:read',
      read: 'clouds.console:read',
      write: 'clouds.console:write',
    },
  },
  {
    id: 'pool-vendor-rancher',
    path: '/admin/clouds/vendor/rancher/:cloudId',
    element: 'Clouds',
    layout: 'admin',
    platform: 'CNMC',
    group: 'Cloudmap资源池',
    hidden: true,
    title: 'Rancher 资源池详情',
    requiredActions: {
      page: 'clouds.console:read',
      read: 'clouds.console:read',
      write: 'clouds.console:write',
    },
  },
  {
    id: 'pool-vendor-xinference',
    path: '/admin/clouds/vendor/xinference/:cloudId',
    element: 'Clouds',
    layout: 'admin',
    platform: 'CNMC',
    group: 'Cloudmap资源池',
    hidden: true,
    title: 'Xinference 资源池详情',
    requiredActions: {
      page: 'clouds.console:read',
      read: 'clouds.console:read',
      write: 'clouds.console:write',
    },
  },
  {
    id: 'pool-vendor-maas',
    path: '/admin/clouds/vendor/maas/:cloudId',
    element: 'Clouds',
    layout: 'admin',
    platform: 'CNMC',
    group: 'Cloudmap资源池',
    hidden: true,
    title: 'MAAS 裸金属资源池详情',
    requiredActions: {
      page: 'clouds.console:read',
      read: 'clouds.console:read',
      write: 'clouds.console:write',
    },
  },
  {
    id: 'pool-vendor-csm',
    path: '/admin/clouds/vendor/csm/:cloudId',
    element: 'Clouds',
    layout: 'admin',
    platform: 'CNMC',
    group: 'Cloudmap资源池',
    hidden: true,
    title: 'CSM 资源池跳转',
    requiredActions: {
      page: 'clouds.console:read',
      read: 'clouds.console:read',
      write: 'clouds.console:write',
    },
  },
  {
    id: 'console',
    path: '/console',
    element: 'CloudConsolePage',
    layout: 'admin',
    platform: 'CNMC',
    group: '租户控制台',
    title: '租户控制台',
    subtitle: '提供统一的租户云资源控制台访问入口，支持通过 Web SSH 或 VNC 等方式远程连接与管理云主机，实现跨资源池的统一运维体验。',
    breadcrumbLabel: '租户控制台',
    icon: 'DesktopOutlined',
    /** 不进入管理端侧栏；路由仍由 `App.tsx` 注册，`/console` 可照常访问 */
    hidden: true,
    tenantAccountEntry: true,
    requiredActions: {
      page: 'clouds.console:read',
      read: 'clouds.console:read',
      write: 'clouds.console:write'
    },
    order: 10,
    /** 默认授权即可；不按多云 License 门控，仅 RBAC */
    homePagePriority: 3
  },

  // Group: 租户管理
  {
    id: 'tenants-list',
    path: '/admin/tenants',
    element: 'Tenants',
    layout: 'admin',
    platform: 'TENANTS',
    group: '租户管理',
    title: '租户管理',
    subtitle: '租户用于隔离不同组织或项目的资源与权限，支持组织架构、用户与角色管理、资源池分配等。',
    icon: 'TeamOutlined',
    requiredActions: {
      page: 'tenants:read',
      read: 'tenants:read',
      write: 'tenants:write'
    },
    order: 1,
    requiredFeature: 'sys.tenant-mgmt',
    homePagePriority: 4
  },
  {
    id: 'tenant-organizations',
    path: '/admin/tenants/:tenantId/organizations',
    element: 'OrgManagePage',
    layout: 'admin',
    platform: 'TENANTS',
    group: '租户管理',
    title: '组织管理',
    subtitle: '管理租户下的组织架构树，支持创建多级组织、分配组织用户、配置计算资源配额，实现基于组织架构的权限隔离与资源分配。',
    breadcrumbLabel: '组织管理',
    hidden: true,
    parentId: 'tenants-list',
    requiredActions: {
      page: 'organizations:read',
      read: 'organizations:read',
      write: 'organizations:write'
    },
    requiredFeature: 'sys.tenant-mgmt',
  },
  {
    id: 'tenant-users',
    path: '/admin/tenants/users',
    element: 'Users',
    layout: 'admin',
    platform: 'TENANTS',
    group: '租户管理',
    title: '组织用户管理',
    subtitle: '管理租户下的组织用户账号，支持创建、编辑、删除用户，分配角色权限，按租户、组织、角色、状态等维度进行筛选和批量操作。',
    icon: 'UserSwitchOutlined',
    requiredActions: {
      page: 'tenant-users:read',
      read: 'tenant-users:read',
      write: 'tenant-users:write'
    },
    order: 3,
    requiredFeature: 'sys.tenant-mgmt',
    homePagePriority: 5
  },

  // CNMC Hidden Routes (放在最后)
  {
    id: 'vnc',
    path: '/admin/clouds/:id/harvester/vnc',
    element: 'HarvesterVNCPage',
    layout: 'default',
    guard: 'private',
    platform: 'CNMC',
    group: '租户控制台',
    hidden: true,
    requiredActions: {
      page: 'clouds.console:read',
      read: 'clouds.console:read',
      write: 'clouds.console:write'
    }
  },
  {
    id: 'vnc-pure',
    path: '/clouds/:id/harvester/vnc',
    element: 'HarvesterVNCPage',
    layout: 'default',
    guard: 'private',
    platform: 'CNMC',
    group: '租户控制台',
    hidden: true,
    requiredActions: {
      page: 'clouds.console:read',
      read: 'clouds.console:read',
      write: 'clouds.console:write'
    }
  },
  {
    id: 'instance-create',
    path: '/admin/clouds/:id/instances/create',
    element: 'InstanceWizard',
    modalElement: 'InstanceWizardModal',
    layout: 'default',
    guard: 'private',
    backgroundCapable: true,
    platform: 'CNMC',
    group: 'Cloudmap资源池',
    hidden: true,
    requiredActions: {
      page: 'clouds.vm-create-wizard:write',
      read: 'clouds.ecs:read',
      write: 'clouds.vm-create-wizard:write'
    }
  },
  {
    id: 'instance-create-pure',
    path: '/clouds/:id/instances/create',
    element: 'InstanceWizard',
    modalElement: 'InstanceWizardModal',
    layout: 'default',
    guard: 'private',
    backgroundCapable: true,
    platform: 'CNMC',
    group: 'Cloudmap资源池',
    hidden: true,
    requiredActions: {
      page: 'clouds.vm-create-wizard:write',
      read: 'clouds.ecs:read',
      write: 'clouds.vm-create-wizard:write'
    }
  },
  // ============================================================================
  // SDNCC 平台 (SDN 控制中心)
  // ============================================================================
  
  // Group: 安全管理面（级联、应用等；安全域/安全服务已归「流量编排」）

  {
    id: 'cascade-channels',
    path: '/admin/sec-mgr-plane/cascade-channels',
    element: 'CENPage',
    layout: 'admin',
    platform: 'SDNCC',
    group: '安全管理面',
    title: '级联通道管理',
    subtitle: '跨地域与跨云的 CEN 互联通道，支持 Mesh 与 Hub-Spoke，监控通道状态、丢包、时延与 SLA。',
    icon: 'ShareAltOutlined',
    order: 1,
    requiredActions: {
      page: 'networks.cen:read',
      read: 'networks.cen:read',
      write: 'networks.cen:write'
    },
    requiredFeature: 'sdn.cascade',
  },
  {
    id: 'cascade-channels-detail',
    path: '/admin/sec-mgr-plane/cascade-channels/:id',
    element: 'CENDetailPage',
    layout: 'admin',
    platform: 'SDNCC',
    group: '安全管理面',
    title: '级联通道详情',
    breadcrumbLabel: '详情',
    hidden: true,
    parentId: 'cascade-channels',
    requiredActions: {
      page: 'networks.cen:read',
      read: 'networks.cen:read',
      write: 'networks.cen:write'
    },
    requiredFeature: 'sdn.cascade',
  },
  {
    id: 'smp-apps',
    path: '/admin/sec-mgr-plane/apps',
    element: 'SecurityApps',
    layout: 'admin',
    platform: 'SDNCC',
    group: '安全管理面',
    title: '应用管理',
    subtitle: '微隔离场景下的应用纳管、服务发现与访问策略配置，落实零信任模型下的隔离与访问控制。',
    icon: 'AppstoreAddOutlined',
    order: 2,
    requiredActions: {
      page: 'security.apps:read',
      read: 'security.apps:read',
      write: 'security.apps:write'
    },
    requiredFeature: 'sdn.cascade',
  },


  // Group: 跨域互联
  {
    id: 'interconnect-vr',
    path: '/admin/interconnect/vr',
    element: 'VRPage',
    layout: 'admin',
    platform: 'SDNCC',
    group: '跨域互联',
    title: 'VR实例管理',
    subtitle: '虚拟路由连接多云与异构网络，提供跨域转发、BGP/静态路由、策略下发与运行监控。',
    icon: 'GatewayOutlined',
    order: 1,
    requiredActions: {
      page: 'networks.vr-config:read',
      read: 'networks.vr-config:read',
      write: 'networks.vr-config:write'
    },
    requiredFeature: 'sdn.interconnect',
  },
  {
    id: 'interconnect-vr-add',
    path: '/admin/interconnect/vr/add',
    element: 'AddVRInstance',
    layout: 'admin',
    platform: 'SDNCC',
    group: '跨域互联',
    title: '新增 VR 实例',
    breadcrumbLabel: '新增 VR 实例',
    parentId: 'interconnect-vr',
    hidden: true,
    requiredActions: {
      page: 'networks.vr-config:read',
      read: 'networks.vr-config:read',
      write: 'networks.vr-config:write'
    },
    requiredFeature: 'sdn.interconnect',
  },
  {
    id: 'interconnect-vr-config',
    path: '/admin/interconnect/vr/:uuid/config',
    element: 'EditVRConfig',
    layout: 'admin',
    platform: 'SDNCC',
    group: '跨域互联',
    title: '专家模式',
    breadcrumbLabel: '专家模式',
    subtitle: '分步查询、编辑与下发 VR 配置，支持预览、分段编辑、配置点启停及保存到平台或直发设备。',
    parentId: 'interconnect-vr',
    icon: 'SettingOutlined',
    hidden: true,
    requiredActions: {
      page: 'networks.vr-config:read',
      read: 'networks.vr-config:read',
      write: 'networks.vr-config:write'
    },
    requiredFeature: 'sdn.interconnect',
  },
  {
    id: 'interconnect-vr-role-pe',
    path: '/admin/interconnect/vr/:uuid/role-pe',
    element: 'PEWizard',
    layout: 'admin',
    platform: 'SDNCC',
    group: '跨域互联',
    title: '设置角色（PE模式）',
    breadcrumbLabel: '设置角色（PE模式）',
    parentId: 'interconnect-vr',
    icon: 'SettingOutlined',
    subtitle: 'PE 模式：SID、公网/内网接口绑定、静态路由与私网 BGP 邻居，作为跨域互联核心节点。',
    hidden: true,
    requiredActions: {
      page: 'networks.vr-config:read',
      read: 'networks.vr-config:read',
      write: 'networks.vr-config:write'
    },
    requiredFeature: 'sdn.interconnect',
  },
  {
    id: 'interconnect-vr-role-ce',
    path: '/admin/interconnect/vr/:uuid/role-ce',
    element: 'CEWizard',
    layout: 'admin',
    platform: 'SDNCC',
    group: '跨域互联',
    title: '设置角色（CE模式）',
    breadcrumbLabel: '设置角色（CE模式）',
    parentId: 'interconnect-vr',
    icon: 'SettingOutlined',
    subtitle: 'CE 模式：外网/内网接口与基础路由参数，连接用户侧网络与运营商或骨干侧。',
    hidden: true,
    requiredActions: {
      page: 'networks.vr-config:read',
      read: 'networks.vr-config:read',
      write: 'networks.vr-config:write'
    },
    requiredFeature: 'sdn.interconnect',
  },
  {
    id: 'interconnect-vr-role-standard',
    path: '/admin/interconnect/vr/:uuid/role-standard',
    element: 'StandardWizard',
    layout: 'admin',
    platform: 'SDNCC',
    group: '跨域互联',
    title: '设置角色（标准模式）',
    breadcrumbLabel: '设置角色（标准模式）',
    parentId: 'interconnect-vr',
    icon: 'SettingOutlined',
    subtitle: '标准模式：预置 IPsec 非协商参数（PSK、算法等），便于后续隧道创建时快速预填。',
    hidden: true,
    requiredActions: {
      page: 'networks.vr-config:read',
      read: 'networks.vr-config:read',
      write: 'networks.vr-config:write'
    },
    requiredFeature: 'sdn.interconnect',
  },
  {
    id: 'interconnect-vr-role-sase',
    path: '/admin/interconnect/vr/:uuid/role-sase',
    element: 'SASEWizard',
    layout: 'admin',
    platform: 'SDNCC',
    group: '跨域互联',
    title: '设置角色（SASE模式）',
    subtitle: 'SASE 模式：安全访问服务边缘参数，支撑零信任接入与统一安全策略编排。',
    breadcrumbLabel: '设置角色（SASE模式）',
    parentId: 'interconnect-vr',
    icon: 'SettingOutlined',
    hidden: true,
    requiredActions: {
      page: 'networks.vr-config:read',
      read: 'networks.vr-config:read',
      write: 'networks.vr-config:write'
    },
    requiredFeature: 'sdn.interconnect',
  },
  {
    id: 'interconnect-srv6',
    path: '/admin/interconnect/srv6',
    element: 'SRv6Page',
    layout: 'admin',
    platform: 'SDNCC',
    group: '跨域互联',
    title: 'SRv6隧道',
    subtitle: '基于 IPv6 的 SRv6 段路由，用于灵活选路、流量工程与业务路径编排。',
    icon: 'NodeIndexOutlined',
    order: 2,
    requiredActions: {
      page: 'networks.srv6:read',
      read: 'networks.srv6:read',
      write: 'networks.srv6:write'
    },
    requiredFeature: 'sdn.interconnect',
  },
  {
    id: 'interconnect-ipsec',
    path: '/admin/interconnect/ipsec',
    element: 'IPsecVPNPage',
    layout: 'admin',
    platform: 'SDNCC',
    group: '跨域互联',
    title: 'IPsecVPN',
    subtitle: 'IKEv1/v2 加密站点隧道，支持拓扑可视、配置审计与连接状态监控。',
    icon: 'LockOutlined',
    order: 3,
    requiredActions: {
      page: 'networks.ipsec:read',
      read: 'networks.ipsec:read',
      write: 'networks.ipsec:write'
    },
    requiredFeature: 'sdn.interconnect',
  },
  {
    id: 'interconnect-ipsec-create',
    path: '/admin/interconnect/ipsec/create',
    element: 'IPsecVPNWizard',
    layout: 'admin',
    platform: 'SDNCC',
    group: '跨域互联',
    title: '新建IPsecVPN连接',
    breadcrumbLabel: '新建连接',
    parentId: 'interconnect-ipsec',
    hidden: true,
    requiredActions: {
      page: 'networks.ipsec:read',
      read: 'networks.ipsec:read',
      write: 'networks.ipsec:write'
    },
    requiredFeature: 'sdn.interconnect',
  },
  {
    id: 'interconnect-ipsec-edit',
    path: '/admin/interconnect/ipsec/:id/edit',
    element: 'IPsecVPNWizard',
    layout: 'admin',
    platform: 'SDNCC',
    group: '跨域互联',
    title: '编辑IPsecVPN连接',
    breadcrumbLabel: '编辑连接',
    parentId: 'interconnect-ipsec',
    hidden: true,
    requiredActions: {
      page: 'networks.ipsec:read',
      read: 'networks.ipsec:read',
      write: 'networks.ipsec:write'
    },
    requiredFeature: 'sdn.interconnect',
  },
  {
    id: 'interconnect-acl',
    path: '/admin/interconnect/acl',
    element: 'ACLPage',
    layout: 'admin',
    platform: 'SDNCC',
    group: '跨域互联',
    title: 'ACL 访问控制',
    subtitle: '按优先级的 ACL，匹配源/目的地址与端口，支持 TCP、UDP、ICMP 等协议过滤。',
    icon: 'FileTextOutlined',
    order: 4,
    requiredActions: {
      page: 'networks.acl:read',
      read: 'networks.acl:read',
      write: 'networks.acl:write'
    },
    requiredFeature: 'sdn.interconnect',
  },
  {
    id: 'interconnect-nat',
    path: '/admin/interconnect/nat',
    element: 'NATPage',
    layout: 'admin',
    platform: 'SDNCC',
    group: '跨域互联',
    title: 'NAT 网关',
    subtitle: 'SNAT、DNAT 与静态映射，完成私网与公网地址转换，支持接口与地址段绑定。',
    icon: 'SwapOutlined',
    order: 5,
    requiredActions: {
      page: 'networks.nat:read',
      read: 'networks.nat:read',
      write: 'networks.nat:write'
    },
    requiredFeature: 'sdn.interconnect',
  },

  // Group: 流量编排
  {
    id: 'security-domain',
    path: '/admin/sec-mgr-plane/security-domain',
    element: 'SecurityDomainPage',
    layout: 'admin',
    platform: 'SDNCC',
    group: '流量编排',
    title: '安全域规划',
    subtitle: '统一管理多云安全域边界，逻辑隔离 VPC、办公与扁平网络，支撑策略编排与全生命周期运维。',
    icon: 'ClusterOutlined',
    order: 0,
    requiredActions: {
      page: 'networks.security-domain:read',
      read: 'networks.security-domain:read',
      write: 'networks.security-domain:write'
    },
    requiredFeature: 'sdn.cascade',
  },
  {
    id: 'security-domain-detail',
    path: '/admin/sec-mgr-plane/security-domain/:id',
    element: 'SecurityDomainDetail',
    layout: 'admin',
    platform: 'SDNCC',
    group: '流量编排',
    title: '安全域详情',
    breadcrumbLabel: '详情',
    hidden: true,
    parentId: 'security-domain',
    requiredActions: {
      page: 'networks.security-domain:read',
      read: 'networks.security-domain:read',
      write: 'networks.security-domain:write'
    },
    requiredFeature: 'sdn.cascade',
  },
  {
    id: 'traffic-csm-pools',
    path: '/admin/security/traffic/csm-pools',
    element: 'CsmPoolsPage',
    layout: 'admin',
    platform: 'SDNCC',
    group: '流量编排',
    title: '安全资源池',
    subtitle: '接入与管理 CSM 安全控制面资源池，与多云资源池解耦，在流量编排域统一维护。',
    icon: 'SafetyCertificateOutlined',
    order: 2,
    requiredActions: {
      page: 'security.services:read',
      read: 'security.services:read',
      write: 'security.services:write',
    },
    requiredFeature: 'sdn.traffic',
  },
  {
    id: 'security-services',
    path: '/admin/sec-mgr-plane/security-services',
    element: 'SecurityServices',
    layout: 'admin',
    platform: 'SDNCC',
    group: '流量编排',
    title: '安全服务',
    subtitle: '纳管 CSM 安全网元（防火墙、IPS、WAF 等），覆盖分配、状态监控、配置与资源生命周期。',
    icon: 'SafetyCertificateOutlined',
    order: 1,
    requiredActions: {
      page: 'security.services:read',
      read: 'security.services:read',
      write: 'security.services:write'
    },
    requiredFeature: 'sdn.cascade',
  },
  {
    id: 'traffic-csm-pool-detail',
    path: '/admin/security/traffic/csm-pools/:cloudId',
    element: 'CsmPoolDetailPage',
    layout: 'admin',
    platform: 'SDNCC',
    group: '流量编排',
    title: 'CSM 资源池详情',
    breadcrumbLabel: '详情',
    hidden: true,
    parentId: 'traffic-csm-pools',
    requiredActions: {
      page: 'security.services:read',
      read: 'security.services:read',
      write: 'security.services:write',
    },
    requiredFeature: 'sdn.traffic',
  },
  // ============================================================================
  // CNSOC 平台 (AI SOC 安全运营中心)
  // ============================================================================
  
  // Group: 态势中心
  {
    id: 'aisoc-situation-overview',
    path: '/admin/aisoc/situation/overview',
    element: 'AiSocPlaceholder',
    layout: 'admin',
    platform: 'CNSOC',
    group: '态势中心',
    title: 'AI SOC总览',
    subtitle: '全网安全态势的实时监控与可视化大屏',
    icon: 'RadarChartOutlined',
    order: 10,
    requiredActions: {
      page: 'secops.dashboard:read',
      read: 'secops.dashboard:read',
      write: 'secops.dashboard:write'
    },
    requiredFeature: 'platform.aisoc',
  },

  // Group: 数据预处理
  {
    id: 'aisoc-data-source',
    path: '/admin/aisoc/data-source',
    element: 'AiSocFrame',
    layout: 'admin',
    platform: 'CNSOC',
    group: '数据预处理',
    title: '数据源配置',
    subtitle: '配置和管理安全日志数据的采集来源与接入方式',
    icon: 'DatabaseOutlined',
    order: 10,
    requiredActions: {
      page: 'secops.dashboard:read',
      read: 'secops.dashboard:read',
      write: 'secops.dashboard:write'
    },
    requiredFeature: 'platform.aisoc',
  },
  {
    id: 'aisoc-raw-logs',
    path: '/admin/aisoc/raw-logs',
    element: 'AiSocFrame',
    layout: 'admin',
    platform: 'CNSOC',
    group: '数据预处理',
    title: '原始数据预览',
    subtitle: '查看未经处理的原始安全日志数据流',
    icon: 'FileTextOutlined',
    order: 20,
    requiredActions: {
      page: 'secops.dashboard:read',
      read: 'secops.dashboard:read',
      write: 'secops.dashboard:write'
    },
    requiredFeature: 'platform.aisoc',
  },
  {
    id: 'aisoc-preprocess-rule',
    path: '/admin/aisoc/preprocess-rule',
    element: 'AiSocFrame',
    layout: 'admin',
    platform: 'CNSOC',
    group: '数据预处理',
    title: '预处理规则',
    subtitle: '定义日志数据的清洗、标准化与富化规则',
    icon: 'CodeOutlined',
    order: 30,
    requiredActions: {
      page: 'secops.dashboard:read',
      read: 'secops.dashboard:read',
      write: 'secops.dashboard:write'
    },
    requiredFeature: 'platform.aisoc',
  },
  {
    id: 'aisoc-processed-logs',
    path: '/admin/aisoc/processed-logs',
    element: 'AiSocFrame',
    layout: 'admin',
    platform: 'CNSOC',
    group: '数据预处理',
    title: '预处理后数据',
    subtitle: '查询经过预处理和标准化的安全日志数据',
    icon: 'FileTextOutlined',
    order: 40,
    requiredActions: {
      page: 'secops.dashboard:read',
      read: 'secops.dashboard:read',
      write: 'secops.dashboard:write'
    },
    requiredFeature: 'platform.aisoc',
  },

  // Group: 威胁综合分析
  {
    id: 'aisoc-analysis-events',
    path: '/admin/aisoc/analysis/events',
    element: 'AiSocPlaceholder',
    layout: 'admin',
    platform: 'CNSOC',
    group: '威胁综合分析',
    title: '威胁事件分析',
    subtitle: '基于规则和模型识别出的安全威胁事件',
    icon: 'SafetyCertificateOutlined',
    order: 10,
    requiredActions: {
      page: 'secops.alerts:read',
      read: 'secops.alerts:read',
      write: 'secops.alerts:write'
    },
    requiredFeature: 'platform.aisoc',
  },
  {
    id: 'aisoc-analysis-attack',
    path: '/admin/aisoc/analysis/attack',
    element: 'AiSocPlaceholder',
    layout: 'admin',
    platform: 'CNSOC',
    group: '威胁综合分析',
    title: 'ATT&CK框架分析',
    subtitle: '基于 MITRE ATT&CK 框架的攻击战术与技术分析',
    icon: 'FundProjectionScreenOutlined',
    order: 20,
    requiredActions: {
      page: 'secops.rules:read',
      read: 'secops.rules:read',
      write: 'secops.rules:write'
    },
    requiredFeature: 'platform.aisoc',
  },

  // Group: 报告管理
  {
    id: 'aisoc-report',
    path: '/admin/aisoc/report',
    element: 'AiSocFrame',
    layout: 'admin',
    platform: 'CNSOC',
    group: '报告管理',
    title: '安全报告',
    subtitle: '生成并下载安全运营日报、周报及月报',
    icon: 'CloudDownloadOutlined',
    order: 10,
    requiredActions: {
      page: 'secops.dashboard:read',
      read: 'secops.dashboard:read',
      write: 'secops.dashboard:write'
    },
    requiredFeature: 'platform.aisoc',
  },
  // 租户专线管理功能已迁移到 AISOC 平台，相关路由已移除

  // ============================================================================
  // SETTINGS 平台 (系统设置)
  // ============================================================================
  
  // Group: 权限管控
  {
    id: 'access-roles',
    path: '/admin/access/roles',
    element: 'AccessRolesPage',
    layout: 'admin',
    platform: 'SETTINGS',
    group: '权限管控',
    title: '角色管理',
    subtitle: '按岗位与职责划分可操作范围，支持将同一套权限赋予多名人员，便于统一授权与日常管理。',
    icon: 'SolutionOutlined',
    order: 0,
    requiredActions: {
      page: 'system.roles:read',
      read: 'system.roles:read',
      write: 'system.roles:write'
    },
    homePagePriority: 8
  },
  {
    id: 'access-users',
    path: '/admin/access/users',
    element: 'AccessUsersPage',
    layout: 'admin',
    platform: 'SETTINGS',
    group: '权限管控',
    title: '用户管理',
    subtitle: '管理平台侧用户账号的开通、变更与登录安全，并为每个人指定其岗位职责对应的系统访问范围。',
    icon: 'UserOutlined',
    order: 3,
    requiredActions: {
      page: 'users:read',
      read: 'users:read',
      write: 'users:write'
    },
    homePagePriority: 7
  },
  {
    id: 'settings-security',
    path: '/admin/access/security',
    element: 'SecuritySettings',
    layout: 'admin',
    hidden: true,
    platform: 'SETTINGS',
    group: '权限管控',
    title: '安全管理',
    subtitle: '设定平台管理类账号的登录密码规则与更换周期，降低被盗用风险；租户业务人员的账号不在此处约束。',
    icon: 'SecurityScanOutlined',
    order: 4,
    requiredActions: {
      page: 'system.settings:read',
      read: 'system.settings:read',
      write: 'system.settings:write'
    }
  },

  // Group: 通用设置
  {
    id: 'settings-general',
    path: '/admin/settings/general',
    element: 'GeneralSettings',
    layout: 'admin',
    platform: 'SETTINGS',
    group: '通用设置',
    title: '界面设置',
    subtitle: '自定义工作台导航、登录页外观与主色调等品牌展示，使系统呈现符合本单位视觉与使用习惯。',
    icon: 'SettingOutlined',
    order: 10,
    requiredActions: {
      page: 'system.settings:read',
      read: 'system.settings:read',
      write: 'system.settings:write'
    }
  },
  {
    id: 'settings-offline-upgrade',
    path: '/admin/settings/offline-upgrade',
    element: 'OfflineUpgradeSettings',
    layout: 'admin',
    platform: 'SETTINGS',
    group: '版本升级',
    title: '离线升级',
    subtitle: '上传官方离线 zip 包，将前端静态资源与后端构建产物合并到当前部署目录，用于无外网或受控环境下的版本更新。',
    icon: 'CloudUploadOutlined',
    order: 25,
    requiredActions: {
      page: 'system.upgrade:read',
      read: 'system.upgrade:read',
      write: 'system.upgrade:write'
    }
  },
  {
    id: 'settings-license',
    path: '/admin/settings/license',
    element: 'LicenseSettingsPage',
    layout: 'admin',
    platform: 'SETTINGS',
    group: '通用设置',
    title: '授权管理',
    subtitle: '了解许可有效期、可用能力与使用边界，在扩容或续约时更新许可文件，保障业务在约定范围内持续、合规运行。',
    icon: 'SafetyCertificateOutlined',
    order: 30,
    requiredActions: {
      page: 'system.license:read',
      read: 'system.license:read',
      write: 'system.license:write'
    }
  },

  // Group: 操作审计
  {
    id: 'settings-audit-logs',
    path: '/admin/settings/audit-logs',
    element: 'AuditLogs',
    layout: 'admin',
    platform: 'SETTINGS',
    group: '操作审计',
    title: '操作审计',
    subtitle: '按时间、人员与业务对象追溯关键操作记录，支撑内部检查、责任认定与合规留痕。',
    icon: 'AuditOutlined',
    order: 15,
    requiredActions: {
      page: 'system.audit:read',
      read: 'system.audit:read',
      write: 'system.audit:write'
    },
    homePagePriority: 6
  },

  // Group: 高级集成
  {
    id: 'settings-advanced',
    path: '/admin/settings/advanced',
    element: 'AdvancedSettings',
    layout: 'admin',
    platform: 'SETTINGS',
    group: '高级集成',
    title: '高级集成',
    subtitle: '维护与安全分析、安全运营等外部系统对接所需的访问地址，便于在本平台内直接使用关联能力。',
    icon: 'ApiOutlined',
    order: 20,
    requiredActions: {
      page: 'system.integration:read',
      read: 'system.integration:read',
      write: 'system.integration:write'
    },
    requiredFeature: 'platform.aisoc'
  },

  {
    id: 'settings-desktop-gateway',
    path: '/admin/settings/desktop-gateway',
    element: 'DesktopGatewaySettings',
    layout: 'admin',
    platform: 'SETTINGS',
    group: '高级集成',
    title: '云桌面网关',
    subtitle: '注册云桌面网关，并为多云资源池启用云桌面接入。',
    icon: 'DesktopOutlined',
    order: 21,
    requiredActions: {
      page: 'clouds.desktop:read',
      read: 'clouds.desktop:read',
      write: 'clouds.desktop:write'
    },
  },

  // ============================================================================
  // Harbor 详情页路由
  // ============================================================================

  {
    id: 'harbor-detail',
    path: '/admin/clouds/:cloudId/harbor/:harborId',
    element: 'HarborDetailPage',
    layout: 'admin',
    platform: 'CNMC',
    group: '镜像仓库',
    title: 'Harbor 详情',
    hidden: true,
    requiredActions: {
      page: 'clouds.containers.registries:read',
      read: 'clouds.containers.registries:read',
      write: 'clouds.containers.registries:write',
    }
  },

  ...cloudmapPoolRouteSpecs,
];
