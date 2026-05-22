/** Kube-OVN 读接口（资源总览 · 网络拓扑等；维护域：Harvester/hsm + kube-ovn） */
import { apiRequest } from '../api';
import { appendMergePublicScenarioParam } from './internal/queryParams';

export type OvnNetworkScopeQuery = 'vpc' | 'underlay' | 'all';

export const fetchKubeOvnProviderNetworks = async (
  cloudId: string,
  force = false,
  skipSync = false,
) => {
  const params = new URLSearchParams();
  if (force) params.append('force', 'true');
  void skipSync;
  const query = params.toString();
  return await apiRequest(
    `/api/clouds/${cloudId}/resources/provider-networks${query ? `?${query}` : ''}`,
    { skipCache: !!force },
  );
};

export const fetchKubeOvnVlans = async (cloudId: string, force = false, skipSync = false) => {
  const params = new URLSearchParams();
  if (force) params.append('force', 'true');
  void skipSync;
  const query = params.toString();
  return await apiRequest(`/api/clouds/${cloudId}/resources/vlans${query ? `?${query}` : ''}`, {
    skipCache: !!force,
  });
};

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
  return await apiRequest(`/api/clouds/${cloudId}/resources/subnets?${query}`, {
    skipCache: !!force,
  });
};
