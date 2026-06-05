import {
  clusterReportedSizeLooksLikeVirtualCapacity,
  enrichImageListItemSizeFromUploadTask,
  enrichImageListItemsFromUploadTasks,
} from './harvesterImageInventory.mapper';

describe('harvesterImageInventory.mapper size display', () => {
  const virtual = 300 * 1024 ** 3;
  const file = 11 * 1024 ** 3;

  it('clusterReportedSizeLooksLikeVirtualCapacity detects ceph PVC capacity', () => {
    expect(clusterReportedSizeLooksLikeVirtualCapacity(virtual, virtual, file)).toBe(true);
    expect(clusterReportedSizeLooksLikeVirtualCapacity(file, virtual, file)).toBe(false);
  });

  it('enrichImageListItemSizeFromUploadTask restores sparse file size after sync', () => {
    const item = enrichImageListItemSizeFromUploadTask(
      {
        name: 'image-g95gh',
        namespace: 'default',
        status: { size: virtual, virtualSize: virtual },
        storageClassName: 'ceph-new',
      },
      { fileSize: file, virtualSizeBytes: virtual },
    );
    expect(item.size).toBe(file);
    expect((item.status as { size?: number }).size).toBe(file);
  });

  it('enrichImageListItemsFromUploadTasks matches by created image name', () => {
    const [item] = enrichImageListItemsFromUploadTasks(
      [
        {
          name: 'image-g95gh',
          namespace: 'default',
          status: { size: virtual, virtualSize: virtual },
        },
      ],
      [
        {
          createdImageName: 'image-g95gh',
          createdImageNamespace: 'default',
          namespace: 'default',
          fileSize: file,
          virtualSizeBytes: virtual,
        },
      ],
    );
    expect(item.size).toBe(file);
  });
});
