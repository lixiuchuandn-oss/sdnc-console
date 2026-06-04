import type { HarvesterImageUploadTask } from '../../../../../../services/harvesterApi';

/** 限制上传进度回调频率，避免 XHR onprogress 触发整页频繁重渲染 */
export function createThrottledTaskUpsert(
  onTaskUpsert: (task: HarvesterImageUploadTask) => void,
  intervalMs = 400,
): (task: HarvesterImageUploadTask, opts?: { force?: boolean }) => void {
  let lastAt = 0;
  let pending: HarvesterImageUploadTask | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = (force = false) => {
    if (!pending) return;
    const now = Date.now();
    if (!force && now - lastAt < intervalMs) return;
    lastAt = now;
    const task = pending;
    pending = null;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    onTaskUpsert(task);
  };

  return (task, opts) => {
    pending = task;
    if (opts?.force) {
      flush(true);
      return;
    }
    const now = Date.now();
    if (now - lastAt >= intervalMs) {
      flush(true);
      return;
    }
    if (!timer) {
      timer = setTimeout(() => flush(true), intervalMs - (now - lastAt));
    }
  };
}
