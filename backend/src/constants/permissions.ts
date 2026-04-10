/**
 * ============================================================================
 * 权限原子定义 (Permission Atoms Definition)
 * ============================================================================
 * 
 * 【重要说明】
 * 这是权限数据的单一数据源（Single Source of Truth），定义了系统中所有权限原子。
 * 新权限体系（backend/src/permissions/）基于此文件生成完整的权限定义。
 * 
 * 【数据流】
 * constants/permissions.ts (数据源)
 *     ↓
 * permissions/definitions.ts (生成权限定义)
 *     ↓
 * permissions/registry.ts (权限注册表)
 *     ↓
 * permissions/checker.ts (权限检查器)
 * 
 * 【权限原子命名规范】
 * 格式：{domain}.{feature}:{verb}
 * - domain: 功能域（如 clouds, tenants, system）
 * - feature: 具体功能（如 instances, roles, settings）
 * - verb: 操作类型（read=读取, write=写入）
 * 
 * 【权限分组说明】
 * 1. CNMC 平台 - 多云管理平台
 *    - 资源池管理：云资源管理相关权限
 *    - 资源控制台（分组）：资源控制台页面与运维视图等相关权限（与「资源池管理」分组并列）
 *    - 租户管理：多租户管理相关权限
 *    - 权限管控：RBAC 权限管理相关权限
 * 
 * 2. SDNCC 平台 - SDN 控制中心
 *    - 安全管理面：安全域、CEN、安全服务等
 *    - 跨域互联：SRv6、VR 配置、ACL 等
 * 
 * 3. CNSOC 平台 - AI SOC 安全运营中心
 *    - 态势中心：安全态势、告警、规则等
 *
 * 【新平台接入策略（Cloudmap First）】
 * - 其他平台新增资源能力时，优先复用 Cloudmap 既有权限原子（clouds.*）。
 * - 仅当语义无法复用时，才新增平台个性化权限常量，并在注释中说明不可复用原因。
 * - 新增权限常量时，必须同步更新：
 *   1) ALL_PERMISSIONS
 *   2) PERMISSION_GROUPS
 *   3) backend/src/permissions/definitions.ts（名称映射）
 *   4) frontend/src/utils/permissionUtils.ts（资源池管理 / 资源控制台 分组展示顺序以该文件为准；PERMISSION_GROUPS 应对齐）
 * 
 * 【使用位置】
 * - permissions/definitions.ts - 生成权限定义
 * - routes/system.ts - 权限扫描 API
 * - seeders/initRoles.ts - 角色初始化
 * 
 * ============================================================================
 */

/**
 * 所有权限原子列表
 * 用于：
 * 1. 角色初始化时过滤权限
 * 2. 权限扫描 API 输出
 * 3. 前端权限管理页面展示
 */
