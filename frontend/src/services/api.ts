// API服务函数
// 远端访问时，如果 .env 指向 localhost，会导致请求打到访问者本机而非服务器。
// 当页面不在 localhost 但 REACT_APP_API_URL 仍指向 localhost 时，改为当前页的 origin（同源）。
//
// HTTPS + Nginx 反代时：页面为 https://host/ ，API 必须是同源 https://host/api/... ，不能写成 https://host:5001
//（5001 仅在服务器本机监听，且常为 HTTP；浏览器直连会失败或混合内容被拦）。

// 导入请求管理器（提供去重、缓存、重试功能）
import { requestManager } from '../utils/requestManager';
// 导入统一的 token 存储工具
import { getToken } from '../utils/tokenStorage';

const defaultApiBase = (() => {
  const envUrl = process.env.REACT_APP_API_URL;
  if (envUrl) {
    if (typeof window !== 'undefined') {
      const isPageLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      const envIsLocalhost = /localhost|127\.0\.0\.1/.test(envUrl);
      if (!isPageLocalhost && envIsLocalhost) {
        // 避免浏览器去连「用户本机」的 127.0.0.1；但不能用 location.origin（会把 API/WS 留在 :5000）。
        const { protocol, hostname, port } = window.location;
        const isLocalDevPort = port === '3000' || port === '5000' || port === '5173';
        if (isLocalDevPort) {
          return `${protocol}//${hostname}:5001`;
        }
        return window.location.origin;
      }
    }
    return envUrl;
  }
  if (typeof window !== 'undefined') {
    const { protocol, hostname, port } = window.location;
    const isLocalDevPort = port === '3000' || port === '5000' || port === '5173';
    // 开发态：CRA/Vite 常见端口上，无论 localhost 还是局域网 IP（如 10.x），API 与 WS 都指向同主机 5001。
    // 否则用页面 origin 会导致 ws 打到 :5000，而 kv-vnc 只在后端监听，出现「closed before established」。
    if (isLocalDevPort) {
      return `${protocol}//${hostname}:5001`;
    }
    return window.location.origin;
  }
  return 'http://localhost:5001';
})();

export const API_BASE_URL = defaultApiBase;

/** 从 requestManager / fetch 抛出的错误中提取后端 message（兼容 responseData） */
export function getApiErrorMessage(error: unknown, fallback: string): string {
  const e = error as {
    message?: string;
    responseData?: { message?: string; error?: unknown; hint?: string };
    response?: { data?: { message?: string; error?: unknown; hint?: string } };
  };
  const data = e?.responseData ?? e?.response?.data;
  let msg = '';
  if (data && typeof data === 'object' && data.message) {
    msg = String(data.message);
    const detail =
      typeof data.error === 'string'
        ? data.error
        : data.error != null
          ? JSON.stringify(data.error)
          : '';
    if (detail && !msg.includes(detail)) {
      msg = `${msg}: ${detail}`;
    }
    if (typeof data.hint === 'string' && data.hint.trim()) {
      msg = `${msg}（${data.hint.trim()}）`;
    }
  } else if (e?.message) {
    msg = e.message;
  }
  if (/^request failed with status code \d+$/i.test(msg.trim())) {
    return fallback;
  }
  return msg || fallback;
}

// 获取认证token
export const getAuthHeaders = () => {
  const token = getToken();
  return {
    'Content-Type': 'application/json',
    'Authorization': token ? `Bearer ${token}` : '',
  };
};

// Helper: Parse error response
const _parseErrorResponse = async (response: Response) => {
    let errorMsg = `HTTP error! status: ${response.status}`;
    let hint: string | undefined;
    try {
        const data = await response.json();
        if (data && typeof data === 'object') {
             // 1. Prefer 'message' field
             if (data.message) {
                 errorMsg = data.message;
                 // Append 'error' detail if exists
                 if (data.error) {
                     const detail = typeof data.error === 'string' ? data.error : JSON.stringify(data.error);
                     // Avoid duplication
                     if (!errorMsg.includes(detail)) {
                        errorMsg += `: ${detail}`;
                     }
                 }
             }
             // 2. VR 配置等接口使用 msg（与 code 成对）
             else if (data.msg) {
                 errorMsg = String(data.msg);
             }
             // 3. Fallback to 'error' field
             else if (data.error) {
                 errorMsg = typeof data.error === 'string' ? data.error : JSON.stringify(data.error);
             }
             if (data.hint && typeof data.hint === 'string') {
                 hint = data.hint;
             }
        }
    } catch (e) {
        // ignore JSON parse error
    }
    const err: any = new Error(errorMsg);
    err.status = response.status;
    err.response = response;
    if (hint) err.hint = hint;
    throw err;
};

