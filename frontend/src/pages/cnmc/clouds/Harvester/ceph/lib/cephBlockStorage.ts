/**
 * 块存储 Tab：RADOS 命名空间、RBD Mirror、COSI 等列表行映射（数据来自 Rook bundle / Steve GET）。
 */

import { rookResourceRowKey } from './cephStorage';

export type CephRadosNamespaceRow = {
  key: string;
  name: string;
  namespace: string;
  blockPoolName: string;
  phase: string;
  raw: unknown;
};

export type CephRbdMirrorRow = {
  key: string;
  name: string;
  namespace: string;
  phase: string;
  raw: unknown;
};

export type CephCosiDriverRow = {
  key: string;
  name: string;
  namespace: string;
  phase: string;
  raw: unknown;
};

/** Rook `CephObjectStore` 列表行 */
export type CephObjectStoreRow = {
  key: string;
  name: string;
  namespace: string;
  phase: string;
  raw: unknown;
};

function str(v: unknown): string {
  return typeof v === 'string' && v.trim() ? v.trim() : '—';
}

export function radosNamespaceCrToRow(r: any, i: number): CephRadosNamespaceRow {
  const ns = r?.metadata?.namespace;
  const nm = r?.metadata?.name;
  const bpRaw =
    typeof r?.spec?.blockPoolName === 'string' && r.spec.blockPoolName.trim()
      ? r.spec.blockPoolName.trim()
      : typeof r?.spec?.blockPoolRef?.name === 'string' && r.spec.blockPoolRef.name.trim()
        ? r.spec.blockPoolRef.name.trim()
        : '';
  return {
    key: rookResourceRowKey(r, i),
    name: str(nm),
    namespace: str(ns),
    blockPoolName: bpRaw || '—',
    phase: str(r?.status?.phase ?? r?.status?.info),
    raw: r,
  };
}

export function rbdMirrorCrToRow(r: any, i: number): CephRbdMirrorRow {
  return {
    key: rookResourceRowKey(r, i),
    name: str(r?.metadata?.name),
    namespace: str(r?.metadata?.namespace),
    phase: str(r?.status?.phase ?? r?.status?.info),
    raw: r,
  };
}

export function cosiDriverCrToRow(r: any, i: number): CephCosiDriverRow {
  return {
    key: rookResourceRowKey(r, i),
    name: str(r?.metadata?.name),
    namespace: str(r?.metadata?.namespace),
    phase: str(r?.status?.phase),
    raw: r,
  };
}

export function objectStoreCrToRow(r: any, i: number): CephObjectStoreRow {
  return {
    key: rookResourceRowKey(r, i),
    name: str(r?.metadata?.name),
    namespace: str(r?.metadata?.namespace),
    phase: str(r?.status?.phase ?? r?.status?.info),
    raw: r,
  };
}
