import { apiRequest, apiPost, apiDelete, apiPatch, apiPut, API_BASE_URL, getAuthHeaders } from './api';
import { requestManager } from '../utils/requestManager';
import { getToken } from '../utils/tokenStorage';
import { appendMergePublicScenarioParam } from './harvester/internal/queryParams';

/**
 * 创建 Harvester VPC
 * @param cloudId 云环境 ID
 * @param payload VPC 配置数据
 * @returns Promise<any>
 */
export const createHarvesterVpc = async (cloudId: string, payload: any) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/vpcs`, payload);
};

/**
 * 删除 Harvester VPC
 * @param cloudId 云环境 ID
 * @param name VPC 名称
 * @returns Promise<any>
 */
export const deleteHarvesterVpc = async (cloudId: string, name: string) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/vpcs/${encodeURIComponent(name)}`);
};

/**
 * 更新 Harvester VPC
 * @param cloudId 云环境 ID
 * @param name VPC 名称
 * @param payload 更新的配置数据
 * @returns Promise<any>
 */
export const updateHarvesterVpc = async (cloudId: string, name: string, payload: any) => {
  const path = `/api/clouds/${cloudId}/resources/vpcs/${encodeURIComponent(name)}`;
  try {
    return await apiPatch(path, payload);
  } catch (e: any) {
    const msg = String(e?.message ?? '');
    if (msg.includes('Cannot PATCH') || e?.status === 404 || e?.response?.status === 404) {
      return await apiPut(path, payload);
    }
    throw e;
  }
};

/**
 * 获取 Harvester 快照列表
 * @param cloudId 云环境 ID
 * @param force 是否强制刷新，默认 false
 * @param skipSync 兼容旧调用，不再发往服务端
 * @returns Promise<any>
 */
export const fetchHarvesterSnapshots = async (
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
    `/api/clouds/${cloudId}/resources/harvester/snapshots${queryString ? `?${queryString}` : ''}`,
    { skipCache: force }
  );
};


/**
 * 删除 Harvester Longhorn 卷
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name 卷名称
 * @returns Promise<any>
 */
export const deleteHarvesterLonghornVolume = async (cloudId: string, namespace: string, name: string) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/harvester/longhorn/volumes/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`);
};

/**
 * 删除 Harvester PVC（持久卷声明）
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name PVC 名称
 * @returns Promise<any>
 */
export const deleteHarvesterPVC = async (cloudId: string, namespace: string, name: string) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/harvester/volumes/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`);
};

/**
 * 删除 Harvester Longhorn 卷
 * @param cloudId 云环境 ID
 * @param force 是否强制刷新，默认 false
 * @returns Promise<any>
 */
export const fetchHarvesterServices = async (cloudId: string, force = false, all?: boolean) => {
  const params: string[] = [];
  if (force) params.push('force=true');
  if (all) params.push('all=true');
  const query = params.length > 0 ? `?${params.join('&')}` : '';
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/containers/services${query}`, force ? { skipCache: true } : undefined);
};

/**
 * 获取 Harvester Ingress 列表
 * @param cloudId 云环境 ID
 * @param force 是否强制刷新，默认 false
 * @returns Promise<any>
 */
export const fetchHarvesterIngresses = async (cloudId: string, force = false, all?: boolean) => {
  const params: string[] = [];
  if (force) params.push('force=true');
  if (all) params.push('all=true');
  const query = params.length > 0 ? `?${params.join('&')}` : '';
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/containers/ingresses${query}`, force ? { skipCache: true } : undefined);
};

/**
 * 获取 Harvester 负载均衡器列表
 * @param cloudId 云环境 ID
 * @param force 是否强制刷新，默认 false
 * @param skipSync 兼容旧调用，不再发往服务端
 * @returns Promise<any>
 */
export const fetchHarvesterLoadBalancers = async (cloudId: string, force = false, skipSync = false) => {
  const params = new URLSearchParams();
  if (force) params.append('force', 'true');
  void skipSync;
  const queryString = params.toString();
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester-loadbalancers${queryString ? `?${queryString}` : ''}`);
};

/**
 * 删除 Harvester 负载均衡（loadbalancer.harvesterhci.io CRD）
 * 走负载均衡专用接口，权限为 clouds.load-balancers:write，区别于容器 Service
 */
export const deleteHarvesterLoadBalancer = async (cloudId: string, namespace: string, name: string) => {
  return await apiDelete(
    `/api/clouds/${cloudId}/resources/harvester-loadbalancers/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`,
  );
};

/**
 * 获取 Harvester IP 池列表
 * @param cloudId 云环境 ID
 * @param force 是否强制刷新，默认 false
 * @param skipSync 兼容旧调用，不再发往服务端
 * @returns Promise<any>
 */
export const fetchHarvesterIPPools = async (cloudId: string, force = false, skipSync = false) => {
  const params = new URLSearchParams();
  if (force) params.append('force', 'true');
  void skipSync;
  const queryString = params.toString();
  return await apiRequest(`/api/clouds/${cloudId}/resources/ippools${queryString ? `?${queryString}` : ''}`);
};

/**
 * 获取 Harvester NAD（网络附加定义）列表
 * @param cloudId 云环境 ID
 * @param force 是否强制刷新，默认 false
 * @param skipSync 兼容旧调用，不再发往服务端
 * @returns Promise<any>
 */
export const fetchHarvesterNads = (cloudId: string, force = false, skipSync = false) => {
  const params = new URLSearchParams();
  if (force) params.append('force', 'true');
  void skipSync;
  const queryString = params.toString();
  const mustBypassCache = !!force;
  return apiRequest(`/api/clouds/${cloudId}/resources/harvester/nads${queryString ? `?${queryString}` : ''}`, {
    skipCache: mustBypassCache,
  });
};

/**
 * 获取 Harvester NAD 详情
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name NAD 名称
 * @returns Promise<any>
 */
export const fetchHarvesterNadDetail = async (cloudId: string, namespace: string, name: string) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/nads/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`);
};

/**
 * 创建 Harvester NAD
 * @param cloudId 云环境 ID
 * @param payload NAD 配置数据
 * @returns Promise<any>
 */
export const createHarvesterNad = async (cloudId: string, payload: any) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/harvester/nads`, payload);
};

/**
 * 删除 Harvester NAD
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name NAD 名称
 * @returns Promise<any>
 */
export const deleteHarvesterNad = async (cloudId: string, namespace: string, name: string) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/harvester/nads/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`);
};

/**
 * 获取 Harvester 系统 Pod 列表
 * @param cloudId 云环境 ID
 * @param params 查询参数，包含分页、关键词、命名空间和状态过滤
 * @returns Promise<any>
 */
