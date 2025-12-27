import { apiRequest, apiPost, apiDelete } from './api';

// --- ACL APIs ---

export interface ACLRule {
  id: string;
  name: string;
  description?: string;
  vrId: string;
  priority: number;
  action: 'permit' | 'deny';
  protocol: 'tcp' | 'udp' | 'icmp' | 'any';
  sourceIp: string;
  destinationIp: string;
  sourcePort: string;
  destinationPort: string;
  createdAt: string;
}

export const getACLRules = async (vrId?: string) => {
  const qs = vrId ? `?vrId=${encodeURIComponent(vrId)}` : '';
  return await apiRequest(`/api/networks/acl${qs}`);
};

export const createACLRule = async (data: Partial<ACLRule>) => {
  return await apiPost('/api/networks/acl', data);
};

export const deleteACLRule = async (id: string) => {
  return await apiDelete(`/api/networks/acl/${id}`);
};

// --- NAT APIs ---

export interface NATRule {
  id: string;
  name: string;
  description?: string;
  vrId: string;
  type: 'snat' | 'dnat' | 'static';
  interface?: string;
  originalSourceIp?: string;
  originalDestinationIp?: string;
  originalSourcePort?: string;
  originalDestinationPort?: string;
  translatedSourceIp?: string;
  translatedDestinationIp?: string;
  translatedSourcePort?: string;
  translatedDestinationPort?: string;
  createdAt: string;
}

export const getNATRules = async (vrId?: string) => {
  const qs = vrId ? `?vrId=${encodeURIComponent(vrId)}` : '';
  return await apiRequest(`/api/networks/nat${qs}`);
};

export const createNATRule = async (data: Partial<NATRule>) => {
  return await apiPost('/api/networks/nat', data);
};

export const deleteNATRule = async (id: string) => {
  return await apiDelete(`/api/networks/nat/${id}`);
};
