/**
 * Harbor 镜像仓库类型定义
 * 
 * 参考设计文档: design/harbor-integration-design.md
 * 
 * @description Harbor 是企业级镜像仓库，支持项目管理、漏洞扫描、复制规则等高级功能
 */

// ==================== Harbor 实例配置 ====================

/**
 * Harbor 实例配置
 * @description 表示一个 Harbor 镜像仓库实例，可以是平台内置或外部接入
 */
export interface HarborRegistry {
  /** 唯一标识 */
  id: string;
  /** 所属资源池 */
  cloudId?: string;
  /** 显示名称 */
  name: string;
  /** Harbor 服务地址 */
  url: string;
  /** 管理员用户名 */
  username: string;
  /** 是否跳过 TLS 验证 */
  insecure: boolean;
  /** 是否为平台内置 Harbor */
  isBuiltIn: boolean;
  /** 连接状态 */
  status: 'healthy' | 'unhealthy' | 'unknown';
  /** Harbor 版本号 */
  version?: string;
  /** 项目数量 */
  projectCount?: number;
  /** 扩展元数据 */
  metadata?: Record<string, unknown>;
  /** 创建时间 */
  createdAt: string;
  /** 更新时间 */
  updatedAt: string;
}

/**
 * 创建/更新 Harbor 实例的请求参数
 */
export interface HarborRegistryForm {
  name: string;
  url: string;
  username: string;
  password: string;
  insecure?: boolean;
  /** 凭证变更时仅同步该资源池内的 K8s 拉取 Secret */
  cloudId?: string;
}

// ==================== 项目管理 ====================

/**
 * Harbor 项目
 * @description Harbor 中的项目，用于组织和隔离镜像资源
 */
export interface HarborProject {
  /** Harbor 中的项目 ID */
  projectId: number;
  /** 项目名称 */
  name: string;
  /** 是否公开（Harbor API 顶层字段） */
  public?: boolean;
  /** 所有者名称 */
  ownerName?: string;
  /** 仓库数量 */
  repoCount: number;
  /** 项目元数据 */
  metadata?: {
    /** 公开访问级别: public, private, protected */
    public?: string;
    /** 信任策略 */
    trustPolicy?: string;
    /** 内容信任 */
    contentTrust?: boolean;
    /** 预签名 */
    cosignEnabled?: boolean;
  };
  /** 创建时间 */
  createdAt: string;
  /** 更新时间 */
  updatedAt?: string;
}

/**
 * 创建项目的请求参数
 */
