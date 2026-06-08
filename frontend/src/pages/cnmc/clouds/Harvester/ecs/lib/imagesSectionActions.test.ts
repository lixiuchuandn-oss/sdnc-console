import {
  applyUploadTaskToListState,
  assessImageDeleteBlockedByVms,
  getImageRowDeleteBlockedMessage,
  formatImageUploadTaskChunkLine,
  imageTypeFieldsFromUploadTask,
  filterImageListAfterDelete,
  formatHarvesterImageDeleteError,
  getImageBatchDeleteLabel,
  getImageNsNameKey,
  isImageDeleteInUseHttpError,
  mapBatchImageDelete,
  getUploadDrawerDisplayStatus,
  getUploadTaskDeleteBlockedMessage,
  isUploadTaskDeleteBlocked,
  isTowerImageIngestComplete,
  shouldHideSupersededTowerUploadInventoryRow,
  canShowTowerUploadSyncAction,
  enrichImageRowSizeFromUploadTask,
  isImageListFailedSyncRow,
  isImageListTowerUploadDeleteRow,
  isLocalUploadImageRow,
  shouldDeleteClusterImageForLocalUploadRow,
  mergeUploadTasksSorted,
  mergeUploadTasksIntoImageList,
  planImageListProgressPoll,
  resolveImageListDisplayProgress,
  resolveImageDeleteSuccessMessage,
  resolveLinkedUploadTaskId,
  resolveLinkedUploadTaskIdsForDelete,
  parseTowerUploadVirtualTaskIdFromRow,
  mergeUploadTasksForLookup,
  selectImagesByRowKeys,
  summarizeBatchImageDeleteMessage,
} from './imagesSectionActions';
import { resolveImageListStateKey } from './vmImageStatus';
import { getImageActualFileBytes, getImageRowId } from './imagesSectionUtils';

