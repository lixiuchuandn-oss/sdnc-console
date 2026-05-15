/**
 * Harbor 镜像仓库 API 服务
 * 
 * 提供 Harbor 实例管理、项目管理、镜像浏览、漏洞扫描等功能的 API 调用
 * 
 * @module harborApi
 */

import { apiRequest, apiPost, apiPut, apiDelete, apiPatch } from '../../../../../../services/api';
import type {
  HarborRegistry,
  HarborRegistryForm,
  HarborProject,
  HarborProjectForm,
  HarborRepository,
  HarborArtifact,
  HarborTag,
  HarborVulnerabilitySummary,
  HarborVulnerabilityItem,
  HarborReplicationPolicy,
  HarborReplicationExecution,
  HarborSystemInfo,
  HarborProjectSummary,
  HarborProjectMember,
  HarborPaginatedResponse,
  HarborPaginationParams,
  HarborSyncSecretParams,
  HarborSyncSecretResult,
  HarborUploadProgress,
} from '../types';

/** Harbor API 前缀 */
const API_PREFIX = '/api/harbor';

// ==================== 实例管理 ====================

/**
 * 获取所有可访问的 Harbor 实例
 * @returns Harbor 实例列表
 */
export const getHarborRegistries = async (): Promise<HarborRegistry[]> => {
  const result = await apiRequest(`${API_PREFIX}/registries`);
  return result?.data || result;
};

/**
 * 创建 Harbor 实例（添加外部 Harbor）
 * @param data Harbor 配置
 * @returns 创建的 Harbor 实例
 */
export const createHarborRegistry = async (data: HarborRegistryForm): Promise<HarborRegistry> => {
  const result = await apiPost(`${API_PREFIX}/registries`, data);
  return result?.data || result;
};

/**
 * 获取 Harbor 实例详情
 * @param id Harbor 实例 ID
 * @returns Harbor 实例详情
 */
export const getHarborRegistry = async (id: string): Promise<HarborRegistry> => {
  const result = await apiRequest(`${API_PREFIX}/registries/${id}`);
  return result?.data || result;
};

/**
 * 更新 Harbor 实例配置
 * @param id Harbor 实例 ID
 * @param data 更新的配置数据
 * @returns 更新后的 Harbor 实例
 */
export const updateHarborRegistry = async (
  id: string,
  data: Partial<HarborRegistryForm>,
): Promise<HarborRegistry> => {
  const result = await apiPut(`${API_PREFIX}/registries/${id}`, data);
  return result?.data || result;
};

/**
 * 删除 Harbor 实例
 * @param id Harbor 实例 ID
 */
export const deleteHarborRegistry = async (id: string): Promise<void> => {
  return await apiDelete(`${API_PREFIX}/registries/${id}`);
};

/**
 * 测试 Harbor 连接
 * @param id Harbor 实例 ID
 * @returns 连接测试结果
 */
export const testHarborConnection = async (
  id: string,
): Promise<{ success: boolean; message: string; version?: string }> => {
  const result = await apiPost(`${API_PREFIX}/registries/${id}/test`, {});
  return result?.data || result;
};

export const syncHarborProjects = async (id: string): Promise<{
  added: number;
  updated: number;
  deleted: number;
}> => {
  const result = await apiPost(`${API_PREFIX}/registries/${id}/sync-projects`, {});
  return result?.data || result;
};

/**
 * 获取 Harbor 系统信息
 * @param id Harbor 实例 ID
 * @returns 系统信息
 */
export const getHarborSystemInfo = async (id: string): Promise<HarborSystemInfo> => {
  const result = await apiRequest(`${API_PREFIX}/registries/${id}/systeminfo`);
  return result?.data || result;
};

/**
 * 获取内置 Harbor 配置（管理员）
 * @returns 内置 Harbor 配置
 */
export const getBuiltInHarbor = async (): Promise<HarborRegistry | null> => {
  const result = await apiRequest(`${API_PREFIX}/builtin`);
  return result?.data || result;
};

/**
 * 更新内置 Harbor 配置（管理员）
 * @param data 更新的配置数据
 * @returns 更新后的配置
 */
