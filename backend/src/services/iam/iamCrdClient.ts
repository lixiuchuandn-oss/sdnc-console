import {
  IAM_CRD_API_GROUP,
  IAM_CRD_API_VERSION,
  IAM_CREATOR_LABEL,
  IAM_CREATOR_VALUE,
  IAM_MANAGED_LABEL,
  IAM_ORGANIZATION_KIND,
  IAM_ORGANIZATION_PLURAL,
  IAM_TENANT_KIND,
  IAM_TENANT_PLURAL,
  IAM_USER_SPACE_KIND,
  IAM_USER_SPACE_PLURAL,
} from './iamCrdConstants';
import { getJsonOnce, requestJson, resolveHarvesterCloudKubeToken } from '../clouds/harvester/utils';

type CloudLike = {
  endpoint?: string;
  secretKey?: string | null;
  config?: any;
};

function harvesterApiRoots(endpoint: string): string[] {
  const base = String(endpoint || '').trim().replace(/\/+$/, '');
  if (!base) return [];

  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }

  const roots = new Set<string>();
  roots.add(origin);
  if (!base.includes('/k8s/clusters/')) {
    const stripped = base.replace(/\/v[0-9]+(\/harvester)?$/, '');
    roots.add(`${stripped}/k8s/clusters/local`);
  }
  return Array.from(roots);
}

function buildCandidateUrls(endpoint: string, pathSuffix: string): string[] {
  const seg = pathSuffix.startsWith('/') ? pathSuffix : `/${pathSuffix}`;
  return harvesterApiRoots(endpoint).map((root) => `${root.replace(/\/+$/, '')}${seg}`);
}

function iamCollectionPath(plural: string): string {
  return `/apis/${IAM_CRD_API_GROUP}/${IAM_CRD_API_VERSION}/${plural}`;
}

function iamItemPath(plural: string, name: string): string {
  return `${iamCollectionPath(plural)}/${encodeURIComponent(String(name || '').trim())}`;
}

async function requestFirstOk<T>(
  urls: string[],
  token: string,
  insecure: boolean,
  fn: (url: string) => Promise<T>,
): Promise<T> {
  let lastErr: any = null;
  for (const url of urls) {
    try {
      return await fn(url);
    } catch (e: any) {
      lastErr = e;
      if (e?.status === 404) continue;
    }
  }
  if (lastErr) throw lastErr;
  throw new Error('IAM CRD API 不可用');
}

function baseMetadata(name: string) {
  return {
    name: String(name || '').trim(),
    labels: {
      [IAM_MANAGED_LABEL]: 'true',
      [IAM_CREATOR_LABEL]: IAM_CREATOR_VALUE,
    },
  };
}

function mapTenantPhase(status: string | undefined): string {
  switch (String(status || 'active').toLowerCase()) {
    case 'inactive':
      return 'Inactive';
    case 'suspended':
      return 'Suspended';
    default:
      return 'Active';
  }
}

function mapOrganizationPhase(status: string | undefined): string {
  return String(status || 'active').toLowerCase() === 'inactive' ? 'Inactive' : 'Active';
}

export function buildTenantCrdManifest(input: {
  id: string;
  name: string;
  description?: string | null;
  status?: string;
  rootOrganizationId?: string | null;
}) {
  const manifest: Record<string, unknown> = {
    apiVersion: `${IAM_CRD_API_GROUP}/${IAM_CRD_API_VERSION}`,
    kind: IAM_TENANT_KIND,
    metadata: baseMetadata(input.id),
    spec: {
      displayName: String(input.name || '').trim(),
      desiredPhase: mapTenantPhase(input.status),
    },
  };

  const desc = input.description != null ? String(input.description) : '';
  if (desc) {
    (manifest.spec as Record<string, unknown>).description = desc;
  }

  const rootRef = String(input.rootOrganizationId || '').trim();
  if (rootRef) {
    (manifest.spec as Record<string, unknown>).rootOrganizationRef = { name: rootRef };
  }

  return manifest;
}

function mapUserSpacePhase(status: string | undefined): string {
  return String(status || 'active').toLowerCase() === 'inactive' ? 'Inactive' : 'Active';
}

function parsePermissions(raw: string | undefined | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((x) => String(x).trim()).filter(Boolean);
    }
  } catch {
    /* fall through */
  }
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function buildUserSpaceCrdManifest(input: {
  id: string;
  name: string;
  description?: string | null;
  tenantId: string;
  organizationId?: string | null;
  cloudId: string;
  namespace?: string | null;
  permissions?: string | null;
  cpuQuota?: number;
  memoryQuota?: number;
  storageQuota?: number;
  status?: string;
}) {
  const spec: Record<string, unknown> = {
    displayName: String(input.name || '').trim(),
    tenantRef: { name: String(input.tenantId || '').trim() },
    cloudRef: { name: String(input.cloudId || '').trim() },
    desiredPhase: mapUserSpacePhase(input.status),
    quota: {
      cpu: input.cpuQuota ?? 0,
      memoryGi: input.memoryQuota ?? 0,
      storageGi: input.storageQuota ?? 0,
    },
  };

  const desc = input.description != null ? String(input.description) : '';
  if (desc) {
    spec.description = desc;
  }

  const orgId = String(input.organizationId || '').trim();
  if (orgId) {
    spec.organizationRef = { name: orgId };
  }

  const ns = String(input.namespace || '').trim();
  if (ns) {
    spec.namespace = ns;
  }

  const perms = parsePermissions(input.permissions ?? undefined);
  if (perms.length > 0) {
    spec.permissions = perms;
  }

  return {
    apiVersion: `${IAM_CRD_API_GROUP}/${IAM_CRD_API_VERSION}`,
    kind: IAM_USER_SPACE_KIND,
    metadata: baseMetadata(input.id),
    spec,
  };
}

