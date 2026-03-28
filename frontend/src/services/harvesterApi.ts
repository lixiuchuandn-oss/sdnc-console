import { apiRequest, apiPost, apiDelete, apiPatch, apiPut } from './api';

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
 * 获取 Harvester 虚拟机的聚合信息
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name 虚拟机名称
 * @returns Promise<any>
 */
export const fetchHarvesterVMAggregated = async (cloudId: string, namespace: string, name: string) => {
  return await apiRequest(
    `/api/clouds/${cloudId}/resources/ecs/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/aggregated`,
    { skipCache: true }
  );
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
  return await apiPatch(`/api/clouds/${cloudId}/resources/vpcs/${encodeURIComponent(name)}`, payload);
};

/**
 * 获取 Harvester 快照列表
 * @param cloudId 云环境 ID
 * @param force 是否强制刷新，默认 false
 * @returns Promise<any>
 */
export const fetchHarvesterSnapshots = async (cloudId: string, force = false, skipSync = false) => {
  const params = new URLSearchParams();
  if (force) params.append('force', 'true');
  if (skipSync) params.append('skipSync', 'true');
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
 * 获取 Harvester 计划虚拟机备份列表
 * @param cloudId 云环境 ID
 * @param force 是否强制刷新，默认 false
 * @param skipSync 是否跳过全量同步（创建后刷新时使用），默认 false
 * @returns Promise<any>
 */
export const fetchHarvesterScheduleVmBackups = async (cloudId: string, force = false, skipSync = false) => {
  const params = new URLSearchParams();
  if (force) params.append('force', 'true');
  if (skipSync) params.append('skipSync', 'true');
  const queryString = params.toString();
  const url = `/api/clouds/${cloudId}/resources/harvester/schedulevmbackups${queryString ? `?${queryString}` : ''}`;
  // force=true 时，显式传递 skipCache=true 确保跳过前端缓存和去重
  return await apiRequest(url, { skipCache: force });
};

/**
 * 创建 Harvester 计划虚拟机备份
 * @param cloudId 云环境 ID
 * @param payload 备份计划配置数据
 * @returns Promise<any>
 */
export const createHarvesterScheduleVmBackup = async (cloudId: string, payload: any) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/harvester/schedulevmbackups`, payload);
};

/**
 * 删除 Harvester 计划虚拟机备份
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name 备份计划名称
 * @returns Promise<any>
 */
export const deleteHarvesterScheduleVmBackup = async (cloudId: string, namespace: string, name: string) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/harvester/schedulevmbackups/${namespace}/${name}`);
};

/**
 * 更新 Harvester 计划虚拟机备份
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name 备份计划名称
 * @param payload 更新的配置数据
 * @returns Promise<any>
 */
export const updateHarvesterScheduleVmBackup = async (cloudId: string, namespace: string, name: string, payload: any) => {
  return await apiPatch(`/api/clouds/${cloudId}/resources/harvester/schedulevmbackups/${namespace}/${name}`, payload);
};

/**
 * 获取 Harvester 备份列表
 * @param cloudId 云环境 ID
 * @param force 是否强制刷新，默认 false
 * @returns Promise<any>
 */
export const fetchHarvesterBackups = async (cloudId: string, force = false, skipSync = false) => {
  const params = new URLSearchParams();
  if (force) params.append('force', 'true');
  if (skipSync) params.append('skipSync', 'true');
  const queryString = params.toString();
  return await apiRequest(
    `/api/clouds/${cloudId}/resources/harvester/backups${queryString ? `?${queryString}` : ''}`,
    { skipCache: force }
  );
};

/**
 * 获取 Harvester 迁移列表
 * @param cloudId 云环境 ID
 * @param force 是否强制刷新，默认 false
 * @returns Promise<any>
 */
