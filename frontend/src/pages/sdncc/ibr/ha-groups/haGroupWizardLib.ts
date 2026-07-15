/**
 * IBR HA 组向导：方案二（VRRP 边缘主备 + PE 侧 SRv6 segment list 选路）。
 * 参考 docs/网际路由SRV6 高可用方案.docx
 */

/** 仅 CE / 标准模式 IBR 可加入高可用组；PE 侧通过多链路/多通道承载，不做 HA 编组 */
export const HA_GROUP_ELIGIBLE_ROLES = ['CE', '标准'] as const;

export type HaGroupVrrpPlacement = 'access' | 'egress';

export const HA_GROUP_SCHEME = 'srv6-segment-list-vrrp' as const;

export const HA_PLACEMENT_OPTIONS: Array<{
	value: HaGroupVrrpPlacement;
	label: string;
	hint: string;
}> = [
	{
		value: 'access',
		label: '接入侧（Access）',
		hint: '对应测试组网 SR1/SR5：Client 进入 SRv6 域的第一跳 CE 对；主 track 主路径上游 PE 接口/地址，备 track 备路径上游。',
	},
	{
		value: 'egress',
		label: '落地侧（Egress）',
		hint: '对应测试组网 SR4/SR8：到达目标 Client 前的最后一跳 CE 对；主备分别 track 各自上游 PE 接口/地址。',
	},
];

const PE_LIKE_ROLES = new Set(['PE', 'SPOKE_PE', 'HUB_PE']);

const IPV4_RE =
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
	'高可用组仅支持 CE 与标准模式 IBR。PE（含 Spoke/Hub）通过 SRv6 多通道承载；中间链路故障由 segment list 重选，不由本组 VRRP 联动。';

export type HaGroupWizardFormValues = {
	name: string;
	description?: string;
	placement: HaGroupVrrpPlacement;
	primaryUuid: string;
	backupUuid: string;
	vrid: number;
	virtualIp: string;
	trackInterface?: string;
	advertInterval: number;
	authPass?: string;
	preempt: boolean;
	primaryPriority: number;
	backupPriority: number;
	primaryInterface: string;
	backupInterface: string;
	primaryTrackGateway: string;
	backupTrackGateway: string;
};

type HaGroupVrrpMemberIntent = {
	role: 'primary' | 'backup';
	vr_uuid: string;
	priority: number;
	interface?: string;
	track_gateway?: string;
};

export type HaGroupVrrpIntent = {
	scheme: typeof HA_GROUP_SCHEME;
	placement: HaGroupVrrpPlacement;
	vrid: number;
	virtual_ip: string;
	track_interface?: string;
	advert_interval: number;
	auth_pass?: string;
	preempt: boolean;
	members: HaGroupVrrpMemberIntent[];
};

export const HA_GROUP_WIZARD_DEFAULTS: Partial<HaGroupWizardFormValues> = {
	placement: 'access',
	vrid: 1,
	virtualIp: '192.168.1.254',
	trackInterface: '',
	advertInterval: 1,
	preempt: true,
	primaryPriority: 200,
	backupPriority: 100,
	primaryInterface: 'GigabitEthernet2/1/0',
	backupInterface: 'GigabitEthernet2/1/0',
	primaryTrackGateway: '',
	backupTrackGateway: '',
};

const PLACEMENT_NAME_ABBR: Record<HaGroupVrrpPlacement, string> = {
	access: 'acc',
	egress: 'egr',
};

const HA_GROUP_NAME_ID = 'ha';

function randomAlphanumeric(length: number): string {
	const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
	const bytes = new Uint8Array(length);
	if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
		crypto.getRandomValues(bytes);
		return Array.from(bytes, (b) => chars[b % chars.length]).join('');
	}
	return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export function placementLabel(placement: HaGroupVrrpPlacement | string | undefined): string {
	const hit = HA_PLACEMENT_OPTIONS.find((o) => o.value === placement);
	return hit?.label ?? String(placement || '—');
}

/** 自动生成 HA 组名称：id-缩写-11位，例如 ha-acc-k3m9x2p7q1w */
export function generateHaGroupName(placement: HaGroupVrrpPlacement = 'access'): string {
	const abbr = PLACEMENT_NAME_ABBR[placement === 'egress' ? 'egress' : 'access'];
	return `${HA_GROUP_NAME_ID}-${abbr}-${randomAlphanumeric(11)}`;
}

