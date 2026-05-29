/**
 * 权限工具函数
 * 简化版本：直接使用后端权限定义，移除所有推断逻辑
 */

import type { PermissionDefinition } from '../hooks/usePermissionDefinitions';
import {
  CLOUDMAP_POOL_NAV_ROWS,
  CLOUDMAP_POOL_NAV_SUBGROUP_LABELS,
} from '../routes/cloudmapPoolNavRows';
import { hasPermissionForAction } from './accessMapping';
import { poolPageWriteAction } from '../pages/cnmc/clouds/Cloudmap/pool/lib/poolPageReadAccess';

/** 配置权限抽屉：与 Cloudmap 池内主页面 / 附加能力对齐（见 cloudmap-pool-rbac.md） */
export type PoolNavLeafPermissionFeature = {
  feature: string;
  resourcePrefix: string;
  read?: string;
  write?: string;
  readVisible: boolean;
  writeVisible: boolean;
  poolNavGroup: string;
  /** 主页面 | 附加能力（D；卡片标题与主页面一致，不再加「附加」前缀） */
  capabilityKind?: 'main' | 'attached';
  /** 池内路径，仅用于抽屉搜索，不在卡片上展示 */
  pathSuffix?: string;
  /** 池内 Tab 侧栏二级分组键（与 `CLOUDMAP_POOL_NAV_SUBGROUP_LABELS` 对齐） */
  poolNavSubgroup?: string;
  /** 纯展示页：抽屉不展示写权限 */
  poolPageDisplayOnly?: boolean;
};

/** 抽屉一节：与 Cloudmap 侧栏一级 Tab 对齐；`集群` 等含 `subgroups` 二级标题 */
export type PoolNavPermissionDrawerSection = {
  group: string;
  /** 二级分组之前的顶层卡片 */
  features: PoolNavLeafPermissionFeature[];
  /** 侧栏折叠子菜单（如 物理网络 / 存储服务） */
  subgroups?: Array<{ label: string; features: PoolNavLeafPermissionFeature[] }>;
  /** 二级分组之后的卡片（如附加能力） */
  tailFeatures?: PoolNavLeafPermissionFeature[];
};

/** 无侧栏叶子、归入 12 组之一的权限 prefix（顺序即组内展示顺序） */
export const POOL_NAV_GROUP_ORPHAN_PREFIXES: Readonly<Record<string, readonly string[]>> = {
  容器服务: [
    'harbor.registry',
    'harbor.project',
    'harbor.image',
    'harbor.scan',
  ],
  云监控: [
    'clouds.alert-rules',
    'clouds.alert-policies',
    'clouds.alert-receivers',
    'clouds.alert-secrets',
  ],
  扁平网络: ['clouds.traffic-mirroring.flat'],
  VPC网络: [
    'clouds.traffic-mirroring.vpc',
    'clouds.security-groups.vpc',
    'clouds.vswitches',
    'clouds.enis',
    'clouds.route-tables',
    'clouds.route-entries',
    'clouds.network-acls',
  ],
};

const POOL_NAV_ORPHAN_PREFIX_TO_GROUP: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(POOL_NAV_GROUP_ORPHAN_PREFIXES).flatMap(([group, prefixes]) =>
    prefixes.map((prefix) => [prefix, group]),
  ),
);

export function getPoolNavOrphanResourcePrefixSet(): Set<string> {
  return new Set(Object.keys(POOL_NAV_ORPHAN_PREFIX_TO_GROUP));
}

export type PoolNavOrphanPermissionInput = {
  feature: string;
  resourcePrefix: string;
  read?: string;
  write?: string;
  readVisible: boolean;
  writeVisible: boolean;
};

/** 侧栏分组出现顺序（与 cloudmapPoolNavRows.order 一致） */
export function getCloudmapPoolNavGroupsInOrder(): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const row of CLOUDMAP_POOL_NAV_ROWS) {
    if (!seen.has(row.poolNavGroup)) {
      seen.add(row.poolNavGroup);
      order.push(row.poolNavGroup);
    }
  }
  return order;
}

