/**
 * HarborProxyService - Harbor API 代理服务
 *
 * 封装 Harbor API 调用，支持认证和错误处理。
 *
 * @see design/harbor-integration-design.md 第三章
 */
import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import https from 'https';
import { HarborRegistry } from '../../entities/harbor/HarborRegistry';
import { logger } from '../../utils/logger';

const harborLog = logger.child('HarborProxy');

/** 数字项目名场景下需要携带真实项目名称与 ID */
export interface HarborProjectContext {
  projectName?: string;
  projectId?: number;
}

export function isNumericHarborProjectName(name: string): boolean {
  return /^\d+$/.test(name);
}

export interface HarborTestResult {
  success: boolean;
  version?: string;
  message?: string;
  error?: string;
}

export interface HarborSystemInfo {
  harbor_version: string;
  registry_url: string;
  external_url: string;
  auth_mode: string;
  self_registration: boolean;
  has_ca_root: boolean;
  project_creation_restriction: string;
  read_only: boolean;
  notification_enable: boolean;
  scan_all_policy?: any;
  [key: string]: any;
}

export class HarborProxyService {
  private static instances: Map<string, HarborProxyService> = new Map();

  public axiosInstance: AxiosInstance; // 改为 public 以便调试
  private registry: HarborRegistry;

