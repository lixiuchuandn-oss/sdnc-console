/**
 * Harvester CDI multipart 上传：首包须含 qcow2 头（见 harvester/pkg/image/cdi/upload.go 首读 1024B）。
 * Tower 若先 write(multipart 头) 再 write(文件体)，Harvester 首读可能只有头，导致 virtualSize=size。
 */

/** 与 Harvester cdi/upload.go tmpBuff 一致 */
export const HARVESTER_CDI_UPLOAD_PROBE_BYTES = 1024;

/** multipart 头之后至少再跟多少文件字节，保证 HTTP body 前 1024B 含 qcow2 magic */
export function minMultipartFilePrefixBytes(multipartHeaderLength: number): number {
  const head = Math.max(0, Math.floor(multipartHeaderLength));
  if (head >= HARVESTER_CDI_UPLOAD_PROBE_BYTES) return 512;
  return HARVESTER_CDI_UPLOAD_PROBE_BYTES - head;
}

export async function takeAtLeastFromAsyncIterator(
  iter: AsyncIterator<Buffer | string>,
  minBytes: number,
): Promise<{ prefix: Buffer; iter: AsyncIterator<Buffer | string> }> {
  const need = Math.max(0, Math.floor(minBytes));
  const parts: Buffer[] = [];
  let total = 0;
  while (total < need) {
    const step = await iter.next();
    if (step.done) break;
    const buf = Buffer.isBuffer(step.value) ? step.value : Buffer.from(step.value);
    parts.push(buf);
    total += buf.length;
  }
  return {
    prefix: parts.length ? Buffer.concat(parts) : Buffer.alloc(0),
    iter,
  };
}
