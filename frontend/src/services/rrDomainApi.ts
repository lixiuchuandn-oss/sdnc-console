import { apiDelete, apiPatch, apiPost, apiRequest, apiUpload, API_BASE_URL, getAuthHeaders } from './api';

export type RrDomainSource = 'manual' | 'excel_import';
export type RrDomainStatus = 'active' | 'archived';

export type RrDomainNode = {
  id: string;
  rrName: string;
  neighborAddress: string;
  remoteAs: number | null;
  localAs: number | null;
  clusterId: string | null;
  routerIdHint: string | null;
  priority: number;
  remark: string | null;
  sortOrder: number;
};

export type RrDomain = {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  remoteAs: number;
  localAs: number | null;
  source: RrDomainSource;
  status: RrDomainStatus;
  nodes: RrDomainNode[];
  createdAt: string;
  updatedAt: string;
};

export type RrDomainNodeInput = {
  rrName: string;
  neighborAddress: string;
  remoteAs?: number | null;
  localAs?: number | null;
  clusterId?: string | null;
  routerIdHint?: string | null;
  priority?: number;
  remark?: string | null;
};

export type RrDomainImportPreview = {
  domains: Array<{
    name: string;
    displayName: string;
    description: string | null;
    remoteAs: number;
    localAs: number | null;
    nodes: RrDomainNodeInput[];
    domainFieldWarnings: string[];
  }>;
  errors: string[];
  warnings: string[];
};

function unwrapData<T>(payload: unknown): T {
  if (payload && typeof payload === 'object' && 'data' in (payload as object)) {
    return (payload as { data: T }).data;
  }
  return payload as T;
}

export async function fetchRrDomains(options?: {
  skipCache?: boolean;
  status?: RrDomainStatus;
}): Promise<RrDomain[]> {
  const qs = options?.status ? `?status=${encodeURIComponent(options.status)}` : '';
  const res = await apiRequest(`/api/networks/rr-domains${qs}`, {
    skipCache: options?.skipCache ?? true,
  });
  const data = unwrapData<RrDomain[]>(res);
  return Array.isArray(data) ? data : [];
}

export async function fetchRrDomain(id: string): Promise<RrDomain> {
  const res = await apiRequest(`/api/networks/rr-domains/${encodeURIComponent(id)}`, {
    skipCache: true,
  });
  return unwrapData<RrDomain>(res);
}

export async function createRrDomain(body: {
  name: string;
  displayName: string;
  description?: string | null;
  remoteAs: number;
  localAs?: number | null;
  nodes: RrDomainNodeInput[];
}): Promise<RrDomain> {
  const res = await apiPost('/api/networks/rr-domains', body);
  return unwrapData<RrDomain>(res);
}

export async function updateRrDomain(
  id: string,
  body: {
    displayName?: string;
    description?: string | null;
    remoteAs?: number;
    localAs?: number | null;
    status?: RrDomainStatus;
    nodes?: RrDomainNodeInput[];
  },
): Promise<RrDomain> {
  const res = await apiPatch(`/api/networks/rr-domains/${encodeURIComponent(id)}`, body);
  return unwrapData<RrDomain>(res);
}

export async function deleteRrDomain(id: string): Promise<void> {
  await apiDelete(`/api/networks/rr-domains/${encodeURIComponent(id)}`);
}

export async function importRrDomainsCsv(
  file: File,
  opts?: { dryRun?: boolean },
): Promise<{ preview: RrDomainImportPreview; imported: RrDomain[] | null }> {
  const form = new FormData();
  form.append('file', file);
  const qs = opts?.dryRun ? '?dryRun=true' : '';
  const res = await apiUpload(`/api/networks/rr-domains/import${qs}`, form);
  return unwrapData<{ preview: RrDomainImportPreview; imported: RrDomain[] | null }>(res);
}

export async function downloadRrDomainTemplate(): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/networks/rr-domains/template`, {
    headers: getAuthHeaders(),
    credentials: 'include',
  });
  if (!res.ok) throw new Error('下载模板失败');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'rr-domain-import-template.csv';
  a.click();
  URL.revokeObjectURL(url);
}