export const fetchHarvesterSystemPods = async (cloudId: string, params: { page: number; pageSize: number; keyword?: string; namespace?: string; status?: string } = { page: 1, pageSize: 1000 }) => {
  const query = new URLSearchParams({
    page: params.page.toString(),
    pageSize: params.pageSize.toString(),
    ...(params.keyword && { keyword: params.keyword }),
    ...(params.namespace && { namespace: params.namespace }),
    ...(params.status && { status: params.status }),
  }).toString();
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/pods?${query}`);
};

/** UI 侧分域语义；与后端 query `ovnNetworkScope` 映射见下方 */
export type CloudOvnNetworkScope = 'legacy' | 'flat' | 'vpc';

/** 与 deployment/docs/specs/api/Harvester-OVN-网络接口分域规范.md GET 一致 */
export type OvnNetworkScopeQuery = 'vpc' | 'underlay' | 'all';

function mapUiScopeToListQuery(scope: CloudOvnNetworkScope): OvnNetworkScopeQuery {
  if (scope === 'flat') return 'underlay';
  if (scope === 'vpc') return 'vpc';
  return 'all';
}

/** POST 创建仅 vpc | underlay；legacy 按业务默认走 vpc */
function mapUiScopeToCreateQuery(scope: CloudOvnNetworkScope): 'vpc' | 'underlay' {
  if (scope === 'flat') return 'underlay';
  return 'vpc';
}

/** Section `networkScope` → API 分域（避免各 NAT/EIP 组件重复三元表达式） */
export function uiNetworkScopeToCloudOvn(
  networkScope?: 'flat' | 'vpc',
): CloudOvnNetworkScope {
  if (networkScope === 'flat') return 'flat';
  if (networkScope === 'vpc') return 'vpc';
  return 'legacy';
}

function ovnListUrl(
  cloudId: string,
  resource: 'ovneips' | 'ovnfips' | 'ovnsnatrules' | 'ovndnatrules',
  scope: CloudOvnNetworkScope,
  extra: Record<string, string | boolean | undefined>,
): string {
  const params = new URLSearchParams();
  params.set('ovnNetworkScope', mapUiScopeToListQuery(scope));
  Object.entries(extra).forEach(([k, v]) => {
    if (v === true) params.set(k, 'true');
    else if (v === false && k === 'mergePublicScenarioNamespaces') params.set(k, 'false');
    else if (v != null && v !== false) params.set(k, String(v));
  });
  const q = params.toString();
  return `/api/clouds/${cloudId}/resources/${resource}${q ? `?${q}` : ''}`;
}

function ovnCreateUrl(
  cloudId: string,
  resource: 'ovneips' | 'ovnfips' | 'ovnsnatrules' | 'ovndnatrules',
  scope: CloudOvnNetworkScope,
): string {
  const q = mapUiScopeToCreateQuery(scope);
  return `/api/clouds/${cloudId}/resources/${resource}?ovnNetworkScope=${encodeURIComponent(q)}`;
}

function cloudOvnResourceItemPath(
  cloudId: string,
  resource: 'ovneips' | 'ovnfips' | 'ovnsnatrules' | 'ovndnatrules',
  name: string,
  scope?: CloudOvnNetworkScope,
): string {
  const base = `/api/clouds/${cloudId}/resources/${resource}/${encodeURIComponent(name)}`;
  if (!scope || scope === 'legacy') return base;
  const q = mapUiScopeToListQuery(scope);
  return `${base}?ovnNetworkScope=${encodeURIComponent(q)}`;
}

/**
 * 获取云提供商 OVN EIP（弹性 IP）列表
 * @param scope legacy=全量；flat/vpc=仅默认 VPC / 仅业务 VPC 域
 */
export const fetchCloudProviderOvnEips = async (
  cloudId: string,
  force = false,
  scope: CloudOvnNetworkScope = 'legacy',
  mergePublicScenarioNamespaces?: boolean,
) => {
  const extra: Record<string, string | boolean | undefined> = { force };
  if (mergePublicScenarioNamespaces !== undefined) {
    extra.mergePublicScenarioNamespaces = mergePublicScenarioNamespaces;
  }
  const mustBypassCache = !!force;
  return await apiRequest(ovnListUrl(cloudId, 'ovneips', scope, extra), {
    skipCache: mustBypassCache,
  });
};

/**
 * 获取云提供商 OVN FIP（浮动 IP）列表
 */
export const fetchCloudProviderOvnFips = async (
  cloudId: string,
  force = false,
  scope: CloudOvnNetworkScope = 'legacy',
  mergePublicScenarioNamespaces?: boolean,
) => {
  const extra: Record<string, string | boolean | undefined> = { force };
  if (mergePublicScenarioNamespaces !== undefined) {
    extra.mergePublicScenarioNamespaces = mergePublicScenarioNamespaces;
  }
  return await apiRequest(ovnListUrl(cloudId, 'ovnfips', scope, extra));
};

/**
 * 获取云提供商 OVN SNAT 规则列表
 * @param skipSync 兼容旧调用，不再发往服务端
 */
export const fetchCloudProviderOvnSnatRules = async (
  cloudId: string,
  force = false,
  skipSync = false,
  scope: CloudOvnNetworkScope = 'legacy',
  mergePublicScenarioNamespaces?: boolean,
) => {
  void skipSync;
  const extra: Record<string, string | boolean | undefined> = { force };
  if (mergePublicScenarioNamespaces !== undefined) {
    extra.mergePublicScenarioNamespaces = mergePublicScenarioNamespaces;
  }
  return await apiRequest(ovnListUrl(cloudId, 'ovnsnatrules', scope, extra));
};

/**
 * 获取云提供商 OVN DNAT 规则列表
 * @param skipSync 兼容旧调用，不再发往服务端
 */
export const fetchCloudProviderOvnDnatRules = async (
  cloudId: string,
  force = false,
  skipSync = false,
  scope: CloudOvnNetworkScope = 'legacy',
  mergePublicScenarioNamespaces?: boolean,
) => {
  void skipSync;
  const extra: Record<string, string | boolean | undefined> = { force };
  if (mergePublicScenarioNamespaces !== undefined) {
    extra.mergePublicScenarioNamespaces = mergePublicScenarioNamespaces;
  }
  return await apiRequest(ovnListUrl(cloudId, 'ovndnatrules', scope, extra));
};

/**
 * 创建云提供商 OVN EIP
 */
export const createCloudProviderOvnEip = async (
  cloudId: string,
  payload: any,
  scope: CloudOvnNetworkScope = 'legacy',
) => {
  return await apiPost(ovnCreateUrl(cloudId, 'ovneips', scope), payload);
};

/**
 * 创建云提供商 OVN FIP
 */
export const createCloudProviderOvnFip = async (
  cloudId: string,
  payload: any,
  scope: CloudOvnNetworkScope = 'legacy',
) => {
  return await apiPost(ovnCreateUrl(cloudId, 'ovnfips', scope), payload);
};

/**
 * 创建云提供商 OVN SNAT 规则
 */
export const createCloudProviderOvnSnatRule = async (
  cloudId: string,
  payload: any,
  scope: CloudOvnNetworkScope = 'legacy',
) => {
  return await apiPost(ovnCreateUrl(cloudId, 'ovnsnatrules', scope), payload);
};

/**
 * 创建云提供商 OVN DNAT 规则
 */
export const createCloudProviderOvnDnatRule = async (
  cloudId: string,
  payload: any,
  scope: CloudOvnNetworkScope = 'legacy',
) => {
  return await apiPost(ovnCreateUrl(cloudId, 'ovndnatrules', scope), payload);
};

/**
 * 删除云提供商 OVN EIP
 * @param cloudId 云环境 ID
 * @param name EIP 名称
 * @returns Promise<any>
 */
export const deleteCloudProviderOvnEip = async (
  cloudId: string,
  name: string,
  scope?: CloudOvnNetworkScope,
) => {
  return await apiDelete(cloudOvnResourceItemPath(cloudId, 'ovneips', name, scope));
};

/**
 * 删除云提供商 OVN FIP
 * @param cloudId 云环境 ID
 * @param name FIP 名称
 * @returns Promise<any>
 */
export const deleteCloudProviderOvnFip = async (
  cloudId: string,
  name: string,
  scope?: CloudOvnNetworkScope,
) => {
  return await apiDelete(cloudOvnResourceItemPath(cloudId, 'ovnfips', name, scope));
};

/**
 * 删除云提供商 OVN SNAT 规则
 * @param cloudId 云环境 ID
 * @param name SNAT 规则名称
 * @returns Promise<any>
 */
export const deleteCloudProviderOvnSnatRule = async (
  cloudId: string,
  name: string,
  scope?: CloudOvnNetworkScope,
) => {
  return await apiDelete(cloudOvnResourceItemPath(cloudId, 'ovnsnatrules', name, scope));
};

/**
 * 删除云提供商 OVN DNAT 规则
 * @param cloudId 云环境 ID
 * @param name DNAT 规则名称
 * @returns Promise<any>
 */
export const deleteCloudProviderOvnDnatRule = async (
  cloudId: string,
  name: string,
  scope?: CloudOvnNetworkScope,
) => {
  return await apiDelete(cloudOvnResourceItemPath(cloudId, 'ovndnatrules', name, scope));
};

/**
 * 创建 KubeOVN 子网
 * @param cloudId 云环境 ID
 * @param payload 子网配置数据
 * @returns Promise<any>
 */
export const createKubeOvnSubnet = async (cloudId: string, payload: any) => {
  // 禁用重试：5xx 重试会导致「集群已创建成功但客户端再 POST」类重复
  return await apiPost(`/api/clouds/${cloudId}/resources/subnets`, payload, { enableRetry: false });
};

/**
 * 更新 KubeOVN 子网（Harvester 直连）
 * @param name 路径参数，对应集群 Subnet CR 的 metadata.name（非 UID）
 */
export const updateKubeOvnSubnet = async (cloudId: string, name: string, payload: any) => {
  return await apiPut(`/api/clouds/${cloudId}/resources/subnets/${encodeURIComponent(name)}`, payload);
};

/**
 * 删除 KubeOVN 子网（路径参数 name 与更新接口一致，均为 metadata.name）
 */
export const deleteKubeOvnSubnet = async (cloudId: string, name: string) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/subnets/${encodeURIComponent(name)}`);
};

/**
 * 获取 Harvester 卷列表
 * @param cloudId 云环境 ID
 * @param force 是否强制刷新，默认 false
 * @param skipSync 兼容旧调用，不再发往服务端
 * @returns Promise<any>
 */
export const fetchHarvesterVolumes = async (
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
    `/api/clouds/${cloudId}/resources/harvester/volumes${queryString ? `?${queryString}` : ''}`,
    { skipCache: force }
  );
};

/**
 * 获取 Harvester 可用卷列表
 * @param cloudId 云环境 ID
 * @param namespace 命名空间（可选）
 * @returns Promise<any>
 */
export const fetchHarvesterAvailableVolumes = async (cloudId: string, namespace?: string) => {
  const qs = namespace ? `?namespace=${encodeURIComponent(namespace)}` : '';
  return await apiRequest(
    `/api/clouds/${cloudId}/resources/harvester/available-volumes${qs}`,
    { skipCache: true },
  );
};

/**
 * 从列表 API 响应中取出 items 数组（兼容 data.items 与顶层 items）
 */
export function getHarvesterImagesListItems(
  res: { data?: { items?: Record<string, unknown>[] }; items?: Record<string, unknown>[] } | null | undefined,
): Record<string, unknown>[] {
  const fromData = res?.data?.items;
  if (Array.isArray(fromData)) return fromData;
  const legacy = res?.items;
  if (Array.isArray(legacy)) return legacy;
  return [];
}

/**
 * 获取 Harvester 镜像列表
 * @param cloudId 云环境 ID
 * @param force 是否强制刷新（绕过前端 GET 缓存）
 * @param skipSync true 时请求带 skipSync=true，后端只读 Tower 库存、不触发 syncHarvesterImages 全量同步
 * @returns Promise<any>
 */
export const fetchHarvesterImages = async (
  cloudId: string,
  force = false,
  skipSync = false,
  mergePublicScenarioNamespaces?: boolean,
) => {
  const params = new URLSearchParams();
  if (force) params.append('force', 'true');
  if (skipSync) params.append('skipSync', 'true');
  appendMergePublicScenarioParam(params, mergePublicScenarioNamespaces);
  const queryString = params.toString();
  return apiRequest(
    `/api/clouds/${cloudId}/resources/harvester/images${queryString ? `?${queryString}` : ''}`,
    { skipCache: force },
  );
};

export type HarvesterImageUploadTask = {
  id: string;
  cloudId: string;
  namespace: string;
  displayName?: string;
  imageType?: string;
  filename?: string;
  fileSize?: number;
  virtualSizeBytes?: number;
  chunkSize?: number;
  totalChunks?: number;
  receivedChunks?: number[];
  createdImageName?: string;
  createdImageNamespace?: string;
  status:
    | 'pending'
    | 'ingesting'
    | 'uploaded'
    | 'proxying'
    | 'success'
    | 'failed'
    | 'cancelled';
  phase: 'pending' | 'ingesting' | 'uploaded' | 'proxying' | 'finished';
  progress: number;
  ingestProgress: number;
  proxyProgress: number;
  bytesUploaded: number;
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
};

