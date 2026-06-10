import {
  createHarvesterImagePullSecret,
  updateHarvesterImagePullSecret,
} from '../../../../../../../services/harvesterApi';
import { syncLocalRegistryPullSecret } from '../../../../../../../services/localRegistryApi';
import { syncHarborSecret } from '../../../harbor/shared/harborApi';
import {
  buildGenericPullSecretName,
  findRegistryForImage,
  MergedRegistryEntry,
  normalizeRegistryServer,
} from './registryCredentials';

function registryNeedsPullSecret(registry: MergedRegistryEntry): boolean {
  if (registry.localRegistryId || registry.harborId) {
    return !!(registry.username || registry.password);
  }
  return !!(registry.username && registry.password);
}

export async function ensureImagePullSecretFromRegistry(
  cloudId: string,
  namespace: string,
  registry: MergedRegistryEntry,
): Promise<string | undefined> {
  if (!registryNeedsPullSecret(registry)) {
    return undefined;
  }

  if (registry.localRegistryId) {
    const res = await syncLocalRegistryPullSecret(cloudId, registry.localRegistryId, {
      namespace,
    });
    return res?.data?.secretName as string | undefined;
  }

  if (registry.harborId) {
    const res = await syncHarborSecret(registry.harborId, { cloudId, namespace });
    return res?.secretName;
  }

  if (!registry.username || !registry.password) {
    return undefined;
  }

  const server = normalizeRegistryServer(registry.server);
  const secretName = buildGenericPullSecretName(server);
  const payload = {
    namespace,
    name: secretName,
    server,
    username: registry.username,
    password: registry.password,
    alias: registry.name,
  };

  try {
    await createHarvesterImagePullSecret(cloudId, payload);
  } catch {
    await updateHarvesterImagePullSecret(cloudId, namespace, secretName, {
      server,
      username: registry.username,
      password: registry.password,
      alias: registry.name,
    });
  }

  return secretName;
}

/** 根据镜像地址匹配镜像仓库，自动同步 K8s 拉取凭证 */
export async function ensureImagePullSecretsForImages(
  cloudId: string,
  namespace: string,
  images: string[],
  registries: MergedRegistryEntry[],
  existingSecrets: string[] = [],
): Promise<string[]> {
  const secrets = new Set(existingSecrets.filter(Boolean));

  for (const image of images) {
    const registry = findRegistryForImage(image, registries);
    if (!registry || !registryNeedsPullSecret(registry)) continue;

    try {
      const secretName = await ensureImagePullSecretFromRegistry(cloudId, namespace, registry);
      if (secretName) secrets.add(secretName);
    } catch (error) {
      console.warn('[自动同步拉取凭证] 失败:', image, error);
    }
  }

  return Array.from(secrets);
}
