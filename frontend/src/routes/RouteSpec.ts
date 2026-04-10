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
}

export const routeSpecs: RouteSpec[] = [
  // ============================================================================
  // CNMC 平台 (多云管理平台)
  // ============================================================================
  
  // Group: 资源池管理
  {
    id: 'dashboard',
    path: '/admin/dashboard',
    element: 'OverviewDashboard',
    layout: 'admin',
    platform: 'CNMC',
    group: '资源池管理',
    title: '资源总览',
    subtitle: '展示全局资源统计概览，包括资源池数量、云主机数量、容器集群数量、VPC网络数量等关键指标，提供多维度数据可视化与实时监控。',
    icon: 'DashboardOutlined',
    order: 0,
    requiredActions: {
      page: 'clouds.dashboard:read',
      read: 'clouds.dashboard:read',
      write: 'clouds.dashboard:write'
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
    group: '资源池管理',
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
    requiredFeature: 'platform.default',
    homePagePriority: 2
  },
  {
    id: 'console',
    path: '/console',
    element: 'CloudConsolePage',
    layout: 'admin',
    platform: 'CNMC',
    group: '资源控制台',
    title: '资源控制台',
    subtitle: '提供统一的资源控制台访问入口，支持通过 Web SSH 或 VNC 等方式远程连接与管理云主机，实现跨资源池的统一运维体验。',
    breadcrumbLabel: '资源控制台',
    icon: 'DesktopOutlined',
    requiredActions: {
      page: 'clouds.console:read',
      read: 'clouds.console:read',
      write: 'clouds.console:write'
    },
    order: 10,
    requiredFeature: 'platform.multi-cloud',
    homePagePriority: 3
  },

  // Group: 租户管理
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
    requiredFeature: 'sys.tenant-mgmt',
    homePagePriority: 4
  },
  {
    id: 'tenant-organizations',
    path: '/admin/tenants/:tenantId/organizations',
    element: 'OrgManagePage',
    layout: 'admin',
    platform: 'CNMC',
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
    platform: 'CNMC',
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
    id: 'webssh',
    path: '/admin/clouds/:id/webssh',
    element: 'WebSSHPage',
    layout: 'default',
    guard: 'private',
    platform: 'CNMC',
    group: '资源控制台',
    hidden: true,
    requiredActions: {
      page: 'clouds.console:read',
      read: 'clouds.console:read',
      write: 'clouds.console:write'
    }
  },
  {
    id: 'vnc',
    path: '/admin/clouds/:id/harvester/vnc',
    element: 'HarvesterVNCPage',
    layout: 'default',
    guard: 'private',
    platform: 'CNMC',
    group: '资源控制台',
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
    group: '资源控制台',
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
    group: '资源池管理',
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
    group: '资源池管理',
    hidden: true,
    requiredActions: {
      page: 'clouds.vm-create-wizard:write',
      read: 'clouds.ecs:read',
      write: 'clouds.vm-create-wizard:write'
    }
  },
  {
    id: 'instance-detail',
    path: '/admin/clouds/:id/instances/:instanceId',
    element: 'InstanceDetail',
    modalElement: 'InstanceDetailModal',
    layout: 'default',
    guard: 'private',
    backgroundCapable: true,
    platform: 'CNMC',
    group: '资源控制台',
    hidden: true,
    requiredActions: {
      page: 'clouds.console:read',
      read: 'clouds.console:read',
      write: 'clouds.console:write'
    }
  },
  {
    id: 'instance-detail-pure',
    path: '/clouds/:id/instances/:instanceId',
    element: 'InstanceDetail',
    modalElement: 'InstanceDetailModal',
    layout: 'default',
    guard: 'private',
    backgroundCapable: true,
    platform: 'CNMC',
    group: '资源控制台',
    hidden: true,
    requiredActions: {
      page: 'clouds.console:read',
      read: 'clouds.console:read',
      write: 'clouds.console:write'
    }
  },

  // ============================================================================
  // SDNCC 平台 (SDN 控制中心)
  // ============================================================================
  
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
    order: 1,
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
    group: '安全管理面',
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
    id: 'cascade-channels',
    path: '/admin/sec-mgr-plane/cascade-channels',
    element: 'CENPage',
    layout: 'admin',
    platform: 'SDNCC',
    group: '安全管理面',
    title: '级联通道管理',
    subtitle: '管理跨地域、跨云环境的安全互联通道（CEN），支持 Mesh 和 Hub-Spoke 两种拓扑模式，实现安全域之间的网络连通与策略编排，提供通道状态监控与性能指标展示。',
    icon: 'ShareAltOutlined',
    order: 2,
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
    subtitle: '基于微隔离技术实现应用与服务的精细化安全管理，支持应用分组、服务发现、访问策略配置，通过零信任网络模型保障应用间的安全隔离与访问控制。',
    icon: 'AppstoreAddOutlined',
    order: 3,
    requiredActions: {
      page: 'security.apps:read',
      read: 'security.apps:read',
      write: 'security.apps:write'
    },
    requiredFeature: 'sdn.cascade',
  },
  {
    id: 'security-services',
    path: '/admin/sec-mgr-plane/security-services',
    element: 'SecurityServices',
    layout: 'admin',
    platform: 'SDNCC',
    group: '安全管理面',
    title: '安全服务管理',
    subtitle: '管理 CSM 安全资源池中的安全服务（安全网元组），包括防火墙、IPS、WAF 等安全组件的统一生命周期管理，支持服务状态监控、配置管理与资源分配。',
    icon: 'SafetyCertificateOutlined',
    order: 4,
    requiredActions: {
      page: 'security.services:read',
      read: 'security.services:read',
      write: 'security.services:write'
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
    subtitle: 'VR（Virtual Router）实例用于在多云与异构网络之间提供路由与互联能力，支持跨区域连通、BGP/静态路由、策略与监控，帮助实现稳定、安全、高效的网络连接。',
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
    subtitle: 'VR 配置的专家模式，用于分步查询、编辑与下发配置；支持标准化预览、模板分段编辑、启用/禁用配置点，以及保存到平台或直接下发到设备，适用于高级网络工程师进行精细化配置管理。',
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
    subtitle: '配置 VR 实例的 PE（Provider Edge）模式参数，包括 SRv6 标识（SID）、公网与内网接口绑定、静态路由配置、私网 BGP 邻居设置等，用于构建跨域互联的核心节点。',
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
    subtitle: '配置 VR 实例的 CE（Customer Edge）模式参数，包括外网接口与内网接口的基础网络参数设置，用于连接用户侧网络与运营商网络。',
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
    subtitle: '配置 VR 实例的标准模式参数，预置 IPsec VPN 所需的非协商参数（如预共享密钥、加密算法等），用于后续 IPsec 连接建立时的快速预填与自动化配置。',
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
    subtitle: '配置 VR 实例的 SASE（Secure Access Service Edge）模式参数，用于构建安全访问服务边缘架构，实现零信任网络访问与统一安全策略管理。',
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
    subtitle: 'SRv6（Segment Routing over IPv6）用于在 IPv6 网络中实现基于段的路由，支持灵活的流量工程与业务编排。',
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
    subtitle: '通过 IKEv1/IKEv2 协议创建加密虚拟专用网络，支持拓扑查看、配置审计和状态监控，保障跨网络数据传输安全。',
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
    subtitle: '配置基于优先级的访问控制规则，支持 TCP/UDP/ICMP 协议过滤和源/目的地址匹配，实现网络流量的精细化管控。',
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
    subtitle: '创建 SNAT/DNAT/静态 NAT 规则，实现私网地址与公网地址的转换，支持接口绑定和地址段映射，解决内网主机访问公网需求。',
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
    id: 'traffic-protected-objects',
    path: '/admin/security/traffic/protected-objects',
    element: 'ProtectedObjects',
    layout: 'admin',
    platform: 'SDNCC',
    group: '流量编排',
    title: '防护对象管理（CSM 资产）',
    subtitle: '对已接入的 CSM 安全资源池中的防护对象（资产）进行统一生命周期管理，包括资产发现、纳管、分组、状态监控与配置管理，支持按安全域、类型等维度进行筛选。',
    icon: 'SafetyCertificateOutlined',
    order: 1,
    requiredActions: {
      page: 'security.services:read',
      read: 'security.services:read',
      write: 'security.services:write'
    },
    requiredFeature: 'sdn.traffic',
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
    order: 2,
    requiredActions: {
      page: 'security.services:read',
      read: 'security.services:read',
      write: 'security.services:write'
    },
    requiredFeature: 'sdn.traffic',
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
    order: 3,
    requiredActions: {
      page: 'security.services:read',
      read: 'security.services:read',
      write: 'security.services:write'
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
    subtitle: '角色用于将权限策略批量授权给用户或租户；在授权配置中可查看并勾选全部权限原子。',
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
    subtitle: '管理系统级用户账号，包括创建、编辑、删除用户，重置密码，为用户分配 RBAC 角色，实现基于角色的访问控制（RBAC），适用于平台管理员、运维人员等系统级账号管理。',
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
    subtitle: '配置平台管理员账号的密码复杂度与有效期策略（不含租户用户）。',
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
    subtitle: '配置系统基础设置，包括界面外观主题、通知偏好、网络连接参数、语言设置等用户个性化选项，以及系统级别的通用配置参数。',
    icon: 'SettingOutlined',
    order: 10,
    requiredActions: {
      page: 'system.settings:read',
      read: 'system.settings:read',
      write: 'system.settings:write'
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
    subtitle: '查看系统授权状态、资源配额限制（如资源池数量、用户数量等），导入新的授权文件，管理授权有效期，监控授权使用情况，确保系统在授权范围内正常运行。',
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
    subtitle: '查看系统操作审计日志，记录并追踪所有用户的操作行为、资源变更历史、API 调用记录等，支持按时间、用户、操作类型等维度进行查询和筛选，满足合规审计与安全追溯需求。',
    icon: 'AuditOutlined',
    order: 15,
    requiredActions: {
      page: 'system.audit:read',
      read: 'system.audit:read',
      write: 'system.audit:read'
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
    subtitle: '管理第三方服务的集成配置参数，包括 AI SOC（安全运营中心）、Dify 工作流等外部系统的 API 地址、认证信息、同步策略等集成参数，实现平台与外部系统的数据互通与功能联动。',
    icon: 'ApiOutlined',
    order: 20,
    requiredActions: {
      page: 'system.integration:read',
      read: 'system.integration:read',
      write: 'system.integration:write'
    },
    requiredFeature: 'platform.aisoc'
  }
];
