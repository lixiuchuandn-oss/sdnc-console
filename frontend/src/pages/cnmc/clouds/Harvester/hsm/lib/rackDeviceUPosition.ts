/** 机柜设备 U 位：展示、默认下一 U、柜内排序（支持任意文本，纯数字按数值比） */

export function normalizeRackDeviceUPosition(value: unknown): string {
  return String(value ?? '').trim();
}

/** 柜内重复判断用：去首尾空白、忽略 U/u 前缀、不区分大小写 */
export function rackDeviceUPositionKey(value: unknown): string {
  const raw = normalizeRackDeviceUPosition(value);
  if (!raw) return '';
  const lower = raw.toLowerCase();
  if (/^u.+/.test(lower)) return lower.slice(1);
  return lower;
}

export function findRackDeviceByUPosition<T extends { id: string; slotOrder?: string | number | null }>(
  devices: T[] | undefined,
  uPosition: unknown,
  excludeDeviceId?: string,
): T | undefined {
  const key = rackDeviceUPositionKey(uPosition);
  if (!key) return undefined;
  return (devices || []).find(
    (d) => d.id !== excludeDeviceId && rackDeviceUPositionKey(d.slotOrder) === key,
  );
}

export function rackDeviceUPositionDuplicateMessage(
  uPosition: unknown,
  rackName?: string,
): string {
  const label = formatRackDeviceULabel(uPosition);
  return rackName
    ? `机柜「${rackName}」中 U 位 ${label} 已被占用，请更换`
    : `该机柜中 U 位 ${label} 已被占用，请更换`;
}

/** 机架条左上角 U 位标签；用户已写 U/u 前缀则不再重复加 */
export function formatRackDeviceULabel(slotOrder: unknown): string {
  const raw = normalizeRackDeviceUPosition(slotOrder);
  if (!raw) return 'U0';
  if (/^u/i.test(raw)) return raw;
  return `U${raw}`;
}

export function nextDefaultUPositionForRack(
  devices: { slotOrder?: string | number | null }[] | undefined,
): string {
  const ds = devices || [];
  let max = 0;
  for (const d of ds) {
    const raw = normalizeRackDeviceUPosition(d.slotOrder);
    if (/^\d+(\.\d+)?$/.test(raw)) {
      const n = Number(raw);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return String(max + 1);
}

export function compareRackDeviceSlotOrder(
  a: string | number | null | undefined,
  b: string | number | null | undefined,
): number {
  const sa = normalizeRackDeviceUPosition(a);
  const sb = normalizeRackDeviceUPosition(b);
  if (sa === sb) return 0;
  const na = /^\d+(\.\d+)?$/.test(sa) ? Number(sa) : NaN;
  const nb = /^\d+(\.\d+)?$/.test(sb) ? Number(sb) : NaN;
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return sa.localeCompare(sb, undefined, { numeric: true, sensitivity: 'base' });
}