export const createHarvesterImageUploadTask = async (
  cloudId: string,
  payload: {
    namespace: string;
    displayName?: string;
    imageType?: string;
    filename?: string;
    fileSize?: number;
    chunkSize?: number;
  },
) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/harvester/images/upload-tasks`, payload);
};

export type HarvesterImageUploadDiskCheck = {
  path: string;
  freeBytes: number;
  requiredBytes: number;
  sufficient: boolean;
  message: string;
};

/** 提交上传前检查 Tower 镜像暂存目录剩余空间 */
export const checkHarvesterImageUploadDiskSpace = async (
  cloudId: string,
  fileSize: number,
  chunkSize?: number,
) => {
  const size = Math.max(1, Math.floor(Number(fileSize) || 0));
  const params = new URLSearchParams({ fileSize: String(size) });
  const cs = Math.floor(Number(chunkSize) || 0);
  if (cs > 0) params.set('chunkSize', String(cs));
  return await apiRequest(
    `/api/clouds/${cloudId}/resources/harvester/images/upload-tasks/disk-check?${params.toString()}`,
    { skipCache: true },
  );
};

export const fetchHarvesterImageUploadTask = async (cloudId: string, taskId: string) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/images/upload-tasks/${encodeURIComponent(taskId)}`, {
    skipCache: true,
  });
};

export const fetchHarvesterImageUploadTasks = async (cloudId: string, limit = 20) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/images/upload-tasks?limit=${Math.max(1, Math.min(100, limit))}`, {
    skipCache: true,
  });
};

export const deleteHarvesterImageUploadTask = async (
  cloudId: string,
  taskId: string,
  opts?: { force?: boolean },
) => {
  const force = opts?.force ? '?force=true' : '';
  return await apiDelete(
    `/api/clouds/${cloudId}/resources/harvester/images/upload-tasks/${encodeURIComponent(taskId)}${force}`,
  );
};

export const cancelHarvesterImageUploadTask = async (cloudId: string, taskId: string) => {
  return await apiPost(
    `/api/clouds/${cloudId}/resources/harvester/images/upload-tasks/${encodeURIComponent(taskId)}/cancel`,
    {},
  );
};

export const fetchHarvesterImageUploadTaskChunks = async (cloudId: string, taskId: string) => {
  return await apiRequest(
    `/api/clouds/${cloudId}/resources/harvester/images/upload-tasks/${encodeURIComponent(taskId)}/chunks`,
    { skipCache: true },
  );
};

export const uploadHarvesterImageChunk = async (
  cloudId: string,
  taskId: string,
  index: number,
  body: Blob | ArrayBuffer,
  options?: {
    signal?: AbortSignal;
    onUploadProgress?: (loaded: number, total: number) => void;
  },
): Promise<unknown> => {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/octet-stream',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const url = `${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/images/upload-tasks/${encodeURIComponent(taskId)}/chunks/${index}`;

  return await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    xhr.responseType = 'text';

    if (options?.signal) {
      if (options.signal.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      options.signal.addEventListener(
        'abort',
        () => {
          xhr.abort();
          reject(new DOMException('Aborted', 'AbortError'));
        },
        { once: true },
      );
    }

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) options?.onUploadProgress?.(ev.loaded, ev.total);
    };

    xhr.onload = () => {
      const text = xhr.responseText || '';
      let json: unknown = {};
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        json = { message: text };
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(json);
        return;
      }
      reject(
        new Error(
          (json as { message?: string })?.message || text || `分片上传失败 HTTP ${xhr.status}`,
        ),
      );
    };

    xhr.onerror = () => {
      reject(
        new Error(
          '分片上传网络失败。请确认后端 5001 端口可用，且网关 client_max_body_size ≥ 64MB。',
        ),
      );
    };

    xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'));
    xhr.send(body);
  });
};

export const completeHarvesterImageUploadChunks = async (cloudId: string, taskId: string) => {
  return await apiPost(
    `/api/clouds/${cloudId}/resources/harvester/images/upload-tasks/${encodeURIComponent(taskId)}/complete-chunks`,
    {},
  );
};

export const syncHarvesterImageUploadTask = async (cloudId: string, taskId: string) => {
  return await apiPost(
    `/api/clouds/${cloudId}/resources/harvester/images/upload-tasks/${encodeURIComponent(taskId)}/sync`,
    {},
  );
};

/**
 * 获取 Harvester 镜像详情
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name 镜像名称
 * @returns Promise<any>
 */
export const fetchHarvesterImageDetail = async (cloudId: string, namespace: string, name: string) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/images/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`);
};

/**
 * 将 Harvester 卷附加到虚拟机
 * @param cloudId 云环境 ID
 * @param instanceId 虚拟机实例 ID
 * @param payload 附加配置，包含卷名称、总线类型、PVC 命名空间和名称
 * @returns Promise<any>
 */
export const attachHarvesterVolumeToVm = async (
  cloudId: string,
  instanceId: string,
  payload: { name: string; bus?: string; pvcNamespace: string; pvcName: string }
) => {
  // add-volume 具备副作用，且后端可能出现“已生效但响应异常”的场景；禁用前端 5xx 重试避免重复提交
  return await apiPost(
    `/api/clouds/${cloudId}/resources/harvester/vms/${encodeURIComponent(instanceId)}/add-volume`,
    payload,
    { enableRetry: false }
  );
};

/**
 * 获取 Harvester 卷详情
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name 卷名称
 * @returns Promise<any>
 */
export const fetchHarvesterVolume = async (cloudId: string, namespace: string, name: string, options?: { silent?: boolean; skipCache?: boolean }) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/volumes/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`, { 
    silent: options?.silent,
    skipCache: options?.skipCache 
  });
};

/**
 * 通过名称将 Harvester 卷附加到虚拟机
 * @param cloudId 云环境 ID
 * @param vmNamespace 虚拟机命名空间
 * @param vmName 虚拟机名称
 * @param payload 附加配置，包含卷名称、磁盘名称、总线类型、PVC 命名空间和名称
 * @returns Promise<any>
 */
export const attachHarvesterVolumeToVmByName = async (
  cloudId: string,
  vmNamespace: string,
  vmName: string,
  payload: { name?: string; diskName?: string; bus?: string; pvcNamespace: string; pvcName: string }
) => {
  // add-volume 具备副作用，且后端可能出现"已生效但响应异常"的场景；禁用前端 5xx 重试避免重复提交
  return await apiPost(
    `/api/clouds/${cloudId}/resources/harvester/vms/${encodeURIComponent(vmNamespace)}/${encodeURIComponent(vmName)}/add-volume`,
    payload,
    { enableRetry: false }
  );
};

/**
 * 从卷导出 Harvester 镜像
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param pvcName PVC 名称
 * @param payload 导出配置，包含显示名称、目标存储类名称和命名空间
 * @returns Promise<any>
 */
export const exportHarvesterImageFromVolume = async (cloudId: string, namespace: string, pvcName: string, payload: { displayName?: string; targetStorageClassName?: string; namespace?: string }) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/harvester/volumes/${encodeURIComponent(namespace)}/${encodeURIComponent(pvcName)}/export-image`, payload || {});
};

/**
 * 创建 Harvester 卷快照
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param pvcName PVC 名称
 * @param payload 快照配置，包含名称、快照类名称和别名
 * @returns Promise<any>
 */
export const createHarvesterVolumeSnapshot = async (cloudId: string, namespace: string, pvcName: string, payload: { name?: string; snapshotClassName?: string; alias?: string }) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/harvester/volumes/${encodeURIComponent(namespace)}/${encodeURIComponent(pvcName)}/snapshots`, payload || {});
};

/**
 * 从快照恢复 Harvester 卷
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param snapshotName 快照名称
 * @param payload 恢复配置（卷名称、存储类、别名等）；卷模式由后端按源 PVC 继承，访问模式固定 RWX
 * @returns Promise<any>
 */
export const restoreHarvesterVolumeSnapshot = async (cloudId: string, namespace: string, snapshotName: string, payload: { name: string; storageClassName?: string; size?: string; accessModes?: string[]; volumeMode?: string; alias?: string }) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/harvester/snapshots/${encodeURIComponent(namespace)}/${encodeURIComponent(snapshotName)}/restore`, payload || {});
};

/**
 * 获取 Harvester 快照类列表
 * @param cloudId 云环境 ID
 * @returns Promise<any>
 */
export const listHarvesterSnapshotClasses = async (cloudId: string) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/snapshot-classes`);
};

/**
 * 更新 Harvester 卷
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param pvcName PVC 名称
 * @param payload 更新配置，包含大小、访问模式、卷模式、存储类名称、注解和标签
 * @returns Promise<any>
 */
export const updateHarvesterVolume = async (cloudId: string, namespace: string, pvcName: string, payload: { sizeGi?: number; size?: string; accessModes?: string[]; volumeMode?: string; storageClassName?: string; annotations?: Record<string,string>; labels?: Record<string,string> }) => {
  return await apiPut(`/api/clouds/${cloudId}/resources/harvester/volumes/${encodeURIComponent(namespace)}/${encodeURIComponent(pvcName)}`, payload || {});
};

/**
 * 克隆 Harvester 卷
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param pvcName PVC 名称
 * @param payload 克隆配置，包含目标命名空间、新名称、大小、存储类名称、源快照名称、访问模式和卷模式
 * @returns Promise<any>
 */
export const cloneHarvesterVolume = async (cloudId: string, namespace: string, pvcName: string, payload: { targetNamespace?: string; newName: string; sizeGi?: number; size?: string; storageClassName?: string; fromSnapshotName?: string; accessModes?: string[]; volumeMode?: string }) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/harvester/volumes/${encodeURIComponent(namespace)}/${encodeURIComponent(pvcName)}/clone`, payload || {});
};

/**
 * 从虚拟机分离 Harvester 卷
 * @param cloudId 云环境 ID
 * @param instanceId 虚拟机实例 ID
 * @param payload 分离配置，包含卷名称
 * @returns Promise<any>
 */
export const detachHarvesterVolumeFromVm = async (
  cloudId: string,
  instanceId: string,
  payload: { name: string }
) => {
  // remove-volume 具备副作用，禁用前端 5xx 重试避免重复提交
  return await apiPost(
    `/api/clouds/${cloudId}/resources/harvester/vms/${encodeURIComponent(instanceId)}/remove-volume`,
    payload,
    { enableRetry: false }
  );
};

/**
 * 删除 Harvester 卷
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name 卷名称
 * @returns Promise<any>
 */
