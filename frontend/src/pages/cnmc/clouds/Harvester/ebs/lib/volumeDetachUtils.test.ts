import {
  countVolumeBatchDeleteSuccess,
  isVolumeDeleteInUseError,
  resolveAttachedDiskName,
  resolveVmInstanceIds,
  resolveVmRebootTargetId,
  vmDisplayLabel,
} from './volumeDetachUtils';
import { buildStorageClassSelectOptions, pickExportTargetStorageClass } from './volumesStorageClassUtils';
import { parseHarvesterNamespaceNames } from './parseHarvesterNamespaceNames';

describe('volumeDetachUtils', () => {
  const vm = {
    InstanceId: 'proj-1/vm-a',
    InstanceName: 'vm-a',
    metadata: { namespace: 'proj-1', name: 'vm-a', annotations: { 'tower.io/alias': '测试机' } },
    spec: {
      template: {
        spec: {
          volumes: [{ name: 'disk-1', persistentVolumeClaim: { claimName: 'vol-data' } }],
        },
      },
    },
  };

  it('resolveAttachedDiskName finds volume entry name', () => {
    expect(resolveAttachedDiskName(vm, 'vol-data')).toBe('disk-1');
  });

  it('resolveVmInstanceIds prefers InstanceId', () => {
    expect(resolveVmInstanceIds(vm).resolvedId).toBe('proj-1/vm-a');
  });

  it('resolveVmRebootTargetId returns instance id', () => {
    expect(resolveVmRebootTargetId(vm)).toBe('proj-1/vm-a');
  });

  it('vmDisplayLabel prefers alias', () => {
    expect(vmDisplayLabel(vm)).toBe('测试机（vm-a）');
  });

  it('countVolumeBatchDeleteSuccess treats 404 as success', () => {
    const results = [
      { status: 'fulfilled' as const, value: true },
      { status: 'rejected' as const, reason: { status: 404, message: 'not found' } },
    ];
    expect(countVolumeBatchDeleteSuccess(results)).toEqual({ ok: 2, fail: 0 });
  });

  it('isVolumeDeleteInUseError detects in-use message', () => {
    expect(isVolumeDeleteInUseError('volume is in use', true)).toBe(true);
    expect(isVolumeDeleteInUseError('volume is in use', false)).toBe(false);
  });
});

describe('volumesStorageClassUtils', () => {
  it('pickExportTargetStorageClass prefers longhorn', () => {
    expect(pickExportTargetStorageClass([{ metadata: { name: 'longhorn' } }])).toBe('longhorn');
  });

  it('buildStorageClassSelectOptions skips system classes', () => {
    const options = buildStorageClassSelectOptions([
      { metadata: { name: 'longhorn' } },
      { metadata: { name: 'harvester-longhorn' } },
    ]);
    expect(options.some((o) => o.value === 'harvester-longhorn')).toBe(false);
    expect(options.some((o) => o.value === 'longhorn')).toBe(true);
  });
});

describe('parseHarvesterNamespaceNames', () => {
  it('parses items from data.items', () => {
    expect(
      parseHarvesterNamespaceNames({
        data: { items: [{ metadata: { name: 'proj-1' } }, { metadata: { name: 'default' } }] },
      }),
    ).toEqual(['proj-1', 'default']);
  });

  it('parses raw items array and id field', () => {
    expect(
      parseHarvesterNamespaceNames([
        { id: 'cloud-public', type: 'namespace' },
        { metadata: { name: 'default' } },
      ]),
    ).toEqual(['cloud-public', 'default']);
  });
});