/** GET 请求选项：默认不启用内存缓存（控制台资源以新鲜为准）；少数慢变接口可 enableCache: true */
export type ApiGetOptions = {
  skipCache?: boolean;
  silent?: boolean;
  enableCache?: boolean;
  cacheTTL?: number;
  /** 默认 true；与运行中列表/进度轮询等同 URL 并发时建议 false */
  enableDeduplication?: boolean;
  /** 可选：外部中断底层 fetch（如部署步骤超时 abort） */
  signal?: AbortSignal;
};

// 通用请求函数（去重、重试；GET 默认不缓存，按需 opt-in）
export const apiRequest = async (endpoint: string, options?: ApiGetOptions) => {
  try {
    return await requestManager(
      {
        method: 'GET',
        endpoint,
        headers: getAuthHeaders(),
        ...(options?.signal ? { signal: options.signal } : {}),
        options: {
          enableDeduplication: options?.enableDeduplication ?? true,
          enableCache: options?.enableCache ?? false,
          enableRetry: true,
          skipCache: options?.skipCache || false,
          ...(typeof options?.cacheTTL === 'number' ? { cacheTTL: options.cacheTTL } : {}),
        },
      },
      API_BASE_URL
    );
  } catch (error: any) {
    // 如果是预期的 404 错误且设置了 silent，不记录到控制台
    // 这对于诊断功能很重要，因为 Pod 不存在、PVC 不存在是预期的情况
    const is404 = error?.status === 404 || 
                  error?.message?.includes('404') || 
                  error?.message?.includes('Not Found') ||
                  error?.message?.includes('未找到');
    if (!is404 || !options?.silent) {
      console.error(`API请求失败 ${endpoint}:`, error);
    }
    throw error;
  }
};

// 通用 POST 请求（默认带重试，不缓存，不去重）
// 注意：创建操作禁用去重，确保每次点击都能真正创建
export const apiPost = async (
  endpoint: string,
  body: any = {},
  options?: {
    enableRetry?: boolean;
    retryCount?: number;
    retryDelay?: number;
  }
) => {
  try {
    return await requestManager(
      {
        method: 'POST',
        endpoint,
        body,
        headers: getAuthHeaders(),
        options: {
          enableDeduplication: false, // 创建操作不去重，允许重复创建
          enableCache: false, // POST 请求不缓存
          enableRetry: options?.enableRetry ?? true, // 默认保留重试功能
          retryCount: options?.retryCount,
          retryDelay: options?.retryDelay,
        },
      },
      API_BASE_URL
    );
  } catch (error) {
    console.error(`API请求失败 ${endpoint}:`, error);
    throw error;
  }
};

// 通用 DELETE 请求（带重试，不缓存，不去重）
// 注意：删除操作禁用去重，确保每次删除都能真正执行
// body: 可选的请求体（某些 DELETE 请求需要 body，如删除安全组规则）
export const apiDelete = async (endpoint: string, body?: any) => {
  try {
    return await requestManager(
      {
        method: 'DELETE',
        endpoint,
        body,
        headers: getAuthHeaders(),
        options: {
          enableDeduplication: false, // 删除操作不去重，允许重复删除
          enableCache: false, // DELETE 请求不缓存
          enableRetry: true, // 保留重试功能
        },
      },
      API_BASE_URL
    );
  } catch (error) {
    console.error(`API请求失败 ${endpoint}:`, error);
    throw error;
  }
};

