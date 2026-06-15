import { ImageUploadTask } from '../../../../../entities/harvester/ImageUploadTask';
import { isUploadTaskDeleteBlockedByPolicy } from './imageUploadTask.access';

describe('imageUploadTask.access', () => {
  it('isUploadTaskDeleteBlockedByPolicy blocks active upload lifecycle states', () => {
    for (const status of ['pending', 'ingesting', 'uploaded', 'proxying', 'failed']) {
      expect(isUploadTaskDeleteBlockedByPolicy({ taskStatus: status } as ImageUploadTask)).toBe(
        true,
      );
    }
    expect(isUploadTaskDeleteBlockedByPolicy({ taskStatus: 'success' } as ImageUploadTask)).toBe(
      false,
    );
    expect(isUploadTaskDeleteBlockedByPolicy({ taskStatus: 'cancelled' } as ImageUploadTask)).toBe(
      false,
    );
  });
});
