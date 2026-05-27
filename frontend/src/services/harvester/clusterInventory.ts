/** 集群 Tab · 命名空间 / 节点 / USB·PCI / 存储类（维护域：Harvester/cluster） */
import { apiRequest, apiPost, apiDelete, apiPatch } from '../api';
import { appendMergePublicScenarioParam } from './internal/queryParams';

/** 命名空间 */
export const fetchHarvesterNamespaces = async (
  cloudId: string,
  force = false,
  excludeSystem = false,
  skipSync = false,
  mergePublicScenarioNamespaces?: boolean,
) => {
  const params = new URLSearchParams();
  if (force) params.append('force', 'true');
  if (excludeSystem) params.append('excludeSystem', 'true');
  void skipSync;
  appendMergePublicScenarioParam(params, mergePublicScenarioNamespaces);
  const queryString = params.toString();
  return await apiRequest(
    `/api/clouds/${cloudId}/resources/harvester/namespaces${queryString ? `?${queryString}` : ''}`,
  );
};

export const createHarvesterNamespace = async (cloudId: string, payload: unknown) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/harvester/namespaces`, payload || {});
};

export const updateHarvesterNamespace = async (cloudId: string, name: string, payload: unknown) => {
  return await apiPatch(
    `/api/clouds/${cloudId}/resources/harvester/namespaces/${encodeURIComponent(name)}`,
    payload || {},
  );
};

export const deleteHarvesterNamespace = async (cloudId: string, name: string) => {
  return await apiDelete(
    `/api/clouds/${cloudId}/resources/harvester/namespaces/${encodeURIComponent(name)}`,
  );
};

/** 节点 */
export const fetchHarvesterNodes = async (cloudId: string, force = false) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/nodes${force ? '?force=true' : ''}`);
};

export const fetchHarvesterNodeDetail = async (cloudId: string, name: string) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/nodes/${encodeURIComponent(name)}`);
};

/** USB / PCI 设备（集群 Tab） */
export const fetchHarvesterUsbResources = async (cloudId: string, force = false) => {
  return await apiRequest(
    `/api/clouds/${cloudId}/resources/harvester/usb-devices${force ? '?force=true' : ''}`,
  );
};

export const claimHarvesterUsbDevice = async (cloudId: string, name: string) => {
  return await apiPost(
    `/api/clouds/${cloudId}/resources/harvester/usb-devices/${encodeURIComponent(name)}/claim`,
    {},
  );
};

export const unclaimHarvesterUsbDevice = async (cloudId: string, name: string) => {
  return await apiDelete(
    `/api/clouds/${cloudId}/resources/harvester/usb-devices/${encodeURIComponent(name)}/claim`,
  );
};

export const fetchHarvesterPciDevices = async (cloudId: string, force = false) => {
  return await apiRequest(
    `/api/clouds/${cloudId}/resources/harvester/pci-devices${force ? '?force=true' : ''}`,
  );
};

/** GPU 设备（集群 Tab · 与 USB/PCI 同组） */
export const fetchHarvesterGpuResources = async (
  cloudId: string,
  force = false,
  mergePublicScenarioNamespaces?: boolean,
) => {
  const params = new URLSearchParams();
  if (force) params.append('force', 'true');
  appendMergePublicScenarioParam(params, mergePublicScenarioNamespaces);
  const qs = params.toString();
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/gpus${qs ? `?${qs}` : ''}`);
};

/** 存储类 */
export const fetchHarvesterStorageClasses = async (
  cloudId: string,
  force = false,
  skipSync = false,
  mergePublicScenarioNamespaces?: boolean,
) => {
  const params = new URLSearchParams();
  if (force) params.append('force', 'true');
  void skipSync;
  appendMergePublicScenarioParam(params, mergePublicScenarioNamespaces);
  const query = params.toString();
  return await apiRequest(
    `/api/clouds/${cloudId}/resources/harvester/storage-classes${query ? `?${query}` : ''}`,
    { skipCache: !!force },
  );
};

export const fetchHarvesterStorageClassDetail = async (cloudId: string, name: string) => {
  return await apiRequest(
    `/api/clouds/${cloudId}/resources/harvester/storage-classes/${encodeURIComponent(name)}`,
  );
};