export const ALL_PERMISSIONS = [
  // ============================================================================
  // CNMC 平台 (多云管理平台 - Cloud Native Multi-Cloud)
  // ============================================================================
  
  // ──────────────────────────────────────────────────────────────────────────
  // 分组：资源池管理（CNMC · 多云资源）
  // ──────────────────────────────────────────────────────────────────────────
  
  // 资源总览
  'clouds.dashboard:read',     // 资源总览页面 - 查看
  'clouds.dashboard:write',    // 资源总览页面 - 编辑
  
  // 资源池管理（列表与详情页入口；与 Tab 级 clouds.* 原子解耦，便于按角色隐藏指定 Tab）
  'clouds.resource-pools:read',   // 资源池管理页面 - 查看列表与进入详情
  'clouds.resource-pools:write', // 资源池管理页面 - 创建/编辑/删除资源池
  
  // 云资源全量（最高）：等价于拥有全部 clouds.* 读写能力；细粒度角色请勿勾选此项以免 Tab 门控失效
  'clouds:read',
  'clouds:write',
  
  // 云主机管理
  'clouds.ecs:read',           // 云主机列表 - 查看
  'clouds.ecs:write',          // 云主机管理 - 创建/启动/停止/删除
  /** 虚拟机创建向导（分步 /instances/create），与 clouds.ecs:write 解耦，便于单独门控 */
  'clouds.vm-create-wizard:write',
  /** Cloudmap 资源池：标准/运维视图切换（运维含命名空间、ACL、运维抽屉等） */
  'clouds.cloudmap.ops-view:write',
  // 扁平网络（新命名）
  'clouds.eips.flat:read',
  'clouds.eips.flat:write',
  'clouds.fips.flat:read',
  'clouds.fips.flat:write',
  'clouds.dnat.flat:read',
  'clouds.dnat.flat:write',
  'clouds.snat.flat:read',
  'clouds.snat.flat:write',
  'clouds.traffic-mirroring.flat:read',
  'clouds.traffic-mirroring.flat:write',
  'clouds.security-groups.flat:read',
  'clouds.security-groups.flat:write',

  // 虚拟私有云 (VPC)
  'clouds.vpcs:read',          // VPC 列表 - 查看
  'clouds.vpcs:write',         // VPC 管理 - 创建/编辑/删除

  // 子网
  'clouds.subnets:read',       // 子网列表 - 查看
  'clouds.subnets:write',      // 子网管理 - 创建/编辑/删除
  /** Kube-OVN 子网按 tower.io/subnet-type 拆分（与前端门控一致；父级 clouds.subnets 仍保留兼容） */
  'clouds.subnets.vpc:read',
  'clouds.subnets.vpc:write',
  'clouds.subnets.flat:read',
  'clouds.subnets.flat:write',
  'clouds.subnets.public:read',
  'clouds.subnets.public:write',

  // VPC 网络（新命名）
  'clouds.eips.vpc:read',
  'clouds.eips.vpc:write',
  'clouds.fips.vpc:read',
  'clouds.fips.vpc:write',
  'clouds.dnat.vpc:read',
  'clouds.dnat.vpc:write',
  'clouds.snat.vpc:read',
  'clouds.snat.vpc:write',
  'clouds.traffic-mirroring.vpc:read',
  'clouds.traffic-mirroring.vpc:write',
  'clouds.security-groups.vpc:read',
  'clouds.security-groups.vpc:write',

  // 虚拟云盘
  'clouds.disks:read',         // 虚拟云盘列表 - 查看
  'clouds.disks:write',        // 虚拟云盘管理 - 创建/挂载/卸载/删除
  
  // 负载均衡
  'clouds.load-balancers:read',     // 负载均衡列表 - 查看
  'clouds.load-balancers:write',   // 负载均衡管理 - 创建/配置/删除
  
  // 镜像管理
  'clouds.images:read',        // 镜像列表 - 查看
  'clouds.images:write',       // 镜像管理 - 上传/删除

  // 模板
  'clouds.templates:read',     // 模板列表 - 查看
  'clouds.templates:write',    // 模板管理 - 创建/编辑/删除

  // Cloud Init
  'clouds.cloudinits:read',    // Cloud Init 列表 - 查看
  'clouds.cloudinits:write',   // Cloud Init 管理 - 创建/编辑/删除
  
  // SSH 密钥
  'clouds.sshkeys:read',       // SSH 密钥列表 - 查看
  'clouds.sshkeys:write',      // SSH 密钥管理 - 创建/删除
  
  // 定时任务
  'clouds.schedules:read',     // 定时任务列表 - 查看
  'clouds.schedules:write',    // 定时任务管理 - 创建/编辑/删除

  // 恢复任务（细化）
  'clouds.restore-tasks:read',  // 恢复任务列表 - 查看
  'clouds.restore-tasks:write', // 恢复任务管理 - 执行/取消
  
  // 命名空间
  'clouds.namespaces:read',    // 命名空间列表 - 查看
  'clouds.namespaces:write',   // 命名空间管理 - 创建/编辑/删除

  // 集群物理节点
  'clouds.cluster-nodes:read',  // 物理节点列表 - 查看
  'clouds.cluster-nodes:write', // 物理节点管理 - 操作维护

  // 集群基础服务
  'clouds.cluster-services:read',  // 基础服务列表 - 查看
  'clouds.cluster-services:write', // 基础服务管理 - 操作维护

  // 集群网络
  'clouds.cluster-networks:read',  // 集群网络列表 - 查看
  'clouds.cluster-networks:write', // 集群网络管理 - 操作维护

  // 物理网络（Provider Network）
  'clouds.provider-networks:read',  // 物理网络列表 - 查看
  'clouds.provider-networks:write', // 物理网络管理 - 创建/编辑/删除

  // 网络附加定义 (NAD - Network Attachment Definition)，与基础网络能力归并展示
  'clouds.nads:read',          // NAD 列表 - 查看
  'clouds.nads:write',         // NAD 管理 - 创建/编辑/删除
  
  // 虚拟交换机
  'clouds.vswitches:read',     // 虚拟交换机列表 - 查看
  'clouds.vswitches:write',    // 虚拟交换机管理 - 创建/编辑/删除
  
  // 弹性网卡 (ENI - Elastic Network Interface)
  'clouds.enis:read',          // 弹性网卡列表 - 查看
  'clouds.enis:write',         // 弹性网卡管理 - 创建/绑定/删除
  
  // 网络 ACL
  'clouds.network-acls:read',  // 网络 ACL 列表 - 查看
  'clouds.network-acls:write', // 网络 ACL 管理 - 创建/编辑规则/删除
  
  // 云盘快照
  'clouds.snapshots:read',     // 云盘快照列表 - 查看
  'clouds.snapshots:write',    // 云盘快照管理 - 创建/恢复/删除

  // 整机快照备份
  'clouds.backups:read',       // 整机快照备份列表/策略列表 - 查看
  'clouds.backups:write',      // 整机快照备份管理 - 创建/恢复/删除/策略维护

  // 回收站
  'clouds.recycle-bin:read',   // 回收站记录 - 查看
  'clouds.recycle-bin:write',  // 回收站操作 - 恢复/彻底删除

  // 迁移记录
  'clouds.migrations:read',    // 迁移记录 - 查看
  'clouds.migrations:write',   // 迁移任务 - 发起/取消
  
  // 路由表
  'clouds.route-tables:read',  // 路由表列表 - 查看
  'clouds.route-tables:write', // 路由表管理 - 创建/编辑/删除
  
  // 路由条目
  'clouds.route-entries:read', // 路由条目列表 - 查看
  'clouds.route-entries:write', // 路由条目管理 - 创建/编辑/删除
  
  // VLAN 网络
  'clouds.vlans:read',         // VLAN 列表 - 查看
  'clouds.vlans:write',        // VLAN 管理 - 创建/编辑/删除
  

  // 存储池（StorageClass）
  'clouds.storage-classes:read',  // 存储池列表 - 查看
  'clouds.storage-classes:write', // 存储池管理 - 创建/编辑/删除

  // GPU 资源
  'clouds.gpus:read',          // GPU 资源列表 - 查看
  'clouds.gpus:write',         // GPU 资源管理 - 分配/回收

  // USB 设备
  'clouds.usb-devices:read',   // USB 设备列表 - 查看
  'clouds.usb-devices:write',  // USB 设备管理 - 分配/回收

  // PCI 设备
  'clouds.pci-devices:read',   // PCI 设备列表 - 查看
  'clouds.pci-devices:write',  // PCI 设备管理 - 分配/回收

  // 监控 - 告警列表
  'clouds.alerts:read',        // 告警列表 - 查看
  'clouds.alerts:write',       // 告警列表 - 处理/确认

  // 监控 - 告警规则
  'clouds.alert-rules:read',   // 告警规则列表 - 查看
  'clouds.alert-rules:write',  // 告警规则管理 - 创建/编辑/删除

  // 监控 - 告警通知策略
  'clouds.alert-policies:read',  // 告警通知策略列表 - 查看
  'clouds.alert-policies:write', // 告警通知策略管理 - 创建/编辑/删除

  // 监控 - 告警通知对象
  'clouds.alert-receivers:read',  // 告警通知对象列表 - 查看
  'clouds.alert-receivers:write', // 告警通知对象管理 - 创建/编辑/删除

  // 监控 - 告警密钥
  'clouds.alert-secrets:read',  // 告警密钥列表 - 查看
  'clouds.alert-secrets:write', // 告警密钥管理 - 创建/编辑/删除

  // 日志 - 采集对象
  'clouds.log-targets:read',   // 日志采集对象列表 - 查看
  'clouds.log-targets:write',  // 日志采集对象管理 - 创建/编辑/删除

  // 日志 - 接收端
  'clouds.log-receivers:read',  // 日志接收端列表 - 查看
  'clouds.log-receivers:write', // 日志接收端管理 - 创建/编辑/删除

  // 日志 - 采集配置
  'clouds.log-configs:read',   // 日志采集配置列表 - 查看
  'clouds.log-configs:write',  // 日志采集配置管理 - 创建/编辑/删除
  
  // 资源控制台（页面）
  'clouds.console:read',       // 资源控制台 - 访问
  'clouds.console:write',       // 资源控制台 - 操作（如执行命令）
  
  // ──────────────────────────────────────────────────────────────────────────
  // 分组：租户管理 (Tenant Management)
  // ──────────────────────────────────────────────────────────────────────────
  
  // 租户管理
  'tenants:read',             // 租户列表 - 查看
  'tenants:write',            // 租户管理 - 创建/编辑/删除
  
  // 组织管理（租户下的组织架构管理）
  'organizations:read',       // 组织列表 - 查看
  'organizations:write',      // 组织管理 - 创建/编辑/删除
  
  // 租户侧组织用户管理（租户空间下的组织账号）
  'tenant-users:read',        // 组织用户列表 - 查看
  'tenant-users:write',       // 组织用户管理 - 创建/编辑/删除/重置密码
  
  // 平台系统用户管理（平台级系统账号）
  'users:read',               // 系统用户列表 - 查看
  'users:write',              // 系统用户管理 - 创建/编辑/删除/重置密码
  
  // 用户空间管理
  'user-spaces:read',          // 用户空间列表 - 查看
  'user-spaces:write',         // 用户空间管理 - 创建/编辑/删除/分配资源
  
  // ──────────────────────────────────────────────────────────────────────────
  // 分组：权限管控 (RBAC - Role-Based Access Control)
  // ──────────────────────────────────────────────────────────────────────────
  
  // 角色管理
  'system.roles:read',         // 角色列表 - 查看
  'system.roles:write',        // 角色管理 - 创建/编辑/删除
  
  // 角色分配管理
  'system.roles.assignments:read',  // 角色分配列表 - 查看
  'system.roles.assignments:write', // 角色分配管理 - 分配/取消分配
  
  // 权限动作管理
  'system.actions:read',       // 权限动作列表 - 查看
  'system.actions:write',      // 权限动作管理 - 创建/编辑/删除
  
  // RBAC 管理（通用）
  'system.rbac:read',          // RBAC 相关功能 - 查看
  'system.rbac:write',         // RBAC 相关功能 - 编辑
  
  // 操作审计
  'system.audit:read',         // 操作审计日志 - 查看
  
  // 系统设置
  'system.settings:read',      // 系统设置 - 查看
  'system.settings:write',     // 系统设置 - 编辑
  
  // 授权管理
  'system.license:read',       // 授权管理 - 查看
  'system.license:write',      // 授权管理 - 编辑
  
  // 高级集成
  'system.integration:read',   // 高级集成 - 查看
  'system.integration:write',  // 高级集成 - 编辑
  
  // ============================================================================
  // SDNCC 平台 (SDN 控制中心 - Software Defined Network Control Center)
  // ============================================================================
  
  // ──────────────────────────────────────────────────────────────────────────
  // 分组：安全管理面 (Security Management Plane)
  // ──────────────────────────────────────────────────────────────────────────
  
  // 安全域
  'networks.security-domain:read',  // 安全域列表 - 查看
  'networks.security-domain:write', // 安全域管理 - 创建/编辑/删除
  
  // 云企业网 (CEN - Cloud Enterprise Network)
  'networks.cen:read',         // CEN 列表 - 查看
  'networks.cen:write',        // CEN 管理 - 创建/编辑/删除
  
  // CEN 连接管理
  'networks.cen.attachments:read',  // CEN 连接列表 - 查看
  'networks.cen.attachments:write', // CEN 连接管理 - 创建/编辑/删除
  
  // 安全服务
  'security.services:read',    // 安全服务列表 - 查看
  'security.services:write',   // 安全服务管理 - 创建/编辑/删除
  
  // 安全应用
  'security.apps:read',         // 安全应用列表 - 查看
  'security.apps:write',       // 安全应用管理 - 创建/编辑/删除
  
  // ──────────────────────────────────────────────────────────────────────────
  // 分组：跨域互联 (Cross-Domain Interconnection)
  // ──────────────────────────────────────────────────────────────────────────
  
  // SRv6 网络
  'networks.srv6:read',        // SRv6 网络列表 - 查看
  'networks.srv6:write',       // SRv6 网络管理 - 创建/配置/删除
  
  // VR 配置 (Virtual Router)
  'networks.vr-config:read',   // VR 配置列表 - 查看
  'networks.vr-config:write',  // VR 配置管理 - 创建/编辑/删除
  
  // 访问控制列表 (ACL)
  'networks.acl:read',         // ACL 列表 - 查看
  'networks.acl:write',         // ACL 管理 - 创建/编辑规则/删除
  
  // IPsec VPN
  'networks.ipsec:read',       // IPsec VPN 列表 - 查看
  'networks.ipsec:write',      // IPsec VPN 管理 - 创建/编辑/删除
  
  // NAT 网关
  'networks.nat:read',          // NAT 网关列表 - 查看
  'networks.nat:write',         // NAT 网关管理 - 创建/配置/删除
  
  // ============================================================================
  // CNSOC 平台 (AI SOC 安全运营中心 - Cloud Native Security Operations Center)
  // ============================================================================
  
  // ──────────────────────────────────────────────────────────────────────────
  // 分组：态势中心 (Security Situation Center)
  // ──────────────────────────────────────────────────────────────────────────
  
  // 安全态势总览
  'secops.dashboard:read',     // 安全态势总览 - 查看
  'secops.dashboard:write',     // 安全态势总览 - 配置
  
  // 安全告警
  'secops.alerts:read',         // 安全告警列表 - 查看
  'secops.alerts:write',       // 安全告警管理 - 处理/忽略/标记
  
  // 安全规则
  'secops.rules:read',         // 安全规则列表 - 查看
  'secops.rules:write',         // 安全规则管理 - 创建/编辑/删除
] as const;

