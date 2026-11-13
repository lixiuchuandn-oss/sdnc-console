import {
	decorateCeOptionLabelWithHa,
	findSharedHaGroupForCes,
	haMemberHint,
	isSrv6EligibleHaGroup,
	lookupHaAnnotationByVrUuid,
	resolveSrv6CeHaBinding,
	srv6CeSlotLabel,
} from './srv6CeHaGroupLib';
import type { IbrHaGroup } from '../../../../services/ibrHaGroupApi';

const sampleGroup: IbrHaGroup = {
	id: 'g1',
	name: '北京 CE 组',
	description: null,
	mode: 'active-standby',
	status: 'draft',
	vrrpIntent: null,
	members: [
		{ role: 'primary', vrUuid: 'ce-primary', name: 'CE-主', managementIp: '10.0.0.1', vrrpPriority: 200 },
		{ role: 'backup', vrUuid: 'ce-backup', name: 'CE-备', managementIp: '10.0.0.2', vrrpPriority: 100 },
	],
	createdAt: '',
	updatedAt: '',
};

describe('srv6CeHaGroupLib', () => {
	it('accepts group with primary and backup', () => {
		expect(isSrv6EligibleHaGroup(sampleGroup)).toBe(true);
		const binding = resolveSrv6CeHaBinding(sampleGroup);
		expect(binding?.primaryVrUuid).toBe('ce-primary');
		expect(binding?.backupVrUuid).toBe('ce-backup');
	});

	it('rejects incomplete group', () => {
		expect(
			isSrv6EligibleHaGroup({
				...sampleGroup,
				members: [{ role: 'primary', vrUuid: 'only', name: null, managementIp: null, vrrpPriority: null }],
			}),
		).toBe(false);
	});

	it('lookupHaAnnotationByVrUuid returns primary or backup annotation', () => {
		const asPrimary = lookupHaAnnotationByVrUuid([sampleGroup], 'ce-primary');
		expect(asPrimary).toMatchObject({
			haGroupId: 'g1',
			memberRole: 'primary',
			memberVrUuid: 'ce-primary',
			peerVrUuid: 'ce-backup',
			backupVrUuid: 'ce-backup',
		});
		const asBackup = lookupHaAnnotationByVrUuid([sampleGroup], 'ce-backup');
		expect(asBackup).toMatchObject({
			haGroupId: 'g1',
			memberRole: 'backup',
			memberVrUuid: 'ce-backup',
			peerVrUuid: 'ce-primary',
			backupVrUuid: 'ce-primary',
		});
		expect(lookupHaAnnotationByVrUuid([sampleGroup], 'unknown')).toBeNull();
	});

	it('decorates CE option labels with HA membership', () => {
		expect(decorateCeOptionLabelWithHa('CE1 [CE]', [sampleGroup], 'ce-primary')).toContain('HA 北京 CE 组（主）');
		expect(decorateCeOptionLabelWithHa('CE2 [CE]', [sampleGroup], 'ce-backup')).toContain('（备）');
		expect(decorateCeOptionLabelWithHa('CE9 [CE]', [sampleGroup], 'other')).toBe('CE9 [CE]');
	});

	it('haMemberHint is a short per-device deploy reminder', () => {
		const hint = haMemberHint(lookupHaAnnotationByVrUuid([sampleGroup], 'ce-primary'));
		expect(hint).toBe('本隧道 SRv6 只下发到所选设备');
		expect(haMemberHint(null)).toBeNull();
	});

	it('srv6CeSlotLabel is plain CE slot', () => {
		expect(srv6CeSlotLabel('ceA')).toBe('CE-A');
		expect(srv6CeSlotLabel('ceB')).toBe('CE-B');
	});

	it('findSharedHaGroupForCes detects same-group opposite CEs', () => {
		expect(findSharedHaGroupForCes([sampleGroup], 'ce-primary', 'ce-backup')?.id).toBe('g1');
		expect(findSharedHaGroupForCes([sampleGroup], 'ce-primary', 'other')).toBeNull();
	});
});
