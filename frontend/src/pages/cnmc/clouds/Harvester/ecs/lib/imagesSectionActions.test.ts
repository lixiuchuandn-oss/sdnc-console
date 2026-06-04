import {
  applyUploadTaskToListState,
  assessImageDeleteBlockedByVms,
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
  isUploadTaskInSyncPhase,
  isImageListFailedSyncRow,
  isImageListTowerUploadDeleteRow,
  isLocalUploadImageRow,
  shouldDeleteClusterImageForLocalUploadRow,
  mergeUploadTasksSorted,
  mergeUploadTasksIntoImageList,
  getHarvesterSyncProgress,
  planImageListProgressPoll,
  resolveImageListDisplayProgress,
  resolveImageDeleteSuccessMessage,
  resolveLinkedUploadTaskId,
  selectImagesByRowKeys,
  summarizeBatchImageDeleteMessage,
} from './imagesSectionActions';
import { resolveImageListStateKey } from './vmImageStatus';

describe('imagesSectionActions', () => {
  const img = { metadata: { name: 'img-a', namespace: 'ns1' }, displayName: 'Alpha' };

  it('getImageNsNameKey', () => {
    expect(getImageNsNameKey(img)).toBe('ns1/img-a');
  });

  it('selectImagesByRowKeys', () => {
    const rows = selectImagesByRowKeys([img, { metadata: { name: 'b' } }], ['img-a']);
    expect(rows).toHaveLength(1);
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

  it('applyUploadTaskToListState removes success and signals inventory refresh', () => {
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

  it('applyUploadTaskToListState merges cancelled tasks for list overlay', () => {
    const prev = [{ id: 't3', status: 'proxying', proxyProgress: 40 } as any];
    const { next, becameSuccess } = applyUploadTaskToListState(prev, {
      id: 't3',
      status: 'cancelled',
      createdImageName: 'img-x',
      createdImageNamespace: 'ns1',
    } as any);
    expect(next).toHaveLength(1);
    expect(next[0].status).toBe('cancelled');
    expect(becameSuccess).toBe(false);
  });

  it('mergeUploadTasksIntoImageList overlays cancelled on syncing inventory row', () => {
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
    expect(merged[0].state).toBe('cancelled');
    expect(resolveImageListStateKey(merged[0])).toBe('cancelled');
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
    expect(merged[0].state).toBe('failed');
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

  it('mergeUploadTasksIntoImageList adds virtual row for cancelled ingest-only task', () => {
    const merged = mergeUploadTasksIntoImageList([], [
      {
        id: 'task-ingest-cancel',
        status: 'cancelled',
        namespace: 'ns1',
        displayName: 'Local ISO',
        filename: 'local.iso',
      },
    ] as any[]);
    expect(merged).toHaveLength(1);
    expect(merged[0].state).toBe('cancelled');
    expect(merged[0].name).toBe('tower-upload-task-ingest-cancel');
  });

  it('mergeUploadTasksIntoImageList clears progress on failed sync overlay', () => {
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
          createdImageName: 'img-x',
          createdImageNamespace: 'ns1',
          errorMessage: 'Harvester 导入镜像失败',
        },
      ] as any[],
    );
    expect(merged[0].state).toBe('failed');
    expect(merged[0].progress).toBeUndefined();
  });

  it('planImageListProgressPoll stops inventory poll when cluster import failed', () => {
    const tasks = [{ id: 't1', status: 'proxying', createdImageName: 'img-a', createdImageNamespace: 'ns1' }] as any[];
    const images = [
      {
        metadata: { name: 'img-a', namespace: 'ns1' },
        status: { conditions: [{ type: 'Imported', status: 'False', message: 'failed' }] },
      },
    ] as any[];
    expect(planImageListProgressPoll(tasks, images)).toEqual({
      pollUploadTasks: true,
      pollInventory: false,
    });
  });

  it('planImageListProgressPoll stops all polling for terminal failed upload task', () => {
    expect(
      planImageListProgressPoll(
        [{ id: 't1', status: 'failed', createdImageName: 'img-a', createdImageNamespace: 'ns1' }] as any[],
        [{ metadata: { name: 'img-a', namespace: 'ns1' } }] as any[],
      ),
    ).toEqual({ pollUploadTasks: false, pollInventory: false });
  });

  it('planImageListProgressPoll skips inventory poll during active proxying', () => {
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

  it('getHarvesterSyncProgress uses cluster proxyProgress only', () => {
    expect(
      getHarvesterSyncProgress({
        status: 'uploaded',
        progress: 100,
        proxyProgress: 0,
      } as any),
    ).toBeNull();
    expect(
      getHarvesterSyncProgress({
        status: 'proxying',
        progress: 50,
        proxyProgress: 0,
      } as any),
    ).toBe(50);
    expect(
      getHarvesterSyncProgress({
        status: 'proxying',
        progress: 50,
        proxyProgress: 33,
      } as any),
    ).toBe(50);
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

  it('resolveImageListStateKey stays uploading when steve active but cluster progress 21', () => {
    expect(
      resolveImageListStateKey({
        state: 'Active',
        sourceType: 'upload',
        status: { progress: 21, size: 1000 },
      }),
    ).toBe('uploading');
  });

  it('mergeUploadTasksIntoImageList keeps syncing when task success but cluster at 21%', () => {
    const merged = mergeUploadTasksIntoImageList(
      [
        {
          name: 'image-7nm7g',
          namespace: 'default',
          state: 'Uploading',
          sourceType: 'upload',
          status: { progress: 21, size: 1000 },
        },
      ],
      [
        {
          id: 't1',
          status: 'success',
          createdImageName: 'image-7nm7g',
          createdImageNamespace: 'default',
        },
      ] as any,
    );
    expect(resolveImageListStateKey(merged[0])).toBe('syncing');
    expect(merged[0].progress).toBe(21);
  });

  it('resolveImageListStateKey prefers cluster Imported=False over syncing overlay', () => {
    expect(
      resolveImageListStateKey({
        state: 'syncing',
        progress: 99,
        status: {
          progress: 99,
          conditions: [{ type: 'Imported', status: 'False', message: 'import failed' }],
        },
      }),
    ).toBe('failed');
  });

  it('assessImageDeleteBlockedByVms returns null when unused', () => {
    expect(assessImageDeleteBlockedByVms(img, [])).toBeNull();
  });

  it('isUploadTaskDeleteBlocked blocks uploaded, pending and ingesting', () => {
    expect(isUploadTaskDeleteBlocked({ id: '1', status: 'uploaded' } as any)).toBe(true);
    expect(isUploadTaskDeleteBlocked({ id: '2', status: 'pending' } as any)).toBe(true);
    expect(isUploadTaskDeleteBlocked({ id: '3', status: 'ingesting' } as any)).toBe(true);
    expect(isUploadTaskDeleteBlocked({ id: '4', status: 'proxying' } as any)).toBe(false);
    expect(isUploadTaskDeleteBlocked({ id: '5', status: 'failed' } as any)).toBe(false);
    expect(isUploadTaskDeleteBlocked({ id: '6', status: 'success' } as any)).toBe(false);
  });

  it('getUploadTaskDeleteBlockedMessage returns user-facing hints', () => {
    expect(getUploadTaskDeleteBlockedMessage({ id: '1', status: 'uploaded' } as any)).toContain(
      '镜像数据',
    );
    expect(getUploadTaskDeleteBlockedMessage({ id: '2', status: 'ingesting' } as any)).toContain(
      '分片上传',
    );
    expect(getUploadTaskDeleteBlockedMessage({ id: '3', status: 'proxying' } as any)).toBeNull();
    expect(getUploadTaskDeleteBlockedMessage({ id: '4', status: 'failed' } as any)).toBeNull();
  });

  it('resolveImageDeleteSuccessMessage allows cluster-only delete without task', () => {
    expect(
      resolveImageDeleteSuccessMessage({
        localUpload: true,
        deleteCluster: true,
        deletedTask: false,
      }),
    ).toBe('镜像已删除');
    expect(
      resolveImageDeleteSuccessMessage({
        localUpload: true,
        deleteCluster: true,
        deletedTask: true,
      }),
    ).toBe('镜像及上传任务已删除');
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

  it('getUploadDrawerDisplayStatus masks sync-phase as uploaded', () => {
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
    expect(isUploadTaskInSyncPhase({ id: '7', status: 'proxying' } as any)).toBe(true);
    expect(isUploadTaskInSyncPhase({ id: '8', status: 'uploaded' } as any)).toBe(false);
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
      isImageListTowerUploadDeleteRow({ state: 'pending_sync', metadata: { name: 'a' } } as any),
    ).toBe(true);
    expect(isImageListFailedSyncRow({ state: 'failed', metadata: { name: 'a' } } as any)).toBe(true);
    expect(
      isImageListTowerUploadDeleteRow({ state: 'ready', metadata: { name: 'a' } } as any),
    ).toBe(false);
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
