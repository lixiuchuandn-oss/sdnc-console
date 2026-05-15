/**
 * 权限定义数据
 * 
 * 将现有的权限字符串转换为完整的权限定义，包含元数据和 API 映射
 */

import { PermissionDefinition } from './types';
import { ALL_PERMISSIONS, getPlatformByPermission, getGroupByPermission } from '../constants/permissions';

/**
 * 权限名称映射（用于生成显示名称）
 */
const PERMISSION_NAMES: Record<string, string> = {
  // CNMC - 资源池管理 / 资源控制台（控制台权限分组）
  'clouds.dashboard': '资源总览（页面权限）',
  'clouds.resource-pools': '资源池管理（页面权限）',
  'clouds': '云资源全量（clouds.* 最高权限）',
  'clouds.ecs': '云主机管理',
  'clouds.vm-create-wizard': '云主机创建向导',
  'clouds.vm-quick-create': '云主机快速创建',
  /** 与权限 ID 前缀 clouds.cloudmap.ops-view 一致（非 clouds.cloudmap） */
  'clouds.cloudmap.ops-view': '资源池运维视图',
  'clouds.eips.flat': '扁平EIP',
  'clouds.fips.flat': '扁平FIP',
  'clouds.dnat.flat': '扁平DNAT',
  'clouds.snat.flat': '扁平SNAT',
  'clouds.traffic-mirroring.flat': '扁平流量镜像',
  'clouds.security-groups.flat': '扁平安全组',
  'clouds.vpcs': '虚拟私有云',
  'clouds.subnets': '子网（Kube-OVN · 汇总）',
  'clouds.subnets.vpc': 'VPC 子网（Kube-OVN）',
  'clouds.subnets.flat': '扁平子网（Kube-OVN）',
  'clouds.subnets.public': '公共子网（Kube-OVN）',
  'clouds.eips.vpc': 'VPCEIP',
  'clouds.fips.vpc': 'VPCFIP',
  'clouds.dnat.vpc': 'VPCDNAT',
  'clouds.snat.vpc': 'VPCSNAT',
  'clouds.traffic-mirroring.vpc': 'VPC流量镜像',
  'clouds.security-groups.vpc': 'VPC安全组',
  'clouds.disks': '虚拟云盘',
  'clouds.load-balancers': '负载均衡',
  'clouds.images': '镜像管理',
  'clouds.templates': '模板',
  'clouds.cloudinits': 'Cloud Init',
  'clouds.sshkeys': 'SSH密钥',
  'clouds.nads': '网络附加定义',
  'clouds.schedules': '定时任务',
  'clouds.restore-tasks': '恢复任务',
  'clouds.namespaces': '命名空间',
  'clouds.containers': '容器服务（K8s）',
  'clouds.containers.workloads': '容器·工作负载',
  'clouds.containers.pods': '容器·Pod',
  'clouds.containers.jobs': '容器·任务',
  'clouds.containers.services': '容器·Service',
  'clouds.containers.ingresses': '容器·Ingress',
  'clouds.containers.gateway': '容器·Gateway API',
  'clouds.containers.configs': '容器·配置与密钥',
  'clouds.containers.registries': '容器·镜像仓库',
  'clouds.containers.pdbs': '容器·Pod 中断保护',
  'clouds.containers.networkpolicies': '容器·网络策略',
  'clouds.cluster-nodes': '物理节点',
  'clouds.cluster-services': '基础服务',
  'clouds.cluster-networks': '集群网络',
  'clouds.provider-networks': '物理网络',
  'clouds.vswitches': '虚拟交换机',
  'clouds.enis': '弹性网卡',
  'clouds.network-acls': '网络ACL',
  'clouds.snapshots': '云盘快照',
  'clouds.backups': '整机快照备份',
  'clouds.recycle-bin': '回收站',
  'clouds.migrations': '迁移记录',
  'clouds.route-tables': '路由表',
  'clouds.route-entries': '路由条目',
  'clouds.vlans': 'VLAN网络',
  'clouds.storage-classes': '存储池',
  'clouds.gpus': 'GPU',
  'clouds.usb-devices': 'USB设备',
  'clouds.pci-devices': 'PCI设备',
  'clouds.alerts': '告警列表',
  'clouds.alert-rules': '告警规则',
  'clouds.alert-policies': '告警通知策略',
  'clouds.alert-receivers': '告警通知对象',
  'clouds.alert-secrets': '告警密钥',
  'clouds.log-targets': '日志采集对象',
  'clouds.log-receivers': '日志接收端',
  'clouds.log-configs': '日志采集配置',
  'clouds.console': '资源控制台（页面权限）',
  
  // TENANTS - 租户管理
  'tenants': '租户管理',
  'organizations': '组织管理',
  'tenant-users': '组织用户管理',
  'users': '用户管理',
  'user-spaces': '用户空间管理',
  
  // CNMC - 权限管控
  'system.roles': '角色管理',
  'system.roles.assignments': '角色分配',
  'system.actions': '权限动作',
  'system.rbac': 'RBAC管理',
  'system.audit': '操作审计',
  'system.settings': '界面设置',
  'system.license': '授权管理',
  'system.integration': '高级集成',
  
  // SDNCC - 安全管理面
  'networks.security-domain': '安全域',
  'networks.cen': '云企业网',
  'networks.cen.attachments': 'CEN连接',
  'security.services': '安全服务',
  'security.apps': '安全应用',
  
  // SDNCC - 跨域互联
  'networks.srv6': 'SRv6网络',
  'networks.vr-config': 'VR配置',
  'networks.acl': '访问控制列表',
  'networks.ipsec': 'IPsecVPN',
  'networks.nat': 'NAT网关',
  
  // CNSOC - 态势中心
  'secops.dashboard': '安全态势总览',
  'secops.alerts': '安全告警',
  'secops.rules': '安全规则',
  
  // Harbor - 镜像仓库
  'harbor.registry': 'Harbor 实例',
  'harbor.project': 'Harbor 项目',
  'harbor.image': 'Harbor 镜像',
  'harbor.scan': 'Harbor 漏洞扫描',
};