/** 池内主页面（有 poolPageAction 的叶子）对应的 resourcePrefix */
export function getPoolNavLeafResourcePrefixSet(): Set<string> {
  const s = new Set<string>();
  for (const row of CLOUDMAP_POOL_NAV_ROWS) {
    if (row.poolPageAction) {
      s.add(row.poolPageAction.split(':')[0]);
    }
  }
  return s;
}

/**
 * 非侧栏叶、挂在 poolNavGroup 下的附加能力（如创建向导）
 * 设计原则与页面类型见 docs/cloudmap-pool-rbac.md §2。
 */
export const POOL_NAV_GROUP_ATTACHED_PREFIXES: Readonly<Record<string, readonly string[]>> = {
  云主机: ['clouds.vm-create-wizard', 'clouds.vm-quick-create', 'clouds.desktop'],
};

export function getPoolNavAttachedResourcePrefixSet(): Set<string> {
  const s = new Set<string>();
  for (const prefixes of Object.values(POOL_NAV_GROUP_ATTACHED_PREFIXES)) {
    for (const p of prefixes) s.add(p);
  }
  return s;
}

/**
 * 从权限定义中获取分组
 */
export function getGroupFromDefinition(
  permissionId: string,
  definitions: PermissionDefinition[]
): string {
  const def = definitions.find(d => d.id === permissionId);
  return def?.group || '';
}

/**
 * 从权限定义中获取功能名称
 */
export function getFeatureFromDefinition(
  permissionId: string,
  definitions: PermissionDefinition[]
): string {
  const def = definitions.find(d => d.id === permissionId);
  if (def) {
    // 卡片标题用 PERMISSION_NAMES base 名；仅去掉 write 原子上的「-管理」verb 后缀
    return def.name.replace(/[-－](管理|查看)$/, '') || def.name;
  }
  // 如果找不到，使用权限ID的前缀部分
  const prefix = permissionId.split(':')[0];
  return prefix;
}

/**
 * 从权限定义中获取平台
 */
export function getPlatformFromDefinition(
  permissionId: string,
  definitions: PermissionDefinition[]
): string {
  const def = definitions.find(d => d.id === permissionId);
  return def?.platform || 'CNMC';
}

/**
 * 资源池管理功能权限在角色配置中的展示顺序（本数组为设计源；整改后端时请让
 * backend/src/constants/permissions.ts 中 PERMISSION_GROUPS.CNMC['Cloudmap资源池'] 与
 * ALL_PERMISSIONS 中的 clouds.* 前缀与此处一致；权限分组「租户控制台」见 CLOUDMAP_FEATURE_ORDER）
 */
/** 角色配置抽屉内权限卡片关键字匹配（含 resourcePrefix / 权限 ID） */
export function permissionFeatureMatchesKeyword(
  feature: {
    feature?: string;
    resourcePrefix?: string;
    read?: string;
    write?: string;
    pathSuffix?: string;
    poolNavGroup?: string;
  },
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (String(feature.feature || '').toLowerCase().includes(q)) return true;
  if (String(feature.resourcePrefix || '').toLowerCase().includes(q)) return true;
  if (feature.read && String(feature.read).toLowerCase().includes(q)) return true;
  if (feature.write && String(feature.write).toLowerCase().includes(q)) return true;
  if (feature.pathSuffix && String(feature.pathSuffix).toLowerCase().includes(q)) return true;
  if (feature.poolNavGroup && String(feature.poolNavGroup).toLowerCase().includes(q)) return true;
  return false;
}

/**
 * 按 `cloudmapPoolNavRows` 的 poolNavGroup 生成抽屉卡片（一片侧栏叶子一张卡，标题=侧栏 title）
 */
