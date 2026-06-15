import {
  buildUpdatedHarborDockerConfigJson,
  getHarborIdFromPullSecretName,
  isHarborPullSecretName,
  normalizeHarborRegistryHostForMatch,
  resolveHarvesterClusterOrigin,
} from './HarborSecretSyncService';
import { HarborRegistry } from '../../entities/harbor/HarborRegistry';

describe('resolveHarvesterClusterOrigin', () => {
  it('preserves rancher cluster path', () => {
    expect(resolveHarvesterClusterOrigin('https://rancher.example.com/k8s/clusters/c-abc123')).toBe(
      'https://rancher.example.com/k8s/clusters/c-abc123',
    );
  });

  it('appends local cluster path for direct harvester endpoint', () => {
    expect(resolveHarvesterClusterOrigin('https://172.16.3.10')).toBe(
      'https://172.16.3.10/k8s/clusters/local',
    );
  });
});

describe('buildUpdatedHarborDockerConfigJson', () => {
  const harbor = {
    id: 'h1',
    name: 'harbor',
    url: 'https://cloudhci.harbor.local',
    username: 'admin',
    password: Buffer.from('newpass'.split('').reverse().join('')).toString('base64'),
  } as HarborRegistry;

  it('updates matching auth keys regardless of protocol prefix', () => {
    const existing = {
      data: {
        '.dockerconfigjson': Buffer.from(
          JSON.stringify({
            auths: {
              'https://cloudhci.harbor.local': {
                username: 'admin',
                password: 'oldpass',
                auth: Buffer.from('admin:oldpass').toString('base64'),
              },
            },
          }),
        ).toString('base64'),
      },
    };

    const encoded = buildUpdatedHarborDockerConfigJson(existing, harbor);
    const config = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    expect(config.auths['https://cloudhci.harbor.local'].password).toBe('newpass');
  });
});

describe('isHarborPullSecretName', () => {
  it('matches platform default harbor pull secret name', () => {
    expect(isHarborPullSecretName('harbor-8af2e50c-4f1a-4fb1-a274-df9d7ad9f4ab-pull-secret', '8af2e50c-4f1a-4fb1-a274-df9d7ad9f4ab')).toBe(true);
    expect(isHarborPullSecretName('other-secret', '8af2e50c-4f1a-4fb1-a274-df9d7ad9f4ab')).toBe(false);
  });
});

describe('getHarborIdFromPullSecretName', () => {
  it('extracts harbor id from standard secret name', () => {
    expect(getHarborIdFromPullSecretName('harbor-8af2e50c-4f1a-4fb1-a274-df9d7ad9f4ab-pull-secret')).toBe(
      '8af2e50c-4f1a-4fb1-a274-df9d7ad9f4ab',
    );
  });
});

describe('normalizeHarborRegistryHostForMatch', () => {
  it('normalizes host and default port', () => {
    expect(normalizeHarborRegistryHostForMatch('https://Cloud.Harbor.Local:443')).toBe(
      'cloud.harbor.local',
    );
  });
});
