/**
 * Cloudmap 资源池：侧栏、路径、Tab 元数据、RouteSpec 解析（单模块，避免目录内过度切分）。
 * 数据与 `routes/cloudmapPoolNavRows.ts` → `routeSpecs`（navScope: cloudmap-pool）一致。
 */
import { routeSpecs, type RouteSpec } from '../../../routes/RouteSpec';
import { CLOUDMAP_POOL_NAV_SUBGROUP_LABELS } from '../../../routes/cloudmapPoolNavRows';
import { remapLegacyClusterInnerSeg } from '../../../pages/cnmc/clouds/Harvester/cluster/lib/computeResourcesNav';
import { legacyComputeClusterOperateTab } from '../../../pages/cnmc/clouds/Harvester/cluster/sections/computeCluster/computeClusterUiConstants';
import { legacyPhysicalNetworkOperateTab } from '../../../pages/cnmc/clouds/Harvester/cluster/sections/physicalNetwork/physicalNetworkUiConstants';
import { legacyPlatformNetworkOperateTab } from '../../../pages/cnmc/clouds/Harvester/cluster/sections/platformNetwork/platformNetworkUiConstants';
import { legacyStorageConfigOperateTab } from '../../../pages/cnmc/clouds/Harvester/ceph/sections/unifiedStorageConfig/unifiedStorageConfigUiConstants';
import { STORAGE_CONFIG_INNER_SEG } from '../../../pages/cnmc/clouds/Harvester/ceph/lib/storageResourcesNav';
import { createElement, type ReactNode } from 'react';
import {
  AlertOutlined,
  ApartmentOutlined,
  CloudDownloadOutlined,
  ClusterOutlined,
  ConsoleSqlOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  DeploymentUnitOutlined,
  DesktopOutlined,
  FileTextOutlined,
  GlobalOutlined,
  InboxOutlined,
  NodeIndexOutlined,
} from '@ant-design/icons';
import type { AdminSidebarCenter } from '../AdminSidebar';
import type { Cloud } from '../../../pages/cnmc/pools/lib/poolProviders';
import type {
  PoolSidebarBuildArgs,
  PoolSidebarSelectArgs,
  PoolSidebarSpec,
} from '../poolSidebar/types';

/**
 * Cloudmap 资源池：Tab/子键类型与集群锚点常量。
 * 侧栏与路径叶子以 `routes/cloudmapPoolNavRows.ts` → `routeSpecs` 为唯一数据源（与 SDN 一致）。
 */
export const CLOUDMAP_POOL_NAV_KEYS = [
  'resource_hub',
  'monitoring_alerts',
  'cluster',
  'compute',
  'paas_databases',
  'oniaas_network',
  'containers',
  'storage',
  'unified_storage',
  'backups',
  'flat_network',
  'kube_ovn',
  'logs_config',
] as const;

export type CloudmapPoolNavKey = (typeof CLOUDMAP_POOL_NAV_KEYS)[number];

export const CLOUDMAP_RESOURCE_SUB_KEYS = [
  'overview',
  'datacenter_topology',
  'network_topology',
] as const;

export type CloudmapResourceSubKey = (typeof CLOUDMAP_RESOURCE_SUB_KEYS)[number];

export type CloudmapPoolInnerMenuItem = { pathSeg: string; label: string };

export const CLOUDMAP_RESOURCE_HUB_MENU_GROUP_KEY = 'cloudmap_menu_resource_hub';

/**
 * Cloudmap 池：侧栏与 INNER_MENU 均从 `routeSpecs`（navScope: cloudmap-pool）派生，与 SDN 同源思路。
 */

const CM_PREFIX = '/admin/clouds/:cloudId/';

export function getCloudmapPoolRouteSpecs(): RouteSpec[] {
  return routeSpecs.filter((s) => s.navScope === 'cloudmap-pool');
}

function isPoolNavKey(s: string): s is CloudmapPoolNavKey {
  return (CLOUDMAP_POOL_NAV_KEYS as readonly string[]).includes(s);
}

/** 从 RouteSpec.path 解析池内 tab / 内层段 / 侧栏形态 */
export function parseCloudmapPoolRouteSpec(spec: RouteSpec): {
  pathSuffix: string;
  tab: CloudmapPoolNavKey;
  pathSeg: string;
  placement: 'group' | 'top';
} | null {
  if (spec.navScope !== 'cloudmap-pool' || !spec.path.startsWith(CM_PREFIX)) return null;
  const pathSuffix = spec.path.slice(CM_PREFIX.length);
  const parts = pathSuffix.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const head = parts[0];
  if (!isPoolNavKey(head)) return null;
  if (head === 'resource_hub') {
    return { pathSuffix, tab: 'resource_hub', pathSeg: parts[1] || '', placement: 'group' };
  }
  return { pathSuffix, tab: head, pathSeg: parts[1] || '', placement: 'group' };
}

