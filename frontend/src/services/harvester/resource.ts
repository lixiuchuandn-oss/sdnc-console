import { apiRequest, apiDelete, apiPut } from '../api';

/** 通过 Steve/K8s 链接代理读 Harvester 资源 */
export const fetchHarvesterResourceByLink = async (cloudId: string, path: string, force = false) => {
  const params = new URLSearchParams();
  params.append('path', path);
  if (force) params.append('force', 'true');
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/proxy?${params.toString()}`, {
    skipCache: force,
  });
};

export const deleteHarvesterResourceByLink = async (cloudId: string, path: string) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/harvester/proxy?path=${encodeURIComponent(path)}`);
};

export const putHarvesterResourceByLink = async (cloudId: string, path: string, body: unknown) => {
  return await apiPut(
    `/api/clouds/${cloudId}/resources/harvester/proxy?path=${encodeURIComponent(path)}`,
    body,
  );
};

export const fetchHarvesterEvents = async (
  cloudId: string,
  namespace: string,
  uid: string,
  name: string,
  kind: string,
) => {
  const query = new URLSearchParams({
    namespace,
    uid,
    name,
    kind,
  }).toString();
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/events?${query}`);
};
