/**
 * IBR HA 组向导：一组 = 本端或对端的主备两台；按节点分别配置 VRRP 实例与组策略。
 */

import { looksLikeIfaceName } from '../routers/vrMergedHelpers';

export const HA_GROUP_ELIGIBLE_ROLES = ['CE', '标准'] as const;

export type HaGroupSide = 'local' | 'peer';

export type HaVrrpAdvertMode = 'multicast' | 'unicast';

export const HA_GROUP_SCHEME = 'srv6-segment-list-vrrp' as const;

export const HA_SIDE_OPTIONS: Array<{
	value: HaGroupSide;
	label: string;
	hint: string;
}> = [
	{
		value: 'local',
		label: '本端 HA 组',
		hint: '与 SRv6 隧道「本端」绑定的一组主备 CE / 标准模式 IBR。两端对等，对端请另开一次向导。',
	},
	{
		value: 'peer',
		label: '对端 HA 组',
		hint: '与 SRv6 隧道「对端」绑定的一组主备 CE / 标准模式 IBR。两端对等，本端请另开一次向导。',
	},
];

const PE_LIKE_ROLES = new Set(['PE', 'SPOKE_PE', 'HUB_PE']);

const IPV4_HOST_RE =
	/^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;

const IPV4_OPTIONAL_CIDR_RE =
	/^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\/(?:[0-9]|[1-2][0-9]|3[0-2]))?$/;

function normalizeIbrVrRole(raw: unknown): string {
	return String(raw ?? '').trim();
}

export function isPeLikeIbrRole(role: unknown): boolean {
	const normalized = normalizeIbrVrRole(role).toUpperCase();
	return PE_LIKE_ROLES.has(normalized);
}

export function isHaGroupEligibleIbrRole(role: unknown): boolean {
	const normalized = normalizeIbrVrRole(role);
	return (HA_GROUP_ELIGIBLE_ROLES as readonly string[]).includes(normalized);
}

export function haGroupEligibleRoleLabel(role: unknown): string {
	const normalized = normalizeIbrVrRole(role);
	if (normalized === 'CE') return 'CE';
	if (normalized === '标准') return '标准模式';
	return normalized || '未设置';
}

export const HA_GROUP_MEMBER_SCOPE_HINT =
	'高可用组仅支持 CE 与标准模式 IBR。一次向导配置一组（本端或对端）的主备两台；PE 不编入本组。';

export type HaVrrpInstanceForm = {
	interface?: string;
	vrid: number;
	virtualIp: string;
	priority: number;
	authPass?: string;
	preempt: boolean;
	/** 通告间隔秒，设备 CLI `advert_int`，范围 1–256 */
	advertInterval: number;
	advertMode: HaVrrpAdvertMode;
	unicastSource?: string;
	unicastPeer?: string;
};

export type HaVrrpGroupForm = {
	groupId: number;
	vrrpInstanceId: number;
	trackGateway?: string;
	trackInterval: number;
};

export type HaNodeVrrpForm = {
	instances: HaVrrpInstanceForm[];
	groups: HaVrrpGroupForm[];
};

export type HaGroupWizardFormValues = {
	name: string;
	description?: string;
	side: HaGroupSide;
	primaryUuid: string;
	backupUuid: string;
	primary: HaNodeVrrpForm;
	backup: HaNodeVrrpForm;
};

export type HaGroupVrrpInstanceIntent = {
	interface: string;
	vrid: number;
	virtual_ip: string;
	priority: number;
	auth_pass?: string;
	preempt: boolean;
	advert_interval: number;
	advert_mode: HaVrrpAdvertMode;
	unicast_peer?: string;
	unicast_source?: string;
};

export type HaGroupVrrpGroupIntent = {
	group_id: number;
	vrrp_instance: number;
	track_gateway?: string;
	track_interval?: number;
};

export type HaGroupVrrpMemberIntent = {
	role: 'primary' | 'backup';
	vr_uuid: string;
	instances: HaGroupVrrpInstanceIntent[];
	groups: HaGroupVrrpGroupIntent[];
};

export type HaGroupVrrpIntent = {
	scheme: typeof HA_GROUP_SCHEME;
	side: HaGroupSide;
	members: HaGroupVrrpMemberIntent[];
};