export function buildPoolNavGroupLeafPermissionFeatures(
  poolNavGroup: string,
  actionSet: Set<string>,
  permVerb: '全部' | 'read' | 'write',
): PoolNavLeafPermissionFeature[] {
  return CLOUDMAP_POOL_NAV_ROWS.filter(
    (row) => row.poolNavGroup === poolNavGroup && row.poolPageAction,
  )
    .sort((a, b) => a.order - b.order)
    .map((row) => {
      const read = row.poolPageAction!;
      const write = poolPageWriteAction(read);
      const resourcePrefix = read.split(':')[0];
      const readAction = actionSet.has(read) ? read : undefined;
      const writeAction =
        !row.poolPageDisplayOnly && actionSet.has(write) ? write : undefined;
      return {
        feature: row.title,
        resourcePrefix,
        read: readAction,
        write: writeAction,
        readVisible: permVerb === '全部' || permVerb === 'read',
        writeVisible:
          !row.poolPageDisplayOnly && (permVerb === '全部' || permVerb === 'write'),
        poolNavGroup: row.poolNavGroup,
        capabilityKind: 'main' as const,
        pathSuffix: row.pathSuffix,
        poolNavSubgroup: row.poolNavSubgroup,
        poolPageDisplayOnly: row.poolPageDisplayOnly,
      };
    })
    .filter((item) => item.read || item.write);
}

/** 分组下「附加能力」卡片（独立 resourcePrefix，无 pathSuffix） */
export function buildPoolNavGroupAttachedPermissionFeatures(
  poolNavGroup: string,
  actionSet: Set<string>,
  permVerb: '全部' | 'read' | 'write',
  resolveFeatureLabel: (resourcePrefix: string) => string,
): PoolNavLeafPermissionFeature[] {
  const prefixes = POOL_NAV_GROUP_ATTACHED_PREFIXES[poolNavGroup];
  if (!prefixes?.length) return [];

  return prefixes
    .map((resourcePrefix) => {
      const read = `${resourcePrefix}:read`;
      const write = `${resourcePrefix}:write`;
      const readAction = actionSet.has(read) ? read : undefined;
      const writeAction = actionSet.has(write) ? write : undefined;
      return {
        feature: resolveFeatureLabel(resourcePrefix),
        resourcePrefix,
        read: readAction,
        write: writeAction,
        readVisible: permVerb === '全部' || permVerb === 'read',
        writeVisible: permVerb === '全部' || permVerb === 'write',
        poolNavGroup,
        capabilityKind: 'attached' as const,
      };
    })
    .filter((item) => item.read || item.write);
}

function shouldSkipOrphanPermissionPrefix(prefix: string, actionSet: Set<string>): boolean {
  if (prefix === 'clouds.subnets') {
    return (
      actionSet.has('clouds.subnets.vpc:read') ||
      actionSet.has('clouds.subnets.flat:read') ||
      actionSet.has('clouds.subnets.public:read')
    );
  }
  return false;
}

function buildOrphanFeaturesForPoolNavGroup(
  poolNavGroup: string,
  orphanByPrefix: Map<string, PoolNavOrphanPermissionInput>,
): PoolNavLeafPermissionFeature[] {
  const prefixes = POOL_NAV_GROUP_ORPHAN_PREFIXES[poolNavGroup];
  if (!prefixes?.length) return [];

  const out: PoolNavLeafPermissionFeature[] = [];
  for (const resourcePrefix of prefixes) {
    const orphan = orphanByPrefix.get(resourcePrefix);
    if (!orphan || (!orphan.read && !orphan.write)) continue;
    out.push({
      feature: orphan.feature,
      resourcePrefix: orphan.resourcePrefix,
      read: orphan.read,
      write: orphan.write,
      readVisible: orphan.readVisible,
      writeVisible: orphan.writeVisible,
      poolNavGroup,
      capabilityKind: 'attached',
    });
    orphanByPrefix.delete(resourcePrefix);
  }
  return out;
}