export function buildInnerMenuByNav(): Partial<
  Record<CloudmapPoolNavKey, readonly CloudmapPoolInnerMenuItem[]>
> {
  const acc: Partial<Record<CloudmapPoolNavKey, CloudmapPoolInnerMenuItem[]>> = {};
  const sorted = getCloudmapPoolRouteSpecs()
    .map((spec) => ({ spec, p: parseCloudmapPoolRouteSpec(spec) }))
    .filter((x): x is { spec: RouteSpec; p: NonNullable<typeof x.p> } => !!x.p)
    .sort((a, b) => (a.spec.order ?? 0) - (b.spec.order ?? 0));

  for (const { spec, p } of sorted) {
    if (p.placement !== 'group') continue;
    if (p.tab === 'resource_hub') continue;
    if (!acc[p.tab]) acc[p.tab] = [];
    acc[p.tab]!.push({ pathSeg: p.pathSeg, label: spec.title || p.pathSeg });
  }
  const frozen: Partial<Record<CloudmapPoolNavKey, readonly CloudmapPoolInnerMenuItem[]>> = {};
  (Object.keys(acc) as CloudmapPoolNavKey[]).forEach((k) => {
    frozen[k] = Object.freeze([...(acc[k] || [])]) as readonly CloudmapPoolInnerMenuItem[];
  });
  return frozen;
}

export function filterVisibleCloudmapPoolSpecs(opts?: CloudmapPoolSidebarBuildOpts): RouteSpec[] {
  return getCloudmapPoolRouteSpecs().filter((spec) => {
    if (spec.requiredFeature && opts?.hasFeature && !opts.hasFeature(spec.requiredFeature)) {
      return false;
    }
    if (opts?.poolRouteAccess && !opts.poolRouteAccess(spec)) return false;
    return true;
  });
}


/**
 * Cloudmap 资源池：路径/类型与侧栏导航标签；导航叶子见 `routes/cloudmapPoolNavRows.ts` → `routeSpecs`（非 antd Tabs）。
 */

export const CLOUD_POOL_SIDEBAR_CENTER_KEY = '/admin/cloud_pool_context';

export const LEGACY_CLOUDMAP_POOL_NAV_ALIASES: Record<string, CloudmapPoolNavKey> = {
  'monitoring-alerts': 'monitoring_alerts',
  'logs-config': 'logs_config',
  compute_group: 'compute',
  storage_group: 'storage',
  backups_group: 'backups',
  flat_network_group: 'flat_network',
  ceph_group: 'cluster',
  /** 历史「对象存储 / 统一存储」独立 Tab，现归入集群 · 存储服务 */
  object_storage: 'cluster',
  object_storage_group: 'cluster',
  unified_storage_group: 'cluster',
  kube_ovn_group: 'kube_ovn',
};

const CLOUDMAP_NAV_LABEL: Record<CloudmapPoolNavKey, string> = {
  resource_hub: '资源总览',
  monitoring_alerts: '云监控',
  cluster: '集群',
  compute: '云主机',
  paas_databases: '云数据库',
  oniaas_network: '虚拟网元',
  containers: '容器服务',
  storage: '云存储',
  unified_storage: '统一存储',
  backups: '云备份',
  flat_network: '扁平网络',
  kube_ovn: 'VPC网络',
  logs_config: '日志管理',
};

const CLOUDMAP_NAV_ICON: Record<CloudmapPoolNavKey, ReactNode> = {
  resource_hub: createElement(DashboardOutlined),
  monitoring_alerts: createElement(AlertOutlined),
  cluster: createElement(ClusterOutlined),
  compute: createElement(DesktopOutlined),
  paas_databases: createElement(ConsoleSqlOutlined),
  oniaas_network: createElement(NodeIndexOutlined),
  containers: createElement(DeploymentUnitOutlined),
  storage: createElement(DatabaseOutlined),
  unified_storage: createElement(InboxOutlined),
  backups: createElement(CloudDownloadOutlined),
  flat_network: createElement(ApartmentOutlined),
  kube_ovn: createElement(GlobalOutlined),
  logs_config: createElement(FileTextOutlined),
};

export function cloudmapNavLabel(tab: CloudmapPoolNavKey): string {
  return CLOUDMAP_NAV_LABEL[tab] || tab;
}

export function cloudmapNavIcon(tab: CloudmapPoolNavKey): ReactNode {
  return CLOUDMAP_NAV_ICON[tab];
}

export type ParsedCloudmapPoolPath = {
  tab: CloudmapPoolNavKey;
  resourceHubSub?: CloudmapResourceSubKey;
  poolInnerSeg?: string;
};