export function createDefaultInstance(priority: number, vrid = 1): HaVrrpInstanceForm {
	return {
		interface: '',
		vrid,
		virtualIp: '',
		priority,
		authPass: '',
		preempt: true,
		advertInterval: 1,
		advertMode: 'multicast',
		unicastSource: '',
		unicastPeer: '',
	};
}

export function createDefaultGroup(groupId = 1, vrrpInstanceId = 1): HaVrrpGroupForm {
	return {
		groupId,
		vrrpInstanceId,
		trackGateway: '',
		trackInterval: 1,
	};
}

export function createDefaultNodeVrrp(role: 'primary' | 'backup'): HaNodeVrrpForm {
	const priority = role === 'primary' ? 200 : 100;
	return {
		instances: [createDefaultInstance(priority, 1)],
		groups: [createDefaultGroup(1, 1)],
	};
}

export const HA_GROUP_WIZARD_DEFAULTS: Partial<HaGroupWizardFormValues> = {
	side: 'local',
	primary: createDefaultNodeVrrp('primary'),
	backup: createDefaultNodeVrrp('backup'),
};

const SIDE_NAME_ABBR: Record<HaGroupSide, string> = {
	local: 'loc',
	peer: 'peer',
};

const HA_GROUP_NAME_ID = 'ha';
const AUTO_NAME_RE = /^ha-(acc|egr|loc|peer)-[a-z0-9]{11}$/;

function randomAlphanumeric(length: number): string {
	const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
	const bytes = new Uint8Array(length);
	if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
		crypto.getRandomValues(bytes);
		return Array.from(bytes, (b) => chars[b % chars.length]).join('');
	}
	return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export function normalizeHaGroupSide(raw: unknown): HaGroupSide {
	const t = String(raw ?? '').trim();
	if (t === 'peer' || t === 'egress') return 'peer';
	return 'local';
}

export function sideLabel(side: HaGroupSide | string | undefined): string {
	const normalized = normalizeHaGroupSide(side);
	return HA_SIDE_OPTIONS.find((o) => o.value === normalized)?.label ?? '本端 HA 组';
}

/** @deprecated 使用 sideLabel；兼容旧 placement 字段 */
export function placementLabel(placement: string | undefined): string {
	return sideLabel(placement);
}

export function isAutoHaGroupName(name: string | undefined): boolean {
	return AUTO_NAME_RE.test(String(name || '').trim());
}

/** 自动生成 HA 组名称：ha-loc-xxxxxxxxxxx / ha-peer-xxxxxxxxxxx */
export function generateHaGroupName(side: HaGroupSide = 'local'): string {
	const abbr = SIDE_NAME_ABBR[normalizeHaGroupSide(side)];
	return `${HA_GROUP_NAME_ID}-${abbr}-${randomAlphanumeric(11)}`;
}

export function ipv4HostFromCidr(raw: unknown): string {
	const t = String(raw ?? '').trim();
	if (!t) return '';
	return t.split('/')[0]?.trim() || '';
}

function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

function readPositiveInt(raw: unknown, fallback: number): number {
	const n = typeof raw === 'number' ? raw : Number(raw);
	return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
}

function asBool(raw: unknown, defaultTrue = true): boolean {
	if (raw === false || raw === 'false' || raw === 0 || raw === '0') return false;
	if (raw === true || raw === 'true' || raw === 1 || raw === '1') return true;
	return defaultTrue;
}

function parseInstanceForm(raw: unknown, fallbackPriority: number): HaVrrpInstanceForm | null {
	const row = asRecord(raw);
	if (!row) return null;
	const advert =
		String(row.advert_mode ?? row.advertMode ?? '').trim() === 'unicast' ? 'unicast' : 'multicast';
	const unicastSource = String(row.unicast_source ?? row.unicastSource ?? '').trim();
	const unicastPeer = String(row.unicast_peer ?? row.unicastPeer ?? '').trim();
	return {
		interface: String(row.interface ?? '').trim(),
		vrid: readPositiveInt(row.vrid, 1),
		virtualIp: String(row.virtual_ip ?? row.virtualIp ?? '').trim(),
		priority: readPositiveInt(row.priority, fallbackPriority),
		authPass: String(row.auth_pass ?? row.authPass ?? '').trim(),
		preempt: asBool(row.preempt, true),
		advertInterval: readPositiveInt(row.advert_interval ?? row.advertInterval, 1),
		advertMode: advert === 'unicast' || (unicastSource && unicastPeer) ? 'unicast' : 'multicast',
		unicastSource,
		unicastPeer,
	};
}

