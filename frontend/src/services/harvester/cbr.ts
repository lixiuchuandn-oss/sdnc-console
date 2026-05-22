import { apiRequest, apiPost, apiDelete, apiPatch } from '../api';
import { appendMergePublicScenarioParam } from './internal/queryParams';
import {
  deleteHarvesterResourceByLink,
  fetchHarvesterResourceByLink,
} from './resource';

export const fetchHarvesterScheduleVmBackups = async (
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
  const url = `/api/clouds/${cloudId}/resources/harvester/schedulevmbackups${queryString ? `?${queryString}` : ''}`;
  return await apiRequest(url, { skipCache: force });
};

export const createHarvesterScheduleVmBackup = async (cloudId: string, payload: unknown) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/harvester/schedulevmbackups`, payload);
};

export const deleteHarvesterScheduleVmBackup = async (cloudId: string, namespace: string, name: string) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/harvester/schedulevmbackups/${namespace}/${name}`);
};

export const updateHarvesterScheduleVmBackup = async (
  cloudId: string,
  namespace: string,
  name: string,
  payload: unknown,
) => {
  return await apiPatch(`/api/clouds/${cloudId}/resources/harvester/schedulevmbackups/${namespace}/${name}`, payload);
};

export const fetchHarvesterBackups = async (
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
  return await apiRequest(
    `/api/clouds/${cloudId}/resources/harvester/backups${queryString ? `?${queryString}` : ''}`,
    { skipCache: force },
  );
};

export const deleteHarvesterBackup = async (cloudId: string, namespace: string, name: string) => {
  return await apiDelete(
    `/api/clouds/${cloudId}/resources/harvester/backups/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`,
  );
};

export const createHarvesterVirtualMachineBackup = async (
  cloudId: string,
  namespace: string,
  payload: { name: string; vmName: string; type: 'backup' | 'snapshot'; alias?: string },
) => {
  return await apiPost(
    `/api/clouds/${cloudId}/resources/harvester/virtualmachinebackups/${encodeURIComponent(namespace)}`,
    payload,
  );
};

export const createHarvesterVirtualMachineRestore = async (
  cloudId: string,
  namespace: string,
  payload: unknown,
) => {
  return await apiPost(
    `/api/clouds/${cloudId}/resources/harvester/virtualmachinerestores/${encodeURIComponent(namespace)}`,
    payload,
  );
};

export const fetchHarvesterVirtualMachineRestores = async (cloudId: string, force = false) => {
  const path = `/apis/harvesterhci.io/v1beta1/virtualmachinerestores`;
  return await fetchHarvesterResourceByLink(cloudId, path, force);
};

export const deleteHarvesterVirtualMachineRestore = async (cloudId: string, namespace: string, name: string) => {
  const path = `/apis/harvesterhci.io/v1beta1/namespaces/${encodeURIComponent(namespace)}/virtualmachinerestores/${encodeURIComponent(name)}`;
  return await deleteHarvesterResourceByLink(cloudId, path);
};
