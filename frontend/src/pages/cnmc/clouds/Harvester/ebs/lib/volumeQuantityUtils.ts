/** K8s 容量字符串 → 字节（Ki/Mi/Gi 等） */
export function parseQuantity(s: string | number | undefined): number {
  if (typeof s === 'number') return s;
  if (!s) return 0;
  const str = String(s);
  const units: Record<string, number> = {
    Ki: 1024,
    Mi: 1024 ** 2,
    Gi: 1024 ** 3,
    Ti: 1024 ** 4,
    Pi: 1024 ** 5,
    k: 1000,
    M: 1000 ** 2,
    G: 1000 ** 3,
    T: 1000 ** 4,
    P: 1000 ** 5,
  };
  for (const [u, m] of Object.entries(units)) {
    if (str.endsWith(u)) {
      return parseFloat(str.slice(0, -u.length)) * m;
    }
  }
  return parseFloat(str);
}

export function gbText(bytes: number): string {
  if (!bytes || bytes <= 0) return '-';
  const gb = bytes / (1024 * 1024 * 1024);
  return `${gb.toFixed(2)} GB`;
}

/** 卷状态筛选下拉中文标签 */
export function cnVolumeStatus(s: string): string {
  const k = s.toLowerCase();
  const m: Record<string, string> = {
    healthy: '健康',
    degraded: '降级',
    faulted: '故障',
    unknown: '未知',
    bound: '已绑定',
    pending: '等待中',
    lost: '丢失',
    detached: '已卸载',
    attaching: '使用中',
    attached: '使用中',
    detaching: '卸载中',
    maintenance: '维护',
    restoring: '恢复中',
    creating: '创建中',
    deleting: '删除中',
    error: '错误',
  };
  return m[k] || s;
}

export const VOLUME_STATUS_FILTER_OPTIONS = [
  'healthy',
  'degraded',
  'faulted',
  'detached',
  'attaching',
  'attached',
  'detaching',
  'maintenance',
  'restoring',
  'creating',
  'deleting',
  'error',
  'bound',
  'pending',
  'lost',
] as const;
