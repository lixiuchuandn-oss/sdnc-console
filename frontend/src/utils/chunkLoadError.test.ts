import { isChunkLoadError, tryAutoReloadOnChunkError } from './chunkLoadError';

describe('chunkLoadError', () => {
  it('detects webpack chunk load failures', () => {
    expect(isChunkLoadError(new Error('Loading chunk 3805 failed.'))).toBe(true);
    expect(isChunkLoadError(new Error('ChunkLoadError: foo'))).toBe(true);
    expect(isChunkLoadError(new Error('Failed to fetch dynamically imported module'))).toBe(true);
    expect(isChunkLoadError(new Error('something else'))).toBe(false);
  });

  it('tryAutoReloadOnChunkError reloads once per session', () => {
    const reload = jest.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { reload },
    });
    sessionStorage.clear();
    expect(
      tryAutoReloadOnChunkError(new Error('Loading chunk 1 failed.')),
    ).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(
      tryAutoReloadOnChunkError(new Error('Loading chunk 1 failed.')),
    ).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