// 通用 PUT 请求（带重试，不缓存，不去重）
// 注意：更新操作禁用去重，确保每次更新都能真正执行
export const apiPut = async (endpoint: string, body: any = {}) => {
  try {
    return await requestManager(
      {
        method: 'PUT',
        endpoint,
        body,
        headers: getAuthHeaders(),
        options: {
          enableDeduplication: false, // 更新操作不去重，允许重复更新
          enableCache: false, // PUT 请求不缓存
          enableRetry: true, // 保留重试功能
        },
      },
      API_BASE_URL
    );
  } catch (error) {
    console.error(`API请求失败 ${endpoint}:`, error);
    throw error;
  }
};

// 通用文件上传请求（支持 FormData，带重试，不缓存，不去重）
// 注意：文件上传操作禁用去重，确保每次上传都能真正执行
export const apiUpload = async (endpoint: string, formData: FormData, _options?: { timeout?: number }) => {
  try {
    return await requestManager(
      {
        method: 'POST',
        endpoint,
        body: formData,
        headers: getAuthHeaders(),
        options: {
          enableDeduplication: false, // 文件上传不去重
          enableCache: false, // 文件上传不缓存
          enableRetry: true, // 保留重试功能
        },
      },
      API_BASE_URL
    );
  } catch (error) {
    console.error(`文件上传失败 ${endpoint}:`, error);
    throw error;
  }
};

// 通用 PATCH 请求（带重试，不缓存，不去重）
// 注意：更新操作禁用去重，确保每次更新都能真正执行
export const apiPatch = async (endpoint: string, body: any = {}, options?: { contentType?: string }) => {
  try {
    const headers = { ...getAuthHeaders() };
    // 如果指定了自定义 Content-Type，使用它（例如 application/merge-patch+json）
    if (options?.contentType) {
      headers['Content-Type'] = options.contentType;
    }
    return await requestManager(
      {
        method: 'PATCH',
        endpoint,
        body,
        headers,
        options: {
          enableDeduplication: false, // 更新操作不去重，允许重复更新
          enableCache: false, // PATCH 请求不缓存
          enableRetry: true, // 保留重试功能
        },
      },
      API_BASE_URL
    );
  } catch (error) {
    console.error(`API请求失败 ${endpoint}:`, error);
    throw error;
  }
};

// ===== 租户（VR 绑定下拉）=====
export const fetchTenants = async () => {
  return await apiRequest('/api/tenants');
};

// Organizations of tenant
export const fetchOrganizationsByTenant = async (tenantId: string) => {
  return await apiRequest(`/api/tenants/${tenantId}/organizations`);
};

// ===== SRv6 隧道 =====
export type Srv6ConfigHealth = 'ok' | 'drift' | 'missing_archive' | 'endpoint_missing';

export const fetchSrv6Tunnels = async (options?: {
  skipCache?: boolean;
  /** 附带配置面对账摘要（按 VR 去重；无 SRv6 流量计数） */
  includeHealth?: boolean;
}) => {
  const q = options?.includeHealth ? '?includeHealth=1' : '';
  return await apiRequest(`/api/networks/srv6${q}`, { skipCache: options?.skipCache });
};

// Harvester Extended Resources
// Moved to harvesterApi.ts



export type Srv6TunnelWritePayload = {
  name: string;
  peA: string;
  peB: string;
  ceA: string;
  ceB: string;
  peAInnerIf?: string;
  peBInnerIf?: string;
  rdRtMeta?: { rtCommon: string; rdMap: Record<string, string> } | null;
  injectedDelta?: Record<string, unknown>;
  endpointFingerprint?: Record<string, unknown>;
  tunnelTopology?: 'S' | 'H';
  hubPeSlot?: 'peA' | 'peB';
  hubBindings?: {
    hubPeUuid: string;
    spokePeUuid: string;
    hubPeSlot: 'peA' | 'peB';
    wanIf: string;
    lanIf?: string;
    peerPublicNeighbor: string;
  };
  hubVrfMode?: 'REUSE_VRF' | 'DEDICATED_VRF';
};

export const createSrv6Tunnel = async (payload: Srv6TunnelWritePayload) => {
  return await apiPost('/api/networks/srv6', payload);
};

