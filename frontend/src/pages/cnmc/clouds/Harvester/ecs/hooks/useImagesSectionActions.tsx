import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, message } from 'antd';
import {
  cancelHarvesterImageUploadTask,
  deleteHarvesterImage,
  deleteHarvesterImageUploadTask,
  fetchHarvesterImageUploadTask,
  fetchHarvesterImageUploadTasks,
  type HarvesterImageUploadTask,
} from '../../../../../../services/harvesterApi';
import {
  runHarvesterSectionRefresh,
  type HarvesterSectionOnRefresh,
} from '../../shared/lib/harvesterSectionRefresh';
import type { ImageListRecord } from '../lib/imagesSectionUtils';
import { getImageRowId, getImageRowNamespace } from '../lib/imagesSectionUtils';
import { resolveImageListStateKey } from '../lib/vmImageStatus';
import {
  IMAGE_LIST_PROGRESS_REFRESH_STATES,
  assessImageDeleteBlockedByVms,
  filterImageListAfterDelete,
  getImageDeleteInUseErrorMessage,
  isImageDeleteInUseHttpError,
  mapBatchImageDelete,
  mergeUploadTasksSorted,
  selectImagesByRowKeys,
  summarizeBatchImageDeleteMessage,
} from '../lib/imagesSectionActions';

export type UseImagesSectionActionsParams = {
  cloudId: string;
  images: ImageListRecord[];
  vms: ImageListRecord[];
  onRefresh?: HarvesterSectionOnRefresh;
  hasImagesWrite: boolean;
  ensureImagesWrite: () => boolean;
};

