import { useCallback, useEffect, useRef } from 'react';
import { isVolumePhaseTransitional, VOLUME_LIST_POLL_MS } from '../lib/volumePhaseUtils';
import type { VolumeView } from '../lib/volumesSectionTypes';

export type VolumeBurstRefresh = () => void;

/** 写操作后短 burst 刷新，覆盖 PVC 中间态 */
export function useStableBurstVolumeRefresh(
  onRefresh?: (force?: boolean, silent?: boolean) => void,
): VolumeBurstRefresh {
  const burstSeqRef = useRef(0);

  useEffect(() => {
    return () => {
      burstSeqRef.current += 1;
    };
  }, []);

  return useCallback(() => {
    onRefresh?.(true);
    const seq = ++burstSeqRef.current;
    [700, 2000, 4500].forEach((ms) => {
      window.setTimeout(() => {
        if (burstSeqRef.current !== seq) return;
        onRefresh?.(true);
      }, ms);
    });
  }, [onRefresh]);
}

/** 存在中间态卷时轮询 `onRefresh(true)` */
export function useVolumesListPoll(
  dataSource: VolumeView[],
  cloudId: string,
  onRefresh?: (force?: boolean, silent?: boolean) => void,
): void {
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  const shouldPoll = dataSource.some((v) => isVolumePhaseTransitional(v.phase));

  useEffect(() => {
    if (!shouldPoll || !cloudId) return;
    const tick = () => {
      try {
        onRefreshRef.current?.(true);
      } catch {
        /* ignore */
      }
    };
    tick();
    const id = window.setInterval(tick, VOLUME_LIST_POLL_MS);
    return () => window.clearInterval(id);
  }, [shouldPoll, cloudId]);
}