export const deleteHarvesterVolume = async (cloudId: string, namespace: string, name: string) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/harvester/volumes/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`);
};

/**
 * 删除 Harvester 镜像
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name 镜像名称
 * @returns Promise<any>
 */
export const deleteHarvesterImage = async (cloudId: string, namespace: string, name: string) => {
  return await requestManager(
    {
      method: 'DELETE',
      endpoint: `/api/clouds/${cloudId}/resources/harvester/images/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`,
      headers: getAuthHeaders(),
      options: {
        enableDeduplication: false,
        enableCache: false,
        enableRetry: false,
      },
    },
    API_BASE_URL,
  );
};

/**
 * 获取 KubeOVN 提供商网络列表
 * @param cloudId 云环境 ID
 * @param skipSync 兼容旧调用，不再发往服务端
 * @returns Promise<any>
 */
export const fetchKubeOvnProviderNetworks = async (cloudId: string, force = false, skipSync = false) => {
  const params = new URLSearchParams();
  if (force) params.append('force', 'true');
  void skipSync;
  const query = params.toString();
  return await apiRequest(`/api/clouds/${cloudId}/resources/provider-networks${query ? `?${query}` : ''}`);
};

/**
 * 创建 KubeOVN 提供商网络
 * @param cloudId 云环境 ID
 * @param payload 提供商网络配置数据
 * @returns Promise<any>
 */
export const createKubeOvnProviderNetwork = async (cloudId: string, payload: any) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/provider-networks`, payload);
};

/**
 * 删除 KubeOVN 提供商网络
 * @param cloudId 云环境 ID
 * @param name 提供商网络名称
 * @returns Promise<any>
 */
export const deleteKubeOvnProviderNetwork = async (cloudId: string, name: string) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/provider-networks/${encodeURIComponent(name)}`);
};

/**
 * 获取 KubeOVN VLAN 列表
 * @param cloudId 云环境 ID
 * @param skipSync 兼容旧调用，不再发往服务端
 * @returns Promise<any>
 */
export const fetchKubeOvnVlans = async (cloudId: string, force = false, skipSync = false) => {
  const params = new URLSearchParams();
  if (force) params.append('force', 'true');
  void skipSync;
  const query = params.toString();
  return await apiRequest(`/api/clouds/${cloudId}/resources/vlans${query ? `?${query}` : ''}`);
};

/**
 * 创建 KubeOVN VLAN
 * @param cloudId 云环境 ID
 * @param payload VLAN 配置数据
 * @returns Promise<any>
 */
export const createKubeOvnVlan = async (cloudId: string, payload: any) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/vlans`, payload);
};

/**
 * 删除 Kube-OVN VLAN
 */
export const deleteKubeOvnVlan = async (cloudId: string, name: string) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/vlans/${encodeURIComponent(name)}`);
};


/**
 * 创建 Harvester 卷
 * @param cloudId 云环境 ID
 * @param payload 卷配置数据，包含命名空间、名称、大小、访问模式、卷模式、存储类名称和注解
 * @returns Promise<any>
 */
export const createHarvesterVolume = async (cloudId: string, payload: { namespace: string; name: string; sizeGi?: number; size?: string; accessModes?: string[]; volumeMode?: string; storageClassName?: string; annotations?: Record<string,string> }) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/harvester/volumes`, payload);
};

/**
 * 创建 Harvester 镜像
 * @param cloudId 云环境 ID
 * @param payload 镜像配置数据，包含命名空间、名称、显示名称、源类型、URL、目标存储类名称和存储类参数
 * @returns Promise<any>
 */
export const createHarvesterImage = async (cloudId: string, payload: { namespace: string; name?: string; displayName?: string; sourceType?: string; url?: string; diskFormat?: string; targetStorageClassName?: string; storageClassParameters?: Record<string,string> }) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/harvester/images`, payload);
};

/**
 * 更新 Harvester 镜像
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name 镜像名称
 * @param payload 更新配置，包含显示名称、重试次数、目标存储类名称和存储类参数
 * @returns Promise<any>
 */
export const updateHarvesterImage = async (cloudId: string, namespace: string, name: string, payload: { displayName?: string; retry?: number; targetStorageClassName?: string; storageClassParameters?: Record<string,string> }) => {
  return await apiPatch(`/api/clouds/${cloudId}/resources/harvester/images/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`, payload);
};

/**
 * 使用 Patch 方式更新 Harvester 镜像 (例如更新 Label/Annotation)
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name 镜像名称
 * @param payload 更新的配置数据
 * @param contentType 内容类型，默认为 'application/merge-patch+json'
 * @returns Promise<any>
 */
export const patchHarvesterImage = async (cloudId: string, namespace: string, name: string, payload: any, contentType = 'application/merge-patch+json') => {
  return await apiPatch(`/api/clouds/${cloudId}/resources/harvester/images/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/patch`, payload, { contentType });
};

/**
 * 获取 Harvester 健康状态
 * @param cloudId 云环境 ID
 * @returns Promise<any>
 */
export const fetchHarvesterHealth = async (cloudId: string) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/health`);
};

/**
 * 获取 KubeOVN VPC 列表（须 `ovnNetworkScope`：vpc=业务 VPC；all=含内置；underlay=仅 underlay 注解）
 * @param cloudId 云环境 ID
 * @param force 是否强制刷新，默认 false
 * @param skipSync 兼容旧调用，不再发往服务端
 * @returns Promise<any>
 */
export const fetchKubeOvnVpcs = async (
  cloudId: string,
  force = false,
  skipSync = false,
  ovnNetworkScope: OvnNetworkScopeQuery = 'vpc',
  mergePublicScenarioNamespaces?: boolean,
) => {
  const params = new URLSearchParams();
  params.set('ovnNetworkScope', ovnNetworkScope);
  if (force) params.append('force', 'true');
  void skipSync;
  appendMergePublicScenarioParam(params, mergePublicScenarioNamespaces);
  const query = params.toString();
  const mustBypassCache = !!force;
  return await apiRequest(`/api/clouds/${cloudId}/resources/vpcs?${query}`, {
    skipCache: mustBypassCache,
  });
};

/**
 * 获取 KubeOVN 子网列表（须 `ovnNetworkScope`）
 * @param skipSync 兼容旧调用，不再发往服务端
 */
export const fetchKubeOvnSubnets = async (
  cloudId: string,
  force = false,
  skipSync = false,
  ovnNetworkScope: OvnNetworkScopeQuery = 'all',
  mergePublicScenarioNamespaces?: boolean,
) => {
  const params = new URLSearchParams();
  params.set('ovnNetworkScope', ovnNetworkScope);
  if (force) params.append('force', 'true');
  void skipSync;
  appendMergePublicScenarioParam(params, mergePublicScenarioNamespaces);
  const query = params.toString();
  const mustBypassCache = !!force;
  return await apiRequest(`/api/clouds/${cloudId}/resources/subnets?${query}`, {
    skipCache: mustBypassCache,
  });
};

/** 检测 Kube-OVN 子网中静态 IP 是否已被使用 */
export const checkSubnetStaticIP = async (
  cloudId: string,
  subnetNamespace: string,
  subnetName: string,
  ip: string,
) => {
  return await apiRequest(
    `/api/clouds/${cloudId}/resources/subnets/${encodeURIComponent(subnetNamespace)}/${encodeURIComponent(subnetName)}/check-ip?ip=${encodeURIComponent(ip)}`,
    { skipCache: true },
  );
};

/** Tower 侧 Kube-OVN 安全组列表 */
export const fetchKubeOvnSecurityGroups = async (cloudId: string) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/kube-ovn-security-groups`, {
    skipCache: true,
  });
};

/** 创建 Kube-OVN 安全组（body: name, subnetName, description?） */
export const createKubeOvnSecurityGroup = async (
  cloudId: string,
  payload: { name: string; subnetName: string; description?: string },
) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/kube-ovn-security-groups`, payload);
};

export const fetchKubeOvnSecurityGroupDetail = async (cloudId: string, sgId: string) => {
  return await apiRequest(
    `/api/clouds/${cloudId}/resources/kube-ovn-security-groups/${encodeURIComponent(sgId)}`,
    { skipCache: true },
  );
};

/** 整表替换安全组访问控制规则（与 Subnet.spec.acls 条目结构一致） */
export const replaceKubeOvnSecurityGroupRules = async (
  cloudId: string,
  sgId: string,
  payload: { rules: Array<{ action: string; direction: string; match: string; priority: number }> },
) => {
  return await apiPut(
    `/api/clouds/${cloudId}/resources/kube-ovn-security-groups/${encodeURIComponent(sgId)}/rules`,
    payload,
  );
};

/** 更新安全组元数据（name、description；不可改子网） */
export const updateKubeOvnSecurityGroup = async (
  cloudId: string,
  sgId: string,
  payload: { name?: string; description?: string | null },
) => {
  return await apiPatch(
    `/api/clouds/${cloudId}/resources/kube-ovn-security-groups/${encodeURIComponent(sgId)}`,
    payload,
  );
};

export const deleteKubeOvnSecurityGroup = async (cloudId: string, sgId: string) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/kube-ovn-security-groups/${encodeURIComponent(sgId)}`);
};

/** 批量添加安全组成员（虚拟机 namespace/name） */
export const addKubeOvnSecurityGroupMembers = async (
  cloudId: string,
  sgId: string,
  payload: { items: Array<{ vmNamespace: string; vmName: string }> },
) => {
  return await apiPost(
    `/api/clouds/${cloudId}/resources/kube-ovn-security-groups/${encodeURIComponent(sgId)}/members`,
    payload,
  );
};

export const removeKubeOvnSecurityGroupMember = async (cloudId: string, sgId: string, memberId: string) => {
  return await apiDelete(
    `/api/clouds/${cloudId}/resources/kube-ovn-security-groups/${encodeURIComponent(sgId)}/members/${encodeURIComponent(memberId)}`,
  );
};

/**
 * 解析 GET /resources/harvester/gpus 的 JSON 体，得到 GPU 对象数组（与创建向导等一致）。
 */
export function normalizeHarvesterGpuResourcesResponse(res: any): any[] {
  const items = res?.data?.items ?? res?.items;
  return Array.isArray(items) ? items : [];
}

/**
 * 删除 Harvester 快照
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name 快照名称
 * @returns Promise<any>
 */
export const deleteHarvesterSnapshot = async (cloudId: string, namespace: string, name: string) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/harvester/snapshots/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`);
};

