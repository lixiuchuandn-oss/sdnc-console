/**
 * Rook Ceph：经 Harvester Steve 对 namespaced CR 做 GET / POST / PUT / PATCH / DELETE。
 * URL 形态：`{endpointBase}/v1/harvester/{steveResourceType}/{namespace}/{name}`（集合 POST 无尾部 ns/name）。
 */

import { requestJson, resolveHarvesterCloudKubeToken } from './utils';

/** 与 logging.handlers 一致：保留 Rancher `.../k8s/clusters/{id}` 前缀 */
export function harvesterApiBase(endpoint: string): string {
  let base = String(endpoint || '').replace(/\/+$/, '');
  if (!base.includes('/k8s/clusters/')) {
    base = base.replace(/\/v[0-9]+(\/harvester)?$/, '');
  }
  return base || '';
}

export type CephRookSteveCloudInput = {
  endpoint?: string;
  secretKey?: string;
  config?: { ignoreTls?: boolean; apiToken?: string; token?: string };
};

const CEPH_CLUSTERS = ['cephclusters.ceph.rook.io', 'ceph.rook.io.cephclusters'] as const;
const CEPH_BLOCK_POOLS = ['cephblockpools.ceph.rook.io', 'ceph.rook.io.cephblockpools'] as const;
const CEPH_FILESYSTEMS = ['cephfilesystems.ceph.rook.io', 'ceph.rook.io.cephfilesystems'] as const;
const CEPH_OBJECT_STORES = ['cephobjectstores.ceph.rook.io', 'ceph.rook.io.cephobjectstores'] as const;
const CEPH_RADOS_NAMESPACES = [
  'cephblockpoolradosnamespaces.ceph.rook.io',
  'ceph.rook.io.cephblockpoolradosnamespaces',
] as const;
const CEPH_RBD_MIRRORS = ['cephrbdmirrors.ceph.rook.io', 'ceph.rook.io.cephrbdmirrors'] as const;

export const CEPH_ROOK_STEVE = {
  clusters: CEPH_CLUSTERS,
  blockPools: CEPH_BLOCK_POOLS,
  filesystems: CEPH_FILESYSTEMS,
  objectStores: CEPH_OBJECT_STORES,
  radosNamespaces: CEPH_RADOS_NAMESPACES,
  rbdMirrors: CEPH_RBD_MIRRORS,
} as const;

function enc(s: string): string {
  return encodeURIComponent(s);
}

/**
 * 依次尝试多种 Steve 资源路径；集合操作 suffix 为空；单资源为 `ns/name`。
 */
export async function steveRookRequest(
  cloud: CephRookSteveCloudInput,
  method: string,
  stevePathCandidates: readonly string[],
  resourceSuffix: string,
  body?: any,
  extraHeaders?: Record<string, string>,
): Promise<any> {
  const base = harvesterApiBase(cloud.endpoint || '');
  const token = resolveHarvesterCloudKubeToken(cloud);
  const insecure = !!cloud.config?.ignoreTls;
  const suffix = resourceSuffix ? `/${resourceSuffix}` : '';
  let lastErr: any;
  for (const p of stevePathCandidates) {
    const url = `${base}/v1/harvester/${p}${suffix}`;
    try {
      return await requestJson(method, url, token, insecure, body, extraHeaders);
    } catch (e: any) {
      lastErr = e;
      if (e?.status === 404) continue;
      throw e;
    }
  }
  throw lastErr || { status: 502, message: 'Steve Rook 路径均不可用' };
}

export function namespacedPair(namespace: string, name: string): string {
  return `${enc(namespace)}/${enc(name)}`;
}

/** GET 单个资源 */
export function rookGetOne(
  cloud: CephRookSteveCloudInput,
  paths: readonly string[],
  namespace: string,
  name: string,
): Promise<any> {
  return steveRookRequest(cloud, 'GET', paths, namespacedPair(namespace, name));
}

/** POST 创建（body 须含 metadata.namespace、metadata.name） */
export function rookCreate(cloud: CephRookSteveCloudInput, paths: readonly string[], body: unknown): Promise<any> {
  return steveRookRequest(cloud, 'POST', paths, '', body);
}

/** PUT 全量替换 */
export function rookReplace(
  cloud: CephRookSteveCloudInput,
  paths: readonly string[],
  namespace: string,
  name: string,
  body: unknown,
): Promise<any> {
  return steveRookRequest(cloud, 'PUT', paths, namespacedPair(namespace, name), body);
}

/** strategic merge / JSON merge patch — 由调用方传完整或部分对象，与 Steve 行为一致 */
export function rookPatchMerge(
  cloud: CephRookSteveCloudInput,
  paths: readonly string[],
  namespace: string,
  name: string,
  patchBody: unknown,
): Promise<any> {
  return steveRookRequest(cloud, 'PATCH', paths, namespacedPair(namespace, name), patchBody, {
    'Content-Type': 'application/merge-patch+json',
  });
}

export function rookDelete(
  cloud: CephRookSteveCloudInput,
  paths: readonly string[],
  namespace: string,
  name: string,
): Promise<any> {
  return steveRookRequest(cloud, 'DELETE', paths, namespacedPair(namespace, name));
}
