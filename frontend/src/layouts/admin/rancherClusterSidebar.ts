/**
 * Rancher 集群工作台侧栏：一级主导航 + 「集群」「工作负载」为二级子菜单；URL 仍用 `?tab=` 与 `?sub=`。
 * 路径：`/admin/clouds/:poolId/clusters/:clusterId` 时由 AdminLayout 注入。
 */
import { createElement, type ReactNode } from 'react';
import {
  ApartmentOutlined,
  AppstoreOutlined,
  ClusterOutlined,
  DatabaseOutlined,
  DeploymentUnitOutlined,
  FolderOpenOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import type { AdminSidebarCenter } from './AdminSidebar';

export const RANCHER_CLUSTER_SIDEBAR_CENTER_KEY = '/admin/rancher_cluster_context';

/** 一级（侧栏），与 Rancher 集群左侧主导航一致 */
export const RANCHER_CLUSTER_TAB_KEYS = [
  'cluster',
  'workloads',
  'apps',
  'service_discovery',
  'storage',
  'policies',
  'more_resources',
] as const;

export type RancherClusterTabKey = (typeof RANCHER_CLUSTER_TAB_KEYS)[number];

export const RANCHER_CLUSTER_TAB_LABEL: Record<RancherClusterTabKey, string> = {
  cluster: '集群',
  workloads: '工作负载',
  apps: '应用',
  service_discovery: '服务发现',
  storage: '存储',
  policies: '策略',
  more_resources: '更多资源',
};

/** 二级：仅 `tab=cluster` 时有效，对应 Rancher「集群」下子项 */
export const RANCHER_CLUSTER_SUB_KEYS = [
  'projects',
  'namespaces',
  'nodes',
  'members',
  'events',
  'cluster_tools',
] as const;

export type RancherClusterSubKey = (typeof RANCHER_CLUSTER_SUB_KEYS)[number];

export const RANCHER_CLUSTER_SUB_LABEL: Record<RancherClusterSubKey, string> = {
  projects: '项目',
  namespaces: '命名空间',
  nodes: '节点',
  members: '集群和项目成员',
  events: '事件',
  cluster_tools: '工具',
};

/** 与 URL `?tab=workloads&sub=` 及 Steve 路径段一致 */
export const RANCHER_CLUSTER_WORKLOADS_SUB_KEYS = [
  'cronjob',
  'daemonset',
  'deployment',
  'job',
  'statefulset',
  'pod',
] as const;

export type RancherClusterWorkloadsSubKey = (typeof RANCHER_CLUSTER_WORKLOADS_SUB_KEYS)[number];

export const RANCHER_CLUSTER_WORKLOADS_SUB_LABEL: Record<RancherClusterWorkloadsSubKey, string> = {
  cronjob: 'CronJob',
  daemonset: 'DaemonSet',
  deployment: 'Deployment',
  job: 'Job',
  statefulset: 'StatefulSet',
  pod: 'Pod',
};

/** 应用：与 `?sub=` 对应，拉 catalog.cattle.io App */
export const RANCHER_APPS_SUB_KEYS = ['catalog'] as const;
export type RancherAppsSubKey = (typeof RANCHER_APPS_SUB_KEYS)[number];
export const RANCHER_APPS_SUB_LABEL: Record<RancherAppsSubKey, string> = { catalog: '已装应用' };

/** 服务发现 */
export const RANCHER_SD_SUB_KEYS = ['services', 'ingresses'] as const;
export type RancherSdSubKey = (typeof RANCHER_SD_SUB_KEYS)[number];
export const RANCHER_SD_SUB_LABEL: Record<RancherSdSubKey, string> = {
  services: 'Service',
  ingresses: 'Ingress',
};

/** 存储 */
export const RANCHER_STORAGE_SUB_KEYS = [
  'persistentvolumes',
  'persistentvolumeclaims',
  'storageclasses',
] as const;
export type RancherStorageSubKey = (typeof RANCHER_STORAGE_SUB_KEYS)[number];
export const RANCHER_STORAGE_SUB_LABEL: Record<RancherStorageSubKey, string> = {
  persistentvolumes: 'PersistentVolume',
  persistentvolumeclaims: 'PersistentVolumeClaim',
  storageclasses: 'StorageClass',
};

/** 策略 */
export const RANCHER_POLICIES_SUB_KEYS = ['networkpolicies'] as const;
export type RancherPoliciesSubKey = (typeof RANCHER_POLICIES_SUB_KEYS)[number];
export const RANCHER_POLICIES_SUB_LABEL: Record<RancherPoliciesSubKey, string> = {
  networkpolicies: 'NetworkPolicy',
};

/** 更多资源 */
export const RANCHER_MORE_SUB_KEYS = ['configmaps', 'secrets'] as const;
export type RancherMoreSubKey = (typeof RANCHER_MORE_SUB_KEYS)[number];
export const RANCHER_MORE_SUB_LABEL: Record<RancherMoreSubKey, string> = {
  configmaps: 'ConfigMap',
  secrets: 'Secret',
};

/** Ant Design SubMenu 的 key（不以 `/` 开头，避免被当成路由） */
export const RANCHER_CLUSTER_MENU_GROUP_KEY = 'rancher_cluster_nested';
export const RANCHER_CLUSTER_WORKLOADS_MENU_GROUP_KEY = 'rancher_workloads_nested';
export const RANCHER_APPS_MENU_GROUP_KEY = 'rancher_apps_nested';
export const RANCHER_SD_MENU_GROUP_KEY = 'rancher_sd_nested';
export const RANCHER_STORAGE_MENU_GROUP_KEY = 'rancher_storage_nested';
export const RANCHER_POLICIES_MENU_GROUP_KEY = 'rancher_policies_nested';
export const RANCHER_MORE_MENU_GROUP_KEY = 'rancher_more_nested';

const TAB_ICON: Record<RancherClusterTabKey, ReactNode> = {
  cluster: createElement(ClusterOutlined),
  workloads: createElement(DeploymentUnitOutlined),
  apps: createElement(AppstoreOutlined),
  service_discovery: createElement(ApartmentOutlined),
  storage: createElement(DatabaseOutlined),
  policies: createElement(SafetyCertificateOutlined),
  more_resources: createElement(FolderOpenOutlined),
};

/** 历史一级 `?tab=` → 现行 key */
export const LEGACY_RANCHER_CLUSTER_TAB_TO_CANONICAL: Record<string, RancherClusterTabKey> = {
  overview: 'cluster',
  configs: 'more_resources',
  users_rbac: 'cluster',
  tools: 'cluster',
};

export function parseRancherClusterWorkspacePath(pathname: string): {
  poolId: string;
  clusterId: string;
} | null {
  const m = /^\/admin\/clouds\/([^/]+)\/clusters\/([^/]+)$/.exec(pathname);
  if (!m) return null;
  return {
    poolId: decodeURIComponent(m[1]),
    clusterId: decodeURIComponent(m[2]),
  };
}

function workloadChildLabel(text: string, count: number | undefined): ReactNode {
  return createElement(
    'span',
    {
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 8,
        width: '100%',
      },
    },
    createElement('span', null, text),
    createElement(
      'span',
      {
        style: {
          color: 'rgba(0,0,0,0.45)',
          fontSize: 12,
          fontVariantNumeric: 'tabular-nums',
        },
      },
      count != null && count >= 0 ? String(count) : '—',
    ),
  );
}

