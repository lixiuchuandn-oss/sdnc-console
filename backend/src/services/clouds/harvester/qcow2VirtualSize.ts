/** 集群 VMImage 详情解析出 virtualSize 后，写入顶层与 status 字段 */
export function injectVmImageVirtualSize(record: unknown, virtualSizeBytes: number): unknown {
  if (!record || typeof record !== 'object' || !(virtualSizeBytes > 0)) return record;
  const r = record as Record<string, unknown>;
  const status =
    r.status && typeof r.status === 'object' && !Array.isArray(r.status)
      ? (r.status as Record<string, unknown>)
      : {};
  return {
    ...r,
    virtualSize: virtualSizeBytes,
    status: { ...status, virtualSize: virtualSizeBytes },
  };
}