describe('imagesSectionActions', () => {
  const img = { metadata: { name: 'img-a', namespace: 'ns1' }, displayName: 'Alpha' };

  it('getImageNsNameKey', () => {
    expect(getImageNsNameKey(img)).toBe('ns1/img-a');
  });

  it('selectImagesByRowKeys', () => {
    const rows = selectImagesByRowKeys([img, { metadata: { name: 'b' } }], ['img-a']);
    expect(rows).toHaveLength(1);
  });

  it('selectImagesByRowKeys resolves virtual rows by task id', () => {
    const virtual = {
      __towerUploadVirtual: true,
      __towerUploadTaskId: 'task-abc',
      metadata: { name: 'tower-upload-task-abc', namespace: 'ns1' },
    };
    const rows = selectImagesByRowKeys([virtual as any], ['task-abc']);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toBe(virtual);
  });

  it('getImageBatchDeleteLabel prefers alias', () => {
    expect(getImageBatchDeleteLabel(img)).toBe('Alpha (img-a)');
  });

  it('isImageDeleteInUseHttpError detects 422 and volume in use', () => {
    expect(isImageDeleteInUseHttpError({ status: 422 })).toBe(true);
    expect(isImageDeleteInUseHttpError({ message: 'in use' })).toBe(true);
    expect(
      isImageDeleteInUseHttpError({
        message: 'being used by volume test/pvc-1',
      }),
    ).toBe(true);
  });

  it('formatHarvesterImageDeleteError translates volume in use webhook', () => {
    expect(
      formatHarvesterImageDeleteError({
        message:
          '删除镜像失败: 请求无法处理：admission webhook "validator.harvesterhci.io" denied the request: Cannot delete image default/ubuntu_4_0_20.04_x86_1000G: being used by volume test/id-vm-97v0gg392o6-disk-maxzdh-f09wq',
      }),
    ).toBe('镜像仍被虚拟机「id-vm-97v0gg392o6」使用，无法删除');
  });

  it('formatHarvesterImageDeleteError translates webhook without delete prefix', () => {
    expect(
      formatHarvesterImageDeleteError({
        message:
          '请求无法处理：admission webhook "validator.harvesterhci.io" denied the request: Cannot delete image default/re: being used by volume test/id-vm-jyhaxe2mmpo-disk-r058op-z7ipa',
      }),
    ).toBe('镜像仍被虚拟机「id-vm-jyhaxe2mmpo」使用，无法删除');
  });

  it('formatHarvesterImageDeleteError keeps vm name when message already translated', () => {
    expect(
      formatHarvesterImageDeleteError({
        message: '镜像仍被虚拟机「id-vm-jyhaxe2mmpo」使用，无法删除',
        status: 422,
      }),
    ).toBe('镜像仍被虚拟机「id-vm-jyhaxe2mmpo」使用，无法删除');
  });

  it('formatHarvesterImageDeleteError parses vm from responseData when message is generic', () => {
    expect(
      formatHarvesterImageDeleteError(
        {
          message: '镜像仍被虚拟机使用，无法删除',
          status: 422,
          responseData: {
            message:
              '请求无法处理：admission webhook "validator.harvesterhci.io" denied the request: Cannot delete image default/re: being used by volume test/id-vm-jyhaxe2mmpo-disk-r058op-z7ipa',
          },
        },
        { vms: [] },
      ),
    ).toBe('镜像仍被虚拟机「id-vm-jyhaxe2mmpo」使用，无法删除');
  });

  it('formatHarvesterImageDeleteError prefers vm alias from inventory', () => {
    expect(
      formatHarvesterImageDeleteError(
        {
          message:
            'Cannot delete image default/img-a: being used by volume ns/pvc-vm-disk-ab12',
        },
        {
          vms: [
            {
              metadata: {
                namespace: 'ns',
                name: 'pvc-vm',
                annotations: { 'tower.io/alias': 'vm-ja8l-6ef9' },
              },
              spec: {
                template: {
                  spec: {
                    volumes: [{ persistentVolumeClaim: { claimName: 'pvc-vm-disk-ab12' } }],
                  },
                },
              },
            },
          ],
        },
      ),
    ).toBe('镜像仍被虚拟机「vm-ja8l-6ef9」使用，无法删除');
  });

  it('summarizeBatchImageDeleteMessage reports partial task delete failure', () => {
    const summary = summarizeBatchImageDeleteMessage(
      [{ ok: true, name: 'img-a', ns: 'ns1', id: 'img-a' }],
      { taskDeleteFailedCount: 1 },
    );
    expect(summary.success).toContain('删除成功');
    expect(summary.warning).toContain('上传任务记录删除失败');
  });

  it('summarizeBatchImageDeleteMessage', () => {
    const out = summarizeBatchImageDeleteMessage([
      { ok: true, name: 'a', ns: 'ns', id: 'a' },
      { ok: false, name: 'b', err: 'fail' },
    ]);
    expect(out.success).toContain('1');
    expect(out.error).toContain('b');
    expect(out.deletedKeys.has('ns/a')).toBe(true);
  });

  it('filterImageListAfterDelete', () => {
    const next = filterImageListAfterDelete(
      [img, { metadata: { name: 'keep', namespace: 'ns2' } }],
      new Set(['ns1/img-a']),
    );
    expect(next).toHaveLength(1);
  });

  it('imageTypeFieldsFromUploadTask maps iso/disk labels and diskFormat', () => {
    expect(
      imageTypeFieldsFromUploadTask({
        imageType: 'iso',
        filename: 'win.iso',
      } as any),
    ).toEqual({
      diskFormat: 'iso',
      labels: { 'harvesterhci.io/image-type': 'iso' },
      annotations: { 'harvesterhci.io/image-name': 'win.iso' },
    });
    expect(
      imageTypeFieldsFromUploadTask({
        imageType: 'disk',
        displayName: 'data',
      } as any).diskFormat,
    ).toBe('qcow2');
  });

  it('applyUploadTaskToListState merges success and signals inventory refresh', () => {
    const prev = [{ id: 't1', status: 'proxying' } as any];
    const { next, becameSuccess } = applyUploadTaskToListState(prev, {
      id: 't1',
      status: 'success',
    } as any);
    expect(next).toHaveLength(1);
    expect(next[0].status).toBe('success');
    expect(becameSuccess).toBe(true);
  });

  it('applyUploadTaskToListState refreshes on success when createdImageName is set', () => {
    const { becameSuccess } = applyUploadTaskToListState([], {
      id: 't9',
      status: 'success',
      createdImageName: 'img-abc',
    } as any);
    expect(becameSuccess).toBe(true);
  });

  it('applyUploadTaskToListState merges uploaded/proxying tasks', () => {
    const { next, becameSuccess } = applyUploadTaskToListState([], {
      id: 't2',
      status: 'uploaded',
      createdAt: '2024-01-01',
    } as any);
    expect(next).toHaveLength(1);
    expect(next[0].id).toBe('t2');
    expect(becameSuccess).toBe(false);
  });

  it('applyUploadTaskToListState removes cancelled tasks from image list overlay', () => {
    const prev = [{ id: 't3', status: 'proxying', proxyProgress: 40 } as any];
    const { next, becameSuccess } = applyUploadTaskToListState(prev, {
      id: 't3',
      status: 'cancelled',
      createdImageName: 'img-x',
      createdImageNamespace: 'ns1',
    } as any);
    expect(next).toHaveLength(0);
    expect(becameSuccess).toBe(false);
  });

  it('mergeUploadTasksIntoImageList only attaches taskId without overriding cluster state', () => {
    const images = [
      {
        metadata: { name: 'img-x', namespace: 'ns1' },
        spec: { sourceType: 'upload' },
        state: 'syncing',
        progress: 42,
        status: { progress: 42 },
      },
    ] as any[];
    const tasks = [
      {
        id: 'task-cancel',
        status: 'cancelled',
        createdImageName: 'img-x',
        createdImageNamespace: 'ns1',
        displayName: 'My ISO',
      },
    ] as any[];
    const merged = mergeUploadTasksIntoImageList(images, tasks);
    expect(merged).toHaveLength(1);
    expect(merged[0].__towerUploadTaskId).toBeUndefined();
    expect(merged[0].state).toBe('syncing');
    expect(resolveImageListStateKey(merged[0])).toBe('syncing');
  });

  it('mergeUploadTasksIntoImageList shows failed when cluster import failed but upload task cancelled', () => {
    const images = [
      {
        metadata: { name: 'image-v62dl', namespace: 'default' },
        spec: { sourceType: 'upload', displayName: 'fsc_2.1' },
        state: 'Failed',
        progress: 79,
        status: {
          progress: 79,
          conditions: [
            { type: 'Imported', status: 'False', message: 'Back-off pulling image', reason: 'ImportFailed' },
          ],
        },
      },
    ] as any[];
    const tasks = [
      {
        id: 'task-cancel-failed-cluster',
        status: 'cancelled',
        createdImageName: 'image-v62dl',
        createdImageNamespace: 'default',
      },
    ] as any[];
    const merged = mergeUploadTasksIntoImageList(images, tasks);
    expect(merged).toHaveLength(1);
    expect(resolveImageListStateKey(merged[0])).toBe('failed');
  });

  it('mergeUploadTasksIntoImageList keeps ready cluster row when upload task cancelled', () => {
    const images = [
      {
        metadata: { name: 'image-nhvw6', namespace: 'default' },
        state: 'Active',
        virtualSize: 8589934592,
        status: {
          progress: 100,
          size: 108593152,
          virtualSize: 8589934592,
          conditions: [{ type: 'Imported', status: 'True', reason: 'Imported' }],
        },
      },
    ] as any[];
    const tasks = [
      {
        id: 'task-cancel-done',
        status: 'cancelled',
        createdImageName: 'image-nhvw6',
        createdImageNamespace: 'default',
      },
    ] as any[];
    const merged = mergeUploadTasksIntoImageList(images, tasks);
    expect(resolveImageListStateKey(merged[0])).toBe('ready');
    expect(merged[0].state).toBe('Active');
  });

  it('resolveImageListStateKey prefers Imported over cancelled overlay state', () => {
    expect(
      resolveImageListStateKey({
        state: 'cancelled',
        status: { conditions: [{ type: 'Imported', status: 'True' }] },
      }),
    ).toBe('ready');
  });

  it('resolveImageListStateKey prefers Imported=False over cancelled overlay state', () => {
    expect(
      resolveImageListStateKey({
        state: 'cancelled',
        status: {
          conditions: [{ type: 'Imported', status: 'False', message: 'import failed' }],
        },
      }),
    ).toBe('failed');
  });

  it('mergeUploadTasksIntoImageList omits virtual row for cancelled ingest-only task', () => {
    const merged = mergeUploadTasksIntoImageList([], [
      {
        id: 'task-ingest-cancel',
        status: 'cancelled',
        namespace: 'ns1',
        displayName: 'Local ISO',
        filename: 'local.iso',
      },
    ] as any[]);
    expect(merged).toHaveLength(0);
  });

  it('mergeUploadTasksIntoImageList shows failed when task proxying but cluster import failed', () => {
    const merged = mergeUploadTasksIntoImageList(
      [
        {
          metadata: { name: 'img-x', namespace: 'ns1' },
          spec: { sourceType: 'upload' },
          state: 'Uploading',
          progress: 60,
          status: {
            progress: 60,
            conditions: [
              { type: 'Imported', status: 'False', reason: 'ImportFailed', message: 'cdi convert failed' },
            ],
          },
        },
      ] as any[],
      [
        {
          id: 'task-p',
          status: 'proxying',
          proxyProgress: 60,
          progress: 60,
          createdImageName: 'img-x',
          createdImageNamespace: 'ns1',
        },
      ] as any[],
    );
    expect(resolveImageListStateKey(merged[0])).toBe('failed');
  });

  it('mergeUploadTasksIntoImageList keeps cluster in-progress when task failed but cluster still importing', () => {
    const merged = mergeUploadTasksIntoImageList(
      [
        {
          metadata: { name: 'img-x', namespace: 'ns1' },
          spec: { sourceType: 'upload' },
          state: 'syncing',
          progress: 42,
          status: { progress: 42, conditions: [{ type: 'Imported', status: 'False' }] },
        },
      ] as any[],
      [
        {
          id: 'task-f',
          status: 'failed',
          ingestProgress: 100,
          createdImageName: 'img-x',
          createdImageNamespace: 'ns1',
          errorMessage: 'Harvester 上传失败 HTTP 504: Gateway Timeout',
        },
      ] as any[],
    );
    expect(resolveImageListStateKey(merged[0])).toBe('syncing');
    expect(canShowTowerUploadSyncAction(merged[0], [])).toBe(false);
  });

  it('mergeUploadTasksIntoImageList does not mask terminal cluster failure from task state', () => {
    const merged = mergeUploadTasksIntoImageList(
      [
        {
          metadata: { name: 'img-x', namespace: 'ns1' },
          spec: { sourceType: 'upload' },
          state: 'syncing',
          progress: 42,
          status: {
            progress: 42,
            conditions: [
              { type: 'Imported', status: 'False', reason: 'ImportFailed', message: 'cdi error' },
            ],
          },
        },
      ] as any[],
      [
        {
          id: 'task-f',
          status: 'failed',
          ingestProgress: 100,
          createdImageName: 'img-x',
          createdImageNamespace: 'ns1',
          errorMessage: 'Harvester 导入镜像失败',
        },
      ] as any[],
    );
    expect(resolveImageListStateKey(merged[0])).toBe('failed');
    expect(resolveImageListDisplayProgress(merged[0])).toBeNull();
    expect(
      canShowTowerUploadSyncAction(merged[0], [
        {
          id: 'task-f',
          status: 'failed',
          ingestProgress: 100,
          createdImageName: 'img-x',
          createdImageNamespace: 'ns1',
        },
      ] as any[]),
    ).toBe(true);
    expect(canShowTowerUploadSyncAction(merged[0], [])).toBe(false);
  });

  it('canShowTowerUploadSyncAction hides sync for ingest-only failed task', () => {
    const row = {
      __towerUploadVirtual: true,
      __towerUploadTaskId: 't-ingest',
      name: 'tower-upload-t-ingest',
      state: 'failed',
    } as any;
    expect(
      canShowTowerUploadSyncAction(
        row,
        [{ id: 't-ingest', status: 'failed', ingestProgress: 40 }] as any[],
      ),
    ).toBe(false);
    expect(
      canShowTowerUploadSyncAction(row, [{ id: 't-ingest', status: 'uploaded' }] as any[]),
    ).toBe(true);
  });

  it('mergeUploadTasksIntoImageList hides failed row when sync retry started without createdImageName', () => {
    const merged = mergeUploadTasksIntoImageList(
      [
        {
          metadata: { name: 'image-cjvvc', namespace: 'default' },
          __towerUploadTaskId: 'task-retry',
          spec: { sourceType: 'upload', displayName: 'OpenEuler-22.03-aarch64' },
          state: 'Failed',
          status: {
            conditions: [{ type: 'Imported', status: 'False', message: 'upload failed' }],
          },
        },
      ] as any[],
      [
        {
          id: 'task-retry',
          status: 'proxying',
          namespace: 'default',
          displayName: 'OpenEuler-22.03-aarch64',
        },
      ] as any[],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].__towerUploadVirtual).toBe(true);
    expect(resolveImageListStateKey(merged[0])).toBe('syncing');
  });

  it('mergeUploadTasksIntoImageList hides superseded failed row after sync retry', () => {
    const merged = mergeUploadTasksIntoImageList(
      [
        {
          metadata: { name: 'image-cjvvc', namespace: 'default' },
          spec: { sourceType: 'upload', displayName: 'OpenEuler-22.03-aarch64' },
          state: 'Failed',
          status: {
            conditions: [{ type: 'Imported', status: 'False', message: 'upload failed' }],
          },
        },
        {
          metadata: { name: 'image-59j9k', namespace: 'default' },
          spec: { sourceType: 'upload', displayName: 'OpenEuler-22.03-aarch64' },
          state: 'Active',
          progress: 12,
          status: { progress: 12 },
        },
      ] as any[],
      [
        {
          id: 'task-retry',
          status: 'proxying',
          createdImageName: 'image-59j9k',
          createdImageNamespace: 'default',
          displayName: 'OpenEuler-22.03-aarch64',
        },
      ] as any[],
    );
    expect(merged).toHaveLength(1);
    expect(getImageRowId(merged[0])).toBe('image-59j9k');
    expect(
      shouldHideSupersededTowerUploadInventoryRow(
        {
          metadata: { name: 'image-cjvvc', namespace: 'default' },
          spec: { sourceType: 'upload', displayName: 'OpenEuler-22.03-aarch64' },
        } as any,
        [
          {
            id: 'task-retry',
            status: 'proxying',
            createdImageName: 'image-59j9k',
            createdImageNamespace: 'default',
            displayName: 'OpenEuler-22.03-aarch64',
          },
        ] as any[],
      ),
    ).toBe(true);
  });

  it('planImageListProgressPoll keeps inventory poll when Imported=False is transient', () => {
    const tasks = [{ id: 't1', status: 'proxying', createdImageName: 'img-a', createdImageNamespace: 'ns1' }] as any[];
    const images = [
      {
        metadata: { name: 'img-a', namespace: 'ns1' },
        status: { progress: 42, conditions: [{ type: 'Imported', status: 'False', message: 'failed' }] },
      },
    ] as any[];
    expect(planImageListProgressPoll(tasks, images)).toEqual({
      pollUploadTasks: true,
      pollInventory: true,
    });
  });

  it('planImageListProgressPoll stops polling only for terminal cluster import failure', () => {
    expect(
      planImageListProgressPoll(
        [{ id: 't1', status: 'failed', createdImageName: 'img-a', createdImageNamespace: 'ns1' }] as any[],
        [
          {
            metadata: { name: 'img-a', namespace: 'ns1' },
            status: {
              conditions: [{ type: 'Imported', status: 'False', reason: 'ImportFailed', message: 'import failed' }],
            },
          },
        ] as any[],
      ),
    ).toEqual({ pollUploadTasks: false, pollInventory: false });
  });

  it('planImageListProgressPoll keeps polling for false failed upload task', () => {
    expect(
      planImageListProgressPoll(
        [{ id: 't1', status: 'failed', createdImageName: 'img-a', createdImageNamespace: 'ns1' }] as any[],
        [
          {
            metadata: { name: 'img-a', namespace: 'ns1' },
            status: { progress: 55, conditions: [{ type: 'Imported', status: 'False' }] },
          },
        ] as any[],
      ),
    ).toEqual({ pollUploadTasks: true, pollInventory: true });
  });

  it('planImageListProgressPoll keeps inventory poll during active proxying', () => {
    const tasks = [{ id: 't1', status: 'proxying', createdImageName: 'img-a', createdImageNamespace: 'ns1' }] as any[];
    const images = [
      {
        metadata: { name: 'img-a', namespace: 'ns1' },
        state: 'syncing',
        progress: 10,
        status: { progress: 10 },
      },
    ] as any[];
    expect(planImageListProgressPoll(tasks, images)).toEqual({
      pollUploadTasks: true,
      pollInventory: true,
    });
  });

  it('mergeUploadTasksSorted merges by id', () => {
    const merged = mergeUploadTasksSorted(
      [{ id: '1', status: 'pending', createdAt: '2024-01-01' } as any],
      { id: '2', status: 'success', createdAt: '2024-02-01' } as any,
    );
    expect(merged.map((x) => x.id)).toEqual(['2', '1']);
  });

  it('mergeUploadTasksSorted keeps higher ingest progress on poll regression', () => {
    const merged = mergeUploadTasksSorted(
      [
        {
          id: 't1',
          status: 'ingesting',
          ingestProgress: 50,
          updatedAt: '2026-06-02T11:00:00Z',
        } as any,
      ],
      {
        id: 't1',
        status: 'ingesting',
        ingestProgress: 0,
        updatedAt: '2026-06-02T11:00:03Z',
      } as any,
    );
    expect(merged[0].ingestProgress).toBe(50);
  });

  it('mergeUploadTasksSorted prefers proxying over uploaded after sync click', () => {
    const merged = mergeUploadTasksSorted(
      [
        {
          id: 't1',
          status: 'uploaded',
          progress: 100,
          ingestProgress: 100,
          updatedAt: '2026-06-02T11:00:00Z',
        } as any,
      ],
      {
        id: 't1',
        status: 'proxying',
        progress: 0,
        proxyProgress: 0,
        updatedAt: '2026-06-02T11:00:01Z',
      } as any,
    );
    expect(merged[0].status).toBe('proxying');
  });

  it('mergeUploadTasksSorted keeps higher proxy progress on poll regression', () => {
    const merged = mergeUploadTasksSorted(
      [{ id: 't1', status: 'proxying', proxyProgress: 99, updatedAt: '2026-06-02T11:00:00Z' } as any],
      { id: 't1', status: 'proxying', proxyProgress: 0, updatedAt: '2026-06-02T11:00:03Z' } as any,
    );
    expect(merged[0].proxyProgress).toBe(99);
  });

  it('resolveImageListDisplayProgress shows 100 for ready images', () => {
    expect(
      resolveImageListDisplayProgress({
        status: { conditions: [{ type: 'Imported', status: 'True' }], progress: 100, size: 5000 },
      }),
    ).toBe(100);
  });

  it('resolveImageListDisplayProgress shows dash until cluster reports progress', () => {
    expect(
      resolveImageListDisplayProgress({
        state: 'syncing',
        progress: 0,
        status: { progress: 0 },
      }),
    ).toBeNull();
    expect(
      resolveImageListDisplayProgress({
        state: 'syncing',
        progress: 42,
        status: { progress: 42 },
      }),
    ).toBe(42);
    expect(
      resolveImageListDisplayProgress({
        state: 'pending_sync',
        progress: 0,
      }),
    ).toBeNull();
  });

  it('resolveImageListDisplayProgress prefers cluster progress over stale row progress', () => {
    expect(
      resolveImageListDisplayProgress({
        state: 'syncing',
        progress: 100,
        status: { progress: 21 },
        sourceType: 'upload',
      }),
    ).toBe(21);
  });

  it('mapBatchImageDelete aggregates results', async () => {
    const results = await mapBatchImageDelete([img], async () => {});
    expect(results[0].ok).toBe(true);
  });

  it('formatImageUploadTaskChunkLine shows parallel in-flight indices', () => {
    expect(
      formatImageUploadTaskChunkLine(
        {
          status: 'ingesting',
          totalChunks: 74,
          receivedChunks: Array.from({ length: 69 }, (_, i) => i),
          __towerUploadInFlightIndices: [68, 69, 70, 71],
        } as any,
        { isRunning: true },
      ),
    ).toBe('分片 69/74（并行上传第 70、71、72 片）');
  });

  it('formatImageUploadTaskChunkLine ignores stale chunk index already received', () => {
    expect(
      formatImageUploadTaskChunkLine(
        {
          status: 'ingesting',
          totalChunks: 74,
          receivedChunks: Array.from({ length: 69 }, (_, i) => i),
          __towerUploadChunkIndex: 13,
        } as any,
        { isRunning: true },
      ),
    ).toBe('分片 69/74（并行上传中）');
  });

  it('resolveImageListStateKey treats syncing at 100% as ready when cluster import complete', () => {
    expect(
      resolveImageListStateKey({
        state: 'syncing',
        progress: 100,
        status: { progress: 100, size: 5000 },
      }),
    ).toBe('ready');
  });

  it('resolveImageListStateKey stays syncing for tower-chunked upload at cluster progress 21', () => {
    expect(
      resolveImageListStateKey({
        state: 'Active',
        sourceType: 'upload',
        metadata: {
          annotations: { 'compute-tower.io/upload-channel': 'tower-chunked' },
        },
        status: { progress: 21, size: 1000 },
      }),
    ).toBe('syncing');
  });

  it('resolveImageListStateKey shows uploading for desktop direct upload in progress', () => {
    expect(
      resolveImageListStateKey({
        state: 'Active',
        sourceType: 'upload',
        metadata: {
          annotations: { 'compute-tower.io/upload-channel': 'desktop-uploader' },
        },
        status: { progress: 21, size: 1000 },
      }),
    ).toBe('uploading');
  });

  it('canShowTowerUploadSyncAction hides sync for failed desktop direct upload', () => {
    const row = {
      metadata: {
        name: 'img-desktop-fail',
        namespace: 'default',
        annotations: { 'compute-tower.io/upload-channel': 'desktop-uploader' },
      },
      spec: { sourceType: 'upload' },
      status: {
        progress: 12,
        conditions: [{ type: 'Imported', status: 'False', reason: 'UploadFailed' }],
      },
    } as any;
    expect(resolveImageListStateKey(row)).toBe('failed');
    expect(canShowTowerUploadSyncAction(row, [])).toBe(false);
  });

  it('canShowTowerUploadSyncAction shows sync for failed tower-chunked upload with task', () => {
    const row = {
      metadata: {
        name: 'img-browser-fail',
        namespace: 'default',
        annotations: { 'compute-tower.io/upload-channel': 'tower-chunked' },
      },
      spec: { sourceType: 'upload' },
      __towerUploadTaskId: 'task-browser-1',
      status: {
        progress: 12,
        conditions: [{ type: 'Imported', status: 'False', reason: 'UploadFailed' }],
      },
    } as any;
    const tasks = [
      {
        id: 'task-browser-1',
        status: 'failed',
        ingestProgress: 100,
        createdImageName: 'img-browser-fail',
        createdImageNamespace: 'default',
      },
    ] as any[];
    expect(resolveImageListStateKey(row)).toBe('failed');
    expect(canShowTowerUploadSyncAction(row, tasks)).toBe(true);
  });

  it('mergeUploadTasksIntoImageList hides virtual row when cluster ready but task still proxying', () => {
    const merged = mergeUploadTasksIntoImageList(
      [
        {
          metadata: { name: 'image-7rmdv', namespace: 'default' },
          spec: { sourceType: 'upload', displayName: 'fw_2_1_GRSZ-FW-V8.0_x86_240325' },
          state: 'Active',
          status: {
            progress: 100,
            size: 100000000,
            virtualSize: 8589934592,
            conditions: [{ type: 'Imported', status: 'True' }],
          },
        },
      ] as any[],
      [
        {
          id: 'ad225731-4762-4bc8-8e16-e79eac9b18ef',
          status: 'proxying',
          namespace: 'default',
          displayName: 'fw_2_1_GRSZ-FW-V8.0_x86_240325',
        },
      ] as any[],
    );
    expect(merged).toHaveLength(1);
    expect(getImageRowId(merged[0])).toBe('image-7rmdv');
    expect(merged[0].__towerUploadVirtual).toBeFalsy();
    expect(resolveImageListStateKey(merged[0])).toBe('ready');
  });

  it('enrichImageRowSizeFromUploadTask keeps sparse fileSize after upload task success', () => {
    const virtual = 300 * 1024 ** 3;
    const file = 11 * 1024 ** 3;
    const merged = mergeUploadTasksIntoImageList(
      [
        {
          metadata: { name: 'image-g95gh', namespace: 'default' },
          spec: { sourceType: 'upload', displayName: '05444' },
          status: { size: virtual, virtualSize: virtual, progress: 100 },
          storageClassName: 'ceph-new',
        },
      ] as any[],
      [
        {
          id: 'task-ceph',
          status: 'success',
          namespace: 'default',
          createdImageName: 'image-g95gh',
          createdImageNamespace: 'default',
          displayName: '05444',
          fileSize: file,
          virtualSizeBytes: virtual,
        },
      ] as any[],
    );
    expect(getImageActualFileBytes(merged[0])).toBe(file);
  });

  it('enrichImageRowSizeFromUploadTask prefers sparse fileSize over ceph PVC virtual capacity', () => {
    const virtual = 300 * 1024 ** 3;
    const file = 11 * 1024 ** 3;
    const row = enrichImageRowSizeFromUploadTask(
      {
        sourceType: 'upload',
        status: { size: virtual, virtualSize: virtual, progress: 3 },
        storageClassName: 'ceph-new',
      },
      {
        id: 'task-1',
        status: 'proxying',
        fileSize: file,
        virtualSizeBytes: virtual,
      } as any,
    );
    expect(getImageActualFileBytes(row)).toBe(file);
  });

  it('mergeUploadTasksIntoImageList merges proxying task onto cluster row before createdImageName arrives', () => {
    const merged = mergeUploadTasksIntoImageList(
      [
        {
          metadata: { name: 'image-8grbh', namespace: 'default' },
          spec: { sourceType: 'upload', displayName: 'fw' },
          state: 'Uploading',
          status: { progress: 12, size: 1000 },
        },
      ] as any[],
      [
        {
          id: 'task-fw',
          status: 'proxying',
          namespace: 'default',
          displayName: 'fw',
        },
      ] as any[],
    );
    expect(merged).toHaveLength(1);
    expect(getImageRowId(merged[0])).toBe('image-8grbh');
    expect(merged[0].__towerUploadVirtual).toBeFalsy();
    expect(merged[0].__towerUploadTaskId).toBe('task-fw');
    expect(resolveImageListStateKey(merged[0])).toBe('syncing');
  });

  it('mergeUploadTasksIntoImageList reflects cluster progress while proxying', () => {
    const merged = mergeUploadTasksIntoImageList(
      [
        {
          metadata: { name: 'image-7nm7g', namespace: 'default' },
          name: 'image-7nm7g',
          namespace: 'default',
          state: 'Uploading',
          spec: { sourceType: 'upload' },
          sourceType: 'upload',
          status: { progress: 21, size: 1000 },
        },
      ],
      [
        {
          id: 't1',
          status: 'proxying',
          createdImageName: 'image-7nm7g',
          createdImageNamespace: 'default',
        },
      ] as any,
    );
    expect(resolveImageListStateKey(merged[0])).toBe('syncing');
    expect(resolveImageListDisplayProgress(merged[0])).toBe(21);
  });

  it('resolveImageListStateKey keeps syncing at 99% when Imported=False is transient', () => {
    expect(
      resolveImageListStateKey({
        state: 'Failed',
        spec: { sourceType: 'upload' },
        progress: 99,
        status: {
          progress: 99,
          conditions: [{ type: 'Imported', status: 'False', reason: 'ImportFailed', message: 'import failed' }],
        },
      }),
    ).toBe('syncing');
  });

  it('resolveImageListStateKey keeps importing at 100% until Imported=True or size ready', () => {
    expect(
      resolveImageListStateKey({
        spec: { sourceType: 'download' },
        status: {
          progress: 100,
          conditions: [{ type: 'Imported', status: 'False', reason: 'Cancelled' }],
        },
      }),
    ).toBe('importing');
  });

  it('resolveImageListStateKey treats transient Imported=False as in-progress', () => {
    expect(
      resolveImageListStateKey({
        state: 'syncing',
        spec: { sourceType: 'upload' },
        status: {
          progress: 42,
          conditions: [{ type: 'Imported', status: 'False' }],
        },
      }),
    ).toBe('syncing');
  });

  it('assessImageDeleteBlockedByVms returns null when unused', () => {
    expect(assessImageDeleteBlockedByVms(img, [])).toBeNull();
  });

  it('assessImageDeleteBlockedByVms detects ceph vm via volumeClaimTemplates imageId', () => {
    const cephVm = {
      metadata: {
        namespace: 'ns1',
        name: 'vm-ceph-1',
        annotations: {
          'harvesterhci.io/volumeClaimTemplates': JSON.stringify([
            {
              metadata: {
                name: 'vm-ceph-1-disk-0-abc',
                annotations: { 'harvesterhci.io/imageId': 'ns1/img-a' },
              },
            },
          ]),
        },
      },
    };
    expect(assessImageDeleteBlockedByVms(img, [cephVm])).toContain('vm-ceph-1');
    expect(getImageRowDeleteBlockedMessage(img, [cephVm])).toContain('无法删除');
  });

  it('getImageRowDeleteBlockedMessage returns null when vm uses different image', () => {
    const otherVm = {
      metadata: {
        namespace: 'ns1',
        name: 'vm-other',
        annotations: {
          'harvesterhci.io/volumeClaimTemplates': JSON.stringify([
            {
              metadata: {
                name: 'vm-other-disk-0-abc',
                annotations: { 'harvesterhci.io/imageId': 'ns1/other-img' },
              },
            },
          ]),
        },
      },
    };
    expect(getImageRowDeleteBlockedMessage(img, [otherVm])).toBeNull();
  });

  it('isUploadTaskDeleteBlocked blocks uploaded, sync-phase and ingest states', () => {
    expect(isUploadTaskDeleteBlocked({ id: '1', status: 'uploaded' } as any)).toBe(true);
    expect(isUploadTaskDeleteBlocked({ id: '2', status: 'pending' } as any)).toBe(true);
    expect(isUploadTaskDeleteBlocked({ id: '3', status: 'ingesting' } as any)).toBe(true);
    expect(isUploadTaskDeleteBlocked({ id: '4', status: 'proxying' } as any)).toBe(true);
    expect(isUploadTaskDeleteBlocked({ id: '5', status: 'failed' } as any)).toBe(true);
    expect(isUploadTaskDeleteBlocked({ id: '6', status: 'success' } as any)).toBe(false);
    expect(isUploadTaskDeleteBlocked({ id: '7', status: 'cancelled' } as any)).toBe(false);
  });

  it('getUploadTaskDeleteBlockedMessage returns user-facing hints', () => {
    expect(getUploadTaskDeleteBlockedMessage({ id: '1', status: 'uploaded' } as any)).toContain(
      '镜像数据',
    );
    expect(getUploadTaskDeleteBlockedMessage({ id: '2', status: 'ingesting' } as any)).toContain(
      '分片上传',
    );
    expect(
      getUploadTaskDeleteBlockedMessage({ id: '3', status: 'proxying', ingestProgress: 100 } as any),
    ).toContain('镜像列表');
    expect(
      getUploadTaskDeleteBlockedMessage({ id: '4', status: 'failed', ingestProgress: 40 } as any),
    ).toContain('上传失败');
    expect(getUploadTaskDeleteBlockedMessage({ id: '5', status: 'success' } as any)).toBeNull();
  });

  it('resolveImageDeleteSuccessMessage reports task delete failure for local upload', () => {
    expect(
      resolveImageDeleteSuccessMessage({
        localUpload: true,
        deleteCluster: true,
        deletedTask: false,
        taskDeleteFailed: true,
      }),
    ).toContain('上传任务记录删除失败');
    expect(
      resolveImageDeleteSuccessMessage({
        localUpload: true,
        deleteCluster: true,
        deletedTask: true,
      }),
    ).toBe('镜像及上传任务已删除');
  });

  it('parseTowerUploadVirtualTaskIdFromRow extracts task id', () => {
    expect(
      parseTowerUploadVirtualTaskIdFromRow({
        name: 'tower-upload-abc-123',
        namespace: 'default',
      } as any),
    ).toBe('abc-123');
  });

  it('resolveLinkedUploadTaskIdsForDelete merges row marker and virtual name', async () => {
    const row = {
      name: 'tower-upload-task-1',
      namespace: 'default',
      spec: { sourceType: 'upload' },
      __towerUploadTaskId: 'task-2',
    } as any;
    const ids = await resolveLinkedUploadTaskIdsForDelete('cloud-1', row, [
      { id: 'task-2', status: 'success', namespace: 'default' } as any,
    ]);
    expect(ids.sort()).toEqual(['task-1', 'task-2'].sort());
  });

  it('shouldDeleteClusterImageForLocalUploadRow true for inventory upload row', () => {
    expect(
      shouldDeleteClusterImageForLocalUploadRow({
        name: 'image-abc',
        namespace: 'default',
        state: 'ready',
        spec: { sourceType: 'upload' },
      } as any),
    ).toBe(true);
  });

  it('mergeUploadTasksSorted keeps cancelled over stale ingesting local state', () => {
    const merged = mergeUploadTasksSorted(
      [
        {
          id: 't1',
          status: 'ingesting',
          receivedChunks: [0, 1, 2],
          totalChunks: 3,
          updatedAt: '2026-01-01T00:00:00Z',
        } as any,
      ],
      {
        id: 't1',
        status: 'cancelled',
        receivedChunks: [],
        progress: 0,
        ingestProgress: 0,
        updatedAt: '2026-01-01T00:01:00Z',
      } as any,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].status).toBe('cancelled');
    expect(merged[0].receivedChunks).toEqual([]);
  });

  it('mergeUploadTasksSorted keeps hard-cancelled over newer ingesting local overlay', () => {
    const merged = mergeUploadTasksSorted(
      [
        {
          id: 't1',
          status: 'ingesting',
          receivedChunks: [0, 1],
          totalChunks: 36,
          progress: 5.6,
          ingestProgress: 5.6,
          updatedAt: '2026-06-08T12:00:05Z',
        } as any,
      ],
      {
        id: 't1',
        status: 'cancelled',
        receivedChunks: [],
        progress: 0,
        ingestProgress: 0,
        updatedAt: '2026-06-08T12:00:00Z',
      } as any,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].status).toBe('cancelled');
    expect(merged[0].receivedChunks).toEqual([]);
  });

  it('resolveLinkedUploadTaskId prefers row marker then list match', () => {
    const row = {
      metadata: { name: 'img-a', namespace: 'ns1' },
      __towerUploadTaskId: 'task-row',
    };
    const tasks = [
      { id: 'task-list', createdImageName: 'img-a', createdImageNamespace: 'ns1' },
    ] as any[];
    expect(resolveLinkedUploadTaskId(row as any, tasks)).toBe('task-row');
    expect(
      resolveLinkedUploadTaskId({ metadata: { name: 'img-a', namespace: 'ns1' } } as any, tasks),
    ).toBe('task-list');
  });

  it('getUploadDrawerDisplayStatus only reflects Tower ingest not cluster sync', () => {
    expect(getUploadDrawerDisplayStatus({ id: '1', status: 'uploaded' } as any)).toBe('uploaded');
    expect(getUploadDrawerDisplayStatus({ id: '2', status: 'proxying', ingestProgress: 100 } as any)).toBe(
      'uploaded',
    );
    expect(getUploadDrawerDisplayStatus({ id: '3', status: 'success', ingestProgress: 100 } as any)).toBe(
      'uploaded',
    );
    expect(
      getUploadDrawerDisplayStatus({ id: '4', status: 'failed', ingestProgress: 100 } as any),
    ).toBe('uploaded');
    expect(getUploadDrawerDisplayStatus({ id: '5', status: 'ingesting' } as any)).toBe('ingesting');
    expect(
      getUploadDrawerDisplayStatus({ id: '6', status: 'failed', ingestProgress: 40 } as any),
    ).toBe('failed');
    expect(isTowerImageIngestComplete({ id: '7', status: 'proxying', ingestProgress: 100 } as any)).toBe(
      true,
    );
    expect(isTowerImageIngestComplete({ id: '8', status: 'uploaded' } as any)).toBe(true);
    expect(isTowerImageIngestComplete({ id: '9', status: 'ingesting', ingestProgress: 40 } as any)).toBe(
      false,
    );
  });

  it('planImageListProgressPoll always polls inventory during proxying even when row ready', () => {
    const row = {
      metadata: { name: 'image-a', namespace: 'default' },
      status: { conditions: [{ type: 'Imported', status: 'True' }], progress: 100 },
    };
    const plan = planImageListProgressPoll(
      [{ id: 't1', status: 'proxying', createdImageName: 'image-a', createdImageNamespace: 'default' }] as any[],
      [row as any],
    );
    expect(plan.pollUploadTasks).toBe(true);
    expect(plan.pollInventory).toBe(true);
  });

  it('resolveImageDeleteSuccessMessage reports partial delete outcomes', () => {
    expect(
      resolveImageDeleteSuccessMessage({
        localUpload: true,
        deleteCluster: true,
        deletedTask: false,
        taskDeleteFailed: true,
      }),
    ).toContain('上传任务记录删除失败');
    expect(
      resolveImageDeleteSuccessMessage({
        localUpload: true,
        deleteCluster: true,
        deletedTask: true,
        clusterNotFound: true,
      }),
    ).toContain('不存在或已删除');
  });

  it('isLocalUploadImageRow detects upload source and virtual rows', () => {
    expect(
      isLocalUploadImageRow({
        spec: { sourceType: 'upload' },
        metadata: { name: 'img-a', namespace: 'ns1' },
      } as any),
    ).toBe(true);
    expect(
      isLocalUploadImageRow({
        __towerUploadVirtual: true,
        __towerUploadTaskId: 't1',
        metadata: { name: 'tower-upload-t1' },
      } as any),
    ).toBe(true);
    expect(
      isLocalUploadImageRow({
        spec: { sourceType: 'download' },
        metadata: { name: 'img-b', namespace: 'ns1' },
      } as any),
    ).toBe(false);
  });

  it('shouldDeleteClusterImageForLocalUploadRow skips pending_sync staging rows', () => {
    expect(
      shouldDeleteClusterImageForLocalUploadRow({
        state: 'pending_sync',
        metadata: { name: 'tower-upload-t1' },
      } as any),
    ).toBe(false);
    expect(
      shouldDeleteClusterImageForLocalUploadRow({
        state: 'ready',
        metadata: { name: 'img-a', namespace: 'ns1' },
      } as any),
    ).toBe(true);
  });

  it('isImageListTowerUploadDeleteRow covers pending_sync and failed', () => {
    expect(
      isImageListTowerUploadDeleteRow({
        __towerUploadVirtual: true,
        state: 'pending_sync',
        metadata: { name: 'a' },
      } as any),
    ).toBe(true);
    expect(
      isImageListFailedSyncRow({
        metadata: { name: 'a' },
        status: {
          conditions: [{ type: 'Imported', status: 'False', reason: 'ImportFailed', message: 'x' }],
        },
      } as any),
    ).toBe(true);
    expect(
      isImageListTowerUploadDeleteRow({
        status: { conditions: [{ type: 'Imported', status: 'True' }] },
        metadata: { name: 'a' },
      } as any),
    ).toBe(false);
  });

  it('mergeUploadTasksSorted prefers proxying over failed after sync retry', () => {
    const merged = mergeUploadTasksSorted(
      [
        {
          id: 't1',
          status: 'failed',
          progress: 45,
          proxyProgress: 45,
          updatedAt: '2026-06-02T12:00:00Z',
        } as any,
      ],
      {
        id: 't1',
        status: 'proxying',
        progress: 0,
        proxyProgress: 0,
        updatedAt: '2026-06-02T12:00:03Z',
      } as any,
    );
    expect(merged[0].status).toBe('proxying');
    expect(merged[0].proxyProgress).toBe(0);
  });

  it('resolveImageListDisplayProgress reads cluster progress only not upload task', () => {
    const row = {
      metadata: { name: 'image-new', namespace: 'default' },
      spec: { sourceType: 'upload' },
      status: { progress: 12 },
    } as any;
    expect(resolveImageListDisplayProgress(row)).toBe(12);
    expect(resolveImageListDisplayProgress({ ...row, status: { progress: 0 } })).toBeNull();
  });

  it('mergeUploadTasksSorted prefers failed over stale proxying', () => {
    const merged = mergeUploadTasksSorted(
      [{ id: 't1', status: 'proxying', proxyProgress: 80, updatedAt: '2026-06-02T12:00:00Z' } as any],
      {
        id: 't1',
        status: 'failed',
        errorMessage: 'import failed',
        updatedAt: '2026-06-02T12:00:03Z',
      } as any,
    );
    expect(merged[0].status).toBe('failed');
    expect(merged[0].errorMessage).toBe('import failed');
  });

  it('mergeUploadTasksSorted with empty prev replaces list for drawer reload', () => {
    expect(
      mergeUploadTasksSorted([], [{ id: 'keep', status: 'ingesting' } as any]).map((t) => t.id),
    ).toEqual(['keep']);
  });
});