/**
 * 删除 Harvester Ingress
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name Ingress 名称
 * @returns Promise<any>
 */
export const deleteHarvesterIngress = async (cloudId: string, namespace: string, name: string) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/harvester/containers/ingresses/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`);
};

/**
 * 删除 Harvester Service
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name Service 名称
 * @returns Promise<any>
 */
export const deleteHarvesterService = async (cloudId: string, namespace: string, name: string) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/harvester/containers/services/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`);
};

/**
 * 创建 Harvester IP 池
 * @param cloudId 云环境 ID
 * @param payload IP 池配置数据
 * @returns Promise<any>
 */
export const createHarvesterIPPool = async (cloudId: string, payload: any) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/ippools`, payload);
};

/**
 * 删除 Harvester IP 池
 * @param cloudId 云环境 ID
 * @param name IP 池名称
 * @returns Promise<any>
 * @note IP 池是集群级别的资源，不需要命名空间
 */
export const deleteHarvesterIpPool = async (cloudId: string, name: string) => {
  // IpPool is usually cluster-scoped (no namespace in URL usually, but check Harvester API)
  // Harvester IPPool: apis/loadbalancer.harvesterhci.io/v1beta1/ippools/{name}
  // Our backend likely maps it. Assuming standard resource path structure.
  // Note: IpPools are cluster scoped.
  return await apiDelete(`/api/clouds/${cloudId}/resources/ippools/${encodeURIComponent(name)}`);
};

// ============================================================
// 容器相关 API (Containers API)
// ============================================================

/**
 * 获取 Deployment 列表
 * @param cloudId 云环境 ID
 * @param namespace 命名空间 (可选，不传则返回所有命名空间)
 * @returns Promise<any>
 */
export const fetchHarvesterDeployments = async (cloudId: string, namespace?: string, force?: boolean, all?: boolean) => {
  const params: string[] = [];
  if (namespace) params.push(`namespace=${encodeURIComponent(namespace)}`);
  if (force) params.push('force=true');
  if (all) params.push('all=true');
  const query = params.length > 0 ? `?${params.join('&')}` : '';
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/containers/deployments${query}`, { skipCache: force });
};

/**
 * 获取 StatefulSet 列表
 * @param cloudId 云环境 ID
 * @param namespace 命名空间 (可选)
 * @returns Promise<any>
 */
export const fetchHarvesterStatefulSets = async (cloudId: string, namespace?: string, force?: boolean, all?: boolean) => {
  const params: string[] = [];
  if (namespace) params.push(`namespace=${encodeURIComponent(namespace)}`);
  if (force) params.push('force=true');
  if (all) params.push('all=true');
  const query = params.length > 0 ? `?${params.join('&')}` : '';
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/containers/statefulsets${query}`, { skipCache: force });
};

/**
 * 获取 DaemonSet 列表
 * @param cloudId 云环境 ID
 * @param namespace 命名空间 (可选)
 * @returns Promise<any>
 */
export const fetchHarvesterDaemonSets = async (cloudId: string, namespace?: string, force?: boolean, all?: boolean) => {
  const params: string[] = [];
  if (namespace) params.push(`namespace=${encodeURIComponent(namespace)}`);
  if (force) params.push('force=true');
  if (all) params.push('all=true');
  const query = params.length > 0 ? `?${params.join('&')}` : '';
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/containers/daemonsets${query}`, { skipCache: force });
};

/**
 * 获取 Pod 列表
 * @param cloudId 云环境 ID
 * @param namespace 命名空间 (可选)
 * @param force 是否强制刷新缓存
 * @returns Promise<any>
 */
export const fetchHarvesterPods = async (cloudId: string, namespace?: string, force?: boolean, all?: boolean) => {
  const params: string[] = [];
  if (namespace) {
    params.push(`namespace=${encodeURIComponent(namespace)}`);
  }
  if (force) {
    params.push('force=true');
  }
  if (all) {
    params.push('all=true');
  }
  const query = params.length > 0 ? `?${params.join('&')}` : '';
  return await apiRequest(
    `/api/clouds/${cloudId}/resources/harvester/containers/pods${query}`,
    force ? { skipCache: true } : undefined
  );
};

/**
 * 根据 label selector 查询 Pod（用于 Service 端口匹配）
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param labelSelector 标签选择器，如 "app=nginx"
 * @returns Promise<any>
 */
export const fetchHarvesterPodsBySelector = async (cloudId: string, namespace: string, labelSelector: string) => {
  const params = [
    `namespace=${encodeURIComponent(namespace)}`,
    `labelSelector=${encodeURIComponent(labelSelector)}`,
  ];
  const query = `?${params.join('&')}`;
  return await apiRequest(
    `/api/clouds/${cloudId}/resources/harvester/containers/pods${query}`,
    { skipCache: true }
  );
};

/**
 * 获取 Pod 详情
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name Pod 名称
 * @returns Promise<any>
 */
export const fetchHarvesterPodDetail = async (cloudId: string, namespace: string, name: string) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/containers/pods/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`);
};

/**
 * 获取 Pod 日志
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name Pod 名称
 * @param container 容器名称 (可选)
 * @param tailLines 行数限制 (可选)
 * @returns Promise<string> 日志文本
 */
export const fetchHarvesterPodLog = async (cloudId: string, namespace: string, name: string, container?: string, tailLines?: number) => {
  let query = '?';
  if (container) query += `container=${encodeURIComponent(container)}&`;
  if (tailLines) query += `tailLines=${tailLines}&`;
  
  // 日志返回纯文本，需要使用 text() 而不是 json()
  const API_BASE_URL = process.env.REACT_APP_API_URL || '';
  const token = localStorage.getItem('token') || sessionStorage.getItem('token') || '';
  
  const response = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/harvester/containers/pods/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/log${query}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `请求失败: ${response.status}`);
  }
  
  return await response.text();
};

/**
 * 获取 Pod 相关的 Kubernetes Events
 * 包含重要的事件日志，如镜像拉取失败、调度错误等。
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name Pod 名称
 * @returns Promise<any> Events 列表
 */
export const fetchHarvesterPodEvents = async (cloudId: string, namespace: string, name: string) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/containers/pods/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/events`);
};

/**
 * 创建容器资源 (通用)
 * @param cloudId 云环境 ID
 * @param apiPath API 路径 (如 /apis/apps/v1/deployments)
 * @param namespace 命名空间 (可选)
 * @param body 资源定义
 * @returns Promise<any>
 */
export const createHarvesterContainerResource = async (cloudId: string, apiPath: string, namespace: string | undefined, body: any) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/harvester/containers/create`, { apiPath, namespace, body });
};

/**
 * 更新容器资源 (通用)
 * @param cloudId 云环境 ID
 * @param apiPath API 路径
 * @param namespace 命名空间
 * @param name 资源名称
 * @param body 更新的资源定义
 * @returns Promise<any>
 */
export const updateHarvesterContainerResource = async (cloudId: string, apiPath: string, namespace: string, name: string, body: any) => {
  return await apiPut(`/api/clouds/${cloudId}/resources/harvester/containers/update`, { apiPath, namespace, name, body });
};

/**
 * Patch 容器资源 (JSON Patch)
 * @param cloudId 云环境 ID
 * @param apiPath API 路径
 * @param namespace 命名空间
 * @param name 资源名称
 * @param patchBody JSON Patch body
 * @returns Promise<any>
 */
export const patchHarvesterContainerResource = async (cloudId: string, apiPath: string, namespace: string, name: string, patchBody: any) => {
  return await apiPatch(`/api/clouds/${cloudId}/resources/harvester/containers/patch`, { apiPath, namespace, name, patchBody });
};

/**
 * 删除容器资源 (通用)
 * @param cloudId 云环境 ID
 * @param apiPath API 路径
 * @param namespace 命名空间
 * @param name 资源名称
 * @returns Promise<any>
 */
export const deleteHarvesterContainerResource = async (cloudId: string, apiPath: string, namespace: string, name: string) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/harvester/containers/delete`, { apiPath, namespace, name });
};

/**
 * 安全驱逐 Pod (Eviction)
 * 使用 Kubernetes Eviction API，会触发 PDB (PodDisruptionBudget) 保护机制
 * 如果 PDB 不允许驱逐，将返回 429 错误
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name Pod 名称
 * @returns Promise<any>
 */
export const evictHarvesterPod = async (cloudId: string, namespace: string, name: string) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/harvester/containers/pods/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/evict`, {});
};

/**
 * 批量安全驱逐 Pod (Batch Eviction)
 * 同时驱逐多个 Pod，用于测试 PDB 规则
 * @param cloudId 云环境 ID
 * @param pods Pod 列表 [{ namespace: string, name: string }, ...]
 * @returns Promise<any>
 */
export const batchEvictHarvesterPods = async (cloudId: string, pods: { namespace: string; name: string }[]) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/harvester/containers/pods/batch-evict`, { pods });
};

/**
 * 扩缩容 Deployment
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name Deployment 名称
 * @param replicas 目标副本数
 * @returns Promise<any>
 */
export const scaleHarvesterDeployment = async (cloudId: string, namespace: string, name: string, replicas: number) => {
  return await apiPatch(`/api/clouds/${cloudId}/resources/harvester/containers/deployments/scale`, { namespace, name, replicas });
};

export const scaleHarvesterStatefulSet = async (cloudId: string, namespace: string, name: string, replicas: number) => {
  return await apiPatch(`/api/clouds/${cloudId}/resources/harvester/containers/statefulsets/scale`, { namespace, name, replicas });
};

/**
 * 重启 Deployment
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name Deployment 名称
 * @returns Promise<any>
 */
export const restartHarvesterDeployment = async (cloudId: string, namespace: string, name: string) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/harvester/containers/deployments/restart`, { namespace, name });
};

export const restartHarvesterStatefulSet = async (cloudId: string, namespace: string, name: string) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/harvester/containers/statefulsets/restart`, { namespace, name });
};