  private constructor(registry: HarborRegistry) {
    this.registry = registry;

    // 解密密码（数据库中存储的是加密后的密码）
    const decryptedPassword = Buffer.from(registry.password, 'base64')
      .toString()
      .split('')
      .reverse()
      .join('');

    // 创建 axios 实例
    this.axiosInstance = axios.create({
      baseURL: registry.url,
      timeout: 30000,
      auth: {
        username: registry.username,
        password: decryptedPassword,
      },
      // 对于 HTTPS 连接，始终禁用证书验证（因为私有 Harbor 通常使用自签名证书）
      httpsAgent: new https.Agent({
        rejectUnauthorized: false,
      }),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // 请求拦截器
    this.axiosInstance.interceptors.request.use(
      (config) => {
        harborLog.debug(`[Harbor API] ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => {
        harborLog.error('[Harbor API] Request error:', error);
        return Promise.reject(error);
      },
    );

    // 响应拦截器
    this.axiosInstance.interceptors.response.use(
      (response) => {
        harborLog.debug(`[Harbor API] Response: ${response.status}`);
        return response;
      },
      (error) => {
        const msg = error.response?.data?.message || error.message || 'Unknown error';
        harborLog.error(`[Harbor API] Error: ${msg}`);
        return Promise.reject(error);
      },
    );
  }

  /**
   * 获取或创建 HarborProxyService 实例
   * 注意：始终创建新实例，避免缓存导致密码不一致
   */
  public static getInstance(registry: HarborRegistry): HarborProxyService {
    // 直接创建新实例，不使用缓存
    return new HarborProxyService(registry);
  }

  /**
   * 清除缓存的实例（已废弃，保留兼容性）
   */
  public static clearInstance(registryId: string): void {
    this.instances.delete(registryId);
  }

  /**
   * 测试 Harbor 连接
   */
  public async testConnection(): Promise<HarborTestResult> {
    try {
      harborLog.info(
        `开始测试连接: baseURL=${this.registry.url}, username=${this.registry.username}`,
      );
      const response = await this.axiosInstance.get('/api/v2.0/systeminfo');
      const data: HarborSystemInfo = response.data;

      harborLog.info(`连接成功: version=${data.harbor_version}`);
      return {
        success: true,
        version: data.harbor_version,
        message: '连接成功',
      };
    } catch (error: any) {
      const errorMsg = error.response?.data?.message || error.message || '连接失败';
      harborLog.error(`连接失败: ${errorMsg}`, error.response?.data);
      return {
        success: false,
        error: errorMsg,
        message: `连接失败: ${errorMsg}`,
      };
    }
  }

  /**
   * 获取系统信息
   */
  public async getSystemInfo(): Promise<HarborSystemInfo> {
    const response = await this.axiosInstance.get('/api/v2.0/systeminfo');
    return response.data;
  }

  /**
   * 获取项目列表
   */
  public async getProjects(params?: {
    page?: number;
    pageSize?: number;
    name?: string;
    public?: boolean;
  }): Promise<any[]> {
    const response = await this.axiosInstance.get('/api/v2.0/projects', {
      params: {
        page: params?.page || 1,
        page_size: params?.pageSize || 100,
        ...(params?.name && { name: params.name }),
        ...(params?.public !== undefined && { public: params.public }),
      },
    });
    return response.data;
  }

  /**
   * 按名称查找项目（用于纯数字项目名被 Harbor 误判为 project_id 时的回退）
   */
  private async findProjectByName(name: string): Promise<any | null> {
    const projects = await this.getProjects({ pageSize: 100, name });
    return projects.find((p: any) => p.name === name) ?? null;
  }

  /**
   * 获取项目详情
   */
  public async getProject(
    projectNameOrId: string | number,
    expectedName?: string,
  ): Promise<any> {
    const ref = String(projectNameOrId);
    try {
      const response = await this.axiosInstance.get(
        `/api/v2.0/projects/${encodeURIComponent(ref)}`,
      );
      const project = response.data;
      if (expectedName && project.name !== expectedName) {
        const byName = await this.findProjectByName(expectedName);
        if (byName) return byName;
      }
      return project;
    } catch (error: any) {
      if (expectedName) {
        const byName = await this.findProjectByName(expectedName);
        if (byName) return byName;
      }
      throw error;
    }
  }

  /**
   * 创建项目
   */
  public async createProject(project: {
    project_name: string;
    public?: boolean;
    metadata?: any;
  }): Promise<any> {
    const response = await this.axiosInstance.post('/api/v2.0/projects', {
      project_name: project.project_name,
      public: project.public ?? false,
      metadata: project.metadata,
    });
    return response.data;
  }

  /**
   * 删除项目
   */
  public async deleteProject(projectNameOrId: string | number): Promise<void> {
    await this.axiosInstance.delete(
      `/api/v2.0/projects/${encodeURIComponent(String(projectNameOrId))}`,
    );
  }

  /**
   * 提取实际仓库名（去掉项目前缀）
   * 例如：library/alpine -> alpine
   */
  private extractRepoName(repositoryName: string): string {
    if (repositoryName.includes('/')) {
      const parts = repositoryName.split('/');
      return parts[parts.length - 1];
    }
    return repositoryName;
  }

  /**
   * 仓库/制品 API 的路径段必须使用项目名（如 66），不能用解析后的 project_id（如 15）。
   * Harbor 对纯数字项目名：项目级 API 认 ID，仓库子资源认名称。
   */
  private resolveRepositoryProjectRef(
    harborProjectRef: string,
    context?: HarborProjectContext,
  ): string {
    return context?.projectName ?? harborProjectRef;
  }

  private buildRepositoryApiPath(
    harborProjectRef: string,
    repositoryName: string,
    suffix: string,
    context?: HarborProjectContext,
  ): string {
    const projectPathRef = this.resolveRepositoryProjectRef(harborProjectRef, context);
    const repoSegment = this.extractRepoName(repositoryName);
    return `/api/v2.0/projects/${encodeURIComponent(projectPathRef)}/repositories/${encodeURIComponent(repoSegment)}${suffix}`;
  }

  /**
   * 获取项目下的仓库列表
   */
  public async getRepositories(
    harborProjectRef: string,
    params?: {
      page?: number;
      pageSize?: number;
      q?: string;
      projectName?: string;
      projectId?: number;
    },
  ): Promise<any[]> {
    const projectPathRef = params?.projectName ?? harborProjectRef;

    const response = await this.axiosInstance.get(
      `/api/v2.0/projects/${encodeURIComponent(projectPathRef)}/repositories`,
      {
        params: {
          page: params?.page || 1,
          page_size: params?.pageSize || 100,
          ...(params?.q && { q: params.q }),
        },
      },
    );
    return response.data;
  }

  /**
   * 删除仓库
   */
  public async deleteRepository(
    harborProjectRef: string,
    repositoryName: string,
    context?: HarborProjectContext,
  ): Promise<void> {
    const url = this.buildRepositoryApiPath(harborProjectRef, repositoryName, '', context);
    await this.axiosInstance.delete(url);
  }

  /**
   * 获取单个仓库详情
   */
  public async getRepository(
    harborProjectRef: string,
    repositoryName: string,
    context?: HarborProjectContext,
  ): Promise<any> {
    const url = this.buildRepositoryApiPath(harborProjectRef, repositoryName, '', context);
    const response = await this.axiosInstance.get(url);
    return response.data;
  }

  /**
   * 获取制品列表
   */
  public async getArtifacts(
    harborProjectRef: string,
    repositoryName: string,
    params?: {
      page?: number;
      pageSize?: number;
      q?: string;
      withTag?: boolean;
      withLabel?: boolean;
      withScanOverview?: boolean;
      projectName?: string;
      projectId?: number;
    },
  ): Promise<any[]> {
    const context: HarborProjectContext = {
      projectName: params?.projectName,
      projectId: params?.projectId,
    };
    const url = this.buildRepositoryApiPath(harborProjectRef, repositoryName, '/artifacts', context);

    const response = await this.axiosInstance.get(url, {
      params: {
        page: params?.page || 1,
        page_size: params?.pageSize || 100,
        with_tag: params?.withTag ?? true,
        with_label: params?.withLabel ?? false,
        with_scan_overview: params?.withScanOverview ?? true,
        ...(params?.q && { q: params.q }),
      },
    });
    return response.data;
  }

  /**
   * 获取制品详情
   */
  public async getArtifact(
    harborProjectRef: string,
    repositoryName: string,
    reference: string,
    context?: HarborProjectContext,
  ): Promise<any> {
    const url = this.buildRepositoryApiPath(
      harborProjectRef,
      repositoryName,
      `/artifacts/${reference}`,
      context,
    );
    const response = await this.axiosInstance.get(url);
    return response.data;
  }

  /**
   * 删除制品
   */
  public async deleteArtifact(
    harborProjectRef: string,
    repositoryName: string,
    reference: string,
    context?: HarborProjectContext,
  ): Promise<void> {
    const url = this.buildRepositoryApiPath(
      harborProjectRef,
      repositoryName,
      `/artifacts/${reference}`,
      context,
    );
    await this.axiosInstance.delete(url);
  }

  /**
   * 获取标签列表
   */
  public async getTags(
    harborProjectRef: string,
    repositoryName: string,
    reference: string,
    context?: HarborProjectContext,
  ): Promise<any[]> {
    const url = this.buildRepositoryApiPath(
      harborProjectRef,
      repositoryName,
      `/artifacts/${reference}/tags`,
      context,
    );
    const response = await this.axiosInstance.get(url);
    return response.data;
  }

  /**
   * 创建标签
   */
  public async createTag(
    harborProjectRef: string,
    repositoryName: string,
    reference: string,
    tag: string,
    context?: HarborProjectContext,
  ): Promise<void> {
    const url = this.buildRepositoryApiPath(
      harborProjectRef,
      repositoryName,
      `/artifacts/${reference}/tags`,
      context,
    );
    await this.axiosInstance.post(url, { name: tag });
  }

  /**
   * 删除标签
   */
  public async deleteTag(
    harborProjectRef: string,
    repositoryName: string,
    reference: string,
    tagName: string,
    context?: HarborProjectContext,
  ): Promise<void> {
    const url = this.buildRepositoryApiPath(
      harborProjectRef,
      repositoryName,
      `/artifacts/${reference}/tags/${tagName}`,
      context,
    );
    await this.axiosInstance.delete(url);
  }

  /**
   * 触发漏洞扫描
   */
  public async triggerScan(
    harborProjectRef: string,
    repositoryName: string,
    reference: string,
    context?: HarborProjectContext,
  ): Promise<void> {
    const url = this.buildRepositoryApiPath(
      harborProjectRef,
      repositoryName,
      `/artifacts/${reference}/scan`,
      context,
    );
    await this.axiosInstance.post(url);
  }

  /**
   * 获取漏洞扫描结果
   */
  public async getVulnerabilities(
    harborProjectRef: string,
    repositoryName: string,
    reference: string,
    context?: HarborProjectContext,
  ): Promise<any> {
    const url = this.buildRepositoryApiPath(
      harborProjectRef,
      repositoryName,
      `/artifacts/${reference}/additions/vulnerabilities`,
      context,
    );
    const response = await this.axiosInstance.get(url);
    return response.data;
  }

  /**
   * 获取项目成员列表
   */
  public async getProjectMembers(projectNameOrId: string | number): Promise<any[]> {
    const url = `/api/v2.0/projects/${encodeURIComponent(String(projectNameOrId))}/members`;
    const fullUrl = `${this.registry.url}${url}`;

    harborLog.info(`[成员API] 准备调用:`);
    harborLog.info(`  - url: ${url}`);
    harborLog.info(`  - fullUrl: ${fullUrl}`);
    harborLog.info(`  - baseURL: ${this.registry.url}`);
    harborLog.info(`  - username: ${this.registry.username}`);
    harborLog.info(`  - password_length: ${this.registry.password?.length}`);
    harborLog.info(
      `  - auth_header: Basic ${Buffer.from(`${this.registry.username}:${this.registry.password}`).toString('base64').substring(0, 20)}...`,
    );

    try {
      // 打印 axios 实例的默认配置
      harborLog.info(`[成员API] axios 默认配置:`);
      harborLog.info(`  - baseURL: ${this.axiosInstance.defaults.baseURL}`);
      harborLog.info(`  - auth: ${JSON.stringify(this.axiosInstance.defaults.auth)}`);
      harborLog.info(`  - headers: ${JSON.stringify(this.axiosInstance.defaults.headers)}`);

      const response = await this.axiosInstance.get(url);
      harborLog.info(
        `[成员API] 调用成功: status=${response.status}, data_count=${response.data?.length}`,
      );
      return response.data;
    } catch (error: any) {
      harborLog.error(`[成员API] 调用失败:`);
      harborLog.error(`  - url: ${url}`);
      harborLog.error(`  - status: ${error.response?.status}`);
      harborLog.error(`  - data: ${JSON.stringify(error.response?.data)}`);
      harborLog.error(`  - message: ${error.message}`);
      harborLog.error(`  - request_config: ${JSON.stringify(error.config)}`);
      throw error;
    }
  }

  /**
   * 添加项目成员
   */
  public async addProjectMember(
    projectNameOrId: string | number,
    member: {
      member_name: string;
      member_group?: boolean;
      role_id: number;
    },
  ): Promise<any> {
    const response = await this.axiosInstance.post(
      `/api/v2.0/projects/${encodeURIComponent(String(projectNameOrId))}/members`,
      member,
    );
    return response.data;
  }

  /**
   * 删除项目成员
   */
  public async deleteProjectMember(
    projectNameOrId: string | number,
    memberId: number,
  ): Promise<void> {
    await this.axiosInstance.delete(
      `/api/v2.0/projects/${encodeURIComponent(String(projectNameOrId))}/members/${memberId}`,
    );
  }

  /**
   * 获取项目统计摘要
   */
  public async getProjectSummary(projectNameOrId: string | number): Promise<any> {
    const response = await this.axiosInstance.get(
      `/api/v2.0/projects/${encodeURIComponent(String(projectNameOrId))}/summary`,
    );
    return response.data;
  }

  /**
   * 获取复制规则列表
   */
  public async getReplicationPolicies(): Promise<any[]> {
    const response = await this.axiosInstance.get('/api/v2.0/replication/policies');
    return response.data;
  }

  /**
   * 创建复制规则
   */
  public async createReplicationPolicy(policy: any): Promise<any> {
    const response = await this.axiosInstance.post('/api/v2.0/replication/policies', policy);
    return response.data;
  }

  /**
   * 获取复制执行记录
   */
  public async getReplicationExecutions(params?: {
    page?: number;
    pageSize?: number;
    policyId?: number;
  }): Promise<any[]> {
    const response = await this.axiosInstance.get('/api/v2.0/replication/executions', {
      params: {
        page: params?.page || 1,
        page_size: params?.pageSize || 100,
        ...(params?.policyId && { policy_id: params.policyId }),
      },
    });
    return response.data;
  }

  /**
   * 获取单个复制规则详情
   */
  public async getReplicationPolicy(policyId: number): Promise<any> {
    const response = await this.axiosInstance.get(`/api/v2.0/replication/policies/${policyId}`);
    return response.data;
  }

  /**
   * 更新复制规则
   */
  public async updateReplicationPolicy(policyId: number, policy: any): Promise<any> {
    const response = await this.axiosInstance.put(
      `/api/v2.0/replication/policies/${policyId}`,
      policy,
    );
    return response.data;
  }

  /**
   * 删除复制规则
   */
  public async deleteReplicationPolicy(policyId: number): Promise<void> {
    await this.axiosInstance.delete(`/api/v2.0/replication/policies/${policyId}`);
  }

  /**
   * 触发复制执行
   */
  public async triggerReplication(policyId: number): Promise<any> {
    const response = await this.axiosInstance.post('/api/v2.0/replication/executions', {
      policy_id: policyId,
    });
    return response.data;
  }

  /**
   * 获取扫描指标统计
   */
  public async getScanMetrics(): Promise<any> {
    const response = await this.axiosInstance.get('/api/v2.0/scans/metrics');
    return response.data;
  }

  /**
   * 获取扫描器配置
   */
  public async getScanner(): Promise<any> {
    const response = await this.axiosInstance.get('/api/v2.0/scanners');
    return response.data;
  }

  /**
   * 通用请求方法
   */
  public async request<T = any>(config: AxiosRequestConfig): Promise<T> {
    const response = await this.axiosInstance.request<T>(config);
    return response.data;
  }
}