/**
 * 权限描述映射
 */
const PERMISSION_DESCRIPTIONS: Record<string, string> = {
  'clouds.dashboard:read': '查看资源总览页面',
  'clouds.dashboard:write': '编辑资源总览配置',
  'clouds.resource-pools:read': '进入资源池管理列表与资源池详情页',
  'clouds.resource-pools:write': '创建、编辑、删除资源池（接入配置等）',
  'clouds:read': '云资源全量查看（包含所有 clouds.* 读能力）',
  'clouds:write': '云资源全量管理（包含所有 clouds.* 写能力）',
  'clouds.ecs:read': '查看云主机列表和详情',
  'clouds.ecs:write': '创建、启动、停止、删除云主机',
  'clouds.vm-create-wizard:write': '使用虚拟机创建向导（分步创建云主机）',
  'clouds.vm-quick-create:write': '使用云主机列表「快速创建」创建虚拟机',
  'clouds.cloudmap.ops-view:write': '在 Cloudmap 资源池切换并进入运维视图',
  'clouds.eips.flat:read': '查看扁平网络 EIP 列表与状态',
  'clouds.eips.flat:write': '管理扁平网络 EIP',
  'clouds.fips.flat:read': '查看扁平网络 FIP 列表与状态',
  'clouds.fips.flat:write': '管理扁平网络 FIP',
  'clouds.dnat.flat:read': '查看扁平网络 DNAT 规则与状态',
  'clouds.dnat.flat:write': '管理扁平网络 DNAT 规则',
  'clouds.snat.flat:read': '查看扁平网络 SNAT 规则与状态',
  'clouds.snat.flat:write': '管理扁平网络 SNAT 规则',
  'clouds.traffic-mirroring.flat:read': '查看扁平网络流量镜像配置与状态',
  'clouds.traffic-mirroring.flat:write': '管理扁平网络流量镜像策略',
  'clouds.security-groups.flat:read': '查看扁平网络安全组列表',
  'clouds.security-groups.flat:write': '管理扁平网络安全组及规则',
  'clouds.eips.vpc:read': '查看 VPC EIP 列表与状态',
  'clouds.eips.vpc:write': '管理 VPC EIP',
  'clouds.fips.vpc:read': '查看 VPC FIP 列表与状态',
  'clouds.fips.vpc:write': '管理 VPC FIP',
  'clouds.dnat.vpc:read': '查看 VPC DNAT 规则与状态',
  'clouds.dnat.vpc:write': '管理 VPC DNAT 规则',
  'clouds.snat.vpc:read': '查看 VPC SNAT 规则与状态',
  'clouds.snat.vpc:write': '管理 VPC SNAT 规则',
  'clouds.traffic-mirroring.vpc:read': '查看 VPC 流量镜像配置与状态',
  'clouds.traffic-mirroring.vpc:write': '管理 VPC 流量镜像策略',
  'clouds.security-groups.vpc:read': '查看 VPC 安全组列表',
  'clouds.security-groups.vpc:write': '管理 VPC 安全组及规则',
  'clouds.subnets:read':
    '查看全部 Kube-OVN 子网类型（VPC / 扁平 / 公共）；仅授子类型权限时仅能访问对应类型',
  'clouds.subnets:write':
    '管理全部 Kube-OVN 子网类型；仅授子类型权限时仅能操作对应类型',
  'clouds.subnets.vpc:read': '查看 VPC 子网（tower.io/subnet-type=vpc）',
  'clouds.subnets.vpc:write': '创建、编辑、删除 VPC 子网',
  'clouds.subnets.flat:read': '查看扁平子网（tower.io/subnet-type=flat）',
  'clouds.subnets.flat:write': '创建、编辑、删除扁平子网',
  'clouds.subnets.public:read': '查看公共子网（tower.io/subnet-type=public）',
  'clouds.subnets.public:write': '创建、编辑、删除公共子网',
  'clouds.backups:read': '查看虚拟机备份、快照备份任务和定时策略列表',
  'clouds.backups:write': '创建、删除虚拟机备份/快照，管理定时备份策略与恢复操作',
  'clouds.console:read': '访问资源控制台',
  'clouds.console:write': '在资源控制台中执行操作',
  'clouds.containers:read': '查看容器服务资源（工作负载、Pod、任务、服务发现、配置、镜像仓库等）',
  'clouds.containers:write': '管理容器服务资源（创建、编辑、删除及 Pod 终端等写操作）',
  'clouds.containers.workloads:read': '查看容器工作负载（Deployment/StatefulSet/DaemonSet）',
  'clouds.containers.workloads:write': '管理工作负载',
  'clouds.containers.pods:read': '查看 Pod、日志',
  'clouds.containers.pods:write': '管理 Pod（含终端、删除等）',
  'clouds.containers.jobs:read': '查看 Job/CronJob',
  'clouds.containers.jobs:write': '管理 Job/CronJob',
  'clouds.containers.services:read': '查看 Service',
  'clouds.containers.services:write': '管理 Service',
  'clouds.containers.ingresses:read': '查看 Ingress',
  'clouds.containers.ingresses:write': '管理 Ingress',
  'clouds.containers.gateway:read': '查看 Gateway API 资源',
  'clouds.containers.gateway:write': '管理 Gateway API 资源',
  'clouds.containers.configs:read': '查看 ConfigMap/Secret',
  'clouds.containers.configs:write': '管理 ConfigMap/Secret',
  'clouds.containers.registries:read': '查看镜像拉取凭证等',
  'clouds.containers.registries:write': '管理镜像仓库相关',
  'clouds.containers.pdbs:read': '查看 PodDisruptionBudget',
  'clouds.containers.pdbs:write': '管理 PodDisruptionBudget',
  'clouds.containers.networkpolicies:read': '查看网络策略',
  'clouds.containers.networkpolicies:write': '管理网络策略',
  'tenants:read': '查看租户列表',
  'tenants:write': '创建、编辑、删除租户',
  'organizations:read': '查看组织架构树',
  'organizations:write': '创建、编辑、删除组织，管理组织下的用户和资源分配',
  'tenant-users:read': '查看租户组织用户列表',
  'tenant-users:write': '创建、编辑、删除租户组织用户，重置密码',
  'users:read': '查看系统用户列表',
  'users:write': '创建、编辑、删除系统用户，重置密码',
  'system.roles:read': '查看角色列表',
  'system.roles:write': '创建、编辑、删除角色',
  
  // SDNCC - 跨域互联
  'networks.vr-config:read': '查看 VR 实例列表',
  'networks.vr-config:write': '创建、编辑、删除 VR 实例',
  'networks.ipsec:read': '查看 IPsec VPN 连接列表',
  'networks.ipsec:write': '创建、编辑、删除 IPsec VPN 连接',
  'networks.nat:read': '查看 NAT 网关列表',
  'networks.nat:write': '创建、编辑、删除 NAT 网关规则',
  
  // Harbor - 镜像仓库
  'harbor.registry:read': '查看 Harbor 实例列表',
  'harbor.registry:create': '创建 Harbor 实例',
  'harbor.registry:update': '编辑 Harbor 实例配置',
  'harbor.registry:delete': '删除 Harbor 实例',
  'harbor.project:create': '创建 Harbor 项目',
  'harbor.project:update': '编辑 Harbor 项目',
  'harbor.project:delete': '删除 Harbor 项目',
  'harbor.image:push': '推送镜像到 Harbor',
  'harbor.image:delete': '删除 Harbor 镜像',
  'harbor.scan:trigger': '触发 Harbor 镜像漏洞扫描',
};

