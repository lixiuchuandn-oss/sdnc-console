import { HarvesterTestParams } from './types';
import { requestJson, getJsonOnce } from './utils';

export const createHarvesterNamespace = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  name: string,
  annotations?: Record<string, string>,
): Promise<any> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const url = `${origin}/api/v1/namespaces`;
  const body = {
    apiVersion: 'v1',
    kind: 'Namespace',
    metadata: {
      name,
      annotations,
    },
  } as any;
  return requestJson('POST', url, token, insecure, body);
};

export const deleteHarvesterNamespace = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  name: string,
): Promise<any> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const url = `${origin}/api/v1/namespaces/${encodeURIComponent(name)}`;
  return requestJson('DELETE', url, token, insecure);
};

export const listHarvesterNamespacesRaw = async ({
  endpoint,
  token,
  insecure = false,
}: HarvesterTestParams): Promise<any[]> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }

  const url = `${origin}/v1/namespaces`;
  try {
    const json = await getJsonOnce(url, token, insecure, true);
    const items = Array.isArray(json?.data)
      ? json?.data
      : Array.isArray(json?.items)
        ? json?.items
        : [];
    return items;
  } catch (e) {
    console.warn(
      '[listHarvesterNamespacesRaw] Steve API failed, falling back to K8s API:',
      e,
    );
    const k8sUrl = `${origin}/api/v1/namespaces`;
    const json = await getJsonOnce(k8sUrl, token, insecure);
    const items = Array.isArray(json?.items) ? json.items : [];
    return items.map((item: any) => ({
      ...item,
      links: item.links || {
        view: `${origin}/api/v1/namespaces/${item.metadata?.name}`,
        self: `${origin}/api/v1/namespaces/${item.metadata?.name}`,
      },
    }));
  }
};

export const getHarvesterNamespaceRaw = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  name: string,
): Promise<any> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }
  const url = `${origin}/api/v1/namespaces/${encodeURIComponent(name)}`;
  return getJsonOnce(url, token, insecure);
};

