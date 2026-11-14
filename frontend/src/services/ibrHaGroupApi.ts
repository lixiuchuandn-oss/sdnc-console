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

export type HaGroupHealthCode =
	| 'ok'
	| 'drift'
	| 'not_deployed'
	| 'degraded'
	| 'endpoint_missing';

export type HaMemberHealth = {
	role: IbrHaGroupMemberRole;
	vrUuid: string;
	code: 'ok' | 'drift' | 'not_deployed' | 'endpoint_missing';
	message: string;
};

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
	configHealth?: HaGroupHealthCode | null;
	configHealthMessage?: string | null;
	configHealthCheckedAt?: string | null;
	memberHealth?: HaMemberHealth[];
};

export type IbrHaGroupHealthReport = {
	groupId: string;
	health: HaGroupHealthCode;
	message: string;
	checkedAt: string;
	members: HaMemberHealth[];
};

export type IbrHaGroupReconcileItem = {
	groupId: string;
	name: string;
	health: HaGroupHealthCode;
	message: string;
	members: HaMemberHealth[];
	repaired: boolean;
	repairActions: string[];
};

export type IbrHaGroupReconcileReport = {
	scanned: number;
	withIssues: number;
	repaired: number;
	items: IbrHaGroupReconcileItem[];
};

export type IbrHaGroupDeployDrift = {
	groupId: string;
	role: IbrHaGroupMemberRole;
	vrUuid: string;
	conflicts: Array<{ kind?: string; key?: string; message: string }>;
	blocking: boolean;
};

function unwrapData<T>(payload: unknown): T {
	if (payload && typeof payload === 'object' && 'data' in (payload as object)) {
		return (payload as { data: T }).data;
	}
	return payload as T;
}

export async function fetchIbrHaGroups(options?: {
	skipCache?: boolean;
	includeHealth?: boolean;
}): Promise<IbrHaGroup[]> {
	const q = options?.includeHealth ? '?includeHealth=1' : '';
	const res = await apiRequest(`/api/ibr-ha-groups${q}`, { skipCache: options?.skipCache ?? true });
	const data = unwrapData<IbrHaGroup[]>(res);
	return Array.isArray(data) ? data : [];
}

export async function fetchIbrHaGroupHealth(id: string): Promise<IbrHaGroupHealthReport> {
	const res = await apiRequest(`/api/ibr-ha-groups/${encodeURIComponent(id)}/health`, {
		skipCache: true,
	});
	return unwrapData<IbrHaGroupHealthReport>(res);
}

export type IbrHaGroupLiveStepKey = 'role' | 'track' | 'vip';

export type IbrHaGroupLiveStep = {
	key: IbrHaGroupLiveStepKey;
	status: 'pass' | 'fail' | 'skip';
	message: string;
};

export type IbrHaGroupLiveMember = {
	role: IbrHaGroupMemberRole;
	vrUuid: string;
	name: string | null;
	reachable: boolean;
	error?: string;
	state: string | null;
	vrid: number | null;
	/** 本组实例 Virtual Router ID（可多个；不是 keepalived 实例序号） */
	memberVrids?: number[];
	/** 拥有的 sync group id（可多个） */
	groupIds?: number[];
	virtualIps: string[];
	vipInstalled: boolean;
	trackStatus: string | null;
	trackCommand: string | null;
	/** track 目标网关；多组时逗号拼接 */
	trackGateway?: string | null;
};

export type IbrHaGroupLiveReport = {
	groupId: string;
	name: string;
	lifecycleStatus: string;
	side: string | null;
	members: IbrHaGroupLiveMember[];
	steps: IbrHaGroupLiveStep[];
	checkedAt: string;
};

export async function fetchIbrHaGroupLive(id: string): Promise<IbrHaGroupLiveReport> {
	const res = await apiRequest(`/api/ibr-ha-groups/${encodeURIComponent(id)}/live`, {
		skipCache: true,
		enableDeduplication: false,
		enableRetry: false,
	});
	return unwrapData<IbrHaGroupLiveReport>(res);
}

export async function inspectIbrHaGroupDeployDrift(
	id: string,
	role: IbrHaGroupMemberRole,
): Promise<IbrHaGroupDeployDrift> {
	const res = await apiRequest(
		`/api/ibr-ha-groups/${encodeURIComponent(id)}/deploy/drift?role=${encodeURIComponent(role)}`,
		{ skipCache: true, enableDeduplication: false },
	);
	return unwrapData<IbrHaGroupDeployDrift>(res);
}

export async function reconcileIbrHaGroups(options?: {
	repair?: boolean;
	groupId?: string;
}): Promise<IbrHaGroupReconcileReport> {
	const body: { repair?: boolean; groupId?: string } = {};
	if (options?.repair) body.repair = true;
	if (options?.groupId) body.groupId = options.groupId;
	const res = await apiPost('/api/ibr-ha-groups/reconcile', body);
	return unwrapData<IbrHaGroupReconcileReport>(res);
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
	options?: { role?: 'primary' | 'backup'; acknowledgeDrift?: boolean },
): Promise<IbrHaGroupDeployResult> {
	const body: { role?: 'primary' | 'backup'; acknowledgeDrift?: boolean } = {};
	if (options?.role) body.role = options.role;
	if (options?.acknowledgeDrift) body.acknowledgeDrift = true;
	const res = await apiPost(`/api/ibr-ha-groups/${encodeURIComponent(id)}/deploy`, body);
	return unwrapData<IbrHaGroupDeployResult>(res);
}