function clusterMenuItems(
  poolId: string,
  clusterId: string,
  workloadCounts?: Partial<Record<RancherClusterWorkloadsSubKey, number>>,
): any[] {
  const base = `/admin/clouds/${encodeURIComponent(poolId)}/clusters/${encodeURIComponent(clusterId)}`;
  return (RANCHER_CLUSTER_TAB_KEYS as readonly string[]).map((tab) => {
    const k = tab as RancherClusterTabKey;
    if (k === 'cluster') {
      return {
        key: RANCHER_CLUSTER_MENU_GROUP_KEY,
        label: RANCHER_CLUSTER_TAB_LABEL[k],
        icon: TAB_ICON[k],
        children: (
          RANCHER_CLUSTER_SUB_KEYS as readonly RancherClusterSubKey[]
        ).map((sk) => ({
          key: `${base}?tab=cluster&sub=${encodeURIComponent(sk)}`,
          label: RANCHER_CLUSTER_SUB_LABEL[sk],
        })),
      };
    }
    if (k === 'workloads') {
      return {
        key: RANCHER_CLUSTER_WORKLOADS_MENU_GROUP_KEY,
        label: RANCHER_CLUSTER_TAB_LABEL[k],
        icon: TAB_ICON[k],
        children: (
          RANCHER_CLUSTER_WORKLOADS_SUB_KEYS as readonly RancherClusterWorkloadsSubKey[]
        ).map((sk) => ({
          key: `${base}?tab=workloads&sub=${encodeURIComponent(sk)}`,
          label: workloadChildLabel(
            RANCHER_CLUSTER_WORKLOADS_SUB_LABEL[sk],
            workloadCounts?.[sk],
          ),
        })),
      };
    }
    if (k === 'apps') {
      return {
        key: RANCHER_APPS_MENU_GROUP_KEY,
        label: RANCHER_CLUSTER_TAB_LABEL[k],
        icon: TAB_ICON[k],
        children: (RANCHER_APPS_SUB_KEYS as readonly RancherAppsSubKey[]).map((sk) => ({
          key: `${base}?tab=apps&sub=${encodeURIComponent(sk)}`,
          label: RANCHER_APPS_SUB_LABEL[sk],
        })),
      };
    }
    if (k === 'service_discovery') {
      return {
        key: RANCHER_SD_MENU_GROUP_KEY,
        label: RANCHER_CLUSTER_TAB_LABEL[k],
        icon: TAB_ICON[k],
        children: (RANCHER_SD_SUB_KEYS as readonly RancherSdSubKey[]).map((sk) => ({
          key: `${base}?tab=service_discovery&sub=${encodeURIComponent(sk)}`,
          label: RANCHER_SD_SUB_LABEL[sk],
        })),
      };
    }
    if (k === 'storage') {
      return {
        key: RANCHER_STORAGE_MENU_GROUP_KEY,
        label: RANCHER_CLUSTER_TAB_LABEL[k],
        icon: TAB_ICON[k],
        children: (RANCHER_STORAGE_SUB_KEYS as readonly RancherStorageSubKey[]).map((sk) => ({
          key: `${base}?tab=storage&sub=${encodeURIComponent(sk)}`,
          label: RANCHER_STORAGE_SUB_LABEL[sk],
        })),
      };
    }
    if (k === 'policies') {
      return {
        key: RANCHER_POLICIES_MENU_GROUP_KEY,
        label: RANCHER_CLUSTER_TAB_LABEL[k],
        icon: TAB_ICON[k],
        children: (RANCHER_POLICIES_SUB_KEYS as readonly RancherPoliciesSubKey[]).map(
          (sk) => ({
            key: `${base}?tab=policies&sub=${encodeURIComponent(sk)}`,
            label: RANCHER_POLICIES_SUB_LABEL[sk],
          }),
        ),
      };
    }
    if (k === 'more_resources') {
      return {
        key: RANCHER_MORE_MENU_GROUP_KEY,
        label: RANCHER_CLUSTER_TAB_LABEL[k],
        icon: TAB_ICON[k],
        children: (RANCHER_MORE_SUB_KEYS as readonly RancherMoreSubKey[]).map((sk) => ({
          key: `${base}?tab=more_resources&sub=${encodeURIComponent(sk)}`,
          label: RANCHER_MORE_SUB_LABEL[sk],
        })),
      };
    }
    return {
      key: `${base}?tab=${encodeURIComponent(tab)}`,
      label: RANCHER_CLUSTER_TAB_LABEL[k] || tab,
      icon: TAB_ICON[k],
    };
  });
}

