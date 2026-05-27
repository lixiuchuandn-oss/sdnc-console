/**
 * Ceph（Rook / Steve）：`/api/clouds/:id/ceph/rook/*`，与 monitoring 路径分离。
 */

import type { CephHarvesterAddonValuesConfig } from '../pages/cnmc/clouds/Harvester/ceph/lib/cephHarvesterAddon';
import { API_BASE_URL, getAuthHeaders } from './api';

const cephRookBase = (cloudId: string) =>
  `${API_BASE_URL}/api/clouds/${encodeURIComponent(cloudId)}/ceph/rook`;

const cephApiBase = (cloudId: string) =>
  `${API_BASE_URL}/api/clouds/${encodeURIComponent(cloudId)}/ceph`;

async function apiGet<T = unknown>(
  url: string,
  options?: { signal?: AbortSignal; cache?: RequestCache },
): Promise<{ data: T | null; ok: boolean; error?: string }> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: getAuthHeaders(),
      credentials: 'include',
      signal: options?.signal,
      cache: options?.cache ?? 'default',
    });
    if (!res.ok) {
      const text = await res.text();
      let msg = res.statusText;
      try {
        const j = JSON.parse(text);
        msg = j?.message || j?.reason || msg;
      } catch {
        if (text) msg = text.slice(0, 240);
      }
      return { data: null, ok: false, error: msg };
    }
    const data = await res.json();
    return { data, ok: true };
  } catch (e: any) {
    return { data: null, ok: false, error: e?.message || '请求失败' };
  }
}

async function apiWrite<T = unknown>(
  url: string,
  method: 'POST' | 'PUT',
  body: unknown,
): Promise<{ data: T | null; ok: boolean; error?: string }> {
  try {
    const headers = { ...getAuthHeaders(), 'Content-Type': 'application/json' };
    const res = await fetch(url, {
      method,
      headers,
      credentials: 'include',
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      let msg = res.statusText;
      try {
        const j = JSON.parse(text);
        msg = j?.message || j?.reason || msg;
      } catch {
        if (text) msg = text.slice(0, 240);
      }
      return { data: null, ok: false, error: msg };
    }
    if (res.status === 204) {
      return { data: null as T | null, ok: true };
    }
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('json')) {
      return { data: null as T | null, ok: true };
    }
    const text = await res.text();
    if (!text.trim()) {
      return { data: null as T | null, ok: true };
    }
    const data = JSON.parse(text);
    return { data, ok: true };
  } catch (e: any) {
    return { data: null, ok: false, error: e?.message || '请求失败' };
  }
}

async function apiPatch<T = unknown>(url: string, body: unknown): Promise<{ data: T | null; ok: boolean; error?: string }> {
  try {
    const headers = { ...getAuthHeaders(), 'Content-Type': 'application/merge-patch+json' };
    const res = await fetch(url, {
      method: 'PATCH',
      headers,
      credentials: 'include',
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      let msg = res.statusText;
      try {
        const j = JSON.parse(text);
        msg = j?.message || j?.reason || msg;
      } catch {
        if (text) msg = text.slice(0, 240);
      }
      return { data: null, ok: false, error: msg };
    }
    const data = await res.json();
    return { data, ok: true };
  } catch (e: any) {
    return { data: null, ok: false, error: e?.message || '请求失败' };
  }
}

async function apiDelete(url: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(url, { method: 'DELETE', headers: getAuthHeaders(), credentials: 'include' });
    if (!res.ok) {
      const text = await res.text();
      let msg = res.statusText;
      try {
        const j = JSON.parse(text);
        msg = j?.message || j?.reason || msg;
      } catch {
        if (text) msg = text.slice(0, 240);
      }
      return { ok: false, error: msg };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || '请求失败' };
  }
}

/** Rook Steve 多资源聚合（与 monitoring/ceph-resources 同源字段，路径独立） */
export function fetchCephRookBundle(cloudId: string, options?: { signal?: AbortSignal; force?: boolean }) {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  const q = options?.force ? `?_=${Date.now()}` : '';
  return apiGet(`${cephRookBase(cloudId)}/bundle${q}`, {
    signal: options?.signal,
    cache: options?.force ? 'no-store' : 'default',
  });
}

