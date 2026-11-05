import { API_BASE_URL, getAuthHeaders, apiPost, apiRequest, apiDelete } from './api';

export type IbrDeviceSelfcheckResult = {
	ok: boolean;
	reasons?: string[];
	checks?: Array<{ name: string; status: 'pass' | 'warning' | 'fail'; detail: string }>;
	raw?: string;
	error?: string;
};

export type IbrDevicePingResult = {
	ok: boolean;
	target: string;
	repeat: number;
	stats: { sent: number | null; received: number | null; packetLoss: string | null };
	raw: string;
	command: string;
	error?: string;
};

export type IbrDeviceNicRoleRow = {
	pci?: string;
	role?: string;
	attached?: boolean;
	vbras?: { name?: string; ip?: string; state?: string; gateway?: string | null };
};

export type IbrDeviceInitMode = 'static' | 'dhcp';

export type IbrDeviceNetLink = {
	speed_mbps?: number | null;
	speed_grade?: string;
	duplex?: string;
	mtu?: number | null;
	carrier?: boolean | null;
	driver?: string;
};

export type IbrDeviceNetEntry = {
	role?: 'mgmt' | 'wan' | 'lan';
	attached?: boolean;
	source?: 'os' | 'vpp';
	name?: string;
	ip?: string;
	gateway?: string | null;
	rate?: string;
	display?: string;
	link?: IbrDeviceNetLink;
	pci?: string;
	os_ifname?: string | null;
};

export type IbrDeviceStatusResp = {
	init_mode?: IbrDeviceInitMode;
	pci_nics?: Array<{ pci?: string; ifnames?: string[]; macs?: string[] }>;
	mgmt_pci?: string | null;
	wan_pci?: string | null;
	lan_pci?: string | null;
	nics_initialized?: boolean;
	os_nic_attach_pci?: string[] | null;
	net_overview?: {
		mgmt?: IbrDeviceNetEntry;
		wan?: IbrDeviceNetEntry;
		lan?: IbrDeviceNetEntry;
	};
	net_init_ok?: boolean;
	last_apply?: { public_ip?: string; public_gw?: string | null; private_ip?: string } | null;
	extra_lans?: Array<{ ifname: string; cidr: string }> | null;
	nic_roles?: { roles?: IbrDeviceNicRoleRow[] } | null;
	vbras_running?: boolean;
	vr_name?: string;
	vbras_process?: {
		service?: string;
		active_state?: string;
		main_pid?: string;
		tasks?: string;
		memory?: string;
	} | null;
	system_info?: { hostname: string; platform: string; arch: string; kernel: string; node: string };
	os_name?: string;
	stats?: {
		cpu: number;
		cpu_count?: number;
		mem: number;
		disk: number;
		uptime: string;
		load_1: number;
		load_5: number;
		load_15: number;
	};
	version?: string;
	cli_ok?: boolean;
	cli_error?: string | null;
	trace_id?: string;
	degraded?: string[];
	sdnc_console_base?: string | null;
	sdnc_csmctl_address?: string | null;
	compute_tower_base?: string | null;
	ai_soc_base?: string | null;
	/** @deprecated 与 compute_tower_base 相同 */
	tower_base?: string | null;
	/** @deprecated 与 sdnc_csmctl_address 相同 */
	sdwan_manageip?: string | null;
	service_reachability?: {
		pending?: boolean;
		sdnc_console?: boolean | null;
		sdnc_csmctl?: boolean | null;
		compute_tower?: boolean | null;
		aisoc?: boolean | null;
		/** @deprecated 与 compute_tower 相同 */
		tower?: boolean | null;
		/** @deprecated 与 sdnc_csmctl 相同 */
		sdwan?: boolean | null;
		checked_at?: number;
	};
};

export type IbrDeviceNicInitPayload = {
	mode: IbrDeviceInitMode;
	nics: Array<{ pci: string; role: 'wan' | 'lan' }>;
	attach_pci?: string[];
};

export type IbrDeviceNicPreviewResult = {
	ok: boolean;
	config_content?: string;
	preview_note?: string;
	message?: string;
	requires_vbras_restart?: boolean;
	error?: string;
};

export type IbrDeviceNicApplyRestartResult = {
	ok: boolean;
	logs?: string[];
	attach_pci?: string[];
	mode?: string;
	requires_vbras_restart?: boolean;
	vbras_restarted?: boolean;
	error?: string;
};