export const updateSrv6Tunnel = async (id: string, payload: Srv6TunnelWritePayload) => {
  return await apiPut(`/api/networks/srv6/${id}`, payload);
};

export const fetchSrv6Tunnel = async (
  id: string,
  options?: { skipCache?: boolean },
) => {
  return await apiRequest(`/api/networks/srv6/${encodeURIComponent(id)}`, {
    // 详情用于编辑 / 架构 / REUSE 继承，默认跳过缓存
    skipCache: options?.skipCache ?? true,
  });
};

export type Srv6TunnelHealthStep = {
  key: 'bgp' | 'privateBgp' | 'dataplane' | 'ceReach';
  status: 'pass' | 'fail' | 'skip';
  message: string;
};

export type Srv6TunnelHealthReport = {
  tunnelId: string;
  name: string;
  lifecycleStatus: string;
  topology: 'S' | 'H' | null;
  hubPeSlot: 'peA' | 'peB' | null;
  hubBindings?: {
    wanIf?: string;
    lanIf?: string;
    peerPublicNeighbor?: string;
  } | null;
  hasInjectedDelta: boolean;
  endpoints: Array<{
    slot: 'peA' | 'peB' | 'ceA' | 'ceB';
    vrUuid: string;
    vrName: string | null;
    reconcile: { issues: Array<{ code: string; message: string }>; tunnelCount: number };
  }>;
  steps: Srv6TunnelHealthStep[];
  checkedAt: string;
};

/** 隧道健康巡检：BGP 公网/私网邻居、SRv6 数据面、CE A↔B LAN Ping */
export const fetchSrv6TunnelHealth = async (id: string): Promise<Srv6TunnelHealthReport> => {
  const res = await apiRequest(`/api/networks/srv6/${encodeURIComponent(id)}/health`, {
    skipCache: true,
  });
  if (res && typeof res === 'object' && 'data' in (res as object)) {
    return (res as { data: Srv6TunnelHealthReport }).data;
  }
  return res as Srv6TunnelHealthReport;
};

export type Srv6HubPortRegistryEntry = {
  tunnelId: string;
  tunnelName: string;
  hubPeSlot: 'peA' | 'peB';
  wanIf: string;
  lanIf?: string;
  lanInventoryId?: string;
  peerPublicNeighbor: string;
  spokePeUuid: string;
  hubVrfMode?: 'REUSE_VRF' | 'DEDICATED_VRF' | null;
};

export type Srv6HubInventoryOptionTag = 'idle' | 'wan_reusable' | 'lan_dedicated_occupied';

export type Srv6HubWanInventoryItem = {
  id: string;
  ifName: string;
  ipv4?: string;
  ipv6: string;
  source: 'role_wizard' | 'device_baseline';
  createdByTunnelId?: string;
  createdAt: string;
  tags?: Srv6HubInventoryOptionTag[];
  label?: string;
  selectable?: boolean;
};

export type Srv6HubLanInventoryItem = {
  id: string;
  ifName: string;
  vrf: number;
  ipv4?: string;
  ipv6?: string;
  privateAsn: number;
  routerId: string;
  source: 'role_wizard' | 'device_baseline';
  createdByTunnelId?: string;
  createdAt: string;
  tags?: Srv6HubInventoryOptionTag[];
  label?: string;
  selectable?: boolean;
};

export type Srv6HubInventory = {
  wan: Srv6HubWanInventoryItem[];
  lan: Srv6HubLanInventoryItem[];
};

export type Srv6HubInventoryUi = {
  inventory: Srv6HubInventory;
  inventoryEmpty: boolean;
  guidance?: string;
  wanOptions: Srv6HubWanInventoryItem[];
  lanOptions: Srv6HubLanInventoryItem[];
};

