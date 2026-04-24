import { apiPost, apiRequest } from './api';

function clusterBase(poolId: string, clusterId: string, path: string) {
  return `/api/clouds/${encodeURIComponent(poolId)}/rancher/clusters/${encodeURIComponent(clusterId)}${path}`;
}

export type RancherProjectRow = {
  id: string;
  name: string;
  state?: string;
  namespaceId?: string;
  created?: string;
};

export type RancherNamespaceRow = {
  id: string;
  name: string;
  phase?: string;
  created?: string;
};

export type RancherNodeRow = {
  id: string;
  name: string;
  state?: string;
  kubeletVersion?: string;
  internalIp?: string;
  roles?: string;
};

export type RancherMemberRow = {
  id: string;
  userId?: string;
  userPrincipalName?: string;
  groupPrincipalName?: string;
  roleTemplateId?: string;
  created?: string;
};

export type RancherEventRow = {
  namespace: string;
  reason: string;
  message: string;
  type: string;
  lastTimestamp?: string;
  kind: string;
  name: string;
};

export type RancherClusterDetail = {
  id: string;
  name: string;
  state?: string;
  kubernetesVersion?: string;
  provider?: string;
  agentImage?: string;
};

export async function fetchRancherClusterProjects(
  poolId: string,
  clusterId: string,
): Promise<RancherProjectRow[]> {
  const j = await apiRequest(clusterBase(poolId, clusterId, '/projects'), { skipCache: true });
  return Array.isArray(j?.data) ? j.data : [];
}

export async function fetchRancherClusterNamespaces(
  poolId: string,
  clusterId: string,
): Promise<RancherNamespaceRow[]> {
  const j = await apiRequest(clusterBase(poolId, clusterId, '/namespaces'), { skipCache: true });
  return Array.isArray(j?.data) ? j.data : [];
}

export async function fetchRancherClusterNodes(
  poolId: string,
  clusterId: string,
): Promise<RancherNodeRow[]> {
  const j = await apiRequest(clusterBase(poolId, clusterId, '/nodes'), { skipCache: true });
  return Array.isArray(j?.data) ? j.data : [];
}

export async function fetchRancherClusterMembers(
  poolId: string,
  clusterId: string,
): Promise<RancherMemberRow[]> {
  const j = await apiRequest(clusterBase(poolId, clusterId, '/members'), { skipCache: true });
  return Array.isArray(j?.data) ? j.data : [];
}

export async function fetchRancherClusterEvents(
  poolId: string,
  clusterId: string,
): Promise<RancherEventRow[]> {
  const j = await apiRequest(clusterBase(poolId, clusterId, '/events'), { skipCache: true });
  return Array.isArray(j?.data) ? j.data : [];
}

export async function fetchRancherClusterDetail(
  poolId: string,
  clusterId: string,
): Promise<RancherClusterDetail | null> {
  const j = await apiRequest(clusterBase(poolId, clusterId, '/detail'), { skipCache: true });
  return j?.data && typeof j.data === 'object' ? j.data : null;
}

export type RancherWorkloadKind =
  | 'cronjob'
  | 'daemonset'
  | 'deployment'
  | 'job'
  | 'statefulset'
  | 'pod';

export type RancherWorkloadCounts = Partial<Record<RancherWorkloadKind, number>>;

export async function fetchRancherClusterWorkloadCounts(
  poolId: string,
  clusterId: string,
): Promise<RancherWorkloadCounts> {
  const j = await apiRequest(clusterBase(poolId, clusterId, '/workloads/counts'), {
    skipCache: true,
  });
  const c = j?.data?.counts;
  return c && typeof c === 'object' ? (c as RancherWorkloadCounts) : {};
}

export async function fetchRancherClusterWorkloads(
  poolId: string,
  clusterId: string,
  kind: RancherWorkloadKind,
): Promise<Record<string, unknown>[]> {
  const j = await apiRequest(clusterBase(poolId, clusterId, `/workloads/${kind}`), {
    skipCache: true,
  });
  return Array.isArray(j?.data) ? j.data : [];
}

/** 在目标命名空间创建工作负载；`manifest` 为完整 K8s 对象（与当前侧栏 kind 一致） */
export async function createRancherClusterWorkload(
  poolId: string,
  clusterId: string,
  kind: RancherWorkloadKind,
  manifest: Record<string, unknown>,
): Promise<unknown> {
  const j = await apiPost(clusterBase(poolId, clusterId, `/workloads/${kind}`), {
    manifest,
  });
  return j?.data;
}

/** 与 `rancherClusterResources.routes` 中 RANCHER_K8S_STEVE_KINDS 一致 */
export type RancherK8sListKind =
  | 'services'
  | 'ingresses'
  | 'persistentvolumes'
  | 'persistentvolumeclaims'
  | 'storageclasses'
  | 'networkpolicies'
  | 'configmaps'
  | 'secrets'
  | 'catalogapps';

export async function fetchRancherClusterK8sList(
  poolId: string,
  clusterId: string,
  kind: RancherK8sListKind,
): Promise<Record<string, unknown>[]> {
  const j = await apiRequest(clusterBase(poolId, clusterId, `/k8s/${encodeURIComponent(kind)}`), {
    skipCache: true,
  });
  return Array.isArray(j?.data) ? j.data : [];
}