export const restartHarvesterDaemonSet = async (cloudId: string, namespace: string, name: string) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/harvester/containers/daemonsets/restart`, { namespace, name });
};

/**
 * 获取 Job 列表
 * @param cloudId 云环境 ID
 * @param namespace 命名空间 (可选)
 * @returns Promise<any>
 */
export const fetchHarvesterJobs = async (cloudId: string, namespace?: string, force?: boolean, all?: boolean) => {
  const params: string[] = [];
  if (namespace) params.push(`namespace=${encodeURIComponent(namespace)}`);
  if (force) params.push('force=true');
  if (all) params.push('all=true');
  const query = params.length > 0 ? `?${params.join('&')}` : '';
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/containers/jobs${query}`, { skipCache: force });
};

/**
 * 获取 CronJob 列表
 * @param cloudId 云环境 ID
 * @param namespace 命名空间 (可选)
 * @returns Promise<any>
 */
export const fetchHarvesterCronJobs = async (cloudId: string, namespace?: string, force?: boolean, all?: boolean) => {
  const params: string[] = [];
  if (namespace) params.push(`namespace=${encodeURIComponent(namespace)}`);
  if (force) params.push('force=true');
  if (all) params.push('all=true');
  const query = params.length > 0 ? `?${params.join('&')}` : '';
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/containers/cronjobs${query}`, { skipCache: force });
};

/**
 * 获取 ConfigMap 列表
 * @param cloudId 云环境 ID
 * @param namespace 命名空间 (可选)
 * @param force 是否强制刷新缓存 (可选)
 * @returns Promise<any>
 */
export const fetchHarvesterConfigMaps = async (cloudId: string, namespace?: string, force?: boolean, all?: boolean) => {
  let query = '?';
  if (namespace) query += `namespace=${encodeURIComponent(namespace)}&`;
  if (force) query += `force=true&`;
  if (all) query += `all=true&`;
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/containers/configmaps${query}`, { enableCache: true, skipCache: force });
};

/**
 * 获取 Secret 列表
 * @param cloudId 云环境 ID
 * @param namespace 命名空间 (可选)
 * @param type Secret 类型过滤 (可选)
 * @param force 是否强制刷新缓存 (可选)
 * @returns Promise<any>
 */
export const fetchHarvesterSecrets = async (cloudId: string, namespace?: string, type?: string, force?: boolean, all?: boolean) => {
  let query = '?';
  if (namespace) query += `namespace=${encodeURIComponent(namespace)}&`;
  if (type) query += `type=${encodeURIComponent(type)}&`;
  if (force) query += `force=true&`;
  if (all) query += `all=true&`;
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/containers/secrets${query}`, { enableCache: true, skipCache: force });
};

// ============================================================
// ConfigMap CRUD API
// ============================================================

/**
 * 获取 ConfigMap 详情
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name ConfigMap 名称
 * @returns Promise<any>
 */
export const fetchHarvesterConfigMapDetail = async (cloudId: string, namespace: string, name: string, force?: boolean) => {
  const params = new URLSearchParams();
  if (force) params.append('force', 'true');
  const query = params.toString() ? `?${params.toString()}` : '';
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/containers/configmaps/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}${query}`, { enableCache: true, skipCache: force });
};

/**
 * 创建 ConfigMap
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param body ConfigMap 资源定义 (完整的 K8s ConfigMap 对象)
 * @returns Promise<any>
 */
export const createHarvesterConfigMap = async (cloudId: string, namespace: string, body: any) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/harvester/containers/configmaps`, { namespace, body });
};

/**
 * 更新 ConfigMap
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name ConfigMap 名称
 * @param body 更新的 ConfigMap 定义 (完整的 K8s ConfigMap 对象)
 * @returns Promise<any>
 */
export const updateHarvesterConfigMap = async (cloudId: string, namespace: string, name: string, body: any) => {
  // 从 K8s 资源对象中提取字段
  const payload = {
    data: body?.data,
    labels: body?.metadata?.labels,
  };
  return await apiPut(`/api/clouds/${cloudId}/resources/harvester/containers/configmaps/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`, payload);
};

/**
 * 删除 ConfigMap
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name ConfigMap 名称
 * @returns Promise<any>
 */
export const deleteHarvesterConfigMap = async (cloudId: string, namespace: string, name: string) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/harvester/containers/configmaps/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`);
};

// ============================================================
// Secret CRUD API
// ============================================================

/**
 * 获取 Secret 详情
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name Secret 名称
 * @param reveal 是否请求明文数据（可选，默认 false）
 * @returns Promise<any>
 */
export const fetchHarvesterSecretDetail = async (cloudId: string, namespace: string, name: string, reveal?: boolean, force?: boolean) => {
  const params = new URLSearchParams();
  if (reveal) params.append('reveal', 'true');
  if (force) params.append('force', 'true');
  const query = params.toString() ? `?${params.toString()}` : '';
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/containers/secrets/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}${query}`, { enableCache: true, skipCache: force });
};

/**
 * 创建 Secret
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param body Secret 资源定义 (完整的 K8s Secret 对象)
 * @returns Promise<any>
 */
export const createHarvesterSecret = async (cloudId: string, namespace: string, body: any) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/harvester/containers/secrets`, { namespace, body });
};

/**
 * 更新 Secret
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name Secret 名称
 * @param body 更新的 Secret 定义 (完整的 K8s Secret 对象)
 * @returns Promise<any>
 */
export const updateHarvesterSecret = async (cloudId: string, namespace: string, name: string, body: any) => {
  // 从 K8s 资源对象中提取字段
  const payload = {
    stringData: body?.stringData,
    labels: body?.metadata?.labels,
  };
  return await apiPut(`/api/clouds/${cloudId}/resources/harvester/containers/secrets/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`, payload);
};

/**
 * 删除 Secret
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name Secret 名称
 * @returns Promise<any>
 */
export const deleteHarvesterSecret = async (cloudId: string, namespace: string, name: string) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/harvester/containers/secrets/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`);
};

/**
 * 删除 Job
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name Job 名称
 * @returns Promise<any>
 */
export const deleteHarvesterJob = async (cloudId: string, namespace: string, name: string) => {
  return await deleteHarvesterContainerResource(cloudId, '/apis/batch/v1/jobs', namespace, name);
};

/**
 * 删除 CronJob
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name CronJob 名称
 * @returns Promise<any>
 */
export const deleteHarvesterCronJob = async (cloudId: string, namespace: string, name: string) => {
  return await deleteHarvesterContainerResource(cloudId, '/apis/batch/v1/cronjobs', namespace, name);
};

/**
 * 获取 Job 详情
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name Job 名称
 * @returns Promise<any>
 */
export const fetchHarvesterJobDetail = async (cloudId: string, namespace: string, name: string) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/containers/jobs/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`);
};

/**
 * 获取 CronJob 详情
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name CronJob 名称
 * @returns Promise<any>
 */
export const fetchHarvesterCronJobDetail = async (cloudId: string, namespace: string, name: string) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/containers/cronjobs/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`);
};

/**
 * 暂停 CronJob
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name CronJob 名称
 * @returns Promise<any>
 */
export const suspendHarvesterCronJob = async (cloudId: string, namespace: string, name: string) => {
  return await apiPatch(`/api/clouds/${cloudId}/resources/harvester/containers/cronjobs/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/suspend`, { suspend: true });
};

/**
 * 恢复 CronJob
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name CronJob 名称
 * @returns Promise<any>
 */
export const resumeHarvesterCronJob = async (cloudId: string, namespace: string, name: string) => {
  return await apiPatch(`/api/clouds/${cloudId}/resources/harvester/containers/cronjobs/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/suspend`, { suspend: false });
};

/**
 * 手动触发 CronJob
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name CronJob 名称
 * @returns Promise<any>
 */
export const triggerHarvesterCronJob = async (cloudId: string, namespace: string, name: string) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/harvester/containers/cronjobs/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/trigger`, {});
};

/**
 * 获取镜像凭证列表 (ImagePullSecrets)
 * @param cloudId 云环境 ID
 * @param namespace 命名空间 (可选)
 * @returns Promise<any>
 * @description 镜像凭证是 kubernetes.io/dockerconfigjson 类型的 Secret
 */
export const fetchHarvesterImagePullSecrets = async (cloudId: string, namespace?: string, force?: boolean, all?: boolean) => {
  return await fetchHarvesterSecrets(cloudId, namespace, 'kubernetes.io/dockerconfigjson', force, all);
};

/**
 * 测试仓库连接
 * @param cloudId 云环境 ID
 * @param server 仓库地址 (如 https://registry.example.com)
 * @param username 用户名 (可选)
 * @param password 密码 (可选)
 * @param insecure 是否跳过 TLS 验证 (可选)
 * @returns Promise<any>
 */
export const testRegistryConnection = async (
  cloudId: string,
  server: string,
  username?: string,
  password?: string,
  insecure?: boolean,
) => {
  const params = new URLSearchParams();
  params.append('server', server);
  if (username) params.append('username', username);
  if (password) params.append('password', password);
  if (insecure) params.append('insecure', 'true');
  
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/containers/registry/test?${params.toString()}`);
};

/**
 * 获取仓库目录 (Catalog)
 * @param cloudId 云环境 ID
 * @param server 仓库地址
 * @param username 用户名 (可选)
 * @param password 密码 (可选)
 * @param insecure 是否跳过 TLS 验证 (可选)
 * @param n 分页大小 (可选)
 * @param last 分页标记 (可选)
 * @returns Promise<any>
 * @description 返回 { repositories: string[] }
 */
export const getRegistryCatalog = async (
  cloudId: string,
  server: string,
  username?: string,
  password?: string,
  insecure?: boolean,
  n?: number,
  last?: string,
) => {
  const params = new URLSearchParams();
  params.append('server', server);
  if (username) params.append('username', username);
  if (password) params.append('password', password);
  // 强制添加 insecure 参数，默认为 true
  params.append('insecure', insecure === false ? 'false' : 'true');
  if (n) params.append('n', String(n));
  if (last) params.append('last', last);
  
  console.log('[harvesterApi] getRegistryCatalog params:', params.toString());
  
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/containers/registry/catalog?${params.toString()}`);
};

/**
 * 获取镜像标签列表
 * @param cloudId 云环境 ID
 * @param server 仓库地址
 * @param repository 镜像仓库名称 (如 library/nginx)
 * @param username 用户名 (可选)
 * @param password 密码 (可选)
 * @param insecure 是否跳过 TLS 验证 (可选)
 * @param n 分页大小 (可选)
 * @param last 分页标记 (可选)
 * @returns Promise<any>
 * @description 返回 { name: string, tags: string[] }
 */
