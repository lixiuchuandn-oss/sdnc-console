import { buildK8sResource } from './buildK8sResource';
import type { WorkloadFormValues } from './types';

jest.mock('../../../../../../../utils/harvesterUtils', () => ({
  generateHarvesterCrMetadataName: () => 'wl-test-cr-name',
}));

describe('buildK8sResource', () => {
  it('builds a minimal Deployment with default network', () => {
    const values: WorkloadFormValues = {
      name: 'my-app',
      namespace: 'default',
      workloadType: 'deployment',
      labels: [],
      containers: [
        {
          containerName: 'main',
          image: 'nginx:latest',
          imagePullPolicy: 'IfNotPresent',
          ports: [],
          env: [],
          volumeMounts: [],
          imagePullSecrets: [],
        },
      ],
      replicas: 2,
      networkType: 'default',
    };

    const resource = buildK8sResource(values, []);

    expect(resource.kind).toBe('Deployment');
    expect(resource.metadata.namespace).toBe('default');
    expect(resource.metadata.annotations['tower.io/alias']).toBe('my-app');
    expect(resource.spec.replicas).toBe(2);
    expect(resource.spec.template.spec.containers[0].image).toBe('nginx:latest');
    expect(resource.spec.template.metadata.annotations).toBeUndefined();
  });

  it('adds flat subnet network annotations when configured', () => {
    const values: WorkloadFormValues = {
      name: 'net-app',
      namespace: 'kube-system',
      workloadType: 'deployment',
      labels: [],
      containers: [
        {
          containerName: 'main',
          image: 'busybox',
          imagePullPolicy: 'IfNotPresent',
          ports: [],
          env: [],
          volumeMounts: [],
          imagePullSecrets: [],
        },
      ],
      replicas: 1,
      networkType: 'flat_subnet',
      flatSubnet: 'default/flat-net',
      enableStaticIP: true,
      staticIP: '10.0.0.42',
    };

    const resource = buildK8sResource(values, []);

    const annotations = resource.spec.template.metadata.annotations;
    expect(annotations['k8s.v1.cni.cncf.io/networks']).toBe('default/flat-net');
    expect(annotations['ovn.kubernetes.io/logical_switch']).toBe('flat-net');
    expect(annotations['ovn.kubernetes.io/ip_address']).toBe('10.0.0.42');
  });
});
