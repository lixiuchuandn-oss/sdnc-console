import { useCallback, useEffect, useRef } from 'react';
import { isVolumePhaseTransitional, VOLUME_LIST_POLL_MS } from '../lib/volumePhaseUtils';
import type { VolumeView } from '../lib/volumesSectionTypes';
import {
  runHarvesterSectionRefresh,
  type HarvesterSectionOnRefresh,
} from '../lib/ebsSectionRefresh';

export type VolumeBurstRefresh = () => void;

/** 写操作后短 burst 刷新，覆盖 PVC 中间态 */
export function useStableBurstVolumeRefresh(
  onRefresh?: HarvesterSectionOnRefresh,
): VolumeBurstRefresh {
  const burstSeqRef = useRef(0);

  useEffect(() => {
    return () => {
      burstSeqRef.current += 1;
    };
  }, []);

  return useCallback(() => {
    void runHarvesterSectionRefresh(onRefresh, { force: true, silent: true });
    const seq = ++burstSeqRef.current;
    [700, 2000, 4500].forEach((ms) => {
      window.setTimeout(() => {
        if (burstSeqRef.current !== seq) return;
        void runHarvesterSectionRefresh(onRefresh, { force: true, silent: true });
      }, ms);
    });
  }, [onRefresh]);
}

/** 存在中间态卷时轮询列表刷新 */
export function useVolumesListPoll(
  dataSource: VolumeView[],
  cloudId: string,
  onRefresh?: HarvesterSectionOnRefresh,
): void {
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  const shouldPoll = dataSource.some((v) => isVolumePhaseTransitional(v.phase));

  useEffect(() => {
    if (!shouldPoll || !cloudId) return;
    const tick = () => {
      void runHarvesterSectionRefresh(onRefreshRef.current, { force: true, silent: true });
    };
    tick();
    const id = window.setInterval(tick, VOLUME_LIST_POLL_MS);
    return () => window.clearInterval(id);
  }, [shouldPoll, cloudId]);
}