function parseGroupForm(raw: unknown): HaVrrpGroupForm | null {
	const row = asRecord(raw);
	if (!row) return null;
	const vrrpInstance = readPositiveInt(row.vrrp_instance ?? row.vrrpInstanceId ?? row.vrid, 0);
	const groupId = readPositiveInt(row.group_id ?? row.groupId, 0);
	if (!groupId || !vrrpInstance) return null;
	const gateways = Array.isArray(row.track_gateway) ? row.track_gateway : null;
	const trackGateway = gateways
		? String(gateways[0] ?? '').trim()
		: String(row.track_gateway ?? row.trackGateway ?? '').trim();
	return {
		groupId,
		vrrpInstanceId: vrrpInstance,
		trackGateway,
		trackInterval: readPositiveInt(row.track_interval ?? row.trackInterval, 1),
	};
}

function parseNodeFromMember(
	member: Record<string, unknown> | undefined,
	role: 'primary' | 'backup',
	legacyTop?: Record<string, unknown>,
): HaNodeVrrpForm {
	const fallbackPriority = role === 'primary' ? 200 : 100;
	const instancesRaw = Array.isArray(member?.instances) ? member!.instances : [];
	const groupsRaw = Array.isArray(member?.groups) ? member!.groups : [];
	const instances = instancesRaw
		.map((item) => parseInstanceForm(item, fallbackPriority))
		.filter((item): item is HaVrrpInstanceForm => Boolean(item));
	const groups = groupsRaw
		.map((item) => parseGroupForm(item))
		.filter((item): item is HaVrrpGroupForm => Boolean(item));

	if (instances.length > 0) {
		return {
			instances,
			groups: groups.length > 0 ? groups : [createDefaultGroup(instances[0]!.vrid, instances[0]!.vrid)],
		};
	}

	if (!member) return createDefaultNodeVrrp(role);

	const unicastSource = String(member.unicast_source ?? member.unicastSource ?? '').trim();
	const unicastPeer = String(member.unicast_peer ?? member.unicastPeer ?? '').trim();
	const vrid = readPositiveInt(legacyTop?.vrid, 1);
	const virtualIp = String(legacyTop?.virtual_ip ?? legacyTop?.virtualIp ?? '').trim();
	const authPass = String(legacyTop?.auth_pass ?? legacyTop?.authPass ?? '').trim();
	return {
		instances: [
			{
				interface: String(member.interface ?? '').trim(),
				vrid,
				virtualIp,
				priority: readPositiveInt(member.priority, fallbackPriority),
				authPass,
				preempt: asBool(legacyTop?.preempt, true),
				advertInterval: readPositiveInt(legacyTop?.advert_interval ?? legacyTop?.advertInterval, 1),
				advertMode: unicastSource && unicastPeer ? 'unicast' : 'multicast',
				unicastSource,
				unicastPeer,
			},
		],
		groups: [
			{
				groupId: vrid,
				vrrpInstanceId: vrid,
				trackGateway: String(member.track_gateway ?? member.trackGateway ?? '').trim(),
				trackInterval: 1,
			},
		],
	};
}

function buildInstanceIntent(form: HaVrrpInstanceForm): HaGroupVrrpInstanceIntent {
	const advertMode: HaVrrpAdvertMode = form.advertMode === 'unicast' ? 'unicast' : 'multicast';
	const unicastSource = String(form.unicastSource || '').trim();
	const unicastPeer = String(form.unicastPeer || '').trim();
	const auth = String(form.authPass || '').trim();
	return {
		interface: String(form.interface || '').trim(),
		vrid: Number(form.vrid) || 1,
		virtual_ip: String(form.virtualIp || '').trim(),
		priority: Number(form.priority) || 100,
		preempt: asBool(form.preempt, true),
		advert_interval: (() => {
			const n = Number(form.advertInterval);
			return Number.isFinite(n) && n >= 1 ? Math.trunc(n) : 1;
		})(),
		advert_mode: advertMode,
		...(auth ? { auth_pass: auth } : {}),
		...(advertMode === 'unicast' && unicastSource && unicastPeer
			? { unicast_source: unicastSource, unicast_peer: unicastPeer }
			: {}),
	};
}

