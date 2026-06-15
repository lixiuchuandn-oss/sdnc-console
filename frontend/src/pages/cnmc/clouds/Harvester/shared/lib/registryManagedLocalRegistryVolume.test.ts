import {
  isLocalRegistryManagedPvc,
  isLocalRegistryManagedPvcName,
  isLocalRegistryManagedVolume,
} from './registryManagedLocalRegistryVolume';

describe('registryManagedLocalRegistryVolume', () => {
  it('matches deployed local registry pvc name', () => {
    expect(isLocalRegistryManagedPvcName('docker-registry-qqq-pvc')).toBe(true);
  });

  it('detects pvc by managed label and name', () => {
    expect(
      isLocalRegistryManagedPvc({
        metadata: {
          name: 'docker-registry-qqq-pvc',
          labels: {
            'compute-tower.io/type': 'local-registry-pvc',
            'app.kubernetes.io/managed-by': 'compute-tower',
          },
        },
      }),
    ).toBe(true);
  });

  it('detects volume view wrapper', () => {
    expect(
      isLocalRegistryManagedVolume({
        name: 'docker-registry-qqq-pvc',
        raw: {
          metadata: {
            name: 'docker-registry-qqq-pvc',
            labels: { 'app.kubernetes.io/managed-by': 'compute-tower' },
          },
        },
      }),
    ).toBe(true);
  });
});
