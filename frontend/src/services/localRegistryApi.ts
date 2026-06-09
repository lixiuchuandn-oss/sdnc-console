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

/** 从 start（默认 30500）起推荐第一个未被占用的 NodePort */
export const suggestLocalRegistryPort = async (cloudId: string, start = 30500) => {
  return await apiRequest(
    `/api/clouds/${cloudId}/resources/harvester/local-registry/suggest-port?start=${start}`,
    { skipCache: true },
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

/** 将本地仓库地址写入 Harvester containerd-registry，允许节点 HTTP 拉取 */
export const configureLocalRegistryPull = async (cloudId: string, registryId: string) => {
  return await apiPost(
    `/api/clouds/${cloudId}/resources/harvester/local-registry/${registryId}/configure-pull`,
  );
};

export const testLocalRegistryConnection = async (cloudId: string, registryId: string) => {
  return await apiPost(
    `/api/clouds/${cloudId}/resources/harvester/local-registry/${registryId}/test`,
  );
};

export const syncLocalRegistryPullSecret = async (
  cloudId: string,
  registryId: string,
  params: { namespace: string; secretName?: string },
) => {
  return await apiPost(
    `/api/clouds/${cloudId}/resources/harvester/local-registry/${registryId}/sync-pull-secret`,
    params,
  );
};

export const fetchImageUploadTasks = async (cloudId: string, registryId: string) => {
  return await apiRequest(
    `/api/clouds/${cloudId}/resources/harvester/local-registry/${registryId}/upload-tasks`
  );
};

export const deleteImageUploadTask = async (
  cloudId: string,
  registryId: string,
  taskId: string,
) => {
  return await apiDelete(
    `/api/clouds/${cloudId}/resources/harvester/local-registry/${registryId}/upload-tasks/${taskId}`,
  );
};

export const uploadImageToRegistry = async (
  cloudId: string,
  registryId: string | undefined,
  file: File,
  targetRepo?: string,
  targetTag?: string,
  server?: string,
  insecure?: boolean,
  username?: string,
  password?: string,
) => {
  const formData = new FormData();
  formData.append('file', file);
  if (targetRepo) formData.append('targetRepo', targetRepo);
  if (targetTag) formData.append('targetTag', targetTag);
  if (server) formData.append('server', server);
  if (insecure !== undefined) formData.append('insecure', String(insecure));
  if (username) formData.append('username', username);
  if (password) formData.append('password', password);

  const token = localStorage.getItem('token') || sessionStorage.getItem('token');

  // 有 registryId 走本地仓库上传，否则走通用仓库上传
  const path = registryId
    ? `/api/clouds/${cloudId}/resources/harvester/local-registry/${registryId}/upload`
    : `/api/clouds/${cloudId}/resources/harvester/containers/registry/upload`;

  const response = await fetch(path, {
    method: 'POST',
    headers: token ? { 'Authorization': `Bearer ${token}` } : undefined,
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`上传失败: ${response.status}`);
  }

  return await response.json();
};