function buildGroupIntent(form: HaVrrpGroupForm): HaGroupVrrpGroupIntent {
	const track = String(form.trackGateway || '').trim();
	const interval = Number(form.trackInterval);
	return {
		group_id: Number(form.groupId) || 1,
		vrrp_instance: Number(form.vrrpInstanceId) || 1,
		...(track ? { track_gateway: track } : {}),
		track_interval: Number.isFinite(interval) && interval >= 1 ? Math.trunc(interval) : 1,
	};
}

function nodeOrDefault(
	node: HaNodeVrrpForm | undefined,
	role: 'primary' | 'backup',
): HaNodeVrrpForm {
	if (node && Array.isArray(node.instances) && node.instances.length > 0) return node;
	return createDefaultNodeVrrp(role);
}

export function buildHaGroupVrrpIntent(values: HaGroupWizardFormValues): HaGroupVrrpIntent {
	const primary = nodeOrDefault(values.primary, 'primary');
	const backup = nodeOrDefault(values.backup, 'backup');
	return {
		scheme: HA_GROUP_SCHEME,
		side: normalizeHaGroupSide(values.side),
		members: [
			{
				role: 'primary',
				vr_uuid: String(values.primaryUuid || '').trim(),
				instances: primary.instances.map(buildInstanceIntent),
				groups: (primary.groups || []).map(buildGroupIntent),
			},
			{
				role: 'backup',
				vr_uuid: String(values.backupUuid || '').trim(),
				instances: backup.instances.map(buildInstanceIntent),
				groups: (backup.groups || []).map(buildGroupIntent),
			},
		],
	};
}

function roleLabel(role: 'primary' | 'backup'): string {
	return role === 'primary' ? '主节点' : '备节点';
}

function validateNodeVrrp(node: HaNodeVrrpForm | undefined, role: 'primary' | 'backup'): string | null {
	const prefix = roleLabel(role);
	const instances = node?.instances || [];
	if (instances.length < 1) return `${prefix}至少配置 1 条 VRRP 实例`;
	const vrids = new Set<number>();
	for (let i = 0; i < instances.length; i += 1) {
		const inst = instances[i]!;
		const n = i + 1;
		const vrid = Number(inst.vrid);
		if (!Number.isInteger(vrid) || vrid < 1 || vrid > 255) {
			return `${prefix}实例 ${n}：VRRP ID 须为 1–255 的整数`;
		}
		if (vrids.has(vrid)) return `${prefix}实例 VRRP ID ${vrid} 重复`;
		vrids.add(vrid);
		if (!String(inst.interface || '').trim()) {
			return `${prefix}实例 ${n}：请选择绑定接口`;
		}
		const vip = String(inst.virtualIp || '').trim();
		if (!vip || !IPV4_OPTIONAL_CIDR_RE.test(vip)) {
			return `${prefix}实例 ${n}：VRRP IP 须为合法 IPv4 或 IPv4/CIDR`;
		}
		const pri = Number(inst.priority);
		if (!Number.isInteger(pri) || pri < 1 || pri > 255) {
			return `${prefix}实例 ${n}：优先级须为 1–255 的整数`;
		}
		const advertInterval = Number(inst.advertInterval ?? 1);
		if (!Number.isInteger(advertInterval) || advertInterval < 1 || advertInterval > 256) {
			return `${prefix}实例 ${n}：通告间隔须为 1–256 秒`;
		}
		if (inst.advertMode === 'unicast') {
			const source = String(inst.unicastSource || '').trim();
			const peer = String(inst.unicastPeer || '').trim();
			if (!source || !peer) {
				return `${prefix}实例 ${n}：单播须填写源 IP 与对端地址`;
			}
			if (!IPV4_HOST_RE.test(source) || source.includes('/')) {
				return `${prefix}实例 ${n}：单播源 IP 须为无掩码 IPv4`;
			}
			if (!IPV4_HOST_RE.test(peer) || peer.includes('/')) {
				return `${prefix}实例 ${n}：单播对端地址须为无掩码 IPv4`;
			}
			if (source === peer) {
				return `${prefix}实例 ${n}：单播源 IP 与对端地址不能相同`;
			}
		}
	}

	const groups = node?.groups || [];
	if (groups.length < 1) return `${prefix}至少配置 1 条 VRRP 组策略`;
	const groupIds = new Set<number>();
	for (let i = 0; i < groups.length; i += 1) {
		const group = groups[i]!;
		const n = i + 1;
		const gid = Number(group.groupId);
		if (!Number.isInteger(gid) || gid < 1) {
			return `${prefix}组策略 ${n}：Group ID 须为正整数`;
		}
		if (groupIds.has(gid)) return `${prefix}组策略 Group ID ${gid} 重复`;
		groupIds.add(gid);
		const instId = Number(group.vrrpInstanceId);
		if (!vrids.has(instId)) {
			return `${prefix}组策略 ${n}：VRRP 实例 ID 须指向本节点已配置的实例`;
		}
		const interval = Number(group.trackInterval ?? 1);
		if (!Number.isInteger(interval) || interval < 1 || interval > 255) {
			return `${prefix}组策略 ${n}：探测间隔须为 1–255 秒`;
		}
		const track = String(group.trackGateway || '').trim();
		if (/^\d+\.\d+\.\d+\.\d+\//.test(track)) {
			return `${prefix}组策略 ${n}：Track 地址不可携带掩码`;
		}
		if (/^\d+\.\d+\.\d+\.\d+$/.test(track) && !IPV4_HOST_RE.test(track)) {
			return `${prefix}组策略 ${n}：Track 网关 IPv4 不合法`;
		}
	}
	return null;
}

