import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, message } from 'antd';
import {
  deleteHarvesterImage,
  deleteHarvesterImageUploadTask,
  fetchHarvesterImageUploadTasks,
  syncHarvesterImageUploadTask,
  type HarvesterImageUploadTask,
} from '../../../../../../services/harvesterApi';
import {
  HARVESTER_IMAGES_AFTER_UPLOAD_SYNC_OPTIONS,
  HARVESTER_IMAGES_SYNC_START_OPTIONS,
  cancelHarvesterImagesInventoryNotify,
  notifyHarvesterImagesInventoryChanged,
  runHarvesterSectionRefresh,
  type HarvesterSectionOnRefresh,
} from '../../shared/lib/harvesterSectionRefresh';
import { getImageRowId, getImageRowNamespace, type ImageListRecord } from '../lib/imagesSectionUtils';
import { resolveImageListStateKey } from '../lib/vmImageStatus';
import {
  applyUploadTaskToListState,
  assessImageDeleteBlockedByVms,
  fetchLinkedUploadTaskId,
  filterImageListAfterDelete,
  findUploadTaskForImageRow,
  formatHarvesterImageDeleteError,
  getImageRowDeleteBlockedMessage,
  getTowerUploadTaskIdFromRow,
  isLocalUploadImageRow,
  mapBatchImageDelete,
  mergeUploadTasksIntoImageList,
  mergeUploadTasksSorted,
  planImageListProgressPoll,
  resolveImageDeleteSuccessMessage,
  resolveLinkedUploadTaskId,
  selectImagesByRowKeys,
  shouldDeleteClusterImageForLocalUploadRow,
  summarizeBatchImageDeleteMessage,
  taskAffectsImageList,
  uploadTaskIdsForDeletedImageKeys,
} from '../lib/imagesSectionActions';

export type UseImagesSectionActionsParams = {
  cloudId: string;
  images: ImageListRecord[];
  vms: ImageListRecord[];
  onRefresh?: HarvesterSectionOnRefresh;
  /** 镜像库存刷新（skipSync 控制是否对端 sync），用于 URL 导入进度与上传 success 后拉库存 */
  onImagesInventoryReload?: (
    force?: boolean,
    skipSync?: boolean,
  ) => void | Promise<void>;
  hasImagesWrite: boolean;
  ensureImagesWrite: () => boolean;
};

/** 镜像列表轮询：活跃同步 5s；等任务终态 10s；对端全量 sync 限频 120s */
const IMAGE_LIST_TASK_POLL_MS = 5000;
const IMAGE_LIST_TASK_TERMINAL_POLL_MS = 10000;
const IMAGE_LIST_FULL_SYNC_MIN_INTERVAL_MS = 120000;
/** cancelled/failed 等触发的 skipSync 库存刷新防抖（毫秒） */
const IMAGE_INVENTORY_SKIP_SYNC_DEBOUNCE_MS = 400;