export const fetchHarvesterMigrations = async (cloudId: string, force = false) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/migrations${force ? '?force=true' : ''}`);
};

/**
 * 查询回收站自动关机记录
 * @param params 查询参数
 * @returns Promise<any>
 */
export const getRecycleBinShutdownRecords = async (params?: {
  cloudId?: string;
  status?: string;
  startTime?: string;
  endTime?: string;
  page?: number;
  pageSize?: number;
}) => {
  const queryParams = new URLSearchParams();
  if (params?.cloudId) queryParams.append('cloudId', params.cloudId);
  if (params?.status) queryParams.append('status', params.status);
  if (params?.startTime) queryParams.append('startTime', params.startTime);
  if (params?.endTime) queryParams.append('endTime', params.endTime);
  if (params?.page) queryParams.append('page', String(params.page));
  if (params?.pageSize) queryParams.append('pageSize', String(params.pageSize));
  
  const queryString = queryParams.toString();
  return await apiRequest(`/api/system/recycle-bin/shutdown-records${queryString ? `?${queryString}` : ''}`);
};
 
/**
 * 直接获取 Harvester 迁移列表
 * @param cloudId 云环境 ID
 * @param force 是否强制刷新，默认 false
 * @returns Promise<any>
 */
export const fetchHarvesterMigrationsDirect = async (cloudId: string, force = false) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/migrations-direct${force ? '?force=true' : ''}`);
};

/**
 * 迁移 Harvester 虚拟机
 * @param cloudId 云环境 ID
 * @param instanceId 虚拟机实例 ID
 * @param targetNode 目标节点名称（可选）
 * @returns Promise<any>
 */
export const migrateHarvesterVm = async (cloudId: string, instanceId: string, targetNode?: string) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/ecs/${encodeURIComponent(instanceId)}/migrate`, { targetNode });
};

/**
 * 中止 Harvester 虚拟机迁移
 * @param cloudId 云环境 ID
 * @param instanceId 虚拟机实例 ID
 * @returns Promise<any>
 */
export const abortHarvesterMigration = async (cloudId: string, instanceId: string) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/ecs/${encodeURIComponent(instanceId)}/abort-migration`, {});
};

/**
 * 获取 Harvester SSH 密钥列表
 * @param cloudId 云环境 ID
 * @param force 是否强制刷新，默认 false
 * @returns Promise<any>
 */
export const fetchHarvesterSshKeys = async (cloudId: string, force = false, skipSync = false) => {
  const params = new URLSearchParams();
  if (force) params.append('force', 'true');
  if (skipSync) params.append('skipSync', 'true');
  const queryString = params.toString();
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/sshkeys${queryString ? `?${queryString}` : ''}`);
};



/**
 * 获取 Harvester CloudInit 配置列表
 * @param cloudId 云环境 ID
 * @param force 是否强制刷新，默认 false
 * @returns Promise<any>
 */
export const fetchHarvesterCloudInits = async (cloudId: string, force = false) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/cloudinits${force ? '?force=true' : ''}`);
};

/**
 * 获取 Harvester Service 列表
 * @param cloudId 云环境 ID
 * @param force 是否强制刷新，默认 false
 * @returns Promise<any>
 */
export const fetchHarvesterServices = async (cloudId: string, force = false) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/services${force ? '?force=true' : ''}`);
};

/**
 * 获取 Harvester 负载均衡器列表
 * @param cloudId 云环境 ID
 * @param force 是否强制刷新，默认 false
 * @param skipSync 是否跳过全量同步（创建后刷新时使用），默认 false
 * @returns Promise<any>
 */
export const fetchHarvesterLoadBalancers = async (cloudId: string, force = false, skipSync = false) => {
  const params = new URLSearchParams();
  if (force) params.append('force', 'true');
  if (skipSync) params.append('skipSync', 'true');
  const queryString = params.toString();
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester-loadbalancers${queryString ? `?${queryString}` : ''}`);
};

/**
 * 获取 Harvester 模板列表
 * @param cloudId 云环境 ID
 * @param force 是否强制刷新，默认 false
 * @param skipSync 是否跳过全量同步（创建后刷新时使用），默认 false
 * @returns Promise<any>
 */