export function getCephBlockPoolRook(cloudId: string, namespace: string, name: string, options?: { signal?: AbortSignal }) {
  if (!cloudId || !namespace.trim() || !name.trim()) {
    return Promise.resolve({ data: null, ok: false, error: '缺少参数' });
  }
  const url = `${cephRookBase(cloudId)}/block-pools/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`;
  return apiGet(url, { signal: options?.signal });
}

export function createCephBlockPoolRook(cloudId: string, body: unknown) {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  return apiWrite(`${cephRookBase(cloudId)}/block-pools`, 'POST', body);
}

export function replaceCephBlockPoolRook(cloudId: string, namespace: string, name: string, body: unknown) {
  if (!cloudId || !namespace.trim() || !name.trim()) {
    return Promise.resolve({ data: null, ok: false, error: '缺少参数' });
  }
  const url = `${cephRookBase(cloudId)}/block-pools/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`;
  return apiWrite(url, 'PUT', body);
}

export function patchCephBlockPoolRook(cloudId: string, namespace: string, name: string, patch: unknown) {
  if (!cloudId || !namespace.trim() || !name.trim()) {
    return Promise.resolve({ data: null, ok: false, error: '缺少参数' });
  }
  const url = `${cephRookBase(cloudId)}/block-pools/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`;
  return apiPatch(url, patch);
}

export function deleteCephBlockPoolRook(cloudId: string, namespace: string, name: string) {
  if (!cloudId || !namespace.trim() || !name.trim()) {
    return Promise.resolve({ ok: false, error: '缺少参数' });
  }
  const url = `${cephRookBase(cloudId)}/block-pools/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`;
  return apiDelete(url);
}

/** `CephRBDMirror` 单个资源（Steve，列表仍用 bundle） */
export function getCephRbdMirrorRook(
  cloudId: string,
  namespace: string,
  name: string,
  options?: { signal?: AbortSignal },
) {
  if (!cloudId || !namespace.trim() || !name.trim()) {
    return Promise.resolve({ data: null, ok: false, error: '缺少参数' });
  }
  const url = `${cephRookBase(cloudId)}/rbd-mirrors/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`;
  return apiGet(url, { signal: options?.signal });
}

/** `CephObjectStore` 单个资源（Steve，列表仍用 bundle） */
export function getCephObjectStoreRook(
  cloudId: string,
  namespace: string,
  name: string,
  options?: { signal?: AbortSignal },
) {
  if (!cloudId || !namespace.trim() || !name.trim()) {
    return Promise.resolve({ data: null, ok: false, error: '缺少参数' });
  }
  const url = `${cephRookBase(cloudId)}/object-stores/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`;
  return apiGet(url, { signal: options?.signal });
}

export function deleteCephObjectStoreRook(cloudId: string, namespace: string, name: string) {
  if (!cloudId || !namespace.trim() || !name.trim()) {
    return Promise.resolve({ ok: false, error: '缺少参数' });
  }
  const url = `${cephRookBase(cloudId)}/object-stores/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`;
  return apiDelete(url);
}

/** 创建 `CephObjectStore`（Steve POST；body 为完整 K8s CR JSON） */
export function createCephObjectStoreRook(cloudId: string, body: unknown) {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  return apiWrite(`${cephRookBase(cloudId)}/object-stores`, 'POST', body);
}

/** Rook CephObjectStoreUser（RGW 用户；AK/SK 由 Operator 写入 Secret） */
export function createCephObjectStoreUserRook(cloudId: string, body: unknown) {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  return apiWrite(`${cephRookBase(cloudId)}/object-store-users`, 'POST', body);
}

export function getCephObjectStoreUserRook(
  cloudId: string,
  namespace: string,
  name: string,
  options?: { signal?: AbortSignal },
) {
  if (!cloudId || !namespace.trim() || !name.trim()) {
    return Promise.resolve({ data: null, ok: false, error: '缺少参数' });
  }
  const url = `${cephRookBase(cloudId)}/object-store-users/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`;
  return apiGet(url, { signal: options?.signal });
}