export const getRegistryTags = async (
  cloudId: string,
  server: string,
  repository: string,
  username?: string,
  password?: string,
  insecure?: boolean,
  n?: number,
  last?: string,
) => {
  const params = new URLSearchParams();
  params.append('server', server);
  params.append('repository', repository);
  if (username) params.append('username', username);
  if (password) params.append('password', password);
  // 强制添加 insecure 参数，默认为 true
  params.append('insecure', insecure === false ? 'false' : 'true');
  if (n) params.append('n', String(n));
  if (last) params.append('last', last);
  
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/containers/registry/tags?${params.toString()}`);
};

/**
 * 获取镜像 Manifest
 * @param cloudId 云环境 ID
 * @param server 仓库地址
 * @param repository 镜像仓库名称
 * @param tag 标签或 digest
 * @param username 用户名 (可选)
 * @param password 密码 (可选)
 * @param insecure 是否跳过 TLS 验证 (可选)
 * @returns Promise<any>
 */
export const getRegistryManifest = async (
  cloudId: string,
  server: string,
  repository: string,
  tag: string,
  username?: string,
  password?: string,
  insecure?: boolean,
) => {
  const params = new URLSearchParams();
  params.append('server', server);
  params.append('repository', repository);
  params.append('tag', tag);
  if (username) params.append('username', username);
  if (password) params.append('password', password);
  if (insecure) params.append('insecure', 'true');
  
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/containers/registry/manifest?${params.toString()}`);
};

/**
 * 删除镜像标签
 * @param cloudId 云环境 ID
 * @param server 仓库地址
 * @param repository 镜像仓库名称
 * @param digest 镜像 digest (sha256:xxx)
 * @param username 用户名 (可选)
 * @param password 密码 (可选)
 * @param insecure 是否跳过 TLS 验证 (可选)
 * @returns Promise<any>
 */
export const deleteRegistryTag = async (
  cloudId: string,
  server: string,
  repository: string,
  tag: string,
  username?: string,
  password?: string,
  insecure?: boolean,
) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/harvester/containers/registry/tag`, {
    server,
    repository,
    tag,
    username,
    password,
    insecure,
  });
};

/**
 * 创建镜像凭证 (ImagePullSecret)
 * @param cloudId 云环境 ID
 * @param payload 凭证配置数据
 * @returns Promise<any>
 * @description 创建 kubernetes.io/dockerconfigjson 类型的 Secret
 */
export const createHarvesterImagePullSecret = async (
  cloudId: string,
  payload: {
    namespace: string;
    name: string;
    alias?: string;
    server: string;
    username: string;
    password: string;
    email?: string;
  }
) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/harvester/containers/imagepullsecrets`, payload);
};

/**
 * 更新镜像凭证 (ImagePullSecret)
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name 凭证名称
 * @param payload 更新的凭证配置数据
 * @returns Promise<any>
 */
export const updateHarvesterImagePullSecret = async (
  cloudId: string,
  namespace: string,
  name: string,
  payload: {
    server: string;
    username: string;
    password: string;
    email?: string;
    alias?: string;
  }
) => {
  return await apiPut(`/api/clouds/${cloudId}/resources/harvester/containers/imagepullsecrets/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`, payload);
};

// ============================================================
// Containerd Registry 配置 (HTTP 私有仓库)
// ============================================================

/**
 * 获取 containerd-registry 配置
 * 用于配置 containerd 允许从 HTTP 私有仓库拉取镜像
 * @param cloudId 云环境 ID
 * @returns Promise<any>
 */
export const fetchContainerdRegistry = async (cloudId: string) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/containers/containerd-registry`);
};

/**
 * 更新 containerd-registry 配置
 * @param cloudId 云环境 ID
 * @param value 配置值 (包含 Mirrors 和 Configs)
 * @returns Promise<any>
 */
export const updateContainerdRegistry = async (cloudId: string, value: any) => {
  return await apiPut(`/api/clouds/${cloudId}/resources/harvester/containers/containerd-registry`, { value });
};

/**
 * 快速添加 HTTP 私有仓库到 containerd-registry
 * 自动配置 Mirrors 和 TLS 跳过验证
 * @param cloudId 云环境 ID
 * @param server 仓库地址 (如: 172.16.3.79:30500)
 * @returns Promise<any>
 */
export const addInsecureRegistry = async (cloudId: string, server: string) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/harvester/containers/containerd-registry/insecure`, { server });
};

// ============================================================
// Job/CronJob 扩展 API
// ============================================================

/**
 * 获取 Job 关联的 Pod 列表
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name Job 名称
 * @returns Promise<any>
 */
export const fetchHarvesterJobPods = async (cloudId: string, namespace: string, name: string) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/containers/jobs/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/pods`);
};

/**
 * 获取 Job 相关的事件列表
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name Job 名称
 * @returns Promise<any>
 */
export const fetchHarvesterJobEvents = async (cloudId: string, namespace: string, name: string) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/containers/jobs/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/events`);
};

/**
 * 获取 CronJob 关联的 Job 列表
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name CronJob 名称
 * @returns Promise<any>
 */
export const fetchHarvesterCronJobJobs = async (cloudId: string, namespace: string, name: string) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/containers/cronjobs/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/jobs`);
};

/**
 * 获取 CronJob 相关的事件列表
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name CronJob 名称
 * @returns Promise<any>
 */
export const fetchHarvesterCronJobEvents = async (cloudId: string, namespace: string, name: string) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/containers/cronjobs/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/events`);
};

// ============================================================
// Gateway API (Kubernetes Next-Generation Ingress)
// ============================================================

/**
 * 检测 Gateway API CRD 是否已安装
 * @param cloudId 云环境 ID
 * @returns Promise<{ installed: boolean; resources: { gatewayClass: boolean; gateway: boolean; httpRoute: boolean; grpcRoute: boolean } }>
 */
export const checkGatewayApiStatus = async (cloudId: string) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/containers/gateway-api/status`);
};

/**
 * 获取 GatewayClass 列表
 * GatewayClass 是集群级别资源，定义 Gateway 的控制器实现
 * @param cloudId 云环境 ID
 * @returns Promise<any>
 */
export const fetchGatewayClasses = async (cloudId: string) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/containers/gatewayclasses`);
};

/**
 * 创建 GatewayClass
 * GatewayClass 是集群级别资源，定义 Gateway 的控制器实现
 * @param cloudId 云环境 ID
 * @param data GatewayClass 数据
 * @returns Promise<any>
 */
export const createGatewayClass = async (cloudId: string, data: { metadata: { name: string }; spec: { controllerName: string; description?: string } }) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/harvester/containers/gatewayclasses`, data);
};

/**
 * 删除 GatewayClass
 * @param cloudId 云环境 ID
 * @param name GatewayClass 名称
 * @returns Promise<any>
 */
export const deleteGatewayClass = async (cloudId: string, name: string) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/harvester/containers/gatewayclasses/${encodeURIComponent(name)}`);
};

/**
 * 获取 Gateway 列表
 * @param cloudId 云环境 ID
 * @param namespace 命名空间 (可选)
 * @returns Promise<any>
 */
export const fetchGateways = async (cloudId: string, namespace?: string) => {
  const query = namespace ? `?namespace=${encodeURIComponent(namespace)}` : '';
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/containers/gateways${query}`);
};

/**
 * 获取 Gateway 详情
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name Gateway 名称
 * @returns Promise<any>
 */
export const fetchGatewayDetail = async (cloudId: string, namespace: string, name: string) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/containers/gateways/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`);
};

/**
 * 创建 Gateway
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param body Gateway 资源定义
 * @returns Promise<any>
 */
export const createGateway = async (cloudId: string, namespace: string, body: any) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/harvester/containers/gateways`, { namespace, body });
};

/**
 * 删除 Gateway
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name Gateway 名称
 * @returns Promise<any>
 */
export const deleteGateway = async (cloudId: string, namespace: string, name: string) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/harvester/containers/gateways/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`);
};

/**
 * 更新 Gateway (YAML 编辑)
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name Gateway 名称
 * @param body 完整的 Gateway JSON 对象
 * @returns Promise<any>
 */
export const updateGateway = async (cloudId: string, namespace: string, name: string, body: any) => {
  return await apiPut(`/api/clouds/${cloudId}/resources/harvester/containers/gateways/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`, body);
};

/**
 * 获取 Gateway 相关的 Kubernetes Events
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name Gateway 名称
 * @returns Promise<any> Events 列表
 */
export const fetchGatewayEvents = async (cloudId: string, namespace: string, name: string) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/containers/gateways/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/events`);
};

/**
 * 获取 HTTPRoute 列表
 * @param cloudId 云环境 ID
 * @param namespace 命名空间 (可选)
 * @returns Promise<any>
 */
export const fetchHttpRoutes = async (cloudId: string, namespace?: string) => {
  const query = namespace ? `?namespace=${encodeURIComponent(namespace)}` : '';
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/containers/httproutes${query}`);
};

/**
 * 获取 HTTPRoute 详情
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name HTTPRoute 名称
 * @returns Promise<any>
 */
export const fetchHttpRouteDetail = async (cloudId: string, namespace: string, name: string) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/containers/httproutes/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`);
};

/**
 * 创建 HTTPRoute
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param body HTTPRoute 资源定义
 * @returns Promise<any>
 */
export const createHttpRoute = async (cloudId: string, namespace: string, body: any) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/harvester/containers/httproutes`, { namespace, body });
};

/**
 * 删除 HTTPRoute
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name HTTPRoute 名称
 * @returns Promise<any>
 */
export const deleteHttpRoute = async (cloudId: string, namespace: string, name: string) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/harvester/containers/httproutes/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`);
};

/**
 * 更新 HTTPRoute (YAML 编辑)
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name HTTPRoute 名称
 * @param body 完整的 HTTPRoute JSON 对象
 * @returns Promise<any>
 */
export const updateHttpRoute = async (cloudId: string, namespace: string, name: string, body: any) => {
  return await apiPut(`/api/clouds/${cloudId}/resources/harvester/containers/httproutes/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`, body);
};

/**
 * 获取 GRPCRoute 列表
 * @param cloudId 云环境 ID
 * @param namespace 命名空间 (可选)
 * @returns Promise<any>
 */
export const fetchGrpcRoutes = async (cloudId: string, namespace?: string) => {
  const query = namespace ? `?namespace=${encodeURIComponent(namespace)}` : '';
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/containers/grpcroutes${query}`);
};

