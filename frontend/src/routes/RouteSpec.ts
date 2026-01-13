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
}

export const routeSpecs: RouteSpec[] = [
  // Populating with some inferred routes based on App.tsx usage
  {
    id: 'console',
    path: '/admin/clouds/console',
    element: 'CloudConsolePage',
    layout: 'admin',
    platform: 'CNMC',
    group: '资源控制台',
    title: '云主机控制台',
    icon: 'DesktopOutlined',
    order: 10
  },
  {
    id: 'dashboard',
    path: '/admin/dashboard',
    element: 'Dashboard',
    layout: 'admin',
    platform: 'CNMC',
    group: '资源控制台',
    title: '仪表盘',
    icon: 'DashboardOutlined',
    order: 1
  },
  {
    id: 'topology',
    path: '/admin/topology',
    element: 'Topology',
    layout: 'admin',
    platform: 'CNMC',
    group: '资源控制台',
    title: '算力网络拓扑',
    icon: 'DeploymentUnitOutlined',
    order: 2
  },
  {
    id: 'clouds-list',
    path: '/admin/clouds',
    element: 'Clouds',
    layout: 'admin',
    platform: 'CNMC',
    group: '资源控制台',
    title: '资源池管理',
    subtitle: '统一管理各云资源池的状态与资源，支持监控与运维。',
    icon: 'CloudUploadOutlined',
    order: 3
  },
  {
    id: 'tenants-list',
    path: '/admin/tenants',
    element: 'Tenants',
    layout: 'admin',
    platform: 'CNMC',
    group: '租户管理',
    title: '租户管理',
    icon: 'TeamOutlined',
    order: 1
  },
  {
    id: 'leased-lines',
    path: '/admin/tenants/leased-lines',
    element: 'TenantLeasedLinesPage',
    layout: 'admin',
    platform: 'CNMC',
    group: '租户管理',
    title: '租户专线管理',
    icon: 'BarChartOutlined',
    order: 2
  },
  {
    id: 'tenant-users',
    path: '/admin/tenants/users',
    element: 'Users',
    layout: 'admin',
    platform: 'CNMC',
    group: '租户管理',
    title: '子用户管理',
    icon: 'UserSwitchOutlined',
    order: 3
  },
  {
    id: 'access-policies',
    path: '/admin/access/policies',
    element: 'AccessPoliciesPage',
    layout: 'admin',
    platform: 'CNMC',
    group: '权限管控',
    title: '策略管理',
    icon: 'SafetyCertificateOutlined',
    order: 1
  },
  {
    id: 'access-actions',
    path: '/admin/access/actions',
    element: 'AccessActionsPage',
    layout: 'admin',
    platform: 'CNMC',
    group: '权限管控',
    title: '权限原子',
    icon: 'ApiOutlined',
    order: 0
  },
  {
    id: 'access-roles',
    path: '/admin/access/roles',
    element: 'AccessRolesPage',
    layout: 'admin',
    platform: 'CNMC',
    group: '权限管控',
    title: '角色管理',
    icon: 'SolutionOutlined',
    order: 2
  },
  {
    id: 'access-users',
    path: '/admin/access/users',
    element: 'AccessUsersPage',
    layout: 'admin',
    platform: 'CNMC',
    group: '权限管控',
    title: '用户管理',
    icon: 'UserOutlined',
    order: 3
  },

  // SDNCC Routes
  // Group: 安全管理面
  {
    id: 'security-domain',
    path: '/admin/sec-mgr-plane/security-domain',
    element: 'SecurityDomainPage',
    layout: 'admin',
    platform: 'SDNCC',
    group: '安全管理面',
    title: '安全域管理',
    subtitle: '统一管理多云环境下的安全隔离域',
    icon: 'SafetyCertificateOutlined',
    order: 1
  },
  {
    id: 'cascade-channels',
    path: '/admin/sec-mgr-plane/cascade-channels',
    element: 'CENPage',
    layout: 'admin',
    platform: 'SDNCC',
    group: '安全管理面',
    title: '级联通道管理',
    subtitle: '跨地域、跨云的安全互联通道管理',
    icon: 'ShareAltOutlined',
    order: 2
  },
  {
    id: 'smp-apps',
    path: '/admin/sec-mgr-plane/apps',
    element: 'SecurityApps',
    layout: 'admin',
    platform: 'SDNCC',
    group: '安全管理面',
    title: '应用管理',
    subtitle: '基于微隔离的应用与服务管理',
    icon: 'AppstoreAddOutlined',
    order: 3
  },

  // Group: 跨地域互联
  {
    id: 'interconnect-vr',
    path: '/admin/interconnect/vr',
    element: 'VRPage',
    layout: 'admin',
    platform: 'SDNCC',
    group: '跨地域互联',
    title: 'VR实例管理',
    icon: 'GatewayOutlined',
    order: 1
  },
  {
    id: 'interconnect-srv6',
    path: '/admin/interconnect/srv6',
    element: 'SRv6Page',
    layout: 'admin',
    platform: 'SDNCC',
    group: '跨地域互联',
    title: 'SRv6隧道管理',
    icon: 'NodeIndexOutlined',
    order: 2
  },
  {
    id: 'interconnect-ipsec',
    path: '/admin/interconnect/ipsec',
    element: 'IPsecVPNPage',
    layout: 'admin',
    platform: 'SDNCC',
    group: '跨地域互联',
    title: 'IPsecVPN管理',
    icon: 'LockOutlined',
    order: 3
  },
  {
    id: 'interconnect-acl',
    path: '/admin/interconnect/acl',
    element: 'ACLPage',
    layout: 'admin',
    platform: 'SDNCC',
    group: '跨地域互联',
    title: '网络ACL',
    icon: 'FileTextOutlined',
    order: 4
  },
  {
    id: 'interconnect-nat',
    path: '/admin/interconnect/nat',
    element: 'NATPage',
    layout: 'admin',
    platform: 'SDNCC',
    group: '跨地域互联',
    title: 'NAT管理',
    icon: 'SwapOutlined',
    order: 5
  },

  // Group: 流量编排
  {
    id: 'traffic-protected-objects',
    path: '/admin/security/traffic/protected-objects',
    element: 'ProtectedObjects',
    layout: 'admin',
    platform: 'SDNCC',
    group: '流量编排',
    title: '引流对象管理',
    icon: 'SafetyCertificateOutlined',
    order: 1
  },
  {
    id: 'traffic-service-chains',
    path: '/admin/security/traffic/service-chains',
    element: 'ServiceChains',
    layout: 'admin',
    platform: 'SDNCC',
    group: '流量编排',
    title: '服务链编排',
    icon: 'NodeIndexOutlined',
    order: 2
  },
  {
    id: 'traffic-policies',
    path: '/admin/security/traffic/policies',
    element: 'Policies',
    layout: 'admin',
    platform: 'SDNCC',
    group: '流量编排',
    title: '引流策略管理',
    icon: 'FileTextOutlined',
    order: 3
  },

  {
    id: 'webssh',
    path: '/admin/clouds/:id/webssh',
    element: 'WebSSHPage',
    layout: 'default',
    guard: 'private',
    hidden: true
  },
  {
    id: 'vnc',
    path: '/admin/clouds/:id/harvester/vnc',
    element: 'HarvesterVNCPage',
    layout: 'default',
    guard: 'private',
    hidden: true
  },
  {
    id: 'instance-create',
    path: '/admin/clouds/instances/create',
    element: 'InstanceWizard',
    modalElement: 'InstanceWizardModal',
    layout: 'default',
    guard: 'private',
    backgroundCapable: true,
    hidden: true
  },
  {
    id: 'instance-detail',
    path: '/admin/clouds/:id/instances/:instanceId',
    element: 'InstanceDetail',
    modalElement: 'InstanceDetailModal',
    layout: 'default',
    guard: 'private',
    backgroundCapable: true,
    hidden: true
  },

  // AI SOC Routes
  {
    id: 'aisoc-situation-overview',
    path: '/admin/aisoc/situation/overview',
    element: 'AiSocPlaceholder',
    layout: 'admin',
    platform: 'CNSOC',
    group: '态势中心',
    title: 'AI SOC总览',
    icon: 'RadarChartOutlined',
    order: 10
  },
  {
    id: 'aisoc-preprocessing-raw',
    path: '/admin/aisoc/preprocessing/raw',
    element: 'AiSocPlaceholder',
    layout: 'admin',
    platform: 'CNSOC',
    group: '数据预处理',
    title: '原始数据预览',
    icon: 'DatabaseOutlined',
    order: 10
  },
  {
    id: 'aisoc-preprocessing-rules',
    path: '/admin/aisoc/preprocessing/rules',
    element: 'AiSocPlaceholder',
    layout: 'admin',
    platform: 'CNSOC',
    group: '数据预处理',
    title: '预处理规则',
    icon: 'FileTextOutlined',
    order: 20
  },
  {
    id: 'aisoc-analysis-events',
    path: '/admin/aisoc/analysis/events',
    element: 'AiSocPlaceholder',
    layout: 'admin',
    platform: 'CNSOC',
    group: '威胁综合分析',
    title: '威胁事件分析',
    icon: 'SafetyCertificateOutlined',
    order: 10
  },
  {
    id: 'aisoc-analysis-attack',
    path: '/admin/aisoc/analysis/attack',
    element: 'AiSocPlaceholder',
    layout: 'admin',
    platform: 'CNSOC',
    group: '威胁综合分析',
    title: 'ATT&CK框架分析',
    icon: 'FundProjectionScreenOutlined',
    order: 20
  },
  {
    id: 'aisoc-reports-download',
    path: '/admin/aisoc/reports/download',
    element: 'AiSocPlaceholder',
    layout: 'admin',
    platform: 'CNSOC',
    group: '安全报告',
    title: '报告下载',
    icon: 'CloudDownloadOutlined',
    order: 10
  }
];