export function patchCephObjectStoreUserRook(cloudId: string, namespace: string, name: string, patch: unknown) {
  if (!cloudId || !namespace.trim() || !name.trim()) {
    return Promise.resolve({ data: null, ok: false, error: '缺少参数' });
  }
  const url = `${cephRookBase(cloudId)}/object-store-users/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`;
  return apiPatch(url, patch);
}

export function replaceCephObjectStoreUserRook(cloudId: string, namespace: string, name: string, body: unknown) {
  if (!cloudId || !namespace.trim() || !name.trim()) {
    return Promise.resolve({ data: null, ok: false, error: '缺少参数' });
  }
  const url = `${cephRookBase(cloudId)}/object-store-users/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`;
  return apiWrite(url, 'PUT', body);
}

export function deleteCephObjectStoreUserRook(cloudId: string, namespace: string, name: string) {
  if (!cloudId || !namespace.trim() || !name.trim()) {
    return Promise.resolve({ ok: false, error: '缺少参数' });
  }
  const url = `${cephRookBase(cloudId)}/object-store-users/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`;
  return apiDelete(url);
}

export type RgwS3ConnectionPayload = {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
  forcePathStyle?: boolean;
};

/** 网关参数（可与 objectStoreUser 一并提交，由服务端解析 Secret 补全密钥） */
export type RgwS3GatewayPayload = {
  endpoint: string;
  region?: string;
  forcePathStyle?: boolean;
};

export type RgwS3ObjectStoreUserRef = {
  namespace: string;
  /** CephObjectStoreUser CR metadata.name */
  name: string;
};

function buildRgwS3ProxyBody(
  gateway: RgwS3GatewayPayload,
  objectStoreUser: RgwS3ObjectStoreUserRef | null,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    connection: {
      endpoint: gateway.endpoint,
      region: gateway.region ?? 'us-east-1',
      forcePathStyle: gateway.forcePathStyle !== false,
    },
  };
  if (objectStoreUser?.namespace?.trim() && objectStoreUser?.name?.trim()) {
    body.objectStoreUser = {
      namespace: objectStoreUser.namespace.trim(),
      name: objectStoreUser.name.trim(),
    };
  }
  return body;
}

const cephRgwS3Base = (cloudId: string) =>
  `${API_BASE_URL}/api/clouds/${encodeURIComponent(cloudId)}/ceph/rgw/s3`;

/** Tower 按 CephObjectStore（namespace/name）保存的 S3 客户端网关参数（读写 clouds.config） */
export type RgwGatewayClientConfigResponse = {
  byStore: Record<string, RgwS3GatewayPayload>;
};

export function fetchRgwGatewayClientConfig(cloudId: string, options?: { signal?: AbortSignal; force?: boolean }) {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  const q = options?.force ? `?_=${Date.now()}` : '';
  return apiGet<RgwGatewayClientConfigResponse>(`${cephRgwS3Base(cloudId)}/gateway-client-config${q}`, {
    signal: options?.signal,
    cache: options?.force ? 'no-store' : 'default',
  });
}

export function putRgwGatewayClientConfig(
  cloudId: string,
  namespace: string,
  objectStoreName: string,
  body: { endpoint?: string; region?: string; forcePathStyle?: boolean },
) {
  if (!cloudId || !namespace.trim() || !objectStoreName.trim()) {
    return Promise.resolve({ data: null, ok: false, error: '缺少参数' });
  }
  const url = `${cephRgwS3Base(cloudId)}/gateway-client-config/${encodeURIComponent(namespace.trim())}/${encodeURIComponent(objectStoreName.trim())}`;
  return apiWrite<RgwGatewayClientConfigResponse>(url, 'PUT', body);
}