export const fetchHarvesterTemplates = async (cloudId: string, force = false, skipSync = false) => {
  const params = new URLSearchParams();
  if (force) params.append('force', 'true');
  if (skipSync) params.append('skipSync', 'true');
  const queryString = params.toString();
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/templates${queryString ? `?${queryString}` : ''}`);
};

export const createHarvesterVmFromTemplate = async (
  cloudId: string,
  namespace: string,
  name: string,
  payload: { name: string; namespace?: string; autoStart?: boolean },
) => {
  return await apiPost(
    `/api/clouds/${cloudId}/resources/harvester/templates/${encodeURIComponent(namespace)}/${encodeURIComponent(
      name,
    )}/create-vm`,
    payload,
  );
};

/**
 * 获取 Harvester IP 池列表
 * @param cloudId 云环境 ID
 * @param force 是否强制刷新，默认 false
 * @param skipSync 是否跳过全量同步（创建后刷新时使用），默认 false
 * @returns Promise<any>
 */
export const fetchHarvesterIPPools = async (cloudId: string, force = false, skipSync = false) => {
  const params = new URLSearchParams();
  if (force) params.append('force', 'true');
  if (skipSync) params.append('skipSync', 'true');
  const queryString = params.toString();
  return await apiRequest(`/api/clouds/${cloudId}/resources/ippools${queryString ? `?${queryString}` : ''}`);
};

/**
 * 获取 Harvester NAD（网络附加定义）列表
 * @param cloudId 云环境 ID
 * @param force 是否强制刷新，默认 false
 * @param skipSync 是否跳过全量同步（创建后刷新时使用），默认 false
 * @returns Promise<any>
 */
export const fetchHarvesterNads = (cloudId: string, force = false, skipSync = false) => {
  const params = new URLSearchParams();
  if (force) params.append('force', 'true');
  if (skipSync) params.append('skipSync', 'true');
  const queryString = params.toString();
  return apiRequest(`/api/clouds/${cloudId}/resources/harvester/nads${queryString ? `?${queryString}` : ''}`);
};

/**
 * 获取 Harvester 集群网络列表
 * @param cloudId 云环境 ID
 * @param force 是否强制刷新，默认 false
 * @returns Promise<any>
 */
export const fetchHarvesterClusterNetworks = async (cloudId: string, force = false) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/cluster-networks${force ? '?force=true' : ''}`);
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
 * 创建 Harvester 虚拟机备份
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param payload 备份配置数据，包含名称、虚拟机名称、类型（备份或快照）和别名
 * @returns Promise<any>
 */
export const createHarvesterVirtualMachineBackup = async (cloudId: string, namespace: string, payload: { name: string; vmName: string; type: 'backup' | 'snapshot'; alias?: string }) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/harvester/virtualmachinebackups/${encodeURIComponent(namespace)}`, payload);
};

/**
 * 创建 Harvester 虚拟机恢复
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param payload 恢复配置数据
 * @returns Promise<any>
 */
export const createHarvesterVirtualMachineRestore = async (cloudId: string, namespace: string, payload: any) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/harvester/virtualmachinerestores/${encodeURIComponent(namespace)}`, payload);
};

/**
 * 通过链接获取 Harvester 资源
 * @param cloudId 云环境 ID
 * @param path 资源路径
 * @param force 是否强制刷新，默认 false
 * @returns Promise<any>
 */
export const fetchHarvesterResourceByLink = async (cloudId: string, path: string, force = false) => {
  const params = new URLSearchParams();
  params.append('path', path);
  if (force) params.append('force', 'true');
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/proxy?${params.toString()}`);
};

/**
 * 通过链接删除 Harvester 资源
 * @param cloudId 云环境 ID
 * @param path 资源路径
 * @returns Promise<any>
 */
export const deleteHarvesterResourceByLink = async (cloudId: string, path: string) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/harvester/proxy?path=${encodeURIComponent(path)}`);
};

export const fetchHarvesterVirtualMachineRestores = async (cloudId: string, force = false) => {
  const path = `/apis/harvesterhci.io/v1beta1/virtualmachinerestores`;
  return await fetchHarvesterResourceByLink(cloudId, path, force);
};

export const deleteHarvesterVirtualMachineRestore = async (cloudId: string, namespace: string, name: string) => {
  const path = `/apis/harvesterhci.io/v1beta1/namespaces/${encodeURIComponent(namespace)}/virtualmachinerestores/${encodeURIComponent(name)}`;
  return await deleteHarvesterResourceByLink(cloudId, path);
};

/**
 * 获取 Harvester USB 设备资源列表
 * @param cloudId 云环境 ID
 * @returns Promise<any>
 */
export const fetchHarvesterUsbResources = async (cloudId: string, force = false) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/usb-devices${force ? '?force=true' : ''}`);
};

export const claimHarvesterUsbDevice = async (cloudId: string, name: string) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/harvester/usb-devices/${encodeURIComponent(name)}/claim`, {});
};

