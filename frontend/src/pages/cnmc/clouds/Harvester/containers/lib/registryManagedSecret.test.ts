import { isRegistryManagedPullSecret, isRegistryManagedPullSecretName } from './registryManagedSecret';

describe('isRegistryManagedPullSecretName', () => {
  it('matches local registry htpasswd auth secret names', () => {
    expect(isRegistryManagedPullSecretName('docker-registry-333-auth')).toBe(true);
  });

  it('does not match workload pull secret names', () => {
    expect(isRegistryManagedPullSecretName('local-registry-b173c7f2-pull-secret')).toBe(false);
    expect(isRegistryManagedPullSecretName('tower-reg-10-20-5-20-30507')).toBe(false);
  });
});

describe('isRegistryManagedPullSecret', () => {
  it('detects local registry htpasswd auth secret', () => {
    expect(
      isRegistryManagedPullSecret({
        type: 'Opaque',
        metadata: { name: 'docker-registry-333-auth' },
        data: { HTPASSWD: '******' },
      }),
    ).toBe(true);
  });

  it('does not treat dockerconfigjson pull secret as registry-managed', () => {
    expect(
      isRegistryManagedPullSecret({
        type: 'kubernetes.io/dockerconfigjson',
        metadata: {
          name: 'tower-reg-10-20-5-20-30507',
          labels: {
            'compute-tower.io/type': 'workload-pull-secret',
            'compute-tower.io/managed': 'true',
          },
        },
      }),
    ).toBe(false);
  });

  it('allows normal opaque secret', () => {
    expect(
      isRegistryManagedPullSecret({
        type: 'Opaque',
        metadata: { name: 'app-config' },
      }),
    ).toBe(false);
  });
});