export const updateBuiltInHarbor = async (
  data: Partial<HarborRegistryForm>,
): Promise<HarborRegistry> => {
  const result = await apiPut(`${API_PREFIX}/builtin`, data);
  return result?.data || result;
};

// ==================== 项目管理 ====================

/**
 * 获取项目列表
 * @param harborId Harbor 实例 ID
 * @param params 分页/搜索参数
 * @returns 项目列表
 */
export const getHarborProjects = async (
  harborId: string,
  params?: HarborPaginationParams,
): Promise<HarborPaginatedResponse<HarborProject>> => {
  const searchParams = new URLSearchParams();
  if (params?.page) searchParams.append('page', String(params.page));
  if (params?.pageSize) searchParams.append('page_size', String(params.pageSize));
  if (params?.q) searchParams.append('q', params.q);
  if (params?.sort) searchParams.append('sort', params.sort);

  const queryString = searchParams.toString();
  const result = await apiRequest(
    `${API_PREFIX}/registries/${harborId}/projects${queryString ? `?${queryString}` : ''}`,
  );
  return result?.data || result;
};

/**
 * 创建项目
 * @param harborId Harbor 实例 ID
 * @param data 项目配置
 * @returns 创建的项目
 */
export const createHarborProject = async (
  harborId: string,
  data: HarborProjectForm,
): Promise<HarborProject> => {
  // 字段映射：前端驼峰 → 后端下划线
  // Harbor 的存储配额通过 metadata.storage_limit 设置
  const payload: any = {
    project_name: data.projectName,
    public: data.public,
  };
  
  // 处理 metadata
  if (data.metadata || data.storageLimit) {
    payload.metadata = {
      ...data.metadata,
    };
    // 如果有存储配额，转换为字节（GB → bytes）
    if (data.storageLimit) {
      payload.metadata.storage_limit = data.storageLimit * 1024 * 1024 * 1024;
    }
  }
  
  const result = await apiPost(`${API_PREFIX}/registries/${harborId}/projects`, payload);
  return result?.data || result;
};

/**
 * 获取项目详情
 * @param harborId Harbor 实例 ID
 * @param projectName 项目名称
 * @returns 项目详情
 */
export const getHarborProject = async (
  harborId: string,
  projectName: string,
): Promise<HarborProject> => {
  const result = await apiRequest(
    `${API_PREFIX}/registries/${harborId}/projects/${encodeURIComponent(projectName)}`,
  );
  return result?.data || result;
};

/**
 * 更新项目
 * @param harborId Harbor 实例 ID
 * @param projectName 项目名称
 * @param data 更新的配置数据
 * @returns 更新后的项目
 */
export const updateHarborProject = async (
  harborId: string,
  projectName: string,
  data: Partial<HarborProjectForm>,
): Promise<HarborProject> => {
  const result = await apiPut(
    `${API_PREFIX}/registries/${harborId}/projects/${encodeURIComponent(projectName)}`,
    data,
  );
  return result?.data || result;
};

/**
 * 删除项目
 * @param harborId Harbor 实例 ID
 * @param projectName 项目名称
 */
export const deleteHarborProject = async (
  harborId: string,
  projectName: string,
): Promise<void> => {
  return await apiDelete(
    `${API_PREFIX}/registries/${harborId}/projects/${encodeURIComponent(projectName)}`,
  );
};

/**
 * 获取项目统计摘要
 * @param harborId Harbor 实例 ID
 * @param projectName 项目名称
 * @returns 项目统计信息
 */
export const getHarborProjectSummary = async (
  harborId: string,
  projectName: string,
): Promise<HarborProjectSummary> => {
  const result = await apiRequest(
    `${API_PREFIX}/registries/${harborId}/projects/${encodeURIComponent(projectName)}/summary`,
  );
  return result?.data || result;
};

// ==================== 项目成员管理 ====================

/**
 * 获取项目成员列表
 * @param harborId Harbor 实例 ID
 * @param projectName 项目名称
 * @returns 成员列表
 */
export const getHarborProjectMembers = async (
  harborId: string,
  projectName: string,
): Promise<HarborProjectMember[]> => {
  const result = await apiRequest(
    `${API_PREFIX}/registries/${harborId}/projects/${encodeURIComponent(projectName)}/members`,
  );
  return result?.data || result;
};

