import {
  formatGlobalImageUploadBusyMessage,
  GlobalImageUploadBusyError,
  requestDeclaresLocalChunkedUpload,
} from './imageUploadGlobalConcurrency';

describe('imageUploadGlobalConcurrency', () => {
  it('formatGlobalImageUploadBusyMessage uses unified limit message', () => {
    const task = { id: 't1', displayName: 'openEuler', filename: 'a.qcow2' };
    const expected = '镜像上传进行中的任务已达到上限，请稍后再试';
    expect(formatGlobalImageUploadBusyMessage('upload', task)).toBe(expected);
    expect(formatGlobalImageUploadBusyMessage('sync', task)).toBe(expected);
  });

  it('requestDeclaresLocalChunkedUpload true only when chunkSize is provided', () => {
    expect(requestDeclaresLocalChunkedUpload({ fileSize: 1024, chunkSize: 8 * 1024 * 1024 })).toBe(
      true,
    );
    expect(requestDeclaresLocalChunkedUpload({ fileSize: 1024 })).toBe(false);
    expect(requestDeclaresLocalChunkedUpload(undefined)).toBe(false);
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
    expect(err.message).toBe('镜像上传进行中的任务已达到上限，请稍后再试');
  });
});
