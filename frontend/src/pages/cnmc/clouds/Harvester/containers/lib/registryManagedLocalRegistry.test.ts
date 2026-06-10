import {
  isLocalRegistryManagedService,
  isLocalRegistryManagedServiceName,
  isLocalRegistryManagedDeployment,
  isLocalRegistryManagedDeploymentName,
} from './registryManagedLocalRegistry';

describe('isLocalRegistryManagedService', () => {
  it('matches deployed local registry service name', () => {
    expect(isLocalRegistryManagedServiceName('docker-registry-qqq')).toBe(true);
  });

  it('detects managed local registry service', () => {
    expect(
      isLocalRegistryManagedService({
        metadata: {
          name: 'docker-registry-qqq',
          labels: { 'compute-tower.io/type': 'local-registry-service' },
        },
        spec: {
          type: 'NodePort',
          selector: { app: 'docker-registry-qqq' },
          ports: [{ port: 5000, name: 'registry' }],
        },
      }),
    ).toBe(true);
  });
});

describe('isLocalRegistryManagedDeployment', () => {
  it('matches deployed local registry deployment name', () => {
    expect(isLocalRegistryManagedDeploymentName('docker-registry-qqq')).toBe(true);
  });

  it('detects managed local registry deployment', () => {
    expect(
      isLocalRegistryManagedDeployment({
        metadata: {
          name: 'docker-registry-qqq',
          labels: { 'compute-tower.io/type': 'local-registry-deployment' },
        },
        spec: {
          selector: { matchLabels: { app: 'docker-registry-qqq' } },
          template: {
            spec: {
              containers: [{ name: 'registry', ports: [{ containerPort: 5000, name: 'registry' }] }],
            },
          },
        },
      }),
    ).toBe(true);
  });
});