const _innerFrozen = buildInnerMenuByNav();

export const INNER_MENU_BY_NAV: Partial<
  Record<CloudmapPoolNavKey, readonly CloudmapPoolInnerMenuItem[]>
> = _innerFrozen;

export const CLOUDMAP_COMPUTE_INNER_MENU: readonly CloudmapPoolInnerMenuItem[] =
  INNER_MENU_BY_NAV.compute || [];
export const CLOUDMAP_STORAGE_INNER_MENU: readonly CloudmapPoolInnerMenuItem[] =
  INNER_MENU_BY_NAV.storage || [];
export const CLOUDMAP_CONTAINERS_INNER_MENU: readonly CloudmapPoolInnerMenuItem[] =
  INNER_MENU_BY_NAV.containers || [];
export const CLOUDMAP_BACKUPS_INNER_MENU: readonly CloudmapPoolInnerMenuItem[] =
  INNER_MENU_BY_NAV.backups || [];
export const CLOUDMAP_FLAT_NETWORK_INNER_MENU: readonly CloudmapPoolInnerMenuItem[] =
  INNER_MENU_BY_NAV.flat_network || [];
export const CLOUDMAP_KUBE_OVN_INNER_MENU: readonly CloudmapPoolInnerMenuItem[] =
  INNER_MENU_BY_NAV.kube_ovn || [];
export const CLOUDMAP_PAAS_DATABASES_INNER_MENU: readonly CloudmapPoolInnerMenuItem[] =
  INNER_MENU_BY_NAV.paas_databases || [];
export const CLOUDMAP_ONIAAS_NETWORK_INNER_MENU: readonly CloudmapPoolInnerMenuItem[] =
  INNER_MENU_BY_NAV.oniaas_network || [];
export const CLOUDMAP_MONITORING_ALERTS_INNER_MENU: readonly CloudmapPoolInnerMenuItem[] =
  INNER_MENU_BY_NAV.monitoring_alerts || [];
export const CLOUDMAP_LOGS_CONFIG_INNER_MENU: readonly CloudmapPoolInnerMenuItem[] =
  INNER_MENU_BY_NAV.logs_config || [];
/** 集群子路径：与 `buildInnerMenuByNav` / `routeSpecs`（`cloudmapPoolNavRows`）同源，勿再手写重复表 */
export const CLOUDMAP_CLUSTER_INNER_MENU: readonly CloudmapPoolInnerMenuItem[] =
  INNER_MENU_BY_NAV.cluster || [];
export const CLOUDMAP_CLUSTER_SECTION_KEYS = CLOUDMAP_CLUSTER_INNER_MENU.map(
  (x) => x.pathSeg,
) as readonly string[];

export function cloudmapInnerMenuForNav(
  nav: CloudmapPoolNavKey,
): readonly CloudmapPoolInnerMenuItem[] | undefined {
  return INNER_MENU_BY_NAV[nav];
}

export function isClusterSectionKey(seg: string): boolean {
  return CLOUDMAP_CLUSTER_INNER_MENU.some((x) => x.pathSeg === seg);
}

export function cloudmapClusterSectionTitle(pathSeg: string): string | undefined {
  return CLOUDMAP_CLUSTER_INNER_MENU.find((x) => x.pathSeg === pathSeg)?.label;
}

export type CloudmapPoolSidebarBuildOpts = {
  ovnVpcEnabled?: boolean;
  /** 与 `RouteSpec.requiredFeature` 对齐（侧栏过滤 OVN 等） */
  hasFeature?: (feature: string) => boolean;
  /** 池内路由是否展示（与 `RouteSpec.requiredActions.page` 对齐；缺省展示全部） */
  poolRouteAccess?: (spec: RouteSpec) => boolean;
};

function poolProviderRaw(cloud: Cloud): string {
  return String(cloud?.config?.provider || cloud?.type || '')
    .toLowerCase()
    .trim();
}

export function isCloudmapPool(cloud: Cloud): boolean {
  const p = poolProviderRaw(cloud);
  return p === 'cloudmap.edge' || p === 'cloudmap.private';
}

export function parseCloudPoolDetailId(pathname: string): string | null {
  const m = /^\/admin\/clouds\/([^/]+)/.exec(pathname);
  return m ? decodeURIComponent(m[1]) : null;
}

export function cloudmapPoolBasePath(cloudId: string): string {
  return `/admin/clouds/${encodeURIComponent(cloudId)}`;
}

/** 集群 · 存储服务（Rook/Ceph/RGW）池内 `poolInnerSeg` */
export const CLUSTER_CEPH_POOL_INNER_SEGS = [
  'harvester_addon',
  'rgw_s3_buckets',
  'rgw_users',
  'object_gateways',
  'cosi',
] as const;

