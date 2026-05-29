/**
 * 资源池上下文侧栏注册表：所有实现 `PoolSidebarSpec` 的池在此集中注册，
 * 供 `useSidebarMenuState` 查表分发（替代历史的 `if (xxxPoolSidebarCenter)…` 硬编码分支）。
 *
 * 顺序约定：更「具体」的池路由在前；`cloudmap`（`/admin/clouds/:id` 贪婪匹配）必须置于**最后**做兜底。
 * 各 `resolveContext` 已对非本池路由返回 `null`，故 `resolvePoolSidebarForPath` 取首个命中即可。
 */
import type { PoolSidebarContext, PoolSidebarSpec } from './types';
import { rancherClusterPoolSidebarSpec } from '../rancher/rancherClusterSidebar';
import { csmPoolSidebarSpec } from '../csm/csmPoolSidebar';
import { xinferencePoolSidebarSpec } from '../xinference/xinferencePoolSidebar';
import { maasPoolSidebarSpec } from '../maas/maasPoolSidebar';
import { hwPoolSidebarSpec } from '../hw/hwPoolSidebar';
import { aliyunPoolSidebarSpec } from '../aliyun/aliyunPoolSidebar';
import { cloudmapPoolSidebarSpec } from '../cloudmap/cloudPoolSidebar';

/** 解析结果：命中的 spec 与其池上下文。 */
export interface ResolvedPoolSidebar {
  spec: PoolSidebarSpec;
  context: PoolSidebarContext;
}

/** 纯函数：在给定注册表中按 `type` 查询 spec。 */
export function findPoolSidebarSpecByType(
  registry: readonly PoolSidebarSpec[],
  type: string,
): PoolSidebarSpec | undefined {
  return registry.find((s) => s.type === type);
}

/** 纯函数：在给定注册表中按 `pathname` 解析首个命中的 spec 与上下文。 */
export function resolvePoolSidebarForPath(
  registry: readonly PoolSidebarSpec[],
  pathname: string,
): ResolvedPoolSidebar | null {
  for (const spec of registry) {
    const context = spec.resolveContext(pathname);
    if (context) return { spec, context };
  }
  return null;
}

/**
 * 已注册的资源池上下文侧栏。
 * 顺序：更具体的池路由在前；`cloudmap`（`/admin/clouds/:id` 贪婪匹配）置于**最后**做兜底。
 */
export const poolSidebarRegistry: readonly PoolSidebarSpec[] = [
  rancherClusterPoolSidebarSpec,
  csmPoolSidebarSpec,
  xinferencePoolSidebarSpec,
  maasPoolSidebarSpec,
  hwPoolSidebarSpec,
  aliyunPoolSidebarSpec,
  cloudmapPoolSidebarSpec,
];

/** 便捷封装：基于模块级注册表按 `type` 查询。 */
export function getPoolSidebarSpec(type: string): PoolSidebarSpec | undefined {
  return findPoolSidebarSpecByType(poolSidebarRegistry, type);
}

/** 便捷封装：基于模块级注册表按 `pathname` 解析。 */
export function resolvePoolSidebar(pathname: string): ResolvedPoolSidebar | null {
  return resolvePoolSidebarForPath(poolSidebarRegistry, pathname);
}