/**
 * 权限分组定义
 * 用于前端权限管理页面的分组展示
 */
export const PERMISSION_GROUPS = {
  // CNMC 平台
  CNMC: {
    '资源池管理': [
      'clouds',
      'clouds.dashboard',
      'clouds.resource-pools',
      'clouds.ecs',
      'clouds.vm-create-wizard',
      'clouds.images',
      'clouds.templates',
      'clouds.cloudinits',
      'clouds.sshkeys',
      'clouds.recycle-bin',
      'clouds.migrations',
      'clouds.disks',
      'clouds.snapshots',
      'clouds.backups',
      'clouds.schedules',
      'clouds.restore-tasks',
      'clouds.provider-networks',
      'clouds.vlans',
      'clouds.nads',
      'clouds.subnets.public',
      'clouds.subnets.flat',
      'clouds.eips.flat',
      'clouds.fips.flat',
      'clouds.dnat.flat',
      'clouds.snat.flat',
      'clouds.traffic-mirroring.flat',
      'clouds.security-groups.flat',
      'clouds.vpcs',
      'clouds.subnets.vpc',
      'clouds.eips.vpc',
      'clouds.fips.vpc',
      'clouds.dnat.vpc',
      'clouds.snat.vpc',
      'clouds.traffic-mirroring.vpc',
      'clouds.security-groups.vpc',
      'clouds.load-balancers',
      'clouds.vswitches',
      'clouds.enis',
      'clouds.route-tables',
      'clouds.route-entries',
      'clouds.network-acls',
      'clouds.cluster-nodes',
      'clouds.cluster-services',
      'clouds.cluster-networks',
      'clouds.namespaces',
      'clouds.storage-classes',
      'clouds.gpus',
      'clouds.usb-devices',
      'clouds.pci-devices',
      'clouds.alerts',
      'clouds.alert-rules',
      'clouds.alert-policies',
      'clouds.alert-receivers',
      'clouds.alert-secrets',
      'clouds.log-targets',
      'clouds.log-receivers',
      'clouds.log-configs',
    ],
    '资源控制台': ['clouds.console', 'clouds.cloudmap.ops-view'],
    '租户管理': [
      'tenants',
      'organizations',
      'tenant-users',
      'user-spaces',
    ],
  },
  // SETTINGS 平台
  SETTINGS: {
    '权限管控': [
      'system.roles',
      'system.roles.assignments',
      'system.actions',
      'system.rbac',
      'users',
    ],
    '通用设置': [
      'system.settings',
    ],
    '操作审计': [
      'system.audit',
    ],
    '高级集成': [
      'system.integration',
    ],
  },
  // SDNCC 平台
  SDNCC: {
    '安全管理面': [
      'networks.security-domain',
      'networks.cen',
      'networks.cen.attachments',
      'security.services',
      'security.apps',
    ],
    '跨域互联': [
      'networks.srv6',
      'networks.vr-config',
      'networks.acl',
      'networks.ipsec',
      'networks.nat',
    ],
  },
  // CNSOC 平台
  CNSOC: {
    '态势中心': [
      'secops.dashboard',
      'secops.alerts',
      'secops.rules',
    ],
  },
} as const;