export const unclaimHarvesterUsbDevice = async (cloudId: string, name: string) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/harvester/usb-devices/${encodeURIComponent(name)}/claim`);
};

export const fetchHarvesterPciDevices = async (cloudId: string, force = false) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/pci-devices${force ? '?force=true' : ''}`);
};

/**
 * 获取 Harvester 节点详情
 * @param cloudId 云环境 ID
 * @param name 节点名称
 * @returns Promise<any>
 */
export const fetchHarvesterNodeDetail = async (cloudId: string, name: string) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/nodes/${encodeURIComponent(name)}`);
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

/** OVN 网络分域：legacy 未分域（Harvester 全量）；flat/vpc 与 Cloudmap 分域 API 对齐 */
export type CloudOvnNetworkScope = 'legacy' | 'flat' | 'vpc';

function cloudOvnResourcePath(
  cloudId: string,
  resource: 'ovneips' | 'ovnfips' | 'ovnsnatrules' | 'ovndnatrules',
  scope: CloudOvnNetworkScope,
): string {
  if (scope === 'legacy') {
    return `/api/clouds/${cloudId}/resources/${resource}`;
  }
  const seg = scope === 'flat' ? 'network-flat' : 'network-vpc';
  return `/api/clouds/${cloudId}/resources/${seg}/${resource}`;
}

/**
 * 获取云提供商 OVN EIP（弹性 IP）列表
 * @param scope legacy=全量；flat/vpc=仅默认 VPC / 仅业务 VPC 域
 */
export const fetchCloudProviderOvnEips = async (
  cloudId: string,
  force = false,
  scope: CloudOvnNetworkScope = 'legacy',
) => {
  const base = cloudOvnResourcePath(cloudId, 'ovneips', scope);
  return await apiRequest(`${base}${force ? '?force=true' : ''}`);
};

/**
 * 获取云提供商 OVN FIP（浮动 IP）列表
 */
export const fetchCloudProviderOvnFips = async (
  cloudId: string,
  force = false,
  scope: CloudOvnNetworkScope = 'legacy',
) => {
  const base = cloudOvnResourcePath(cloudId, 'ovnfips', scope);
  return await apiRequest(`${base}${force ? '?force=true' : ''}`);
};

/**
 * 获取云提供商 OVN SNAT 规则列表
 */
export const fetchCloudProviderOvnSnatRules = async (
  cloudId: string,
  force = false,
  skipSync = false,
  scope: CloudOvnNetworkScope = 'legacy',
) => {
  const params = new URLSearchParams();
  if (force) params.append('force', 'true');
  if (skipSync) params.append('skipSync', 'true');
  const query = params.toString() ? `?${params.toString()}` : '';
  const base = cloudOvnResourcePath(cloudId, 'ovnsnatrules', scope);
  return await apiRequest(`${base}${query}`);
};

/**
 * 获取云提供商 OVN DNAT 规则列表
 */
export const fetchCloudProviderOvnDnatRules = async (
  cloudId: string,
  force = false,
  skipSync = false,
  scope: CloudOvnNetworkScope = 'legacy',
) => {
  const params = new URLSearchParams();
  if (force) params.append('force', 'true');
  if (skipSync) params.append('skipSync', 'true');
  const query = params.toString() ? `?${params.toString()}` : '';
  const base = cloudOvnResourcePath(cloudId, 'ovndnatrules', scope);
  return await apiRequest(`${base}${query}`);
};

/**
 * 创建云提供商 OVN EIP
 */
export const createCloudProviderOvnEip = async (
  cloudId: string,
  payload: any,
  scope: CloudOvnNetworkScope = 'legacy',
) => {
  return await apiPost(cloudOvnResourcePath(cloudId, 'ovneips', scope), payload);
};

/**
 * 创建云提供商 OVN FIP
 */
export const createCloudProviderOvnFip = async (
  cloudId: string,
  payload: any,
  scope: CloudOvnNetworkScope = 'legacy',
) => {
  return await apiPost(cloudOvnResourcePath(cloudId, 'ovnfips', scope), payload);
};

/**
 * 创建云提供商 OVN SNAT 规则
 */
export const createCloudProviderOvnSnatRule = async (
  cloudId: string,
  payload: any,
  scope: CloudOvnNetworkScope = 'legacy',
) => {
  return await apiPost(cloudOvnResourcePath(cloudId, 'ovnsnatrules', scope), payload);
};

/**
 * 创建云提供商 OVN DNAT 规则
 */
export const createCloudProviderOvnDnatRule = async (
  cloudId: string,
  payload: any,
  scope: CloudOvnNetworkScope = 'legacy',
) => {
  return await apiPost(cloudOvnResourcePath(cloudId, 'ovndnatrules', scope), payload);
};

/**
 * 删除云提供商 OVN EIP
 * @param cloudId 云环境 ID
 * @param name EIP 名称
 * @returns Promise<any>
 */
export const deleteCloudProviderOvnEip = async (cloudId: string, name: string) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/ovneips/${encodeURIComponent(name)}`);
};