/** RGW / S3：列举存储桶（Tower 代发） */
export function rgwS3ListBuckets(
  cloudId: string,
  gateway: RgwS3GatewayPayload,
  objectStoreUser: RgwS3ObjectStoreUserRef | null,
) {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  return apiWrite(`${cephRgwS3Base(cloudId)}/list-buckets`, 'POST', buildRgwS3ProxyBody(gateway, objectStoreUser));
}

export function rgwS3CreateBucket(
  cloudId: string,
  gateway: RgwS3GatewayPayload,
  objectStoreUser: RgwS3ObjectStoreUserRef | null,
  bucket: string,
) {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  return apiWrite(`${cephRgwS3Base(cloudId)}/buckets`, 'POST', {
    ...buildRgwS3ProxyBody(gateway, objectStoreUser),
    bucket,
  });
}

export function rgwS3DeleteBucket(
  cloudId: string,
  gateway: RgwS3GatewayPayload,
  objectStoreUser: RgwS3ObjectStoreUserRef | null,
  bucket: string,
) {
  if (!cloudId) return Promise.resolve({ ok: false, error: '缺少 cloudId' });
  return apiWrite(`${cephRgwS3Base(cloudId)}/delete-bucket`, 'POST', {
    ...buildRgwS3ProxyBody(gateway, objectStoreUser),
    bucket,
  });
}

export function rgwS3ListObjects(
  cloudId: string,
  gateway: RgwS3GatewayPayload,
  objectStoreUser: RgwS3ObjectStoreUserRef | null,
  opts: { bucket: string; prefix?: string; continuationToken?: string; maxKeys?: number },
) {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  return apiWrite(`${cephRgwS3Base(cloudId)}/list-objects`, 'POST', {
    ...buildRgwS3ProxyBody(gateway, objectStoreUser),
    bucket: opts.bucket,
    prefix: opts.prefix,
    continuationToken: opts.continuationToken,
    maxKeys: opts.maxKeys,
  });
}

/** RGW：读取 CephObjectStoreUser 关联 Secret（管理员；响应含 AK/SK，勿写日志） */
export function fetchRgwRookSecret(
  cloudId: string,
  namespace: string,
  name: string,
  options?: { signal?: AbortSignal },
) {
  if (!cloudId || !namespace.trim() || !name.trim()) {
    return Promise.resolve({ data: null, ok: false, error: '缺少参数' });
  }
  const url = `${cephRgwS3Base(cloudId)}/rook-secret/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`;
  return apiGet(url, { signal: options?.signal, cache: 'no-store' });
}

export type CephHarvesterAddonStatusResponse = {
  exists: boolean;
  enabled: boolean;
  deployStatus: string;
  phase: 'not_installed' | 'success' | 'progress' | 'failed' | 'unknown';
  message: string;
  valuesContent?: string | null;
  config?: CephHarvesterAddonValuesConfig | null;
  _tower?: { unreachable?: boolean };
};

export type CephHarvesterAddonApplyBody = {
  config?: CephHarvesterAddonValuesConfig;
  replicaSize?: number;
  nodes?: { nodeName: string; deviceName: string; metadataDevice?: string; blockDbSize?: string }[];
  valuesContent?: string;
  /** 当前登录管理员密码（服务端校验，不落库） */
  password: string;
};

/** Harvester rook-ceph Addon 状态 */
export function fetchCephHarvesterAddon(
  cloudId: string,
  options?: { force?: boolean; signal?: AbortSignal },
) {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  const q = options?.force ? '?force=1' : '';
  return apiGet<CephHarvesterAddonStatusResponse>(
    `${cephApiBase(cloudId)}/harvester-addon${q}`,
    { signal: options?.signal, cache: options?.force ? 'no-store' : 'default' },
  );
}

/** 创建或更新并启用 rook-ceph Addon */
export function applyCephHarvesterAddon(cloudId: string, body: CephHarvesterAddonApplyBody) {
  if (!cloudId) return Promise.resolve({ data: null, ok: false, error: '缺少 cloudId' });
  return apiWrite<CephHarvesterAddonStatusResponse & { applied?: string }>(
    `${cephApiBase(cloudId)}/harvester-addon`,
    'POST',
    body,
  );
}
