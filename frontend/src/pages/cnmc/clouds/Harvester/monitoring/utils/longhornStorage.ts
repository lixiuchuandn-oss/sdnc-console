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
  /** Longhorn 全局默认副本数（默认存储池），来自集群 Setting default-replica-count */
  defaultReplicaCount: number;
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
  let defaultReplicaCount = 3;
  const rawRep = nodesResponse?._tower?.defaultLonghornReplicaCount;
  if (rawRep != null) {
    const n = Number(rawRep);
    if (Number.isFinite(n) && n >= 1) defaultReplicaCount = Math.floor(n);
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
    defaultReplicaCount,
  };
}
