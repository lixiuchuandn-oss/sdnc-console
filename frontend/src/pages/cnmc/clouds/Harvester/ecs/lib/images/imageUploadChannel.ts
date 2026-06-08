import type { ImageListRecord } from '../imagesSectionUtils';

export const IMAGE_UPLOAD_CHANNEL_ANNOTATION = 'compute-tower.io/upload-channel';
export const IMAGE_UPLOAD_CHANNEL_DESKTOP = 'desktop-uploader';
export const IMAGE_UPLOAD_CHANNEL_TOWER_CHUNKED = 'tower-chunked';

export function readImageUploadChannel(r: ImageListRecord | null | undefined): string {
  const meta = r?.metadata as Record<string, unknown> | undefined;
  const ann =
    (meta?.annotations as Record<string, unknown> | undefined) ??
    (r?.annotations as Record<string, unknown> | undefined);
  return String(ann?.[IMAGE_UPLOAD_CHANNEL_ANNOTATION] || '')
    .trim()
    .toLowerCase();
}

/** Windows 客户端直传（创建镜像时写入 desktop-uploader 注解） */
export function isDesktopDirectUploadImageRowStandalone(r: ImageListRecord): boolean {
  return readImageUploadChannel(r) === IMAGE_UPLOAD_CHANNEL_DESKTOP;
}

export function resolveUploadSourceInProgressListStateKey(r: ImageListRecord): string {
  return isDesktopDirectUploadImageRowStandalone(r) ? 'uploading' : 'syncing';
}

export function imageRowBlocksUploadTaskMatch(r: ImageListRecord): boolean {
  return readImageUploadChannel(r) === IMAGE_UPLOAD_CHANNEL_DESKTOP;
}
