import { buildActiveContainerFromEditor } from './containerFormSync';
import type { WorkloadFormValues } from './types';

describe('buildActiveContainerFromEditor', () => {
  it('uses workload name as container name fallback', () => {
    const values = {
      name: 'web',
      containerName: '',
      image: 'nginx',
      imagePullPolicy: 'IfNotPresent',
      ports: [],
      env: [],
      resources: { requests: {}, limits: {} },
    } as WorkloadFormValues;

    expect(buildActiveContainerFromEditor(values).containerName).toBe('web');
  });

  it('preserves explicit container fields', () => {
    const values = {
      name: 'web',
      containerName: 'sidecar',
      image: 'redis:7',
      imagePullPolicy: 'Always',
      ports: [{ containerPort: 6379, protocol: 'TCP' }],
      env: [],
      resources: { requests: { cpu: '50m' }, limits: {} },
      volumeMounts: [{ name: 'data', mountPath: '/data' }],
    } as WorkloadFormValues;

    const container = buildActiveContainerFromEditor(values);
    expect(container.containerName).toBe('sidecar');
    expect(container.image).toBe('redis:7');
    expect(container.imagePullPolicy).toBe('Always');
    expect(container.volumeMounts).toHaveLength(1);
  });
});
