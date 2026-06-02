import { apiDelete, apiPost, apiPut, apiRequest } from '../api';

export type FailureDomainType = 'rack' | 'zone' | 'host';

export type FailureDomainRow = {
  id: string;
  cloudId: string;
  name: string;
  domainType: FailureDomainType;
  description?: string;
  sortOrder: number;
  nodeNames: string[];
};

export type FailureDomainOverview = {
  domains: FailureDomainRow[];
  unassignedNodeNames: string[];
  nodeLabelKey: string;
};

export async function fetchFailureDomainOverview(cloudId: string, force = false) {
  const qs = force ? '?force=true' : '';
  return apiRequest(`/api/clouds/${cloudId}/resources/harvester/failure-domains/overview${qs}`, {
    skipCache: true,
  });
}

export async function createFailureDomain(
  cloudId: string,
  body: {
    name: string;
    domainType?: FailureDomainType;
    description?: string;
    sortOrder?: number;
  },
) {
  return apiPost(`/api/clouds/${cloudId}/resources/harvester/failure-domains`, body);
}

export async function updateFailureDomain(
  cloudId: string,
  domainId: string,
  body: {
    name?: string;
    domainType?: FailureDomainType;
    description?: string;
    sortOrder?: number;
  },
) {
  return apiPut(`/api/clouds/${cloudId}/resources/harvester/failure-domains/${domainId}`, body);
}

export async function deleteFailureDomain(cloudId: string, domainId: string) {
  return apiDelete(`/api/clouds/${cloudId}/resources/harvester/failure-domains/${domainId}`);
}

export async function setFailureDomainNodes(
  cloudId: string,
  domainId: string,
  nodeNames: string[],
) {
  return apiPut(`/api/clouds/${cloudId}/resources/harvester/failure-domains/${domainId}/nodes`, {
    nodeNames,
  });
}

export const FAILURE_DOMAIN_TYPE_LABELS: Record<FailureDomainType, string> = {
  rack: '机架',
  zone: '可用区',
  host: '主机',
};