export function useImagesSectionActions({
  cloudId,
  images,
  vms,
  onRefresh,
  onImagesInventoryReload,
  hasImagesWrite,
  ensureImagesWrite,
}: UseImagesSectionActionsParams) {
  const [localImages, setLocalImages] = useState<ImageListRecord[]>(images);
  /** 全量上传任务（抽屉与轮询共用，避免重复 fetch upload-tasks） */
  const [uploadTasks, setUploadTasks] = useState<HarvesterImageUploadTask[]>([]);
  /** 仅 uploaded/proxying/failed 等需合并进镜像列表的任务，避免 ingest 进度刷新拖慢主表 */
  const [listTaskList, setListTaskList] = useState<HarvesterImageUploadTask[]>([]);
  const [uploadTasksLoading, setUploadTasksLoading] = useState(false);

  const listTaskListRef = useRef(listTaskList);
  listTaskListRef.current = listTaskList;
  const uploadTasksRef = useRef(uploadTasks);
  uploadTasksRef.current = uploadTasks;
  const localImagesRef = useRef(localImages);
  localImagesRef.current = localImages;
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;
  const onImagesInventoryReloadRef = useRef(onImagesInventoryReload);
  onImagesInventoryReloadRef.current = onImagesInventoryReload;
  const lastFullInventorySyncAtRef = useRef(0);
  const inventoryReloadInFlightRef = useRef(false);
  const lastUploadTaskPollAtRef = useRef(0);
  const skipSyncInventoryReloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const uploadTasksInflightRef = useRef(false);

  const requestSkipSyncInventoryReload = useCallback(() => {
    const reload = onImagesInventoryReloadRef.current;
    if (!reload) return;
    if (skipSyncInventoryReloadTimerRef.current != null) {
      clearTimeout(skipSyncInventoryReloadTimerRef.current);
    }
    skipSyncInventoryReloadTimerRef.current = setTimeout(() => {
      skipSyncInventoryReloadTimerRef.current = null;
      void Promise.resolve(reload(true, true)).catch(() => undefined);
    }, IMAGE_INVENTORY_SKIP_SYNC_DEBOUNCE_MS);
  }, []);

  useEffect(() => {
    setLocalImages((prev) => {
      if (!Array.isArray(images)) return prev;
      // 库存刷新中父组件可能短暂下发空数组，避免列表只剩 upload 虚拟行
      if (images.length === 0 && prev.length > 0) return prev;
      return images;
    });
    // 库存行已就绪后移除 success 任务 overlay，避免长期占用虚拟行
    setListTaskList((prev) => {
      if (!Array.isArray(images) || images.length === 0) return prev;
      if (!prev.some((t) => String(t.status || '') === 'success')) return prev;
      const next = prev.filter((t) => {
        if (String(t.status || '') !== 'success') return true;
        const row = images.find((img) => findUploadTaskForImageRow(img, [t]));
        if (!row) return true;
        return resolveImageListStateKey(row) !== 'ready';
      });
      return next.length === prev.length ? prev : next;
    });
  }, [images]);

  const scheduleImagesInventoryAfterUploadSync = useCallback(() => {
    const reload = onImagesInventoryReloadRef.current;
    if (reload) {
      notifyHarvesterImagesInventoryChanged(
        cloudId,
        reload,
        HARVESTER_IMAGES_AFTER_UPLOAD_SYNC_OPTIONS,
      );
      return;
    }
    void runHarvesterSectionRefresh(onRefreshRef.current, { force: true, silent: true });
  }, [cloudId]);

  const applyUploadTasksSnapshot = useCallback(
    (items: HarvesterImageUploadTask[], opts?: { batchTerminalReload?: boolean }) => {
      let shouldScheduleSuccessSync = false;
      let needsTerminalInventoryReload = false;

      setUploadTasks(mergeUploadTasksSorted([], items));

      setListTaskList((prev) => {
        let next = prev;
        for (const task of items) {
          const { next: merged, becameSuccess } = applyUploadTaskToListState(next, task);
          if (becameSuccess) shouldScheduleSuccessSync = true;
          next = merged;
        }
        return next;
      });

      if (opts?.batchTerminalReload) {
        needsTerminalInventoryReload = items.some((task) => {
          const st = String(task.status || '').toLowerCase();
          return (st === 'cancelled' || st === 'failed') && taskAffectsImageList(task);
        });
      }

      if (shouldScheduleSuccessSync) scheduleImagesInventoryAfterUploadSync();
      if (needsTerminalInventoryReload) requestSkipSyncInventoryReload();
    },
    [requestSkipSyncInventoryReload, scheduleImagesInventoryAfterUploadSync],
  );

  const reloadUploadTasks = useCallback(
    async (showLoading = false, batchTerminalReload = false) => {
      if (!cloudId || uploadTasksInflightRef.current) return;
      uploadTasksInflightRef.current = true;
      try {
        if (showLoading) setUploadTasksLoading(true);
        const resp = (await fetchHarvesterImageUploadTasks(cloudId, 50)) as {
          data?: { items?: HarvesterImageUploadTask[] };
          items?: HarvesterImageUploadTask[];
        };
        const items = resp?.data?.items || resp?.items || [];
        applyUploadTasksSnapshot(Array.isArray(items) ? items : [], { batchTerminalReload });
      } catch {
        /* ignore */
      } finally {
        uploadTasksInflightRef.current = false;
        if (showLoading) setUploadTasksLoading(false);
      }
    },
    [applyUploadTasksSnapshot, cloudId],
  );

  useEffect(() => {
    if (!cloudId) return;

    void reloadUploadTasks(false, true);

    const timer = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;

      const tasks = listTaskListRef.current;
      const imgs = localImagesRef.current;
      const mergedForPoll = mergeUploadTasksIntoImageList(imgs, tasks);
      const { pollUploadTasks, pollInventory } = planImageListProgressPoll(tasks, mergedForPoll);
      if (!pollUploadTasks) return;

      const now = Date.now();
      const taskPollInterval = pollInventory
        ? IMAGE_LIST_TASK_POLL_MS
        : IMAGE_LIST_TASK_TERMINAL_POLL_MS;
      if (now - lastUploadTaskPollAtRef.current >= taskPollInterval) {
        lastUploadTaskPollAtRef.current = now;
        void reloadUploadTasks(false);
      }

      if (!pollInventory) return;

      const reload = onImagesInventoryReloadRef.current;
      if (!reload || inventoryReloadInFlightRef.current) return;

      const hasActiveTowerUpload = tasks.some((t) => {
        const st = String(t.status || '').toLowerCase();
        return ['pending', 'ingesting', 'uploaded', 'proxying'].includes(st);
      });

      const needFullSync =
        !hasActiveTowerUpload &&
        (lastFullInventorySyncAtRef.current === 0 ||
          now - lastFullInventorySyncAtRef.current >= IMAGE_LIST_FULL_SYNC_MIN_INTERVAL_MS);

      inventoryReloadInFlightRef.current = true;
      void Promise.resolve(reload(true, hasActiveTowerUpload || !needFullSync))
        .catch(() => undefined)
        .finally(() => {
          inventoryReloadInFlightRef.current = false;
        });
      if (needFullSync) {
        lastFullInventorySyncAtRef.current = now;
      }
    }, IMAGE_LIST_TASK_POLL_MS);

    return () => {
      window.clearInterval(timer);
      cancelHarvesterImagesInventoryNotify(cloudId);
      if (skipSyncInventoryReloadTimerRef.current != null) {
        clearTimeout(skipSyncInventoryReloadTimerRef.current);
        skipSyncInventoryReloadTimerRef.current = null;
      }
    };
  }, [cloudId, reloadUploadTasks]);

  const onListTaskChange = useCallback(
    (task: HarvesterImageUploadTask) => {
      let shouldRefreshInventory = false;
      const st = String(task.status || '').toLowerCase();
      const isCancelled = st === 'cancelled';
      const isFailed = st === 'failed';

      setUploadTasks((prev) => mergeUploadTasksSorted(prev, task));
      setListTaskList((prev) => {
        const { next, becameSuccess } = applyUploadTaskToListState(prev, task);
        if (becameSuccess) shouldRefreshInventory = true;
        return next;
      });

      if (shouldRefreshInventory) {
        scheduleImagesInventoryAfterUploadSync();
      } else if (isCancelled || isFailed) {
        requestSkipSyncInventoryReload();
      }
    },
    [requestSkipSyncInventoryReload, scheduleImagesInventoryAfterUploadSync],
  );

  /** 抽屉删除任务记录时从 listTaskList 移除，避免虚拟行残留；success 后刷新库存以保留镜像行 */
  const onListTaskRemove = useCallback(
    (taskId: string, opts?: { refreshInventory?: boolean }) => {
      setUploadTasks((prev) => prev.filter((x) => x.id !== taskId));
      setListTaskList((prev) => prev.filter((x) => x.id !== taskId));
      if (opts?.refreshInventory === false) return;
      const reload = onImagesInventoryReloadRef.current;
      if (reload) {
        requestSkipSyncInventoryReload();
        return;
      }
      void runHarvesterSectionRefresh(onRefreshRef.current, { force: true, silent: true });
    },
    [requestSkipSyncInventoryReload],
  );

  const handleSyncUploadTask = useCallback(
    async (r: ImageListRecord): Promise<HarvesterImageUploadTask | undefined> => {
      const taskId = getTowerUploadTaskIdFromRow(r);
      if (!taskId) return undefined;
      if (!ensureImagesWrite()) return undefined;
      try {
        const resp = (await syncHarvesterImageUploadTask(cloudId, taskId)) as {
          data?: HarvesterImageUploadTask;
        };
        const next = (resp?.data || resp) as HarvesterImageUploadTask;
        if (next?.id) {
          onListTaskChange(next);
          notifyHarvesterImagesInventoryChanged(
            cloudId,
            onImagesInventoryReloadRef.current,
            HARVESTER_IMAGES_SYNC_START_OPTIONS,
          );
        }
        message.success('已开始同步至 Harvester');
        return next?.id ? next : undefined;
      } catch (e: unknown) {
        message.error((e as { message?: string })?.message || '启动同步失败');
        return undefined;
      }
    },
    [cloudId, ensureImagesWrite, onListTaskChange],
  );

  const handleDeleteRow = useCallback(
    async (r: ImageListRecord) => {
      const blockedMsg = getImageRowDeleteBlockedMessage(r);
      if (blockedMsg) {
        message.warning(blockedMsg);
        return;
      }
      if (!ensureImagesWrite()) return;

      const cachedTasks = listTaskListRef.current;
      const localUpload = isLocalUploadImageRow(r, cachedTasks);
      let taskId = resolveLinkedUploadTaskId(r, cachedTasks);
      if (localUpload && !taskId) {
        taskId = await fetchLinkedUploadTaskId(cloudId, r, cachedTasks);
      }

      const deleteCluster = !localUpload || shouldDeleteClusterImageForLocalUploadRow(r);
      if (localUpload && !taskId && !deleteCluster) {
        message.warning('未关联上传任务，无法删除本地暂存；请在上传任务抽屉中操作');
        return;
      }
      if (deleteCluster) {
        const blocked = assessImageDeleteBlockedByVms(r, vms);
        if (blocked) {
          message.warning(blocked);
          return;
        }
      }

      const ns = getImageRowNamespace(r);
      const name = getImageRowId(r);
      try {
        if (deleteCluster && name) {
          try {
            await deleteHarvesterImage(cloudId, ns, name);
            setLocalImages((prev) =>
              filterImageListAfterDelete(prev, new Set([`${ns}/${name}`])),
            );
          } catch (e: unknown) {
            const status = (e as { status?: number })?.status;
            if (status !== 404) throw e;
          }
        }
        if (localUpload && taskId) {
          await deleteHarvesterImageUploadTask(cloudId, taskId);
          onListTaskRemove(taskId);
        }
        message.success(
          resolveImageDeleteSuccessMessage({
            localUpload,
            deleteCluster,
            deletedTask: Boolean(localUpload && taskId),
          }),
        );
        if (deleteCluster) {
          void runHarvesterSectionRefresh(onRefresh, { force: true });
        }
      } catch (e: unknown) {
        message.error(
          localUpload
            ? (e as { message?: string })?.message || '删除失败'
            : formatHarvesterImageDeleteError(e, { vms }),
        );
      }
    },
    [cloudId, ensureImagesWrite, onListTaskRemove, onRefresh, vms],
  );

  const batchDelete = useCallback(
    (selectedKeys: React.Key[], sourceImages: ImageListRecord[], onDone?: () => void) => {
      if (!ensureImagesWrite()) return;
      if (!Array.isArray(sourceImages) || selectedKeys.length === 0) return;
      Modal.confirm({
        title: '确认批量删除所选镜像？',
        onOk: async () => {
          try {
            const targets = selectImagesByRowKeys(sourceImages, selectedKeys as Array<string | number>);
            if (targets.length === 0) {
              message.warning('未找到可删除的镜像');
              return;
            }
            const cachedTasks = listTaskListRef.current;
            const needsTaskFetch = targets.some(
              (r) =>
                isLocalUploadImageRow(r, cachedTasks) &&
                !resolveLinkedUploadTaskId(r, cachedTasks),
            );
            let allUploadTasks = uploadTasksRef.current;
            if (needsTaskFetch) {
              try {
                const resp = (await fetchHarvesterImageUploadTasks(cloudId, 50)) as {
                  data?: { items?: HarvesterImageUploadTask[] };
                  items?: HarvesterImageUploadTask[];
                };
                const items = resp?.data?.items || resp?.items || [];
                allUploadTasks = Array.isArray(items) ? items : allUploadTasks;
              } catch {
                allUploadTasks = uploadTasksRef.current;
              }
            }
            const removedTaskIds = new Set<string>();
            const results = await mapBatchImageDelete(
              targets,
              async (r) => {
                const rowBlocked = getImageRowDeleteBlockedMessage(r);
                if (rowBlocked) throw new Error(rowBlocked);
                const localUpload = isLocalUploadImageRow(r, allUploadTasks);
                let taskId = resolveLinkedUploadTaskId(r, allUploadTasks);
                if (localUpload && !taskId) {
                  taskId = await fetchLinkedUploadTaskId(cloudId, r, allUploadTasks);
                }
                const deleteCluster = !localUpload || shouldDeleteClusterImageForLocalUploadRow(r);
                if (localUpload && !taskId && !deleteCluster) {
                  throw new Error('未关联上传任务，无法删除本地暂存');
                }
                if (deleteCluster) {
                  const blocked = assessImageDeleteBlockedByVms(r, vms);
                  if (blocked) throw new Error(blocked);
                  const ns = getImageRowNamespace(r);
                  const name = getImageRowId(r);
                  if (name) {
                    try {
                      await deleteHarvesterImage(cloudId, ns, name);
                    } catch (e: unknown) {
                      if ((e as { status?: number })?.status !== 404) throw e;
                    }
                  }
                }
                if (localUpload && taskId) {
                  await deleteHarvesterImageUploadTask(cloudId, taskId);
                  removedTaskIds.add(taskId);
                }
              },
              { vms },
            );
            const { success, error, deletedKeys } = summarizeBatchImageDeleteMessage(results);
            if (success) {
              message.success(success);
              setLocalImages((prev) => filterImageListAfterDelete(prev, deletedKeys));
              for (const taskId of removedTaskIds) {
                onListTaskRemove(taskId);
              }
              for (const taskId of uploadTaskIdsForDeletedImageKeys(
                listTaskListRef.current,
                deletedKeys,
              )) {
                onListTaskRemove(taskId);
              }
            }
            if (error) message.error(error);
            onDone?.();
            void runHarvesterSectionRefresh(onRefresh, { force: true });
          } catch (e: unknown) {
            message.error((e as { message?: string })?.message || '批量删除失败');
          }
        },
      });
    },
    [cloudId, ensureImagesWrite, onListTaskRemove, onRefresh, vms],
  );

  return {
    localImages,
    listTaskList,
    uploadTasks,
    uploadTasksLoading,
    reloadUploadTasks,
    onListTaskChange,
    onListTaskRemove,
    handleSyncUploadTask,
    handleDeleteRow,
    batchDelete,
  };
}
