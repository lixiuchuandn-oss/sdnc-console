import { In } from 'typeorm';

import { AppDataSource } from '../../../../../config/database';
import { ImageDownloadTask } from '../../../../../entities/harvester/ImageDownloadTask';

export const MAX_CONCURRENT_IMAGE_DOWNLOAD_TASKS = 3;

export const IMAGE_DOWNLOAD_CONCURRENCY_LIMIT_MESSAGE =
  '超出最大下载数量范围，请稍后重试';

const ACTIVE_DOWNLOAD_STATUSES = ['pending', 'fetching'] as const;

export async function countActiveImageDownloadTasks(cloudId: string): Promise<number> {
  const repo = AppDataSource.getRepository(ImageDownloadTask);
  return repo.count({
    where: {
      cloudId,
      taskStatus: In([...ACTIVE_DOWNLOAD_STATUSES]),
    },
  });
}

export async function assertImageDownloadConcurrencyAllowed(cloudId: string): Promise<void> {
  const active = await countActiveImageDownloadTasks(cloudId);
  if (active >= MAX_CONCURRENT_IMAGE_DOWNLOAD_TASKS) {
    throw new ImageDownloadConcurrencyLimitError(active);
  }
}

export class ImageDownloadConcurrencyLimitError extends Error {
  readonly code = 'IMAGE_DOWNLOAD_CONCURRENCY_LIMIT';

  constructor(public readonly activeCount: number) {
    super(IMAGE_DOWNLOAD_CONCURRENCY_LIMIT_MESSAGE);
    this.name = 'ImageDownloadConcurrencyLimitError';
  }
}

export function isImageDownloadConcurrencyLimitError(
  e: unknown,
): e is ImageDownloadConcurrencyLimitError {
  return e instanceof ImageDownloadConcurrencyLimitError;
}
