import {
	buildSrv6HaGroupSelectOptions,
	inferSrv6TunnelCeAccessMode,
	isSrv6EligibleHaGroup,
	resolveSrv6CeHaBinding,
	resolveSrv6CeHaBindingById,
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

	it('resolveSrv6CeHaBindingById returns null for missing id', () => {
		expect(resolveSrv6CeHaBindingById([sampleGroup], '')).toBeNull();
		expect(resolveSrv6CeHaBindingById([sampleGroup], 'missing')).toBeNull();
	});

	it('resolveSrv6CeHaBinding tolerates undefined group', () => {
		expect(resolveSrv6CeHaBinding(undefined)).toBeNull();
	});

	it('builds select options', () => {
		const opts = buildSrv6HaGroupSelectOptions([sampleGroup]);
		expect(opts).toHaveLength(1);
		expect(opts[0]?.value).toBe('g1');
		expect(opts[0]?.label).toContain('北京 CE 组');
	});

	it('infers tunnel CE access mode from fingerprints', () => {
		expect(inferSrv6TunnelCeAccessMode(undefined, undefined)).toBe('标准');
		expect(inferSrv6TunnelCeAccessMode({ haGroupId: 'g1' }, { haGroupId: 'g2' })).toBe('高可用');
		expect(inferSrv6TunnelCeAccessMode({ haGroupId: 'g1' }, undefined)).toBe('高可用');
	});

	it('labels HA CE slots as logical primary', () => {
		expect(srv6CeSlotLabel('ceA', '标准')).toBe('CE-A');
		expect(srv6CeSlotLabel('ceA', '高可用')).toBe('CE-A（HA 主）');
		expect(srv6CeSlotLabel('ceB', '高可用')).toBe('CE-B（HA 主）');
	});
});
