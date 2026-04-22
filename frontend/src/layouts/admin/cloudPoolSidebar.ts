/**
 * 资源池详情页（如 Cloudmap）侧栏：与详情内主 Tab 的 key / `?tab=` 对齐。
 * 仅当路径为 `/admin/clouds/:id`（无子路径）且资源池为 Cloudmap 类型时由 AdminLayout 注入。
 *
 * 使用 createElement 而非 JSX，以便本文件保持 `.ts` 扩展名（避免部分 ESLint/ts 配置对 `.ts` 内 JSX 报错）。
 */
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
import type { AdminSidebarCenter } from './AdminSidebar';
import type { Cloud } from '../../pages/cnmc/pools/poolProviders';

/** 与顶栏「平台」下拉 key 区分，用于 pool 模式下侧栏/高亮 */
export const CLOUD_POOL_SIDEBAR_CENTER_KEY = '/admin/cloud_pool_context';

/**
 * 与 `CloudDetailCloudmap` 顶层 Tabs 的 key、`?tab=` 一致（顺序即侧栏顺序）。
 * 规范：**一律 snake_case**，与同级的 `cluster` / `containers` 对齐；不再使用 `*_group` 后缀与 kebab。
 * 旧链接见 `LEGACY_CLOUDMAP_POOL_TAB_TO_CANONICAL`。
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

/** 历史 `?tab=` → 现行规范 key（仅前端解析，不改权限点命名） */
export const LEGACY_CLOUDMAP_POOL_TAB_TO_CANONICAL: Record<string, CloudmapPoolTabKey> = {
  'monitoring-alerts': 'monitoring_alerts',
  'logs-config': 'logs_config',
  compute_group: 'compute',
  storage_group: 'storage',
  backups_group: 'backups',
  flat_network_group: 'flat_network',
  kube_ovn_group: 'kube_ovn',
};

/** `resource_hub` 内二级 Tab，与 URL `sub` 对齐 */
export const CLOUDMAP_RESOURCE_SUB_KEYS = [
  'overview',
  'datacenter_topology',
  'network_topology',
] as const;

export type CloudmapResourceSubKey = (typeof CLOUDMAP_RESOURCE_SUB_KEYS)[number];

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

/** 与 Tab 语义对应的侧栏图标（Ant Design Outlined） */
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

export function parseCloudPoolDetailId(pathname: string): string | null {
  const m = /^\/admin\/clouds\/([^/]+)$/.exec(pathname);
  return m ? decodeURIComponent(m[1]) : null;
}

function poolProviderRaw(cloud: Cloud): string {
  return String(cloud?.config?.provider || cloud?.type || '')
    .toLowerCase()
    .trim();
}

export function isCloudmapPool(cloud: Cloud): boolean {
  const p = poolProviderRaw(cloud);
  return p === 'cloudmap.edge' || p === 'cloudmap.private';
}

function cloudmapPoolMenuItems(
  cloudId: string,
): { key: string; label: string; icon: ReactNode }[] {
  const base = `/admin/clouds/${encodeURIComponent(cloudId)}`;
  return (CLOUDMAP_POOL_TAB_KEYS as readonly string[]).map((tab) => {
    const k = tab as CloudmapPoolTabKey;
    return {
      key: `${base}?tab=${encodeURIComponent(tab)}`,
      label: CLOUDMAP_TAB_LABEL[k] || tab,
      icon: CLOUDMAP_TAB_ICON[k],
    };
  });
}

/**
 * 当前资源池在 summary 中且为 Cloudmap 时，返回替换侧栏用的「单中心」菜单。
 */
export function buildCloudmapPoolSidebarCenter(
  cloud: Cloud,
  cloudId: string,
): AdminSidebarCenter | null {
  if (!cloudId || !cloud || !isCloudmapPool(cloud)) return null;
  return {
    key: CLOUD_POOL_SIDEBAR_CENTER_KEY,
    label: cloud.name || '资源池',
    items: cloudmapPoolMenuItems(cloudId),
  };
}

export function normalizeCloudmapPoolTabParam(tab: string | null): CloudmapPoolTabKey {
  const t = String(tab || '').trim();
  /** 历史 `overview` / `datacenter_topology` 一级 Tab 已并入 `resource_hub` */
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

/**
 * 解析资源总览分组下的子 Tab（`?tab=resource_hub&sub=…`；兼容旧链接 `?tab=datacenter_topology`）。
 */
export function normalizeCloudmapResourceSubParam(
  tabParam: string | null,
  subParam: string | null,
): CloudmapResourceSubKey {
  let sub = String(subParam || '').trim();
  /** 历史 `sub=datacenter_topology_new` / `switch_port_panel` 已并入 `datacenter_topology`（`switch_ref` 仍由拓扑页消费） */
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
