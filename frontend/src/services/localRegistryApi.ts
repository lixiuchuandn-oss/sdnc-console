import { apiRequest, apiPost, apiDelete, apiPut } from './api';

export interface LocalRegistry {
  id: string;
  cloudId: string;
  name: string;
  server: string;
  namespace: string;
  nodePort: number;
  storageSize?: string;
  authEnabled: boolean;
  username?: string;
  password?: string;
  status: 'deploying' | 'healthy' | 'unhealthy' | 'deleting';
  deploymentName?: string;
  serviceName?: string;
  pvcName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ImageUploadTask {
  id: string;
  registryId: string;
  fileName: string;
  targetRepo?: string;
  targetTag?: string;
  status: 'pending' | 'parsing' | 'uploading' | 'completed' | 'failed';
  totalLayers: number;
  uploadedLayers: number;
  currentLayer?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateLocalRegistryPayload {
  name: string;
  namespace: string;
  nodePort: number;
  storageSize?: string;
  authEnabled?: boolean;
  username?: string;
  password?: string;
}

export const checkLocalRegistryPort = async (cloudId: string, port: number) => {
  return await apiRequest(
    `/api/clouds/${cloudId}/resources/harvester/local-registry/check-port?port=${port}`,
    { skipCache: true }
  );
};

export const createLocalRegistry = async (cloudId: string, payload: CreateLocalRegistryPayload) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/harvester/local-registry`, payload);
};

export const fetchLocalRegistries = async (cloudId: string) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/local-registry`);
};

export const fetchLocalRegistry = async (cloudId: string, registryId: string) => {
  return await apiRequest(
    `/api/clouds/${cloudId}/resources/harvester/local-registry/${registryId}`
  );
};

export const deleteLocalRegistry = async (cloudId: string, registryId: string) => {
  return await apiDelete(
    `/api/clouds/${cloudId}/resources/harvester/local-registry/${registryId}`
  );
};

export interface UpdateLocalRegistryPayload {
  name?: string;
  authEnabled?: boolean;
  username?: string;
  password?: string;
}

export const updateLocalRegistry = async (cloudId: string, registryId: string, payload: UpdateLocalRegistryPayload) => {
  return await apiPut(
    `/api/clouds/${cloudId}/resources/harvester/local-registry/${registryId}`,
    payload
  );
};

export const refreshLocalRegistryStatus = async (cloudId: string, registryId: string) => {
  return await apiPost(
    `/api/clouds/${cloudId}/resources/harvester/local-registry/${registryId}/refresh`
  );
};

export const fetchImageUploadTasks = async (cloudId: string, registryId: string) => {
  return await apiRequest(
    `/api/clouds/${cloudId}/resources/harvester/local-registry/${registryId}/upload-tasks`
  );
};
