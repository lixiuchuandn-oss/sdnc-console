import { apiRequest, apiPost, apiPatch, apiDelete } from './api';

export interface SecurityDomainPayload {
  name: string;
  /** 单字段：`kind:子类`（如 vpc:VPC网络 / flat:自定义网络），与前端 `SECURITY_DOMAIN_CATEGORY_VALUE_OPTIONS` 一致 */
  category?: string;
  cidr?: string; // 非 VPC 类型的 IPv4 CIDR
  cidr6?: string; // 非 VPC 类型的 IPv6 CIDR（可选，逗号分隔）
  cloudId?: string;
  resourcePool?: string;
  vpcMode?: 'existing' | 'new';
  vpcId?: string;
  newVpcName?: string;
  newVpcCidr?: string;
  vrUuid?: string;
  vrName?: string;
  vrInstanceIds?: string[];
  vrPublicEniIds?: string[];
  vrPrivateEniIds?: string[];
  vrPublicIp?: string[];
  vrPrivateIp?: string[];
  vrPublicSubnetCidr?: string[];
  vrPrivateSubnetCidr?: string[];
  tags?: string; // 逗号分隔
  tenantId?: string;
  organizationId?: string;
  status?: string;
  roleKind?: 'internetwork_routing' | 'csm_mirror';
  csmCloudId?: string;
  csmOrgId?: string;
  linkedCsmSecurityDomainId?: string;
  discoveryMode?: 'cloud_api' | 'vr_scan' | 'hybrid';
}

export type ListSecurityDomainsQuery = {
  roleKind?: 'internetwork_routing' | 'csm_mirror';
  orchestratable?: boolean;
};

export const listSecurityDomains = async (query?: ListSecurityDomainsQuery): Promise<any[]> => {
  const params = new URLSearchParams();
  if (query?.roleKind) params.set('roleKind', query.roleKind);
  if (query?.orchestratable) params.set('orchestratable', '1');
  const qs = params.toString();
  const res = await apiRequest(`/api/security-domains${qs ? `?${qs}` : ''}`);
  return Array.isArray(res) ? res : (res?.data || []);
};

export const getSecurityDomain = async (id: string): Promise<any> => {
  return await apiRequest(`/api/security-domains/${id}`);
};

export const createSecurityDomain = async (payload: SecurityDomainPayload): Promise<any> => {
  return await apiPost('/api/security-domains', payload);
};

export const updateSecurityDomain = async (id: string, payload: Partial<SecurityDomainPayload>): Promise<any> => {
  return await apiPatch(`/api/security-domains/${id}`, payload);
};

export const deleteSecurityDomain = async (id: string): Promise<any> => {
  return await apiDelete(`/api/security-domains/${id}`);
};

export type VrSuggestReason = {
  code: string;
  message: string;
};

export type VrSuggestItem = {
  vrUuid: string;
  name: string;
  score: number;
  reasons: VrSuggestReason[];
  instanceId?: string;
  privateIp?: string;
  vmId?: string;
};

export type SuggestVrTerminalSummary = {
  instanceId: string;
  instanceName?: string;
  privateIp?: string;
};

export type SuggestVrResponse = {
  terminals: {
    count: number;
    vpcCidr?: string;
    source?: 'inventory' | 'inventory_fuzzy' | 'live_cloud_api';
    items?: SuggestVrTerminalSummary[];
  };
  suggestions: VrSuggestItem[];
  hints?: string[];
  autoSuggestVrUuid?: string;
};

export const suggestVrForSecurityDomain = async (query: {
  cloudId: string;
  vpcId: string;
  tenantId?: string;
  organizationId?: string;
  excludeDomainId?: string;
  vpcCidr?: string;
}): Promise<SuggestVrResponse> => {
  const params = new URLSearchParams();
  params.set('cloudId', query.cloudId);
  params.set('vpcId', query.vpcId);
  if (query.tenantId) params.set('tenantId', query.tenantId);
  if (query.organizationId) params.set('organizationId', query.organizationId);
  if (query.excludeDomainId) params.set('excludeDomainId', query.excludeDomainId);
  if (query.vpcCidr) params.set('vpcCidr', query.vpcCidr);
  const res = await apiRequest(`/api/security-domains/suggest-vr?${params.toString()}`, {
    skipCache: true,
  });
  return (res?.data ?? res) as SuggestVrResponse;
};
