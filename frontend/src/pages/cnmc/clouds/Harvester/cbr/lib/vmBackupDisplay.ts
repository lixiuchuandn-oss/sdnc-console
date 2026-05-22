/** VM 备份/快照/定时策略列表与详情 Tab 共用的展示与排序工具 */

export function formatVmBackupRelativeAge(timestamp: string): string {
  if (!timestamp) return '-';
  const created = new Date(timestamp).getTime();
  const diff = Date.now() - created;
  if (diff < 0) return '刚刚';

  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

export function formatVmBackupLocaleTime(timestamp: string): string {
  if (!timestamp) return '-';
  return new Date(timestamp).toLocaleString();
}

export function vmBackupItemCreationMs(item: any): number {
  const raw = item?.rawData || item;
  const t = raw?.metadata?.creationTimestamp || raw?.createdAt || item?.createdAt || 0;
  const n = new Date(t).getTime();
  return Number.isFinite(n) ? n : 0;
}

export function sortVmBackupItemsByCreationDesc<T extends { rawData?: any }>(items: T[]): T[] {
  return [...items].sort((a, b) => vmBackupItemCreationMs(b) - vmBackupItemCreationMs(a));
}

/** 在 VM 列表中解析 tower 别名，找不到则回退技术名 */
export function findHarvesterVmDisplayAlias(
  vms: any[] | undefined,
  namespace: string,
  vmName: string,
): string {
  const ns = String(namespace || '').trim();
  const name = String(vmName || '').trim();
  if (!name) return '-';
  const vm = (vms || []).find((x: any) => {
    const vmNs = x?.metadata?.namespace || x?.namespace || '';
    const vmId = x?.metadata?.name || x?.name || '';
    return String(vmNs) === ns && String(vmId) === name;
  });
  if (!vm) return name;
  return (
    vm?.metadata?.annotations?.['tower.io/alias'] ||
    vm?.alias ||
    vm?.name ||
    vm?.metadata?.name ||
    name
  );
}
