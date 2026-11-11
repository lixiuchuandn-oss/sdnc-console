import type { IbrHaGroup, IbrHaGroupMember } from '../../../../services/ibrHaGroupApi';
import { readSideFromIntent, sideLabel } from '../ha-groups/haGroupWizardLib';

export type Srv6TunnelCeMode = '标准' | '高可用';

export type Srv6CeHaBinding = {
	haGroupId: string;
	haGroupName: string;
	primaryVrUuid: string;
	backupVrUuid: string;
	primaryName?: string | null;
	backupName?: string | null;
};

function haGroupMemberByRole(
	group: IbrHaGroup | null | undefined,
	role: IbrHaGroupMember['role'],
): IbrHaGroupMember | undefined {
	if (!group || !Array.isArray(group.members)) return undefined;
	return group.members.find((m) => m.role === role);
}

/** 可用于 SRv6 绑定的 HA 组：须含 primary + backup */
export function isSrv6EligibleHaGroup(group: IbrHaGroup | null | undefined): boolean {
	if (!group) return false;
	const primary = haGroupMemberByRole(group, 'primary');
	const backup = haGroupMemberByRole(group, 'backup');
	return Boolean(primary?.vrUuid?.trim() && backup?.vrUuid?.trim());
}

export function buildSrv6HaGroupSelectOptions(groups: IbrHaGroup[]): Array<{
	value: string;
	label: string;
	group: IbrHaGroup;
}> {
	return groups.filter(isSrv6EligibleHaGroup).map((group) => {
		const primary = haGroupMemberByRole(group, 'primary')!;
		const backup = haGroupMemberByRole(group, 'backup')!;
		const primaryLabel = primary.name || primary.vrUuid;
		const backupLabel = backup.name || backup.vrUuid;
		const statusTag = group.status === 'configured' ? '已配置' : '草稿';
		const side = readSideFromIntent(group.vrrpIntent);
		const sideTag = side ? ` · ${sideLabel(side)}` : '';
		return {
			value: group.id,
			label: `${group.name}${sideTag} · 主 ${primaryLabel} / 备 ${backupLabel}（${statusTag}）`,
			group,
		};
	});
}

export function resolveSrv6CeHaBinding(group: IbrHaGroup | null | undefined): Srv6CeHaBinding | null {
	if (!isSrv6EligibleHaGroup(group)) return null;
	const primary = haGroupMemberByRole(group, 'primary')!;
	const backup = haGroupMemberByRole(group, 'backup')!;
	return {
		haGroupId: group!.id,
		haGroupName: group!.name,
		primaryVrUuid: String(primary.vrUuid).trim(),
		backupVrUuid: String(backup.vrUuid).trim(),
		primaryName: primary.name,
		backupName: backup.name,
	};
}

export function resolveSrv6CeHaBindingById(
	groups: IbrHaGroup[],
	id: string,
): Srv6CeHaBinding | null {
	return resolveSrv6CeHaBinding(findHaGroupById(groups, id));
}

export function findHaGroupById(groups: IbrHaGroup[], id: string): IbrHaGroup | undefined {
	const key = String(id || '').trim();
	if (!key) return undefined;
	return groups.find((g) => g.id === key);
}
