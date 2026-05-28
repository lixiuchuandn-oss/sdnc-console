/** 与 BFF aggregateMaasMachines / integrate §14.5 一致 */
const PROVISIONING = new Set([1, 9, 12, 14, 21]);
const ERROR = new Set([2, 3, 8, 11, 13, 15, 18, 20, 22]);
const READY = new Set([4, 5, 10]);
const DEPLOYED = new Set([6]);

export type MaasMachineBucket = 'ready' | 'deployed' | 'provisioning' | 'error' | 'other';

export function machineStatusCode(raw: unknown): number | null {
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string' && /^\d+$/.test(raw)) return Number(raw);
  return null;
}

export function machineBucketFromStatus(raw: unknown): MaasMachineBucket {
  const s = machineStatusCode(raw);
  if (s == null) return 'other';
  if (READY.has(s)) return 'ready';
  if (DEPLOYED.has(s)) return 'deployed';
  if (PROVISIONING.has(s)) return 'provisioning';
  if (ERROR.has(s)) return 'error';
  return 'other';
}

export function machineMatchesBucket(statusRaw: unknown, bucket: string | null): boolean {
  if (!bucket) return true;
  const b = bucket as MaasMachineBucket;
  if (!['ready', 'deployed', 'provisioning', 'error', 'other'].includes(b)) return true;
  return machineBucketFromStatus(statusRaw) === b;
}
