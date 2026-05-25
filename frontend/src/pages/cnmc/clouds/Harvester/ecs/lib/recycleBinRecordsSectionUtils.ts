export type ShutdownRecord = {
  id: string;
  cloudId: string;
  cloudName: string;
  namespace: string;
  name: string;
  displayName?: string;
  instanceId: string;
  uid: string;
  shutdownAt: string;
  status: 'success' | 'failed' | 'skipped';
  errorMessage?: string;
  previousStatus?: string;
  taskId?: string;
};

export function filterShutdownRecordsByKeyword(
  records: readonly ShutdownRecord[],
  keyword: string,
): ShutdownRecord[] {
  const kw = keyword.trim().toLowerCase();
  if (!kw) return [...records];
  return records.filter((record) => {
    return (
      record.cloudName?.toLowerCase().includes(kw) ||
      record.displayName?.toLowerCase().includes(kw) ||
      record.name?.toLowerCase().includes(kw) ||
      record.namespace?.toLowerCase().includes(kw) ||
      record.instanceId?.toLowerCase().includes(kw)
    );
  });
}