/** 按侧栏 order 拆分：顶层 → subgroup → 尾部（附加能力等） */
function layoutPoolNavFeaturesBySubgroup(
  ordered: PoolNavLeafPermissionFeature[],
): Pick<PoolNavPermissionDrawerSection, 'features' | 'subgroups' | 'tailFeatures'> {
  let seenSubgroup = false;
  const features: PoolNavLeafPermissionFeature[] = [];
  const tailFeatures: PoolNavLeafPermissionFeature[] = [];
  const subgroupOrder: string[] = [];
  const buckets = new Map<string, PoolNavLeafPermissionFeature[]>();

  for (const item of ordered) {
    const sg = item.poolNavSubgroup;
    if (!sg) {
      if (seenSubgroup) tailFeatures.push(item);
      else features.push(item);
      continue;
    }
    seenSubgroup = true;
    if (!buckets.has(sg)) {
      buckets.set(sg, []);
      subgroupOrder.push(sg);
    }
    buckets.get(sg)!.push(item);
  }

  const subgroups =
    subgroupOrder.length > 0
      ? subgroupOrder.map((key) => ({
          label: CLOUDMAP_POOL_NAV_SUBGROUP_LABELS[key] || key,
          features: buckets.get(key)!,
        }))
      : undefined;

  return {
    features,
    subgroups,
    tailFeatures: tailFeatures.length > 0 ? tailFeatures : undefined,
  };
}

/**
 * 按 poolNavGroup 生成抽屉分组（与 Cloudmap 侧栏 12 组一致；含二级 subgroup + 组内 orphan）
 */
export function buildCloudmapPoolNavDrawerSections(
  actionSet: Set<string>,
  permVerb: '全部' | 'read' | 'write',
  resolveAttachedFeatureLabel: (resourcePrefix: string) => string,
  orphanInputs?: PoolNavOrphanPermissionInput[],
): PoolNavPermissionDrawerSection[] {
  const orphanByPrefix = new Map<string, PoolNavOrphanPermissionInput>();
  for (const item of orphanInputs || []) {
    if (shouldSkipOrphanPermissionPrefix(item.resourcePrefix, actionSet)) continue;
    if (!POOL_NAV_ORPHAN_PREFIX_TO_GROUP[item.resourcePrefix]) continue;
    orphanByPrefix.set(item.resourcePrefix, item);
  }

  const sections: PoolNavPermissionDrawerSection[] = [];
  for (const group of getCloudmapPoolNavGroupsInOrder()) {
    const orphans = buildOrphanFeaturesForPoolNavGroup(group, orphanByPrefix);
    const leaves = buildPoolNavGroupLeafPermissionFeatures(group, actionSet, permVerb);
    const attached = buildPoolNavGroupAttachedPermissionFeatures(
      group,
      actionSet,
      permVerb,
      resolveAttachedFeatureLabel,
    );
    // 附加能力（D）插在「无 subgroup 的主页面」与「二级 subgroup（如高级配置）」之间
    const preSubgroupLeaves = leaves.filter((l) => !l.poolNavSubgroup);
    const subgroupLeaves = leaves.filter((l) => l.poolNavSubgroup);
    const ordered = [...orphans, ...preSubgroupLeaves, ...attached, ...subgroupLeaves];
    if (ordered.length === 0) continue;

    const { features, subgroups, tailFeatures } = layoutPoolNavFeaturesBySubgroup(ordered);
    sections.push({
      group,
      features,
      ...(subgroups ? { subgroups } : {}),
      ...(tailFeatures ? { tailFeatures } : {}),
    });
  }
  return sections;
}

/** 展平一节内所有卡片（搜索过滤用） */
export function flattenPoolNavPermissionDrawerSection(
  section: PoolNavPermissionDrawerSection,
): PoolNavLeafPermissionFeature[] {
  const sub = (section.subgroups || []).flatMap((sg) => sg.features);
  const tail = section.tailFeatures || [];
  return [...section.features, ...sub, ...tail];
}

