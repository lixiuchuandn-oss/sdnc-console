import { apiRequest, apiPost, apiPatch, apiDelete } from './api';

export interface SecurityDomainPayload {
  name: string;
  category?: string; // vpc | flat
  subType?: string; // 公有云VPC网络/私有云VPC网络/虚拟化网络/IDC网络/办公网络 等
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
  purpose?: string;
  tags?: string; // 逗号分隔
  description?: string;
  status?: string;
}

export const listSecurityDomains = async (): Promise<any[]> => {
  const res = await apiRequest('/api/security-domains');
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
