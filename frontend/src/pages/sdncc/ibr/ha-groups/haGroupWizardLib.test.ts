import {
	HA_GROUP_ELIGIBLE_ROLES,
	HA_GROUP_SCHEME,
	buildHaGroupVrrpIntent,
	generateHaGroupName,
	parseVrrpIntentToForm,
	placementLabel,
	validateHaGroupWizardForm,
	isHaGroupEligibleIbrRole,
	isPeLikeIbrRole,
	type HaGroupWizardFormValues,
} from './haGroupWizardLib';

describe('haGroupWizardLib role scope', () => {
	it('allows CE and 标准 only', () => {
		expect(HA_GROUP_ELIGIBLE_ROLES).toEqual(['CE', '标准']);
		expect(isHaGroupEligibleIbrRole('CE')).toBe(true);
		expect(isHaGroupEligibleIbrRole('标准')).toBe(true);
	});

	it('rejects PE-like and other roles', () => {
		expect(isPeLikeIbrRole('PE')).toBe(true);
		expect(isPeLikeIbrRole('SPOKE_PE')).toBe(true);
		expect(isPeLikeIbrRole('HUB_PE')).toBe(true);
		expect(isHaGroupEligibleIbrRole('SPOKE_PE')).toBe(false);
		expect(isHaGroupEligibleIbrRole('HUB_PE')).toBe(false);
		expect(isHaGroupEligibleIbrRole('SASE')).toBe(false);
		expect(isHaGroupEligibleIbrRole('')).toBe(false);
	});
});

const sampleFormValues = (): HaGroupWizardFormValues => ({
	name: 'ce-access-ha-01',
	placement: 'access',
	primaryUuid: 'primary-uuid',
	backupUuid: 'backup-uuid',
	vrid: 10,
	virtualIp: '192.168.1.254',
	advertInterval: 1,
	preempt: true,
	primaryPriority: 200,
	backupPriority: 100,
	primaryInterface: 'GigabitEthernet2/1/0',
	backupInterface: 'GigabitEthernet2/1/0',
	primaryTrackGateway: 'GigabitEthernet2/2/0',
	backupTrackGateway: 'GigabitEthernet2/3/4',
});

describe('haGroupWizardLib scheme two intent', () => {
	it('builds srv6-segment-list-vrrp intent with track_gateway per member', () => {
		const intent = buildHaGroupVrrpIntent(sampleFormValues());
		expect(intent.scheme).toBe(HA_GROUP_SCHEME);
		expect(intent.placement).toBe('access');
		expect(intent.members).toHaveLength(2);
		const primary = intent.members.find((m) => m.role === 'primary');
		const backup = intent.members.find((m) => m.role === 'backup');
		expect(primary?.track_gateway).toBe('GigabitEthernet2/2/0');
		expect(backup?.track_gateway).toBe('GigabitEthernet2/3/4');
		expect(primary?.priority).toBeGreaterThan(backup?.priority ?? 0);
	});

	it('validates required track-gateway and priority order', () => {
		expect(validateHaGroupWizardForm(sampleFormValues())).toBeNull();
		const bad = { ...sampleFormValues(), primaryTrackGateway: '' };
		expect(validateHaGroupWizardForm(bad)).toMatch(/track-gateway/);
		const badPri = { ...sampleFormValues(), primaryPriority: 90, backupPriority: 100 };
		expect(validateHaGroupWizardForm(badPri)).toMatch(/优先级/);
	});

	it('round-trips intent to form fields', () => {
		const intent = buildHaGroupVrrpIntent({ ...sampleFormValues(), placement: 'egress' });
		const form = parseVrrpIntentToForm(intent, { primaryUuid: '', backupUuid: '' });
		expect(form.placement).toBe('egress');
		expect(form.primaryTrackGateway).toBe('GigabitEthernet2/2/0');
		expect(placementLabel('access')).toContain('接入');
	});

	it('generates id-abbr-11char group name on create', () => {
		const accessName = generateHaGroupName('access');
		const egressName = generateHaGroupName('egress');
		expect(accessName).toMatch(/^ha-acc-[a-z0-9]{11}$/);
		expect(egressName).toMatch(/^ha-egr-[a-z0-9]{11}$/);
	});
});