export function buildRancherClusterSidebarCenter(
  poolId: string,
  clusterId: string,
  poolDisplayName?: string,
  workloadCounts?: Partial<Record<RancherClusterWorkloadsSubKey, number>>,
): AdminSidebarCenter | null {
  if (!poolId || !clusterId) return null;
  const shortCluster =
    clusterId.length > 24 ? `${clusterId.slice(0, 12)}…${clusterId.slice(-8)}` : clusterId;
  return {
    key: RANCHER_CLUSTER_SIDEBAR_CENTER_KEY,
    label: poolDisplayName
      ? `${poolDisplayName} · ${shortCluster}`
      : `集群 · ${shortCluster}`,
    items: clusterMenuItems(poolId, clusterId, workloadCounts),
  };
}

export function normalizeRancherClusterWorkloadsSubParam(
  subParam: string | null,
): RancherClusterWorkloadsSubKey {
  let sub = String(subParam || '')
    .trim()
    .toLowerCase();
  if (sub === 'cronjobs') sub = 'cronjob';
  if (sub === 'daemonsets') sub = 'daemonset';
  if (sub === 'deployments') sub = 'deployment';
  if (sub === 'jobs') sub = 'job';
  if (sub === 'statefulsets') sub = 'statefulset';
  if (sub === 'pods') sub = 'pod';
  if ((RANCHER_CLUSTER_WORKLOADS_SUB_KEYS as readonly string[]).includes(sub)) {
    return sub as RancherClusterWorkloadsSubKey;
  }
  return 'cronjob';
}

