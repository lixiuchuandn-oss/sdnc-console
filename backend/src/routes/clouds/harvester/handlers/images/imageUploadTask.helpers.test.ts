import { clampProgress, isUploadTaskProxyingStale } from './imageUploadTask.helpers';
import { ImageUploadTask } from '../../../../../entities/harvester/ImageUploadTask';

describe('imageUploadTask.helpers', () => {
  it('clampProgress bounds to 0-100 integers', () => {
    expect(clampProgress(-5)).toBe(0);
    expect(clampProgress(50.4)).toBe(50);
    expect(clampProgress(150)).toBe(100);
    expect(clampProgress(Number.NaN)).toBe(0);
  });

  it('isUploadTaskProxyingStale is false for non-proxying status', () => {
    const task = { id: 't1', taskStatus: 'uploaded', progress: 0, proxyProgress: 0 } as ImageUploadTask;
    expect(isUploadTaskProxyingStale(task)).toBe(false);
  });
});