export interface HarborProjectForm {
  /** 项目名称 */
  projectName: string;
  /** 公开访问级别: 0=私有, 1=公开 */
  public?: number;
  /** 存储配额 */
  storageLimit?: number;
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

// ==================== 仓库管理 ====================

/**
 * Harbor 仓库
 * @description 项目下的镜像仓库
 */
export interface HarborRepository {
  /** 仓库 ID */
  id: number;
  /** 仓库名称 */
  name: string;
  /** 所属项目 ID */
  projectId: number;
  /** 制品数量 */
  artifactCount: number;
  /** 拉取次数 */
  pullCount: number;
  /** 创建时间 */
  createdAt: string;
  /** 更新时间 */
  updatedAt: string;
}

// ==================== 制品管理 ====================

/**
 * Harbor 制品
 * @description 镜像制品，包含一个或多个标签
 */
export interface HarborArtifact {
  /** 制品摘要（sha256:xxx） */
  digest: string;
  /** 制品类型: IMAGE, CHART 等 */
  type: string;
  /** 制品大小（字节） */
  size: number;
  /** 推送时间 */
  pushTime: string;
  /** 最后拉取时间 */
  pullTime?: string;
  /** 标签列表 */
  tags?: HarborTag[];
  /** 扩展属性 */
  extraAttrs?: {
    /** 操作系统 */
    os?: string;
    /** CPU 架构 */
    arch?: string;
    /** 架构（完整字段名） */
    architecture?: string;
    /** 创建时间 */
    created?: string;
    /** 作者 */
    author?: string;
    /** 配置信息 */
    config?: Record<string, any>;
  };
  /** 漏洞扫描摘要 */
  scanOverview?: HarborVulnerabilitySummary;
}

/**
 * Harbor 标签
 * @description 制品的标签
 */
export interface HarborTag {
  /** 标签 ID */
  id: number;
  /** 标签名称 */
  name: string;
  /** 关联的制品摘要 */
  digest: string;
  /** 推送时间 */
  pushTime: string;
  /** 最后拉取时间 */
  pullTime?: string;
}

// ==================== 漏洞扫描 ====================

/**
 * 漏洞扫描摘要
 * @description 制品的漏洞扫描结果概览
 */
export interface HarborVulnerabilitySummary {
  /** 漏洞总数 */
  total: number;
  /** 可修复数量 */
  fixable: number;
  /** 按严重级别统计 */
  summary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
}

/**
 * 漏洞详情
 * @description 单个漏洞的详细信息
 */
export interface HarborVulnerabilityItem {
  /** 漏洞 ID (CVE-xxx) */
  id: string;
  /** 严重级别 */
  severity: 'Critical' | 'High' | 'Medium' | 'Low' | 'Negligible' | 'Unknown';
  /** 受影响的包 */
  package: string;
  /** 当前版本 */
  version: string;
  /** 修复版本 */
  fixVersion?: string;
  /** 描述 */
  description?: string;
  /** 链接 */
  links?: string[];
}

// ==================== 复制规则 ====================

/**
 * 复制规则
 * @description Harbor 镜像复制策略
 */
export interface HarborReplicationPolicy {
  /** 规则 ID */
  id: number;
  /** 规则名称 */
  name: string;
  /** 描述 */
  description?: string;
  /** 源仓库 */
  srcRegistry?: {
    id: number;
    name: string;
    url: string;
  };
  /** 目标仓库 */
  destRegistry?: {
    id: number;
    name: string;
    url: string;
  };
  /** 是否启用 */
  enabled: boolean;
  /** 触发模式 */
  trigger?: {
    type: 'manual' | 'scheduled' | 'event_based';
    triggerSettings?: {
      cron?: string;
    };
  };
  /** 过滤规则 */
  filters?: Array<{
    type: string;
    value: string;
    decoration?: string;
  }>;
  /** 创建时间 */
  creationTime?: string;
  /** 更新时间 */
  updateTime?: string;
}

/**
 * 复制执行记录
 */
export interface HarborReplicationExecution {
  /** 执行 ID */
  id: number;
  /** 规则 ID */
  policyId: number;
  /** 状态: Success, Failed, InProgress, Stopped */
  status: string;
  /** 开始时间 */
  startTime: string;
  /** 结束时间 */
  endTime?: string;
  /** 成功数量 */
  succeeded?: number;
  /** 失败数量 */
  failed?: number;
  /** 总数 */
  total?: number;
}

// ==================== 统一仓库配置接口 ====================

/**
 * 统一的仓库配置接口
 * @description 前端展示层使用的统一仓库配置，兼容通用仓库和 Harbor
 */
export interface RegistryConfig {
  /** 唯一标识 */
  id: string;
  /** 显示名称 */
  name: string;
  /** 服务器地址 */
  server: string;
  /** 仓库类型 */
  type: 'generic' | 'harbor';
  /** 用户名（可选） */
  username?: string;
  /** 密码（可选，仅创建时使用） */
  password?: string;
  /** 是否跳过 TLS 验证 */
  insecure: boolean;
  /** 创建时间 */
  createdAt: string;
  /** Harbor 实例 ID（仅 Harbor 类型） */
  harborId?: string;
  /** 连接状态（仅 Harbor 类型） */
  status?: 'healthy' | 'unhealthy' | 'unknown';
  /** 项目数量（仅 Harbor 类型） */
  projectCount?: number;
  /** 是否平台内置（仅 Harbor 类型） */
  isBuiltIn?: boolean;
  /** Harbor 版本（仅 Harbor 类型） */
  version?: string;
}

// ==================== 镜像上传 ====================

/**
 * 镜像上传参数
 */
export interface HarborImageUploadParams {
  /** Harbor 实例 ID */
  harborId: string;
  /** 目标项目 */
  project: string;
  /** 仓库名称 */
  repository: string;
  /** 标签 */
  tag: string;
  /** 镜像 tar 文件 */
  file: File;
}

/**
 * 上传进度信息
 */
export interface HarborUploadProgress {
  /** 上传 ID */
  uploadId: string;
  /** 进度百分比 (0-100) */
  progress: number;
  /** 状态: uploading, processing, completed, failed */
  status: 'uploading' | 'processing' | 'completed' | 'failed';
  /** 错误信息 */
  error?: string;
}

// ==================== 项目成员 ====================

/**
 * 项目成员
 */
export interface HarborProjectMember {
  /** 成员 ID */
  id: number;
  /** 项目 ID */
  projectId: number;
  /** 实体名称（用户名或组名） */
  entityName: string;
  /** 实体类型: u=用户, g=组 */
  entityType: 'u' | 'g';
  /** 角色 ID: 1=只读, 2=开发者, 3=管理员 */
  roleId: number;
  /** 角色名称 */
  roleName?: string;
}

// ==================== 统计信息 ====================

/**
 * Harbor 系统统计信息
 */
export interface HarborSystemInfo {
  /** Harbor 版本 */
  version: string;
  /** 存储使用情况 */
  storage?: {
    total: number;
    used: number;
  };
  /** 是否启用漏洞扫描 */
  scanEnabled?: boolean;
  /** 是否启用签名验证 */
  notaryEnabled?: boolean;
}

/**
 * 项目统计摘要
 */
export interface HarborProjectSummary {
  /** 项目名称 */
  projectName: string;
  /** 仓库数量 */
  repoCount: number;
  /** 制品数量 */
  artifactCount: number;
  /** 存储使用量（字节） */
  storageSize: number;
  /** 总拉取次数 */
  pullCount: number;
}

// ==================== API 响应类型 ====================

/**
 * 分页查询参数
 */
export interface HarborPaginationParams {
  /** 页码（从 1 开始） */
  page?: number;
  /** 每页数量 */
  pageSize?: number;
  /** 搜索关键词 */
  q?: string;
  /** 排序字段 */
  sort?: string;
}

/**
 * 分页响应
 */
export interface HarborPaginatedResponse<T> {
  /** 数据列表 */
  data: T[];
  /** 总数 */
  total: number;
  /** 当前页 */
  page?: number;
  /** 每页数量 */
  pageSize?: number;
}

// ==================== 凭证同步 ====================

/**
 * 凭证同步参数
 */
export interface HarborSyncSecretParams {
  /** Harvester 云 ID */
  cloudId: string;
  /** K8s 命名空间 */
  namespace: string;
  /** Secret 名称（可选，默认自动生成） */
  secretName?: string;
}

/**
 * 凭证同步结果
 */
export interface HarborSyncSecretResult {
  /** Secret 名称 */
  secretName: string;
  /** 命名空间 */
  namespace: string;
  /** 是否新建 */
  created: boolean;
}