/**
 * 删除云提供商 OVN FIP
 * @param cloudId 云环境 ID
 * @param name FIP 名称
 * @returns Promise<any>
 */
export const deleteCloudProviderOvnFip = async (cloudId: string, name: string) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/ovnfips/${encodeURIComponent(name)}`);
};

/**
 * 删除云提供商 OVN SNAT 规则
 * @param cloudId 云环境 ID
 * @param name SNAT 规则名称
 * @returns Promise<any>
 */
export const deleteCloudProviderOvnSnatRule = async (cloudId: string, name: string) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/ovnsnatrules/${encodeURIComponent(name)}`);
};

/**
 * 删除云提供商 OVN DNAT 规则
 * @param cloudId 云环境 ID
 * @param name DNAT 规则名称
 * @returns Promise<any>
 */
export const deleteCloudProviderOvnDnatRule = async (cloudId: string, name: string) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/ovndnatrules/${encodeURIComponent(name)}`);
};

/**
 * 获取 Harvester 事件列表
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param uid 资源 UID
 * @param name 资源名称
 * @param kind 资源类型
 * @returns Promise<any>
 */
export const fetchHarvesterEvents = async (cloudId: string, namespace: string, uid: string, name: string, kind: string) => {
  const query = new URLSearchParams({
    namespace,
    uid,
    name,
    kind,
  }).toString();
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/events?${query}`);
};

/**
 * 获取 Harvester 虚拟机的 VNC URL
 * @param cloudId 云环境 ID
 * @param id 虚拟机 ID（格式：namespace/name 或 name，默认为 default 命名空间）
 * @returns Promise<any>
 */
export const fetchHarvesterVncUrl = async (cloudId: string, id: string) => {
  let namespace = 'default';
  let name = id;
  if (id.includes('/')) {
    [namespace, name] = id.split('/');
  }
  return await apiRequest(`/api/clouds/${cloudId}/resources/ecs/${encodeURIComponent(name)}/vnc-url?namespace=${encodeURIComponent(namespace)}`);
};

/**
 * 创建 KubeOVN 子网
 * @param cloudId 云环境 ID
 * @param payload 子网配置数据
 * @returns Promise<any>
 */
export const createKubeOvnSubnet = async (cloudId: string, payload: any) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/subnets`, payload);
};

/**
 * 更新 KubeOVN 子网
 * @param cloudId 云环境 ID
 * @param name 子网名称
 * @param payload 更新的配置数据
 * @returns Promise<any>
 */
export const updateKubeOvnSubnet = async (cloudId: string, name: string, payload: any) => {
  return await apiPatch(`/api/clouds/${cloudId}/resources/subnets/${encodeURIComponent(name)}`, payload);
};

/**
 * 删除 KubeOVN 子网
 * @param cloudId 云环境 ID
 * @param name 子网名称
 * @returns Promise<any>
 */
export const deleteKubeOvnSubnet = async (cloudId: string, name: string) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/subnets/${encodeURIComponent(name)}`);
};

/**
 * 获取 Harvester 命名空间列表
 * @param cloudId 云环境 ID
 * @param force 是否强制刷新，默认 false
 * @param excludeSystem 是否排除系统命名空间，默认 false
 * @returns Promise<any>
 */
export const fetchHarvesterNamespaces = async (cloudId: string, force = false, excludeSystem = false, skipSync = false) => {
  const params = new URLSearchParams();
  if (force) params.append('force', 'true');
  if (excludeSystem) params.append('excludeSystem', 'true');
  if (skipSync) params.append('skipSync', 'true');
  const queryString = params.toString();
  // 当 force=true 时，URL 中包含 force=true，requestManager 会自动跳过缓存
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/namespaces${queryString ? `?${queryString}` : ''}`);
};

/**
 * 创建 Harvester 命名空间
 * @param cloudId 云环境 ID
 * @param payload 命名空间配置数据
 * @returns Promise<any>
 */
export const createHarvesterNamespace = async (cloudId: string, payload: any) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/harvester/namespaces`, payload || {});
};