export function buildHaGroupVrrpIntent(values: HaGroupWizardFormValues): HaGroupVrrpIntent {
	const primaryUuid = String(values.primaryUuid || '').trim();
	const backupUuid = String(values.backupUuid || '').trim();
	const trackIface = String(values.trackInterface || '').trim();
	return {
		scheme: HA_GROUP_SCHEME,
		placement: values.placement === 'egress' ? 'egress' : 'access',
		vrid: Number(values.vrid) || 1,
		virtual_ip: String(values.virtualIp || '').trim(),
		...(trackIface ? { track_interface: trackIface } : {}),
		advert_interval: Number(values.advertInterval) || 1,
		auth_pass: String(values.authPass || '').trim() || undefined,
		preempt: values.preempt !== false,
		members: [
			{
				role: 'primary',
				vr_uuid: primaryUuid,
				priority: Number(values.primaryPriority) || 200,
				interface: String(values.primaryInterface || '').trim() || undefined,
				track_gateway: String(values.primaryTrackGateway || '').trim() || undefined,
			},
			{
				role: 'backup',
				vr_uuid: backupUuid,
				priority: Number(values.backupPriority) || 100,
				interface: String(values.backupInterface || '').trim() || undefined,
				track_gateway: String(values.backupTrackGateway || '').trim() || undefined,
			},
		],
	};
}

export function validateHaGroupWizardForm(values: HaGroupWizardFormValues): string | null {
	if (!values.primaryUuid?.trim() || !values.backupUuid?.trim()) {
		return '请选择主备成员';
	}
	if (values.primaryUuid === values.backupUuid) {
		return '主备不能为同一实例';
	}
	if (!Number.isInteger(Number(values.vrid)) || Number(values.vrid) < 1 || Number(values.vrid) > 255) {
		return 'VRID 须为 1–255 的整数';
	}
	const vip = String(values.virtualIp || '').trim();
	if (!vip || !IPV4_RE.test(vip.split('/')[0] ?? '')) {
		return '虚拟 IP 须为合法 IPv4 或 IPv4/CIDR';
	}
	if (Number(values.primaryPriority) <= Number(values.backupPriority)) {
		return '主节点优先级须高于备节点';
	}
	if (!String(values.primaryInterface || '').trim()) {
		return '请填写主节点 VRRP 绑定接口';
	}
	if (!String(values.backupInterface || '').trim()) {
		return '请填写备节点 VRRP 绑定接口';
	}
	if (!String(values.primaryTrackGateway || '').trim()) {
		return '请填写主节点 track-gateway（上游 PE 接口或网关地址）';
	}
	if (!String(values.backupTrackGateway || '').trim()) {
		return '请填写备节点 track-gateway（上游 PE 接口或网关地址）';
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
	const primary = members.find((m) => m && typeof m === 'object' && (m as { role?: string }).role === 'primary') as
		| Record<string, unknown>
		| undefined;
	const backup = members.find((m) => m && typeof m === 'object' && (m as { role?: string }).role === 'backup') as
		| Record<string, unknown>
		| undefined;
	const placementRaw = String(row.placement ?? '').trim();
	return {
		placement: placementRaw === 'egress' ? 'egress' : 'access',
		vrid: typeof row.vrid === 'number' ? row.vrid : Number(row.vrid) || undefined,
		virtualIp: String(row.virtual_ip ?? row.virtualIp ?? '').trim() || undefined,
		trackInterface: String(row.track_interface ?? row.trackInterface ?? '').trim() || undefined,
		advertInterval:
			typeof row.advert_interval === 'number'
				? row.advert_interval
				: Number(row.advert_interval ?? row.advertInterval) || undefined,
		authPass: String(row.auth_pass ?? row.authPass ?? '').trim() || undefined,
		preempt: row.preempt !== false,
		primaryPriority:
			typeof primary?.priority === 'number' ? primary.priority : Number(primary?.priority) || undefined,
		backupPriority:
			typeof backup?.priority === 'number' ? backup.priority : Number(backup?.priority) || undefined,
		primaryInterface: String(primary?.interface ?? '').trim() || undefined,
		backupInterface: String(backup?.interface ?? '').trim() || undefined,
		primaryTrackGateway:
			String(primary?.track_gateway ?? primary?.trackGateway ?? '').trim() || undefined,
		backupTrackGateway: String(backup?.track_gateway ?? backup?.trackGateway ?? '').trim() || undefined,
		primaryUuid: String(primary?.vr_uuid ?? primary?.vrUuid ?? fallback.primaryUuid).trim() || undefined,
		backupUuid: String(backup?.vr_uuid ?? backup?.vrUuid ?? fallback.backupUuid).trim() || undefined,
	};
}

export function readPlacementFromIntent(intent: unknown): HaGroupVrrpPlacement | null {
	if (!intent || typeof intent !== 'object') return null;
	const p = String((intent as Record<string, unknown>).placement ?? '').trim();
	if (p === 'access' || p === 'egress') return p;
	return null;
}
