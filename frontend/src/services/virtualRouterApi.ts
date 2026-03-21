/**
 * 虚拟路由器网络 API 服务
 * 
 * 本文件整合了所有与 CSM CTL 虚拟路由器相关的 API 调用，包括：
 * - VR 生命周期管理（创建、更新、删除等）
 * - VR 配置管理（保存、获取、角色设置等）
 * - VR 发现和缓存
 * - ACL（访问控制列表）管理
 * - NAT（网络地址转换）管理
 * 
 * 所有功能最终都围绕 CSM CTL 的虚拟路由器配置管理。
 * 
 * @module virtualRouterApi
 */

import { apiRequest, apiPost, apiDelete, apiPatch, getProxyAuthInfo, proxyApiRequest } from './api';

// ============================================================================
// Part 1: Lifecycle Management (Migrated from vrApi.ts)
// 虚拟路由器生命周期管理 - 直接通过 /api-proxy 访问 CSM CTL，使用 HMAC 签名
// ============================================================================

/**
 * 调试日志输出（仅在开发环境）
 * @param message 日志消息
 */
function logDebug(message: string) {
  if (process.env.NODE_ENV === 'development') {
    console.log(`[VR_DEBUG] ${message}`);
  }
}

/**
 * 错误日志输出
 * @param message 错误消息
 */
function logError(message: string) {
  console.error(`[VR_DEBUG_ERROR] ${message}`);
}

// 代理路径常量（用于直接访问 CSM CTL）
const PROXY_BASE_URL = '/api-proxy';
const PROXY_PATH = '/api-proxy';

/**
 * CSM CTL 认证信息接口
 */
export interface AuthInfo {
  /** HMAC 签名的 Authorization 头 */
  Authorization: string;
  /** 时间戳（tonce） */
  tonce: number;
}

/**
 * 获取 CSM CTL API 认证信息（HMAC 签名）
 * @param path API 路径，默认为 "/V2/ctcontrol/VR1/pagelist"
 * @param method HTTP 方法，默认为 "GET"
 * @param other 其他查询参数，默认为 "page_size=3&page_num=1"
 * @param body 请求体（可选）
 * @returns Promise<AuthInfo> 包含 Authorization 和 tonce 的认证信息
 */
export const getAuthInfo = async (
  path: string = "/V2/ctcontrol/VR1/pagelist",
  method: string = "GET",
  other: string = "page_size=3&page_num=1",
  body?: any
): Promise<AuthInfo> => {
  logDebug('开始获取认证信息');
  
  try {
    const ACCESS_KEY = "Cloudmap#123";
    const SECRET_KEY = "Cloudmap#123";
    
    const bodyRaw = body ? JSON.stringify(body) : '';
    const authInfo = await getProxyAuthInfo(path, method as 'GET' | 'POST', other, bodyRaw, ACCESS_KEY, SECRET_KEY);
    
    return {
      Authorization: authInfo.Authorization,
      tonce: Number(authInfo.tonce)
    };
  } catch (error: any) {
    logError(`❌ 获取认证信息失败: ${error.message}`);
    throw error;
  }
};

/**
 * VR API 工具函数
 */
