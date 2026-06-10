import {
  getVolumeWorkloadConsumerLabels,
  isVolumeUsedByWorkload,
  volumeWorkloadInUseHint,
} from './volumeConsumers';
import type { VolumeView } from './volumesSectionTypes';

describe('volumeConsumers', () => {
  const sample: VolumeView = {
    key: '1',
    name: 'docker-registry-111-pvc',
    namespace: 'default',
    pvName: '',
    phase: 'Bound',
    capacityRaw: '10Gi',
    capacityBytes: 0,
    storageClass: 'longhorn',
    accessModes: ['ReadWriteOnce'],
    volumeMode: 'Filesystem',
    creationTimestamp: '',
    attachedTo: ['Deployment/docker-registry-111'],
    workloadConsumers: [{ kind: 'Deployment', name: 'docker-registry-111' }],
    raw: {},
  };

  it('detects workload consumers on volume view', () => {
    expect(getVolumeWorkloadConsumerLabels(sample)).toEqual(['Deployment/docker-registry-111']);
    expect(isVolumeUsedByWorkload(sample)).toBe(true);
    expect(volumeWorkloadInUseHint(sample)).toContain('docker-registry-111');
  });

  it('falls back to attachedTo workload labels', () => {
    const row: VolumeView = {
      key: '2',
      name: 'data-pvc',
      namespace: 'default',
      pvName: '',
      phase: 'Bound',
      capacityRaw: '10Gi',
      capacityBytes: 0,
      storageClass: 'longhorn',
      accessModes: ['ReadWriteOnce'],
      volumeMode: 'Filesystem',
      creationTimestamp: '',
      attachedTo: ['Deployment/my-app'],
      raw: {},
    };
    expect(getVolumeWorkloadConsumerLabels(row)).toEqual(['Deployment/my-app']);
    expect(isVolumeUsedByWorkload(row)).toBe(true);
  });
});
