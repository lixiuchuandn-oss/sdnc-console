import { apiRequest, apiPost, apiDelete, apiPatch } from '../api';
import { appendMergePublicScenarioParam } from './internal/queryParams';

export const fetchHarvesterVMAggregated = async (cloudId: string, namespace: string, name: string) => {
  return await apiRequest(
    `/api/clouds/${cloudId}/resources/ecs/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/aggregated`,
    { skipCache: true },
  );
};

export const fetchHarvesterMigrations = async (cloudId: string, force = false) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/migrations${force ? '?force=true' : ''}`);
};

export const getRecycleBinShutdownRecords = async (params?: {
  cloudId?: string;
  status?: string;
  startTime?: string;
  endTime?: string;
  page?: number;
  pageSize?: number;
}) => {
  const queryParams = new URLSearchParams();
  if (params?.cloudId) queryParams.append('cloudId', params.cloudId);
  if (params?.status) queryParams.append('status', params.status);
  if (params?.startTime) queryParams.append('startTime', params.startTime);
  if (params?.endTime) queryParams.append('endTime', params.endTime);
  if (params?.page) queryParams.append('page', String(params.page));
  if (params?.pageSize) queryParams.append('pageSize', String(params.pageSize));

  const queryString = queryParams.toString();
  return await apiRequest(`/api/system/recycle-bin/shutdown-records${queryString ? `?${queryString}` : ''}`);
};

export const fetchHarvesterMigrationsDirect = async (cloudId: string, force = false) => {
  return await apiRequest(
    `/api/clouds/${cloudId}/resources/harvester/migrations-direct${force ? '?force=true' : ''}`,
  );
};

export const migrateHarvesterVm = async (cloudId: string, instanceId: string, targetNode?: string) => {
  const nodeName = String(targetNode || '').trim();
  const body = nodeName ? { nodeName } : {};
  return await apiPost(`/api/clouds/${cloudId}/resources/ecs/${encodeURIComponent(instanceId)}/migrate`, body);
};

export const abortHarvesterMigration = async (cloudId: string, instanceId: string) => {
  return await apiPost(
    `/api/clouds/${cloudId}/resources/ecs/${encodeURIComponent(instanceId)}/abort-migration`,
    {},
  );
};

export const fetchHarvesterSshKeys = async (
  cloudId: string,
  force = false,
  skipSync = false,
  mergePublicScenarioNamespaces?: boolean,
) => {
  const params = new URLSearchParams();
  if (force) params.append('force', 'true');
  void skipSync;
  appendMergePublicScenarioParam(params, mergePublicScenarioNamespaces);
  const queryString = params.toString();
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/sshkeys${queryString ? `?${queryString}` : ''}`);
};

export const fetchHarvesterCloudInits = async (
  cloudId: string,
  force = false,
  mergePublicScenarioNamespaces?: boolean,
) => {
  const params = new URLSearchParams();
  if (force) params.append('force', 'true');
  appendMergePublicScenarioParam(params, mergePublicScenarioNamespaces);
  const qs = params.toString();
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/cloudinits${qs ? `?${qs}` : ''}`);
};

export const fetchHarvesterTemplates = async (
  cloudId: string,
  force = false,
  skipSync = false,
  mergePublicScenarioNamespaces?: boolean,
) => {
  const params = new URLSearchParams();
  if (force) params.append('force', 'true');
  void skipSync;
  appendMergePublicScenarioParam(params, mergePublicScenarioNamespaces);
  const queryString = params.toString();
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/templates${queryString ? `?${queryString}` : ''}`);
};

export const createHarvesterVmFromTemplate = async (
  cloudId: string,
  namespace: string,
  name: string,
  payload: { name: string; namespace?: string; autoStart?: boolean },
) => {
  return await apiPost(
    `/api/clouds/${cloudId}/resources/harvester/templates/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/create-vm`,
    payload,
  );
};

export const fetchHarvesterVncUrl = async (cloudId: string, id: string) => {
  let namespace = 'default';
  let name = id;
  if (id.includes('/')) {
    [namespace, name] = id.split('/');
  }
  return await apiRequest(
    `/api/clouds/${cloudId}/resources/ecs/${encodeURIComponent(name)}/vnc-url?namespace=${encodeURIComponent(namespace)}`,
  );
};

export const fetchHarvesterVmDetail = async (cloudId: string, namespace: string, name: string) => {
  return await apiRequest(
    `/api/clouds/${cloudId}/resources/harvester/vms/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`,
  );
};

export const saveHarvesterVmAsTemplate = async (
  cloudId: string,
  namespace: string,
  name: string,
  payload?: { alias?: string; description?: string; namespace?: string },
) => {
  return await apiPost(
    `/api/clouds/${cloudId}/resources/harvester/vms/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/save-as-template`,
    payload || {},
  );
};

export const fetchHarvesterCapabilities = async (cloudId: string) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/capabilities`);
};

export const updateHarvesterVmSpec = async (
  cloudId: string,
  namespace: string,
  name: string,
  payload: unknown,
) => {
  return await apiPost(
    `/api/clouds/${cloudId}/resources/harvester/vms/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/update-spec`,
    payload,
  );
};

export const createHarvesterVm = async (cloudId: string, payload: unknown) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/harvester/vms`, payload);
};

export const patchHarvesterVm = async (
  cloudId: string,
  namespace: string,
  name: string,
  payload: unknown,
  contentType = 'application/merge-patch+json',
) => {
  return await apiPatch(
    `/api/clouds/${cloudId}/resources/harvester/vms/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`,
    payload,
    { contentType },
  );
};

export const restoreHarvesterVm = async (cloudId: string, instanceId: string) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/ecs/${encodeURIComponent(instanceId)}/restore`, {});
};

export const forceDeleteHarvesterVm = async (cloudId: string, instanceId: string, deleteVolumes = false) => {
  return await apiDelete(
    `/api/clouds/${cloudId}/resources/ecs/${encodeURIComponent(instanceId)}/force?deleteVolumes=${deleteVolumes}`,
  );
};

export const pauseHarvesterVm = async (cloudId: string, namespace: string, name: string) => {
  const instanceId = `${namespace}/${name}`;
  return await apiPost(`/api/clouds/${cloudId}/resources/ecs/${encodeURIComponent(instanceId)}/pause`, {});
};

export const unpauseHarvesterVm = async (cloudId: string, namespace: string, name: string) => {
  const instanceId = `${namespace}/${name}`;
  return await apiPost(`/api/clouds/${cloudId}/resources/ecs/${encodeURIComponent(instanceId)}/unpause`, {});
};

export const createHarvesterSshKey = async (
  cloudId: string,
  namespace: string,
  name: string,
  publicKey: string,
  annotations?: Record<string, string>,
) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/harvester/sshkeys`, {
    namespace,
    name,
    publicKey,
    annotations,
  });
};

export const deleteHarvesterSshKey = async (cloudId: string, namespace: string, name: string) => {
  return await apiDelete(
    `/api/clouds/${cloudId}/resources/harvester/sshkeys/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`,
  );
};

export const deleteHarvesterCloudInit = async (cloudId: string, namespace: string, name: string) => {
  return await apiDelete(
    `/api/clouds/${cloudId}/resources/harvester/cloudinits/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`,
  );
};

export const harvesterVmAction = async (
  cloudId: string,
  namespace: string,
  name: string,
  action: string,
  payload: unknown,
) => {
  return await apiPost(
    `/api/clouds/${cloudId}/resources/harvester/vms/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/action?action=${action}`,
    payload,
  );
};
