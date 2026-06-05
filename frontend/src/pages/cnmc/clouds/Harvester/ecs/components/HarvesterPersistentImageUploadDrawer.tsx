/**
 * 计算 Tab 级常驻镜像上传抽屉：切换子 Tab 时不卸载，同步/分片上传 UI 与轮询不中断。
 */
import React, { forwardRef, useCallback, useImperativeHandle, useRef, useSyncExternalStore } from 'react';
import { useAuth } from '../../../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../../../utils/accessMapping';
import type { HarvesterImageUploadTask } from '../../../../../../services/harvesterApi';
import {
  ImageUploadTasksDrawer,
  type ImageUploadTasksDrawerHandle,
} from './ImageUploadTasksDrawer';
import {
  applyUploadTaskPatchToStore,
  ensureImageUploadTasksPolling,
  getImageUploadTasksSnapshot,
  registerImageUploadTasksReload,
  registerImageUploadTasksSubscriber,
  reloadImageUploadTasksFromStore,
  removeUploadTaskFromStore,
  subscribeImageUploadTasks,
  unregisterImageUploadTasksReload,
  unregisterImageUploadTasksSubscriber,
} from '../lib/imageUploadTasksStore';
import {
  hydrateUploadTasksFromSessionCache,
  reloadUploadTasksForCloud,
} from '../lib/uploadTaskReload';
export type HarvesterPersistentImageUploadDrawerProps = {
  cloudId: string;
  /** ImagesSection 挂载时可注入，用于触发库存刷新等副作用 */
  onListTaskChange?: (task: HarvesterImageUploadTask) => void;
  onListTaskRemove?: (taskId: string, opts?: { refreshInventory?: boolean }) => void;
};

export const HarvesterPersistentImageUploadDrawer = forwardRef<
  ImageUploadTasksDrawerHandle,
  HarvesterPersistentImageUploadDrawerProps
>(function HarvesterPersistentImageUploadDrawer(
  { cloudId, onListTaskChange, onListTaskRemove },
  ref,
) {
  const { user, loading: authLoading, token } = useAuth();
  const perms = (user?.permissions ?? []) as string[];
  const hasImagesWrite =
    hasPermissionForAction(perms, 'clouds.images:write') ||
    hasPermissionForAction(perms, 'clouds:write');

  const innerDrawerRef = useRef<ImageUploadTasksDrawerHandle | null>(null);
  const resumeFileInputRef = useRef<HTMLInputElement>(null);
  const resumeTaskRef = useRef<HarvesterImageUploadTask | null>(null);

  const subscribe = useCallback(
    (onChange: () => void) => subscribeImageUploadTasks(cloudId, onChange),
    [cloudId],
  );
  const getSnapshot = useCallback(() => getImageUploadTasksSnapshot(cloudId), [cloudId]);
  const { uploadTasks, uploadTasksLoading } = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getSnapshot,
  );

  React.useEffect(() => {
    if (!cloudId || authLoading || !token) return;
    hydrateUploadTasksFromSessionCache(cloudId);
    registerImageUploadTasksReload(cloudId);
    registerImageUploadTasksSubscriber(cloudId);
    ensureImageUploadTasksPolling(cloudId);
    void reloadUploadTasksForCloud(cloudId).catch(() => undefined);
    return () => {
      unregisterImageUploadTasksReload(cloudId);
      unregisterImageUploadTasksSubscriber(cloudId);
    };
  }, [cloudId, authLoading, token]);

  const ensureImagesWrite = useCallback(() => {
    if (hasImagesWrite) return true;
    return false;
  }, [hasImagesWrite]);

  const handleListTaskChange = useCallback(
    (task: HarvesterImageUploadTask) => {
      if (onListTaskChange) {
        onListTaskChange(task);
        return;
      }
      applyUploadTaskPatchToStore(cloudId, task);
    },
    [cloudId, onListTaskChange],
  );

  const handleListTaskRemove = useCallback(
    (taskId: string, opts?: { refreshInventory?: boolean }) => {
      if (onListTaskRemove) {
        onListTaskRemove(taskId, opts);
        innerDrawerRef.current?.removeTask(taskId);
        return;
      }
      removeUploadTaskFromStore(cloudId, taskId);
      innerDrawerRef.current?.removeTask(taskId);
    },
    [cloudId, onListTaskRemove],
  );

  const handlePickResumeFile = useCallback(() => {
    resumeFileInputRef.current?.click();
  }, []);

  const handleResumeFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      const task = resumeTaskRef.current;
      if (!file || !task) return;
      innerDrawerRef.current?.resumeUpload(task, file);
      resumeTaskRef.current = null;
    },
    [],
  );

  const reloadUploadTasks = useCallback(
    (showLoading?: boolean) => reloadImageUploadTasksFromStore(cloudId, showLoading),
    [cloudId],
  );

  useImperativeHandle(ref, () => innerDrawerRef.current as ImageUploadTasksDrawerHandle);

  if (!cloudId) return null;

  return (
    <>
      <ImageUploadTasksDrawer
        ref={innerDrawerRef}
        cloudId={cloudId}
        hasImagesWrite={hasImagesWrite}
        ensureImagesWrite={ensureImagesWrite}
        uploadTasks={uploadTasks}
        uploadTasksLoading={uploadTasksLoading}
        reloadUploadTasks={reloadUploadTasks}
        onListTaskChange={handleListTaskChange}
        onListTaskRemove={handleListTaskRemove}
        resumeTaskRef={resumeTaskRef}
        onPickResumeFile={handlePickResumeFile}
      />
      <input
        ref={resumeFileInputRef}
        type="file"
        accept=".iso,.img,.qcow2,.raw,.vmdk,.vdi,.vhd,.vhdx,.qed"
        style={{ display: 'none' }}
        onChange={handleResumeFileChange}
      />
    </>
  );
});

/** 供 ImagesSection 注册 drawer ref API（打开抽屉、开始上传等） */
export type PersistentImageUploadDrawerApi = ImageUploadTasksDrawerHandle;

export function usePersistentImageUploadDrawerRef() {
  return useRef<ImageUploadTasksDrawerHandle>(null);
}