/**
 * 添加项目成员
 * @param harborId Harbor 实例 ID
 * @param projectName 项目名称
 * @param memberInfo 成员信息
 * @returns 添加的成员
 */
export const addHarborProjectMember = async (
  harborId: string,
  projectName: string,
  memberInfo: { username: string; roleId: number },
): Promise<HarborProjectMember> => {
  const result = await apiPost(
    `${API_PREFIX}/registries/${harborId}/projects/${encodeURIComponent(projectName)}/members`,
    memberInfo,
  );
  return result?.data || result;
};

/**
 * 删除项目成员
 * @param harborId Harbor 实例 ID
 * @param projectName 项目名称
 * @param memberId 成员 ID
 */
export const deleteHarborProjectMember = async (
  harborId: string,
  projectName: string,
  memberId: number,
): Promise<void> => {
  return await apiDelete(
    `${API_PREFIX}/registries/${harborId}/projects/${encodeURIComponent(projectName)}/members/${memberId}`,
  );
};

// ==================== 仓库浏览 ====================

/**
 * 获取所有仓库
 * @param harborId Harbor 实例 ID
 * @param params 分页/搜索参数
 * @returns 仓库列表
 */
export const getHarborAllRepositories = async (
  harborId: string,
  params?: HarborPaginationParams,
): Promise<HarborPaginatedResponse<HarborRepository>> => {
  const searchParams = new URLSearchParams();
  if (params?.page) searchParams.append('page', String(params.page));
  if (params?.pageSize) searchParams.append('page_size', String(params.pageSize));
  if (params?.q) searchParams.append('q', params.q);

  const queryString = searchParams.toString();
  const result = await apiRequest(
    `${API_PREFIX}/registries/${harborId}/repositories${queryString ? `?${queryString}` : ''}`,
  );
  return result?.data || result;
};

/**
 * 获取项目下的仓库列表
 * @param harborId Harbor 实例 ID
 * @param projectName 项目名称
 * @param params 分页/搜索参数
 * @returns 仓库列表
 */
export const getHarborRepositories = async (
  harborId: string,
  projectName: string,
  params?: HarborPaginationParams,
): Promise<HarborPaginatedResponse<HarborRepository>> => {
  const searchParams = new URLSearchParams();
  if (params?.page) searchParams.append('page', String(params.page));
  if (params?.pageSize) searchParams.append('page_size', String(params.pageSize));
  if (params?.q) searchParams.append('q', params.q);

  const queryString = searchParams.toString();
  const result = await apiRequest(
    `${API_PREFIX}/registries/${harborId}/projects/${encodeURIComponent(projectName)}/repositories${queryString ? `?${queryString}` : ''}`,
  );
  return result?.data || result;
};

/**
 * 获取仓库详情
 * @param harborId Harbor 实例 ID
 * @param projectName 项目名称
 * @param repoName 仓库名称
 * @returns 仓库详情
 */
export const getHarborRepository = async (
  harborId: string,
  projectName: string,
  repoName: string,
): Promise<HarborRepository> => {
  const result = await apiRequest(
    `${API_PREFIX}/registries/${harborId}/projects/${encodeURIComponent(projectName)}/repositories/${encodeURIComponent(repoName)}`,
  );
  return result?.data || result;
};

/**
 * 删除仓库
 * @param harborId Harbor 实例 ID
 * @param projectName 项目名称
 * @param repoName 仓库名称
 */
export const deleteHarborRepository = async (
  harborId: string,
  projectName: string,
  repoName: string,
): Promise<void> => {
  return await apiDelete(
    `${API_PREFIX}/registries/${harborId}/projects/${encodeURIComponent(projectName)}/repositories/${encodeURIComponent(repoName)}`,
  );
};

// ==================== 制品管理 ====================

/**
 * 获取制品列表
 * @param harborId Harbor 实例 ID
 * @param projectName 项目名称
 * @param repoName 仓库名称
 * @param params 分页参数
 * @returns 制品列表
 */