/**
 * 获取 GRPCRoute 详情
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name GRPCRoute 名称
 * @returns Promise<any>
 */
export const fetchGrpcRouteDetail = async (cloudId: string, namespace: string, name: string) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/containers/grpcroutes/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`);
};

/**
 * 创建 GRPCRoute
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param body GRPCRoute 资源定义
 * @returns Promise<any>
 */
export const createGrpcRoute = async (cloudId: string, namespace: string, body: any) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/harvester/containers/grpcroutes`, { namespace, body });
};

/**
 * 删除 GRPCRoute
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name GRPCRoute 名称
 * @returns Promise<any>
 */
export const deleteGrpcRoute = async (cloudId: string, namespace: string, name: string) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/harvester/containers/grpcroutes/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`);
};

/**
 * 更新 GRPCRoute (YAML 编辑)
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name GRPCRoute 名称
 * @param body 完整的 GRPCRoute JSON 对象
 * @returns Promise<any>
 */
export const updateGrpcRoute = async (cloudId: string, namespace: string, name: string, body: any) => {
  return await apiPut(`/api/clouds/${cloudId}/resources/harvester/containers/grpcroutes/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`, body);
};

/**
 * 安装 NGINX Gateway Fabric
 * @param cloudId 云环境 ID
 * @returns Promise<any> 安装结果
 */
export const installNginxGatewayFabric = async (cloudId: string) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/harvester/containers/gateway/install-nginx-controller`);
};

// ============================================================
// Service/Ingress 扩展 API (创建/更新/删除)
// ============================================================

/**
 * 获取 Service 详情
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name Service 名称
 * @returns Promise<any>
 */
export const fetchHarvesterServiceDetail = async (cloudId: string, namespace: string, name: string) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/containers/services/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`);
};

/**
 * 创建 Service
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param body Service 资源定义
 * @returns Promise<any>
 */
export const createHarvesterService = async (cloudId: string, namespace: string, body: any) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/harvester/containers/services`, { namespace, body });
};

/**
 * 更新 Service
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name Service 名称
 * @param body 更新的 Service 定义
 * @returns Promise<any>
 */
export const updateHarvesterService = async (cloudId: string, namespace: string, name: string, body: any) => {
  return await apiPut(`/api/clouds/${cloudId}/resources/harvester/containers/services/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`, body);
};

/**
 * 获取 Ingress 详情
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name Ingress 名称
 * @returns Promise<any>
 */
export const fetchHarvesterIngressDetail = async (cloudId: string, namespace: string, name: string) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/containers/ingresses/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`);
};

/**
 * 创建 Ingress
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param body Ingress 资源定义
 * @returns Promise<any>
 */
export const createHarvesterIngress = async (cloudId: string, namespace: string, body: any) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/harvester/containers/ingresses`, { namespace, body });
};

/**
 * 更新 Ingress
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name Ingress 名称
 * @param body 更新的 Ingress 定义
 * @returns Promise<any>
 */
export const updateHarvesterIngress = async (cloudId: string, namespace: string, name: string, body: any) => {
  return await apiPut(`/api/clouds/${cloudId}/resources/harvester/containers/ingresses/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`, body);
};

// ============================================================
// PodDisruptionBudget API
// ============================================================

/**
 * 获取 PodDisruptionBudget 列表
 * @param cloudId 云环境 ID
 * @param namespace 命名空间 (可选，不传则返回所有命名空间)
 * @param force 是否强制刷新缓存
 * @returns Promise<any>
 */
export const fetchHarvesterPDBs = async (cloudId: string, namespace?: string, force?: boolean, all?: boolean) => {
  const params: string[] = [];
  if (namespace) params.push(`namespace=${encodeURIComponent(namespace)}`);
  if (force) params.push('force=true');
  if (all) params.push('all=true');
  const query = params.length > 0 ? `?${params.join('&')}` : '';
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/containers/poddisruptionbudgets${query}`, { skipCache: force });
};

/**
 * 获取 PodDisruptionBudget 详情
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name PDB 名称
 * @returns Promise<any>
 */
export const fetchHarvesterPDBDetail = async (cloudId: string, namespace: string, name: string) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/containers/poddisruptionbudgets/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`);
};

/**
 * 创建 PodDisruptionBudget
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param body PDB 资源定义
 * @returns Promise<any>
 */
export const createHarvesterPDB = async (cloudId: string, namespace: string, body: any) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/harvester/containers/poddisruptionbudgets`, { namespace, body });
};

/**
 * 删除 PodDisruptionBudget
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name PDB 名称
 * @returns Promise<any>
 */
export const deleteHarvesterPDB = async (cloudId: string, namespace: string, name: string) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/harvester/containers/poddisruptionbudgets/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`);
};

// ============================================================
// NetworkPolicy API
// ============================================================

/**
 * 获取 NetworkPolicy 列表
 * @param cloudId 云环境 ID
 * @param namespace 命名空间 (可选，不传则返回所有命名空间)
 * @param force 是否强制刷新缓存
 * @returns Promise<any>
 */
export const fetchNetworkPolicies = async (cloudId: string, namespace?: string, force?: boolean, all?: boolean) => {
  const params: string[] = [];
  if (namespace) params.push(`namespace=${encodeURIComponent(namespace)}`);
  if (force) params.push('force=true');
  if (all) params.push('all=true');
  const query = params.length > 0 ? `?${params.join('&')}` : '';
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/containers/networkpolicies${query}`, { skipCache: force });
};

/**
 * 获取 NetworkPolicy 详情
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name NetworkPolicy 名称
 * @param force 是否强制刷新缓存
 * @returns Promise<any>
 */
export const fetchNetworkPolicyDetail = async (cloudId: string, namespace: string, name: string, force?: boolean) => {
  return await apiRequest(
    `/api/clouds/${cloudId}/resources/harvester/containers/networkpolicies/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`,
    { skipCache: force }
  );
};

/**
 * 创建 NetworkPolicy
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param body NetworkPolicy 资源定义
 * @returns Promise<any>
 */
export const createNetworkPolicy = async (cloudId: string, namespace: string, body: any) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/harvester/containers/networkpolicies`, { namespace, body });
};

/**
 * 更新 NetworkPolicy
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name NetworkPolicy 名称
 * @param body NetworkPolicy 资源定义
 * @returns Promise<any>
 */
export const updateNetworkPolicy = async (cloudId: string, namespace: string, name: string, body: any) => {
  return await apiPut(`/api/clouds/${cloudId}/resources/harvester/containers/networkpolicies/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`, body);
};

/**
 * 删除 NetworkPolicy
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name NetworkPolicy 名称
 * @returns Promise<any>
 */
export const deleteNetworkPolicy = async (cloudId: string, namespace: string, name: string) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/harvester/containers/networkpolicies/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`);
};

// ========================================
// Harbor 镜像仓库管理
// ========================================

/**
 * 获取 Harbor 仓库列表
 * @returns Promise<any>
 */
export const getHarborRegistries = async () => {
  return await apiRequest('/api/harbor/registries');
};

/**
 * 测试 Harbor 仓库连接
 * @param harborId Harbor 仓库 ID
 * @returns Promise<any>
 */
export const testHarborConnection = async (harborId: string) => {
  return await apiPost(`/api/harbor/registries/${harborId}/test`, {});
};

/**
 * 创建 Harbor 仓库
 * @param payload Harbor 仓库配置
 * @returns Promise<any>
 */
export const createHarborRegistry = async (payload: any) => {
  return await apiPost('/api/harbor/registries', payload);
};

/**
 * 更新 Harbor 仓库
 * @param harborId Harbor 仓库 ID
 * @param payload 更新的配置数据
 * @returns Promise<any>
 */
export const updateHarborRegistry = async (harborId: string, payload: any) => {
  return await apiPut(`/api/harbor/registries/${harborId}`, payload);
};

/**
 * 删除 Harbor 仓库
 * @param harborId Harbor 仓库 ID
 * @returns Promise<any>
 */
export const deleteHarborRegistry = async (harborId: string) => {
  return await apiDelete(`/api/harbor/registries/${harborId}`);
};

// ========================================
// Harbor 镜像选择器 API
// ========================================

/**
 * 获取 Harbor 项目列表（用于镜像选择器）
 * @param harborId Harbor 仓库 ID
 * @returns Promise<any>
 */
export const getHarborSelectorProjects = async (harborId: string) => {
  return await apiRequest(`/api/harbor/registries/${harborId}/selector/projects`);
};

/**
 * 获取 Harbor 项目下的仓库列表（用于镜像选择器）
 * @param harborId Harbor 仓库 ID
 * @param project 项目名称
 * @returns Promise<any>
 */
export const getHarborSelectorRepositories = async (harborId: string, project: string) => {
  return await apiRequest(`/api/harbor/registries/${harborId}/selector/projects/${encodeURIComponent(project)}/repositories`);
};

/**
 * 获取 Harbor 仓库的标签列表（用于镜像选择器）
 * @param harborId Harbor 仓库 ID
 * @param project 项目名称
 * @param repo 仓库名称
 * @returns Promise<any>
 */
export const getHarborSelectorTags = async (harborId: string, project: string, repo: string) => {
  return await apiRequest(`/api/harbor/registries/${harborId}/selector/projects/${encodeURIComponent(project)}/repositories/${encodeURIComponent(repo)}/tags`);
};

/**
 * 同步 Harbor 凭证到 K8s Secret
 * @param harborId Harbor 仓库 ID
 * @param params 同步参数
 * @returns Promise<any>
 */
export const syncHarborSecret = async (harborId: string, params: { cloudId: string; namespace: string }) => {
  return await apiPost(`/api/harbor/registries/${harborId}/sync-secret`, params);
};

/** 集群 / HMS 物理交换机等（域拆分；新代码优先 `services/harvester/cluster`） */
export * from './harvester';
