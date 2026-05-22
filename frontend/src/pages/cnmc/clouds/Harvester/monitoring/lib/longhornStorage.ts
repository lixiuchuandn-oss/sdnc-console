/**
 * 存储空间卡片：Longhorn 节点接口数据解析
 * 与参考项目 Compute.Tower-Monitoring 一致。
 */
export interface LonghornStorageSummary {
  storageMaximum: number;
  storageAvailable: number;
  storageUsed: number;
  storageReserved: number;
  storageScheduled: number;
  nodeCount: number;
  /**
   * 集群默认 StorageClass（is-default-class，否则列表首项）且为 Longhorn 时，
   * 来自 parameters.numberOfReplicas；否则 null（不读取 Longhorn setting default-replica-count）。
   */
  defaultStorageClassReplicaCount: number | null;
  /** 用于上一字段的存储类名；非 Longhorn 或未解析时为 null */
  defaultStorageClassName: string | null;
  /** 默认 StorageClass provisioner（Steve / K8s 对象字段） */
  defaultStorageClassProvisioner: string | null;
  /** 由后端根据默认存储类判定：longhorn / ceph / unknown */
  distributedStorageKind: 'longhorn' | 'ceph' | 'unknown';
}

const BYTES_PER_GIB = 1024 ** 3;
const BYTES_PER_TIB = 1024 ** 4;

export function formatBytesWithUnit(bytes: number): { value: number; unit: 'GiB' | 'TiB' } {
  const tib = bytes / BYTES_PER_TIB;
  if (tib >= 1) return { value: Math.round(tib * 100) / 100, unit: 'TiB' };
  const gib = bytes / BYTES_PER_GIB;
  return { value: Math.round(gib * 100) / 100, unit: 'GiB' };
}

export function parseLonghornStorage(nodesResponse: any): LonghornStorageSummary {
  let list: any[] = [];
  if (Array.isArray(nodesResponse)) {
    list = nodesResponse;
  } else if (nodesResponse && Array.isArray(nodesResponse.data)) {
    list = nodesResponse.data;
  }
  let defaultStorageClassReplicaCount: number | null = null;
  let defaultStorageClassName: string | null = null;
  let defaultStorageClassProvisioner: string | null = null;
  let distributedStorageKind: 'longhorn' | 'ceph' | 'unknown' = 'unknown';
  const tower = nodesResponse?._tower;
  if (tower && typeof tower === 'object') {
    const tw = tower as Record<string, unknown>;
    const rawRep = tw.defaultStorageClassReplicaCount;
    if (rawRep != null) {
      const n = Number(rawRep);
      if (Number.isFinite(n) && n >= 1) defaultStorageClassReplicaCount = Math.floor(n);
    }
    const rawNm = tw.defaultStorageClassName;
    if (rawNm != null && String(rawNm).trim()) defaultStorageClassName = String(rawNm).trim();
    const rawPv = tw.defaultStorageClassProvisioner;
    if (rawPv != null && String(rawPv).trim()) defaultStorageClassProvisioner = String(rawPv).trim();
    const rawKind = tw.distributedStorageKind;
    if (rawKind === 'longhorn' || rawKind === 'ceph') distributedStorageKind = rawKind;
  }

  let totalMaximum = 0;
  let totalAvailable = 0;
  let totalReserved = 0;
  let totalScheduled = 0;

  for (const node of list) {
    const diskStatus = node?.status?.diskStatus as Record<string, { storageMaximum?: number; storageAvailable?: number; storageScheduled?: number }> | undefined;
    if (diskStatus && typeof diskStatus === 'object') {
      for (const key of Object.keys(diskStatus)) {
        const d = diskStatus[key];
        if (d && typeof d === 'object') {
          const max = Number(d.storageMaximum);
          const avail = Number(d.storageAvailable);
          const sched = Number(d.storageScheduled);
          if (!Number.isNaN(max)) totalMaximum += max;
          if (!Number.isNaN(avail)) totalAvailable += avail;
          if (!Number.isNaN(sched)) totalScheduled += sched;
        }
      }
    }
    const disks = node?.spec?.disks;
    if (Array.isArray(disks)) {
      for (const disk of disks) {
        const reserved = Number(disk?.storageReserved);
        if (!Number.isNaN(reserved)) totalReserved += reserved;
      }
    }
  }

  const storageUsed = Math.max(0, totalMaximum - totalAvailable);

  return {
    storageMaximum: totalMaximum,
    storageAvailable: totalAvailable,
    storageUsed,
    storageReserved: totalReserved,
    storageScheduled: totalScheduled,
    nodeCount: list.length,
    defaultStorageClassReplicaCount,
    defaultStorageClassName,
    defaultStorageClassProvisioner,
    distributedStorageKind,
  };
}