export const RESOURCE_CONSOLE_FEATURE_ORDER: readonly string[] = [
  'clouds',
  'clouds.dashboard',
  'clouds.resource-pools',
  // Cloudmap 池内 resource_hub/*（侧栏「资源总览」分组，与平台「多云总览」区分）
  'clouds.monitoring.overview',
  'clouds.dc-topology',
  'clouds.net-topology',
  // 云主机
  'clouds.ecs',
  'clouds.desktop',
  'clouds.paas-databases',
  'clouds.vm-create-wizard',
  'clouds.vm-quick-create',
  'clouds.images',
  'clouds.templates',
  'clouds.cloudinits',
  'clouds.sshkeys',
  'clouds.recycle-bin',
  'clouds.migrations',
  // 容器服务（K8s 子域，与池内 Tab 一致）
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
  // 存储与备份
  'clouds.disks',
  'clouds.snapshots',
  'clouds.unified-storage',
  'clouds.storage-dashboard',
  'clouds.storage-addon',
  'clouds.unified-storage-pools',
  'clouds.storage-rbd-mirror',
  'clouds.storage-s3-buckets',
  'clouds.storage-rgw-users',
  'clouds.storage-object-gateway',
  'clouds.storage-cosi',
  'clouds.backups',
  'clouds.vm-backup-snapshots',
  'clouds.schedules',
  'clouds.restore-tasks',
  // 基础网络
  'clouds.provider-networks',
  'clouds.vlans',
  'clouds.nads',
  'clouds.ip-pools',
  'clouds.subnets', // 子网（Kube-OVN · 汇总，与分域原子并列展示）
  'clouds.subnets.public',
  // 扁平网络
  'clouds.subnets.flat',
  'clouds.eips.flat',
  'clouds.dnat.flat',
  'clouds.snat.flat',
  'clouds.traffic-mirroring.flat',
  'clouds.security-groups.flat',
  // VPC网络
  'clouds.vpcs',
  'clouds.subnets.vpc',
  'clouds.eips.vpc',
  'clouds.dnat.vpc',
  'clouds.snat.vpc',
  'clouds.traffic-mirroring.vpc',
  'clouds.security-groups.vpc',
  // VPC 扩展能力
  'clouds.load-balancers',
  'clouds.vne',
  'clouds.vswitches',
  'clouds.enis',
  'clouds.route-tables',
  'clouds.route-entries',
  'clouds.network-acls',
  // 集群与运维
  'clouds.cluster-nodes',
  'clouds.cluster-networks',
  'clouds.namespaces',
  'clouds.storage-classes',
  'clouds.gpus',
  'clouds.usb-devices',
  'clouds.pci-devices',
  // 监控
  'clouds.alerts',
  'clouds.alert-rules',
  'clouds.alert-policies',
  'clouds.alert-receivers',
  'clouds.alert-secrets',
  // 日志
  'clouds.log-targets',
  'clouds.log-receivers',
  'clouds.log-configs',
];

/** 权限分组「租户控制台」内功能展示顺序（与 PERMISSION_GROUPS.CNMC['租户控制台'] 一致） */
export const CLOUDMAP_FEATURE_ORDER: readonly string[] = ['clouds.console'];

function cloudmapFeatureOrderIndex(prefix: string): number {
  const i = CLOUDMAP_FEATURE_ORDER.indexOf(prefix);
  return i === -1 ? 999 : i;
}

export function sortCloudmapFeatures<T extends { resourcePrefix: string }>(features: T[]): T[] {
  return [...features].sort((a, b) => cloudmapFeatureOrderIndex(a.resourcePrefix) - cloudmapFeatureOrderIndex(b.resourcePrefix));
}

/** 聚合/父级权限：资源池总权限（覆盖所有 clouds.*） */
export const RESOURCE_CONSOLE_PARENT_PREFIXES = new Set<string>([
  // 资源池总权限也作为“平台入口能力”中的卡片展示
]);

function resourceConsoleOrderIndex(prefix: string): number {
  const i = RESOURCE_CONSOLE_FEATURE_ORDER.indexOf(prefix);
  return i === -1 ? 999 : i;
}

/**
 * 将资源池管理权限拆为父级与细分功能，并按后端分组顺序排序（避免按名称排序导致资源池等位置错乱）
 */
