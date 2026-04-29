/**
 * Cloudmap 资源池：侧栏、路径、Tab 元数据、RouteSpec 解析（单模块，避免目录内过度切分）。
 * 数据与 `routes/cloudmapPoolNavRows.ts` → `routeSpecs`（navScope: cloudmap-pool）一致。
 */
import { routeSpecs, type RouteSpec } from '../../../routes/RouteSpec';
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
} from '@ant-design/icons';
import type { AdminSidebarCenter } from '../AdminSidebar';
import type { Cloud } from '../../../pages/cnmc/pools/poolProviders';


/**
 * Cloudmap 资源池：Tab/子键类型与集群锚点常量。
 * 侧栏与路径叶子以 `routes/cloudmapPoolNavRows.ts` → `routeSpecs` 为唯一数据源（与 SDN 一致）。
 */
export const CLOUDMAP_POOL_TAB_KEYS = [
  'resource_hub',
  'monitoring_alerts',
  'cluster',
  'compute',
  'paas_databases',
  'containers',
  'storage',
  'backups',
  'flat_network',
  'kube_ovn',
  'logs_config',
] as const;

export type CloudmapPoolTabKey = (typeof CLOUDMAP_POOL_TAB_KEYS)[number];

export const CLOUDMAP_RESOURCE_SUB_KEYS = [
  'overview',
  'datacenter_topology',
  'network_topology',
] as const;

export type CloudmapResourceSubKey = (typeof CLOUDMAP_RESOURCE_SUB_KEYS)[number];

export type CloudmapPoolInnerMenuItem = { pathSeg: string; label: string };

export const CLOUDMAP_RESOURCE_HUB_MENU_GROUP_KEY = 'cloudmap_menu_resource_hub';

/** 集群页 URL 锚点（无独立 RouteSpec 叶子） */
export const CLOUDMAP_CLUSTER_INNER_MENU: CloudmapPoolInnerMenuItem[] = [
  { pathSeg: 'cluster_nodes', label: '物理节点' },
  { pathSeg: 'cluster_physical_switches', label: '物理交换机' },
  { pathSeg: 'kubeovn_public_networks', label: '物理网络' },
  { pathSeg: 'namespaces', label: '命名空间' },
  { pathSeg: 'kubeovn_public_subnets', label: '公共子网' },
  { pathSeg: 'cluster_vlans', label: 'VLANs' },
  { pathSeg: 'gpu', label: 'GPU' },
  { pathSeg: 'cluster_usb', label: 'USB 设备' },
  { pathSeg: 'clusterNetworks', label: '集群网络' },
  { pathSeg: 'cluster_services', label: '基础服务' },
  { pathSeg: 'storage_classes', label: '存储类' },
  { pathSeg: 'nads', label: '附加网络(NAD)' },
  { pathSeg: 'load_balancers', label: '负载均衡' },
  { pathSeg: 'ippools', label: 'IP地址池' },
  { pathSeg: 'cluster_pci', label: 'PCI 设备' },
];

export const CLOUDMAP_CLUSTER_SECTION_KEYS = CLOUDMAP_CLUSTER_INNER_MENU.map(
  (x) => x.pathSeg,
) as readonly string[];


/**
 * Cloudmap 池：侧栏与 INNER_MENU 均从 `routeSpecs`（navScope: cloudmap-pool）派生，与 SDN 同源思路。
 */

const CM_PREFIX = '/admin/clouds/:cloudId/';

export function getCloudmapPoolRouteSpecs(): RouteSpec[] {
  return routeSpecs.filter((s) => s.navScope === 'cloudmap-pool');
}

function isPoolTab(s: string): s is CloudmapPoolTabKey {
  return (CLOUDMAP_POOL_TAB_KEYS as readonly string[]).includes(s);
}

/** 从 RouteSpec.path 解析池内 tab / 内层段 / 侧栏形态 */
export function parseCloudmapPoolRouteSpec(spec: RouteSpec): {
  pathSuffix: string;
  tab: CloudmapPoolTabKey;
  pathSeg: string;
  placement: 'group' | 'top';
} | null {
  if (spec.navScope !== 'cloudmap-pool' || !spec.path.startsWith(CM_PREFIX)) return null;
  const pathSuffix = spec.path.slice(CM_PREFIX.length);
  const parts = pathSuffix.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const head = parts[0];
  if (!isPoolTab(head)) return null;
  if (head === 'resource_hub') {
    return { pathSuffix, tab: 'resource_hub', pathSeg: parts[1] || '', placement: 'group' };
  }
  return { pathSuffix, tab: head, pathSeg: parts[1] || '', placement: 'group' };
}

export function buildInnerMenuByTab(): Partial<
  Record<CloudmapPoolTabKey, readonly CloudmapPoolInnerMenuItem[]>
