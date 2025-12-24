import { API_BASE_URL } from './api';

const getAuthHeaders = () => {
  const token = localStorage.getItem('token');
  return {
    'Content-Type': 'application/json',
    'Authorization': token ? `Bearer ${token}` : '',
  };
};

export const fetchCloudProviderSecurityGroups = async (cloudId: string) => {
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/security-groups`, {
    method: 'GET',
    headers: getAuthHeaders(),
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const createCloudProviderSecurityGroup = async (
  cloudId: string,
  payload: { vpcId: string; name: string; description?: string }
) => {
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/security-groups`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const updateCloudProviderSecurityGroup = async (
  cloudId: string,
  sgId: string,
  payload: { name?: string; description?: string }
) => {
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/security-groups/${sgId}`, {
    method: 'PATCH',
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const deleteCloudProviderSecurityGroup = async (cloudId: string, sgId: string) => {
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/security-groups/${sgId}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const fetchCloudProviderSecurityGroupDetail = async (cloudId: string, sgId: string) => {
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/security-groups/${encodeURIComponent(sgId)}`, {
    method: 'GET',
    headers: getAuthHeaders(),
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const createCloudProviderSecurityGroupRule = async (cloudId: string, sgId: string, payload: any) => {
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/security-groups/${encodeURIComponent(sgId)}/rules`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};

export const deleteCloudProviderSecurityGroupRule = async (cloudId: string, sgId: string, payload: any) => {
  const res = await fetch(`${API_BASE_URL}/api/clouds/${cloudId}/resources/security-groups/${encodeURIComponent(sgId)}/rules`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
};