export function isClusterCephPoolInnerSeg(seg: string): boolean {
  return (CLUSTER_CEPH_POOL_INNER_SEGS as readonly string[]).includes(seg);
}

function clusterCephPoolInnerPath(
  base: string,
  inner: string | undefined,
): string {
  const raw = (inner || '').trim();
  const operateTab = legacyStorageConfigOperateTab(raw);
  if (operateTab) {
    return `${base}/cluster/${encodeURIComponent(STORAGE_CONFIG_INNER_SEG)}?operateTab=${operateTab}`;
  }
  const seg =
    raw && isClusterCephPoolInnerSeg(raw) ? raw : STORAGE_CONFIG_INNER_SEG;
  return `${base}/cluster/${encodeURIComponent(seg)}`;
}

/** 书签/旧链仍指向 `/ceph/*` 时统一到集群 · 存储服务（须先于 `parseCloudmapPoolPath` 做 replace navigate） */
export function cloudmapRemapLegacyCephPoolPath(pathname: string, cloudId: string): string | null {
  const rest = stripCloudmapPoolRest(pathname, cloudId);
  if (rest == null || rest === '') return null;
  const parts = rest.split('/').filter(Boolean);
  if (parts[0] !== 'ceph') return null;
  const base = cloudmapPoolBasePath(cloudId);
  const inner = (parts[1] || '').trim();
  if (inner === 'object_storage') {
    return clusterCephPoolInnerPath(base, 'rgw_s3_buckets');
  }
  if (inner === 'overview') {
    return `${base}/cluster/${encodeURIComponent(STORAGE_CONFIG_INNER_SEG)}?operateTab=overview`;
  }
  if (inner === 'block_storage' || inner === 'storage_pools') {
    return `${base}/cluster/${encodeURIComponent(STORAGE_CONFIG_INNER_SEG)}?operateTab=storage_pools`;
  }
  if (inner === 'rbd_mirror') {
    return `${base}/cluster/${encodeURIComponent(STORAGE_CONFIG_INNER_SEG)}?operateTab=rbd_mirror`;
  }
  return clusterCephPoolInnerPath(base, inner);
}

/** 历史 `unified_storage/*` 与已摘除叶子：重定向到集群 · 存储服务对应页。 */
export function cloudmapRemapUnifiedStorageToClusterPath(
  pathname: string,
  cloudId: string,
): string | null {
  const rest = stripCloudmapPoolRest(pathname, cloudId);
  if (!rest || rest === '') return null;
  const parts = rest.split('/').filter(Boolean);
  if (parts[0] !== 'unified_storage') return null;
  const base = cloudmapPoolBasePath(cloudId);
  const inner = (parts[1] || '').trim();
  return clusterCephPoolInnerPath(base, inner || undefined);
}

/** 已从侧栏摘除的叶子 pathSeg；书签仍指向时重定向到集群 · 存储服务。 */
export function cloudmapRemapDroppedPoolLeafPath(pathname: string, cloudId: string): string | null {
  const unified = cloudmapRemapUnifiedStorageToClusterPath(pathname, cloudId);
  if (unified) return unified;

  const rest = stripCloudmapPoolRest(pathname, cloudId);
  if (!rest || rest === '') return null;
  const parts = rest.split('/').filter(Boolean);
  const base = cloudmapPoolBasePath(cloudId);
  if (parts[0] === 'resource_hub' && parts[1] === 'ceph_storage_overview') {
    return `${base}/cluster/${encodeURIComponent(STORAGE_CONFIG_INNER_SEG)}?operateTab=overview`;
  }
  if (parts[0] === 'storage' && parts[1] === 'rbd_mirror') {
    return `${base}/cluster/${encodeURIComponent(STORAGE_CONFIG_INNER_SEG)}?operateTab=rbd_mirror`;
  }
  if (parts[0] === 'storage' && parts[1] === 'block_storage') {
    return `${base}/cluster/harvester_addon`;
  }
  if (parts[0] === 'storage' && parts[1] === 'rados_namespaces') {
    return `${base}/cluster/harvester_addon`;
  }
  if (parts[0] === 'storage' && parts[1] === 'storage_pools') {
    return `${base}/cluster/harvester_addon`;
  }
  if (parts[0] === 'storage' && parts[1] === 'storage_classes') {
    return `${base}/cluster/storage_classes`;
  }
  if (parts[0] === 'object_storage') {
    const inner = (parts[1] || '').trim();
    if (inner === 'storage_pools') return `${base}/cluster/harvester_addon`;
    if (inner && isClusterCephPoolInnerSeg(inner)) {
      return `${base}/cluster/${encodeURIComponent(inner)}`;
    }
    return clusterCephPoolInnerPath(base, 'rgw_s3_buckets');
  }
  if (parts[0] === 'cluster' && parts[1]) {
    const legacyTab =
      legacyComputeClusterOperateTab(parts[1]) ??
      legacyPhysicalNetworkOperateTab(parts[1]) ??
      legacyPlatformNetworkOperateTab(parts[1]) ??
      legacyStorageConfigOperateTab(parts[1]);
    const mapped = remapLegacyClusterInnerSeg(parts[1]);
    if (mapped !== parts[1]) {
      const path = `${base}/cluster/${encodeURIComponent(mapped)}`;
      return legacyTab ? `${path}?operateTab=${legacyTab}` : path;
    }
  }
  return null;
}