> {
  const acc: Partial<Record<CloudmapPoolTabKey, CloudmapPoolInnerMenuItem[]>> = {};
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
  const frozen: Partial<Record<CloudmapPoolTabKey, readonly CloudmapPoolInnerMenuItem[]>> = {};
  (Object.keys(acc) as CloudmapPoolTabKey[]).forEach((k) => {
    frozen[k] = Object.freeze([...(acc[k] || [])]) as readonly CloudmapPoolInnerMenuItem[];
  });
  return frozen;
}

export function filterVisibleCloudmapPoolSpecs(opts?: CloudmapPoolSidebarBuildOpts): RouteSpec[] {
  return getCloudmapPoolRouteSpecs().filter((spec) => {
    if (opts?.ovnVpcEnabled === false && spec.path.includes('/kube_ovn/')) return false;
    if (spec.requiredFeature && opts?.hasFeature && !opts.hasFeature(spec.requiredFeature)) {
      return false;
    }
    if (opts?.poolRouteAccess && !opts.poolRouteAccess(spec)) return false;
    return true;
  });
}


/**
 * Cloudmap 资源池：路径/类型与 Tab 标签；导航叶子见 `routes/cloudmapPoolNavRows.ts` → `routeSpecs`。
 */

export const CLOUD_POOL_SIDEBAR_CENTER_KEY = '/admin/cloud_pool_context';

export const LEGACY_CLOUDMAP_POOL_TAB_TO_CANONICAL: Record<string, CloudmapPoolTabKey> = {
  'monitoring-alerts': 'monitoring_alerts',
  'logs-config': 'logs_config',
  compute_group: 'compute',
  storage_group: 'storage',
  backups_group: 'backups',
  flat_network_group: 'flat_network',
  kube_ovn_group: 'kube_ovn',
};

const CLOUDMAP_TAB_LABEL: Record<CloudmapPoolTabKey, string> = {
  resource_hub: '资源总览',
  monitoring_alerts: '监控告警',
  cluster: '集群',
  compute: '云主机',
  paas_databases: '云数据库',
  containers: '容器',
  storage: '云存储',
  backups: '云备份',
  flat_network: '扁平子网',
  kube_ovn: 'VPC网络',
  logs_config: '日志管理',
};

const CLOUDMAP_TAB_ICON: Record<CloudmapPoolTabKey, ReactNode> = {
  resource_hub: createElement(DashboardOutlined),
  monitoring_alerts: createElement(AlertOutlined),
  cluster: createElement(ClusterOutlined),
  compute: createElement(DesktopOutlined),
  paas_databases: createElement(ConsoleSqlOutlined),
  containers: createElement(DeploymentUnitOutlined),
  storage: createElement(DatabaseOutlined),
  backups: createElement(CloudDownloadOutlined),
  flat_network: createElement(ApartmentOutlined),
  kube_ovn: createElement(GlobalOutlined),
  logs_config: createElement(FileTextOutlined),
};

export function cloudmapTabLabel(tab: CloudmapPoolTabKey): string {
  return CLOUDMAP_TAB_LABEL[tab] || tab;
}

export function cloudmapTabIcon(tab: CloudmapPoolTabKey): ReactNode {
  return CLOUDMAP_TAB_ICON[tab];
}

export type ParsedCloudmapPoolPath = {
  tab: CloudmapPoolTabKey;
  resourceHubSub?: CloudmapResourceSubKey;
  poolInnerSeg?: string;
};

const _innerFrozen = buildInnerMenuByTab();

export const INNER_MENU_BY_TAB: Partial<
  Record<CloudmapPoolTabKey, readonly CloudmapPoolInnerMenuItem[]>
> = _innerFrozen;

export const CLOUDMAP_COMPUTE_INNER_MENU: readonly CloudmapPoolInnerMenuItem[] =
  INNER_MENU_BY_TAB.compute || [];
export const CLOUDMAP_STORAGE_INNER_MENU: readonly CloudmapPoolInnerMenuItem[] =
  INNER_MENU_BY_TAB.storage || [];
export const CLOUDMAP_CONTAINERS_INNER_MENU: readonly CloudmapPoolInnerMenuItem[] =
  INNER_MENU_BY_TAB.containers || [];
export const CLOUDMAP_BACKUPS_INNER_MENU: readonly CloudmapPoolInnerMenuItem[] =
  INNER_MENU_BY_TAB.backups || [];
export const CLOUDMAP_FLAT_NETWORK_INNER_MENU: readonly CloudmapPoolInnerMenuItem[] =
  INNER_MENU_BY_TAB.flat_network || [];
export const CLOUDMAP_KUBE_OVN_INNER_MENU: readonly CloudmapPoolInnerMenuItem[] =
  INNER_MENU_BY_TAB.kube_ovn || [];