export function normalizeRancherClusterTabParam(tab: string | null): RancherClusterTabKey {
  const t = String(tab || '').trim();
  const legacy = LEGACY_RANCHER_CLUSTER_TAB_TO_CANONICAL[t];
  if (legacy) return legacy;
  if ((RANCHER_CLUSTER_TAB_KEYS as readonly string[]).includes(t)) {
    return t as RancherClusterTabKey;
  }
  return 'cluster';
}

export function normalizeRancherClusterSubParam(
  tabParam: string | null,
  subParam: string | null,
  legacyTabHint?: string | null,
): RancherClusterSubKey {
  const tab = normalizeRancherClusterTabParam(tabParam);
  if (tab !== 'cluster') {
    return 'projects';
  }
  const hint = String(legacyTabHint || '').trim();
  if (hint === 'users_rbac') return 'members';
  if (hint === 'tools') return 'cluster_tools';

  let sub = String(subParam || '').trim();
  if (sub === 'projects_namespaces') sub = 'projects';
  if ((RANCHER_CLUSTER_SUB_KEYS as readonly string[]).includes(sub)) {
    return sub as RancherClusterSubKey;
  }
  return 'projects';
}

/** 应用 / 服务发现 / 存储 / 策略 / 更多资源 的 `?sub=` 规范化 */
export function normalizeRancherResourceSub(
  tab: RancherClusterTabKey,
  subParam: string | null,
): string {
  const s0 = String(subParam || '').trim().toLowerCase();
  switch (tab) {
    case 'apps':
      if (s0 === 'catalog' || s0 === 'catalogapps' || s0 === 'installed') return 'catalog';
      return 'catalog';
    case 'service_discovery': {
      if (s0 === 'ingress' || s0 === 'ingresses') return 'ingresses';
      if (s0 === 'service' || s0 === 'services') return 'services';
      if ((RANCHER_SD_SUB_KEYS as readonly string[]).includes(s0)) return s0;
      return 'services';
    }
    case 'storage': {
      if (s0 === 'pv' || s0 === 'persistentvolume') return 'persistentvolumes';
      if (s0 === 'pvc' || s0 === 'persistentvolumeclaim') return 'persistentvolumeclaims';
      if (s0 === 'sc' || s0 === 'storageclass') return 'storageclasses';
      if ((RANCHER_STORAGE_SUB_KEYS as readonly string[]).includes(s0)) return s0;
      return 'persistentvolumeclaims';
    }
    case 'policies': {
      if (s0 === 'netpol' || s0 === 'networkpolicy') return 'networkpolicies';
      if ((RANCHER_POLICIES_SUB_KEYS as readonly string[]).includes(s0)) return s0;
      return 'networkpolicies';
    }
    case 'more_resources': {
      if (s0 === 'secret' || s0 === 'secrets') return 'secrets';
      if (s0 === 'configmap' || s0 === 'configmaps' || s0 === 'cm') return 'configmaps';
      if ((RANCHER_MORE_SUB_KEYS as readonly string[]).includes(s0)) return s0;
      return 'configmaps';
    }
    default:
      return 'catalog';
  }
}

/**
 * 与后端 `GET /rancher/.../k8s/:kind` 的 kind 一致；apps 的 sub=catalog → catalogapps
 */
export function resolveRancherK8sListKey(
  tab: RancherClusterTabKey,
  resourceSub: string,
): string | null {
  const s = String(resourceSub || '').trim();
  if (tab === 'apps' && s === 'catalog') return 'catalogapps';
  if (tab === 'service_discovery' && (s === 'services' || s === 'ingresses')) return s;
  if (tab === 'storage' && (RANCHER_STORAGE_SUB_KEYS as readonly string[]).includes(s)) {
    return s;
  }
  if (tab === 'policies' && s === 'networkpolicies') return 'networkpolicies';
  if (tab === 'more_resources' && (s === 'configmaps' || s === 'secrets')) return s;
  return null;
}
