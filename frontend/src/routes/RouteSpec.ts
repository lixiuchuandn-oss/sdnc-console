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
    breadcrumbLabel: '云主机控制台',
    icon: 'DesktopOutlined',
    requiredActions: {
      page: 'clouds.console:read',
      read: 'clouds.console:read',
      write: 'clouds.console:write'
    },
    order: 10
  },
  {
    id: 'dashboard',
    path: '/admin/dashboard',
    element: 'OverviewDashboard',
    layout: 'admin',
    platform: 'CNMC',
    group: '资源控制台',
    title: '仪表板',
    icon: 'DashboardOutlined',
    order: 1
  },
  {
    id: 'sdn-dashboard',
    path: '/admin/sdn-dashboard',
    element: 'SdnDashboard',
    layout: 'admin',
    platform: 'SDNCC',
    group: '跨地域互联',
    title: 'SDN总览',
    icon: 'SafetyCertificateOutlined',
    order: 0,
    requiredFeature: 'sdn.interconnect'
  },
  {
    id: 'clouds-list',
    path: '/admin/clouds',
    element: 'Clouds',
    layout: 'admin',
    platform: 'CNMC',
    group: '资源控制台',
    title: '资源池管理',
    breadcrumbLabel: '资源池管理',
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
    subtitle: '租户（Tenant）用于隔离不同组织或项目的资源与权限，支持组织架构、用户与角色管理、资源池分配等。',
    icon: 'TeamOutlined',
    requiredActions: {
      page: 'tenants:read',
      read: 'tenants:read',
      write: 'tenants:write'
    },
    order: 1,
    requiredFeature: 'sys.tenant-mgmt'
  },
  {
    id: 'tenant-organizations',
    path: '/admin/tenants/:tenantId/organizations',
    element: 'OrgManagePage',
    layout: 'admin',
    platform: 'CNMC',
    group: '租户管理',
    title: '组织管理',
    breadcrumbLabel: '组织管理',
    hidden: true,
    parentId: 'tenants-list',
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
    requiredActions: {
      page: 'users:read',
      read: 'users:read',
      write: 'users:write'
    },
    order: 3,
    requiredFeature: 'sys.tenant-mgmt'
  },
  {
    id: 'access-actions',
    path: '/admin/access/actions',
    element: 'AccessActionsPage',
    layout: 'admin',
    platform: 'CNMC',
    group: '权限管控',
    title: '功能权限',
    subtitle: '列出后端提供的 API 级别功能点，供策略组合与角色授权使用。',
    icon: 'ApiOutlined',
    order: 0,
    requiredFeature: 'sys.rbac-advanced'
  },
  {
    id: 'access-roles',
    path: '/admin/access/roles',
    element: 'AccessRolesPage',
    layout: 'admin',
    platform: 'CNMC',
    group: '权限管控',
    title: '角色管理',
    subtitle: '角色用于将权限策略批量授权给用户或租户，便于统一管理与快速复用。',
    icon: 'SolutionOutlined',
    order: 2,
    requiredFeature: 'sys.rbac-advanced'
  },
  {
    id: 'access-users',
    path: '/admin/access/users',
    element: 'AccessUsersPage',
    layout: 'admin',
    platform: 'CNMC',
    group: '权限管控',
    title: '用户管理',
    subtitle: '管理系统用户并为其赋予访问控制角色',
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
    subtitle: '构建跨多云环境的统一安全边界，通过逻辑隔离与策略编排，实现对 VPC、办公网及扁平网络等异构资产的精细化防护与全生命周期管理。',
    icon: 'ClusterOutlined',
    order: 1
  },
  {
    id: 'security-domain-detail',
    path: '/admin/sec-mgr-plane/security-domain/:id',
    element: 'SecurityDomainDetail',
    layout: 'admin',
    platform: 'SDNCC',
    group: '安全管理面',
    title: '安全域详情',
    breadcrumbLabel: '详情',
    hidden: true,
    parentId: 'security-domain',
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
  {
    id: 'security-services',
    path: '/admin/sec-mgr-plane/security-services',
    element: 'SecurityServices',
    layout: 'admin',
    platform: 'SDNCC',
    group: '安全管理面',
    title: '安全服务管理',
    subtitle: '列出所有CSM安全池的安全服务(安全网元组)',
    icon: 'SafetyCertificateOutlined',
    order: 4
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
    subtitle: 'VR（Virtual Router）实例用于在多云与异构网络之间提供路由与互联能力，支持跨区域连通、BGP/静态路由、策略与监控，帮助实现稳定、安全、高效的网络连接。',
    icon: 'GatewayOutlined',
    order: 1
  },
  {
    id: 'interconnect-vr-add',
    path: '/admin/interconnect/vr/add',
    element: 'AddVRInstance',
    layout: 'admin',
    platform: 'SDNCC',
    group: '跨地域互联',
    title: '新增 VR 实例',
    breadcrumbLabel: '新增 VR 实例',
    parentId: 'interconnect-vr',
    hidden: true,
  },
  {
    id: 'interconnect-vr-config',
    path: '/admin/interconnect/vr/:uuid/config',
    element: 'EditVRConfig',
    layout: 'admin',
    platform: 'SDNCC',
    group: '跨地域互联',
    title: '专家模式',
    breadcrumbLabel: '专家模式',
    subtitle: '用于分步查询、编辑与下发 VR 配置；支持标准化预览、模板分段编辑、启用/禁用配置点，以及保存到平台或直接下发',
    parentId: 'interconnect-vr',
    icon: 'SettingOutlined',
    hidden: true,
  },
  {
    id: 'interconnect-vr-role-pe',
    path: '/admin/interconnect/vr/:uuid/role-pe',
    element: 'PEWizard',
    layout: 'admin',
    platform: 'SDNCC',
    group: '跨地域互联',
    title: '设置角色（PE模式）',
    breadcrumbLabel: '设置角色（PE模式）',
    parentId: 'interconnect-vr',
    icon: 'SettingOutlined',
    subtitle: '设定 SRv6 标识、公网与内网接口、静态路由与私网BGP',
    hidden: true,
  },
  {
    id: 'interconnect-vr-role-ce',
    path: '/admin/interconnect/vr/:uuid/role-ce',
    element: 'CEWizard',
    layout: 'admin',
    platform: 'SDNCC',
    group: '跨地域互联',
    title: '设置角色（CE模式）',
    breadcrumbLabel: '设置角色（CE模式）',
    parentId: 'interconnect-vr',
    icon: 'SettingOutlined',
    subtitle: '设定外网与内网接口基础参数',
    hidden: true,
  },
  {
    id: 'interconnect-vr-role-standard',
    path: '/admin/interconnect/vr/:uuid/role-standard',
    element: 'StandardWizard',
    layout: 'admin',
    platform: 'SDNCC',
    group: '跨地域互联',
    title: '设置角色（标准模式）',
    breadcrumbLabel: '设置角色（标准模式）',
    parentId: 'interconnect-vr',
    icon: 'SettingOutlined',
    subtitle: '预置 IPsec 所需的非协商参数，用于后续建链快速预填',
    hidden: true,
  },
  {
    id: 'interconnect-vr-role-sase',
    path: '/admin/interconnect/vr/:uuid/role-sase',
    element: 'SASEWizard',
    layout: 'admin',
    platform: 'SDNCC',
    group: '跨地域互联',
    title: '设置角色（SASE模式）',
    breadcrumbLabel: '设置角色（SASE模式）',
    parentId: 'interconnect-vr',
    icon: 'SettingOutlined',
    hidden: true,
  },
  {
    id: 'interconnect-srv6',
    path: '/admin/interconnect/srv6',
    element: 'SRv6Page',
    layout: 'admin',
    platform: 'SDNCC',
    group: '跨地域互联',
    title: 'SRv6隧道管理',
    subtitle: 'SRv6（Segment Routing over IPv6）用于在 IPv6 网络中实现基于段的路由，支持灵活的流量工程与业务编排。',
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
    subtitle: '通过 IKEv1/IKEv2 协议创建加密虚拟专用网络，支持拓扑查看、配置审计和状态监控，保障跨网络数据传输安全。',
    icon: 'LockOutlined',
    order: 3
  },
  {
    id: 'interconnect-ipsec-create',
    path: '/admin/interconnect/ipsec/create',
    element: 'IPsecVPNWizard',
    layout: 'admin',
    platform: 'SDNCC',
    group: '跨地域互联',
    title: '新建IPsecVPN连接',
    breadcrumbLabel: '新建连接',
    parentId: 'interconnect-ipsec',
    hidden: true,
  },
  {
    id: 'interconnect-ipsec-edit',
    path: '/admin/interconnect/ipsec/:id/edit',
    element: 'IPsecVPNWizard',
    layout: 'admin',
    platform: 'SDNCC',
    group: '跨地域互联',
    title: '编辑IPsecVPN连接',
    breadcrumbLabel: '编辑连接',
    parentId: 'interconnect-ipsec',
    hidden: true,
  },
  {
    id: 'interconnect-acl',
    path: '/admin/interconnect/acl',
    element: 'ACLPage',
    layout: 'admin',
    platform: 'SDNCC',
    group: '跨地域互联',
    title: 'ACL 访问控制列表',
    subtitle: '配置基于优先级的访问控制规则，支持 TCP/UDP/ICMP 协议过滤和源/目的地址匹配，实现网络流量的精细化管控。',
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
    title: 'NAT 网络地址转换',
    subtitle: '创建 SNAT/DNAT/静态 NAT 规则，实现私网地址与公网地址的转换，支持接口绑定和地址段映射，解决内网主机访问公网需求。',
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
    title: '防护对象管理（CSM 资产）',
    subtitle: '直接对已接入的 CSM 安全资源池资产进行统一生命周期管理',
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
    title: '服务链管理',
    subtitle: '服务链（Service Chain）通过灵活编排网络流量经过防火墙、IPS、WAF 等安全组件，实现业务流量的按需清洗与防护，支持串行阻断与旁路检测模式。',
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
    subtitle: '统一配置引流策略与阻断策略，实现对流量的灵活调度、牵引清洗及安全阻断，全方位保障网络安全与业务连续性。',
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
    id: 'vnc-pure',
    path: '/clouds/:id/harvester/vnc',
    element: 'HarvesterVNCPage',
    layout: 'default',
    guard: 'private',
    hidden: true
  },
  {
    id: 'instance-create',
    path: '/admin/clouds/:id/instances/create',
    element: 'InstanceWizard',
    modalElement: 'InstanceWizardModal',
    layout: 'default',
    guard: 'private',
    backgroundCapable: true,
    hidden: true
  },
  {
    id: 'instance-create-pure',
    path: '/clouds/:id/instances/create',
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
  {
    id: 'instance-detail-pure',
    path: '/clouds/:id/instances/:instanceId',
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
    subtitle: '全网安全态势的实时监控与可视化大屏',
    icon: 'RadarChartOutlined',
    order: 10
  },
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
    order: 10
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
    order: 20
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
    order: 30
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
    order: 40
  },
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
    subtitle: '基于 MITRE ATT&CK 框架的攻击战术与技术分析',
    icon: 'FundProjectionScreenOutlined',
    order: 20
  },
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
    order: 10
  },
  // 租户专线管理功能已迁移到 AISOC 平台，相关路由已移除

  // Settings Platform Routes
  {
    id: 'settings-general',
    path: '/admin/settings/general',
    element: 'GeneralSettings',
    layout: 'admin',
    platform: 'SETTINGS',
    group: '通用设置',
    title: '通用设置',
    subtitle: '配置系统外观、通知偏好、网络连接等基础选项。',
    icon: 'SettingOutlined',
    order: 10
  },
  {
    id: 'settings-audit-logs',
    path: '/admin/settings/audit-logs',
    element: 'AuditLogs',
    layout: 'admin',
    platform: 'SETTINGS',
    group: '通用设置',
    title: '操作审计',
    subtitle: '查看系统操作审计日志，追踪用户行为与资源变更。',
    icon: 'AuditOutlined',
    order: 15
  },
  {
    id: 'settings-advanced',
    path: '/admin/settings/advanced',
    element: 'AdvancedSettings',
    layout: 'admin',
    platform: 'SETTINGS',
    group: '高级集成',
    title: '高级集成',
    subtitle: '管理 AI SOC、Dify 工作流等第三方服务的集成参数。',
    icon: 'ApiOutlined',
    order: 20
  },
  {
    id: 'settings-license',
    path: '/admin/settings/license',
    element: 'LicenseSettingsPage',
    layout: 'admin',
    platform: 'SETTINGS',
    group: '授权管理',
    title: '授权管理',
    subtitle: '查看系统授权状态、资源配额限制，或导入新的授权文件。',
    icon: 'SafetyCertificateOutlined',
    order: 30
  }
];