export const vrApiUtils = {
  /**
   * 测试 CSM CTL 认证是否正常
   * @returns Promise<{success: boolean, authInfo?: AuthInfo, error?: string}>
   */
  testAuth: async () => {
    try {
      const authInfo = await getAuthInfo();
      return { success: true, authInfo };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
};

/**
 * VR API 对象（向后兼容，使用统一的代理 API 函数）
 * 所有方法直接调用 CSM CTL 的 /V2/ctcontrol/VR1 接口
 */
export const vrApi = {
  /**
   * 获取虚拟路由器实例列表（分页）
   * @param pageSize 每页数量，默认 3
   * @param pageNum 页码，默认 1
   * @returns Promise<any> VR 实例列表数据
   */
  getVRInstances: async (pageSize: number = 3, pageNum: number = 1) => {
    try {
      const path = "/V2/ctcontrol/VR1/pagelist";
      const method = "GET";
      const other = `page_size=${pageSize}&page_num=${pageNum}`;
      return await proxyApiRequest(path, method as 'GET' | 'POST', other);
    } catch (error: any) {
      logError(`获取VR实例列表失败: ${error.message}`);
      if (error?.code || error?.msg) {
        throw new Error(`[错误码: ${error.code}] ${error.msg}`);
      }
      throw error;
    }
  },
  
  /**
   * 获取单个虚拟路由器实例详情
   * @param vmId 虚拟路由器实例 ID
   * @returns Promise<any> VR 实例详情数据
   */
  getVRInstance: async (vmId: string) => {
    try {
      const path = `/V2/ctcontrol/VR1/${vmId}`;
      return await proxyApiRequest(path, 'GET', '');
    } catch (error: any) {
      if (error?.code || error?.msg) {
        throw new Error(`[错误码: ${error.code}] ${error.msg}`);
      }
      throw error;
    }
  },
  
  /**
   * 创建虚拟路由器实例
   * @param data VR 实例配置数据
   * @returns Promise<any> 创建结果
   */
  createVRInstance: async (data: any) => {
    try {
      const path = `/V2/ctcontrol/VR1`;
      return await proxyApiRequest(path, 'POST', '', data);
    } catch (error: any) {
      if (error?.code || error?.msg) {
        throw new Error(`[错误码: ${error.code}] ${error.msg}`);
      }
      throw error;
    }
  },
  
  /**
   * 更新虚拟路由器实例
   * @param vmId 虚拟路由器实例 ID
   * @param data 更新的配置数据
   * @returns Promise<any> 更新结果
   */
  updateVRInstance: async (vmId: string, data: any) => {
    try {
      const path = `/V2/ctcontrol/VR1/${vmId}`;
      return await proxyApiRequest(path, 'PUT', '', data);
    } catch (error: any) {
      if (error?.code || error?.msg) {
        throw new Error(`[错误码: ${error.code}] ${error.msg}`);
      }
      throw error;
    }
  },
  
  /**
   * 删除虚拟路由器实例
   * @param vmId 虚拟路由器实例 ID
   * @returns Promise<any> 删除结果
   */
  deleteVRInstance: async (vmId: string) => {
    try {
      const path = `/V2/ctcontrol/VR1/${vmId}`;
      return await proxyApiRequest(path, 'DELETE', '');
    } catch (error: any) {
      if (error?.code || error?.msg) {
        throw new Error(`[错误码: ${error.code}] ${error.msg}`);
      }
      throw error;
    }
  },

  /**
   * 获取所有虚拟路由器实例（不分页，最多 1000 条）
   * @returns Promise<any[]> VR 实例数组，失败时返回空数组
   */
  getAll: async () => {
    try {
      const res = await vrApi.getVRInstances(1000, 1);
      const data = res?.data ?? res;
      const list = Array.isArray(data?.page) ? data.page : 
                   Array.isArray(data?.list) ? data.list : 
                   Array.isArray(data?.rows) ? data.rows :
                   Array.isArray(data) ? data : [];
      return list;
    } catch (e: any) {
      logError(`获取所有VR实例失败: ${e.message}`);
      return [];
    }
  }
};

// ============================================================================
// Part 2: Configuration Management (Migrated from vrConfigApi.ts & vr2Api.ts)
// 虚拟路由器配置管理 - 使用后端 API（数据来源为 CSM CTL，但存储在数据库）
// ============================================================================

/**
 * 获取虚拟路由器配置（从数据库缓存）
 * @param uuid 虚拟路由器 UUID
 * @returns Promise<any | null> VR 配置数据，失败时返回 null
 */
export const getVRConfig = async (uuid: string) => {
  // Use the cached endpoint to ensure we get data from DB
  try {
    const json = await apiRequest(`/api/vr-config/${uuid}/cached`);
    return json?.data ?? null;
  } catch {
    return null;
  }
};

/**
 * 获取虚拟路由器配置（缓存版本，getVRConfig 的别名）
 * @param uuid 虚拟路由器 UUID
 * @returns Promise<any | null> VR 配置数据
 */
export const getVRConfigCached = getVRConfig;

/**
 * 保存虚拟路由器配置到数据库
 * @param uuid 虚拟路由器 UUID
 * @param config 配置数据
 * @param meta 元数据（可选），包含 cloudId、cloudName、vmId
 * @returns Promise<any> 保存结果
 */
export const saveVRConfig = async (uuid: string, config: any, meta?: { cloudId?: string; cloudName?: string; vmId?: string }) => {
  const body: any = { uuid, config };
  if (meta) {
    if (meta.cloudId !== undefined) body.cloudId = meta.cloudId;
    if (meta.cloudName !== undefined) body.cloudName = meta.cloudName;
    if (meta.vmId !== undefined) body.vmId = meta.vmId;
  }
  return await apiPost('/api/vr-config/upsert', body);
};

/**
 * 设置虚拟路由器角色
 * @param uuid 虚拟路由器 UUID
 * @param role 角色类型：'PE'（Provider Edge）、'CE'（Customer Edge）、'标准'、'SASE'
 * @returns Promise<any> 设置结果
 */
export const setVRRole = async (uuid: string, role: 'PE' | 'CE' | '标准' | 'SASE') => {
  return await apiPost('/api/vr-config/set-role', { uuid, role });
};

/**
 * 批量获取虚拟路由器角色
 * @param uuids 虚拟路由器 UUID 数组
 * @returns Promise<Record<string, string>> UUID 到角色的映射对象
 */
export const getVRRoles = async (uuids: string[]) => {
  const qs = uuids && uuids.length ? `?uuids=${encodeURIComponent(uuids.join(','))}` : '';
  const json = await apiRequest(`/api/vr-config/roles${qs}`);
  return (json?.data?.roles ?? {}) as Record<string, string>;
};

/**
 * 从 CSM CTL 获取实时虚拟路由器配置（专家模式）
 * @param uuid 虚拟路由器 UUID
 * @returns Promise<any> 实时配置数据
 * @throws 如果 UUID 为空或查询失败会抛出错误
 */
const fetchVR2 = async (uuid: string): Promise<any> => {
  if (!uuid) throw new Error('缺少UUID');
  
  try {
    const json = await apiRequest(`/api/vr-config/${uuid}/realtime`);
    return json.data;
  } catch (e: any) {
    const errorMsg = e?.message || `VR配置查询失败`;
    throw new Error(errorMsg);
  }
};

/**
 * 获取虚拟路由器实时配置（从 CSM CTL 直接获取）
 * @param uuid 虚拟路由器 UUID
 * @returns Promise<any> 实时配置数据
 */
export const getVR2Config = async (uuid: string): Promise<any> => {
  return await fetchVR2(uuid);
};

/**
 * 获取虚拟路由器实时配置（原始数据，getVR2Config 的别名）
 * @param uuid 虚拟路由器 UUID
 * @returns Promise<any> 实时配置数据
 */
export const getVR2ConfigRaw = getVR2Config;

// ============================================================================
// Part 3: Discovery & Cache (Migrated from vrCacheApi.ts)
// 虚拟路由器发现和缓存管理
// ============================================================================

/**
 * 获取虚拟路由器缓存分页列表
 * @param pageSize 每页数量，默认 50
 * @param pageNum 页码，默认 1
 * @returns Promise<any> 分页列表数据
 */
export const fetchVrCachePageList = async (pageSize: number = 50, pageNum: number = 1) => {
  return await apiRequest(`/api/vr-cache/pagelist?page_size=${pageSize}&page_num=${pageNum}`);
};

/**
 * 获取虚拟路由器实时列表（从 CSM CTL）
 * @param pageSize 每页数量，默认 50
 * @param pageNum 页码，默认 1
 * @returns Promise<any> 实时列表数据
 */
export const fetchVrRealtimeList = async (pageSize: number = 50, pageNum: number = 1) => {
  const res = await apiRequest(`/api/vr-config/pagelist?page_size=${pageSize}&page_num=${pageNum}`);
  return res;
};

/**
 * 更新或插入虚拟路由器缓存
 * @param pageNum 页码
 * @param pageSize 每页数量
 * @param data 缓存数据
 * @returns Promise<any> 操作结果
 */
export const upsertVrCache = async (pageNum: number, pageSize: number, data: any) => {
  return await apiPost('/api/vr-cache/upsert', { page_num: pageNum, page_size: pageSize, data });
};

/**
 * 标准化虚拟路由器行数据，提取 uuid 和 name
 * @param rows 原始行数据数组
 * @returns Array<{uuid: string, name: string}> 标准化后的数组，只包含有效的 uuid
 */
export const normalizeVrRows = (rows: any[]): Array<{ uuid: string; name: string }> => {
  const list = Array.isArray(rows) ? rows : [];
  return list
    .map((item: any) => ({
      uuid: item.uuid || item.vm_id || item.id || item.vmId || item.vm_uuid || '',
      name: item.name || item.vm_name || item.vmName || item.uuid || '未命名VR',
    }))
    .filter(v => v.uuid);
};

// ============================================================================
// Part 4: ACL (Access Control List) Management
// 访问控制列表管理 - 最终推送到 CSM CTL VR 配置
// ============================================================================

/**
 * ACL 组绑定关系接口
 */
export interface ACLGroupBinding {
  /** 绑定 ID */
  id: string;
  /** ACL 组 ID */
  aclGroupId: string;
  /** 虚拟路由器 ID */
  vrId: string;
}

/**
 * ACL 组接口
 */
export interface ACLGroup {
  /** 组 ID */
  id: string;
  /** 组名称 */
  name: string;
  /** ACL ID（可选） */
  aclId?: number;
  /** 描述（可选） */
  description?: string;
  /** 虚拟路由器 ID（可选） */
  vrId?: string;
  /** 规则列表（可选） */
  rules?: ACLRule[];
  /** 绑定关系列表（可选） */
  bindings?: ACLGroupBinding[];
  /** 创建时间 */
  createdAt: string;
  /** 更新时间 */
  updatedAt: string;
}

/**
 * ACL 规则接口
 */
export interface ACLRule {
  /** 规则 ID */
  id: string;
  /** 规则名称 */
  name: string;
  /** 描述（可选） */
  description?: string;
  /** 虚拟路由器 ID */
  vrId: string;
  /** 所属组 ID（可选） */
  groupId?: string;
  /** 优先级 */
  priority: number;
  /** 动作：允许或拒绝 */
  action: 'permit' | 'deny';
  /** 协议类型 */
  protocol: 'tcp' | 'udp' | 'icmp' | 'any';
  /** 源 IP 地址（CIDR 或 IP） */
  sourceIp: string;
  /** 目标 IP 地址（CIDR 或 IP） */
  destinationIp: string;
  /** 源端口（范围或单个端口） */
  sourcePort: string;
  /** 目标端口（范围或单个端口） */
  destinationPort: string;
  /** 创建时间 */
  createdAt: string;
}

/**
 * 获取 ACL 组列表
 * @param vrId 虚拟路由器 ID（可选）
 * @returns Promise<any>
 */
export const getACLGroups = async (vrId?: string) => {
  const qs = vrId ? `?vrId=${encodeURIComponent(vrId)}` : '';
  return await apiRequest(`/api/networks/acl-groups${qs}`);
};

/**
 * 创建 ACL 组
 * @param data ACL 组数据
 * @returns Promise<any>
 */
export const createACLGroup = async (data: Partial<ACLGroup>) => {
  return await apiPost('/api/networks/acl-groups', data);
};

/**
 * 更新 ACL 组
 * @param id ACL 组 ID
 * @param data 更新的数据
 * @returns Promise<any>
 */
export const updateACLGroup = async (id: string, data: Partial<ACLGroup>) => {
  return await apiPatch(`/api/networks/acl-groups/${id}`, data);
};

/**
 * 删除 ACL 组
 * @param id ACL 组 ID
 * @returns Promise<any>
 */
export const deleteACLGroup = async (id: string) => {
  return await apiDelete(`/api/networks/acl-groups/${id}`);
};

/**
 * 将 ACL 组绑定到虚拟路由器
 * @param groupId ACL 组 ID
 * @param vrId 虚拟路由器 ID
 * @returns Promise<any>
 */
export const bindACLGroupToVR = async (groupId: string, vrId: string) => {
  return await apiPost(`/api/networks/acl-groups/${groupId}/bind`, { vrId });
};

/**
 * 从虚拟路由器解绑 ACL 组
 * @param groupId ACL 组 ID
 * @param vrId 虚拟路由器 ID
 * @returns Promise<any>
 */
export const unbindACLGroupFromVR = async (groupId: string, vrId: string) => {
  return await apiPost(`/api/networks/acl-groups/${groupId}/unbind`, { vrId });
};

/**
 * 获取 ACL 组的规则列表
 * @param groupId ACL 组 ID
 * @returns Promise<any>
 */
export const getACLGroupRules = async (groupId: string) => {
  return await apiRequest(`/api/networks/acl-groups/${groupId}/rules`);
};

/**
 * 向 ACL 组添加规则
 * @param groupId ACL 组 ID
 * @param data ACL 规则数据
 * @returns Promise<any>
 */
export const addACLRuleToGroup = async (groupId: string, data: Partial<ACLRule>) => {
  return await apiPost(`/api/networks/acl-groups/${groupId}/rules`, data);
};

/**
 * 获取 ACL 规则列表（传统/直接 API）
 * @param vrId 虚拟路由器 ID（可选）
 * @returns Promise<any>
 */
export const getACLRules = async (vrId?: string) => {
  const qs = vrId ? `?vrId=${encodeURIComponent(vrId)}` : '';
  return await apiRequest(`/api/networks/acl${qs}`);
};

/**
 * 创建 ACL 规则（传统/直接 API）
 * @param data ACL 规则数据
 * @returns Promise<any>
 */
export const createACLRule = async (data: Partial<ACLRule>) => {
  return await apiPost('/api/networks/acl', data);
};

/**
 * 更新 ACL 规则（传统/直接 API）
 * @param id ACL 规则 ID
 * @param data 更新的数据
 * @returns Promise<any>
 */
export const updateACLRule = async (id: string, data: Partial<ACLRule>) => {
  return await apiPatch(`/api/networks/acl/${id}`, data);
};

/**
 * 删除 ACL 规则
 * @param id ACL 规则 ID
 * @returns Promise<any>
 */
export const deleteACLRule = async (id: string) => {
  return await apiDelete(`/api/networks/acl/${id}`);
};

/**
 * 推送 ACL 配置到虚拟路由器（推送到 CSM CTL）
 * @param vrId 虚拟路由器 ID
 * @returns Promise<any>
 */
export const pushACLConfig = async (vrId: string) => {
  return await apiPost('/api/networks/acl/deploy/push', { vrId });
};

// ============================================================================
// Part 5: NAT (Network Address Translation) Management
// 网络地址转换管理 - 最终推送到 CSM CTL VR 配置
// ============================================================================

/**
 * NAT 规则接口
 */
export interface NATRule {
  /** 规则 ID */
  id: string;
  /** 规则名称 */
  name: string;
  /** 描述（可选） */
  description?: string;
  /** 虚拟路由器 ID */
  vrId: string;
  /** NAT 类型：SNAT（源地址转换）、DNAT（目标地址转换）、静态 NAT */
  type: 'snat' | 'dnat' | 'static';
  /** 网络接口（可选） */
  interface?: string;
  /** 原始源 IP（可选） */
  originalSourceIp?: string;
  /** 原始目标 IP（可选） */
  originalDestinationIp?: string;
  /** 原始源端口（可选） */
  originalSourcePort?: string;
  /** 原始目标端口（可选） */
  originalDestinationPort?: string;
  /** 转换后的源 IP（可选） */
  translatedSourceIp?: string;
  /** 转换后的目标 IP（可选） */
  translatedDestinationIp?: string;
  /** 转换后的源端口（可选） */
  translatedSourcePort?: string;
  /** 转换后的目标端口（可选） */
  translatedDestinationPort?: string;
  /** 创建时间 */
  createdAt: string;
}

/**
 * 获取 NAT 规则列表
 * @param vrId 虚拟路由器 ID（可选）
 * @returns Promise<any>
 */
export const getNATRules = async (vrId?: string) => {
  const qs = vrId ? `?vrId=${encodeURIComponent(vrId)}` : '';
  return await apiRequest(`/api/networks/nat${qs}`);
};

/**
 * 创建 NAT 规则
 * @param data NAT 规则数据
 * @returns Promise<any>
 */
export const createNATRule = async (data: Partial<NATRule>) => {
  return await apiPost('/api/networks/nat', data);
};

/**
 * 删除 NAT 规则
 * @param id NAT 规则 ID
 * @returns Promise<any>
 */
export const deleteNATRule = async (id: string) => {
  return await apiDelete(`/api/networks/nat/${id}`);
};

// ============================================================================
// Default Export (向后兼容)
// ============================================================================

export default {
  // Lifecycle (CSM CTL 直接调用)
  vrApi,
  getAuthInfo,
  vrApiUtils,
  
  // Config (后端 API，数据来源 CSM CTL)
  getVRConfig,
  getVRConfigCached,
  saveVRConfig,
  setVRRole,
  getVRRoles,
  getVR2Config,
  getVR2ConfigRaw,
  
  // Cache & Discovery
  fetchVrCachePageList,
  fetchVrRealtimeList,
  upsertVrCache,
  normalizeVrRows,
  
  // ACL Management
  getACLGroups,
  createACLGroup,
  updateACLGroup,
  deleteACLGroup,
  bindACLGroupToVR,
  unbindACLGroupFromVR,
  getACLGroupRules,
  addACLRuleToGroup,
  getACLRules,
  createACLRule,
  updateACLRule,
  deleteACLRule,
  pushACLConfig,
  
  // NAT Management
  getNATRules,
  createNATRule,
  deleteNATRule,
};
