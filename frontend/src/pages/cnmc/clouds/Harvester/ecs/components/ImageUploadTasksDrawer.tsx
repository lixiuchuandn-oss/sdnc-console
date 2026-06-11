import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  startTransition,
} from 'react';
import { Button, Drawer, Modal, Progress, Tag, Typography, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import {
  cancelHarvesterImageDownloadTask,
  cancelHarvesterImageUploadTask,
  checkHarvesterImageUploadDiskSpace,
  deleteHarvesterImageDownloadTask,
  deleteHarvesterImageUploadTask,
  fetchHarvesterImageDownloadTask,
  fetchHarvesterImageUploadTask,
  type HarvesterImageDownloadTask,
  type HarvesterImageUploadTask,
} from '../../../../../../services/harvesterApi';
import { getApiErrorMessage } from '../../../../../../services/api';
import {
  assertResumeUploadFileMatchesTask,
  getChunkUploadErrorMessage,
  isChunkUploadAbortError,
  isUploadTaskActivelyUploading,
  LOCAL_SOURCE_FILE_RESUME_HINT,
  runChunkedImageUploadFlow,
  pickImageUploadChunkSize,
  stripTowerUploadLocalOverlay,
} from '../lib/chunkedImageUpload';
import {
  formatImageLocalDownloadProgressText,
  saveImageDownloadTaskFileToLocalWithCleanup,
  type ImageLocalDownloadProgress,
} from '../lib/images/imageDownload';
import { mergeDownloadTasksSorted } from '../lib/images/imageDownloadTaskCore';
import { imageDownloadTaskStatusLabel, imageUploadTaskStatusLabel } from '../lib/imagesSectionConstants';
import {
  formatImageUploadTaskChunkLine,
  formatUploadTaskProgressLabel,
  getTowerUploadTaskProgress,
  getUploadDrawerDisplayStatus,
  getUploadTaskDeleteBlockedMessage,
  isUploadTaskDeleteBlocked,
  mergeUploadTasksSorted,
  shouldRefreshInventoryAfterUploadTaskDelete,
  taskAffectsImageList,
  uploadTaskDeleteConfirmContent,
} from '../lib/imagesSectionActions';
import { isUploadTaskNotFoundApiError } from '../lib/images/imageUploadTaskCore';
import { removeUploadTaskFromStore } from '../lib/imageUploadTasksStore';
import type { StartBrowserChunkedUploadParams } from '../modals/ImageCreateModal';
import {
  abortChunkUploadController,
  clearChunkUploadController,
  getChunkUploadControllersMap,
  registerChunkUploadController,
} from '../lib/imageUploadChunkControllers';

export type ImageUploadTasksDrawerHandle = {
  openDrawer: (reload?: boolean) => void;
  startUpload: (params: StartBrowserChunkedUploadParams) => void;
  resumeUpload: (task: HarvesterImageUploadTask, file: File) => void;
  upsertTask: (task: HarvesterImageUploadTask) => void;
  removeTask: (taskId: string) => void;
  upsertDownloadTask: (task: HarvesterImageDownloadTask) => void;
  removeDownloadTask: (taskId: string) => void;
};

type Props = {
  cloudId: string;
  hasImagesWrite: boolean;
  ensureImagesWrite: () => boolean;
  uploadTasks: HarvesterImageUploadTask[];
  downloadTasks?: HarvesterImageDownloadTask[];
  uploadTasksLoading?: boolean;
  reloadUploadTasks: (showLoading?: boolean) => void | Promise<void>;
  onListTaskChange: (task: HarvesterImageUploadTask) => void;
  onDownloadTaskChange?: (task: HarvesterImageDownloadTask) => void;
  onDownloadTaskRemove?: (taskId: string) => void;
  /** 删除抽屉内任务记录时同步清理镜像列表侧的 listTaskList */
  onListTaskRemove?: (taskId: string, opts?: { refreshInventory?: boolean }) => void;
  resumeTaskRef: React.MutableRefObject<HarvesterImageUploadTask | null>;
  onPickResumeFile: () => void;
};

function hasIncompleteChunkUpload(task: HarvesterImageUploadTask): boolean {
  const totalChunks = Number(task.totalChunks || 0);
  if (totalChunks <= 0) return false;
  const receivedCount = Array.isArray(task.receivedChunks) ? task.receivedChunks.length : 0;
  return receivedCount < totalChunks;
}

function isIngestUploadPaused(
  task: HarvesterImageUploadTask,
  isRunning: boolean,
): boolean {
  const st = String(task.status || '').toLowerCase();
  if (isRunning) return false;
  if (['cancelled', 'uploaded', 'success', 'proxying'].includes(st)) return false;
  if (Number(task.ingestProgress ?? 0) >= 100 && !hasIncompleteChunkUpload(task)) return false;
  if (['pending', 'ingesting'].includes(st)) return true;
  return (
    st === 'failed' &&
    Number(task.totalChunks || 0) > 0 &&
    Number(task.ingestProgress ?? 0) < 100
  );
}

export const ImageUploadTasksDrawer = forwardRef<ImageUploadTasksDrawerHandle, Props>(
  function ImageUploadTasksDrawer(
    {
      cloudId,
      hasImagesWrite,
      ensureImagesWrite,
      uploadTasks,
      downloadTasks = [],
      uploadTasksLoading = false,
      reloadUploadTasks,
      onListTaskChange,
      onDownloadTaskChange,
      onDownloadTaskRemove,
      onListTaskRemove,
      resumeTaskRef,
      onPickResumeFile,
    },
    ref,
  ) {
    const [open, setOpen] = useState(false);
    const [tasks, setTasks] = useState<HarvesterImageUploadTask[]>(uploadTasks);
    const [downloadTaskList, setDownloadTaskList] =
      useState<HarvesterImageDownloadTask[]>(downloadTasks);
    const [localDownloadLoadingId, setLocalDownloadLoadingId] = useState<string | null>(null);
    const [localDownloadProgress, setLocalDownloadProgress] = useState<{
      taskId: string;
      progress: ImageLocalDownloadProgress;
    } | null>(null);
    /** 本地源文件不可读（NotReadableError）后需续传的任务 */
    const [resumeHintTaskIds, setResumeHintTaskIds] = useState<Set<string>>(() => new Set());

    const tasksRef = useRef(tasks);
    tasksRef.current = tasks;

    const markResumeHint = useCallback((taskId: string) => {
      setResumeHintTaskIds((prev) => {
        if (prev.has(taskId)) return prev;
        const next = new Set(prev);
        next.add(taskId);
        return next;
      });
    }, []);

    const clearResumeHint = useCallback((taskId: string) => {
      setResumeHintTaskIds((prev) => {
        if (!prev.has(taskId)) return prev;
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
    }, []);

    const forceStopLocalUpload = useCallback((taskId: string) => {
      abortChunkUploadController(taskId);
    }, []);

    const stripTaskLocalUploadOverlay = useCallback((taskId: string) => {
      startTransition(() => {
        setTasks((prev) =>
          prev.map((t) =>
            t.id === taskId ? stripTowerUploadLocalOverlay(t) : t,
          ),
        );
      });
    }, []);

    const upsertDrawerTask = useCallback(
      (task: HarvesterImageUploadTask, opts?: { forceList?: boolean }) => {
        startTransition(() => {
          setTasks((prev) => mergeUploadTasksSorted(prev, task));
        });
        if (opts?.forceList || taskAffectsImageList(task)) {
          onListTaskChange(task);
        }
      },
      [onListTaskChange],
    );

    const loadTasks = useCallback(
      async (showLoading = false) => {
        try {
          await reloadUploadTasks(showLoading);
        } catch (e: unknown) {
          if (showLoading) {
            message.error((e as { message?: string })?.message || '加载上传任务失败');
          }
        }
      },
      [reloadUploadTasks],
    );

    useEffect(() => {
      setDownloadTaskList(mergeDownloadTasksSorted([], downloadTasks));
    }, [downloadTasks]);

    useEffect(() => {
      setTasks(mergeUploadTasksSorted([], uploadTasks));
      for (const task of uploadTasks) {
        const st = String(task.status || '').toLowerCase();
        if (['uploaded', 'success', 'proxying', 'cancelled'].includes(st)) {
          clearResumeHint(task.id);
        }
      }
    }, [uploadTasks, clearResumeHint]);

    useEffect(() => {
      if (!open) return;
      void loadTasks(uploadTasks.length === 0);
    }, [open, loadTasks, uploadTasks.length]);

    const runBrowserChunkedUpload = useCallback(
      (params: StartBrowserChunkedUploadParams & { existingTask?: HarvesterImageUploadTask }) => {
        const controller = new AbortController();
        void (async () => {
          let taskId = params.existingTask?.id;
          if (taskId) {
            registerChunkUploadController(taskId, controller);
            clearResumeHint(taskId);
          }
          try {
            const finalTask = await runChunkedImageUploadFlow({
              cloudId,
              file: params.file,
              namespace: params.namespace,
              displayName: params.displayName,
              imageType: params.imageType,
              existingTask: params.existingTask,
              signal: controller.signal,
              onTaskUpsert: (task) => {
                taskId = task.id;
                registerChunkUploadController(task.id, controller);
                upsertDrawerTask(task);
              },
            });
            upsertDrawerTask(finalTask, { forceList: true });
            clearResumeHint(finalTask.id);
            if (finalTask.status === 'uploaded') {
              message.success('文件上传完成，请在镜像列表点击「同步」');
            }
          } catch (e: unknown) {
            if (isChunkUploadAbortError(e)) return;
            controller.abort();
            const hint = getChunkUploadErrorMessage(e, '分片上传失败');
            if (taskId) {
              forceStopLocalUpload(taskId);
              stripTaskLocalUploadOverlay(taskId);
              markResumeHint(taskId);
              setOpen(true);
            }
            message.error(hint);
            if (taskId) {
              try {
                const latest = (await fetchHarvesterImageUploadTask(cloudId, taskId)) as {
                  data?: HarvesterImageUploadTask;
                };
                upsertDrawerTask(
                  stripTowerUploadLocalOverlay(
                    (latest?.data || latest) as HarvesterImageUploadTask,
                  ),
                );
              } catch {
                /* ignore */
              }
            }
          } finally {
            if (taskId) clearChunkUploadController(taskId);
          }
        })();
      },
      [
        cloudId,
        upsertDrawerTask,
        markResumeHint,
        clearResumeHint,
        forceStopLocalUpload,
        stripTaskLocalUploadOverlay,
      ],
    );

    const resumeBrowserChunkedUpload = useCallback(
      (task: HarvesterImageUploadTask, file: File) => {
        if (String(task.status || '') === 'cancelled') {
          message.error('任务已取消，无法续传');
          return;
        }
        if (!ensureImagesWrite()) return;
        // 中断后可能残留 AbortController，续传前先强制清理，避免误报「正在上传中」
        forceStopLocalUpload(task.id);
        stripTaskLocalUploadOverlay(task.id);
        setOpen(true);
        void (async () => {
          try {
            assertResumeUploadFileMatchesTask(task, file);
          } catch (e: unknown) {
            markResumeHint(task.id);
            setOpen(true);
            message.error(getChunkUploadErrorMessage(e, '无法续传'));
            return;
          }
          const fileSize = Math.max(0, Number(task.fileSize) || file.size);
          const chunkSize =
            Math.max(0, Number(task.chunkSize) || 0) ||
            pickImageUploadChunkSize(fileSize);
          try {
            await checkHarvesterImageUploadDiskSpace(cloudId, fileSize, chunkSize);
          } catch (e: unknown) {
            markResumeHint(task.id);
            message.error(getChunkUploadErrorMessage(e, 'Tower 镜像暂存目录空间不足'));
            return;
          }
          let latestTask = task;
          try {
            const resp = await fetchHarvesterImageUploadTask(cloudId, task.id);
            const r = resp as { data?: HarvesterImageUploadTask };
            latestTask = (r?.data ?? r) as HarvesterImageUploadTask;
          } catch {
            /* 使用本地任务快照 */
          }
          if (String(latestTask.status || '') === 'cancelled') {
            message.error('任务已取消，无法续传');
            return;
          }
          clearResumeHint(task.id);
          runBrowserChunkedUpload({
            file,
            namespace: latestTask.namespace || task.namespace,
            displayName: latestTask.displayName || task.displayName,
            imageType: latestTask.imageType || task.imageType,
            existingTask: latestTask,
          });
        })();
      },
      [
        cloudId,
        ensureImagesWrite,
        runBrowserChunkedUpload,
        markResumeHint,
        clearResumeHint,
        forceStopLocalUpload,
        stripTaskLocalUploadOverlay,
      ],
    );

    // 分片上传中的任务由本地 controller 驱动；其余状态由 store 统一 list 轮询
    useEffect(() => {
      if (!cloudId) return;
      const timer = window.setInterval(async () => {
        const candidates = tasksRef.current.filter((t) => getChunkUploadControllersMap().has(t.id));
        if (candidates.length === 0) return;
        try {
          const next = await Promise.all(
            candidates.map(async (t) => {
              try {
                const resp = await fetchHarvesterImageUploadTask(cloudId, t.id);
                const r = resp as { data?: HarvesterImageUploadTask };
                return (r?.data ?? r) as HarvesterImageUploadTask;
              } catch {
                return t;
              }
            }),
          );
          setTasks((prev) => mergeUploadTasksSorted(prev, next));
          for (const task of next) {
            if (taskAffectsImageList(task)) onListTaskChange(task);
          }
        } catch {
          /* ignore */
        }
      }, 3000);
      return () => window.clearInterval(timer);
    }, [cloudId, onListTaskChange]);

    const evictMissingUploadTask = useCallback(
      (taskId: string) => {
        removeUploadTaskFromStore(cloudId, taskId);
        abortChunkUploadController(taskId);
        clearChunkUploadController(taskId);
        clearResumeHint(taskId);
        startTransition(() => {
          setTasks((prev) => prev.filter((x) => x.id !== taskId));
        });
        onListTaskRemove?.(taskId);
      },
      [cloudId, clearResumeHint, onListTaskRemove],
    );

    const handleCancelUploadTask = useCallback(
      async (task: HarvesterImageUploadTask) => {
        try {
          if (!ensureImagesWrite()) return;
          abortChunkUploadController(task.id);
          const resp = (await cancelHarvesterImageUploadTask(cloudId, task.id)) as {
            data?: HarvesterImageUploadTask;
          };
          let next = (resp?.data || resp) as HarvesterImageUploadTask;
          if (!next?.id) {
            const latest = (await fetchHarvesterImageUploadTask(cloudId, task.id)) as {
              data?: HarvesterImageUploadTask;
            };
            next = (latest?.data || latest) as HarvesterImageUploadTask;
          }
          const cancelled: HarvesterImageUploadTask = {
            ...next,
            status: 'cancelled',
            receivedChunks: [],
            progress: 0,
            ingestProgress: 0,
            bytesUploaded: 0,
          };
          startTransition(() => {
            setTasks((prev) => prev.map((t) => (t.id === cancelled.id ? cancelled : t)));
          });
          clearResumeHint(task.id);
          message.success('取消成功');
          onListTaskChange(cancelled);
        } catch (e: unknown) {
          if (isUploadTaskNotFoundApiError(e)) {
            evictMissingUploadTask(task.id);
            message.warning('任务已不存在，已从列表移除');
            return;
          }
          message.error((e as { message?: string })?.message || '取消失败');
        }
      },
      [cloudId, ensureImagesWrite, onListTaskChange, clearResumeHint, evictMissingUploadTask],
    );

    const handleDeleteUploadTask = useCallback(
      async (task: HarvesterImageUploadTask) => {
        try {
          const blocked = getUploadTaskDeleteBlockedMessage(task);
          if (blocked) {
            message.warning(blocked);
            return;
          }
          if (!ensureImagesWrite()) return;
          await deleteHarvesterImageUploadTask(cloudId, task.id);
          message.success('任务记录已删除');
          setTasks((prev) => prev.filter((x) => x.id !== task.id));
          onListTaskRemove?.(task.id, {
            refreshInventory: shouldRefreshInventoryAfterUploadTaskDelete(task),
          });
        } catch (e: unknown) {
          message.error((e as { message?: string })?.message || '删除任务记录失败');
        }
      },
      [cloudId, ensureImagesWrite, onListTaskRemove],
    );

    const upsertDrawerDownloadTask = useCallback(
      (task: HarvesterImageDownloadTask) => {
        startTransition(() => {
          setDownloadTaskList((prev) => mergeDownloadTasksSorted(prev, task));
        });
        onDownloadTaskChange?.(task);
      },
      [onDownloadTaskChange],
    );

    const handleDownloadTaskToLocal = useCallback(
      async (task: HarvesterImageDownloadTask) => {
        if (localDownloadLoadingId) return;
        setLocalDownloadLoadingId(task.id);
        setLocalDownloadProgress(null);
        try {
          let latest = task;
          try {
            const resp = await fetchHarvesterImageDownloadTask(cloudId, task.id);
            const r = resp as { data?: HarvesterImageDownloadTask };
            latest = (r?.data ?? r) as HarvesterImageDownloadTask;
            upsertDrawerDownloadTask(latest);
          } catch {
            /* use snapshot */
          }
          await saveImageDownloadTaskFileToLocalWithCleanup(cloudId, latest, {
            onProgress: (progress) => {
              setLocalDownloadProgress({ taskId: latest.id, progress });
            },
          });
          setDownloadTaskList((prev) => prev.filter((x) => x.id !== latest.id));
          onDownloadTaskRemove?.(latest.id);
          message.success('已下载到本地');
        } catch (e: unknown) {
          message.error(getApiErrorMessage(e, '下载到本地失败'));
        } finally {
          setLocalDownloadLoadingId(null);
          setLocalDownloadProgress(null);
        }
      },
      [cloudId, localDownloadLoadingId, onDownloadTaskRemove, upsertDrawerDownloadTask],
    );

    const handleCancelDownloadTask = useCallback(
      async (task: HarvesterImageDownloadTask) => {
        try {
          const resp = (await cancelHarvesterImageDownloadTask(cloudId, task.id)) as {
            data?: HarvesterImageDownloadTask;
          };
          const next = (resp?.data || resp) as HarvesterImageDownloadTask;
          upsertDrawerDownloadTask({ ...next, taskStatus: 'cancelled' });
          message.success('已取消下载');
        } catch (e: unknown) {
          message.error(getApiErrorMessage(e, '取消失败'));
        }
      },
      [cloudId, upsertDrawerDownloadTask],
    );

    const handleDeleteDownloadTask = useCallback(
      async (task: HarvesterImageDownloadTask) => {
        try {
          await deleteHarvesterImageDownloadTask(cloudId, task.id);
          message.success('任务记录已删除');
          setDownloadTaskList((prev) => prev.filter((x) => x.id !== task.id));
          onDownloadTaskRemove?.(task.id);
        } catch (e: unknown) {
          message.error(getApiErrorMessage(e, '删除任务记录失败'));
        }
      },
      [cloudId, onDownloadTaskRemove],
    );

    const mergedTaskRows = useMemo(() => {
      const rows: Array<
        | { kind: 'upload'; sortMs: number; upload: HarvesterImageUploadTask }
        | { kind: 'download'; sortMs: number; download: HarvesterImageDownloadTask }
      > = [];
      for (const t of tasks) {
        rows.push({
          kind: 'upload',
          sortMs: Date.parse(String(t.createdAt || 0)) || 0,
          upload: t,
        });
      }
      for (const t of downloadTaskList) {
        rows.push({
          kind: 'download',
          sortMs: Date.parse(String(t.createdAt || 0)) || 0,
          download: t,
        });
      }
      return rows.sort((a, b) => b.sortMs - a.sortMs);
    }, [tasks, downloadTaskList]);

    useImperativeHandle(
      ref,
      () => ({
        openDrawer: (reload = true) => {
          setOpen(true);
          if (reload || uploadTasks.length === 0 || downloadTasks.length === 0) void loadTasks(true);
        },
        startUpload: (params) => {
          setOpen(true);
          runBrowserChunkedUpload(params);
        },
        resumeUpload: resumeBrowserChunkedUpload,
        upsertTask: (task) => {
          upsertDrawerTask(task);
        },
        removeTask: (taskId: string) => {
          setTasks((prev) => prev.filter((x) => x.id !== taskId));
        },
        upsertDownloadTask: (task) => {
          upsertDrawerDownloadTask(task);
        },
        removeDownloadTask: (taskId: string) => {
          setDownloadTaskList((prev) => prev.filter((x) => x.id !== taskId));
        },
      }),
      [
        loadTasks,
        uploadTasks,
        downloadTasks.length,
        runBrowserChunkedUpload,
        resumeBrowserChunkedUpload,
        upsertDrawerTask,
        upsertDrawerDownloadTask,
        onDownloadTaskRemove,
      ],
    );

    const isUploadTaskRunning = (taskId: string) =>
      isUploadTaskActivelyUploading(taskId, getChunkUploadControllersMap());

    return (
      <Drawer
        title="镜像任务"
        placement="right"
        width={460}
        open={open}
        onClose={() => setOpen(false)}
        extra={
          <Button
            size="small"
            icon={<ReloadOutlined />}
            loading={uploadTasksLoading}
            onClick={() => {
              void loadTasks(true);
            }}
          />
        }
      >
        {mergedTaskRows.length === 0 ? (
          <Typography.Text type="secondary">暂无上传或下载任务</Typography.Text>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {mergedTaskRows.map((row) => {
              if (row.kind === 'download') {
                const t = row.download;
                const st = String(t.taskStatus || '').toLowerCase();
                const isReady = st === 'ready';
                const isFailed = st === 'failed';
                const isCancelled = st === 'cancelled';
                const isRunning = st === 'pending' || st === 'fetching';
                const isLocalDownloading = localDownloadLoadingId === t.id;
                const localProgress =
                  isLocalDownloading && localDownloadProgress?.taskId === t.id
                    ? localDownloadProgress.progress
                    : null;
                const progressPercent = Math.max(
                  0,
                  Math.min(100, Math.floor(Number(t.progress) || 0)),
                );
                const displayPercent = isLocalDownloading
                  ? localProgress?.percent ?? 0
                  : isReady
                    ? 100
                    : progressPercent;
                const progressStatus = isFailed
                  ? 'exception'
                  : isLocalDownloading
                    ? 'active'
                    : isReady
                      ? 'success'
                      : isCancelled
                        ? 'normal'
                        : 'active';

                return (
                  <div
                    key={`download-${t.id}`}
                    style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 10 }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                      <Typography.Text ellipsis style={{ maxWidth: 220 }}>
                        {t.displayName || t.imageName || t.id}
                      </Typography.Text>
                      <Tag color={isReady ? 'green' : isFailed ? 'red' : isCancelled ? 'default' : 'blue'}>
                        下载 · {imageDownloadTaskStatusLabel(st)}
                      </Tag>
                    </div>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      项目：{t.namespace || '-'}
                    </Typography.Text>
                    <Progress
                      percent={displayPercent}
                      size="small"
                      status={progressStatus}
                      style={{ marginTop: 6, marginBottom: 4 }}
                    />
                    {isLocalDownloading && localProgress ? (
                      <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
                        {formatImageLocalDownloadProgressText(localProgress)}
                      </Typography.Text>
                    ) : isReady ? (
                      <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
                        点击「下载到本地」下载镜像
                      </Typography.Text>
                    ) : null}
                    {isFailed && t.errorMessage ? (
                      <Typography.Text type="danger" style={{ fontSize: 12, display: 'block' }}>
                        {t.errorMessage}
                      </Typography.Text>
                    ) : null}
                    {isRunning ? (
                      <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
                        正在从集群拉取…
                      </Typography.Text>
                    ) : null}
                    <div
                      style={{
                        marginTop: 8,
                        display: 'flex',
                        justifyContent: 'flex-end',
                        flexWrap: 'wrap',
                        gap: 8,
                      }}
                    >
                      {isReady && hasImagesWrite ? (
                        <Button
                          size="small"
                          type="primary"
                          loading={localDownloadLoadingId === t.id}
                          onClick={() => void handleDownloadTaskToLocal(t)}
                        >
                          下载到本地
                        </Button>
                      ) : null}
                      {hasImagesWrite && isRunning ? (
                        <Button
                          size="small"
                          onClick={() =>
                            Modal.confirm({
                              title: '确认取消该下载任务？',
                              content: `将停止从集群拉取：${t.displayName || t.imageName || t.id}`,
                              onOk: async () => {
                                await handleCancelDownloadTask(t);
                              },
                            })
                          }
                        >
                          取消
                        </Button>
                      ) : null}
                      {hasImagesWrite && !isRunning ? (
                        <Button
                          size="small"
                          danger
                          onClick={() =>
                            Modal.confirm({
                              title: '确认删除该下载任务记录？',
                              content: `将删除 Tower 暂存文件：${t.displayName || t.imageName || t.id}`,
                              onOk: async () => {
                                await handleDeleteDownloadTask(t);
                              },
                            })
                          }
                        >
                          删除
                        </Button>
                      ) : null}
                    </div>
                  </div>
                );
              }

              const t = row.upload;
              const st = String(t.status || '');
              const displayStatus = getUploadDrawerDisplayStatus(t);
              const isRunning = isUploadTaskRunning(t.id);
              const wantsResumePick = resumeHintTaskIds.has(t.id);
              const isCancelled = st === 'cancelled';
              const isUploadComplete = displayStatus === 'uploaded';
              const isUploadFailed = displayStatus === 'failed';
              const isIngestPaused = isIngestUploadPaused(t, isRunning);
              const needsResumeUpload =
                !isCancelled &&
                !isUploadComplete &&
                !isRunning &&
                (isIngestPaused || wantsResumePick);
              const resumeHintText = wantsResumePick
                ? LOCAL_SOURCE_FILE_RESUME_HINT
                : '上传已中断。请选择同一文件继续断点上传。';
              const progressPercent = getTowerUploadTaskProgress(t);
              const chunkLine = formatImageUploadTaskChunkLine(t, { isRunning });
              const progressStatus =
                isUploadFailed
                  ? 'exception'
                  : isUploadComplete
                    ? 'success'
                    : displayStatus === 'cancelled'
                      ? 'normal'
                      : 'active';

              return (
                <div key={`upload-${t.id}`} style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <Typography.Text ellipsis style={{ maxWidth: 260 }}>
                      {t.displayName || t.filename || t.id}
                    </Typography.Text>
                    <Tag
                      color={
                        needsResumeUpload
                          ? 'orange'
                          : displayStatus === 'uploaded'
                            ? 'green'
                            : isUploadFailed
                              ? 'red'
                              : displayStatus === 'cancelled'
                                ? 'default'
                                : 'blue'
                      }
                    >
                      {needsResumeUpload
                        ? '待续传'
                        : imageUploadTaskStatusLabel(displayStatus)}
                    </Tag>
                  </div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    项目：{t.namespace || '-'}
                  </Typography.Text>
                  <Progress
                    percent={progressPercent}
                    size="small"
                    status={progressStatus}
                    format={() => formatUploadTaskProgressLabel(progressPercent)}
                    style={{ marginTop: 6, marginBottom: 4 }}
                  />
                  {chunkLine ? (
                    <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
                      {chunkLine}
                    </Typography.Text>
                  ) : null}
                  {needsResumeUpload && Number(t.totalChunks || 0) > 0 ? (
                    <Typography.Text type="warning" style={{ fontSize: 12, display: 'block' }}>
                      {resumeHintText}
                    </Typography.Text>
                  ) : null}
                  {isUploadComplete ? (
                    <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
                      文件已上传至平台。请在镜像列表点击「操作-同步」
                    </Typography.Text>
                  ) : null}
                  {isUploadFailed ? (
                    <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
                      上传到 Tower 失败，可取消后重新上传。
                    </Typography.Text>
                  ) : null}
                  {isCancelled ? (
                    <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
                      上传已取消，分片文件已清理。
                    </Typography.Text>
                  ) : null}
                  <div
                    style={{
                      marginTop: 8,
                      display: 'flex',
                      justifyContent: 'flex-end',
                      flexWrap: 'wrap',
                      gap: 8,
                    }}
                  >
                    {needsResumeUpload && hasImagesWrite ? (
                      <Button
                        size="small"
                        type="primary"
                        disabled={isRunning}
                        onClick={() => {
                          resumeTaskRef.current = t;
                          onPickResumeFile();
                        }}
                      >
                        继续上传
                      </Button>
                    ) : null}
                    <Button
                      size="small"
                      disabled={
                        isCancelled || !['pending', 'ingesting'].includes(st) || !hasImagesWrite
                      }
                      onClick={() =>
                        Modal.confirm({
                          title: '确认取消该上传任务？',
                          content: `将停止当前上传并删除已传分片，取消后无法断点续传：${t.displayName || t.filename || t.id}`,
                          onOk: async () => {
                            await handleCancelUploadTask(t);
                          },
                        })
                      }
                    >
                      取消
                    </Button>
                    <Button
                      size="small"
                      danger
                      disabled={
                        (isRunning && ['pending', 'ingesting'].includes(st)) ||
                        isUploadTaskDeleteBlocked(t) ||
                        !hasImagesWrite
                      }
                      onClick={() =>
                        Modal.confirm({
                          title: '确认删除该上传任务记录？',
                          content: uploadTaskDeleteConfirmContent(t),
                          onOk: async () => {
                            await handleDeleteUploadTask(t);
                          },
                        })
                      }
                    >
                      删除
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Drawer>
    );
  },
);
