import { useCallback, useEffect, useState } from 'react';
import {
  runHarvesterSectionRefresh,
  type HarvesterSectionOnRefresh,
} from '../lib/cbrSectionRefresh';
import {
  buildOptimisticScheduleVmBackupRow,
  schedulePollingTargetExists,
  scheduleSuspendPollingMatched,
  type RemovedSchedule,
  type SchedulePollingTarget,
  type ScheduleVmBackupCreatedPayload,
  type ScheduleVmBackupListRow,
  type SuspendedOverride,
} from '../lib/scheduleVmBackupsSectionUtils';
import { findHarvesterVmDisplayAlias } from '../lib/vmBackupDisplay';

const POLL_INTERVAL_MS = 3000;
const POLL_MAX_TRIES = 15;

export type UseScheduleVmBackupsOptimisticParams = {
  data: unknown[] | undefined;
  onRefresh?: HarvesterSectionOnRefresh;
};

export function useScheduleVmBackupsOptimistic({
  data,
  onRefresh,
}: UseScheduleVmBackupsOptimisticParams) {
  const [optimisticItems, setOptimisticItems] = useState<ScheduleVmBackupListRow[]>([]);
  const [removed, setRemoved] = useState<RemovedSchedule[]>([]);
  const [suspendedOverrides, setSuspendedOverrides] = useState<SuspendedOverride[]>([]);
  const [pollingTarget, setPollingTarget] = useState<SchedulePollingTarget | null>(null);
  const [suspendPollingTarget, setSuspendPollingTarget] = useState<SuspendedOverride | null>(
    null,
  );

  useEffect(() => {
    if (!pollingTarget) return;
    let tries = 0;
    const tick = () => {
      if (schedulePollingTargetExists(data, pollingTarget) || tries >= POLL_MAX_TRIES) {
        setPollingTarget(null);
        if (schedulePollingTargetExists(data, pollingTarget)) {
          setOptimisticItems((prev) =>
            prev.filter(
              (o) =>
                !(
                  o.namespace === pollingTarget.namespace &&
                  (o.name === pollingTarget.alias ||
                    o.id === pollingTarget.resourceName ||
                    o.id === pollingTarget.alias)
                ),
            ),
          );
        }
        return;
      }
      tries++;
      void runHarvesterSectionRefresh(onRefresh, { force: true, silent: true });
    };
    tick();
    const timer = setInterval(tick, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [pollingTarget, data, onRefresh]);

  useEffect(() => {
    if (!suspendPollingTarget) return;
    let tries = 0;
    const tick = () => {
      if (
        scheduleSuspendPollingMatched(data, suspendPollingTarget) ||
        tries >= POLL_MAX_TRIES
      ) {
        setSuspendPollingTarget(null);
        if (scheduleSuspendPollingMatched(data, suspendPollingTarget)) {
          setSuspendedOverrides((prev) =>
            prev.filter(
              (o) =>
                !(o.ns === suspendPollingTarget.ns && o.id === suspendPollingTarget.id),
            ),
          );
        }
        return;
      }
      tries++;
      void runHarvesterSectionRefresh(onRefresh, { force: true, silent: true });
    };
    tick();
    const timer = setInterval(tick, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [suspendPollingTarget, data, onRefresh]);

  const registerCreateSuccess = useCallback(
    (created: ScheduleVmBackupCreatedPayload | undefined, vms: unknown[] | undefined) => {
      if (!created) return;
      setPollingTarget({
        namespace: created.namespace,
        alias: created.alias,
        resourceName: created.resourceName,
      });
      const vmAlias = findHarvesterVmDisplayAlias(
        vms as any[],
        created.namespace,
        created.vmName,
      );
      setOptimisticItems((prev) =>
        prev.concat(buildOptimisticScheduleVmBackupRow(created, vmAlias)),
      );
    },
    [],
  );

  const markRemoved = useCallback((record: ScheduleVmBackupListRow) => {
    setRemoved((prev) =>
      prev.concat({ ns: record.namespace, id: record.id, alias: record.name }),
    );
    setOptimisticItems((prev) =>
      prev.filter(
        (o) =>
          !(
            o.namespace === record.namespace &&
            (o.name === record.name || o.id === record.id)
          ),
      ),
    );
  }, []);

  const applySuspendOverride = useCallback(
    (record: ScheduleVmBackupListRow, suspended: boolean) => {
      setSuspendedOverrides((prev) => {
        const rest = prev.filter((o) => !(o.ns === record.namespace && o.id === record.id));
        return rest.concat({ ns: record.namespace, id: record.id, suspended });
      });
      setSuspendPollingTarget({ ns: record.namespace, id: record.id, suspended });
    },
    [],
  );

  return {
    optimisticItems,
    removed,
    suspendedOverrides,
    registerCreateSuccess,
    markRemoved,
    applySuspendOverride,
  };
}
