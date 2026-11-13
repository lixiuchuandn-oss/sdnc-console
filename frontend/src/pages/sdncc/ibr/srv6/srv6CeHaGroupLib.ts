import type { IbrHaGroup, IbrHaGroupMember } from '../../../../services/ibrHaGroupApi';
import { readSideFromIntent, sideLabel } from '../ha-groups/haGroupWizardLib';

/** 隧道指纹 / archive 用的 HA 归属标注（端点仍是所选 CE uuid） */
export type Srv6CeHaBinding = {
	haGroupId: string;
	haGroupName: string;
	/** 所选 CE 在组内角色 */
	memberRole: 'primary' | 'backup';
	/** 所选 CE uuid */
	memberVrUuid: string;
	/** 同组另一台（不论本端是主还是备） */
	peerVrUuid: string;
	memberName?: string | null;
	peerName?: string | null;
	/** @deprecated 兼容旧字段名：等于 peerVrUuid */
	backupVrUuid: string;
	primaryVrUuid: string;
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

/** 可用于标注的 HA 组：须含 primary + backup */
export function isSrv6EligibleHaGroup(group: IbrHaGroup | null | undefined): boolean {
	if (!group) return false;
	const primary = haGroupMemberByRole(group, 'primary');
	const backup = haGroupMemberByRole(group, 'backup');
	return Boolean(primary?.vrUuid?.trim() && backup?.vrUuid?.trim());
}

export function findHaGroupById(groups: IbrHaGroup[], id: string): IbrHaGroup | undefined {
	const key = String(id || '').trim();
	if (!key) return undefined;
	return groups.find((g) => g.id === key);
}

/** 按 CE uuid 反查所属 HA 组标注；无归属则 null */
export function lookupHaAnnotationByVrUuid(
	groups: IbrHaGroup[],
	vrUuid: string,
): Srv6CeHaBinding | null {
	const id = String(vrUuid || '').trim();
	if (!id) return null;
	for (const group of groups) {
		if (!isSrv6EligibleHaGroup(group)) continue;
		const primary = haGroupMemberByRole(group, 'primary')!;
		const backup = haGroupMemberByRole(group, 'backup')!;
		const primaryUuid = String(primary.vrUuid).trim();
		const backupUuid = String(backup.vrUuid).trim();
		if (id === primaryUuid) {
			return {
				haGroupId: group.id,
				haGroupName: group.name,
				memberRole: 'primary',
				memberVrUuid: primaryUuid,
				peerVrUuid: backupUuid,
				memberName: primary.name,
				peerName: backup.name,
				backupVrUuid: backupUuid,
				primaryVrUuid: primaryUuid,
				primaryName: primary.name,
				backupName: backup.name,
			};
		}
		if (id === backupUuid) {
			return {
				haGroupId: group.id,
				haGroupName: group.name,
				memberRole: 'backup',
				memberVrUuid: backupUuid,
				peerVrUuid: primaryUuid,
				memberName: backup.name,
				peerName: primary.name,
				backupVrUuid: primaryUuid,
				primaryVrUuid: primaryUuid,
				primaryName: primary.name,
				backupName: backup.name,
			};
		}
	}
	return null;
}

/** 下拉装饰：在 CE 选项 label 后追加 HA 归属 */
export function decorateCeOptionLabelWithHa(
	baseLabel: string,
	groups: IbrHaGroup[],
	vrUuid: string,
): string {
	const ann = lookupHaAnnotationByVrUuid(groups, vrUuid);
	if (!ann) return baseLabel;
	const roleTag = ann.memberRole === 'primary' ? '主' : '备';
	return `${baseLabel} · HA ${ann.haGroupName}（${roleTag}）`;
}

export function haMemberHint(ann: Srv6CeHaBinding | null): string | null {
	if (!ann) return null;
	return '本隧道 SRv6 只下发到所选设备';
}

/** 同一 HA 组的主备不能作为一条隧道的两端 CE */
export function findSharedHaGroupForCes(
	groups: IbrHaGroup[],
	ceA: string,
	ceB: string,
): IbrHaGroup | null {
	const a = lookupHaAnnotationByVrUuid(groups, ceA);
	const b = lookupHaAnnotationByVrUuid(groups, ceB);
	if (!a || !b || a.haGroupId !== b.haGroupId) return null;
	return findHaGroupById(groups, a.haGroupId) ?? null;
}

export function sharedHaGroupOppositeCesMessage(groupName: string): string {
	return `CE-A 与 CE-B 不能是同一高可用组「${groupName}」的主备成员；同组另一台请另建隧道单独下发`;
}

/** @deprecated 隧道已改为按设备选 CE；保留供旧调用兼容 */
export function resolveSrv6CeHaBinding(group: IbrHaGroup | null | undefined): Srv6CeHaBinding | null {
	if (!isSrv6EligibleHaGroup(group)) return null;
	const primary = haGroupMemberByRole(group, 'primary')!;
	const backup = haGroupMemberByRole(group, 'backup')!;
	const primaryUuid = String(primary.vrUuid).trim();
	const backupUuid = String(backup.vrUuid).trim();
	return {
		haGroupId: group!.id,
		haGroupName: group!.name,
		memberRole: 'primary',
		memberVrUuid: primaryUuid,
		peerVrUuid: backupUuid,
		memberName: primary.name,
		peerName: backup.name,
		backupVrUuid: backupUuid,
		primaryVrUuid: primaryUuid,
		primaryName: primary.name,
		backupName: backup.name,
	};
}

/** @deprecated */
export function resolveSrv6CeHaBindingById(
	groups: IbrHaGroup[],
	id: string,
): Srv6CeHaBinding | null {
	return resolveSrv6CeHaBinding(findHaGroupById(groups, id));
}

/** @deprecated 隧道不再用 HA 组下拉 */
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

export function srv6CeSlotLabel(slot: 'ceA' | 'ceB'): string {
	return slot === 'ceA' ? 'CE-A' : 'CE-B';
}
