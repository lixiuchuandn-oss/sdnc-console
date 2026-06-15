/** 由镜像仓库部署托管的认证 Secret（htpasswd），不可在配置管理页直接编辑/删除 */
const REGISTRY_AUTH_MANAGED_TYPES = new Set(['local-registry-auth-secret']);

const REGISTRY_AUTH_SECRET_NAME_PATTERNS = [/^docker-registry-.+-auth$/i];

const WORKLOAD_PULL_SECRET_NAME_PATTERNS = [
  /^local-registry-.+-pull-secret$/i,
  /^harbor-.+-pull-secret$/i,
  /^tower-reg-.+$/,
];

const WORKLOAD_PULL_SECRET_TYPES = new Set([
  'workload-pull-secret',
  'local-registry-pull-secret',
  'harbor-pull-secret',
  'imagepullsecret',
]);

export function isRegistryManagedPullSecretName(name: string | null | undefined): boolean {
  if (!name) return false;
  return REGISTRY_AUTH_SECRET_NAME_PATTERNS.some((pattern) => pattern.test(name));
}

export function isAutoSyncedPullSecretName(name: string | null | undefined): boolean {
  if (!name) return false;
  return WORKLOAD_PULL_SECRET_NAME_PATTERNS.some((pattern) => pattern.test(name));
}

function isDockerConfigPullSecret(secret: {
  type?: string;
  data?: Record<string, string>;
  _registryServer?: string;
} | null | undefined): boolean {
  if (!secret) return false;
  if (secret.type === 'kubernetes.io/dockerconfigjson') return true;
  if (secret.data?.['.dockerconfigjson']) return true;
  if (secret._registryServer) return true;
  return false;
}

function isRegistryAuthSecret(secret: {
  type?: string;
  data?: Record<string, string>;
} | null | undefined): boolean {
  if (!secret) return false;
  if (secret.type === 'Opaque' && secret.data?.HTPASSWD) return true;
  return false;
}

/** 镜像仓库部署产生的 htpasswd 认证 Secret */
export function isRegistryManagedPullSecret(secret: {
  type?: string;
  data?: Record<string, string>;
  metadata?: {
    name?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  };
} | null | undefined): boolean {
  if (!secret?.metadata) return false;

  const labels = secret.metadata.labels || {};
  const annotations = secret.metadata.annotations || {};
  const name = secret.metadata.name || '';
  const towerType = labels['compute-tower.io/type'] || annotations['compute-tower.io/type'];

  if (isRegistryManagedPullSecretName(name)) {
    return true;
  }

  if (towerType && REGISTRY_AUTH_MANAGED_TYPES.has(towerType)) {
    return true;
  }

  if (
    labels['app.kubernetes.io/managed-by'] === 'compute-tower' &&
    /^docker-registry-.+-auth$/i.test(name)
  ) {
    return true;
  }

  if (towerType === 'local-registry-auth-secret' && isRegistryAuthSecret(secret)) {
    return true;
  }

  const managed =
    labels['compute-tower.io/managed'] === 'true' ||
    annotations['compute-tower.io/managed'] === 'true';

  if (managed && isRegistryAuthSecret(secret) && towerType === 'local-registry-auth-secret') {
    return true;
  }

  return false;
}

/** 工作负载自动同步的 dockerconfigjson 拉取凭证 */
export function isAutoSyncedPullSecret(secret: {
  type?: string;
  data?: Record<string, string>;
  _registryServer?: string;
  metadata?: {
    name?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  };
} | null | undefined): boolean {
  if (!secret?.metadata) return false;
  if (!isDockerConfigPullSecret(secret)) return false;
  if (isRegistryManagedPullSecret(secret)) return false;

  const labels = secret.metadata.labels || {};
  const annotations = secret.metadata.annotations || {};
  const name = secret.metadata.name || '';
  const towerType = labels['compute-tower.io/type'] || annotations['compute-tower.io/type'];

  if (isAutoSyncedPullSecretName(name)) {
    return true;
  }

  if (towerType && WORKLOAD_PULL_SECRET_TYPES.has(towerType)) {
    return true;
  }

  const managed =
    labels['compute-tower.io/managed'] === 'true' ||
    annotations['compute-tower.io/managed'] === 'true';

  return !!(managed && towerType === 'imagepullsecret');
}

export function extractImagePullSecretNames(workload: any, apiPath: string): string[] {
  const names = new Set<string>();
  const add = (list?: Array<{ name?: string }>) => {
    (list || []).forEach((item) => {
      if (item?.name) names.add(item.name);
    });
  };

  if (apiPath.includes('/cronjobs')) {
    add(workload?.spec?.jobTemplate?.spec?.template?.spec?.imagePullSecrets);
  } else {
    add(workload?.spec?.template?.spec?.imagePullSecrets);
  }

  return Array.from(names);
}

export const REGISTRY_MANAGED_SECRET_MESSAGE =
  '该 Secret 为镜像仓库部署的认证配置，请在「镜像仓库」中编辑或删除对应仓库';