export function cloudmapNavUsesPoolInnerPath(tab: CloudmapPoolNavKey): boolean {
  return Boolean(INNER_MENU_BY_NAV[tab]);
}

export function cloudmapDefaultPoolInnerSeg(tab: CloudmapPoolNavKey): string {
  const m = INNER_MENU_BY_NAV[tab];
  return m?.[0]?.pathSeg || '';
}

export function isValidCloudmapPoolInnerSeg(
  tab: CloudmapPoolNavKey,
  seg: string,
): boolean {
  const m = INNER_MENU_BY_NAV[tab];
  if (!m) return false;
  return m.some((x) => x.pathSeg === seg);
}

function stripCloudmapPoolRest(pathname: string, cloudId: string): string | null {
  const encBase = `/admin/clouds/${encodeURIComponent(cloudId)}`;
  const rawBase = `/admin/clouds/${cloudId}`;
  if (pathname === encBase || pathname === rawBase) return '';
  if (pathname.startsWith(encBase + '/')) return pathname.slice(encBase.length + 1);
  if (pathname.startsWith(rawBase + '/')) return pathname.slice(rawBase.length + 1);
  return null;
}

export function parseCloudmapPoolPath(
  pathname: string,
  cloudId: string,
): ParsedCloudmapPoolPath | null {
  const rest = stripCloudmapPoolRest(pathname, cloudId);
  if (rest === null) return null;
  if (rest === '') {
    return { tab: 'resource_hub', resourceHubSub: 'overview' };
  }
  const parts = rest.split('/').filter(Boolean);
  if (parts[0] === 'resource_hub') {
    const sub = normalizeCloudmapResourceSubParam('resource_hub', parts[1] || null);
    return { tab: 'resource_hub', resourceHubSub: sub };
  }
  const seg = parts[0];
  if (!(CLOUDMAP_POOL_NAV_KEYS as readonly string[]).includes(seg)) {
    return null;
  }
  const tab = seg as CloudmapPoolNavKey;
  const innerMenu = INNER_MENU_BY_NAV[tab];
  if (innerMenu) {
    const rawInner = parts[1] || '';
    if (rawInner && !isValidCloudmapPoolInnerSeg(tab, rawInner)) {
      return { tab, poolInnerSeg: undefined };
    }
    return {
      tab,
      poolInnerSeg: rawInner ? rawInner : undefined,
    };
  }
  return { tab };
}

