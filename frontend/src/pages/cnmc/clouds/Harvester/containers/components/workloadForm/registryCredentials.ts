/**
 * 镜像仓库凭证：localStorage 仓库 + K8s dockerconfigjson Secret → RegistryBrowser 可用格式
 */

export interface RegistryBrowserCredential {
  name?: string;
  namespace?: string;
  server: string;
  username?: string;
  password?: string;
  insecure?: boolean;
}

export interface MergedRegistryEntry {
  source: 'localStorage' | 'secret';
  id?: string;
  name?: string;
  server: string;
  username?: string;
  password?: string;
  insecure?: boolean;
}

const HARVESTER_REGISTRIES_STORAGE_KEY = 'harvester-registries';

export function loadHarvesterRegistriesFromLocalStorage(): Array<{
  id?: string;
  name?: string;
  server?: string;
  username?: string;
  password?: string;
  insecure?: boolean;
}> {
  try {
    const data = localStorage.getItem(HARVESTER_REGISTRIES_STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

/**
 * 将 Secret 对象转换为 RegistryBrowser 需要的 credential 格式
 * 只处理 kubernetes.io/dockerconfigjson 类型
 */
export function secretToRegistryCredential(secret: unknown): RegistryBrowserCredential | null {
  if (!secret || typeof secret !== 'object') return null;

  const s = secret as Record<string, unknown>;
  const metadata = s.metadata as Record<string, unknown> | undefined;
  const data = s.data as Record<string, string> | undefined;

  try {
    const secretType =
      s.type ||
      (metadata?.annotations as Record<string, string> | undefined)?.[
        'kubernetes.io/service-account.name'
      ];
    const isDockerConfig =
      secretType === 'kubernetes.io/dockerconfigjson' || data?.['.dockerconfigjson'];

    if (!isDockerConfig || !data?.['.dockerconfigjson']) {
      return null;
    }

    const decoded = atob(data['.dockerconfigjson']);
    const config = JSON.parse(decoded) as { auths?: Record<string, { auth?: string; username?: string; password?: string }> };
    const auths = config.auths || {};
    const server = Object.keys(auths)[0];
    if (!server) return null;

    const auth = auths[server];
    let username: string | undefined;
    let password: string | undefined;

    if (auth?.auth) {
      try {
        const decodedAuth = atob(auth.auth);
        const [u, p] = decodedAuth.split(':');
        username = u;
        password = p;
      } catch {
        username = auth?.username;
        password = auth?.password;
      }
    } else {
      username = auth?.username;
      password = auth?.password;
    }

    return {
      name: metadata?.name as string | undefined,
      namespace: metadata?.namespace as string | undefined,
      server,
      username: username || undefined,
      password: password || undefined,
      insecure: server.includes('172.16.3.79') || !server.startsWith('https://'),
    };
  } catch {
    return null;
  }
}

export function localRegistryToCredential(registry: {
  name?: string;
  server?: string;
  username?: string;
  password?: string;
  insecure?: boolean;
}): RegistryBrowserCredential | null {
  if (!registry?.server) return null;
  return {
    name: registry.name,
    namespace: 'default',
    server: registry.server,
    username: registry.username,
    password: registry.password,
    insecure: registry.insecure,
  };
}

export function buildMergedRegistryList(
  localStorageRegistries: Array<{
    id?: string;
    name?: string;
    server?: string;
    username?: string;
    password?: string;
    insecure?: boolean;
  }>,
  secretsWithCredentials: unknown[] | undefined,
): MergedRegistryEntry[] {
  const registries: MergedRegistryEntry[] = [];

  localStorageRegistries.forEach((reg) => {
    if (!reg.server) return;
    registries.push({
      source: 'localStorage',
      id: reg.id,
      name: reg.name,
      server: reg.server,
      username: reg.username,
      password: reg.password,
      insecure: reg.insecure,
    });
  });

  if (secretsWithCredentials?.length) {
    secretsWithCredentials.forEach((secret) => {
      const credential = secretToRegistryCredential(secret);
      if (!credential) return;
      const meta = (secret as { metadata?: { name?: string } }).metadata;
      registries.push({
        source: 'secret',
        id: meta?.name,
        name: meta?.name,
        server: credential.server,
        username: credential.username,
        password: credential.password,
        insecure: credential.insecure,
      });
    });
  }

  return registries;
}
