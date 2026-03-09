import { apiRequest, apiPost, apiPatch, apiDelete } from './api';

// --- Security Zones ---

export const fetchSecurityZones = async (params?: any) => {
  const query = new URLSearchParams(params).toString();
  // Call the Security Domain API instead of security-zones
  const endpoint = query ? `/api/security-domains?${query}` : '/api/security-domains';
  return await apiRequest(endpoint);
};

export const createSecurityZone = async (data: any) => {
  return await apiPost('/api/security/traffic/security-zones', data);
};

export const updateSecurityZone = async (id: string, data: any) => {
  return await apiPatch(`/api/security/traffic/security-zones/${id}`, data);
};

export const deleteSecurityZone = async (id: string) => {
  return await apiDelete(`/api/security/traffic/security-zones/${id}`);
};

// --- Protection Objects ---

export const fetchProtectionObjects = async (params?: any) => {
  const query = new URLSearchParams(params).toString();
  const endpoint = query ? `/api/security/traffic/protection-objects?${query}` : '/api/security/traffic/protection-objects';
  return await apiRequest(endpoint);
};

export const createProtectionObject = async (data: any) => {
  return await apiPost('/api/security/traffic/protection-objects', data);
};

export const updateProtectionObject = async (id: string, data: any) => {
  return await apiPatch(`/api/security/traffic/protection-objects/${id}`, data);
};

export const deleteProtectionObject = async (id: string) => {
  return await apiDelete(`/api/security/traffic/protection-objects/${id}`);
};

// --- Service Chains ---

export const fetchServiceChains = async (params?: any) => {
  const query = new URLSearchParams(params).toString();
  const endpoint = query ? `/api/security/traffic/service-chains?${query}` : '/api/security/traffic/service-chains';
  return await apiRequest(endpoint);
};

export const createServiceChain = async (data: any) => {
  return await apiPost('/api/security/traffic/service-chains', data);
};

export const updateServiceChain = async (id: string, data: any) => {
  return await apiPatch(`/api/security/traffic/service-chains/${id}`, data);
};

export const deleteServiceChain = async (id: string) => {
  return await apiDelete(`/api/security/traffic/service-chains/${id}`);
};