export function validateHaGroupWizardForm(values: HaGroupWizardFormValues): string | null {
	if (!values.primaryUuid?.trim() || !values.backupUuid?.trim()) {
		return '请选择主备节点';
	}
	if (values.primaryUuid === values.backupUuid) {
		return '主备不能为同一实例';
	}
	const primaryErr = validateNodeVrrp(values.primary, 'primary');
	if (primaryErr) return primaryErr;
	const backupErr = validateNodeVrrp(values.backup, 'backup');
	if (backupErr) return backupErr;

	const primaryByVrid = new Map(
		(values.primary?.instances || []).map((inst) => [Number(inst.vrid), inst] as const),
	);
	for (const backupInst of values.backup?.instances || []) {
		const matched = primaryByVrid.get(Number(backupInst.vrid));
		if (!matched) continue;
		if (Number(matched.priority) <= Number(backupInst.priority)) {
			return `VRRP ID ${backupInst.vrid}：主节点优先级须高于备节点`;
		}
	}
	return null;
}

export function parseVrrpIntentToForm(
	intent: unknown,
	fallback: { primaryUuid: string; backupUuid: string },
): Partial<HaGroupWizardFormValues> {
	if (!intent || typeof intent !== 'object') return {};
	const row = intent as Record<string, unknown>;
	const members = Array.isArray(row.members) ? row.members : [];
	const primary = members.find((m) => asRecord(m)?.role === 'primary') as Record<string, unknown> | undefined;
	const backup = members.find((m) => asRecord(m)?.role === 'backup') as Record<string, unknown> | undefined;
	return {
		side: normalizeHaGroupSide(row.side ?? row.placement),
		primary: parseNodeFromMember(primary, 'primary', row),
		backup: parseNodeFromMember(backup, 'backup', row),
		primaryUuid: String(primary?.vr_uuid ?? primary?.vrUuid ?? fallback.primaryUuid).trim() || undefined,
		backupUuid: String(backup?.vr_uuid ?? backup?.vrUuid ?? fallback.backupUuid).trim() || undefined,
	};
}

export function readSideFromIntent(intent: unknown): HaGroupSide | null {
	if (!intent || typeof intent !== 'object') return null;
	const row = intent as Record<string, unknown>;
	const raw = String(row.side ?? row.placement ?? '').trim();
	if (raw === 'local' || raw === 'access' || raw === 'peer' || raw === 'egress') {
		return normalizeHaGroupSide(raw);
	}
	return null;
}

/** @deprecated 使用 readSideFromIntent */
export function readPlacementFromIntent(intent: unknown): HaGroupSide | null {
	return readSideFromIntent(intent);
}

