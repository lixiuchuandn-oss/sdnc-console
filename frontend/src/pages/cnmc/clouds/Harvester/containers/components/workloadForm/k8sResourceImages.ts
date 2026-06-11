/**
 * 从 Kubernetes 工作负载资源中提取/写入镜像与 imagePullSecrets
 */

type PodSpecLike = {
  containers?: Array<{ image?: string }>;
  initContainers?: Array<{ image?: string }>;
  imagePullSecrets?: Array<{ name?: string }>;
};

function getWritablePodSpec(resource: Record<string, unknown>): PodSpecLike | null {
  const kind = String(resource.kind || '');
  const spec = resource.spec as Record<string, unknown> | undefined;
  if (!spec) return null;

  if (kind === 'Pod') {
    return spec as PodSpecLike;
  }

  if (kind === 'CronJob') {
    const jobTemplate = spec.jobTemplate as Record<string, unknown> | undefined;
    const jobSpec = jobTemplate?.spec as Record<string, unknown> | undefined;
    const template = jobSpec?.template as Record<string, unknown> | undefined;
    return (template?.spec as PodSpecLike) || null;
  }

  const template = spec.template as Record<string, unknown> | undefined;
  return (template?.spec as PodSpecLike) || null;
}

export function extractImagesFromK8sResource(resource: Record<string, unknown>): string[] {
  const podSpec = getWritablePodSpec(resource);
  if (!podSpec) return [];

  const images: string[] = [];
  for (const container of [...(podSpec.containers || []), ...(podSpec.initContainers || [])]) {
    if (container?.image?.trim()) {
      images.push(container.image.trim());
    }
  }
  return images;
}

export function extractImagePullSecretNamesFromK8sResource(resource: Record<string, unknown>): string[] {
  const podSpec = getWritablePodSpec(resource);
  if (!podSpec?.imagePullSecrets) return [];
  return podSpec.imagePullSecrets.map((item) => item?.name).filter(Boolean) as string[];
}

export function applyImagePullSecretsToK8sResource(
  resource: Record<string, unknown>,
  secretNames: string[],
): Record<string, unknown> {
  const podSpec = getWritablePodSpec(resource);
  if (!podSpec) return resource;

  const uniqueNames = Array.from(new Set(secretNames.filter(Boolean)));
  podSpec.imagePullSecrets = uniqueNames.map((name) => ({ name }));
  return resource;
}
