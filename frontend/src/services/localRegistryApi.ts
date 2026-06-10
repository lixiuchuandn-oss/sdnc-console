import { apiRequest, apiPost, apiDelete, apiPut, API_BASE_URL } from './api';
import { getToken } from '../utils/tokenStorage';

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

export const fetchGenericRegistryUploadTasks = async (cloudId: string, registryServer: string) => {
  return await apiRequest(
    `/api/clouds/${cloudId}/resources/harvester/containers/registry/upload-tasks?server=${encodeURIComponent(registryServer)}`,
    { skipCache: true },
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

export const deleteGenericRegistryUploadTask = async (
  cloudId: string,
  registryServer: string,
  taskId: string,
) => {
  return await apiDelete(
    `/api/clouds/${cloudId}/resources/harvester/containers/registry/upload-tasks/${taskId}?server=${encodeURIComponent(registryServer)}`,
  );
};

export function calcImageUploadTaskProgress(task: ImageUploadTask): number {
  if (task.totalLayers <= 0) {
    if (task.status === 'parsing') return 5;
    if (task.status === 'completed') return 100;
    return 0;
  }
  const raw = Math.round((task.uploadedLayers / task.totalLayers) * 100);
  if (task.status === 'uploading' || task.status === 'parsing') {
    return Math.min(raw, 99);
  }
  return Math.min(raw, 100);
}

export function getImageUploadTaskProgressLabel(task: ImageUploadTask): string {
  switch (task.status) {
    case 'parsing':
      return '正在解析镜像...';
    case 'uploading':
      if (task.currentLayer === 'manifest') {
        return '正在推送 manifest...';
      }
      return `正在推送到仓库 (${task.uploadedLayers}/${task.totalLayers} 步)...`;
    case 'completed':
      return '推送完成';
    case 'failed':
      return task.error || '推送失败';
    default:
      return '等待处理...';
  }
}

export type UploadImageProgressHandler = (info: {
  phase: 'uploading_file' | 'processing' | 'pushing';
  percent: number;
  message: string;
}) => void;

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
  onProgress?: UploadImageProgressHandler,
): Promise<any> => {
  const formData = new FormData();
  formData.append('file', file);
  if (targetRepo) formData.append('targetRepo', targetRepo);
  if (targetTag) formData.append('targetTag', targetTag);
  if (server) formData.append('server', server);
  if (insecure !== undefined) formData.append('insecure', String(insecure));
  if (username) formData.append('username', username);
  if (password) formData.append('password', password);

  const token = getToken();
  const apiPath = registryId
    ? `/api/clouds/${cloudId}/resources/harvester/local-registry/${registryId}/upload`
    : `/api/clouds/${cloudId}/resources/harvester/containers/registry/upload`;
  const url = `${API_BASE_URL}${apiPath}`;

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }

    xhr.upload.onprogress = (event) => {
      if (!onProgress || !event.lengthComputable) return;
      const percent = Math.round((event.loaded * 100) / event.total);
      onProgress({
        phase: 'uploading_file',
        percent,
        message: `正在上传镜像文件 (${percent}%)...`,
      });
    };

    xhr.upload.onload = () => {
      onProgress?.({
        phase: 'processing',
        percent: 100,
        message: registryId ? '文件已上传，正在创建任务...' : '文件已上传，正在解析并推送到仓库...',
      });
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error('服务器响应格式无效'));
        }
        return;
      }
      let errMsg = `上传失败: ${xhr.status}`;
      try {
        const body = JSON.parse(xhr.responseText);
        if (body?.message) errMsg = body.message;
        else if (body?.error) errMsg = String(body.error);
      } catch {
        /* ignore */
      }
      reject(new Error(errMsg));
    };

    xhr.onerror = () => reject(new Error('网络错误，上传失败'));
    xhr.onabort = () => reject(new Error('上传已取消'));
    xhr.send(formData);
  });
};