export type HaDeviceIface = {
	name: string;
	ipv4?: string;
};

function readIfaceName(row: unknown): string {
	if (typeof row === 'string') return row.trim();
	const rec = asRecord(row);
	if (!rec) return '';
	for (const key of ['name', 'iface', 'ifName', 'interface', 'devName']) {
		const n = String(rec[key] ?? '').trim();
		if (n) return n;
	}
	return '';
}

function readIfaceIpv4(row: unknown): string {
	const rec = asRecord(row);
	if (!rec) return '';
	for (const key of ['ipv4_static', 'ipv4Static', 'ipv4', 'ipv4_address', 'ipv4Address']) {
		const host = ipv4HostFromCidr(rec[key]);
		if (host && IPV4_HOST_RE.test(host)) return host;
	}
	return '';
}

function collectIfacesFromBlob(dev: unknown, into: Map<string, HaDeviceIface>): void {
	const rec = asRecord(dev);
	if (!rec) return;
	const nested = asRecord(rec.data);
	const roots = [rec, nested].filter(Boolean) as Record<string, unknown>[];
	const pushRow = (row: unknown) => {
		const name = readIfaceName(row);
		if (!name || !looksLikeIfaceName(name)) return;
		const ipv4 = readIfaceIpv4(row);
		const prev = into.get(name);
		if (!prev) {
			into.set(name, { name, ipv4: ipv4 || undefined });
			return;
		}
		if (!prev.ipv4 && ipv4) into.set(name, { name, ipv4 });
	};
	for (const root of roots) {
		if (Array.isArray(root.interface)) root.interface.forEach(pushRow);
		if (Array.isArray(root.interfaces)) root.interfaces.forEach(pushRow);
		for (const key of Object.keys(root)) {
			if (
				(key.startsWith('interfaces_') || key.startsWith('subinterfaces_')) &&
				Array.isArray(root[key])
			) {
				(root[key] as unknown[]).forEach(pushRow);
			}
		}
	}
}

/** 从 VR 聚合缓存提取接口名与 IPv4（vr2 优先，vr3 / 平台底稿兜底） */
export function collectHaDeviceIfaces(merged: unknown, baseline?: unknown): HaDeviceIface[] {
	const map = new Map<string, HaDeviceIface>();
	const rec = asRecord(merged);
	if (rec) {
		collectIfacesFromBlob(rec.vr2_info, map);
		collectIfacesFromBlob(rec.vr3_info, map);
		collectIfacesFromBlob(rec, map);
	}
	collectIfacesFromBlob(baseline, map);
	return Array.from(map.values());
}

export function lookupIfaceIpv4(ifaces: HaDeviceIface[] | undefined, ifaceName: string): string {
	const key = String(ifaceName || '').trim().toLowerCase().replace(/\s+/g, ' ');
	if (!key) return '';
	const hit = (ifaces || []).find(
		(item) => item.name.trim().toLowerCase().replace(/\s+/g, ' ') === key,
	);
	return hit?.ipv4 || '';
}

export function nextInstanceVrid(instances: HaVrrpInstanceForm[] | undefined): number {
	const used = new Set((instances || []).map((item) => Number(item.vrid) || 0));
	for (let id = 1; id <= 255; id += 1) {
		if (!used.has(id)) return id;
	}
	return 1;
}

export function nextGroupId(groups: HaVrrpGroupForm[] | undefined): number {
	const used = (groups || []).map((item) => Number(item.groupId) || 0);
	return Math.max(0, ...used) + 1;
}

export function suggestUnicastEndpoints(args: {
	thisIpv4?: string;
	peerIpv4?: string;
}): { unicastSource?: string; unicastPeer?: string } {
	const source = String(args.thisIpv4 || '').trim();
	const peer = String(args.peerIpv4 || '').trim();
	return {
		...(source ? { unicastSource: source } : {}),
		...(peer ? { unicastPeer: peer } : {}),
	};
}

export function matchPeerInstance(
	peerInstances: HaVrrpInstanceForm[] | undefined,
	index: number,
	vrid: number,
): HaVrrpInstanceForm | undefined {
	const list = peerInstances || [];
	if (list[index]) return list[index];
	return list.find((item) => Number(item.vrid) === Number(vrid));
}