/**
 * 更新 Harvester 命名空间
 * @param cloudId 云环境 ID
 * @param name 命名空间名称
 * @param payload 更新的配置数据
 * @returns Promise<any>
 */
export const updateHarvesterNamespace = async (cloudId: string, name: string, payload: any) => {
  return await apiPatch(`/api/clouds/${cloudId}/resources/harvester/namespaces/${encodeURIComponent(name)}`, payload || {});
};

/**
 * 删除 Harvester 命名空间
 * @param cloudId 云环境 ID
 * @param name 命名空间名称
 * @returns Promise<any>
 */
export const deleteHarvesterNamespace = async (cloudId: string, name: string) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/harvester/namespaces/${encodeURIComponent(name)}`);
};

/**
 * 获取 Harvester 卷列表
 * @param cloudId 云环境 ID
 * @param force 是否强制刷新，默认 false
 * @returns Promise<any>
 */
export const fetchHarvesterVolumes = async (cloudId: string, force = false, skipSync = false) => {
  const params = new URLSearchParams();
  if (force) params.append('force', 'true');
  if (skipSync) params.append('skipSync', 'true');
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
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/available-volumes${qs}`);
};

/**
 * 获取 Harvester 存储类列表
 * @param cloudId 云环境 ID
 * @param force 是否强制刷新，默认 false
 * @returns Promise<any>
 */
export const fetchHarvesterStorageClasses = async (cloudId: string, force = false, skipSync = false) => {
  const params = new URLSearchParams();
  if (force) params.append('force', 'true');
  if (skipSync) params.append('skipSync', 'true');
  const query = params.toString();
  const mustBypassCache = !!(force || skipSync);
  return await apiRequest(
    `/api/clouds/${cloudId}/resources/harvester/storage-classes${query ? `?${query}` : ''}`,
    { skipCache: mustBypassCache }
  );
};

/**
 * 获取 Harvester 存储类详情
 * @param cloudId 云环境 ID
 * @param name 存储类名称
 * @returns Promise<any>
 */
export const fetchHarvesterStorageClassDetail = async (cloudId: string, name: string) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/storage-classes/${encodeURIComponent(name)}`);
};

/**
 * 获取 Harvester 镜像列表
 * @param cloudId 云环境 ID
 * @param force 是否强制刷新，默认 false
 * @returns Promise<any>
 */
export const fetchHarvesterImages = async (cloudId: string, force = false, skipSync = false) => {
  const params = new URLSearchParams();
  if (force) params.append('force', 'true');
  if (skipSync) params.append('skipSync', 'true');
  const queryString = params.toString();
  return await apiRequest(
    `/api/clouds/${cloudId}/resources/harvester/images${queryString ? `?${queryString}` : ''}`,
    { skipCache: force }
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
  status: 'pending' | 'ingesting' | 'proxying' | 'success' | 'failed' | 'cancelled';
  phase: 'pending' | 'ingesting' | 'proxying' | 'finished';
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
  payload: { namespace: string; displayName?: string; imageType?: string },
) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/harvester/images/upload-tasks`, payload);
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

export const deleteHarvesterImageUploadTask = async (cloudId: string, taskId: string) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/harvester/images/upload-tasks/${encodeURIComponent(taskId)}`);
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
 * @param payload 恢复配置，包含卷名称、存储类名称、大小、访问模式和卷模式
 * @returns Promise<any>
 */
export const restoreHarvesterVolumeSnapshot = async (cloudId: string, namespace: string, snapshotName: string, payload: { name: string; storageClassName?: string; size?: string; accessModes?: string[]; volumeMode?: string }) => {
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
  return await apiDelete(`/api/clouds/${cloudId}/resources/harvester/images/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`);
};

/**
 * 获取 KubeOVN 提供商网络列表
 * @param cloudId 云环境 ID
 * @returns Promise<any>
 */
export const fetchKubeOvnProviderNetworks = async (cloudId: string, force = false, skipSync = false) => {
  const params = new URLSearchParams();
  if (force) params.append('force', 'true');
  if (skipSync) params.append('skipSync', 'true');
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
 * @returns Promise<any>
 */
export const fetchKubeOvnVlans = async (cloudId: string, force = false, skipSync = false) => {
  const params = new URLSearchParams();
  if (force) params.append('force', 'true');
  if (skipSync) params.append('skipSync', 'true');
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
 * 获取 Harvester 节点列表
 * @param cloudId 云环境 ID
 * @param force 是否强制刷新，默认 false
 * @returns Promise<any>
 */
export const fetchHarvesterNodes = async (cloudId: string, force = false) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/nodes${force ? '?force=true' : ''}`);
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
 * 获取 Harvester 虚拟机详情
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name 虚拟机名称
 * @returns Promise<any>
 */
