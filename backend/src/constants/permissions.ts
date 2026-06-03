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
 * 1. CNMC 平台（多云管理）
 *    - 多云管理：平台级页面（多云总览、资源池列表等）
 *    - Cloudmap资源池：池内 Tab / clouds.* 细粒度原子（抽屉按侧栏 poolNavGroup 展示）
 *
 * 1b. TENANTS 平台 - 租户管理（与 CNMC 顶栏入口并列）
 *    - 租户管理：租户、组织、租户组织用户、用户空间等权限
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
 *   4) frontend/src/utils/permissionUtils.ts（多云管理 / Cloudmap资源池 / 租户控制台 分组展示顺序以该文件为准；PERMISSION_GROUPS 应对齐）
 *
 * 【使用位置】
 * - permissions/definitions.ts - 生成权限定义
 * - routes/system.ts - /rbac/actions 等 RBAC 辅助接口
 * - seeders/initRoles.ts - 角色初始化
 *
 * ============================================================================
 */

/**
 * 所有权限原子列表
 * 用于：
 * 1. 角色初始化时过滤权限
 * 2. /rbac/actions 等接口输出
 * 3. 前端权限管理页面展示
 */
export const ALL_PERMISSIONS = [
  // ============================================================================
  // CNMC 平台 (多云管理平台 - Cloud Native Multi-Cloud)
  // ============================================================================

  // ──────────────────────────────────────────────────────────────────────────
  // 分组：多云管理（CNMC 平台级页面）
  // ──────────────────────────────────────────────────────────────────────────

  // 多云总览（纯展示；仅 read，无 write）
  'clouds.dashboard:read',

  // 资源池列表页（/admin/clouds；与池内 Tab 级 clouds.* 解耦）
  'clouds.resource-pools:read',
  'clouds.resource-pools:write',

  // 云资源全量（最高）：等价于拥有全部 clouds.* 读写能力；细粒度角色请勿勾选此项以免 Tab 门控失效
  'clouds:read',
  'clouds:write',

  // 云主机管理
  'clouds.ecs:read', // 云主机列表 - 查看
  'clouds.ecs:write', // 云主机管理 - 创建/启动/停止/删除
  /** 虚拟机创建向导（分步 /instances/create），与 clouds.ecs:write 解耦，便于单独门控 */
  'clouds.vm-create-wizard:write',
  /** 云主机列表「快速创建」弹窗（SimpleVmCreate），与 clouds.ecs:write 解耦，便于单独门控 */
  'clouds.vm-quick-create:write',
  // 扁平网络（新命名）
  'clouds.eips.flat:read',
  'clouds.eips.flat:write',
  'clouds.dnat.flat:read',
  'clouds.dnat.flat:write',
  'clouds.snat.flat:read',
  'clouds.snat.flat:write',
  'clouds.traffic-mirroring.flat:read',
  'clouds.traffic-mirroring.flat:write',
  'clouds.security-groups.flat:read',
  'clouds.security-groups.flat:write',

  // 虚拟私有云 (VPC)；与 clouds.subnets.* 解耦（VPC 写不隐含子网写）
  'clouds.vpcs:read', // VPC 列表 - 查看
  'clouds.vpcs:write', // VPC 管理 - 创建/编辑/删除

  // 子网（Kube-OVN；独立授权，见 clouds.subnets.vpc/flat/public）
  'clouds.subnets:read', // 子网列表 - 查看
  'clouds.subnets:write', // 子网管理 - 创建/编辑/删除
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
  'clouds.dnat.vpc:read',
  'clouds.dnat.vpc:write',
  'clouds.snat.vpc:read',
  'clouds.snat.vpc:write',
  'clouds.traffic-mirroring.vpc:read',
  'clouds.traffic-mirroring.vpc:write',
  'clouds.security-groups.vpc:read',
  'clouds.security-groups.vpc:write',

  // 虚拟云盘
  'clouds.disks:read', // 虚拟云盘列表 - 查看
  'clouds.disks:write', // 虚拟云盘管理 - 创建/挂载/卸载/删除

  // 负载均衡
  'clouds.load-balancers:read', // 负载均衡列表 - 查看
  'clouds.load-balancers:write', // 负载均衡管理 - 创建/配置/删除

  // 镜像管理
  'clouds.images:read', // 镜像列表 - 查看
  'clouds.images:write', // 镜像管理 - 上传/删除

  // 模板
  'clouds.templates:read', // 模板列表 - 查看
  'clouds.templates:write', // 模板管理 - 创建/编辑/删除

  // Cloud Init
  'clouds.cloudinits:read', // Cloud Init 列表 - 查看
  'clouds.cloudinits:write', // Cloud Init 管理 - 创建/编辑/删除

  // SSH 密钥
  'clouds.sshkeys:read', // SSH 密钥列表 - 查看
  'clouds.sshkeys:write', // SSH 密钥管理 - 创建/删除

  // 定时策略（虚拟机定时备份）
  'clouds.schedules:read', // 定时备份策略列表 - 查看
  'clouds.schedules:write', // 定时备份策略管理 - 创建/编辑/删除

  // 恢复任务（细化）
  'clouds.restore-tasks:read', // 恢复任务列表 - 查看
  'clouds.restore-tasks:write', // 恢复任务管理 - 执行/取消

  // 命名空间
  'clouds.namespaces:read', // 命名空间列表 - 查看
  'clouds.namespaces:write', // 命名空间管理 - 创建/编辑/删除

  // 容器服务（Harvester/K8s：可按子域细粒度授权；clouds:read/write 亦覆盖；历史 clouds.containers:* 仍兼容）
  'clouds.containers.workloads:read',
  'clouds.containers.workloads:write',
  'clouds.containers.pods:read',
  'clouds.containers.pods:write',
  'clouds.containers.jobs:read',
  'clouds.containers.jobs:write',
  'clouds.containers.services:read',
  'clouds.containers.services:write',
  'clouds.containers.ingresses:read',
  'clouds.containers.ingresses:write',
  'clouds.containers.gateway:read',
  'clouds.containers.gateway:write',
  'clouds.containers.configs:read',
  'clouds.containers.configs:write',
  'clouds.containers.registries:read',
  'clouds.containers.registries:write',
  'clouds.containers.pdbs:read',
  'clouds.containers.pdbs:write',
  'clouds.containers.networkpolicies:read',
  'clouds.containers.networkpolicies:write',

  // 集群物理节点
  'clouds.cluster-nodes:read', // 物理节点列表 - 查看
  'clouds.cluster-nodes:write', // 物理节点管理 - 操作维护
  'clouds.failure-domains:read', // 故障域 - 查看
  'clouds.failure-domains:write', // 故障域 - 管理
  'clouds.storage-drs:read', // 存储 DRS（SDRS）- 查看
  'clouds.storage-drs:write', // 存储 DRS（SDRS）- 管理

  // 集群网络
  'clouds.cluster-networks:read', // 集群网络列表 - 查看
  'clouds.cluster-networks:write', // 集群网络管理 - 操作维护

  // 物理网络（Provider Network）
  'clouds.provider-networks:read', // 物理网络列表 - 查看
  'clouds.provider-networks:write', // 物理网络管理 - 创建/编辑/删除

  // 网络附加定义 (NAD - Network Attachment Definition)，与基础网络能力归并展示
  'clouds.nads:read', // NAD 列表 - 查看
  'clouds.nads:write', // NAD 管理 - 创建/编辑/删除

  // IP 地址池 (LoadBalancer IPPool)，独立于 NAD 网络权限
  'clouds.ip-pools:read', // IP 地址池列表 - 查看
  'clouds.ip-pools:write', // IP 地址池管理 - 创建/删除

  // 虚拟交换机
  'clouds.vswitches:read', // 虚拟交换机列表 - 查看
  'clouds.vswitches:write', // 虚拟交换机管理 - 创建/编辑/删除

  // 弹性网卡 (ENI - Elastic Network Interface)
  'clouds.enis:read', // 弹性网卡列表 - 查看
  'clouds.enis:write', // 弹性网卡管理 - 创建/绑定/删除

  // 网络 ACL
  'clouds.network-acls:read', // 网络 ACL 列表 - 查看
  'clouds.network-acls:write', // 网络 ACL 管理 - 创建/编辑规则/删除

  // 云盘快照
  'clouds.snapshots:read', // 云盘快照列表 - 查看
  'clouds.snapshots:write', // 云盘快照管理 - 创建/恢复/删除

  // 云主机备份（历史 clouds.backups 总权仍保留，兼容旧角色）
  'clouds.backups:read', // 云主机备份列表 - 查看
  'clouds.backups:write', // 云主机备份管理 - 创建/删除/恢复
  'clouds.vm-backup-snapshots:read', // 云主机快照列表 - 查看
  'clouds.vm-backup-snapshots:write', // 云主机快照管理 - 创建/删除/恢复
  // 回收站
  'clouds.recycle-bin:read', // 回收站记录 - 查看
  'clouds.recycle-bin:write', // 回收站操作 - 恢复/彻底删除

  // 迁移记录
  'clouds.migrations:read', // 迁移记录 - 查看
  'clouds.migrations:write', // 迁移任务 - 发起/取消

  // 路由表
  'clouds.route-tables:read', // 路由表列表 - 查看
  'clouds.route-tables:write', // 路由表管理 - 创建/编辑/删除

  // 路由条目
  'clouds.route-entries:read', // 路由条目列表 - 查看
  'clouds.route-entries:write', // 路由条目管理 - 创建/编辑/删除

  // VLAN 网络
  'clouds.vlans:read', // VLAN 列表 - 查看
  'clouds.vlans:write', // VLAN 管理 - 创建/编辑/删除

  // 存储池（StorageClass）
  'clouds.storage-classes:read', // 存储池列表 - 查看
  'clouds.storage-classes:write', // 存储池管理 - 创建/编辑/删除

  // GPU 资源
  'clouds.gpus:read', // GPU 资源列表 - 查看
  'clouds.gpus:write', // GPU 资源管理 - 分配/回收

  // USB 设备
  'clouds.usb-devices:read', // USB 设备列表 - 查看
  'clouds.usb-devices:write', // USB 设备管理 - 分配/回收

  // PCI 设备
  'clouds.pci-devices:read', // PCI 设备列表 - 查看
  'clouds.pci-devices:write', // PCI 设备管理 - 分配/回收

  // 监控 - 资源池内「资源总览 · 总览」大盘（节点/存储/Ceph 指标等；与告警 Tab 解耦）
  'clouds.monitoring.overview:read',
  'clouds.monitoring.overview:write',

  // 资源总览 · 机房拓扑（机柜/柜内占位；与集群物理节点/交换机管理解耦）
  'clouds.dc-topology:read',
  'clouds.dc-topology:write',

  // 资源总览 · 网络拓扑（纯展示；与物理网络/集群网络管理 Tab 解耦）
  'clouds.net-topology:read',

  // 统一存储（/api/clouds/:id/ceph/*；权限 ID 不含 ceph）
  'clouds.unified-storage:read',
  'clouds.unified-storage:write',
  'clouds.storage-dashboard:read',
  'clouds.storage-dashboard:write',
  'clouds.storage-addon:read',
  'clouds.storage-addon:write',
  'clouds.unified-storage-pools:read',
  'clouds.unified-storage-pools:write',
  'clouds.storage-rbd-mirror:read',
  'clouds.storage-rbd-mirror:write',
  'clouds.storage-s3-buckets:read',
  'clouds.storage-s3-buckets:write',
  'clouds.storage-rgw-users:read',
  'clouds.storage-rgw-users:write',
  'clouds.storage-object-gateway:read',
  'clouds.storage-object-gateway:write',
  'clouds.storage-cosi:read',
  'clouds.storage-cosi:write',

  // Cloudmap · 云数据库（PaaS VM；当前含 RDS，后续可扩展 NoSQL 等；数据面仍走 clouds.ecs API）
  'clouds.paas-databases:read',
  'clouds.paas-databases:write',

  // Cloudmap · 虚拟网元（虚拟路由器；底层为带 VNE 标签的 VM，API 仍为 harvester/vms）
  'clouds.vne:read',
  'clouds.vne:write',

  // 监控 - 告警列表
  'clouds.alerts:read', // 告警列表 - 查看
  'clouds.alerts:write', // 告警列表 - 处理/确认

  // 监控 - 告警规则
  'clouds.alert-rules:read', // 告警规则列表 - 查看
  'clouds.alert-rules:write', // 告警规则管理 - 创建/编辑/删除

  // 监控 - 告警通知策略
  'clouds.alert-policies:read', // 告警通知策略列表 - 查看
  'clouds.alert-policies:write', // 告警通知策略管理 - 创建/编辑/删除

  // 监控 - 告警通知对象
  'clouds.alert-receivers:read', // 告警通知对象列表 - 查看
  'clouds.alert-receivers:write', // 告警通知对象管理 - 创建/编辑/删除

  // 监控 - 告警密钥
  'clouds.alert-secrets:read', // 告警密钥列表 - 查看
  'clouds.alert-secrets:write', // 告警密钥管理 - 创建/编辑/删除

  // 日志 - 采集对象
  'clouds.log-targets:read', // 日志采集对象列表 - 查看
  'clouds.log-targets:write', // 日志采集对象管理 - 创建/编辑/删除

  // 日志 - 接收端
  'clouds.log-receivers:read', // 日志接收端列表 - 查看
  'clouds.log-receivers:write', // 日志接收端管理 - 创建/编辑/删除

  // 日志 - 采集配置
  'clouds.log-configs:read', // 日志采集配置列表 - 查看
  'clouds.log-configs:write', // 日志采集配置管理 - 创建/编辑/删除

  // 云桌面（网关配置、云桌面用户、VM 分配；统一权限）
  'clouds.desktop:read',
  'clouds.desktop:write',

  // ──────────────────────────────────────────────────────────────────────────
  // Harbor 镜像仓库管理
  // ──────────────────────────────────────────────────────────────────────────

  // Harbor 实例管理
  'harbor:registry:read', // Harbor 实例列表 - 查看
  'harbor:registry:create', // Harbor 实例 - 创建
  'harbor:registry:update', // Harbor 实例 - 编辑
  'harbor:registry:delete', // Harbor 实例 - 删除

  // Harbor 项目管理
  'harbor:project:create', // Harbor 项目 - 创建
  'harbor:project:update', // Harbor 项目 - 编辑
  'harbor:project:delete', // Harbor 项目 - 删除

  // Harbor 镜像管理
  'harbor:image:push', // Harbor 镜像 - 推送
  'harbor:image:delete', // Harbor 镜像 - 删除

  // Harbor 漏洞扫描
  'harbor:scan:trigger', // Harbor 漏洞扫描 - 触发

  // ============================================================================
  // TENANTS 平台 · 租户管理 (Tenant Management)
  // ============================================================================
  // ──────────────────────────────────────────────────────────────────────────
  // 分组：租户管理
  // ──────────────────────────────────────────────────────────────────────────

  // 租户管理
  'tenants:read', // 租户列表 - 查看
  'tenants:write', // 租户管理 - 创建/编辑/删除

  // 组织管理（租户下的组织架构管理）
  'organizations:read', // 组织列表 - 查看
  'organizations:write', // 组织管理 - 创建/编辑/删除

  // 租户侧组织用户管理（租户空间下的组织账号）
  'tenant-users:read', // 组织用户列表 - 查看
  'tenant-users:write', // 组织用户管理 - 创建/编辑/删除/重置密码

  // 平台系统用户管理（平台级系统账号）
  'users:read', // 系统用户列表 - 查看
  'users:write', // 系统用户管理 - 创建/编辑/删除/重置密码

  // ──────────────────────────────────────────────────────────────────────────
  // 分组：权限管控 (RBAC - Role-Based Access Control)
  // ──────────────────────────────────────────────────────────────────────────

  // 角色管理
  'system.roles:read', // 角色列表 - 查看
  'system.roles:write', // 角色管理 - 创建/编辑/删除

  // 角色分配管理
  'system.roles.assignments:read', // 角色分配列表 - 查看
  'system.roles.assignments:write', // 角色分配管理 - 分配/取消分配

  // 权限动作管理
  'system.actions:read', // 权限动作列表 - 查看
  'system.actions:write', // 权限动作管理 - 创建/编辑/删除

  // RBAC 管理（通用）
  'system.rbac:read', // RBAC 相关功能 - 查看
  'system.rbac:write', // RBAC 相关功能 - 编辑

  // 操作审计
  'system.audit:read', // 操作审计日志 - 查看
  'system.audit:write', // 操作审计日志 - 管理（预留写权限位）

  // 系统设置
  'system.settings:read', // 系统设置 - 查看
  'system.settings:write', // 系统设置 - 编辑

  // 离线版本升级（上传 zip 合并 public/server）
  'system.upgrade:read', // 离线升级 - 查看状态
  'system.upgrade:write', // 离线升级 - 上传并应用

  // 授权管理
  'system.license:read', // 授权管理 - 查看
  'system.license:write', // 授权管理 - 编辑

  // 高级集成
  'system.integration:read', // 高级集成 - 查看
  'system.integration:write', // 高级集成 - 编辑

  // ============================================================================
  // SDNCC 平台 (SDN 控制中心 - Software Defined Network Control Center)
  // ============================================================================

  // ──────────────────────────────────────────────────────────────────────────
  // 分组：安全管理面 (Security Management Plane)
  // ──────────────────────────────────────────────────────────────────────────

  // 安全域
  'networks.security-domain:read', // 安全域列表 - 查看
  'networks.security-domain:write', // 安全域管理 - 创建/编辑/删除

  // 云企业网 (CEN - Cloud Enterprise Network)
  'networks.cen:read', // CEN 列表 - 查看
  'networks.cen:write', // CEN 管理 - 创建/编辑/删除

  // CEN 连接管理
  'networks.cen.attachments:read', // CEN 连接列表 - 查看
  'networks.cen.attachments:write', // CEN 连接管理 - 创建/编辑/删除

  // 安全服务
  'security.services:read', // 安全服务列表 - 查看
  'security.services:write', // 安全服务管理 - 创建/编辑/删除

  // 安全应用
  'security.apps:read', // 安全应用列表 - 查看
  'security.apps:write', // 安全应用管理 - 创建/编辑/删除

  // ──────────────────────────────────────────────────────────────────────────
  // 分组：跨域互联 (Cross-Domain Interconnection)
  // ──────────────────────────────────────────────────────────────────────────

  // SRv6 网络
  'networks.srv6:read', // SRv6 网络列表 - 查看
  'networks.srv6:write', // SRv6 网络管理 - 创建/配置/删除

  // VR 配置 (Virtual Router)
  'networks.vr-config:read', // VR 配置列表 - 查看
  'networks.vr-config:write', // VR 配置管理 - 创建/编辑/删除

  // 访问控制列表 (ACL)
  'networks.acl:read', // ACL 列表 - 查看
  'networks.acl:write', // ACL 管理 - 创建/编辑规则/删除

  // IPsec VPN
  'networks.ipsec:read', // IPsec VPN 列表 - 查看
  'networks.ipsec:write', // IPsec VPN 管理 - 创建/编辑/删除

  // NAT 网关
  'networks.nat:read', // NAT 网关列表 - 查看
  'networks.nat:write', // NAT 网关管理 - 创建/配置/删除

  // ============================================================================
  // CNSOC 平台 (AI SOC 安全运营中心 - Cloud Native Security Operations Center)
  // ============================================================================

  // ──────────────────────────────────────────────────────────────────────────
  // 分组：态势中心 (Security Situation Center)
  // ──────────────────────────────────────────────────────────────────────────

  // 安全态势总览
  'secops.dashboard:read', // 安全态势总览 - 查看
  'secops.dashboard:write', // 安全态势总览 - 配置

  // 安全告警
  'secops.alerts:read', // 安全告警列表 - 查看
  'secops.alerts:write', // 安全告警管理 - 处理/忽略/标记

  // 安全规则
  'secops.rules:read', // 安全规则列表 - 查看
  'secops.rules:write', // 安全规则管理 - 创建/编辑/删除
] as const;