export const getHarborArtifacts = async (
  harborId: string,
  projectName: string,
  repoName: string,
  params?: HarborPaginationParams & { withTag?: boolean; withScanOverview?: boolean },
): Promise<HarborPaginatedResponse<HarborArtifact>> => {
  const searchParams = new URLSearchParams();
  if (params?.page) searchParams.append('page', String(params.page));
  if (params?.pageSize) searchParams.append('page_size', String(params.pageSize));
  if (params?.withTag !== false) searchParams.append('with_tag', 'true');
  if (params?.withScanOverview) searchParams.append('with_scan_overview', 'true');

  const queryString = searchParams.toString();
  const result = await apiRequest(
    `${API_PREFIX}/registries/${harborId}/projects/${encodeURIComponent(projectName)}/repositories/${encodeURIComponent(repoName)}/artifacts${queryString ? `?${queryString}` : ''}`,
  );
  return result?.data || result;
};

/**
 * 获取制品详情
 * @param harborId Harbor 实例 ID
 * @param projectName 项目名称
 * @param repoName 仓库名称
 * @param reference 制品引用（标签或摘要）
 * @returns 制品详情
 */
export const getHarborArtifact = async (
  harborId: string,
  projectName: string,
  repoName: string,
  reference: string,
): Promise<HarborArtifact> => {
  const result = await apiRequest(
    `${API_PREFIX}/registries/${harborId}/projects/${encodeURIComponent(projectName)}/repositories/${encodeURIComponent(repoName)}/artifacts/${encodeURIComponent(reference)}`,
  );
  return result?.data || result;
};

/**
 * 删除制品
 * @param harborId Harbor 实例 ID
 * @param projectName 项目名称
 * @param repoName 仓库名称
 * @param reference 制品引用
 */
export const deleteHarborArtifact = async (
  harborId: string,
  projectName: string,
  repoName: string,
  reference: string,
): Promise<void> => {
  return await apiDelete(
    `${API_PREFIX}/registries/${harborId}/projects/${encodeURIComponent(projectName)}/repositories/${encodeURIComponent(repoName)}/artifacts/${encodeURIComponent(reference)}`,
  );
};

// ==================== 标签管理 ====================

/**
 * 获取制品标签列表
 * @param harborId Harbor 实例 ID
 * @param projectName 项目名称
 * @param repoName 仓库名称
 * @param reference 制品引用
 * @returns 标签列表
 */
export const getHarborTags = async (
  harborId: string,
  projectName: string,
  repoName: string,
  reference: string,
): Promise<HarborTag[]> => {
  const result = await apiRequest(
    `${API_PREFIX}/registries/${harborId}/projects/${encodeURIComponent(projectName)}/repositories/${encodeURIComponent(repoName)}/artifacts/${encodeURIComponent(reference)}/tags`,
  );
  return result?.data || result;
};

/**
 * 添加标签
 * @param harborId Harbor 实例 ID
 * @param projectName 项目名称
 * @param repoName 仓库名称
 * @param reference 制品引用
 * @param tagName 标签名称
 * @returns 添加的标签
 */
export const addHarborTag = async (
  harborId: string,
  projectName: string,
  repoName: string,
  reference: string,
  tagName: string,
): Promise<HarborTag> => {
  const result = await apiPost(
    `${API_PREFIX}/registries/${harborId}/projects/${encodeURIComponent(projectName)}/repositories/${encodeURIComponent(repoName)}/artifacts/${encodeURIComponent(reference)}/tags`,
    { name: tagName },
  );
  return result?.data || result;
};

/**
 * 删除标签
 * @param harborId Harbor 实例 ID
 * @param projectName 项目名称
 * @param repoName 仓库名称
 * @param reference 制品引用
 * @param tagName 标签名称
 */
export const deleteHarborTag = async (
  harborId: string,
  projectName: string,
  repoName: string,
  reference: string,
  tagName: string,
): Promise<void> => {
  return await apiDelete(
    `${API_PREFIX}/registries/${harborId}/projects/${encodeURIComponent(projectName)}/repositories/${encodeURIComponent(repoName)}/artifacts/${encodeURIComponent(reference)}/tags/${encodeURIComponent(tagName)}`,
  );
};