export function buildOrganizationCrdManifest(input: {
  id: string;
  name: string;
  description?: string | null;
  level: number;
  orderIndex?: number;
  tenantId: string;
  parentId?: string | null;
  status?: string;
}) {
  const spec: Record<string, unknown> = {
    displayName: String(input.name || '').trim(),
    level: input.level,
    tenantRef: { name: String(input.tenantId || '').trim() },
    desiredPhase: mapOrganizationPhase(input.status),
  };

  const desc = input.description != null ? String(input.description) : '';
  if (desc) {
    spec.description = desc;
  }

  if (input.orderIndex != null && input.orderIndex >= 0) {
    spec.orderIndex = input.orderIndex;
  }

  const parentId = String(input.parentId || '').trim();
  if (parentId) {
    spec.parentRef = { name: parentId };
  }

  return {
    apiVersion: `${IAM_CRD_API_GROUP}/${IAM_CRD_API_VERSION}`,
    kind: IAM_ORGANIZATION_KIND,
    metadata: baseMetadata(input.id),
    spec,
  };
}

async function upsertClusterCr(
  cloud: CloudLike,
  plural: string,
  name: string,
  manifest: Record<string, unknown>,
): Promise<any> {
  const token = resolveHarvesterCloudKubeToken(cloud);
  const insecure = !!cloud.config?.ignoreTls;
  const nameTrim = String(name || '').trim();
  if (!nameTrim) {
    throw Object.assign(new Error('IAM CRD metadata.name 不能为空'), { status: 400 });
  }

  const itemUrls = buildCandidateUrls(String(cloud.endpoint || ''), iamItemPath(plural, nameTrim));
  let existing: any = null;
  try {
    existing = await requestFirstOk(itemUrls, token, insecure, (url) =>
      getJsonOnce(url, token, insecure, true),
    );
  } catch (e: any) {
    if (e?.status !== 404) throw e;
  }

  if (existing?.metadata?.name) {
    const putBody = {
      ...existing,
      ...manifest,
      metadata: {
        ...(existing.metadata || {}),
        ...(manifest.metadata as object),
        name: nameTrim,
      },
    };
    return requestFirstOk(itemUrls, token, insecure, (url) =>
      requestJson('PUT', url, token, insecure, putBody),
    );
  }

  const collectionUrls = buildCandidateUrls(String(cloud.endpoint || ''), iamCollectionPath(plural));
  return requestFirstOk(collectionUrls, token, insecure, (url) =>
    requestJson('POST', url, token, insecure, manifest),
  );
}

export async function listIamCrItems(cloud: CloudLike, plural: string): Promise<any[]> {
  const token = resolveHarvesterCloudKubeToken(cloud);
  const insecure = !!cloud.config?.ignoreTls;
  const urls = buildCandidateUrls(String(cloud.endpoint || ''), iamCollectionPath(plural));

  let lastErr: any = null;
  for (const url of urls) {
    try {
      const data = await getJsonOnce(url, token, insecure, true);
      return Array.isArray(data?.items) ? data.items : [];
    } catch (e: any) {
      lastErr = e;
      if (e?.status === 404) continue;
      throw e;
    }
  }

  if (lastErr?.status === 404) {
    throw Object.assign(new Error('集群未安装 IAM CRD（iam.tower.io），无法读取租户数据'), { status: 502 });
  }
  if (lastErr) throw lastErr;
  throw new Error('IAM CRD API 不可用');
}

export async function upsertTenantCrd(
  cloud: CloudLike,
  input: Parameters<typeof buildTenantCrdManifest>[0],
): Promise<any> {
  const manifest = buildTenantCrdManifest(input);
  return upsertClusterCr(cloud, IAM_TENANT_PLURAL, input.id, manifest);
}

export async function upsertOrganizationCrd(
  cloud: CloudLike,
  input: Parameters<typeof buildOrganizationCrdManifest>[0],
): Promise<any> {
  const manifest = buildOrganizationCrdManifest(input);
  return upsertClusterCr(cloud, IAM_ORGANIZATION_PLURAL, input.id, manifest);
}

export async function deleteIamCrd(
  cloud: CloudLike,
  plural: string,
  name: string,
): Promise<void> {
  const token = resolveHarvesterCloudKubeToken(cloud);
  const insecure = !!cloud.config?.ignoreTls;
  const nameTrim = String(name || '').trim();
  if (!nameTrim) return;

  const urls = buildCandidateUrls(String(cloud.endpoint || ''), iamItemPath(plural, nameTrim));
  try {
    await requestFirstOk(urls, token, insecure, (url) =>
      requestJson('DELETE', url, token, insecure).then(() => undefined),
    );
  } catch (e: any) {
    if (e?.status === 404) return;
    throw e;
  }
}

export async function upsertUserSpaceCrd(
  cloud: CloudLike,
  input: Parameters<typeof buildUserSpaceCrdManifest>[0],
): Promise<any> {
  const manifest = buildUserSpaceCrdManifest(input);
  return upsertClusterCr(cloud, IAM_USER_SPACE_PLURAL, input.id, manifest);
}

export async function deleteUserSpaceCrd(cloud: CloudLike, userSpaceId: string): Promise<void> {
  return deleteIamCrd(cloud, IAM_USER_SPACE_PLURAL, userSpaceId);
}

export async function deleteTenantCrd(cloud: CloudLike, tenantId: string): Promise<void> {
  return deleteIamCrd(cloud, IAM_TENANT_PLURAL, tenantId);
}

export async function deleteOrganizationCrd(cloud: CloudLike, organizationId: string): Promise<void> {
  return deleteIamCrd(cloud, IAM_ORGANIZATION_PLURAL, organizationId);
}
