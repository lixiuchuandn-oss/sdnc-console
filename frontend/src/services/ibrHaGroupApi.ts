import { apiDelete, apiPatch, apiPost, apiPut, apiRequest } from './api';

export type IbrHaGroupMemberRole = 'primary' | 'backup';

export type IbrHaGroupMember = {
	role: IbrHaGroupMemberRole;
	vrUuid: string;
	name: string | null;
	managementIp: string | null;
	vrrpPriority: number | null;
};

export type IbrHaGroupStatus = 'draft' | 'configured' | 'degraded' | 'unknown';

export type IbrHaGroup = {
	id: string;
	name: string;
	description: string | null;
	mode: string;
	status: IbrHaGroupStatus;
	vrrpIntent: unknown | null;
	members: IbrHaGroupMember[];
	createdAt: string;
	updatedAt: string;
};

function unwrapData<T>(payload: unknown): T {
	if (payload && typeof payload === 'object' && 'data' in (payload as object)) {
		return (payload as { data: T }).data;
	}
	return payload as T;
}

export async function fetchIbrHaGroups(options?: { skipCache?: boolean }): Promise<IbrHaGroup[]> {
	const res = await apiRequest('/api/ibr-ha-groups', { skipCache: options?.skipCache ?? true });
	const data = unwrapData<IbrHaGroup[]>(res);
	return Array.isArray(data) ? data : [];
}

export async function fetchIbrHaGroup(id: string): Promise<IbrHaGroup> {
	const res = await apiRequest(`/api/ibr-ha-groups/${encodeURIComponent(id)}`, { skipCache: true });
	return unwrapData<IbrHaGroup>(res);
}

export async function createIbrHaGroup(body: {
	name: string;
	description?: string;
	primaryUuid: string;
	backupUuid: string;
	vrrpIntent?: unknown;
}): Promise<IbrHaGroup> {
	const res = await apiPost('/api/ibr-ha-groups', body);
	return unwrapData<IbrHaGroup>(res);
}

export async function updateIbrHaGroup(
	id: string,
	body: { name?: string; description?: string | null; vrrpIntent?: unknown },
): Promise<IbrHaGroup> {
	const res = await apiPatch(`/api/ibr-ha-groups/${encodeURIComponent(id)}`, body);
	return unwrapData<IbrHaGroup>(res);
}

export async function replaceIbrHaGroupMembers(
	id: string,
	body: { primaryUuid: string; backupUuid: string },
): Promise<IbrHaGroup> {
	const res = await apiPut(`/api/ibr-ha-groups/${encodeURIComponent(id)}/members`, body);
	return unwrapData<IbrHaGroup>(res);
}

export async function deleteIbrHaGroup(id: string): Promise<void> {
	await apiDelete(`/api/ibr-ha-groups/${encodeURIComponent(id)}`);
}

export type IbrHaGroupDeployResult = {
	group: IbrHaGroup;
	primary: { status: string; mergedConfig?: unknown };
	backup: { status: string; mergedConfig?: unknown };
};

/** 将 vrrpIntent 经 CSMCTL 下发主备两台 IBR */
export async function deployIbrHaGroup(id: string): Promise<IbrHaGroupDeployResult> {
	const res = await apiPost(`/api/ibr-ha-groups/${encodeURIComponent(id)}/deploy`, {});
	return unwrapData<IbrHaGroupDeployResult>(res);
}
