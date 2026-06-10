import {
  isLocalRegistryManagedService,
  isLocalRegistryManagedServiceName,
  isLocalRegistryManagedPvc,
  isLocalRegistryManagedPvcName,
  isLocalRegistryManagedDeployment,
  isLocalRegistryManagedDeploymentName,
} from './registryManagedLocalRegistry';

describe('registryManagedLocalRegistry service', () => {
  it('matches deployed local registry service name', () => {
    expect(isLocalRegistryManagedServiceName('docker-registry-qqq')).toBe(true);
  });

  it('detects service by managed label and name', () => {
    expect(
      isLocalRegistryManagedService({
        metadata: {
          name: 'docker-registry-qqq',
          labels: {
            'compute-tower.io/type': 'local-registry-service',
            'app.kubernetes.io/managed-by': 'compute-tower',
          },
        },
        spec: {
          type: 'NodePort',
          selector: { app: 'docker-registry-qqq' },
          ports: [{ port: 5000, name: 'registry' }],
        },
      }),
    ).toBe(true);
  });

  it('does not treat normal NodePort service as managed', () => {
    expect(
      isLocalRegistryManagedService({
        metadata: { name: 'my-app' },
        spec: { type: 'NodePort', ports: [{ port: 80 }] },
      }),
    ).toBe(false);
  });

  it('matches deployed local registry pvc name', () => {
    expect(isLocalRegistryManagedPvcName('docker-registry-111-pvc')).toBe(true);
  });

  it('detects pvc by managed label and name', () => {
    expect(
      isLocalRegistryManagedPvc({
        metadata: {
          name: 'docker-registry-111-pvc',
          labels: {
            'compute-tower.io/type': 'local-registry-pvc',
            'app.kubernetes.io/managed-by': 'compute-tower',
            'app.kubernetes.io/name': 'docker-registry-111',
          },
        },
      }),
    ).toBe(true);
  });

  it('does not treat normal pvc as managed', () => {
    expect(
      isLocalRegistryManagedPvc({
        metadata: { name: 'data-disk-01' },
      }),
    ).toBe(false);
  });
});

describe('registryManagedLocalRegistry deployment', () => {
  it('matches deployed local registry deployment name', () => {
    expect(isLocalRegistryManagedDeploymentName('docker-registry-111')).toBe(true);
  });

  it('detects deployment by managed label and name', () => {
    expect(
      isLocalRegistryManagedDeployment({
        metadata: {
          name: 'docker-registry-111',
          labels: {
            'compute-tower.io/type': 'local-registry-deployment',
            'app.kubernetes.io/managed-by': 'compute-tower',
          },
        },
        spec: {
          selector: { matchLabels: { app: 'docker-registry-111' } },
          template: {
            spec: {
              containers: [{ name: 'registry', ports: [{ containerPort: 5000, name: 'registry' }] }],
            },
          },
        },
      }),
    ).toBe(true);
  });

  it('does not treat normal deployment as managed', () => {
    expect(
      isLocalRegistryManagedDeployment({
        metadata: { name: 'my-app' },
        spec: {
          template: {
            spec: {
              containers: [{ name: 'app', ports: [{ containerPort: 8080 }] }],
            },
          },
        },
      }),
    ).toBe(false);
  });
});