export const CLOUDMAP_PAAS_DATABASES_INNER_MENU: readonly CloudmapPoolInnerMenuItem[] =
  INNER_MENU_BY_TAB.paas_databases || [];
export const CLOUDMAP_MONITORING_ALERTS_INNER_MENU: readonly CloudmapPoolInnerMenuItem[] =
  INNER_MENU_BY_TAB.monitoring_alerts || [];
export const CLOUDMAP_LOGS_CONFIG_INNER_MENU: readonly CloudmapPoolInnerMenuItem[] =
  INNER_MENU_BY_TAB.logs_config || [];

export function cloudmapInnerMenuForTab(
  tab: CloudmapPoolTabKey,
): readonly CloudmapPoolInnerMenuItem[] | undefined {
  return INNER_MENU_BY_TAB[tab];
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

export function cloudmapTabUsesPoolInnerPath(tab: CloudmapPoolTabKey): boolean {
  return Boolean(INNER_MENU_BY_TAB[tab]);
}

export function cloudmapDefaultPoolInnerSeg(tab: CloudmapPoolTabKey): string {
  const m = INNER_MENU_BY_TAB[tab];
  return m?.[0]?.pathSeg || '';
}

export function isValidCloudmapPoolInnerSeg(
  tab: CloudmapPoolTabKey,
  seg: string,
): boolean {
  const m = INNER_MENU_BY_TAB[tab];
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
  if (!(CLOUDMAP_POOL_TAB_KEYS as readonly string[]).includes(seg)) {
    return null;
  }
  const tab = seg as CloudmapPoolTabKey;
  const innerMenu = INNER_MENU_BY_TAB[tab];
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
  const tab = normalizeCloudmapPoolTabParam(rawTab);
  if (tab === 'resource_hub') {
    const sub = normalizeCloudmapResourceSubParam(rawTab, sp.get('sub'));
    return `${base}/resource_hub/${encodeURIComponent(sub)}`;
  }
  if (tab === 'cluster') {
    const cs = (sp.get('cluster_sub') || '').trim();
    const clusterSeg = (sp.get('cluster_segment') || '').trim();
    if (
      clusterSeg &&
      cs === 'clusterNetworks' &&
      isValidCloudmapPoolInnerSeg('cluster', clusterSeg)
    ) {
      return `${base}/cluster/${encodeURIComponent(clusterSeg)}`;
    }
    if (cs && isValidCloudmapPoolInnerSeg('cluster', cs)) {
      return `${base}/cluster/${encodeURIComponent(cs)}`;
    }
    return `${base}/cluster/${encodeURIComponent(cloudmapDefaultPoolInnerSeg('cluster'))}`;
  }
  const innerMenu = INNER_MENU_BY_TAB[tab];
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
  if (!isValidCloudmapPoolInnerSeg('cluster', seg)) return null;
  const nextPath = `${cloudmapPoolBasePath(cloudId)}/cluster/${encodeURIComponent(seg)}`;
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
    const nextPath = cloudmapPathForTab(cloudId, 'cluster', { poolInnerSeg: qSeg });
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

export function cloudmapPathForTab(
  cloudId: string,
  tab: CloudmapPoolTabKey,
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
  const innerMenu = INNER_MENU_BY_TAB[tab];
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

export function normalizeCloudmapPoolTabParam(tab: string | null): CloudmapPoolTabKey {
  const t = String(tab || '').trim();
  if (t === 'overview' || t === 'datacenter_topology') {
    return 'resource_hub';
  }
  const legacy = LEGACY_CLOUDMAP_POOL_TAB_TO_CANONICAL[t];
  if (legacy) return legacy;
  if ((CLOUDMAP_POOL_TAB_KEYS as readonly string[]).includes(t)) {
    return t as CloudmapPoolTabKey;
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

  const byTab: Partial<Record<CloudmapPoolTabKey, typeof visible>> = {};
  for (const row of visible) {
    const t = row.p.tab;
    (byTab[t] ??= []).push(row);
  }

  const items: any[] = [];
  for (const tab of CLOUDMAP_POOL_TAB_KEYS) {
    const rows = byTab[tab];
    if (!rows?.length) continue;

    if (tab === 'resource_hub') {
      items.push({
        key: CLOUDMAP_RESOURCE_HUB_MENU_GROUP_KEY,
        label: cloudmapTabLabel('resource_hub'),
        icon: cloudmapTabIcon('resource_hub'),
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
      label: cloudmapTabLabel(tab),
      icon: cloudmapTabIcon(tab),
      children: rows.map(({ spec, p }) => ({
        key: `${base}/${p.pathSuffix}`,
        label: spec.title,
      })),
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

