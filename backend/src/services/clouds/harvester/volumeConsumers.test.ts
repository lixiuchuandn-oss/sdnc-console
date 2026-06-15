import {
  buildPvcWorkloadConsumerMap,
  getPvcWorkloadConsumers,
  formatPvcWorkloadConsumerLabels,
  resolveVolumeAttachedInfo,
} from './volumeConsumers';

describe('volumeConsumers', () => {
  it('maps deployment pvc volume to workload consumer', () => {
    const map = buildPvcWorkloadConsumerMap({
      deployments: [
        {
          metadata: { name: 'docker-registry-111', namespace: 'default' },
          spec: {
            template: {
              spec: {
                volumes: [{ name: 'data', persistentVolumeClaim: { claimName: 'docker-registry-111-pvc' } }],
              },
            },
          },
        },
      ],
    });

    const consumers = getPvcWorkloadConsumers(map, 'default', 'docker-registry-111-pvc');
    expect(consumers).toEqual([{ kind: 'Deployment', name: 'docker-registry-111' }]);
    expect(formatPvcWorkloadConsumerLabels(consumers)).toEqual(['Deployment/docker-registry-111']);
  });

  it('resolveVolumeAttachedInfo merges workload map labels', () => {
    const map = buildPvcWorkloadConsumerMap({
      deployments: [
        {
          metadata: { name: 'docker-registry-111', namespace: 'default' },
          spec: {
            template: {
              spec: {
                volumes: [{ name: 'data', persistentVolumeClaim: { claimName: 'docker-registry-111-pvc' } }],
              },
            },
          },
        },
      ],
    });
    const info = resolveVolumeAttachedInfo({
      namespace: 'default',
      pvcName: 'docker-registry-111-pvc',
      pvcWorkloadMap: map,
    });
    expect(info.workloadConsumers).toEqual([{ kind: 'Deployment', name: 'docker-registry-111' }]);
    expect(info.attachedTo).toEqual(['Deployment/docker-registry-111']);
  });
});
