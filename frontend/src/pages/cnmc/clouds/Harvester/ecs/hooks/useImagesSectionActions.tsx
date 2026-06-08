import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Modal, message } from 'antd';
import { useAuth } from '../../../../../../contexts/AuthContext';
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
  isTowerUploadVirtualRow,
  formatHarvesterImageDeleteError,
  getImageRowDeleteBlockedMessage,
  isLocalUploadImageRow,
  mapBatchImageDelete,
  mergeUploadTasksIntoImageList,
  mergeUploadTasksSorted,
  mergeUploadTasksForLookup,
  planImageListProgressPoll,
  resolveImageDeleteSuccessMessage,
  resolveLinkedUploadTaskId,
  resolveLinkedUploadTaskIdsForDelete,
  selectImagesByRowKeys,
  shouldDeleteClusterImageForLocalUploadRow,
  summarizeBatchImageDeleteMessage,
  uploadTaskIdsForDeletedImageKeys,
} from '../lib/imagesSectionActions';
import {
  getImageUploadTasksSnapshot,
  patchImageUploadTasksSnapshot,
  registerImageUploadInventoryPollHooks,
  registerImageUploadTasksSubscriber,
  reloadImageUploadTasksFromStore,
  subscribeImageUploadTasks,
  unregisterImageUploadTasksSubscriber,
} from '../lib/imageUploadTasksStore';
import {
  IMAGE_UPLOAD_TASK_FETCH_LIMIT,
  hydrateUploadTasksFromSessionCache,
  registerUploadTaskReloadSideEffects,
  syncUploadTasksSessionCache,
  unregisterUploadTaskReloadSideEffects,
  uploadTaskBatchNeedsInventorySideEffects,
  uploadTaskItemsNeedSuccessInventorySync,
} from '../lib/uploadTaskReload';

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

/** 镜像列表库存轮询：对端全量 sync 限频 120s */
const IMAGE_LIST_FULL_SYNC_MIN_INTERVAL_MS = 120000;
/** cancelled/failed 等触发的 skipSync 库存刷新防抖（毫秒） */
const IMAGE_INVENTORY_SKIP_SYNC_DEBOUNCE_MS = 400;