/**
 * 根据权限前缀获取平台
 */
export function getPlatformByPermission(permission: string): string | null {
  const prefix = permission.split(':')[0];
  
  // SETTINGS 平台（系统设置相关权限）
  if (prefix.startsWith('system.')) {
    return 'SETTINGS';
  }
  
  // CNMC 平台
  if (prefix.startsWith('ops.') || 
      prefix.startsWith('clouds') || 
      prefix.startsWith('tenants') || 
      prefix.startsWith('organizations') ||
      prefix.startsWith('tenant-users') ||
      prefix.startsWith('user-spaces')) {
    return 'CNMC';
  }
  
  // SETTINGS 平台（系统用户管理）
  if (prefix.startsWith('users')) {
    return 'SETTINGS';
  }
  
  // SDNCC 平台
  if (prefix.startsWith('networks.') || prefix.startsWith('security.')) {
    return 'SDNCC';
  }
  
  // CNSOC 平台
  if (prefix.startsWith('secops.')) {
    return 'CNSOC';
  }
  
  return null;
}

/**
 * 根据权限前缀获取分组
 */
export function getGroupByPermission(permission: string): string | null {
  const prefix = permission.split(':')[0];
  
  // CNMC 平台
  if (prefix.startsWith('clouds')) {
    if (prefix === 'clouds.console' || prefix.startsWith('clouds.cloudmap')) {
      return '资源控制台';
    }
    return '资源池管理';
  }
  if (prefix.startsWith('tenants') || prefix.startsWith('organizations') || prefix.startsWith('tenant-users') || prefix.startsWith('user-spaces')) {
    return '租户管理';
  }
  
  // SETTINGS 平台
  if (prefix === 'system.settings') {
    return '通用设置';
  }
  if (prefix === 'system.license') {
    return '通用设置';
  }
  if (prefix === 'system.integration') {
    return '高级集成';
  }
  if (prefix === 'system.audit') {
    return '操作审计';
  }
  if (prefix.startsWith('system.') || prefix.startsWith('users')) {
    return '权限管控';
  }
  
  // SDNCC 平台
  if (prefix.startsWith('networks.security-domain') || 
      prefix.startsWith('networks.cen') || 
      prefix.startsWith('security.')) {
    return '安全管理面';
  }
  if (prefix.startsWith('networks.srv6') || 
      prefix.startsWith('networks.vr-config') || 
      prefix.startsWith('networks.acl') ||
      prefix.startsWith('networks.ipsec') ||
      prefix.startsWith('networks.nat')) {
    return '跨域互联';
  }
  
  // CNSOC 平台
  if (prefix.startsWith('secops.')) {
    return '态势中心';
  }
  
  return null;
}
