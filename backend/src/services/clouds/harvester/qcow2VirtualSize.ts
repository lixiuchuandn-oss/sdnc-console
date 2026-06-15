import fs from 'fs';

/** qcow2 magic "QFI\xfb" */
const QCOW2_MAGIC = Buffer.from([0x51, 0x46, 0x49, 0xfb]);

/** 与 Harvester pkg/image/cdi/upload.go 一致：在缓冲区内查找 magic 后读 offset 24 的 virtual size */
export function readQcow2VirtualSizeBytesFromBuffer(buf: Buffer): number | undefined {
  if (!buf || buf.length < 32) return undefined;
  const magicIndex = buf.indexOf(QCOW2_MAGIC);
  if (magicIndex < 0 || magicIndex + 32 > buf.length) return undefined;
  const virtualSize = Number(buf.readBigUInt64BE(magicIndex + 24));
  if (!Number.isFinite(virtualSize) || virtualSize <= 0) return undefined;
  return virtualSize;
}

/** 依次探测本地文件是否为 qcow2 并解析 virtual size */
export function probeQcow2VirtualSizeFromPaths(
  paths: Array<string | undefined | null>,
): number | undefined {
  for (const raw of paths) {
    const p = String(raw || '').trim();
    if (!p) continue;
    const vs = readQcow2VirtualSizeBytesFromFile(p);
    if (vs != null) return vs;
  }
  return undefined;
}

/** 读取本地 qcow2 文件头（至多 4KiB）解析 virtual size */
export function readQcow2VirtualSizeBytesFromFile(filePath: string): number | undefined {
  const p = String(filePath || '').trim();
  if (!p) return undefined;
  try {
    const fd = fs.openSync(p, 'r');
    try {
      const buf = Buffer.alloc(4096);
      const readLen = fs.readSync(fd, buf, 0, buf.length, 0);
      if (readLen < 32) return undefined;
      return readQcow2VirtualSizeBytesFromBuffer(buf.subarray(0, readLen));
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return undefined;
  }
}

/**
 * CDI DataVolume 请求容量（仅供文档/测试参考）。
 * 上传 URL 的 size= 须为文件字节数；Harvester 从 qcow2 头解析 virtualSize 后再创建 DV。
 */
export function resolveCephCdiDataVolumeByteSize(opts: {
  fileByteSize: number;
  virtualSizeBytes?: number;
  diskFormat?: string;
}): number {
  const fileByteSize = Math.max(0, Math.floor(Number(opts.fileByteSize) || 0));
  const df = String(opts.diskFormat || '')
    .trim()
    .toLowerCase();
  if (df === 'iso') return fileByteSize;
  const vs = Math.max(0, Math.floor(Number(opts.virtualSizeBytes) || 0));
  if (vs > fileByteSize) return vs;
  return fileByteSize;
}

export function isQcow2DiskFormat(diskFormat?: string): boolean {
  const df = String(diskFormat || '')
    .trim()
    .toLowerCase();
  return df === 'qcow2' || df === 'disk';
}

export type ImageProxyUploadSizes = {
  fileByteTotal: number;
  /** 实际发送字节（Longhorn 含 512 对齐填充） */
  streamByteSize: number;
  /**
   * upload URL 的 size= 参数：须为**实际文件字节数**（与 Harvester cdi/upload.go 一致）。
   * virtualSize 由 Harvester 从 qcow2 头解析，勿将 virtual size 写入 size=。
   */
  uploadUrlSize: number;
};

/** Longhorn backingimage 需 512 对齐；Ceph/CDI 流式 body 使用真实文件字节数 */
export function computeProxyStreamByteSize(
  fileByteTotal: number,
  storageKind: 'ceph' | 'longhorn' | string,
): number {
  const total = Math.max(0, Math.floor(Number(fileByteTotal) || 0));
  if (storageKind === 'ceph') return total;
  const padding = total % 512 === 0 ? 0 : 512 - (total % 512);
  return total + padding;
}

export function resolveImageProxyUploadSizes(opts: {
  fileByteTotal: number;
  storageKind: 'ceph' | 'longhorn' | string;
  diskFormat?: string;
  virtualSizeBytes?: number;
}): ImageProxyUploadSizes {
  const fileByteTotal = Math.max(0, Math.floor(Number(opts.fileByteTotal) || 0));
  const streamByteSize = computeProxyStreamByteSize(fileByteTotal, opts.storageKind);
  // Harvester CDI：size= → status.size（文件体积）；virtualSize 从上传流 qcow2 头解析后写 status.virtualSize
  return { fileByteTotal, streamByteSize, uploadUrlSize: streamByteSize };
}

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