export function splitResourceConsoleFeatures<T extends { resourcePrefix: string }>(
  features: T[]
): { parents: T[]; children: T[] } {
  const parents = features.filter((f) => RESOURCE_CONSOLE_PARENT_PREFIXES.has(f.resourcePrefix));
  const children = features.filter((f) => !RESOURCE_CONSOLE_PARENT_PREFIXES.has(f.resourcePrefix));
  const byOrder = (a: T, b: T) =>
    resourceConsoleOrderIndex(a.resourcePrefix) - resourceConsoleOrderIndex(b.resourcePrefix);
  parents.sort(byOrder);
  children.sort(byOrder);
  return { parents, children };
}

/** CNMC 平台级页面权限前缀（多云总览、资源池列表、clouds 全量） */
export const CNMC_PLATFORM_ENTRY_PREFIXES: readonly string[] = [
  'clouds',
  'clouds.dashboard',
  'clouds.resource-pools',
];

/** @deprecated 使用 CNMC_PLATFORM_ENTRY_PREFIXES */
export const RESOURCE_POOL_PLATFORM_ENTRY_PREFIXES = CNMC_PLATFORM_ENTRY_PREFIXES;

export const CNMC_PLATFORM_ENTRY_PREFIX_SET = new Set<string>(CNMC_PLATFORM_ENTRY_PREFIXES);

/** @deprecated 使用 CNMC_PLATFORM_ENTRY_PREFIX_SET */
export const RESOURCE_POOL_PLATFORM_ENTRY_PREFIX_SET = CNMC_PLATFORM_ENTRY_PREFIX_SET;

/** 角色抽屉「多云管理」分组内卡片顺序（不含租户控制台，后者独立业务域） */
export const PLATFORM_ENTRY_DRAWER_MERGED_ORDER: readonly string[] = [
  ...CNMC_PLATFORM_ENTRY_PREFIXES,
];

function platformEntryDrawerMergedOrderIndex(prefix: string): number {
  const i = PLATFORM_ENTRY_DRAWER_MERGED_ORDER.indexOf(prefix);
  return i === -1 ? 999 : i;
}

export function sortMergedPlatformEntryDrawerFeatures<T extends { resourcePrefix: string }>(
  features: T[],
): T[] {
  return [...features].sort(
    (a, b) =>
      platformEntryDrawerMergedOrderIndex(a.resourcePrefix) -
      platformEntryDrawerMergedOrderIndex(b.resourcePrefix),
  );
}

/** 按 RESOURCE_CONSOLE_FEATURE_ORDER 排序（用于抽屉内分组卡片顺序） */
export function sortByResourceConsoleFeatureOrder<T extends { resourcePrefix: string }>(features: T[]): T[] {
  return [...features].sort(
    (a, b) => resourceConsoleOrderIndex(a.resourcePrefix) - resourceConsoleOrderIndex(b.resourcePrefix),
  );
}

// =============================================================================
// 容器服务：池内 Tab / 控制台 ctr-* ↔ clouds.containers.* 原子（与后端 registry 对齐）
// =============================================================================

/** 历史容器总权（角色抽屉已移除；checker / accessMapping 仍识别） */
export const LEGACY_CLOUD_CONTAINERS_READ = 'clouds.containers:read';
export const LEGACY_CLOUD_CONTAINERS_WRITE = 'clouds.containers:write';

export function isCloudsContainersResourceBase(resourceBase: string): boolean {
  return resourceBase === 'clouds.containers' || resourceBase.startsWith('clouds.containers.');
}

/** 池内 Tab / 控制台 innerActiveKey（service_topology 走 services） */
export type ContainerTabPermissionKey =
  | 'workloads'
  | 'pods'
  | 'jobs'
  | 'services'
  | 'ingresses'
  | 'gateway_api'
  | 'configs'
  | 'registries'
  | 'pdbs'
  | 'networkpolicies';