// ==================== 漏洞扫描 ====================

/**
 * 触发漏洞扫描
 * @param harborId Harbor 实例 ID
 * @param projectName 项目名称
 * @param repoName 仓库名称
 * @param reference 制品引用
 */
export const triggerHarborScan = async (
  harborId: string,
  projectName: string,
  repoName: string,
  reference: string,
): Promise<void> => {
  return await apiPost(
    `${API_PREFIX}/registries/${harborId}/projects/${encodeURIComponent(projectName)}/repositories/${encodeURIComponent(repoName)}/artifacts/${encodeURIComponent(reference)}/scan`,
    {},
  );
};

/**
 * 获取漏洞扫描结果
 * @param harborId Harbor 实例 ID
 * @param projectName 项目名称
 * @param repoName 仓库名称
 * @param reference 制品引用
 * @returns 漏洞扫描结果
 */
export const getHarborVulnerabilities = async (
  harborId: string,
  projectName: string,
  repoName: string,
  reference: string,
): Promise<{
  overview: HarborVulnerabilitySummary;
  vulnerabilities: HarborVulnerabilityItem[];
}> => {
  const result = await apiRequest(
    `${API_PREFIX}/registries/${harborId}/projects/${encodeURIComponent(projectName)}/repositories/${encodeURIComponent(repoName)}/artifacts/${encodeURIComponent(reference)}/vulnerabilities`,
  );
  return result?.data || result;
};

/**
 * 获取扫描统计
 * @param harborId Harbor 实例 ID
 * @returns 扫描统计数据
 */
export const getHarborScanMetrics = async (harborId: string): Promise<{
  total: number;
  scanned: number;
  failed: number;
  ongoing: number;
}> => {
  const result = await apiRequest(`${API_PREFIX}/registries/${harborId}/scans/metrics`);
  return result?.data || result;
};

// ==================== 镜像上传 ====================

/**
 * 上传镜像到 Harbor
 * @param harborId Harbor 实例 ID
 * @param formData 包含 file, project, repository, tag 的 FormData
 * @param onProgress 进度回调
 * @returns 上传结果
 */
