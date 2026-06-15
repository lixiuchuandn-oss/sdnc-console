/** 镜像上传来源（VMImage metadata.annotations），用于列表状态与同步按钮语义 */
export const IMAGE_UPLOAD_CHANNEL_ANNOTATION = 'compute-tower.io/upload-channel';
export const IMAGE_UPLOAD_CHANNEL_DESKTOP = 'desktop-uploader';
export const IMAGE_UPLOAD_CHANNEL_TOWER_CHUNKED = 'tower-chunked';

export function readImageUploadChannel(r: Record<string, unknown> | null | undefined): string {
  const meta = (r?.metadata as Record<string, unknown> | undefined) ?? undefined;
  const ann =
    (meta?.annotations as Record<string, unknown> | undefined) ??
    (r?.annotations as Record<string, unknown> | undefined);
  return String(ann?.[IMAGE_UPLOAD_CHANNEL_ANNOTATION] || '')
    .trim()
    .toLowerCase();
}

export function isDesktopDirectUploadChannel(r: Record<string, unknown> | null | undefined): boolean {
  return readImageUploadChannel(r) === IMAGE_UPLOAD_CHANNEL_DESKTOP;
}

export function isTowerChunkedUploadChannel(r: Record<string, unknown> | null | undefined): boolean {
  return readImageUploadChannel(r) === IMAGE_UPLOAD_CHANNEL_TOWER_CHUNKED;
}

/** sourceType=upload 进行中：桌面直传→uploading；浏览器分片/代传→syncing */
export function resolveUploadSourceInProgressListStateKey(
  r: Record<string, unknown> | null | undefined,
): string {
  if (isDesktopDirectUploadChannel(r)) return 'uploading';
  return 'syncing';
}