export function cloudmapLegacyQueryToPath(
  cloudId: string,
  pathname: string,
  search: string,
): string | null {
  const base = cloudmapPoolBasePath(cloudId);
  if (pathname !== base) return null;
  const sp = new URLSearchParams(search);
  if (
    !sp.get('tab') &&
    !sp.get('sub') &&
    !sp.get('cluster_sub') &&
    !sp.get('cluster_segment')
  ) {
    return null;
  }
  const rawTab = sp.get('tab');
  const rawTabStr = String(rawTab || '').trim();
  if (rawTabStr === 'ceph') {
    const rawSub = (sp.get('sub') || '').trim();
    if (rawSub === 'object_storage') {
      return clusterCephPoolInnerPath(base, 'rgw_s3_buckets');
    }
    if (rawSub === 'overview') {
      return `${base}/cluster/${encodeURIComponent(STORAGE_CONFIG_INNER_SEG)}?operateTab=overview`;
    }
    if (rawSub === 'storage_pools' || rawSub === 'block_storage') {
      return `${base}/cluster/harvester_addon`;
    }
    return clusterCephPoolInnerPath(base, rawSub || undefined);
  }

  const tab = normalizeCloudmapPoolNavParam(rawTab);
  if (tab === 'resource_hub') {
    const sub = normalizeCloudmapResourceSubParam(rawTab, sp.get('sub'));
    return `${base}/resource_hub/${encodeURIComponent(sub)}`;
  }
  if (tab === 'storage') {
    const rawSub = (sp.get('sub') || '').trim();
    if (rawSub === 'ceph') {
      return `${base}/cluster/harvester_addon`;
    }
    if (rawSub === 'rbd_mirror') {
      return `${base}/cluster/${encodeURIComponent(STORAGE_CONFIG_INNER_SEG)}?operateTab=rbd_mirror`;
    }
  }
  if (tab === 'unified_storage') {
    const rawSub = (sp.get('sub') || '').trim();
    return clusterCephPoolInnerPath(base, rawSub || undefined);
  }
  if (tab === 'cluster') {
    const csRaw = (sp.get('cluster_sub') || '').trim();
    const cs = csRaw ? remapLegacyClusterInnerSeg(csRaw) : '';
    const clusterSeg = (sp.get('cluster_segment') || '').trim();
    if (clusterSeg && cs === 'clusterNetworks') {
      const operateTab = legacyPlatformNetworkOperateTab(clusterSeg);
      if (operateTab) {
        return `${base}/cluster/cluster_platform_network?operateTab=${operateTab}`;
      }
    }
    if (cs && isValidCloudmapPoolInnerSeg('cluster', cs)) {
      const legacyTab =
        legacyComputeClusterOperateTab(csRaw) ??
        legacyPhysicalNetworkOperateTab(csRaw) ??
        legacyPlatformNetworkOperateTab(csRaw) ??
        legacyStorageConfigOperateTab(csRaw);
      const path = `${base}/cluster/${encodeURIComponent(cs)}`;
      return legacyTab && csRaw !== cs ? `${path}?operateTab=${legacyTab}` : path;
    }
    return `${base}/cluster/${encodeURIComponent(cloudmapDefaultPoolInnerSeg('cluster'))}`;
  }
  const innerMenu = INNER_MENU_BY_NAV[tab];
  if (innerMenu) {
    const rawSub = (sp.get('sub') || '').trim();
    const inner =
      rawSub && isValidCloudmapPoolInnerSeg(tab, rawSub)
        ? rawSub
        : cloudmapDefaultPoolInnerSeg(tab);
    return `${base}/${encodeURIComponent(tab)}/${encodeURIComponent(inner)}`;
  }
  return `${base}/${encodeURIComponent(tab)}`;
}

export function cloudmapLegacyClusterThreeSegmentToTwo(
  cloudId: string,
  pathname: string,
  search: string,
): string | null {
  const rest = stripCloudmapPoolRest(pathname, cloudId);
  if (!rest) return null;
  const parts = rest.split('/').filter(Boolean);
  if (parts.length !== 3) return null;
  if (parts[0] !== 'cluster' || parts[1] !== 'clusterNetworks') return null;
  const seg = parts[2];
  const operateTab = legacyPlatformNetworkOperateTab(seg);
  const nextPath = operateTab
    ? `${cloudmapPoolBasePath(cloudId)}/cluster/cluster_platform_network?operateTab=${operateTab}`
    : `${cloudmapPoolBasePath(cloudId)}/cluster/cluster_platform_network`;
  const next = `${nextPath}${search}`;
  const cur = `${pathname}${search}`;
  return next !== cur ? next : null;
}

export function cloudmapClusterSegmentQueryToPath(
  cloudId: string,
  pathname: string,
  search: string,
): string | null {
  const rest = stripCloudmapPoolRest(pathname, cloudId);
  if (!rest) return null;
  const parts = rest.split('/').filter(Boolean);
  if (parts[0] !== 'cluster' || parts[1] !== 'clusterNetworks') return null;

  const sp = new URLSearchParams(search);
  if (!sp.has('cluster_segment')) return null;

  const qSeg = (sp.get('cluster_segment') ?? '').trim();
  sp.delete('cluster_segment');
  const restQ = sp.toString();
  const suffix = restQ ? `?${restQ}` : '';

  const pathSeg = (parts[2] || '').trim();

  if (pathSeg) {
    if (!qSeg || pathSeg === qSeg) {
      const next = `${pathname}${suffix}`;
      const cur = `${pathname}${search}`;
      return next !== cur ? next : null;
    }
    const next = `${pathname}${suffix}`;
    const cur = `${pathname}${search}`;
    return next !== cur ? next : null;
  }

  if (qSeg) {
    const operateTab = legacyPlatformNetworkOperateTab(qSeg);
    const nextPath = operateTab
      ? `${cloudmapPoolBasePath(cloudId)}/cluster/cluster_platform_network?operateTab=${operateTab}`
      : cloudmapPathForNav(cloudId, 'cluster', {
          poolInnerSeg: remapLegacyClusterInnerSeg(qSeg),
        });
    const next = `${nextPath}${suffix}`;
    const cur = `${pathname}${search}`;
    return next !== cur ? next : null;
  }

  const next = `${pathname}${suffix}`;
  const cur = `${pathname}${search}`;
  return next !== cur ? next : null;
}