export function useImagesSectionActions({
  cloudId,
  images,
  vms,
  onRefresh,
  hasImagesWrite,
  ensureImagesWrite,
}: UseImagesSectionActionsParams) {
  const [localImages, setLocalImages] = useState<ImageListRecord[]>(images);
  const [toolTaskList, setToolTaskList] = useState<HarvesterImageUploadTask[]>([]);
  const [taskDrawerOpen, setTaskDrawerOpen] = useState(false);
  const [taskDrawerLoading, setTaskDrawerLoading] = useState(false);
  const [taskProgressCache, setTaskProgressCache] = useState<Map<string, number>>(new Map());

  const prevProgressRef = useRef<Map<string, number>>(new Map());
  const uploadControllersRef = useRef<Map<string, AbortController>>(new Map());
  const toolTaskListRef = useRef<HarvesterImageUploadTask[]>([]);
  const onRefreshRef = useRef(onRefresh);
  toolTaskListRef.current = toolTaskList;
  onRefreshRef.current = onRefresh;

  useEffect(() => {
    setLocalImages(images);
  }, [images]);

  useEffect(() => {
    if (!onRefresh) return;
    let shouldRefresh = false;
    for (const img of localImages) {
      const stateKey = resolveImageListStateKey(img);
      if (!IMAGE_LIST_PROGRESS_REFRESH_STATES.includes(stateKey as (typeof IMAGE_LIST_PROGRESS_REFRESH_STATES)[number])) {
        continue;
      }
      const status = img?.status as Record<string, unknown> | undefined;
      const progress = Number(status?.progress ?? img?.progress ?? 0);
      const rowName = getImageRowId(img);
      const prevProgress = prevProgressRef.current.get(rowName);
      if (prevProgress !== undefined && prevProgress !== progress) {
        shouldRefresh = true;
      }
      if (progress > 0 && progress < 100 && prevProgress === undefined) {
        prevProgressRef.current.set(rowName, progress);
        shouldRefresh = true;
      }
      if (prevProgress !== undefined) {
        prevProgressRef.current.set(rowName, progress);
      }
    }
    if (!shouldRefresh) return;
    const timer = window.setTimeout(() => {
      onRefresh(true, true);
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [localImages, onRefresh]);

  useEffect(() => {
    if (!cloudId) return;
    let stopped = false;
    const loadTasks = async () => {
      try {
        const resp: { data?: { items?: HarvesterImageUploadTask[] }; items?: HarvesterImageUploadTask[] } =
          await fetchHarvesterImageUploadTasks(cloudId, 20);
        const items = resp?.data?.items || resp?.items || [];
        if (!stopped) setToolTaskList(Array.isArray(items) ? items : []);
      } catch {
        // ignore background load failure
      }
    };
    void loadTasks();
    return () => {
      stopped = true;
    };
  }, [cloudId]);

  useEffect(() => {
    if (!cloudId) return;
    const timer = window.setInterval(async () => {
      const active = toolTaskListRef.current.filter((t) =>
        ['pending', 'ingesting', 'proxying', 'success'].includes(String(t?.status || '')),
      );
      if (active.length === 0) return;
      try {
        const next = await Promise.all(
          active.map(async (t) => {
            try {
              const resp = await fetchHarvesterImageUploadTask(cloudId, t.id);
              const r = resp as { data?: HarvesterImageUploadTask };
              return (r?.data ?? r) as HarvesterImageUploadTask;
            } catch {
              return t;
            }
          }),
        );
        const newlyCompleted = next.filter(
          (x) =>
            x.status === 'success' &&
            !toolTaskListRef.current.some((t) => t.id === x.id && t.status === 'success'),
        );
        const progressChanged = next.some((x) => {
          const oldTask = toolTaskListRef.current.find((t) => t.id === x.id);
          return oldTask && oldTask.progress !== x.progress;
        });

        setToolTaskList((prev) => mergeUploadTasksSorted(prev, next));

        if (progressChanged || newlyCompleted.length > 0) {
          onRefreshRef.current?.(true, true);
        }
      } catch {
        // ignore polling failure
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [cloudId]);

  const getSmoothProgress = useCallback(
    (task: HarvesterImageUploadTask): number => {
      const current = Number(task.progress || 0);
      const cached = taskProgressCache.get(task.id) || 0;
      const smooth = Math.max(current, cached);
      if (smooth > cached) {
        setTaskProgressCache((prev) => {
          const next = new Map(prev);
          next.set(task.id, smooth);
          return next;
        });
      }
      return smooth;
    },
    [taskProgressCache],
  );

  const loadUploadTasks = useCallback(
    async (silent = true) => {
      try {
        if (!silent) setTaskDrawerLoading(true);
        const resp: { data?: { items?: HarvesterImageUploadTask[] }; items?: HarvesterImageUploadTask[] } =
          await fetchHarvesterImageUploadTasks(cloudId, 50);
        const items = resp?.data?.items || resp?.items || [];
        setToolTaskList(Array.isArray(items) ? items : []);
      } catch (e: unknown) {
        if (!silent) message.error((e as { message?: string })?.message || '加载上传任务失败');
      } finally {
        if (!silent) setTaskDrawerLoading(false);
      }
    },
    [cloudId],
  );

  const upsertTask = useCallback((task: HarvesterImageUploadTask) => {
    setToolTaskList((prev) => mergeUploadTasksSorted(prev, task));
  }, []);

  const handleDeleteUploadTask = useCallback(
    async (task: HarvesterImageUploadTask) => {
      try {
        if (!ensureImagesWrite()) return;
        await deleteHarvesterImageUploadTask(cloudId, task.id);
        message.success('任务记录已删除');
        setToolTaskList((prev) => prev.filter((x) => x.id !== task.id));
      } catch (e: unknown) {
        message.error((e as { message?: string })?.message || '删除任务记录失败');
      }
    },
    [cloudId, ensureImagesWrite],
  );

  const handleCancelUploadTask = useCallback(
    async (task: HarvesterImageUploadTask) => {
      try {
        if (!ensureImagesWrite()) return;
        uploadControllersRef.current.get(task.id)?.abort();
        const resp = (await cancelHarvesterImageUploadTask(cloudId, task.id)) as {
          data?: HarvesterImageUploadTask;
        };
        const next = (resp?.data || resp) as HarvesterImageUploadTask;
        if (next?.id) upsertTask(next);
        else {
          const latest = (await fetchHarvesterImageUploadTask(cloudId, task.id)) as {
            data?: HarvesterImageUploadTask;
          };
          upsertTask((latest?.data || latest) as HarvesterImageUploadTask);
        }
        onRefreshRef.current?.(true, true);
        prevProgressRef.current.clear();
        message.success('已取消');
      } catch (e: unknown) {
        message.error((e as { message?: string })?.message || '取消失败');
      }
    },
    [cloudId, ensureImagesWrite, upsertTask],
  );

  const handleDeleteRow = useCallback(
    async (r: ImageListRecord) => {
      const name = getImageRowId(r);
      if (!name) return;
      const ns = getImageRowNamespace(r);
      const blocked = assessImageDeleteBlockedByVms(r, vms);
      if (blocked) {
        message.warning(blocked);
        return;
      }
      try {
        await deleteHarvesterImage(cloudId, ns, name);
        message.success('删除成功');
        setLocalImages((prev) => filterImageListAfterDelete(prev, new Set([`${ns}/${name}`])));
        runHarvesterSectionRefresh(onRefresh, { force: true });
      } catch (e: unknown) {
        if (isImageDeleteInUseHttpError(e)) {
          message.error(getImageDeleteInUseErrorMessage());
        } else {
          message.error((e as { message?: string })?.message || '删除失败');
        }
      }
    },
    [cloudId, onRefresh, vms],
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
            const results = await mapBatchImageDelete(targets, async (r) => {
              const blocked = assessImageDeleteBlockedByVms(r, vms);
              if (blocked) throw new Error(blocked);
              await deleteHarvesterImage(cloudId, getImageRowNamespace(r), getImageRowId(r));
            });
            const { success, error, deletedKeys } = summarizeBatchImageDeleteMessage(results);
            if (success) {
              message.success(success);
              setLocalImages((prev) => filterImageListAfterDelete(prev, deletedKeys));
            }
            if (error) message.error(error);
            onDone?.();
            runHarvesterSectionRefresh(onRefresh, { force: true });
          } catch (e: unknown) {
            message.error((e as { message?: string })?.message || '批量删除失败');
          }
        },
      });
    },
    [cloudId, ensureImagesWrite, onRefresh, vms],
  );

  return {
    localImages,
    toolTaskList,
    taskDrawerOpen,
    setTaskDrawerOpen,
    taskDrawerLoading,
    loadUploadTasks,
    getSmoothProgress,
    upsertTask,
    uploadControllersRef,
    handleDeleteUploadTask,
    handleCancelUploadTask,
    handleDeleteRow,
    batchDelete,
    hasImagesWrite,
  };
}
