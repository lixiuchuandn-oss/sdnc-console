/**
 * Ceph（Rook / Steve）：`/api/clouds/:id/ceph/rook/*`，与 monitoring 路径分离。
 */

import { API_BASE_URL, getAuthHeaders } from './api';

const cephRookBase = (cloudId: string) =>
  `${API_BASE_URL}/api/clouds/${encodeURIComponent(cloudId)}/ceph/rook`;

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
