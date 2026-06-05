import { readVmStatus } from '../../clouds/Harvester/ecs/lib/vmSafeRead';
import { getVmInstanceId } from '../../clouds/Harvester/ecs/lib/vmSectionUtils';

const SETTLING_STATUSES = new Set([
  'starting',
  'stopping',
  'pausing',
  'migrating',
  'provisioning',
  'waitingforvolumebinding',
  'terminating',
]);

export function isVmPowerOpSettlingStatus(status: string): boolean {
  return SETTLING_STATUSES.has(String(status || '').toLowerCase());
}

export type ReloadTenantEcsFn = (
  cloudId: string,
  force?: boolean,
) => Promise<unknown[] | void>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export type RefreshTenantEcsAfterPowerOpOptions = {
  /** 写操作后等待对端状态落盘再 force 同步，避免把「已停止」旧快照写回列表 */
  initialDelayMs?: number;
};

/** 电源类写操作后：强制同步列表，并在过渡态下短轮询直至稳定或超时 */
export async function refreshTenantEcsAfterPowerOp(
  reload: ReloadTenantEcsFn,
  cloudId: string,
  instanceId?: string,
  options?: RefreshTenantEcsAfterPowerOpOptions,
): Promise<void> {
  const initialDelayMs = Math.max(0, options?.initialDelayMs ?? 0);
  if (initialDelayMs > 0) {
    await sleep(initialDelayMs);
  }
  const list = (await reload(cloudId, true)) || [];
  if (!instanceId) return;

  const row = list.find((r) => getVmInstanceId(r) === instanceId);
  const status = readVmStatus(row || {});
  if (!isVmPowerOpSettlingStatus(status)) return;

  for (const waitMs of [2500, 2500, 3000, 4000, 5000]) {
    await sleep(waitMs);
    const nextList = (await reload(cloudId, true)) || [];
    const nextRow = nextList.find((r) => getVmInstanceId(r) === instanceId);
    const nextStatus = readVmStatus(nextRow || {});
    if (!isVmPowerOpSettlingStatus(nextStatus)) return;
  }
}