export const CLOUD_CONTAINER_TAB_READ: Record<ContainerTabPermissionKey, string> = {
  workloads: 'clouds.containers.workloads:read',
  pods: 'clouds.containers.pods:read',
  jobs: 'clouds.containers.jobs:read',
  services: 'clouds.containers.services:read',
  ingresses: 'clouds.containers.ingresses:read',
  gateway_api: 'clouds.containers.gateway:read',
  configs: 'clouds.containers.configs:read',
  registries: 'clouds.containers.registries:read',
  pdbs: 'clouds.containers.pdbs:read',
  networkpolicies: 'clouds.containers.networkpolicies:read',
};

export const CLOUD_CONTAINER_TAB_WRITE: Record<ContainerTabPermissionKey, string> = {
  workloads: 'clouds.containers.workloads:write',
  pods: 'clouds.containers.pods:write',
  jobs: 'clouds.containers.jobs:write',
  services: 'clouds.containers.services:write',
  ingresses: 'clouds.containers.ingresses:write',
  gateway_api: 'clouds.containers.gateway:write',
  configs: 'clouds.containers.configs:write',
  registries: 'clouds.containers.registries:write',
  pdbs: 'clouds.containers.pdbs:write',
  networkpolicies: 'clouds.containers.networkpolicies:write',
};

export const ALL_CLOUD_CONTAINER_SUB_READ: string[] = Object.values(CLOUD_CONTAINER_TAB_READ);

/** 租户控制台资源 key → 容器子域 */
export const CLOUD_CONSOLE_CONTAINER_RESOURCE_TO_TAB: Record<string, ContainerTabPermissionKey> = {
  'ctr-workloads': 'workloads',
  'ctr-pods': 'pods',
  'ctr-jobs': 'jobs',
  'ctr-services': 'services',
  'ctr-ingresses': 'ingresses',
  'ctr-gateway': 'gateway_api',
  'ctr-configs': 'configs',
  'ctr-registries': 'registries',
  'ctr-pdbs': 'pdbs',
  'ctr-netpol': 'networkpolicies',
};

export function isContainerTabPermissionKey(k: string): k is ContainerTabPermissionKey {
  return k in CLOUD_CONTAINER_TAB_READ;
}

export function canReadContainerTab(
  checkPerm: (act: string) => boolean,
  tab: string,
): boolean {
  if (tab === 'service_topology') {
    return canReadContainerTab(checkPerm, 'services');
  }
  if (!isContainerTabPermissionKey(tab)) {
    return ALL_CLOUD_CONTAINER_SUB_READ.some((a) => checkPerm(a));
  }
  const atom = CLOUD_CONTAINER_TAB_READ[tab];
  return checkPerm(atom);
}

export function canWriteContainerTab(
  checkPerm: (act: string) => boolean,
  tab: string,
): boolean {
  if (tab === 'service_topology') {
    return canWriteContainerTab(checkPerm, 'services');
  }
  if (!isContainerTabPermissionKey(tab)) {
    return Object.values(CLOUD_CONTAINER_TAB_WRITE).some((a) => checkPerm(a));
  }
  const atom = CLOUD_CONTAINER_TAB_WRITE[tab];
  return checkPerm(atom);
}

export function hasContainerSubWritePermission(
  permissions: string[],
  tab: ContainerTabPermissionKey,
): boolean {
  const perms = permissions ?? [];
  const writeAction = CLOUD_CONTAINER_TAB_WRITE[tab];
  return (
    hasPermissionForAction(perms, writeAction) ||
    hasPermissionForAction(perms, 'clouds:write') ||
    hasPermissionForAction(perms, 'clouds.console:write')
  );
}

export function canViewAnyContainerSubPage(checkPerm: (act: string) => boolean): boolean {
  return ALL_CLOUD_CONTAINER_SUB_READ.some((a) => checkPerm(a));
}

export function canViewAnyContainerSubPageFromPerms(
  permissions: string[] | undefined,
): boolean {
  const perms = permissions ?? [];
  return canViewAnyContainerSubPage((a) => hasPermissionForAction(perms, a));
}