export type IbrDeviceApplyResult = {
	ok: boolean;
	logs?: string[];
	error?: string;
};

function unwrapData<T>(payload: unknown): T {
	if (payload && typeof payload === 'object' && 'data' in payload) {
		return (payload as { data: T }).data;
	}
	return payload as T;
}

export async function fetchIbrDeviceSelfcheck(
	vrUuid: string,
): Promise<IbrDeviceSelfcheckResult> {
	const res = await apiPost(
		`/api/vr-instances/${encodeURIComponent(vrUuid)}/device/ops/selfcheck`,
		{},
	);
	return unwrapData<IbrDeviceSelfcheckResult>(res);
}

export async function fetchIbrDevicePing(
	vrUuid: string,
	body: { target: string; repeat?: number },
): Promise<IbrDevicePingResult> {
	const res = await apiPost(
		`/api/vr-instances/${encodeURIComponent(vrUuid)}/device/ops/connectivity/ping`,
		body,
	);
	return unwrapData<IbrDevicePingResult>(res);
}

export async function fetchIbrDeviceLogs(vrUuid: string): Promise<string> {
	const url = `${API_BASE_URL}/api/vr-instances/${encodeURIComponent(vrUuid)}/device/ops/logs`;
	const res = await fetch(url, {
		method: 'GET',
		headers: getAuthHeaders(),
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(text.trim() || `HTTP ${res.status}`);
	}
	return res.text();
}

export async function fetchIbrDeviceStatus(
	vrUuid: string,
	options?: { skipCache?: boolean },
): Promise<IbrDeviceStatusResp> {
	const res = await apiRequest(
		`/api/vr-instances/${encodeURIComponent(vrUuid)}/device/status`,
		{ skipCache: options?.skipCache ?? true },
	);
	return unwrapData<IbrDeviceStatusResp>(res);
}

export async function applyIbrDeviceNicIp(
	vrUuid: string,
	body: { scope?: string; public_ip?: string; public_gw?: string | null; private_ip?: string },
): Promise<IbrDeviceApplyResult> {
	const res = await apiPost(
		`/api/vr-instances/${encodeURIComponent(vrUuid)}/device/nics/apply`,
		body,
	);
	return unwrapData<IbrDeviceApplyResult>(res);
}

export async function applyIbrDeviceExtraLans(
	vrUuid: string,
	body: { items?: Array<{ ifname: string; cidr: string }> },
): Promise<IbrDeviceApplyResult> {
	const res = await apiPost(
		`/api/vr-instances/${encodeURIComponent(vrUuid)}/device/nics/extra-lans/apply`,
		body,
	);
	return unwrapData<IbrDeviceApplyResult>(res);
}

export async function setIbrDeviceNicMode(
	vrUuid: string,
	body: { mode: IbrDeviceInitMode },
): Promise<{ ok: boolean; mode?: string; error?: string }> {
	const res = await apiPost(
		`/api/vr-instances/${encodeURIComponent(vrUuid)}/device/nics/mode`,
		body,
	);
	return unwrapData(res);
}

export async function previewIbrDeviceNicInit(
	vrUuid: string,
	body: IbrDeviceNicInitPayload,
): Promise<IbrDeviceNicPreviewResult> {
	const res = await apiPost(
		`/api/vr-instances/${encodeURIComponent(vrUuid)}/device/nics/preview-config`,
		body,
	);
	return unwrapData<IbrDeviceNicPreviewResult>(res);
}

export async function applyIbrDeviceNicInitRestart(
	vrUuid: string,
	body: IbrDeviceNicInitPayload,
): Promise<IbrDeviceNicApplyRestartResult> {
	const res = await apiPost(
		`/api/vr-instances/${encodeURIComponent(vrUuid)}/device/nics/apply-restart`,
		body,
		{ enableRetry: false },
	);
	return unwrapData<IbrDeviceNicApplyRestartResult>(res);
}

export type IbrDeviceAgentStatus = {
	agent_base?: string;
	download_dir?: string;
	registration_finish?: boolean;
	download_files?: string[];
	vr_conf?: unknown;
	netjson?: unknown;
	netjson_keys?: string[];
	trace_id?: string;
	error?: string;
};

export async function fetchIbrDeviceAgentStatus(
	vrUuid: string,
	options?: { skipCache?: boolean },
): Promise<IbrDeviceAgentStatus> {
	const res = await apiRequest(
		`/api/vr-instances/${encodeURIComponent(vrUuid)}/device/ops/agent/status`,
		{ skipCache: options?.skipCache ?? true },
	);
	return unwrapData<IbrDeviceAgentStatus>(res);
}

export type IbrDeviceVbrasOpResult = {
	ok?: boolean;
	message?: string;
	error?: string;
	logs?: string[];
	[key: string]: unknown;
};

export async function runIbrDeviceVbrasOp(
	vrUuid: string,
	kind: 'start' | 'stop' | 'restart',
): Promise<IbrDeviceVbrasOpResult> {
	const res = await apiPost(
		`/api/vr-instances/${encodeURIComponent(vrUuid)}/device/ops/vbras/${kind}`,
		{},
		{ enableRetry: false },
	);
	return unwrapData<IbrDeviceVbrasOpResult>(res);
}

export type IbrForwardingRouteRow = {
	raw: string;
	protocol: string;
	prefix: string;
	next_hop: string;
	interface: string;
};

export type IbrForwardingRoutesResult = {
	routes?: IbrForwardingRouteRow[];
	raw_output?: string;
	error?: string;
	ok?: boolean;
	output?: string;
};

export async function fetchIbrForwardingRoutes(
	vrUuid: string,
	options?: { skipCache?: boolean },
): Promise<IbrForwardingRoutesResult> {
	const res = await apiRequest(
		`/api/vr-instances/${encodeURIComponent(vrUuid)}/device/forwarding/routes`,
		{ skipCache: options?.skipCache ?? true },
	);
	return unwrapData<IbrForwardingRoutesResult>(res);
}

export async function addIbrForwardingRoute(
	vrUuid: string,
	body: { dst: string; gw: string; vrf_id?: string },
): Promise<IbrForwardingRoutesResult> {
	const res = await apiPost(
		`/api/vr-instances/${encodeURIComponent(vrUuid)}/device/forwarding/routes`,
		body,
		{ enableRetry: false },
	);
	return unwrapData<IbrForwardingRoutesResult>(res);
}

export async function deleteIbrForwardingRoute(
	vrUuid: string,
	body: { dst: string; gw: string; vrf_id?: string },
): Promise<IbrForwardingRoutesResult> {
	const res = await apiDelete(
		`/api/vr-instances/${encodeURIComponent(vrUuid)}/device/forwarding/routes`,
		body,
	);
	return unwrapData<IbrForwardingRoutesResult>(res);
}

export async function fetchIbrForwardingIpv6Routes(
	vrUuid: string,
	options?: { skipCache?: boolean },
): Promise<IbrForwardingRoutesResult> {
	const res = await apiRequest(
		`/api/vr-instances/${encodeURIComponent(vrUuid)}/device/forwarding/routes/ipv6`,
		{ skipCache: options?.skipCache ?? true },
	);
	return unwrapData<IbrForwardingRoutesResult>(res);
}

export async function addIbrForwardingIpv6Route(
	vrUuid: string,
	body: { dst: string; gw: string; vrf_id?: string },
): Promise<IbrForwardingRoutesResult> {
	const res = await apiPost(
		`/api/vr-instances/${encodeURIComponent(vrUuid)}/device/forwarding/routes/ipv6`,
		body,
		{ enableRetry: false },
	);
	return unwrapData<IbrForwardingRoutesResult>(res);
}

export async function deleteIbrForwardingIpv6Route(
	vrUuid: string,
	body: { dst: string; gw: string; vrf_id?: string },
): Promise<IbrForwardingRoutesResult> {
	const res = await apiDelete(
		`/api/vr-instances/${encodeURIComponent(vrUuid)}/device/forwarding/routes/ipv6`,
		body,
	);
	return unwrapData<IbrForwardingRoutesResult>(res);
}

export type IbrBgpNeighborRow = {
	id?: string;
	neighbor: string;
	v?: string;
	as: string;
	msg_rcvd?: string;
	msg_sent?: string;
	up_down?: string;
	state: string;
	pfx_rcd?: string;
	pfx_snt?: string;
	desc?: string;
	vrf?: string;
	afi?: string;
	section?: string;
};

export type IbrForwardingBgpSummaryResult = {
	raw?: string;
	neighbors?: IbrBgpNeighborRow[];
	cloud?: unknown[];
	error?: string;
};

export async function fetchIbrForwardingBgpSummary(
	vrUuid: string,
	options?: { skipCache?: boolean },
): Promise<IbrForwardingBgpSummaryResult> {
	const res = await apiRequest(
		`/api/vr-instances/${encodeURIComponent(vrUuid)}/device/forwarding/bgp/summary`,
		{ skipCache: options?.skipCache ?? true },
	);
	return unwrapData<IbrForwardingBgpSummaryResult>(res);
}

export type IbrForwardingSrv6Result = {
	raw?: string;
	cloud?: unknown[];
	error?: string;
};

export async function fetchIbrForwardingSrv6Status(
	vrUuid: string,
	options?: { skipCache?: boolean },
): Promise<IbrForwardingSrv6Result> {
	const res = await apiRequest(
		`/api/vr-instances/${encodeURIComponent(vrUuid)}/device/forwarding/srv6`,
		{ skipCache: options?.skipCache ?? true },
	);
	return unwrapData<IbrForwardingSrv6Result>(res);
}

export type IbrForwardingVrrpResult = {
	raw?: string;
	groups?: unknown[];
	cloud?: unknown[];
	error?: string;
};

export async function fetchIbrForwardingVrrp(
	vrUuid: string,
	options?: { skipCache?: boolean },
): Promise<IbrForwardingVrrpResult> {
	const res = await apiRequest(
		`/api/vr-instances/${encodeURIComponent(vrUuid)}/device/forwarding/vrrp`,
		{ skipCache: options?.skipCache ?? true },
	);
	return unwrapData<IbrForwardingVrrpResult>(res);
}

export type IbrForwardingRunningConfigResult = {
	raw?: string;
	error?: string;
};

export async function fetchIbrForwardingRunningConfig(
	vrUuid: string,
	options?: { skipCache?: boolean },
): Promise<IbrForwardingRunningConfigResult> {
	const res = await apiRequest(
		`/api/vr-instances/${encodeURIComponent(vrUuid)}/device/forwarding/running-config`,
		{ skipCache: options?.skipCache ?? true },
	);
	return unwrapData<IbrForwardingRunningConfigResult>(res);
}

export type IbrForwardingAclRow = {
	id: string;
	count: number;
	rule_count?: number;
};

export type IbrForwardingAclsResult = {
	acls?: IbrForwardingAclRow[];
	error?: string;
	ok?: boolean;
	output?: string;
};

export type IbrForwardingAclRuleRow = {
	rule_id: string;
	action: string;
	details: string;
	raw: string;
};

export type IbrForwardingAclRulesResult = {
	rules?: IbrForwardingAclRuleRow[];
	applied_interfaces?: Array<{ interface: string; direction: string }>;
	raw_output?: string;
	config_status?: string;
	interface_applied?: boolean;
	running_rules_present?: boolean;
	error?: string;
	ok?: boolean;
	output?: string;
};

export async function fetchIbrForwardingAcls(
	vrUuid: string,
	options?: { skipCache?: boolean },
): Promise<IbrForwardingAclsResult> {
	const res = await apiRequest(
		`/api/vr-instances/${encodeURIComponent(vrUuid)}/device/forwarding/acls`,
		{ skipCache: options?.skipCache ?? true },
	);
	return unwrapData<IbrForwardingAclsResult>(res);
}

export async function fetchIbrForwardingAclRules(
	vrUuid: string,
	aclId: string,
	options?: { skipCache?: boolean },
): Promise<IbrForwardingAclRulesResult> {
	const res = await apiRequest(
		`/api/vr-instances/${encodeURIComponent(vrUuid)}/device/forwarding/acl/${encodeURIComponent(aclId)}/rules`,
		{ skipCache: options?.skipCache ?? true },
	);
	return unwrapData<IbrForwardingAclRulesResult>(res);
}

export async function createIbrForwardingAcl(
	vrUuid: string,
	body: { acl_id: string },
): Promise<IbrForwardingAclsResult> {
	const res = await apiPost(
		`/api/vr-instances/${encodeURIComponent(vrUuid)}/device/forwarding/acl`,
		body,
	);
	return unwrapData<IbrForwardingAclsResult>(res);
}

export async function deleteIbrForwardingAcl(
	vrUuid: string,
	body: { acl_id: string },
): Promise<IbrForwardingAclsResult> {
	const res = await apiDelete(
		`/api/vr-instances/${encodeURIComponent(vrUuid)}/device/forwarding/acl`,
		body,
	);
	return unwrapData<IbrForwardingAclsResult>(res);
}

export async function configIbrForwardingAclRule(
	vrUuid: string,
	body: Record<string, unknown>,
): Promise<IbrForwardingAclRulesResult> {
	const res = await apiPost(
		`/api/vr-instances/${encodeURIComponent(vrUuid)}/device/forwarding/acl/rule`,
		body,
	);
	return unwrapData<IbrForwardingAclRulesResult>(res);
}

export async function deleteIbrForwardingAclRule(
	vrUuid: string,
	body: { acl_id: string; rule_id: string },
): Promise<IbrForwardingAclRulesResult> {
	const res = await apiDelete(
		`/api/vr-instances/${encodeURIComponent(vrUuid)}/device/forwarding/acl/rule`,
		body,
	);
	return unwrapData<IbrForwardingAclRulesResult>(res);
}

export async function commitIbrForwardingAcl(
	vrUuid: string,
	body: { acl_id: string },
): Promise<IbrForwardingAclRulesResult> {
	const res = await apiPost(
		`/api/vr-instances/${encodeURIComponent(vrUuid)}/device/forwarding/acl/commit`,
		body,
	);
	return unwrapData<IbrForwardingAclRulesResult>(res);
}

export async function noCommitIbrForwardingAcl(
	vrUuid: string,
	body: { acl_id: string },
): Promise<IbrForwardingAclRulesResult> {
	const res = await apiPost(
		`/api/vr-instances/${encodeURIComponent(vrUuid)}/device/forwarding/acl/no-commit`,
		body,
	);
	return unwrapData<IbrForwardingAclRulesResult>(res);
}

export type IbrForwardingInterfaceListResult = {
	interfaces?: string[];
	error?: string;
};

export async function fetchIbrForwardingInterfaces(
	vrUuid: string,
	options?: { skipCache?: boolean },
): Promise<IbrForwardingInterfaceListResult> {
	const res = await apiRequest(
		`/api/vr-instances/${encodeURIComponent(vrUuid)}/device/forwarding/interfaces`,
		{ skipCache: options?.skipCache ?? true },
	);
	return unwrapData<IbrForwardingInterfaceListResult>(res);
}

export async function applyIbrForwardingAcl(
	vrUuid: string,
	body: { interface: string; acl_id: string; if_direction?: string },
): Promise<IbrForwardingAclRulesResult> {
	const res = await apiPost(
		`/api/vr-instances/${encodeURIComponent(vrUuid)}/device/forwarding/acl/apply`,
		body,
	);
	return unwrapData<IbrForwardingAclRulesResult>(res);
}

export async function unapplyIbrForwardingAcl(
	vrUuid: string,
	body: { interface: string; acl_id: string; if_direction?: string },
): Promise<IbrForwardingAclRulesResult> {
	const res = await apiPost(
		`/api/vr-instances/${encodeURIComponent(vrUuid)}/device/forwarding/acl/unapply`,
		body,
	);
	return unwrapData<IbrForwardingAclRulesResult>(res);
}

export type IbrForwardingNatGlobal = {
	enabled: boolean;
	wan_if: string;
	group_id: number;
	use_wan_ip_as_pool: boolean;
	group_exists: boolean;
};

export type IbrForwardingNatStatusResult = {
	global?: IbrForwardingNatGlobal;
	error?: string;
	ok?: boolean;
	output?: string;
};

export type IbrForwardingNatEntryRow = {
	id: string;
	type: string;
	proto: string;
	inside_ip: string;
	inside_port: number | null;
	outside_ip: string;
	outside_port: number | null;
	vrf_id: string;
	range_start: string;
	range_end: string;
};

export type IbrForwardingNatEntriesResult = {
	entries?: IbrForwardingNatEntryRow[];
	error?: string;
	ok?: boolean;
	output?: string;
};

export type IbrForwardingNatMutationResult = IbrForwardingNatStatusResult & {
	entry?: IbrForwardingNatEntryRow;
	deleted_id?: string;
};

export async function fetchIbrForwardingNatStatus(
	vrUuid: string,
	options?: { skipCache?: boolean },
): Promise<IbrForwardingNatStatusResult> {
	const res = await apiRequest(
		`/api/vr-instances/${encodeURIComponent(vrUuid)}/device/forwarding/nat/status`,
		{ skipCache: options?.skipCache ?? true },
	);
	return unwrapData<IbrForwardingNatStatusResult>(res);
}

export async function enableIbrForwardingNat(
	vrUuid: string,
	body: { wan_if?: string; use_wan_ip_as_pool?: boolean },
): Promise<IbrForwardingNatMutationResult> {
	const res = await apiPost(
		`/api/vr-instances/${encodeURIComponent(vrUuid)}/device/forwarding/nat/enable`,
		body,
	);
	return unwrapData<IbrForwardingNatMutationResult>(res);
}

export async function disableIbrForwardingNat(vrUuid: string): Promise<IbrForwardingNatMutationResult> {
	const res = await apiPost(
		`/api/vr-instances/${encodeURIComponent(vrUuid)}/device/forwarding/nat/disable`,
		{},
	);
	return unwrapData<IbrForwardingNatMutationResult>(res);
}

export async function toggleIbrForwardingNatUseWanIp(
	vrUuid: string,
	body: { enabled: boolean },
): Promise<IbrForwardingNatMutationResult> {
	const res = await apiPost(
		`/api/vr-instances/${encodeURIComponent(vrUuid)}/device/forwarding/nat/use-wan-ip`,
		body,
	);
	return unwrapData<IbrForwardingNatMutationResult>(res);
}

export async function fetchIbrForwardingNatEntries(
	vrUuid: string,
	options?: { skipCache?: boolean },
): Promise<IbrForwardingNatEntriesResult> {
	const res = await apiRequest(
		`/api/vr-instances/${encodeURIComponent(vrUuid)}/device/forwarding/nat/entries`,
		{ skipCache: options?.skipCache ?? true },
	);
	return unwrapData<IbrForwardingNatEntriesResult>(res);
}

export async function createIbrForwardingNatEntry(
	vrUuid: string,
	body: Record<string, unknown>,
): Promise<IbrForwardingNatMutationResult> {
	const res = await apiPost(
		`/api/vr-instances/${encodeURIComponent(vrUuid)}/device/forwarding/nat/entry`,
		body,
	);
	return unwrapData<IbrForwardingNatMutationResult>(res);
}

export async function deleteIbrForwardingNatEntry(
	vrUuid: string,
	entryId: string,
): Promise<IbrForwardingNatMutationResult> {
	const res = await apiDelete(
		`/api/vr-instances/${encodeURIComponent(vrUuid)}/device/forwarding/nat/entry/${encodeURIComponent(entryId)}`,
	);
	return unwrapData<IbrForwardingNatMutationResult>(res);
}

export type IbrForwardingIpsecChildSa = {
	name: string;
	status: string;
	in_bytes: number;
	in_packets: number;
	out_bytes: number;
	out_packets: number;
};

export type IbrForwardingIpsecSasConn = {
	name: string;
	status: string;
	local: string;
	remote: string;
	uptime: string;
	children: IbrForwardingIpsecChildSa[];
	source?: string;
	raw_lines?: string[];
};

export type IbrForwardingIpsecSasResult = {
	sas?: IbrForwardingIpsecSasConn[];
	raw?: string;
	error?: string;
	ok?: boolean;
	output?: string;
};

export type IbrForwardingIpsecMutationResult = {
	ok?: boolean;
	error?: string;
	output?: string;
};

export async function fetchIbrForwardingIpsecSas(
	vrUuid: string,
	options?: { skipCache?: boolean },
): Promise<IbrForwardingIpsecSasResult> {
	const res = await apiRequest(
		`/api/vr-instances/${encodeURIComponent(vrUuid)}/device/forwarding/ipsec/sas`,
		{ skipCache: options?.skipCache ?? true },
	);
	return unwrapData<IbrForwardingIpsecSasResult>(res);
}

export async function connectIbrForwardingIpsec(
	vrUuid: string,
	body: { ipsec_id: string },
): Promise<IbrForwardingIpsecMutationResult> {
	const res = await apiPost(
		`/api/vr-instances/${encodeURIComponent(vrUuid)}/device/forwarding/ipsec/connect`,
		body,
	);
	return unwrapData<IbrForwardingIpsecMutationResult>(res);
}

export async function disconnectIbrForwardingIpsec(
	vrUuid: string,
	body: { ipsec_id: string },
): Promise<IbrForwardingIpsecMutationResult> {
	const res = await apiPost(
		`/api/vr-instances/${encodeURIComponent(vrUuid)}/device/forwarding/ipsec/disconnect`,
		body,
	);
	return unwrapData<IbrForwardingIpsecMutationResult>(res);
}

export type IbrForwardingIpsecTunnelRow = {
	ID: string;
	ike_local_ip?: string;
	ike_remote_ip?: string;
	ike_dpd_delay?: number;
	ike_dpd_timeout?: number;
	ike_mode?: string;
	ike_proposal_local?: string;
	ike_proposal_remote?: { remote_id?: string; pre_shared_key?: string };
	traffic_selectors_local?: string;
	traffic_selectors_remote?: string;
	vrf_id?: string;
	sa_dpd_action?: string;
	sa_esp_proposals?: string;
	'sa-initiate'?: string | boolean;
	source?: 'local' | 'cloud' | 'both';
};

export type IbrForwardingIpsecTunnelsResult = {
	tunnels?: IbrForwardingIpsecTunnelRow[];
	raw?: string;
	error?: string;
};

export type IbrForwardingIpsecAutoreconnectConfig = {
	enabled: boolean;
	reconnect_enabled: boolean;
	interval: number;
	max_retries: number;
};

export type IbrForwardingIpsecReconnectLogRow = {
	time: string;
	tunnel_id: string;
	action: string;
	detail: string;
};

export type IbrForwardingIpsecReconnectLogsResult = {
	logs?: IbrForwardingIpsecReconnectLogRow[];
};

export async function fetchIbrForwardingIpsecTunnels(
	vrUuid: string,
	options?: { skipCache?: boolean },
): Promise<IbrForwardingIpsecTunnelsResult> {
	const res = await apiRequest(
		`/api/vr-instances/${encodeURIComponent(vrUuid)}/device/forwarding/ipsec/tunnels`,
		{ skipCache: options?.skipCache ?? true },
	);
	return unwrapData<IbrForwardingIpsecTunnelsResult>(res);
}

export async function applyIbrForwardingIpsecTunnel(
	vrUuid: string,
	body: IbrForwardingIpsecTunnelRow,
): Promise<IbrForwardingIpsecMutationResult> {
	const res = await apiPost(
		`/api/vr-instances/${encodeURIComponent(vrUuid)}/device/forwarding/ipsec/tunnels`,
		body,
	);
	return unwrapData<IbrForwardingIpsecMutationResult>(res);
}

export async function deleteIbrForwardingIpsecTunnel(
	vrUuid: string,
	tunnelId: string,
): Promise<IbrForwardingIpsecMutationResult> {
	const res = await apiDelete(
		`/api/vr-instances/${encodeURIComponent(vrUuid)}/device/forwarding/ipsec/tunnels/${encodeURIComponent(tunnelId)}`,
	);
	return unwrapData<IbrForwardingIpsecMutationResult>(res);
}

export async function fetchIbrForwardingIpsecAutoreconnect(
	vrUuid: string,
	options?: { skipCache?: boolean },
): Promise<IbrForwardingIpsecAutoreconnectConfig> {
	const res = await apiRequest(
		`/api/vr-instances/${encodeURIComponent(vrUuid)}/device/forwarding/ipsec/autoreconnect`,
		{ skipCache: options?.skipCache ?? true },
	);
	return unwrapData<IbrForwardingIpsecAutoreconnectConfig>(res);
}

export async function saveIbrForwardingIpsecAutoreconnect(
	vrUuid: string,
	body: Partial<IbrForwardingIpsecAutoreconnectConfig>,
): Promise<IbrForwardingIpsecAutoreconnectConfig & { ok?: boolean }> {
	const res = await apiPost(
		`/api/vr-instances/${encodeURIComponent(vrUuid)}/device/forwarding/ipsec/autoreconnect`,
		body,
	);
	return unwrapData<IbrForwardingIpsecAutoreconnectConfig & { ok?: boolean }>(res);
}

export async function fetchIbrForwardingIpsecReconnectLogs(
	vrUuid: string,
	options?: { skipCache?: boolean },
): Promise<IbrForwardingIpsecReconnectLogsResult> {
	const res = await apiRequest(
		`/api/vr-instances/${encodeURIComponent(vrUuid)}/device/forwarding/ipsec/reconnect-logs`,
		{ skipCache: options?.skipCache ?? true },
	);
	return unwrapData<IbrForwardingIpsecReconnectLogsResult>(res);
}
