import path from 'path';

import { ImageUploadTask } from '../../../../../entities/harvester/ImageUploadTask';
import { collectImageUploadTaskFilePaths } from './imageUploadTask.staging';

describe('imageUploadTask.staging', () => {
  it('collectImageUploadTaskFilePaths includes rel path and default merged file', () => {
    const task = {
      id: 'task-abc',
      localFileRelPath: 'custom/task-abc.bin',
    } as ImageUploadTask;
    const { legacyChunkDir, mergedAbsPaths } = collectImageUploadTaskFilePaths(task);
    expect(legacyChunkDir).toContain(path.join('chunks', 'task-abc'));
    expect(mergedAbsPaths.some((p) => p.endsWith(path.join('custom', 'task-abc.bin')))).toBe(true);
    expect(mergedAbsPaths.some((p) => p.endsWith('task-abc.merged'))).toBe(true);
  });
});