export const uploadHarborImage = async (
  harborId: string,
  formData: FormData,
  onProgress?: (progress: number) => void,
): Promise<{ success: boolean; digest: string; message?: string }> => {
  const token = localStorage.getItem('token') || sessionStorage.getItem('token');
  const apiBase = process.env.REACT_APP_API_URL || '';

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${apiBase}${API_PREFIX}/registries/${harborId}/images/upload`);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        const progress = Math.round((e.loaded * 100) / e.total);
        onProgress(progress);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const response = JSON.parse(xhr.responseText);
          resolve(response);
        } catch {
          reject(new Error('Invalid response format'));
        }
      } else {
        reject(new Error(`Upload failed: ${xhr.statusText}`));
      }
    };

    xhr.onerror = () => reject(new Error('Network error'));
    xhr.send(formData);
  });
};

/**
 * 查询上传进度
 * @param uploadId 上传 ID
 * @returns 上传进度信息
 */
export const getHarborUploadStatus = async (
  uploadId: string,
): Promise<HarborUploadProgress> => {
  const result = await apiRequest(`${API_PREFIX}/uploads/${uploadId}/status`);
  return result?.data || result;
};

/**
 * 取消上传
 * @param uploadId 上传 ID
 */
export const cancelHarborUpload = async (uploadId: string): Promise<void> => {
  return await apiDelete(`${API_PREFIX}/uploads/${uploadId}`);
};

// ==================== 复制规则 ====================

/**
 * 获取复制规则列表
 * @param harborId Harbor 实例 ID
 * @returns 复制规则列表
 */
export const getHarborReplicationPolicies = async (
  harborId: string,
): Promise<HarborReplicationPolicy[]> => {
  const result = await apiRequest(`${API_PREFIX}/registries/${harborId}/replication/policies`);
  return result?.data || result;
};

/**
 * 创建复制规则
 * @param harborId Harbor 实例 ID
 * @param data 规则配置
 * @returns 创建的规则
 */
export const createHarborReplicationPolicy = async (
  harborId: string,
  data: Partial<HarborReplicationPolicy>,
): Promise<HarborReplicationPolicy> => {
  const result = await apiPost(`${API_PREFIX}/registries/${harborId}/replication/policies`, data);
  return result?.data || result;
};

/**
 * 更新复制规则
 * @param harborId Harbor 实例 ID
 * @param policyId 规则 ID
 * @param data 更新的配置
 * @returns 更新后的规则
 */
export const updateHarborReplicationPolicy = async (
  harborId: string,
  policyId: number,
  data: Partial<HarborReplicationPolicy>,
): Promise<HarborReplicationPolicy> => {
  const result = await apiPut(
    `${API_PREFIX}/registries/${harborId}/replication/policies/${policyId}`,
    data,
  );
  return result?.data || result;
};

/**
 * 删除复制规则
 * @param harborId Harbor 实例 ID
 * @param policyId 规则 ID
 */
export const deleteHarborReplicationPolicy = async (
  harborId: string,
  policyId: number,
): Promise<void> => {
  return await apiDelete(`${API_PREFIX}/registries/${harborId}/replication/policies/${policyId}`);
};

/**
 * 获取复制执行记录
 * @param harborId Harbor 实例 ID
 * @param policyId 规则 ID（可选，不传则获取全部）
 * @returns 执行记录列表
 */
export const getHarborReplicationExecutions = async (
  harborId: string,
  policyId?: number,
): Promise<HarborReplicationExecution[]> => {
  const url = policyId
    ? `${API_PREFIX}/registries/${harborId}/replication/policies/${policyId}/executions`
    : `${API_PREFIX}/registries/${harborId}/replication/executions`;
  const result = await apiRequest(url);
  return result?.data || result;
};

/**
 * 手动触发复制
 * @param harborId Harbor 实例 ID
 * @param policyId 规则 ID
 * @returns 执行 ID
 */
export const triggerHarborReplication = async (
  harborId: string,
  policyId: number,
): Promise<{ executionId: number }> => {
  const result = await apiPost(
    `${API_PREFIX}/registries/${harborId}/replication/policies/${policyId}/executions`,
    {},
  );
  return result?.data || result;
};

// ==================== 工作负载集成 ====================

/**
 * 同步凭证到 K8s Secret
 * @param harborId Harbor 实例 ID
 * @param params 同步参数
 * @returns 同步结果
 */
export const syncHarborSecret = async (
  harborId: string,
  params: HarborSyncSecretParams,
): Promise<HarborSyncSecretResult> => {
  const result = await apiPost(`${API_PREFIX}/registries/${harborId}/sync-secret`, params);
  return result?.data || result;
};

// ==================== 镜像选择器 ====================

/**
 * 获取镜像选择器 - 项目列表
 * @param harborId Harbor 实例 ID
 * @returns 项目名称列表
 */
export const getHarborSelectorProjects = async (
  harborId: string,
): Promise<string[]> => {
  const result = await apiRequest(`${API_PREFIX}/registries/${harborId}/selector/projects`);
  return result?.data || result;
};

/**
 * 获取镜像选择器 - 仓库列表
 * @param harborId Harbor 实例 ID
 * @param projectName 项目名称
 * @returns 仓库名称列表
 */
export const getHarborSelectorRepositories = async (
  harborId: string,
  projectName: string,
): Promise<string[]> => {
  const result = await apiRequest(
    `${API_PREFIX}/registries/${harborId}/selector/projects/${encodeURIComponent(projectName)}/repositories`,
  );
  return result?.data || result;
};

/**
 * 获取镜像选择器 - 标签列表
 * @param harborId Harbor 实例 ID
 * @param projectName 项目名称
 * @param repoName 仓库名称
 * @returns 标签列表
 */
export const getHarborSelectorTags = async (
  harborId: string,
  projectName: string,
  repoName: string,
): Promise<string[]> => {
  const result = await apiRequest(
    `${API_PREFIX}/registries/${harborId}/selector/projects/${encodeURIComponent(projectName)}/repositories/${encodeURIComponent(repoName)}/tags`,
  );
  return result?.data || result;
};
