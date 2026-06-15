import {
  extractImagePullSecretNames,
  isAutoSyncedPullSecret,
  isRegistryManagedPullSecret,
  isRegistryManagedPullSecretName,
} from './registryManagedSecret';

describe('registryManagedSecret', () => {
  it('only treats auth secret names as registry-managed', () => {
    expect(isRegistryManagedPullSecretName('docker-registry-333-auth')).toBe(true);
    expect(isRegistryManagedPullSecretName('tower-reg-10-20-5-20-30507')).toBe(false);
  });

  it('detects auto synced pull secrets', () => {
    expect(
      isAutoSyncedPullSecret({
        type: 'kubernetes.io/dockerconfigjson',
        metadata: {
          name: 'tower-reg-10-20-5-20-30507',
          labels: {
            'compute-tower.io/type': 'workload-pull-secret',
            'compute-tower.io/managed': 'true',
          },
        },
      }),
    ).toBe(true);
  });

  it('does not treat auth secret as auto synced pull secret', () => {
    expect(
      isAutoSyncedPullSecret({
        type: 'Opaque',
        metadata: { name: 'docker-registry-333-auth' },
        data: { HTPASSWD: 'xxx' },
      }),
    ).toBe(false);
  });

  it('extracts imagePullSecrets from deployment', () => {
    expect(
      extractImagePullSecretNames(
        {
          spec: {
            template: {
              spec: {
                imagePullSecrets: [{ name: 'tower-reg-demo' }],
              },
            },
          },
        },
        '/apis/apps/v1/deployments',
      ),
    ).toEqual(['tower-reg-demo']);
  });

  it('extracts imagePullSecrets from cronjob', () => {
    expect(
      extractImagePullSecretNames(
        {
          spec: {
            jobTemplate: {
              spec: {
                template: {
                  spec: {
                    imagePullSecrets: [{ name: 'harbor-abc-pull-secret' }],
                  },
                },
              },
            },
          },
        },
        '/apis/batch/v1/cronjobs',
      ),
    ).toEqual(['harbor-abc-pull-secret']);
  });
});
