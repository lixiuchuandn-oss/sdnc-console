import {
  buildMergedRegistryList,
  localRegistryToCredential,
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
  it('merges localStorage registries and secrets', () => {
    const auth = btoa('a:b');
    const dockerConfig = JSON.stringify({ auths: { 'http://harbor.local': { auth } } });
    const list = buildMergedRegistryList(
      [{ id: '1', name: 'local-reg', server: 'http://local', insecure: true }],
      [
        {
          type: 'kubernetes.io/dockerconfigjson',
          metadata: { name: 'sec-reg' },
          data: { '.dockerconfigjson': btoa(dockerConfig) },
        },
      ],
    );
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ source: 'localStorage', server: 'http://local' });
    expect(list[1]).toMatchObject({
      source: 'secret',
      name: 'sec-reg',
      server: 'http://harbor.local',
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
