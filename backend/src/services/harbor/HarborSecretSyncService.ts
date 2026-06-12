/**
 * Harbor 拉取凭证同步到 Kubernetes Secret
 */
import axios from 'axios';
import https from 'https';
import { Cloud } from '../../entities/Cloud';
import { HarborRegistry } from '../../entities/harbor/HarborRegistry';
import { AppDataSource } from '../../config/database';
import { buildK8sUrl } from '../../routes/clouds/harvester/harvester.cache.container-shared';
import { getJsonOnce, resolveHarvesterCloudKubeToken } from '../clouds/harvester/utils';
import { logger } from '../../utils/logger';

const harborLog = logger.child('HarborSecretSync');

export interface HarborK8sClient {
  origin: string;
  token: string;
  insecure: boolean;
}

export interface ManagedHarborPullSecretRef {
  name: string;
  namespace: string;
}

export interface HarborPullSecretRefreshResult {
  updated: number;
  failed: number;
  details: Array<{ cloudId: string; namespace: string; secretName: string; ok: boolean; error?: string }>;
}

export function isHarvesterCloud(cloud: Cloud): boolean {
  const provider = String((cloud.config as any)?.provider || '')
    .toLowerCase()
    .trim();
  return (
    provider === 'harvester' ||
    provider === 'cloudmap' ||
    provider === 'cloudmap.private' ||
    provider === 'cloudmap.edge'
  );
}

/** 与容器路由 buildK8sUrl / resolveSteveClusterOrigin 对齐，保留 Rancher 集群路径 */
export function resolveHarvesterClusterOrigin(base: string): string {
  let origin = (base || '').replace(/\/+$/, '');
  if (origin.includes('/k8s/clusters/')) {
    return origin;
  }

  try {
    const u = new URL(origin);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = origin.replace(/\/v[0-9].*$/, '');
  }

  return `${origin}/k8s/clusters/local`;
}

export function getHarvesterClient(cloud: Cloud): HarborK8sClient {
  const insecure = !!(cloud.config as any)?.ignoreTls;
  const token = resolveHarvesterCloudKubeToken(cloud);
  return {
    origin: resolveHarvesterClusterOrigin(cloud.endpoint || ''),
    token,
    insecure,
  };
}

export function decryptHarborPassword(encrypted: string): string {
  return Buffer.from(encrypted, 'base64').toString().split('').reverse().join('');
}

