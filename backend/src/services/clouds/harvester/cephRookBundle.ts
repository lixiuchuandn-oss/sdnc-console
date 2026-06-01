/**
 * Rook Ceph：经 Harvester Steve 拉取多类 CR 列表，供监控聚合与独立 Ceph API 复用。
 * Steve 路径：`{plural}.ceph.rook.io` 与 `ceph.rook.io.{plural}` 双探测（与集群 API 注册一致）。
 */

import { getJsonOnce, resolveHarvesterCloudKubeToken } from './utils';

const PAGESIZE = 'pagesize=100000';
const EXCLUDE = 'exclude=metadata.managedFields';

function normalizeOrigin(endpoint: string): string {
  try {
    const u = new URL(endpoint);
    return `${u.protocol}//${u.host}`;
  } catch {
    return String(endpoint || '')
      .replace(/\/+$/, '')
      .replace(/\/v[0-9].*$/, '');
  }
}

function isUnreachableError(e: any): boolean {
  const status = e?.status;
  const code = e?.code || (e?.cause as any)?.code;
  return (
    status === 503 ||
    code === 'ECONNRESET' ||
    code === 'ECONNREFUSED' ||
    code === 'ETIMEDOUT' ||
    code === 'NETWORK_ERROR'
  );
}

/** 从 Steve 列表 JSON 中取出对象数组 */
export function steveListToItems(payload: any): any[] {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.data?.items)) return payload.data.items;
  return [];
}

/**
 * 依次尝试 plural.group 与 group.plural 两种 Steve 路径，404 试下一个；返回 items[]。
 * 不可达错误向上抛出；其它非 404/403 错误返回空数组。
 */
export async function fetchSteveRookListItems(
  origin: string,
  token: string,
  insecure: boolean,
  resourcePaths: string[],
): Promise<any[]> {
  for (const p of resourcePaths) {
    const url = `${origin}/v1/harvester/${p}?${PAGESIZE}&${EXCLUDE}`;
    try {
      const data = await getJsonOnce(url, token, insecure, true);
      return steveListToItems(data);
    } catch (e: any) {
      if (isUnreachableError(e)) throw e;
      const status = (e as any).status;
      if (status === 404) continue;
      if (status === 403) continue;
      return [];
    }
  }
  return [];
}

/** 与 `kubectl api-resources | grep rook.io` 常见命名对齐的聚合键（camelCase） */
const ROOK_STEVE_JOBS = [
  ['clusters', ['cephclusters.ceph.rook.io', 'ceph.rook.io.cephclusters']],
  ['blockPools', ['cephblockpools.ceph.rook.io', 'ceph.rook.io.cephblockpools']],
  [
    'radosNamespaces',
    ['cephblockpoolradosnamespaces.ceph.rook.io', 'ceph.rook.io.cephblockpoolradosnamespaces'],
  ],
  ['filesystems', ['cephfilesystems.ceph.rook.io', 'ceph.rook.io.cephfilesystems']],
  [
    'filesystemSubvolumeGroups',
    ['cephfilesystemsubvolumegroups.ceph.rook.io', 'ceph.rook.io.cephfilesystemsubvolumegroups'],
  ],
  [
    'filesystemMirrors',
    ['cephfilesystemmirrors.ceph.rook.io', 'ceph.rook.io.cephfilesystemmirrors'],
  ],
  ['nfses', ['cephnfses.ceph.rook.io', 'ceph.rook.io.cephnfses']],
  ['objectStores', ['cephobjectstores.ceph.rook.io', 'ceph.rook.io.cephobjectstores']],
  ['objectStoreUsers', ['cephobjectstoreusers.ceph.rook.io', 'ceph.rook.io.cephobjectstoreusers']],
  ['objectRealms', ['cephobjectrealms.ceph.rook.io', 'ceph.rook.io.cephobjectrealms']],
  ['objectZones', ['cephobjectzones.ceph.rook.io', 'ceph.rook.io.cephobjectzones']],
  ['objectZoneGroups', ['cephobjectzonegroups.ceph.rook.io', 'ceph.rook.io.cephobjectzonegroups']],
  ['bucketTopics', ['cephbuckettopics.ceph.rook.io', 'ceph.rook.io.cephbuckettopics']],
  [
    'bucketNotifications',
    ['cephbucketnotifications.ceph.rook.io', 'ceph.rook.io.cephbucketnotifications'],
  ],
  ['cephClients', ['cephclients.ceph.rook.io', 'ceph.rook.io.cephclients']],
  ['cosiDrivers', ['cephcosidrivers.ceph.rook.io', 'ceph.rook.io.cephcosidrivers']],
  ['rbdMirrors', ['cephrbdmirrors.ceph.rook.io', 'ceph.rook.io.cephrbdmirrors']],
] as const;

export type CephRookBundleKey = (typeof ROOK_STEVE_JOBS)[number][0];

export type CephRookResourceBundle = Record<CephRookBundleKey, any[]>;

export type CephRookBundleCloudInput = {
  endpoint?: string;
  secretKey?: string;
  config?: { ignoreTls?: boolean; apiToken?: string; token?: string };
};

export function emptyCephRookBundle(): CephRookResourceBundle {
  const o = {} as CephRookResourceBundle;
  for (const [key] of ROOK_STEVE_JOBS) {
    o[key] = [];
  }
  return o;
}

/**
 * 拉取 Rook Ceph 相关 Steve 列表并聚合为一块 JSON（`monitoring/ceph-resources` 与 `/ceph/rook/bundle` 同源）。
 */
export async function fetchCephRookResourceBundle(
  cloud: CephRookBundleCloudInput,
): Promise<CephRookResourceBundle> {
  const insecure = !!cloud.config?.ignoreTls;
  const origin = normalizeOrigin(cloud.endpoint || '');
  const token = resolveHarvesterCloudKubeToken(cloud);
  const out = emptyCephRookBundle();

  for (const [key, paths] of ROOK_STEVE_JOBS) {
    try {
      out[key] = await fetchSteveRookListItems(origin, token, insecure, [...paths]);
    } catch (e: any) {
      if (isUnreachableError(e)) throw e;
      out[key] = [];
    }
  }

  return out;
}