export function useImagesSectionActions({
  cloudId,
  images,
  vms,
  onRefresh,
  onImagesInventoryReload,
  ensureImagesWrite,
}: UseImagesSectionActionsParams) {
  const { loading: authLoading, token } = useAuth();
  const [localImages, setLocalImages] = useState<ImageListRecord[]>(images);

  const subscribeUploadTasks = useCallback(
    (onChange: () => void) => subscribeImageUploadTasks(cloudId, onChange),
    [cloudId],
  );
  const getUploadTasksSnapshot = useCallback(
    () => getImageUploadTasksSnapshot(cloudId),
    [cloudId],
  );
  const uploadTasksSnapshot = useSyncExternalStore(
    subscribeUploadTasks,
    getUploadTasksSnapshot,
    getUploadTasksSnapshot,
  );
  const uploadTasks = uploadTasksSnapshot.uploadTasks;
  const listTaskList = uploadTasksSnapshot.listTaskList;
  const uploadTasksLoading = uploadTasksSnapshot.uploadTasksLoading;

  const setUploadTasksState = useCallback(
    (patch: {
      uploadTasks?: HarvesterImageUploadTask[];
      listTaskList?: HarvesterImageUploadTask[];
      uploadTasksLoading?: boolean;
    }) => {
      patchImageUploadTasksSnapshot(cloudId, patch);
    },
    [cloudId],
  );

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
  const skipSyncInventoryReloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const imagesSectionMountedRef = useRef(true);

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
    // 底座已就绪后从列表任务集移除 success（抽屉仍保留完整任务记录）
    const prevList = listTaskListRef.current;
    if (Array.isArray(images) && images.length > 0 && prevList.some((t) => String(t.status || '') === 'success')) {
      const next = prevList.filter((t) => {
        if (String(t.status || '') !== 'success') return true;
        const row = images.find((img) => findUploadTaskForImageRow(img, [t]));
        if (!row) return true;
        return resolveImageListStateKey(row) !== 'ready';
      });
      if (next.length !== prevList.length) {
        listTaskListRef.current = next;
        setUploadTasksState({ listTaskList: next });
      }
    }
  }, [images, setUploadTasksState]);

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

  const reloadUploadTasks = useCallback(
    (showLoading = false, batchTerminalReload = false) =>
      reloadImageUploadTasksFromStore(cloudId, showLoading, batchTerminalReload),
    [cloudId],
  );

  useEffect(() => {
    if (!cloudId) return;
    registerUploadTaskReloadSideEffects(cloudId, {
      onAfterApply: (items, { batchTerminalReload, prev }) => {
        listTaskListRef.current = getImageUploadTasksSnapshot(cloudId).listTaskList;
        uploadTasksRef.current = getImageUploadTasksSnapshot(cloudId).uploadTasks;
        if (uploadTaskItemsNeedSuccessInventorySync(items, prev)) {
          scheduleImagesInventoryAfterUploadSync();
        }
        if (uploadTaskBatchNeedsInventorySideEffects(items, { batchTerminalReload }, prev)) {
          requestSkipSyncInventoryReload();
        }
      },
      onError: () => {
        message.warning('刷新上传任务状态失败，请检查网络后重试');
      },
    });
    return () => unregisterUploadTaskReloadSideEffects(cloudId);
  }, [cloudId, requestSkipSyncInventoryReload, scheduleImagesInventoryAfterUploadSync]);

  useEffect(() => {
    localImagesRef.current = localImages;
  }, [localImages]);

  useEffect(() => {
    if (!cloudId || authLoading || !token) return;

    imagesSectionMountedRef.current = true;
    hydrateUploadTasksFromSessionCache(cloudId);
    registerImageUploadTasksSubscriber(cloudId);
    void reloadUploadTasks(false, true);

    const runInventoryPollTick = () => {
      const tasks = listTaskListRef.current;
      const imgs = localImagesRef.current;
      const mergedForPoll = mergeUploadTasksIntoImageList(imgs, tasks);
      const { pollInventory } = planImageListProgressPoll(tasks, mergedForPoll);
      if (!pollInventory) return;

      const now = Date.now();

      const reload = onImagesInventoryReloadRef.current;
      if (!reload || inventoryReloadInFlightRef.current) return;

      const needFullSync =
        lastFullInventorySyncAtRef.current === 0 ||
        now - lastFullInventorySyncAtRef.current >= IMAGE_LIST_FULL_SYNC_MIN_INTERVAL_MS;

      inventoryReloadInFlightRef.current = true;
      void Promise.resolve(reload(true, !needFullSync))
        .catch(() => undefined)
        .finally(() => {
          inventoryReloadInFlightRef.current = false;
        });
      if (needFullSync) {
        lastFullInventorySyncAtRef.current = now;
      }
    };

    registerImageUploadInventoryPollHooks(cloudId, {
      isMounted: () => imagesSectionMountedRef.current,
      runInventoryPollTick,
    });

    return () => {
      imagesSectionMountedRef.current = false;
      unregisterImageUploadTasksSubscriber(cloudId);
      cancelHarvesterImagesInventoryNotify(cloudId);
      if (skipSyncInventoryReloadTimerRef.current != null) {
        clearTimeout(skipSyncInventoryReloadTimerRef.current);
        skipSyncInventoryReloadTimerRef.current = null;
      }
    };
  }, [authLoading, cloudId, reloadUploadTasks, token]);

  const onListTaskChange = useCallback(
    (task: HarvesterImageUploadTask) => {
      let shouldRefreshInventory = false;
      const st = String(task.status || '').toLowerCase();
      const isCancelled = st === 'cancelled';
      const isFailed = st === 'failed';

      const nextUploadTasks = mergeUploadTasksSorted(uploadTasksRef.current, task);
      const { next: nextListTaskList, becameSuccess } = applyUploadTaskToListState(
        listTaskListRef.current,
        task,
      );
      if (becameSuccess) shouldRefreshInventory = true;
      listTaskListRef.current = nextListTaskList;
      uploadTasksRef.current = nextUploadTasks;

      setUploadTasksState({
        uploadTasks: nextUploadTasks,
        listTaskList: nextListTaskList,
      });

      if (isCancelled || isFailed || st === 'success') {
        syncUploadTasksSessionCache(cloudId, nextUploadTasks);
      }

      if (shouldRefreshInventory) {
        scheduleImagesInventoryAfterUploadSync();
      } else if (isCancelled || isFailed) {
        requestSkipSyncInventoryReload();
      }
    },
    [
      cloudId,
      requestSkipSyncInventoryReload,
      scheduleImagesInventoryAfterUploadSync,
      setUploadTasksState,
    ],
  );

  /** 抽屉删除任务记录时从 listTaskList 移除，避免虚拟行残留；success 后刷新库存以保留镜像行 */
  const onListTaskRemove = useCallback(
    (taskId: string, opts?: { refreshInventory?: boolean }) => {
      const nextUploadTasks = uploadTasksRef.current.filter((x) => x.id !== taskId);
      const nextListTaskList = listTaskListRef.current.filter((x) => x.id !== taskId);
      listTaskListRef.current = nextListTaskList;
      uploadTasksRef.current = nextUploadTasks;
      setUploadTasksState({
        uploadTasks: nextUploadTasks,
        listTaskList: nextListTaskList,
      });
      if (opts?.refreshInventory === false) return;
      const reload = onImagesInventoryReloadRef.current;
      if (reload) {
        requestSkipSyncInventoryReload();
        return;
      }
      void runHarvesterSectionRefresh(onRefreshRef.current, { force: true, silent: true });
    },
    [requestSkipSyncInventoryReload, setUploadTasksState],
  );

  const handleSyncUploadTask = useCallback(
    async (r: ImageListRecord): Promise<HarvesterImageUploadTask | undefined> => {
      if (!ensureImagesWrite()) return undefined;
      const cachedTasks = mergeUploadTasksForLookup(
        listTaskListRef.current,
        uploadTasksRef.current,
      );
      let taskId = resolveLinkedUploadTaskId(r, cachedTasks);
      if (!taskId) {
        taskId = await fetchLinkedUploadTaskId(cloudId, r, cachedTasks);
      }
      if (!taskId) {
        message.warning(
          '未找到关联的上传任务，无法重试同步。请在上传任务抽屉确认任务是否存在，或删除底座失败镜像后重新上传。',
        );
        return undefined;
      }
      try {
        const resp = (await syncHarvesterImageUploadTask(cloudId, taskId)) as {
          data?: HarvesterImageUploadTask;
        };
        const next = (resp?.data || resp) as HarvesterImageUploadTask;
        if (next?.id) {
          // 同步重试会删旧 CR 并短暂清空 createdImageName；乐观移除旧库存行，避免与虚拟行双行/待同步残留
          if (!isTowerUploadVirtualRow(r)) {
            const syncRowKey = `${getImageRowNamespace(r)}/${getImageRowId(r)}`;
            if (syncRowKey !== '/') {
              setLocalImages((prev) => filterImageListAfterDelete(prev, new Set([syncRowKey])));
            }
          }
          onListTaskChange(next);
          notifyHarvesterImagesInventoryChanged(
            cloudId,
            onImagesInventoryReloadRef.current,
            HARVESTER_IMAGES_SYNC_START_OPTIONS,
          );
        }
        message.success('已开始同步');
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
      const blockedMsg = getImageRowDeleteBlockedMessage(r, vms);
      if (blockedMsg) {
        message.warning(blockedMsg);
        return;
      }
      if (!ensureImagesWrite()) return;

      const lookupTasks = mergeUploadTasksForLookup(
        listTaskListRef.current,
        uploadTasksRef.current,
      );
      const localUpload = isLocalUploadImageRow(r, lookupTasks);
      const linkedTaskIds = localUpload
        ? await resolveLinkedUploadTaskIdsForDelete(cloudId, r, lookupTasks)
        : [];

      const deleteCluster = !localUpload || shouldDeleteClusterImageForLocalUploadRow(r);
      if (localUpload && linkedTaskIds.length === 0 && !deleteCluster) {
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
      let clusterNotFound = false;
      let taskDeleteFailed = false;
      let deletedTask = false;
      const backendDeletedTaskIds: string[] = [];
      try {
        if (deleteCluster && name) {
          try {
            const resp = (await deleteHarvesterImage(cloudId, ns, name)) as {
              data?: { deletedUploadTaskIds?: string[]; clusterNotFound?: boolean };
            };
            const fromBackend = resp?.data?.deletedUploadTaskIds;
            if (Array.isArray(fromBackend)) {
              backendDeletedTaskIds.push(...fromBackend.filter(Boolean));
            }
            if (resp?.data?.clusterNotFound) clusterNotFound = true;
            setLocalImages((prev) =>
              filterImageListAfterDelete(prev, new Set([`${ns}/${name}`])),
            );
          } catch (e: unknown) {
            const status = (e as { status?: number })?.status;
            if (status === 404) clusterNotFound = true;
            else throw e;
          }
        }

        const taskIdsToRemove = new Set([...linkedTaskIds, ...backendDeletedTaskIds]);
        for (const taskId of taskIdsToRemove) {
          if (backendDeletedTaskIds.includes(taskId)) {
            deletedTask = true;
            onListTaskRemove(taskId);
            continue;
          }
          try {
            await deleteHarvesterImageUploadTask(cloudId, taskId, { force: true });
            deletedTask = true;
            onListTaskRemove(taskId);
          } catch (e: unknown) {
            const status = (e as { status?: number })?.status;
            if (status === 404) {
              deletedTask = true;
              onListTaskRemove(taskId);
              continue;
            }
            taskDeleteFailed = true;
            if (!clusterNotFound && !(deleteCluster && name)) throw e;
          }
        }

        message.success(
          resolveImageDeleteSuccessMessage({
            localUpload,
            deleteCluster,
            deletedTask: Boolean(localUpload && deletedTask),
            clusterNotFound,
            taskDeleteFailed,
          }),
        );
        if (deleteCluster) {
          void runHarvesterSectionRefresh(onRefresh, { force: true });
        }
      } catch (e: unknown) {
        message.error(formatHarvesterImageDeleteError(e, { vms }));
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
            const lookupTasks = mergeUploadTasksForLookup(
              listTaskListRef.current,
              uploadTasksRef.current,
            );
            const needsTaskFetch = targets.some(
              (r) => isLocalUploadImageRow(r, lookupTasks),
            );
            let allUploadTasks = lookupTasks;
            if (needsTaskFetch) {
              try {
                const resp = (await fetchHarvesterImageUploadTasks(
                  cloudId,
                  IMAGE_UPLOAD_TASK_FETCH_LIMIT,
                )) as {
                  data?: { items?: HarvesterImageUploadTask[] };
                  items?: HarvesterImageUploadTask[];
                };
                const items = resp?.data?.items || resp?.items || [];
                allUploadTasks = mergeUploadTasksForLookup(
                  lookupTasks,
                  Array.isArray(items) ? items : [],
                );
              } catch {
                allUploadTasks = lookupTasks;
              }
            }
            const removedTaskIds = new Set<string>();
            let taskDeleteFailedCount = 0;
            let clusterNotFoundCount = 0;
            const results = await mapBatchImageDelete(
              targets,
              async (r) => {
                const rowBlocked = getImageRowDeleteBlockedMessage(r, vms);
                if (rowBlocked) throw new Error(rowBlocked);
                const localUpload = isLocalUploadImageRow(r, allUploadTasks);
                const linkedTaskIds = localUpload
                  ? await resolveLinkedUploadTaskIdsForDelete(cloudId, r, allUploadTasks)
                  : [];
                const deleteCluster = !localUpload || shouldDeleteClusterImageForLocalUploadRow(r);
                if (localUpload && linkedTaskIds.length === 0 && !deleteCluster) {
                  throw new Error('未关联上传任务，无法删除本地暂存');
                }
                if (deleteCluster) {
                  const blocked = assessImageDeleteBlockedByVms(r, vms);
                  if (blocked) throw new Error(blocked);
                  const ns = getImageRowNamespace(r);
                  const name = getImageRowId(r);
                  if (name) {
                    try {
                      const resp = (await deleteHarvesterImage(cloudId, ns, name)) as {
                        data?: { deletedUploadTaskIds?: string[]; clusterNotFound?: boolean };
                      };
                      const fromBackend = resp?.data?.deletedUploadTaskIds;
                      if (Array.isArray(fromBackend)) {
                        for (const id of fromBackend) {
                          if (id) removedTaskIds.add(id);
                        }
                      }
                      if (resp?.data?.clusterNotFound) clusterNotFoundCount += 1;
                    } catch (e: unknown) {
                      if ((e as { status?: number })?.status === 404) {
                        clusterNotFoundCount += 1;
                      } else {
                        throw e;
                      }
                    }
                  }
                }
                for (const taskId of linkedTaskIds) {
                  if (removedTaskIds.has(taskId)) continue;
                  try {
                    await deleteHarvesterImageUploadTask(cloudId, taskId, { force: true });
                    removedTaskIds.add(taskId);
                  } catch (e: unknown) {
                    if ((e as { status?: number })?.status === 404) {
                      removedTaskIds.add(taskId);
                      continue;
                    }
                    taskDeleteFailedCount += 1;
                  }
                }
              },
              { vms },
            );
            const { success, warning, error, deletedKeys } = summarizeBatchImageDeleteMessage(
              results,
              { taskDeleteFailedCount, clusterNotFoundCount },
            );
            if (success) {
              message.success(success);
              setLocalImages((prev) => filterImageListAfterDelete(prev, deletedKeys));
              for (const taskId of removedTaskIds) {
                onListTaskRemove(taskId);
              }
              for (const taskId of uploadTaskIdsForDeletedImageKeys(
                mergeUploadTasksForLookup(listTaskListRef.current, uploadTasksRef.current),
                deletedKeys,
              )) {
                onListTaskRemove(taskId);
              }
            }
            if (warning) message.warning(warning);
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
