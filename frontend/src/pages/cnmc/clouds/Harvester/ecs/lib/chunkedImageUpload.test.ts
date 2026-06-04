import {
  getChunkUploadErrorMessage,
  isLocalSourceFileNotReadableError,
  isResumeUploadFileMismatchError,
  LOCAL_SOURCE_FILE_RESUME_HINT,
  stripTowerUploadLocalOverlay,
} from './chunkedImageUpload';

describe('isLocalSourceFileNotReadableError', () => {
  it('detects NotReadableError by name', () => {
    expect(
      isLocalSourceFileNotReadableError(new DOMException('x', 'NotReadableError')),
    ).toBe(true);
  });

  it('detects Chromium english message', () => {
    expect(
      isLocalSourceFileNotReadableError(
        new Error(
          'The requested file could not be read, typically due to permission problems that have occurred after a reference to a file was acquired.',
        ),
      ),
    ).toBe(true);
  });

  it('returns false for generic errors', () => {
    expect(isLocalSourceFileNotReadableError(new Error('network error'))).toBe(false);
  });
});

describe('getChunkUploadErrorMessage', () => {
  it('maps local file read failure to resume hint', () => {
    expect(
      getChunkUploadErrorMessage(new DOMException('x', 'NotReadableError'), '分片上传失败'),
    ).toBe(LOCAL_SOURCE_FILE_RESUME_HINT);
  });
});

describe('isResumeUploadFileMismatchError', () => {
  it('detects file size mismatch message', () => {
    expect(
      isResumeUploadFileMismatchError(
        new Error('文件大小与任务不一致（任务 100 字节，当前文件 99 字节），请选择同一文件续传'),
      ),
    ).toBe(true);
  });
});

describe('stripTowerUploadLocalOverlay', () => {
  it('removes parallel upload overlay fields', () => {
    const stripped = stripTowerUploadLocalOverlay({
      id: 't1',
      status: 'ingesting',
      __towerUploadPhase: 'uploading',
      __towerUploadChunkIndex: 3,
      __towerUploadInFlightIndices: [3, 4],
    } as any);
    expect(stripped).toEqual({ id: 't1', status: 'ingesting' });
  });
});
