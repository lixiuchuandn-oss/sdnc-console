import {
  fetchAswCtlSwitchesSummary,
  syncAswCtlSwitchesToInventory,
} from 'services/harvester/cluster';
import type { AswCtlSwitchProbeRecord } from 'services/harvester/types/aswProbe';
import { clearCache } from '../../../../../../utils/requestManager';

export const aswSwitchesCachePath = (cloudId: string) =>
  `/api/clouds/${cloudId}/resources/harvester/asw-ctl/switches`;

export type LoadHarvesterAswSwitchesOpts = {
  force?: boolean;
  /** 池 `loadTabResource` 第三参：为 true 时不触发 HSM 探测写库 */
  skipSync?: boolean;
  /** `clouds.cluster-networks:write` 时为 true，`force` 且未 `skipSync` 则 `syncAswCtlSwitchesToInventory` */
  canSyncToInventory?: boolean;
};

/**
 * 拓扑用 ASW 交换机列表：与 cluster `usePhysicalSwitchesData.loadProbeSummary` 对齐。
 * 强制刷新且有写权限时探测写库；否则只读 Tower 快照。
 */
export async function loadHarvesterAswSwitchesForTopology(
  cloudId: string,
  opts?: LoadHarvesterAswSwitchesOpts,
): Promise<AswCtlSwitchProbeRecord[]> {
  const force = opts?.force ?? false;
  const skipSync = opts?.skipSync ?? false;
  const canSync = opts?.canSyncToInventory ?? false;

  if (force && cloudId) {
    clearCache(aswSwitchesCachePath(cloudId), 'GET');
  }

  try {
    const live = force && !skipSync && canSync;
    const res = live
      ? await syncAswCtlSwitchesToInventory(cloudId)
      : await fetchAswCtlSwitchesSummary(cloudId);
    return Array.isArray(res?.items) ? res.items : [];
  } catch {
    return [];
  }
}