export function buildHarborRegistryServerHost(harborUrl: string): string {
  let registryUrl = harborUrl.replace(/^https?:\/\//, '');
  return registryUrl.split('/')[0];
}

export function normalizeHarborRegistryHostForMatch(host: string): string {
  let normalized = buildHarborRegistryServerHost(host).toLowerCase();
  if (normalized.endsWith(':443')) normalized = normalized.slice(0, -4);
  if (normalized.endsWith(':80')) normalized = normalized.slice(0, -3);
  return normalized;
}

export function decodeDockerConfigRegistryHosts(secret: any): string[] {
  try {
    const raw = secret?.data?.['.dockerconfigjson'];
    if (!raw) return [];
    const config = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    return Object.keys(config.auths || {});
  } catch {
    return [];
  }
}

const HARBOR_PULL_SECRET_NAME_RE = /^harbor-([0-9a-f-]{36})-pull-secret$/i;

export function isHarborPullSecretName(name: string | undefined, harborId: string): boolean {
  if (!name) return false;
  return name === `harbor-${harborId}-pull-secret`;
}

/** 从平台标准 Secret 名称解析绑定的 Harbor 实例 ID */
export function getHarborIdFromPullSecretName(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const matched = name.match(HARBOR_PULL_SECRET_NAME_RE);
  return matched?.[1];
}

function isDockerConfigPullSecret(secret: any): boolean {
  return (
    secret?.type === 'kubernetes.io/dockerconfigjson' ||
    !!secret?.data?.['.dockerconfigjson']
  );
}

function secretMatchesHarborRegistry(secret: any, harborId: string, harborHost: string): boolean {
  if (!isDockerConfigPullSecret(secret)) return false;
  if (isManagedHarborPullSecret(secret, harborId)) return true;

  const name = secret?.metadata?.name as string | undefined;
  if (isHarborPullSecretName(name, harborId)) return true;

  // 名称已绑定其它 Harbor 实例时，不因仓库地址相同而误更新
  const boundHarborId = getHarborIdFromPullSecretName(name);
  if (boundHarborId && boundHarborId !== harborId) return false;

  const labels = secret?.metadata?.labels || {};
  const annotations = secret?.metadata?.annotations || {};
  const labeledHarborId =
    labels['compute-tower.io/harbor-id'] || annotations['compute-tower.io/harbor-id'];
  if (labeledHarborId && labeledHarborId !== harborId) return false;

  const target = normalizeHarborRegistryHostForMatch(harborHost);
  return decodeDockerConfigRegistryHosts(secret).some(
    (server) => normalizeHarborRegistryHostForMatch(server) === target,
  );
}

async function listClusterSecrets(cloud: Cloud, labelSelector?: string): Promise<any[]> {
  const insecure = !!(cloud.config as any)?.ignoreTls;
  const token = resolveHarvesterCloudKubeToken(cloud);
  const base = cloud.endpoint || '';
  let listUrl = buildK8sUrl(base, '/api/v1/secrets');
  if (labelSelector) {
    listUrl += `?labelSelector=${encodeURIComponent(labelSelector)}`;
  }
  try {
    const result = await getJsonOnce(listUrl, token, insecure, true);
    return result?.items || [];
  } catch (error: any) {
    harborLog.warn(`列举集群 Secret 失败: cloud=${cloud.id}, ${error.message}`);
    return [];
  }
}

/** 密码变更刷新用：包含平台托管 Secret，以及 dockerconfigjson 中指向该 Harbor 的 Secret */
export async function listHarborPullSecretsForRefresh(
  cloud: Cloud,
  harborId: string,
  harborHost: string,
): Promise<ManagedHarborPullSecretRef[]> {
  const seen = new Set<string>();
  const matched: ManagedHarborPullSecretRef[] = [];

  const pushItem = (item: any) => {
    const key = `${item.metadata?.namespace}/${item.metadata?.name}`;
    if (!item.metadata?.name || !item.metadata?.namespace || seen.has(key)) return;
    if (!secretMatchesHarborRegistry(item, harborId, harborHost)) return;
    seen.add(key);
    matched.push({
      name: item.metadata.name as string,
      namespace: item.metadata.namespace as string,
    });
  };

  const labeled = await listClusterSecrets(cloud, `compute-tower.io/harbor-id=${harborId}`);
  labeled.forEach(pushItem);

  const all = await listClusterSecrets(cloud);
  all.forEach(pushItem);

  return matched;
}

export function buildDockerConfigJson(
  server: string,
  username: string,
  password: string,
  email?: string,
): string {
  const authString = Buffer.from(`${username}:${password}`).toString('base64');
  const dockerConfig = {
    auths: {
      [server]: {
        username,
        password,
        auth: authString,
        ...(email && { email }),
      },
    },
  };
  return Buffer.from(JSON.stringify(dockerConfig)).toString('base64');
}

function decodeDockerConfigAuths(secret: any): Record<string, Record<string, unknown>> {
  try {
    const raw = secret?.data?.['.dockerconfigjson'];
    if (!raw) return {};
    const config = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    return { ...(config.auths || {}) };
  } catch {
    return {};
  }
}

/** 更新 dockerconfigjson：覆盖所有指向该 Harbor 的 auths 项，兼容 https/http 等不同 key */
export function buildUpdatedHarborDockerConfigJson(
  existingSecret: any,
  harbor: HarborRegistry,
): string {
  const registryUrl = buildHarborRegistryServerHost(harbor.url);
  const targetHost = normalizeHarborRegistryHostForMatch(registryUrl);
  const decryptedPassword = decryptHarborPassword(harbor.password);
  const username = harbor.username;
  const authString = Buffer.from(`${username}:${decryptedPassword}`).toString('base64');
  const auths = decodeDockerConfigAuths(existingSecret);

  let matched = false;
  for (const key of Object.keys(auths)) {
    if (normalizeHarborRegistryHostForMatch(key) !== targetHost) continue;
    auths[key] = {
      ...auths[key],
      username,
      password: decryptedPassword,
      auth: authString,
    };
    matched = true;
  }

  if (!matched) {
    auths[registryUrl] = {
      username,
      password: decryptedPassword,
      auth: authString,
    };
  }

  return Buffer.from(JSON.stringify({ auths })).toString('base64');
}

async function k8sRequest(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
  url: string,
  token: string,
  insecure: boolean,
  data?: any,
): Promise<any> {
  const httpsAgent = insecure ? new https.Agent({ rejectUnauthorized: false }) : undefined;

  const response = await axios({
    method,
    url,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    httpsAgent,
    data,
    validateStatus: () => true,
  });

  if (response.status >= 400) {
    const errorMsg = response.data?.message || response.data?.reason || '请求失败';
    throw new Error(errorMsg);
  }

  return response.data;
}

function isManagedHarborPullSecret(item: any, harborId: string): boolean {
  const labels = item?.metadata?.labels || {};
  const annotations = item?.metadata?.annotations || {};
  const boundHarborId =
    labels['compute-tower.io/harbor-id'] || annotations['compute-tower.io/harbor-id'];
  if (boundHarborId === harborId) return true;
  return isHarborPullSecretName(item?.metadata?.name, harborId);
}

export async function listManagedHarborPullSecrets(
  cloud: Cloud,
  harborId: string,
): Promise<ManagedHarborPullSecretRef[]> {
  const items = await listClusterSecrets(cloud);
  return items
    .filter((item: any) => isManagedHarborPullSecret(item, harborId))
    .map((item: any) => ({
      name: item.metadata.name as string,
      namespace: item.metadata.namespace as string,
    }));
}

export function buildHarborPullSecretBody(
  harbor: HarborRegistry,
  harborId: string,
  namespace: string,
  secretName: string,
): Record<string, any> {
  const registryUrl = buildHarborRegistryServerHost(harbor.url);
  const decryptedPassword = decryptHarborPassword(harbor.password);

  return {
    apiVersion: 'v1',
    kind: 'Secret',
    metadata: {
      name: secretName,
      namespace,
      labels: {
        'compute-tower.io/managed': 'true',
        'compute-tower.io/type': 'workload-pull-secret',
        'compute-tower.io/harbor-id': harborId,
      },
      annotations: {
        'compute-tower.io/managed': 'true',
        'compute-tower.io/type': 'workload-pull-secret',
        'compute-tower.io/harbor-name': harbor.name,
        'compute-tower.io/harbor-url': harbor.url,
      },
    },
    type: 'kubernetes.io/dockerconfigjson',
    data: {
      '.dockerconfigjson': buildDockerConfigJson(registryUrl, harbor.username, decryptedPassword),
    },
  };
}

function buildNamespacedSecretUrl(cloud: Cloud, namespace: string, secretName: string): string {
  return buildK8sUrl(cloud.endpoint || '', '/api/v1/secrets', namespace, secretName);
}

export async function upsertHarborPullSecret(
  harbor: HarborRegistry,
  harborId: string,
  cloud: Cloud,
  namespace: string,
  secretName?: string,
): Promise<{ secretName: string; exists: boolean }> {
  const client = getHarvesterClient(cloud);
  const finalSecretName = secretName || `harbor-${harborId}-pull-secret`;
  const secretBody = buildHarborPullSecretBody(harbor, harborId, namespace, finalSecretName);

  const checkUrl = buildNamespacedSecretUrl(cloud, namespace, finalSecretName);
  let exists = false;

  try {
    await k8sRequest('GET', checkUrl, client.token, client.insecure);
    exists = true;
  } catch (error: any) {
    if (!error.message.includes('not found') && !error.message.includes('404')) {
      throw error;
    }
  }

  if (exists) {
    await k8sRequest('PUT', checkUrl, client.token, client.insecure, secretBody);
  } else {
    const createUrl = buildK8sUrl(cloud.endpoint || '', '/api/v1/secrets', namespace);
    await k8sRequest('POST', createUrl, client.token, client.insecure, secretBody);
  }

  return { secretName: finalSecretName, exists };
}

/** 更新已存在的 Secret，保留 resourceVersion 等元数据 */
export async function updateHarborPullSecretData(
  harbor: HarborRegistry,
  harborId: string,
  cloud: Cloud,
  namespace: string,
  secretName: string,
): Promise<void> {
  const client = getHarvesterClient(cloud);
  const url = buildNamespacedSecretUrl(cloud, namespace, secretName);
  const existing = await k8sRequest('GET', url, client.token, client.insecure);
  const registryUrl = buildHarborRegistryServerHost(harbor.url);
  const decryptedPassword = decryptHarborPassword(harbor.password);
  const dockerConfigJson = isHarborPullSecretName(secretName, harborId)
    ? buildDockerConfigJson(registryUrl, harbor.username, decryptedPassword)
    : buildUpdatedHarborDockerConfigJson(existing, harbor);

  const updated = {
    ...existing,
    metadata: {
      ...existing.metadata,
      labels: {
        ...(existing.metadata?.labels || {}),
        'compute-tower.io/managed': 'true',
        'compute-tower.io/type': 'workload-pull-secret',
        'compute-tower.io/harbor-id': harborId,
      },
      annotations: {
        ...(existing.metadata?.annotations || {}),
        'compute-tower.io/managed': 'true',
        'compute-tower.io/type': 'workload-pull-secret',
        'compute-tower.io/harbor-name': harbor.name,
        'compute-tower.io/harbor-url': harbor.url,
      },
    },
    data: {
      ...(existing.data || {}),
      '.dockerconfigjson': dockerConfigJson,
    },
  };

  await k8sRequest('PUT', url, client.token, client.insecure, updated);
}

export interface RefreshHarborPullSecretsOptions {
  /** 仅更新指定资源池内的 Secret；未传则不跨资源池操作 */
  cloudId: string;
}

/**
 * Harbor 账号/密码/地址变更后，刷新指定 Harvester 资源池内相关拉取 Secret
 * （更新平台托管或 dockerconfigjson 指向该 Harbor 的 Secret，不会新建）
 */
export async function refreshManagedHarborPullSecrets(
  harbor: HarborRegistry,
  options: RefreshHarborPullSecretsOptions,
): Promise<HarborPullSecretRefreshResult> {
  const cloudRepo = AppDataSource.getRepository(Cloud);
  const cloud = await cloudRepo.findOne({ where: { id: options.cloudId } });
  const result: HarborPullSecretRefreshResult = { updated: 0, failed: 0, details: [] };
  const harborHost = buildHarborRegistryServerHost(harbor.url);

  if (!cloud) {
    harborLog.warn(`Harbor 凭证同步跳过：资源池不存在 cloud=${options.cloudId}`);
    return result;
  }
  if (!isHarvesterCloud(cloud)) {
    harborLog.warn(`Harbor 凭证同步跳过：非 Harvester 资源池 cloud=${options.cloudId}`);
    return result;
  }

  const clouds = [cloud];
  for (const currentCloud of clouds) {

    let secrets: ManagedHarborPullSecretRef[] = [];
    try {
      secrets = await listHarborPullSecretsForRefresh(currentCloud, harbor.id, harborHost);
    } catch (error: any) {
      harborLog.warn(`列举 Harbor 拉取 Secret 失败: cloud=${currentCloud.id}, ${error.message}`);
      continue;
    }

    if (secrets.length === 0) {
      harborLog.info(
        `Harbor 凭证变更后未找到可更新的拉取 Secret: harbor=${harbor.id}, cloud=${currentCloud.id}`,
      );
    }

    for (const secret of secrets) {
      try {
        await updateHarborPullSecretData(harbor, harbor.id, currentCloud, secret.namespace, secret.name);
        result.updated += 1;
        result.details.push({
          cloudId: currentCloud.id,
          namespace: secret.namespace,
          secretName: secret.name,
          ok: true,
        });
        harborLog.info(
          `自动更新 Harbor 拉取凭证: harbor=${harbor.id}, cloud=${currentCloud.id}, ns=${secret.namespace}, secret=${secret.name}`,
        );
      } catch (error: any) {
        result.failed += 1;
        result.details.push({
          cloudId: currentCloud.id,
          namespace: secret.namespace,
          secretName: secret.name,
          ok: false,
          error: error.message,
        });
        harborLog.warn(
          `自动更新 Harbor 拉取凭证失败: harbor=${harbor.id}, cloud=${currentCloud.id}, secret=${secret.name}, ${error.message}`,
        );
      }
    }
  }

  return result;
}

export async function deleteHarborPullSecret(
  cloud: Cloud,
  namespace: string,
  secretName: string,
): Promise<void> {
  const client = getHarvesterClient(cloud);
  const url = buildNamespacedSecretUrl(cloud, namespace, secretName);
  await k8sRequest('DELETE', url, client.token, client.insecure);
}
