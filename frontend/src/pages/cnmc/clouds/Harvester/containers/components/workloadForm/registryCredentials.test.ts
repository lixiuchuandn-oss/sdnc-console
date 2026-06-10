import {
  buildMergedRegistryList,
  findRegistryForImage,
  localRegistryToCredential,
  parseImageRegistryHost,
  secretToRegistryCredential,
} from './registryCredentials';

describe('secretToRegistryCredential', () => {
  it('parses dockerconfigjson secret', () => {
    const auth = btoa('user:pass');
    const dockerConfig = JSON.stringify({
      auths: { 'https://registry.example.com': { auth } },
    });
    const secret = {
      type: 'kubernetes.io/dockerconfigjson',
      metadata: { name: 'regcred', namespace: 'default' },
      data: { '.dockerconfigjson': btoa(dockerConfig) },
    };
    expect(secretToRegistryCredential(secret)).toMatchObject({
      name: 'regcred',
      namespace: 'default',
      server: 'https://registry.example.com',
      username: 'user',
      password: 'pass',
    });
  });

  it('returns null for non-docker secrets', () => {
    expect(secretToRegistryCredential({ type: 'Opaque', data: {} })).toBeNull();
  });
});

describe('buildMergedRegistryList', () => {
  it('includes deployed local registries from platform API', () => {
    const list = buildMergedRegistryList(
      [],
      [
        {
          id: 'lr-1',
          name: 'lyf22',
          server: '10.20.5.28:30501',
          status: 'healthy',
        },
      ],
    );
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      source: 'deployed',
      id: 'local-lr-1',
      server: '10.20.5.28:30501',
      insecure: true,
    });
  });

  it('merges localStorage registries and harbor registries', () => {
    const list = buildMergedRegistryList(
      [{ id: '1', name: 'local-reg', server: 'http://local', insecure: true }],
      [],
      [{ id: 'h1', name: 'harbor', url: 'https://harbor.local', username: 'admin' }],
    );
    expect(list).toHaveLength(2);
    expect(list.find((item) => item.source === 'localStorage')).toMatchObject({
      server: 'http://local',
    });
    expect(list.find((item) => item.source === 'harbor')).toMatchObject({
      name: 'harbor',
      harborId: 'h1',
    });
  });
});

describe('localRegistryToCredential', () => {
  it('maps local registry entry', () => {
    expect(
      localRegistryToCredential({ name: 'r1', server: 'https://x.io', username: 'u' }),
    ).toEqual({
      name: 'r1',
      namespace: 'default',
      server: 'https://x.io',
      username: 'u',
      password: undefined,
      insecure: undefined,
    });
  });
});

describe('parseImageRegistryHost', () => {
  it('extracts host:port from private registry image', () => {
    expect(parseImageRegistryHost('10.20.5.20:30507/clickhouse:v1.0.0')).toBe('10.20.5.20:30507');
  });

  it('returns null for docker hub style image', () => {
    expect(parseImageRegistryHost('nginx:latest')).toBeNull();
  });
});

describe('findRegistryForImage', () => {
  it('matches deployed local registry by image host', () => {
    const registries = buildMergedRegistryList(
      [],
      [
        {
          id: 'lr-1',
          name: 'local',
          server: '10.20.5.20:30507',
          authEnabled: true,
          username: 'test',
          password: 'pass',
        },
      ],
    );
    expect(findRegistryForImage('10.20.5.20:30507/clickhouse:v1.0.0', registries)?.name).toBe(
      'local',
    );
  });
});