export const fetchHarvesterVmDetail = async (cloudId: string, namespace: string, name: string) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/vms/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`);
};

/**
 * 将 Harvester 虚拟机保存为模板
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name 虚拟机名称
 * @param payload 模板配置，包含别名、描述和目标命名空间
 * @returns Promise<any>
 */
export const saveHarvesterVmAsTemplate = async (
  cloudId: string,
  namespace: string,
  name: string,
  payload?: { alias?: string; description?: string; namespace?: string },
) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/harvester/vms/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/save-as-template`, payload || {});
};

/**
 * 获取 KubeOVN VPC 列表
 * @param cloudId 云环境 ID
 * @param force 是否强制刷新，默认 false
 * @returns Promise<any>
 */
/**
 * 获取 KubeOVN VPC 列表
 * @param cloudId 云环境 ID
 * @param force 是否强制刷新，默认 false
 * @param skipSync 是否跳过全量同步，默认 false
 * @returns Promise<any>
 */
export const fetchKubeOvnVpcs = async (cloudId: string, force = false, skipSync = false) => {
  const params = new URLSearchParams();
  if (force) params.append('force', 'true');
  if (skipSync) params.append('skipSync', 'true');
  const query = params.toString();
  return await apiRequest(`/api/clouds/${cloudId}/resources/vpcs${query ? `?${query}` : ''}`);
};

/**
 * 获取 KubeOVN 子网列表
 * @param cloudId 云环境 ID
 * @param force 是否强制刷新，默认 false
 * @returns Promise<any>
 */
export const fetchKubeOvnSubnets = async (cloudId: string, force = false, skipSync = false) => {
  const params = new URLSearchParams();
  if (force) params.append('force', 'true');
  if (skipSync) params.append('skipSync', 'true');
  const query = params.toString();
  const mustBypassCache = !!(force || skipSync);
  return await apiRequest(`/api/clouds/${cloudId}/resources/subnets${query ? `?${query}` : ''}`, {
    skipCache: mustBypassCache,
  });
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
 * 获取 Harvester GPU 资源列表
 * @param cloudId 云环境 ID
 * @param force 是否强制刷新，默认 false
 * @returns Promise<any>
 */
export const fetchHarvesterGpuResources = async (cloudId: string, force = false) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/gpus${force ? '?force=true' : ''}`);
};

/**
 * 获取 Harvester 能力信息
 * @param cloudId 云环境 ID
 * @returns Promise<any>
 */
export const fetchHarvesterCapabilities = async (cloudId: string) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/harvester/capabilities`);
};

/**
 * 更新 Harvester 虚拟机规格
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name 虚拟机名称
 * @param payload 更新的规格配置数据
 * @returns Promise<any>
 */
export const updateHarvesterVmSpec = async (cloudId: string, namespace: string, name: string, payload: any) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/harvester/vms/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/update-spec`, payload);
};

/**
 * 创建 Harvester 虚拟机
 * @param cloudId 云环境 ID
 * @param payload 虚拟机配置数据
 * @returns Promise<any>
 */
export const createHarvesterVm = async (cloudId: string, payload: any) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/harvester/vms`, payload);
};

/**
 * 使用 Patch 方式更新 Harvester 虚拟机
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name 虚拟机名称
 * @param payload 更新的配置数据
 * @param contentType 内容类型，默认为 'application/merge-patch+json'
 * @returns Promise<any>
 */
export const patchHarvesterVm = async (cloudId: string, namespace: string, name: string, payload: any, contentType = 'application/merge-patch+json') => {
  return await apiPatch(`/api/clouds/${cloudId}/resources/harvester/vms/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`, payload, { contentType });
};

