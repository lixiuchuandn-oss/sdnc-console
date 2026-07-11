/** HA 组向导表单与 vrrpIntent 预览（参数口径待网络工程师核对） */

/** 仅 CE / 标准模式 IBR 可加入高可用组；PE 侧通过多链路/多通道承载，不做 HA 编组 */
export const HA_GROUP_ELIGIBLE_ROLES = ['CE', '标准'] as const;

export type HaGroupEligibleRole = (typeof HA_GROUP_ELIGIBLE_ROLES)[number];

const PE_LIKE_ROLES = new Set(['PE', 'SPOKE_PE', 'HUB_PE']);

export function normalizeIbrVrRole(raw: unknown): string {
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
	'高可用组仅支持 CE 与标准模式 IBR。PE（含 Spoke/Hub）本身支持多链路，请通过 SRv6/IPsec 等多通道让 CE 高可用组一对多接入 PE，无需将 PE 编入 HA 组。';

export type HaGroupWizardFormValues = {
	name: string;
	description?: string;
	primaryUuid: string;
	backupUuid: string;
	vrid: number;
	virtualIp: string;
	trackInterface: string;
	advertInterval: number;
	authPass?: string;
	preempt: boolean;
	primaryPriority: number;
	backupPriority: number;
	primaryInterface?: string;
	backupInterface?: string;
};

export type HaGroupVrrpIntent = {
	vrid: number;
	virtual_ip: string;
	track_interface: string;
	advert_interval: number;
	auth_pass?: string;
	preempt: boolean;
	members: {
		role: 'primary' | 'backup';
		vr_uuid: string;
		priority: number;
		interface?: string;
	}[];
};

export const HA_GROUP_WIZARD_DEFAULTS: Partial<HaGroupWizardFormValues> = {
	vrid: 1,
	virtualIp: '192.168.1.254',
	trackInterface: 'GigabitEthernet0/0/0',
	advertInterval: 1,
	preempt: true,
	primaryPriority: 200,
	backupPriority: 100,
	primaryInterface: 'GigabitEthernet0/0/0',
	backupInterface: 'GigabitEthernet0/0/0',
};

export function buildHaGroupVrrpIntent(values: HaGroupWizardFormValues): HaGroupVrrpIntent {
	const primaryUuid = String(values.primaryUuid || '').trim();
	const backupUuid = String(values.backupUuid || '').trim();
	return {
		vrid: Number(values.vrid) || 1,
		virtual_ip: String(values.virtualIp || '').trim(),
		track_interface: String(values.trackInterface || '').trim(),
		advert_interval: Number(values.advertInterval) || 1,
		auth_pass: String(values.authPass || '').trim() || undefined,
		preempt: values.preempt !== false,
		members: [
			{
				role: 'primary',
				vr_uuid: primaryUuid,
				priority: Number(values.primaryPriority) || 200,
				interface: String(values.primaryInterface || '').trim() || undefined,
			},
			{
				role: 'backup',
				vr_uuid: backupUuid,
				priority: Number(values.backupPriority) || 100,
				interface: String(values.backupInterface || '').trim() || undefined,
			},
		],
	};
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
	return {
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
		primaryUuid: String(primary?.vr_uuid ?? primary?.vrUuid ?? fallback.primaryUuid).trim() || undefined,
		backupUuid: String(backup?.vr_uuid ?? backup?.vrUuid ?? fallback.backupUuid).trim() || undefined,
	};
}
