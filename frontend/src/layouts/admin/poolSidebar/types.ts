/**
 * 资源池上下文侧栏「契约」：统一各资源池（Cloudmap / Rancher / MAAS / Xinference / CSM /
 * 华为 / 阿里云 等）进入后「左侧上下文侧栏」这一唯一子模块导航范式。
 *
 * 背景：历史上存在三种范式——
 *   1. 侧栏 + 路径分段（Cloudmap / Rancher）；
 *   2. 侧栏 + `?tab=`（MAAS / Xinference）；
 *   3. 无侧栏 + 顶部 Tabs（华为 / 阿里云）。
 * 本契约把「侧栏形态 + 跳转载体」抽象为 `PoolSidebarSpec`，由各池声明、`registry` 注册，
 * `useSidebarMenuState` 查表分发，替代历史的 `if (xxxPoolSidebarCenter)…` 硬编码分支。
 *
 * 约束：`presentation` 恒为 `'context-sidebar'`（消灭「无侧栏 + 顶部 Tab」范式）。
 */
import type { ReactNode } from 'react';
import type { AdminSidebarCenter } from '../AdminSidebar';
import type { Cloud } from '../../../pages/cnmc/pools/lib/poolProviders';
import type { RouteSpec } from '../../../routes/RouteSpec';

/** 侧栏项跳转载体：路径分段（`/seg/seg`）或查询参数（`?tab=`）。 */
export type PoolSidebarSubNav = 'path' | 'tab';

/**
 * 复杂度分层（仅元数据，便于审计/分组）：
 * - `simple`：扁平 `?tab=` 菜单（MAAS / Xinference / 华为 / 阿里云）；
 * - `complex`：含分组 / 多级子菜单（Cloudmap / Rancher）；
 * - `external-redirect`：基路径不在本平台（CSM 位于 SDNCC `security/traffic`，含「返回列表」项）。
 */
export type PoolSidebarTier = 'simple' | 'complex' | 'external-redirect';

/** 解析自 `pathname` 的池上下文：`poolId` 必有；Rancher 集群工作台额外携带 `clusterId`。 */
export interface PoolSidebarContext {
  poolId: string;
  clusterId?: string;
}

/** Cloudmap 等按 RBAC / License 特性过滤侧栏叶子所需的选项。 */
export interface PoolSidebarCenterOpts {
  ovnVpcEnabled?: boolean;
  hasFeature?: (feature: string) => boolean;
  poolRouteAccess?: (spec: RouteSpec) => boolean;
}

/** 构建侧栏时的附加数据（如 Rancher 工作负载计数）。 */
export interface PoolSidebarBuildExtra {
  rancherWorkloadCounts?: Record<string, number>;
}

/** `buildSidebarCenter` 入参：封装各池对 cloud 是否必需 / 类型校验的差异。 */
export interface PoolSidebarBuildArgs {
  context: PoolSidebarContext;
  /** 命中的云实例（按 `poolId` 在 summaryClouds 内匹配）；列表未加载或厂商池不要求时为 undefined。 */
  cloud?: Cloud;
  /** summaryClouds 总数：用于「列表已加载但类型不符 → 不渲染」判定（列表未加载 = 0）。 */
  summaryCloudCount: number;
  /** Cloudmap 等 RBAC / 特性过滤选项。 */
  buildOpts?: PoolSidebarCenterOpts;
  /** Rancher 工作负载计数等附加数据。 */
  extra?: PoolSidebarBuildExtra;
}

/** `selectedKey` 入参。 */
export interface PoolSidebarSelectArgs {
  context: PoolSidebarContext;
  pathname: string;
  search: string;
  /** 已构建的侧栏 center；`path` 型据其 `items` 做最长前缀匹配。 */
  center: AdminSidebarCenter;
}

/**
 * 单个资源池的上下文侧栏声明。各池在自身 `*Sidebar.ts` 内实现并注册到 `poolSidebarRegistry`，
 * 不改变其已对外导出的函数签名（被页面广泛引用）。
 */
export interface PoolSidebarSpec {
  /** 池类型标识（与 `inferPoolRouteKind` 语义对齐，如 `cloudmap` / `rancher` / `maas` / `huawei`）。 */
  type: string;
  /** 恒为 `'context-sidebar'`：所有池进入后均呈现左侧上下文侧栏。 */
  presentation: 'context-sidebar';
  /** 侧栏项跳转载体。 */
  subNav: PoolSidebarSubNav;
  /** 复杂度分层（元数据）。 */
  tier: PoolSidebarTier;
  /** 侧栏中心块 key（与 `AdminSidebarCenter.key` 一致，用于 `activeSidebarKey`）。 */
  centerKey: string;
  /** 侧栏标题兜底（实际优先用云实例名）。 */
  label: string;
  /** 池类型图标（可选）。 */
  icon?: ReactNode;
  /** 该池所有一级导航 key（审计 / 兜底用）。 */
  navKeys: readonly string[];
  /** 仅 `subNav==='tab'` 提供：构建某 tab 的整段 URL（含 `?tab=`）。 */
  pathForTab?: (cloudId: string, tab: string) => string;
  /** 仅 `subNav==='tab'` 提供：规范化 `?tab=` 原始值到合法 tab key。 */
  normalizeTabParam?: (tab: string | null) => string;
  /** 解析 `pathname` → 池上下文；非本池路由返回 `null`。 */
  resolveContext: (pathname: string) => PoolSidebarContext | null;
  /** 判定某 cloud 是否本池类型。 */
  matchCloud: (cloud: Cloud) => boolean;
  /** 构建上下文侧栏 center（封装各自的 cloud 必需性 / 类型校验，不满足返回 `null`）。 */
  buildSidebarCenter: (args: PoolSidebarBuildArgs) => AdminSidebarCenter | null;
  /** 计算当前应高亮的菜单 key（与 `items[].key` 一致）。 */
  selectedKey: (args: PoolSidebarSelectArgs) => string | undefined;
  /**
   * openKeys 自动展开策略：
   * - `true`：按「选中 menuKey」反查其父分组并展开（含分组 / 子菜单的 Cloudmap / Rancher / CSM）；
   * - `false` / 省略：按 path chain 展开（扁平 `?tab=` 菜单即等价 no-op）。
   */
  autoExpandByMenuKey?: boolean;
  /** 自动展开签名前缀（与历史一致：`rancher` / `cloudmap-pool` / `csm-pool`）。 */
  autoExpandSigPrefix?: string;
}
