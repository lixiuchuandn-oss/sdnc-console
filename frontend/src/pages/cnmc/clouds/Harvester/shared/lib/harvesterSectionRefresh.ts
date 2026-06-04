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
 * Section 写成功/删改后须用本函数，勿直接 `onRefresh(true)`。
 */
export function runHarvesterSectionRefresh(
  onRefresh: HarvesterSectionOnRefresh | undefined,
  options?: RunHarvesterSectionRefreshOptions,
): Promise<void> {
  if (!onRefresh) {
    message.warning('刷新功能未配置');
    return Promise.resolve();
  }
  const force = options?.force ?? true;
  const silent = options?.silent;
  options?.before?.();
  return Promise.resolve(onRefresh(force, silent))
    .catch((e: unknown) => {
      const err = e as { message?: string };
      message.error(`刷新失败: ${err?.message || '未知错误'}`);
    })
    .finally(() => {
      options?.after?.();
    }) as Promise<void>;
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

export function harvesterBackupsListCachePath(cloudId: string): string {
  return `/api/clouds/${cloudId}/resources/harvester/backups`;
}

/** 云主机备份/快照列表刷新（第二参为 skipSync，与 `fetchHarvesterBackups` 一致） */
export type HarvesterBackupsInventoryReload = (
  force?: boolean,
  skipSync?: boolean,
) => void | Promise<void>;

export type NotifyHarvesterBackupsInventoryOptions = {
  /** 仅读 Tower 库存（skipSync），用于尽快展示新行 */
  inventoryDelaysMs?: number[];
  /** 对端全量同步（skipSync=false），刷新 readyToUse 等状态；须晚于集群可列出对象 */
  statusSyncDelaysMs?: number[];
};

function runHarvesterBackupsInventoryReload(
  cloudId: string,
  reload: HarvesterBackupsInventoryReload,
  skipSync: boolean,
  showError: boolean,
): void {
  clearGetCacheForPath(harvesterBackupsListCachePath(cloudId));
  Promise.resolve(reload(true, skipSync)).catch((e: unknown) => {
    if (!showError) return;
    const err = e as { message?: string };
    message.error(`刷新备份列表失败: ${err?.message || '未知错误'}`);
  });
}

/**
 * 虚拟机备份/快照写操作后：先 skipSync 拉库存（新行），再延迟 force 同步刷新状态。
 * 过早全量 sync 会在集群尚未列出对象时清空本地行（见 inventory upsertItems）。
 */
export function harvesterImagesListCachePath(cloudId: string): string {
  return `/api/clouds/${cloudId}/resources/harvester/images`;
}

/** 镜像 Tab 库存刷新（第二参 skipSync，与 `fetchHarvesterImages` / `loadTabResource('images')` 一致） */
export type HarvesterImagesInventoryReload = (
  force?: boolean,
  skipSync?: boolean,
) => void | Promise<void>;

export type NotifyHarvesterImagesInventoryOptions = {
  /** 仅读 Tower 库存（skipSync），用于尽快展示新行 */
  inventoryDelaysMs?: number[];
  /** 对端全量同步（skipSync=false），刷新 URL 导入/集群侧 progress / 就绪状态 */
  statusSyncDelaysMs?: number[];
};

/**
 * 本地上传同步 success 后：先读库存，再延迟对端 sync（后端 success 与 syncHarvesterImages 有时差）。
 */
export const HARVESTER_IMAGES_AFTER_UPLOAD_SYNC_OPTIONS: NotifyHarvesterImagesInventoryOptions =
  {
    inventoryDelaysMs: [0, 1500],
    statusSyncDelaysMs: [4000, 12000],
  };

type PendingImagesInventoryNotify = {
  timerIds: ReturnType<typeof setTimeout>[];
};

const pendingImagesInventoryNotifyByCloud = new Map<string, PendingImagesInventoryNotify>();

/** 取消尚未触发的镜像库存延迟刷新链（同 cloud 重复 notify 时合并） */
export function cancelHarvesterImagesInventoryNotify(cloudId: string): void {
  const pending = pendingImagesInventoryNotifyByCloud.get(cloudId);
  if (!pending) return;
  for (const id of pending.timerIds) clearTimeout(id);
  pendingImagesInventoryNotifyByCloud.delete(cloudId);
}

function runHarvesterImagesInventoryReload(
  cloudId: string,
  reload: HarvesterImagesInventoryReload,
  skipSync: boolean,
  showError: boolean,
): void {
  clearGetCacheForPath(harvesterImagesListCachePath(cloudId));
  Promise.resolve(reload(true, skipSync)).catch((e: unknown) => {
    if (!showError) return;
    const err = e as { message?: string };
    message.error(`刷新镜像列表失败: ${err?.message || '未知错误'}`);
  });
}

/**
 * 镜像写操作后：先 skipSync 拉库存（新行），再按需延迟全量 sync 刷新进度/就绪状态。
 */
export const HARVESTER_IMAGES_SYNC_START_OPTIONS: NotifyHarvesterImagesInventoryOptions = {
  inventoryDelaysMs: [0, 4000],
  statusSyncDelaysMs: [8000, 20000],
};

export function notifyHarvesterImagesInventoryChanged(
  cloudId: string,
  reload?: HarvesterImagesInventoryReload,
  options?: NotifyHarvesterImagesInventoryOptions,
): void {
  if (!cloudId || !reload) return;
  cancelHarvesterImagesInventoryNotify(cloudId);

  const inventoryDelays = options?.inventoryDelaysMs ?? [0, 2000, 5000];
  const statusSyncDelays = options?.statusSyncDelaysMs ?? [];
  const pending: PendingImagesInventoryNotify = { timerIds: [] };

  for (const ms of inventoryDelays) {
    if (ms <= 0) {
      runHarvesterImagesInventoryReload(cloudId, reload, true, true);
    } else {
      pending.timerIds.push(
        setTimeout(
          () => runHarvesterImagesInventoryReload(cloudId, reload, true, false),
          ms,
        ),
      );
    }
  }
  for (const ms of statusSyncDelays) {
    pending.timerIds.push(
      setTimeout(
        () => runHarvesterImagesInventoryReload(cloudId, reload, false, false),
        ms,
      ),
    );
  }
  if (pending.timerIds.length > 0) {
    pendingImagesInventoryNotifyByCloud.set(cloudId, pending);
  }
}

export function notifyHarvesterBackupsInventoryChanged(
  cloudId: string,
  reload?: HarvesterBackupsInventoryReload,
  options?: NotifyHarvesterBackupsInventoryOptions,
): void {
  if (!cloudId || !reload) return;

  const inventoryDelays = options?.inventoryDelaysMs ?? [0, 2500];
  const statusSyncDelays = options?.statusSyncDelaysMs ?? [6000, 12000, 20000];

  for (const ms of inventoryDelays) {
    if (ms <= 0) {
      runHarvesterBackupsInventoryReload(cloudId, reload, true, true);
    } else {
      window.setTimeout(
        () => runHarvesterBackupsInventoryReload(cloudId, reload, true, false),
        ms,
      );
    }
  }
  for (const ms of statusSyncDelays) {
    window.setTimeout(
      () => runHarvesterBackupsInventoryReload(cloudId, reload, false, false),
      ms,
    );
  }
}
