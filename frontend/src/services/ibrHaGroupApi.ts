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

export type IbrHaGroupWriteResult = {
	group: IbrHaGroup;
	warnings: string[];
};

function unwrapWriteResult(payload: unknown): IbrHaGroupWriteResult {
	const group = unwrapData<IbrHaGroup>(payload);
	const warnings =
		payload && typeof payload === 'object' && Array.isArray((payload as { warnings?: unknown }).warnings)
			? ((payload as { warnings: unknown[] }).warnings.map((w) => String(w)).filter(Boolean) as string[])
			: [];
	return { group, warnings };
}

export async function createIbrHaGroup(body: {
	name: string;
	description?: string;
	primaryUuid: string;
	backupUuid: string;
	vrrpIntent?: unknown;
}): Promise<IbrHaGroupWriteResult> {
	const res = await apiPost('/api/ibr-ha-groups', body);
	return unwrapWriteResult(res);
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
): Promise<IbrHaGroupWriteResult> {
	const res = await apiPut(`/api/ibr-ha-groups/${encodeURIComponent(id)}/members`, body);
	return unwrapWriteResult(res);
}

export async function deleteIbrHaGroup(
	id: string,
	options?: { revertDevice?: boolean },
): Promise<void> {
	const q = options?.revertDevice ? '?revertDevice=true' : '';
	await apiDelete(`/api/ibr-ha-groups/${encodeURIComponent(id)}${q}`);
}

export type IbrHaGroupDeployResult = {
	group: IbrHaGroup;
	primary?: { status: string; mergedConfig?: unknown };
	backup?: { status: string; mergedConfig?: unknown };
};

export type IbrHaGroupDeployPreview = {
	role: 'primary' | 'backup';
	vrUuid: string;
	patch: { ifacePatches: unknown; topVrrp: unknown };
	slice: { interfaces: Array<{ name: string; vrrp?: unknown }>; vrrp: unknown };
	warning?: string;
};

/** 预览某节点将写入的 VRRP 组装片；mergeDevice=false 时不读设备底稿 */
export async function previewIbrHaGroupDeploy(
	id: string,
	role: 'primary' | 'backup',
	options?: { mergeDevice?: boolean },
): Promise<IbrHaGroupDeployPreview> {
	const merge = options?.mergeDevice === false ? '0' : '1';
	const res = await apiRequest(
		`/api/ibr-ha-groups/${encodeURIComponent(id)}/deploy/preview?role=${encodeURIComponent(role)}&merge=${merge}`,
		{ skipCache: true, enableDeduplication: false },
	);
	return unwrapData<IbrHaGroupDeployPreview>(res);
}

/** 将 vrrpIntent 经 CSMCTL 下发；传 role 时只推该节点，可重复下发 */
export async function deployIbrHaGroup(
	id: string,
	options?: { role?: 'primary' | 'backup' },
): Promise<IbrHaGroupDeployResult> {
	const body = options?.role ? { role: options.role } : {};
	const res = await apiPost(`/api/ibr-ha-groups/${encodeURIComponent(id)}/deploy`, body);
	return unwrapData<IbrHaGroupDeployResult>(res);
}