export type Srv6HubVrStatus = {
  vrUuid: string;
  tunnelCount: number;
  isHub: boolean;
  role?: string | null;
  tunnels: Array<{
    tunnelId: string;
    tunnelName: string;
    slot: 'peA' | 'peB' | 'ceA' | 'ceB';
    peAInnerIf?: string | null;
    peBInnerIf?: string | null;
    ceA?: string | null;
    ceB?: string | null;
    innerIfMeta?: { innerIf?: string; innerVrf?: string | number | null };
    tunnelTopology?: 'S' | 'H';
    hubPeSlot?: 'peA' | 'peB' | null;
    hubVrfMode?: 'REUSE_VRF' | 'DEDICATED_VRF' | null;
    hubBindings?: {
      hubPeUuid: string;
      spokePeUuid: string;
      hubPeSlot: 'peA' | 'peB';
      wanIf: string;
      lanIf?: string;
      wanInventoryId?: string;
      lanInventoryId?: string;
      peerPublicNeighbor: string;
    } | null;
  }>;
  portRegistry: Srv6HubPortRegistryEntry[];
  hubInventory: Srv6HubInventory;
  hubInventoryUi: Srv6HubInventoryUi;
};

/** P3：查询某 VR 的 Hub 多隧道引用状态 */
export const fetchSrv6HubStatus = async (vrUuid: string): Promise<Srv6HubVrStatus> => {
  return await apiRequest(`/api/networks/srv6/vr/${encodeURIComponent(vrUuid)}/hub`, {
    skipCache: true,
  });
};

export type Srv6VrReference = {
  tunnelId: string;
  tunnelName: string;
  slot: 'peA' | 'peB' | 'ceA' | 'ceB';
};

export type Srv6VrReferencesResp = {
  vrUuid: string;
  count: number;
  refs: Srv6VrReference[];
};

/** 查询某 VR 是否被 SRv6 隧道引用（向导保护用） */
export const fetchSrv6VrReferences = async (vrUuid: string): Promise<Srv6VrReferencesResp> => {
  return await apiRequest(`/api/networks/srv6/vr/${encodeURIComponent(vrUuid)}/references`, {
    skipCache: true,
  });
};

export type Srv6ReconcileIssue = {
  code: string;
  message: string;
};

export type Srv6ReconcileItem = {
  vrUuid: string;
  vrName?: string | null;
  tunnelCount: number;
  issues: Srv6ReconcileIssue[];
  repaired: boolean;
  repairActions: string[];
};

export type Srv6ReconcileReport = {
  scanned: number;
  withIssues: number;
  repaired: number;
  items: Srv6ReconcileItem[];
};

/** P4：SRv6 配置对账（只读） */
export const fetchSrv6Reconcile = async (vrUuid?: string): Promise<Srv6ReconcileReport> => {
  const qs = vrUuid ? `?vrUuid=${encodeURIComponent(vrUuid)}` : '';
  return await apiRequest(`/api/networks/srv6/reconcile${qs}`, { skipCache: true });
};

/** P4：SRv6 配置对账并修复 */
export const repairSrv6Reconcile = async (options?: {
  vrUuid?: string;
  repair?: boolean;
}): Promise<Srv6ReconcileReport> => {
  return await apiPost('/api/networks/srv6/reconcile', {
    vrUuid: options?.vrUuid,
    repair: options?.repair !== false,
  });
};

/** 始终回退平台库；可选择跳过设备下发 */
export const deleteSrv6Tunnel = async (
  id: string,
  options?: { revertDevice?: boolean },
) => {
  const qs: string[] = [];
  if (options?.revertDevice === false) qs.push('revertDevice=0');
  const suffix = qs.length ? `?${qs.join('&')}` : '';
  return await apiDelete(`/api/networks/srv6/${id}${suffix}`);
};

// ===== IPsec VPN =====
export const fetchIPsecVPNsMerged = async (params?: {
  vrId?: string;
  skipCache?: boolean;
  /** 默认 true：合并设备侧网卡/流量；列表首屏可传 false */
  includeDevice?: boolean;
}) => {
  const qs: string[] = [];
  if (params?.includeDevice !== false) qs.push('includeDevice=1');
  if (params?.vrId) qs.push(`vrId=${encodeURIComponent(params.vrId)}`);
  const url = `/api/networks/ipsec${qs.length ? `?${qs.join('&')}` : ''}`;
  return await apiRequest(url, { skipCache: params?.skipCache });
};

export const createIPsecVPN = async (payload: any) => {
  return await apiPost('/api/networks/ipsec', payload);
};