/**
 * 生成权限的 API 路径模式
 * 
 * 注意：不再硬编码 API 路径，改为完全依赖路径推断机制
 * 路径推断在 registry.ts 的 resolveFromApi 中实现
 */
function generateApiPatterns(permissionId: string): Array<{ method: string; pathPattern: string }> {
  // 不再硬编码，完全依赖路径推断
  return [];
}

/**
 * 生成权限定义
 */
function generatePermissionDefinition(permissionId: string): PermissionDefinition {
  const [base, verb] = permissionId.split(':');
  if (!base || !verb) {
    throw new Error(`Invalid permission format: ${permissionId}`);
  }

  const platform = getPlatformByPermission(permissionId) as
    | 'CNMC'
    | 'TENANTS'
    | 'SDNCC'
    | 'CNSOC'
    | 'SETTINGS'
    | null;
  const group = getGroupByPermission(permissionId);

  // 生成显示名称
  const baseName = PERMISSION_NAMES[base] || base;
  const verbName = verb === 'read' ? '查看' : verb === 'write' ? '管理' : verb;
  const name = `${baseName}${verbName === '查看' ? '' : '-' + verbName}`;

  // 获取描述
  const description = PERMISSION_DESCRIPTIONS[permissionId] || `${name}权限`;

  // 确定分类
  let category = 'general';
  if (
    base.startsWith('clouds.ecs') ||
    base.startsWith('clouds.vm-create-wizard') ||
    base.startsWith('clouds.vm-quick-create') ||
    base.startsWith('clouds.cloudmap') ||
    base.startsWith('clouds.containers') ||
    base === 'clouds.console'
  ) {
    category = 'compute';
  } else if (base === 'clouds.dashboard' || base === 'clouds.resource-pools') {
    category = 'management';
  } else if (base.includes('network') || base.includes('vpc') || base.includes('vswitch')) {
    category = 'network';
  } else if (base.includes('disk') || base.includes('snapshot')) {
    category = 'storage';
  } else if (base.startsWith('system.') || base.startsWith('tenants') || base.startsWith('users')) {
    category = 'management';
  }

  // 生成继承关系
  const inherits: string[] = [];
  
  // 层级继承：clouds.ecs:read 继承 clouds:read
  if (base.includes('.') && base !== 'clouds.console') {
    const segments = base.split('.');
    if (segments.length >= 2) {
      const parentBase = segments[0];
      const parentPerm = `${parentBase}:${verb}`;
      if (ALL_PERMISSIONS.includes(parentPerm as any)) {
        inherits.push(parentPerm);
      }
    }
  }

  // write 权限继承 read 权限
  if (verb === 'write') {
    const readPerm = `${base}:read`;
    if (ALL_PERMISSIONS.includes(readPerm as any)) {
      inherits.push(readPerm);
    }
  }

  // 如果无法识别平台，使用默认值（向后兼容）
  // 注意：这不应该发生，但如果发生了，使用 CNMC 作为默认值
  const finalPlatform = platform || 'CNMC';
  
  // 如果无法识别分组，使用默认值
  const finalGroup = group || '其他';

  return {
    id: permissionId,
    name,
    description,
    platform: finalPlatform,
    group: finalGroup,
    category,
    verb: verb as 'read' | 'write',
    inherits: inherits.length > 0 ? inherits : undefined,
    // 不再生成硬编码的 apiPatterns，完全依赖路径推断
    apiPatterns: undefined,
  };
}

/**
 * 所有权限定义
 */
export const PERMISSION_DEFINITIONS: PermissionDefinition[] = ALL_PERMISSIONS.map(perm => 
  generatePermissionDefinition(perm as string)
);
