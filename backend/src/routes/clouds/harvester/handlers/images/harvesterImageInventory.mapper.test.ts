import {
  clusterReportedSizeLooksLikeVirtualCapacity,
  enrichImageListItemSizeFromUploadTask,
  enrichImageListItemsFromDownloadTasks,
  enrichImageListItemsFromUploadTasks,
  mapImageInventoryToListItem,
} from './harvesterImageInventory.mapper';
import { isVolumeExportedVmImage } from '../../../../../services/clouds/harvester/vmImageClusterApi';

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

  it('isVolumeExportedVmImage detects export-from-volume sourceType only', () => {
    expect(isVolumeExportedVmImage({ spec: { sourceType: 'export-from-volume' } })).toBe(true);
    expect(isVolumeExportedVmImage({ spec: { sourceType: 'export' } })).toBe(false);
    expect(isVolumeExportedVmImage({ spec: { sourceType: 'upload' } })).toBe(false);
    expect(isVolumeExportedVmImage({ spec: { sourceType: 'download' } })).toBe(false);
  });

  it('mapImageInventoryToListItem masks export-from-volume PVC size until sparse size known', () => {
    const virtual = 300 * 1024 ** 3;
    const inv = {
      uid: 'u1',
      name: 'image-export',
      namespace: 'default',
      displayName: 'export-vol',
      size: String(virtual),
      rawData: {
        metadata: { name: 'image-export', namespace: 'default', uid: 'u1' },
        spec: { sourceType: 'export-from-volume', displayName: 'export-vol' },
        status: {
          progress: 100,
          size: virtual,
          virtualSize: virtual,
          conditions: [{ type: 'Imported', status: 'True' }],
        },
      },
    } as import('../../../../../entities/harvester/HarvesterImageInventory').HarvesterImageInventory;

    const item = mapImageInventoryToListItem(inv, new Set());
    expect(item.size).toBe(0);
    expect((item.status as { size?: number }).size).toBeUndefined();
  });

  it('enrichImageListItemsFromDownloadTasks only applies to export images', () => {
    const sparse = 1344995328;
    const [exportItem, uploadItem] = enrichImageListItemsFromDownloadTasks(
      [
        {
          name: 'image-export',
          namespace: 'default',
          spec: { sourceType: 'export-from-volume' },
          status: { size: virtual, virtualSize: virtual },
        },
        {
          name: 'image-upload',
          namespace: 'default',
          spec: { sourceType: 'upload' },
          status: { size: virtual, virtualSize: virtual },
        },
      ],
      [
        {
          namespace: 'default',
          imageName: 'image-export',
          fileSize: sparse,
          taskStatus: 'ready',
        },
        {
          namespace: 'default',
          imageName: 'image-upload',
          fileSize: sparse,
          taskStatus: 'ready',
        },
      ],
    );
    expect(exportItem.size).toBe(sparse);
    expect((uploadItem.status as { size?: number }).size).toBe(virtual);
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
