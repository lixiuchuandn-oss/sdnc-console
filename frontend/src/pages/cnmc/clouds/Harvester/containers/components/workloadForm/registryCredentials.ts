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

/** 与 RegistryBrowserDrawer.registries 项结构对齐 */
export interface MergedRegistryEntry {
  source: 'localStorage' | 'secret' | 'deployed' | 'harbor';
  id: string;
  name: string;
  server: string;
  username?: string;
  password?: string;
  insecure: boolean;
  localRegistryId?: string;
  harborId?: string;
}

export interface HarborRegistryInput {
  id: string;
  name?: string;
  url?: string;
  server?: string;
  username?: string;
  password?: string;
  insecure?: boolean;
}

/** 平台「部署本地仓库」API 返回项（浏览仓库用） */
export interface DeployedLocalRegistryInput {
  id: string;
  name: string;
  server: string;
  authEnabled?: boolean;
  username?: string;
  password?: string;
  status?: string;
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
    const config = JSON.parse(decoded) as {
      auths?: Record<string, { auth?: string; username?: string; password?: string }>;
    };
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

export function normalizeRegistryServer(server: string): string {
  const withoutProtocol = server.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return withoutProtocol.split('/')[0];
}

/** 从镜像地址解析仓库 host（含端口），如 10.20.5.20:30507/clickhouse:v1 → 10.20.5.20:30507 */
export function parseImageRegistryHost(image: string): string | null {
  const trimmed = image.trim();
  if (!trimmed) return null;

  const slashIdx = trimmed.indexOf('/');
  if (slashIdx === -1) return null;

  const first = trimmed.slice(0, slashIdx);
  const looksLikeRegistry =
    first.includes('.') || first.includes(':') || first === 'localhost';
  if (!looksLikeRegistry) return null;

  return normalizeRegistryServer(first);
}

export function findRegistryForImage(
  image: string,
  registries: MergedRegistryEntry[],
): MergedRegistryEntry | undefined {
  const host = parseImageRegistryHost(image);
  if (!host) return undefined;

  return registries.find(
    (registry) => normalizeRegistryServer(registry.server) === host,
  );
}

/** Harbor 需走 Harbor API 浏览，不能用于 Docker Registry V2 目录浏览 */
export function filterDockerRegistryEntries(
  registries: MergedRegistryEntry[],
): MergedRegistryEntry[] {
  return registries.filter((r) => r.source !== 'harbor' && !r.harborId);
}

export function buildGenericPullSecretName(server: string): string {
  const slug = normalizeRegistryServer(server)
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 40);
  return `tower-reg-${slug || 'registry'}`;
}

export function mapHarborRegistries(harbors: HarborRegistryInput[]): MergedRegistryEntry[] {
  return harbors
    .filter((h) => h.url || h.server)
    .map((h) => ({
      source: 'harbor' as const,
      id: `harbor-${h.id}`,
      harborId: h.id,
      name: h.name || h.url || h.server || h.id,
      server: h.url || h.server || '',
      username: h.username,
      password: h.password,
      insecure: h.insecure ?? false,
    }));
}

export function mapDeployedLocalRegistries(
  deployed: DeployedLocalRegistryInput[],
): MergedRegistryEntry[] {
  return deployed
    .filter((r) => r.server && r.status !== 'deleting' && r.status !== 'deploying')
    .map((r) => ({
      source: 'deployed' as const,
      id: `local-${r.id}`,
      name: r.name || r.server,
      server: r.server,
      username: r.authEnabled ? r.username : undefined,
      password: r.authEnabled ? r.password : undefined,
      insecure: true,
      localRegistryId: r.id,
    }));
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
  deployedLocalRegistries: DeployedLocalRegistryInput[] = [],
  harborRegistries: HarborRegistryInput[] = [],
): MergedRegistryEntry[] {
  const registries: MergedRegistryEntry[] = [];
  const seenServers = new Set<string>();

  const pushUnique = (entry: MergedRegistryEntry) => {
    const key = normalizeRegistryServer(entry.server);
    if (seenServers.has(key)) return;
    seenServers.add(key);
    registries.push(entry);
  };

  mapDeployedLocalRegistries(deployedLocalRegistries).forEach(pushUnique);
  mapHarborRegistries(harborRegistries).forEach(pushUnique);

  localStorageRegistries.forEach((reg) => {
    if (!reg.server) return;
    const id = reg.id || reg.name || reg.server;
    const name = reg.name || reg.server;
    pushUnique({
      source: 'localStorage',
      id,
      name,
      server: reg.server,
      username: reg.username,
      password: reg.password,
      insecure: reg.insecure ?? false,
    });
  });

  return registries;
}