const CLOUDMAP_OBSOLETE_POOL_QUERY = new Set([
  'tab',
  'sub',
  'cluster_sub',
  'cluster_segment',
]);

export function cloudmapStripObsoletePoolQuery(
  cloudId: string,
  pathname: string,
  search: string,
): string | null {
  if (!parseCloudmapPoolPath(pathname, cloudId)) return null;
  const sp = new URLSearchParams(search);
  let touched = false;
  for (const k of CLOUDMAP_OBSOLETE_POOL_QUERY) {
    if (sp.has(k)) {
      sp.delete(k);
      touched = true;
    }
  }
  if (!touched) return null;
  const q = sp.toString();
  return q ? `${pathname}?${q}` : pathname;
}

export function cloudmapPathForNav(
  cloudId: string,
  tab: CloudmapPoolNavKey,
  opts?: {
    resourceHubSub?: CloudmapResourceSubKey;
    poolInnerSeg?: string;
  },
): string {
  const base = cloudmapPoolBasePath(cloudId);
  if (tab === 'resource_hub') {
    const sub = opts?.resourceHubSub || 'overview';
    return `${base}/resource_hub/${encodeURIComponent(sub)}`;
  }
  const innerMenu = INNER_MENU_BY_NAV[tab];
  if (innerMenu) {
    const raw = (opts?.poolInnerSeg || '').trim();
    const pi =
      raw && isValidCloudmapPoolInnerSeg(tab, raw)
        ? raw
        : cloudmapDefaultPoolInnerSeg(tab);
    return `${base}/${encodeURIComponent(tab)}/${encodeURIComponent(pi)}`;
  }
  return `${base}/${encodeURIComponent(tab)}`;
}

export function normalizeCloudmapPoolNavParam(tab: string | null): CloudmapPoolNavKey {
  const t = String(tab || '').trim();
  if (t === 'overview' || t === 'datacenter_topology') {
    return 'resource_hub';
  }
  const legacy = LEGACY_CLOUDMAP_POOL_NAV_ALIASES[t];
  if (legacy) return legacy;
  if ((CLOUDMAP_POOL_NAV_KEYS as readonly string[]).includes(t)) {
    return t as CloudmapPoolNavKey;
  }
  return 'resource_hub';
}

export function normalizeCloudmapResourceSubParam(
  tabParam: string | null,
  subParam: string | null,
): CloudmapResourceSubKey {
  let sub = String(subParam || '').trim();
  if (sub === 'datacenter_topology_new' || sub === 'switch_port_panel') {
    sub = 'datacenter_topology';
  }
  if ((CLOUDMAP_RESOURCE_SUB_KEYS as readonly string[]).includes(sub)) {
    return sub as CloudmapResourceSubKey;
  }
  const t = String(tabParam || '').trim();
  if (t === 'datacenter_topology') return 'datacenter_topology';
  if (t === 'network_topology') return 'network_topology';
  return 'overview';
}


type PoolTabMenuRow = {
  spec: RouteSpec;
  p: NonNullable<ReturnType<typeof parseCloudmapPoolRouteSpec>>;
};

/** 池内 Tab 侧栏叶子：支持 `poolNavSubgroup` 折叠为二级子菜单（与 `order` 顺序一致）。 */
function poolTabMenuChildrenWithSubgroups(
  rows: PoolTabMenuRow[],
  base: string,
  tab: CloudmapPoolNavKey,
): any[] {
  const sorted = [...rows].sort((a, b) => (a.spec.order ?? 0) - (b.spec.order ?? 0));
  const out: any[] = [];
  let i = 0;
  while (i < sorted.length) {
    const sg = sorted[i].spec.poolNavSubgroup;
    if (!sg) {
      const { spec, p } = sorted[i];
      out.push({ key: `${base}/${p.pathSuffix}`, label: spec.title });
      i += 1;
      continue;
    }
    const groupKey = sg;
    const bucket: any[] = [];
    while (i < sorted.length && sorted[i].spec.poolNavSubgroup === groupKey) {
      const { spec, p } = sorted[i];
      bucket.push({ key: `${base}/${p.pathSuffix}`, label: spec.title });
      i += 1;
    }
    if (bucket.length === 0) continue;
    const label =
      CLOUDMAP_POOL_NAV_SUBGROUP_LABELS[groupKey] ||
      groupKey;
    out.push({
      key: `__cloudmap_pool_sg_${tab}_${groupKey}`,
      label,
      children: bucket,
    });
  }
  return out;
}

