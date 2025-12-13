import { API_BASE_URL } from './api';

const getAuthHeaders = () => {
  const token = localStorage.getItem('token');
  return {
    'Content-Type': 'application/json',
    'Authorization': token ? `Bearer ${token}` : '',
  };
};

export interface InfoDomainPayload {
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
  purpose?: string;
  tags?: string; // 逗号分隔
  description?: string;
  status?: string;
}

export const listInfoDomains = async (): Promise<any[]> => {
  const res = await fetch(`${API_BASE_URL}/api/info-domains`, {
    method: 'GET',
    headers: getAuthHeaders(),
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
};

export const createInfoDomain = async (payload: InfoDomainPayload): Promise<any> => {
  const res = await fetch(`${API_BASE_URL}/api/info-domains`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const updateInfoDomain = async (id: string, payload: Partial<InfoDomainPayload>): Promise<any> => {
  const res = await fetch(`${API_BASE_URL}/api/info-domains/${id}`, {
    method: 'PATCH',
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const deleteInfoDomain = async (id: string): Promise<any> => {
  const res = await fetch(`${API_BASE_URL}/api/info-domains/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};