export const updateIPsecVPN = async (id: string, payload: any) => {
  return await apiPut(`/api/networks/ipsec/${id}`, payload);
};

export const deleteIPsecVPN = async (id: string) => {
  return await apiDelete(`/api/networks/ipsec/${id}`);
};

// ============================================================================
// 代理 API 服务函数（用于 CSM CTL 通信）
// ============================================================================

/**
 * 获取 CSM CTL 签名信息
 * @param path CSM CTL API 路径
 * @param method HTTP 方法
 * @param other 其他查询参数
 * @param bodyRaw 请求体（字符串）
 * @returns 包含 Authorization 和 tonce 的认证信息
 */
export const getProxyAuthInfo = async (
  path: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
  other: string = '',
  bodyRaw: string = '',
  accessKey: string = 'Cloudmap#123',
  secretKey: string = 'Cloudmap#123'
): Promise<{ Authorization: string; tonce: string }> => {
  const authUrl = `/api-proxy/api/sign?url=${encodeURIComponent(path)}&method=${method}&other=${encodeURIComponent(other)}&accessKey=${encodeURIComponent(accessKey)}&secretKey=${encodeURIComponent(secretKey)}`;
  // 注意：
  // 1) 这里如果把 JSON 字符串直接作为 body 交给 requestManager，会被再次 JSON.stringify，导致后端解析为非法 JSON（""{\"uuid\""...）。
  // 2) 因此 bodyRaw 存在时先尝试 JSON.parse 成对象再发送；空 body 发送 {}。
  let signBody: any = {};
  if (bodyRaw && typeof bodyRaw === 'string') {
    try {
      signBody = JSON.parse(bodyRaw);
    } catch {
      // bodyRaw 非 JSON 时退回空对象，避免签名接口因解析失败直接 500
      signBody = {};
    }
  }
  const response = await requestManager(
    {
      method: 'POST',
      endpoint: authUrl,
      body: signBody,
      headers: {
        'Content-Type': 'application/json',
      },
      options: {
        enableDeduplication: false,
        enableCache: false,
        enableRetry: true,
      },
    },
    API_BASE_URL
  );
  const info = (response && response.data) ? response.data : response;
  if (!info?.Authorization || !info?.tonce) throw new Error('签名失败');
  return { Authorization: info.Authorization, tonce: String(info.tonce) };
};

/**
 * 通过代理调用 CSM CTL API
 * @param path CSM CTL API 路径（如 /V2/ctcontrol/VR3/VRConfig/list）
 * @param method HTTP 方法
 * @param other 查询参数（如 uuid=xxx）
 * @param body 请求体（对象，会自动序列化为 JSON）
 * @returns API 响应数据
 */
export const proxyApiRequest = async (
  path: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
  other: string = '',
  body?: any,
  accessKey?: string,
  secretKey?: string
): Promise<any> => {
  // 1. 获取签名信息
  const bodyRaw = body ? JSON.stringify(body) : '';
  const authInfo = await getProxyAuthInfo(path, method, other, bodyRaw, accessKey, secretKey);
  
  // 2. 构建请求 URL
  const queryUrl = `/api-proxy${path}${other ? `?${other}` : ''}`;
  
  // 3. 发送请求（使用统一的 API 服务，但需要自定义 headers）
  // DELETE/GET 无 body 时不带 Content-Type: application/json，避免部分 CSM 网关返回异常
  const headers: Record<string, string> = {
    Authorization: authInfo.Authorization,
    tonce: authInfo.tonce,
    Accept: 'application/json',
  };
  if (body != null && ['POST', 'PUT', 'PATCH'].includes(String(method).toUpperCase())) {
    headers['Content-Type'] = 'application/json';
  }
  try {
    return await requestManager(
      {
        method,
        endpoint: queryUrl,
        body: body,
        headers,
        options: {
          enableDeduplication: false, // 代理 API 不去重
          enableCache: false, // 代理 API 不缓存
          enableRetry: true, // 保留重试功能
        },
      },
      API_BASE_URL
    );
  } catch (error) {
    console.error(`代理 API 请求失败 ${path}:`, error);
    throw error;
  }
};

// Harvester Events