function cloudmapPoolMenuItems(
  cloudId: string,
  opts?: CloudmapPoolSidebarBuildOpts,
): any[] {
  const base = `/admin/clouds/${encodeURIComponent(cloudId)}`;
  const visible = filterVisibleCloudmapPoolSpecs(opts)
    .map((spec) => {
      const p = parseCloudmapPoolRouteSpec(spec);
      return p ? { spec, p } : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => (a.spec.order ?? 0) - (b.spec.order ?? 0));

  const byTab: Partial<Record<CloudmapPoolNavKey, typeof visible>> = {};
  for (const row of visible) {
    const t = row.p.tab;
    (byTab[t] ??= []).push(row);
  }

  const items: any[] = [];
  for (const tab of CLOUDMAP_POOL_NAV_KEYS) {
    const rows = byTab[tab];
    if (!rows?.length) continue;

    if (tab === 'resource_hub') {
      items.push({
        key: CLOUDMAP_RESOURCE_HUB_MENU_GROUP_KEY,
        label: cloudmapNavLabel('resource_hub'),
        icon: cloudmapNavIcon('resource_hub'),
        children: rows.map(({ spec, p }) => ({
          key: `${base}/${p.pathSuffix}`,
          label: spec.title,
        })),
      });
      continue;
    }

    const parentKey =
      rows[0]?.spec.poolMenuParentKey || `cloudmap_menu_${tab}`;
    items.push({
      key: parentKey,
      label: cloudmapNavLabel(tab),
      icon: cloudmapNavIcon(tab),
      children: poolTabMenuChildrenWithSubgroups(
        rows as PoolTabMenuRow[],
        base,
        tab,
      ),
    });
  }
  return items;
}

/** 根据当前 pathname 在侧栏树中匹配最长前缀，作为选中项 */
export function cloudmapPoolSidebarSelectedKey(
  pathname: string,
  items: any[] | undefined,
): string {
  const flat: string[] = [];
  const walk = (xs: any[]) => {
    for (const it of xs || []) {
      const key = String(it?.key || '');
      if (key.startsWith('/')) flat.push(key);
      if (it?.children) walk(it.children);
    }
  };
  walk(items || []);
  let best = '';
  for (const k of flat) {
    if (pathname === k || pathname.startsWith(`${k}/`)) {
      if (k.length > best.length) best = k;
    }
  }
  return best || pathname;
}

/** 构建管理端侧栏「资源池」中心块（仅 Cloudmap 池） */

export function buildCloudmapPoolSidebarCenter(
  cloud: Cloud,
  cloudId: string,
  opts?: CloudmapPoolSidebarBuildOpts,
): AdminSidebarCenter | null {
  if (!cloudId || !cloud || !isCloudmapPool(cloud)) return null;
  return {
    key: CLOUD_POOL_SIDEBAR_CENTER_KEY,
    label: cloud.name || '资源池',
    items: cloudmapPoolMenuItems(cloudId, opts),
  };
}

/** 排除厂商池 / Rancher 集群工作台等更具体的 `/admin/clouds/...` 路由，避免贪婪误匹配。 */
const CLOUDMAP_RANCHER_CLUSTER_RE = /^\/admin\/clouds\/[^/]+\/clusters\/[^/]+$/;

/**
 * Cloudmap 资源池上下文侧栏 spec（complex / 路径段）。路径：`/admin/clouds/:cloudId/...`。
 * 注册表中须置于**最后**做兜底（`/admin/clouds/:id` 贪婪匹配）。
 */
export const cloudmapPoolSidebarSpec: PoolSidebarSpec = {
  type: 'cloudmap',
  presentation: 'context-sidebar',
  subNav: 'path',
  tier: 'complex',
  centerKey: CLOUD_POOL_SIDEBAR_CENTER_KEY,
  label: '资源池',
  icon: createElement(DashboardOutlined),
  navKeys: CLOUDMAP_POOL_NAV_KEYS,
  resolveContext: (pathname: string) => {
    if (pathname.startsWith('/admin/clouds/vendor/')) return null;
    if (CLOUDMAP_RANCHER_CLUSTER_RE.test(pathname)) return null;
    const id = parseCloudPoolDetailId(pathname);
    if (!id || id === 'vendor') return null;
    return { poolId: id };
  },
  matchCloud: (cloud: Cloud) => isCloudmapPool(cloud),
  buildSidebarCenter: ({ context, cloud, buildOpts }: PoolSidebarBuildArgs) => {
    if (!cloud) return null;
    return buildCloudmapPoolSidebarCenter(cloud, context.poolId, buildOpts);
  },
  selectedKey: ({ pathname, center }: PoolSidebarSelectArgs) =>
    cloudmapPoolSidebarSelectedKey(pathname, center.items),
  autoExpandByMenuKey: true,
  autoExpandSigPrefix: 'cloudmap-pool',
};

