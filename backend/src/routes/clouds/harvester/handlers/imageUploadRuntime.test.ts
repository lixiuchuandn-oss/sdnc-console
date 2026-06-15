import { Readable } from 'stream';

import {
  attachImageUploadProxyRun,
  destroyImageUploadBodyReadable,
  hasImageUploadProxyRun,
  isUploadTaskTransferInFlight,
  queueDeferredImageUploadCleanup,
  registerImageUploadProxyEnd,
  registerImageUploadProxyStart,
  resetImageUploadRuntimeForTests,
  takeDeferredImageUploadCleanupPaths,
  trackImageUploadBodyReadable,
  waitForImageUploadProxyIdle,
} from './imageUploadRuntime';

describe('imageUploadRuntime', () => {
  afterEach(() => {
    resetImageUploadRuntimeForTests();
  });

  it('queueDeferredImageUploadCleanup deduplicates paths', () => {
    queueDeferredImageUploadCleanup('t1', ['/data/a.merged', '/data/a.merged']);
    queueDeferredImageUploadCleanup('t1', ['/data/b.merged']);
    expect(takeDeferredImageUploadCleanupPaths('t1').sort()).toEqual([
      '/data/a.merged',
      '/data/b.merged',
    ]);
    expect(takeDeferredImageUploadCleanupPaths('t1')).toEqual([]);
  });

  it('waitForImageUploadProxyIdle resolves when proxy run finishes', async () => {
    let resolveRun!: () => void;
    const run = new Promise<void>((resolve) => {
      resolveRun = resolve;
    });
    attachImageUploadProxyRun('t2', run);
    const waiting = waitForImageUploadProxyIdle('t2', 5_000);
    resolveRun();
    await expect(waiting).resolves.toBe(true);
  });

  it('waitForImageUploadProxyIdle returns false on timeout', async () => {
    jest.useFakeTimers();
    attachImageUploadProxyRun(
      't3',
      new Promise<void>(() => {
        /* never settles */
      }),
    );
    const waiting = waitForImageUploadProxyIdle('t3', 20);
    await jest.advanceTimersByTimeAsync(25);
    await expect(waiting).resolves.toBe(false);
    jest.useRealTimers();
  });

  it('trackImageUploadBodyReadable destroys previous stream when replaced', () => {
    const first = new Readable({ read() {} });
    const second = new Readable({ read() {} });
    const destroySpy = jest.spyOn(first, 'destroy');

    trackImageUploadBodyReadable('t4', first);
    trackImageUploadBodyReadable('t4', second);

    expect(destroySpy).toHaveBeenCalled();
    destroyImageUploadBodyReadable('t4');
    expect(second.destroyed).toBe(true);
  });

  it('registerImageUploadProxyEnd clears in-flight flag', () => {
    registerImageUploadProxyStart('cloud-1', 't5');
    expect(isUploadTaskTransferInFlight('t5')).toBe(true);
    registerImageUploadProxyEnd('cloud-1', 't5');
    expect(isUploadTaskTransferInFlight('t5')).toBe(false);
  });

  it('hasImageUploadProxyRun tracks attachImageUploadProxyRun', async () => {
    expect(hasImageUploadProxyRun('t6')).toBe(false);
    const run = Promise.resolve();
    attachImageUploadProxyRun('t6', run);
    expect(hasImageUploadProxyRun('t6')).toBe(true);
    await run;
    await new Promise((r) => setImmediate(r));
    expect(hasImageUploadProxyRun('t6')).toBe(false);
  });
});
