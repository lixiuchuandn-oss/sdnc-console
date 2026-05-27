import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { App } from 'antd';
import {
  fetchHarvesterBackups,
  fetchHarvesterCephVmRestores,
  fetchHarvesterVirtualMachineRestores,
} from 'services/harvester/cbr';
import {
  createHarvesterToolbarRefresh,
  runHarvesterSectionRefresh,
  type HarvesterSectionOnRefresh,
} from '../lib/cbrSectionRefresh';
import { hasPendingRestoreTasks, type VmRestoreTaskListRow } from '../lib/vmRestoreTasksSectionUtils';

const RESTORE_LIST_POLL_MS = 5000;

export function useVmRestoreTasksListController(cloudId: string) {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [backups, setBackups] = useState<any[]>([]);
  const [restores, setRestores] = useState<any[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(
    async (force = true) => {
      setLoading(true);
      try {
        const [bkRes, rsRes, cephRsRes] = await Promise.all([
          fetchHarvesterBackups(cloudId, force, false),
          fetchHarvesterVirtualMachineRestores(cloudId, force),
          fetchHarvesterCephVmRestores(cloudId, force).catch(() => ({ items: [] })),
        ]);
        const bkItems: any[] = Array.isArray((bkRes as any)?.data?.items)
          ? (bkRes as any).data.items
          : [];
        const rsItems: any[] = Array.isArray((rsRes as any)?.items)
          ? (rsRes as any).items
          : Array.isArray((rsRes as any)?.data?.items)
            ? (rsRes as any).data.items
            : [];
        const cephRsItems: any[] = Array.isArray((cephRsRes as any)?.items)
          ? (cephRsRes as any).items
          : Array.isArray((cephRsRes as any)?.data?.items)
            ? (cephRsRes as any).data.items
            : [];
        setBackups(bkItems);
        setRestores([...rsItems, ...cephRsItems]);
      } catch (e: unknown) {
        const err = e as { message?: string };
        message.error(err?.message || '刷新失败');
      } finally {
        setLoading(false);
      }
    },
    [cloudId, message],
  );

  const onListRefresh: HarvesterSectionOnRefresh = useCallback(
    (force?: boolean) => {
      void refresh(force !== false);
    },
    [refresh],
  );

  const handleToolbarRefresh = useMemo(
    () => createHarvesterToolbarRefresh(onListRefresh),
    [onListRefresh],
  );

  useEffect(() => {
    void runHarvesterSectionRefresh(onListRefresh, { force: true });
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [onListRefresh]);

  useEffect(() => {
    const handleRestoreCreated = () => {
      setTimeout(() => {
        void runHarvesterSectionRefresh(onListRefresh, { force: true });
      }, 1000);
    };
    window.addEventListener('harvester:restore-created', handleRestoreCreated);
    return () => {
      window.removeEventListener('harvester:restore-created', handleRestoreCreated);
    };
  }, [onListRefresh]);

  return {
    backups,
    restores,
    loading,
    onListRefresh,
    handleToolbarRefresh,
    timerRef,
  };
}

/** 存在进行中恢复任务时静默轮询列表 */
export function useVmRestoreTasksListPoll(
  filtered: VmRestoreTaskListRow[],
  onListRefresh: HarvesterSectionOnRefresh,
  timerRef: MutableRefObject<ReturnType<typeof setInterval> | null>,
): void {
  useEffect(() => {
    if (!hasPendingRestoreTasks(filtered)) {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      return;
    }
    if (!timerRef.current) {
      timerRef.current = setInterval(() => {
        void runHarvesterSectionRefresh(onListRefresh, { force: true, silent: true });
      }, RESTORE_LIST_POLL_MS);
    }
    return () => {};
  }, [filtered, onListRefresh, timerRef]);
}
