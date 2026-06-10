import { getJsonOnce, requestJson } from './clouds/harvester/utils';
import { buildK8sUrl, clearCacheByPrefix, getNamespacedResources } from '../routes/clouds/harvester/harvester.cache.container-shared';
import { isAutoSyncedPullSecret } from './registryManagedSecret';

function collectReferencedPullSecrets(workloads: any[]): Set<string> {
  const referenced = new Set<string>();
  for (const workload of workloads) {
    const lists = [
      workload?.spec?.template?.spec?.imagePullSecrets,
      workload?.spec?.jobTemplate?.spec?.template?.spec?.imagePullSecrets,
    ];
    for (const list of lists) {
      (list || []).forEach((item: { name?: string }) => {
        if (item?.name) referenced.add(item.name);
      });
    }
  }
  return referenced;
}

async function listNamespaceWorkloads(
  base: string,
  namespace: string,
  token: string,
  insecure: boolean,
): Promise<any[]> {
  const apiPaths = [
    '/apis/apps/v1/deployments',
    '/apis/apps/v1/statefulsets',
    '/apis/apps/v1/daemonsets',
    '/apis/batch/v1/jobs',
    '/apis/batch/v1/cronjobs',
  ];

  const items: any[] = [];
  for (const apiPath of apiPaths) {
    try {
      const list = await getNamespacedResources(base, apiPath, namespace, token, insecure);
      items.push(...list);
    } catch {
      // ignore list errors for individual types
    }
  }
  return items;
}

/** 工作负载删除后，清理不再被引用的自动同步拉取凭证 */
export async function cleanupOrphanedPullSecretsAfterWorkloadDelete(params: {
  cloudId: string;
  base: string;
  token: string;
  insecure: boolean;
  namespace: string;
  secretNames: string[];
}): Promise<void> {
  const { cloudId, base, token, insecure, namespace } = params;
  const secretNames = Array.from(new Set(params.secretNames.filter(Boolean)));
  if (secretNames.length === 0) return;

  const workloads = await listNamespaceWorkloads(base, namespace, token, insecure);
  const stillReferenced = collectReferencedPullSecrets(workloads);

  for (const secretName of secretNames) {
    if (stillReferenced.has(secretName)) continue;

    const getUrl = buildK8sUrl(base, '/api/v1/secrets', namespace, secretName);
    const secret = await getJsonOnce(getUrl, token, insecure, true);
    if (!secret || !isAutoSyncedPullSecret(secret)) continue;

    const deleteUrl = buildK8sUrl(base, '/api/v1/secrets', namespace, secretName);
    try {
      await requestJson('DELETE', deleteUrl, token, insecure);
    } catch (error: any) {
      console.warn(`[Workload 删除] 清理拉取凭证 ${secretName} 失败:`, error?.message || error);
    }
  }

  clearCacheByPrefix(`secrets:${cloudId}:`);
}

export function isWorkloadApiPath(apiPath: string): boolean {
  return (
    apiPath.includes('/deployments') ||
    apiPath.includes('/statefulsets') ||
    apiPath.includes('/daemonsets') ||
    apiPath.includes('/jobs') ||
    apiPath.includes('/cronjobs')
  );
}
