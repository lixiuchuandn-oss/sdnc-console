/** 云资源池列表页：筛选与错误文案 */

export function readCloudApiErr(e: unknown): string {
  const x = e as { message?: string; responseData?: { message?: string } };
  return String(x?.responseData?.message || x?.message || '未知错误');
}

/** 供应商筛选：下拉 value = poolProviders.id；历史 cloudmap 等价于 Cloudmap 私有接入 */
export function matchesPoolVendor(providerRaw: string | undefined, vendorFilterValue: string): boolean {
  const pv = String(providerRaw || '').toLowerCase().trim();
  const fv = vendorFilterValue.toLowerCase().trim();
  if (pv === fv) return true;
  if (fv === 'cloudmap.private' && pv === 'cloudmap') return true;
  return false;
}

export type CloudsFilterFormValues = {
  keyword?: string;
  status?: string;
  category?: string;
  vendor?: string;
};
