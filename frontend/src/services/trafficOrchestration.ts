import { API_BASE_URL } from './api';

const getHeaders = () => {
  const token = localStorage.getItem('token');
  return {
    'Content-Type': 'application/json',
    'Authorization': token ? `Bearer ${token}` : ''
  };
};

// --- Security Zones ---

export const fetchSecurityZones = async (params?: any) => {
  const query = new URLSearchParams(params).toString();
  // Call the Info Domain API instead of security-zones
  const res = await fetch(`${API_BASE_URL}/api/info-domains?${query}`, {
    method: 'GET',
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const createSecurityZone = async (data: any) => {
  const res = await fetch(`${API_BASE_URL}/api/security/traffic/security-zones`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const updateSecurityZone = async (id: string, data: any) => {
  const res = await fetch(`${API_BASE_URL}/api/security/traffic/security-zones/${id}`, {
    method: 'PATCH',
    headers: getHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const deleteSecurityZone = async (id: string) => {
  const res = await fetch(`${API_BASE_URL}/api/security/traffic/security-zones/${id}`, {
    method: 'DELETE',
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

// --- Protection Objects ---

export const fetchProtectionObjects = async (params?: any) => {
  const query = new URLSearchParams(params).toString();
  const res = await fetch(`${API_BASE_URL}/api/security/traffic/protection-objects?${query}`, {
    method: 'GET',
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const createProtectionObject = async (data: any) => {
  const res = await fetch(`${API_BASE_URL}/api/security/traffic/protection-objects`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const updateProtectionObject = async (id: string, data: any) => {
  const res = await fetch(`${API_BASE_URL}/api/security/traffic/protection-objects/${id}`, {
    method: 'PATCH',
    headers: getHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const deleteProtectionObject = async (id: string) => {
  const res = await fetch(`${API_BASE_URL}/api/security/traffic/protection-objects/${id}`, {
    method: 'DELETE',
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

// --- Service Chains ---

export const fetchServiceChains = async (params?: any) => {
  const query = new URLSearchParams(params).toString();
  const res = await fetch(`${API_BASE_URL}/api/security/traffic/service-chains?${query}`, {
    method: 'GET',
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const createServiceChain = async (data: any) => {
  const res = await fetch(`${API_BASE_URL}/api/security/traffic/service-chains`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const updateServiceChain = async (id: string, data: any) => {
  const res = await fetch(`${API_BASE_URL}/api/security/traffic/service-chains/${id}`, {
    method: 'PATCH',
    headers: getHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const deleteServiceChain = async (id: string) => {
  const res = await fetch(`${API_BASE_URL}/api/security/traffic/service-chains/${id}`, {
    method: 'DELETE',
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};
