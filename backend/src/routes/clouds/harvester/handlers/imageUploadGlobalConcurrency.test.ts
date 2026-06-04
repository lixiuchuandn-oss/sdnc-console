import {
  formatGlobalImageUploadBusyMessage,
  GlobalImageUploadBusyError,
} from './imageUploadGlobalConcurrency';

describe('imageUploadGlobalConcurrency', () => {
  it('formatGlobalImageUploadBusyMessage distinguishes upload and sync', () => {
    const task = { id: 't1', displayName: 'openEuler', filename: 'a.qcow2' };
    expect(formatGlobalImageUploadBusyMessage('upload', task)).toContain('上传');
    expect(formatGlobalImageUploadBusyMessage('sync', task)).toContain('同步');
    expect(formatGlobalImageUploadBusyMessage('upload', task)).toContain('openEuler');
  });

  it('GlobalImageUploadBusyError exposes code and busy task', () => {
    const err = new GlobalImageUploadBusyError('sync', {
      id: 't2',
      cloudId: 'cloud-1',
      displayName: 'centos',
      filename: '',
      taskStatus: 'proxying',
    });
    expect(err.code).toBe('IMAGE_UPLOAD_GLOBAL_BUSY');
    expect(err.busyKind).toBe('sync');
    expect(err.message).toContain('centos');
  });
});
