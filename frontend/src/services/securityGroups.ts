import { apiRequest, apiPost, apiPatch, apiDelete } from './api';

export const fetchCloudProviderSecurityGroups = async (cloudId: string) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/security-groups`);
};

export const createCloudProviderSecurityGroup = async (
  cloudId: string,
  payload: { vpcId: string; name: string; description?: string }
) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/security-groups`, payload);
};

export const updateCloudProviderSecurityGroup = async (
  cloudId: string,
  sgId: string,
  payload: { name?: string; description?: string }
) => {
  return await apiPatch(`/api/clouds/${cloudId}/resources/security-groups/${sgId}`, payload);
};

export const deleteCloudProviderSecurityGroup = async (cloudId: string, sgId: string) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/security-groups/${sgId}`);
};

export const fetchCloudProviderSecurityGroupDetail = async (cloudId: string, sgId: string) => {
  return await apiRequest(`/api/clouds/${cloudId}/resources/security-groups/${encodeURIComponent(sgId)}`);
};

export const createCloudProviderSecurityGroupRule = async (cloudId: string, sgId: string, payload: any) => {
  return await apiPost(`/api/clouds/${cloudId}/resources/security-groups/${encodeURIComponent(sgId)}/rules`, payload);
};

export const deleteCloudProviderSecurityGroupRule = async (cloudId: string, sgId: string, payload: any) => {
  return await apiDelete(`/api/clouds/${cloudId}/resources/security-groups/${encodeURIComponent(sgId)}/rules`, payload);
};