/**
 * 权限分组定义
 * 用于前端权限管理页面的分组展示
 */
export const PERMISSION_GROUPS = {
  // CNMC 平台
  CNMC: {
    多云管理: ['clouds', 'clouds.dashboard', 'clouds.resource-pools'],
    Cloudmap资源池: [
      'clouds.ecs',
      'clouds.desktop',
      'clouds.vm-create-wizard',
      'clouds.vm-quick-create',
      'clouds.images',
      'clouds.templates',
      'clouds.cloudinits',
      'clouds.sshkeys',
      'clouds.recycle-bin',
      'clouds.migrations',
      'clouds.containers.workloads',
      'clouds.containers.pods',
      'clouds.containers.jobs',
      'clouds.containers.services',
      'clouds.containers.ingresses',
      'clouds.containers.gateway',
      'clouds.containers.configs',
      'clouds.containers.registries',
      'clouds.containers.pdbs',
      'clouds.containers.networkpolicies',
      'harbor.registry',
      'harbor.project',
      'harbor.image',
      'harbor.scan',
      'clouds.disks',
      'clouds.snapshots',
      'clouds.backups',
      'clouds.vm-backup-snapshots',
      'clouds.schedules',
      'clouds.restore-tasks',
      'clouds.provider-networks',
      'clouds.vlans',
      'clouds.nads',
      'clouds.ip-pools',
      'clouds.subnets.public',
      'clouds.subnets.flat',
      'clouds.eips.flat',
      'clouds.dnat.flat',
      'clouds.snat.flat',
      'clouds.traffic-mirroring.flat',
      'clouds.security-groups.flat',
      'clouds.vpcs',
      'clouds.subnets.vpc',
      'clouds.eips.vpc',
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
      'clouds.failure-domains',
      'clouds.storage-drs',
      'clouds.cluster-networks',
      'clouds.namespaces',
      'clouds.storage-classes',
      'clouds.gpus',
      'clouds.usb-devices',
      'clouds.pci-devices',
      'clouds.monitoring.overview',
      'clouds.dc-topology',
      'clouds.net-topology',
      'clouds.unified-storage',
      'clouds.storage-dashboard',
      'clouds.storage-addon',
      'clouds.unified-storage-pools',
      'clouds.storage-rbd-mirror',
      'clouds.storage-s3-buckets',
      'clouds.storage-rgw-users',
      'clouds.storage-object-gateway',
      'clouds.storage-cosi',
      'clouds.paas-databases',
      'clouds.vne',
      'clouds.alerts',
      'clouds.alert-rules',
      'clouds.alert-policies',
      'clouds.alert-receivers',
      'clouds.alert-secrets',
      'clouds.log-targets',
      'clouds.log-receivers',
      'clouds.log-configs',
    ],
  },
  // TENANTS 平台（多租户管理）
  TENANTS: {
    租户管理: ['tenants', 'organizations', 'tenant-users'],
  },
  // SETTINGS 平台
  SETTINGS: {
    权限管控: [
      'system.roles',
      'system.roles.assignments',
      'system.actions',
      'system.rbac',
      'users',
    ],
    通用设置: ['system.settings'],
    版本升级: ['system.upgrade'],
    操作审计: ['system.audit'],
    高级集成: ['system.integration'],
  },
  // SDNCC 平台
  SDNCC: {
    安全管理面: [
      'networks.security-domain',
      'networks.cen',
      'networks.cen.attachments',
      'security.services',
      'security.apps',
    ],
    跨域互联: [
      'networks.srv6',
      'networks.vr-config',
      'networks.acl',
      'networks.ipsec',
      'networks.nat',
    ],
  },
  // CNSOC 平台
  CNSOC: {
    态势中心: ['secops.dashboard', 'secops.alerts', 'secops.rules'],
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

  // TENANTS 平台（多租户）
  if (
    prefix.startsWith('tenants') ||
    prefix.startsWith('organizations') ||
    prefix.startsWith('tenant-users')
  ) {
    return 'TENANTS';
  }

  // CNMC 平台（含 Harbor 镜像仓库 · 容器业务域；Harbor 权限 ID 为 harbor:registry:read 形式）
  if (
    prefix.startsWith('ops.') ||
    prefix.startsWith('clouds') ||
    prefix === 'harbor' ||
    prefix.startsWith('harbor.')
  ) {
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

  // CNMC / 资源池
  if (prefix.startsWith('clouds')) {
    if (
      prefix === 'clouds' ||
      prefix === 'clouds.dashboard' ||
      prefix === 'clouds.resource-pools'
    ) {
      return '多云管理';
    }
    return 'Cloudmap资源池';
  }
  // TENANTS 平台 · 租户管理分组
  if (
    prefix.startsWith('tenants') ||
    prefix.startsWith('organizations') ||
    prefix.startsWith('tenant-users')
  ) {
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
  if (prefix === 'system.upgrade') {
    return '版本升级';
  }
  if (prefix === 'system.audit') {
    return '操作审计';
  }
  if (prefix.startsWith('system.') || prefix.startsWith('users')) {
    return '权限管控';
  }

  // SDNCC 平台
  if (
    prefix.startsWith('networks.security-domain') ||
    prefix.startsWith('networks.cen') ||
    prefix.startsWith('security.')
  ) {
    return '安全管理面';
  }
  if (
    prefix.startsWith('networks.srv6') ||
    prefix.startsWith('networks.vr-config') ||
    prefix.startsWith('networks.acl') ||
    prefix.startsWith('networks.ipsec') ||
    prefix.startsWith('networks.nat')
  ) {
    return '跨域互联';
  }

  // CNSOC 平台
  if (prefix.startsWith('secops.')) {
    return '态势中心';
  }

  // Harbor 镜像仓库（CNMC · 容器服务抽屉 orphan；ID 为 harbor:registry:read 或 harbor.*）
  if (prefix === 'harbor' || prefix.startsWith('harbor.')) {
    return 'Cloudmap资源池';
  }

  return null;
}