/**
 * 停止 Harvester 虚拟机
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name 虚拟机名称
 * @param force 是否强制停止，默认 false
 * @returns Promise<any>
 */
export const stopHarvesterVm = async (cloudId: string, namespace: string, name: string, force = false) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/harvester/vms/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/stop`, { force });
};

/**
 * 恢复虚拟机（从回收站）
 * @param cloudId 云环境 ID
 * @param instanceId 虚拟机实例 ID
 * @returns Promise<any>
 */
export const restoreHarvesterVm = async (cloudId: string, instanceId: string) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/ecs/${encodeURIComponent(instanceId)}/restore`, {});
};

/**
 * 强制删除虚拟机（从回收站中真正删除）
 * @param cloudId 云环境 ID
 * @param instanceId 虚拟机实例 ID
 * @param deleteVolumes 是否同时删除关联的卷，默认 false
 * @returns Promise<any>
 */
export const forceDeleteHarvesterVm = async (cloudId: string, instanceId: string, deleteVolumes = false) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/ecs/${encodeURIComponent(instanceId)}/force?deleteVolumes=${deleteVolumes}`);
};

/**
 * 暂停 Harvester 虚拟机
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name 虚拟机名称
 * @returns Promise<any>
 */
export const pauseHarvesterVm = async (cloudId: string, namespace: string, name: string) => {
  const instanceId = `${namespace}/${name}`;
  return await apiPost(`/api/clouds/${cloudId}/resources/ecs/${encodeURIComponent(instanceId)}/pause`, {});
};

/**
 * 恢复暂停的 Harvester 虚拟机
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name 虚拟机名称
 * @returns Promise<any>
 */
export const unpauseHarvesterVm = async (cloudId: string, namespace: string, name: string) => {
  const instanceId = `${namespace}/${name}`;
  return await apiPost(`/api/clouds/${cloudId}/resources/ecs/${encodeURIComponent(instanceId)}/unpause`, {});
};

/**
 * 启动 Harvester 虚拟机
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name 虚拟机名称
 * @returns Promise<any>
 */
export const startHarvesterVm = async (cloudId: string, namespace: string, name: string) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/harvester/vms/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/start`, {});
};

// --- Added Delete Functions ---

/**
 * 删除 Harvester 备份
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name 备份名称
 * @returns Promise<any>
 */
export const deleteHarvesterBackup = async (cloudId: string, namespace: string, name: string) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/harvester/backups/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`);
};

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
 * 创建 Harvester SSH 密钥
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name SSH 密钥名称
 * @param publicKey 公钥内容
 * @param annotations 注解（可选）
 * @returns Promise<any>
 */
export const createHarvesterSshKey = async (cloudId: string, namespace: string, name: string, publicKey: string, annotations?: Record<string, string>) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/harvester/sshkeys`, { namespace, name, publicKey, annotations });
};

/**
 * 删除 Harvester SSH 密钥
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name SSH 密钥名称
 * @returns Promise<any>
 */
export const deleteHarvesterSshKey = async (cloudId: string, namespace: string, name: string) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/harvester/sshkeys/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`);
};

/**
 * 删除 Harvester CloudInit 配置
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name CloudInit 配置名称
 * @returns Promise<any>
 */
export const deleteHarvesterCloudInit = async (cloudId: string, namespace: string, name: string) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/harvester/cloudinits/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`);
};

/**
 * 删除 Harvester Service
 * @param cloudId 云环境 ID
 * @param namespace 命名空间
 * @param name Service 名称
 * @returns Promise<any>
 */
export const deleteHarvesterService = async (cloudId: string, namespace: string, name: string) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/harvester-loadbalancers/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`);
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
 * 执行 Harvester VM 操作（热插拔等）
 * @param cloudId 云环境 ID
 * @param namespace 虚拟机命名空间
 * @param name 虚拟机名称
 * @param action 操作类型：addNic, removeNic, findHotunpluggableNics 等
 * @param payload 操作参数
 * @returns Promise<any>
 */
export const harvesterVmAction = async (
  cloudId: string,
  namespace: string,
  name: string,
  action: string,
  payload: any
) => {
  return await apiPost(
    `/api/clouds/${cloudId}/resources/harvester/vms/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/action?action=${action}`,
    payload
  );
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
