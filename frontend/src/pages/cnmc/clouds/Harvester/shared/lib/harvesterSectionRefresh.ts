import { message } from 'antd';
import { clearGetCacheForPath } from 'utils/requestManager';

/** 云详情 / Cloudmap 池内 Section 列表刷新回调 */
export type HarvesterSectionOnRefresh = (force?: boolean, silent?: boolean) => void | Promise<void>;

export function harvesterNamespacesListCachePath(cloudId: string): string {
  return `/api/clouds/${cloudId}/resources/harvester/namespaces`;
}

export type RunHarvesterSectionRefreshOptions = {
  force?: boolean;
  silent?: boolean;
  before?: () => void;
  after?: () => void;
};

/**
 * 执行一次列表刷新（可指定 force / silent）。
 * 未配置 onRefresh 时仅 warning，不抛错。
 */
export function runHarvesterSectionRefresh(
  onRefresh: HarvesterSectionOnRefresh | undefined,
  options?: RunHarvesterSectionRefreshOptions,
): void {
  if (!onRefresh) {
    message.warning('刷新功能未配置');
    return;
  }
  const force = options?.force ?? true;
  const silent = options?.silent;
  options?.before?.();
  void Promise.resolve(onRefresh(force, silent))
    .catch((e: unknown) => {
      const err = e as { message?: string };
      message.error(`刷新失败: ${err?.message || '未知错误'}`);
    })
    .finally(() => {
      options?.after?.();
    });
}

/**
 * 工具栏「刷新」：默认 `onRefresh(true)`（silent 未传，由父级决定是否 toast）。
 */
export function createHarvesterToolbarRefresh(
  onRefresh: HarvesterSectionOnRefresh | undefined,
  options?: {
    before?: () => void;
    after?: () => void;
    silent?: boolean;
  },
): () => void {
  return () =>
    runHarvesterSectionRefresh(onRefresh, {
      force: true,
      silent: options?.silent,
      before: options?.before,
      after: options?.after,
    });
}

/** @deprecated 与 cluster 存量导入兼容；新代码请用 `createHarvesterToolbarRefresh` */
export const createClusterToolbarRefresh = createHarvesterToolbarRefresh;

/** @deprecated 与 cluster 存量导入兼容 */
export const runClusterSectionRefresh = runHarvesterSectionRefresh;

/** @deprecated 与 cluster 存量导入兼容 */
export type ClusterSectionOnRefresh = HarvesterSectionOnRefresh;

/** @deprecated 与 cluster 存量导入兼容 */
export type RunClusterSectionRefreshOptions = RunHarvesterSectionRefreshOptions;

/** 命名空间写操作成功后：清 GET 缓存并 `onRefresh(true, true)` */
export function reloadHarvesterNamespacesList(
  cloudId: string,
  onRefresh?: HarvesterSectionOnRefresh,
): void {
  clearGetCacheForPath(harvesterNamespacesListCachePath(cloudId));
  runHarvesterSectionRefresh(onRefresh, { force: true, silent: true });
}
