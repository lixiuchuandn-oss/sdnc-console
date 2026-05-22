import { message } from 'antd';
import { clearGetCacheForPath } from 'utils/requestManager';

/** 与云详情 / Cloudmap 池内 Section 一致的列表刷新回调 */
export type ClusterSectionOnRefresh = (force?: boolean, silent?: boolean) => void | Promise<void>;

export function harvesterNamespacesListCachePath(cloudId: string): string {
  return `/api/clouds/${cloudId}/resources/harvester/namespaces`;
}

export type RunClusterSectionRefreshOptions = {
  force?: boolean;
  silent?: boolean;
  before?: () => void;
  after?: () => void;
};

/**
 * 执行一次列表刷新（可指定 force / silent）。
 * 未配置 onRefresh 时仅 warning，不抛错。
 */
export function runClusterSectionRefresh(
  onRefresh: ClusterSectionOnRefresh | undefined,
  options?: RunClusterSectionRefreshOptions,
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
 * 返回的函数可直接用于 `Button onClick`。
 */
export function createClusterToolbarRefresh(
  onRefresh: ClusterSectionOnRefresh | undefined,
  options?: {
    before?: () => void;
    after?: () => void;
    /** 为 true 时传 `onRefresh(true, true)`，用于不需成功提示的静默刷新 */
    silent?: boolean;
  },
): () => void {
  return () =>
    runClusterSectionRefresh(onRefresh, {
      force: true,
      silent: options?.silent,
      before: options?.before,
      after: options?.after,
    });
}

/** 命名空间写操作成功后：清 GET 缓存并 `onRefresh(true, true)` */
export function reloadHarvesterNamespacesList(
  cloudId: string,
  onRefresh?: ClusterSectionOnRefresh,
): void {
  clearGetCacheForPath(harvesterNamespacesListCachePath(cloudId));
  runClusterSectionRefresh(onRefresh, { force: true, silent: true });
}
