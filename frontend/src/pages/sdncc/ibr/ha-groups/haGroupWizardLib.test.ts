import {
	HA_GROUP_ELIGIBLE_ROLES,
	HA_GROUP_SCHEME,
	buildHaGroupVrrpIntent,
	collectHaDeviceIfaces,
	createDefaultNodeVrrp,
	generateHaGroupName,
	isAutoHaGroupName,
	isHaGroupEligibleIbrRole,
	isPeLikeIbrRole,
	parseVrrpIntentToForm,
	readSideFromIntent,
	sideLabel,
	occupiedHaMemberIndex,
	decorateOccupiedHaVrOptions,
	validateHaGroupWizardForm,
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
	name: 'ce-local-ha-01',
	side: 'local',
	primaryUuid: 'primary-uuid',
	backupUuid: 'backup-uuid',
	primary: {
		instances: [
			{
				interface: 'GigabitEthernet2/1/0',
				vrid: 10,
				virtualIp: '192.168.1.254',
				priority: 200,
				preempt: true,
				advertInterval: 1,
				advertMode: 'multicast',
			},
		],
		groups: [
			{
				groupId: 1,
				vrrpInstanceId: 10,
				trackGateway: '172.16.23.3',
				trackInterval: 1,
			},
		],
	},
	backup: {
		instances: [
			{
				interface: 'GigabitEthernet2/1/0',
				vrid: 10,
				virtualIp: '192.168.1.254',
				priority: 100,
				preempt: true,
				advertInterval: 1,
				advertMode: 'multicast',
			},
		],
		groups: [
			{
				groupId: 1,
				vrrpInstanceId: 10,
				trackGateway: '172.16.24.3',
				trackInterval: 1,
			},
		],
	},
});

describe('haGroupWizardLib vrrp intent', () => {
	it('builds per-node instances and group policies', () => {
		const intent = buildHaGroupVrrpIntent(sampleFormValues());
		expect(intent.scheme).toBe(HA_GROUP_SCHEME);
		expect(intent.side).toBe('local');
		expect(intent.members).toHaveLength(2);
		const primary = intent.members.find((m) => m.role === 'primary');
		const backup = intent.members.find((m) => m.role === 'backup');
		expect(primary?.instances[0]?.vrid).toBe(10);
		expect(primary?.instances[0]?.advert_interval).toBe(1);
		expect(primary?.instances[0]?.preempt).toBe(true);
		expect(primary?.groups[0]?.track_gateway).toBe('172.16.23.3');
		expect(backup?.groups[0]?.track_interval).toBe(1);
		expect(primary?.instances[0]?.priority).toBeGreaterThan(backup?.instances[0]?.priority ?? 0);
	});

	it('maps unicast only when advertMode is unicast', () => {
		const base = sampleFormValues();
		base.primary.instances[0] = {
			...base.primary.instances[0]!,
			advertMode: 'unicast',
			unicastSource: '10.16.160.124',
			unicastPeer: '10.16.160.125',
		};
		base.backup.instances[0] = {
			...base.backup.instances[0]!,
			advertMode: 'unicast',
			unicastSource: '10.16.160.125',
			unicastPeer: '10.16.160.124',
		};
		const intent = buildHaGroupVrrpIntent(base);
		const primary = intent.members.find((m) => m.role === 'primary');
		expect(primary?.instances[0]?.unicast_source).toBe('10.16.160.124');
		expect(primary?.instances[0]?.unicast_peer).toBe('10.16.160.125');

		const multicast = buildHaGroupVrrpIntent(sampleFormValues());
		expect(multicast.members[0].instances[0].unicast_source).toBeUndefined();
	});

	it('validates required instance/group fields and priority order', () => {
		expect(validateHaGroupWizardForm(sampleFormValues())).toBeNull();
		const missingIface = sampleFormValues();
		missingIface.primary.instances[0]!.interface = '';
		expect(validateHaGroupWizardForm(missingIface)).toMatch(/绑定接口/);
		const badPri = sampleFormValues();
		badPri.primary.instances[0]!.priority = 90;
		expect(validateHaGroupWizardForm(badPri)).toMatch(/优先级/);
		const optionalTrack = sampleFormValues();
		optionalTrack.primary.groups[0]!.trackGateway = '';
		expect(validateHaGroupWizardForm(optionalTrack)).toBeNull();
		const cidrTrack = sampleFormValues();
		cidrTrack.primary.groups[0]!.trackGateway = '172.16.23.3/24';
		expect(validateHaGroupWizardForm(cidrTrack)).toMatch(/不可携带掩码/);
		const ifaceTrack = sampleFormValues();
		ifaceTrack.primary.groups[0]!.trackGateway = 'GigabitEthernet 0/8/0';
		expect(validateHaGroupWizardForm(ifaceTrack)).toMatch(/不能填接口名/);
	});

	it('occupiedHaMemberIndex skips current group and maps uuid to group name', () => {
		const occupied = occupiedHaMemberIndex(
			[
				{
					id: 'ha-1',
					name: 'ha-1',
					members: [{ vrUuid: 'ce1' }, { vrUuid: 'ce2' }],
				},
				{
					id: 'ha-2',
					name: 'ha-2',
					members: [{ vrUuid: 'ce3' }],
				},
			],
			'ha-2',
		);
		expect(occupied.get('ce1')).toBe('ha-1');
		expect(occupied.get('ce2')).toBe('ha-1');
		expect(occupied.has('ce3')).toBe(false);
	});

	it('decorateOccupiedHaVrOptions disables occupied uuids with owner hint', () => {
		const decorated = decorateOccupiedHaVrOptions(
			[
				{ value: 'ce1', label: 'CE1 [CE] · 10.23.5.101' },
				{ value: 'ce3', label: 'CE3 [CE] · 10.23.5.103' },
			],
			new Map([['ce1', 'ha-1']]),
		);
		expect(decorated[0]).toMatchObject({
			value: 'ce1',
			disabled: true,
			label: 'CE1 [CE] · 10.23.5.101（已属于 ha-1）',
		});
		expect(decorated[1]).toEqual({ value: 'ce3', label: 'CE3 [CE] · 10.23.5.103' });
	});

	it('round-trips new intent and legacy intent to form fields', () => {
		const intent = buildHaGroupVrrpIntent({
			...sampleFormValues(),
			side: 'peer',
		});
		const form = parseVrrpIntentToForm(intent, { primaryUuid: '', backupUuid: '' });
		expect(form.side).toBe('peer');
		expect(form.primary?.groups[0]?.trackGateway).toBe('172.16.23.3');

		const legacyForm = parseVrrpIntentToForm(
			{
				scheme: HA_GROUP_SCHEME,
				placement: 'egress',
				vrid: 1,
				virtual_ip: '10.0.0.1',
				preempt: true,
				members: [
					{
						role: 'primary',
						vr_uuid: 'p',
						priority: 200,
						interface: 'GigabitEthernet0/9/0',
						track_gateway: '172.16.23.3',
						unicast_source: '10.16.160.124',
						unicast_peer: '10.16.160.125',
					},
					{
						role: 'backup',
						vr_uuid: 'b',
						priority: 100,
						interface: 'GigabitEthernet0/9/0',
						track_gateway: '172.16.24.3',
						unicast_source: '10.16.160.125',
						unicast_peer: '10.16.160.124',
					},
				],
			},
			{ primaryUuid: '', backupUuid: '' },
		);
		expect(legacyForm.side).toBe('peer');
		expect(legacyForm.primary?.instances[0]?.advertMode).toBe('unicast');
		expect(legacyForm.primary?.instances[0]?.unicastSource).toBe('10.16.160.124');
		expect(legacyForm.backup?.groups[0]?.trackGateway).toBe('172.16.24.3');
		expect(sideLabel('access')).toBe('本端 HA 组');
		expect(readSideFromIntent({ placement: 'egress' })).toBe('peer');
	});

	it('generates id-abbr-11char group name on create', () => {
		const localName = generateHaGroupName('local');
		const peerName = generateHaGroupName('peer');
		expect(localName).toMatch(/^ha-loc-[a-z0-9]{11}$/);
		expect(peerName).toMatch(/^ha-peer-[a-z0-9]{11}$/);
		expect(isAutoHaGroupName(localName)).toBe(true);
		expect(isAutoHaGroupName('custom-name')).toBe(false);
	});

	it('collects interface inventory from vr2 interface array', () => {
		const ifaces = collectHaDeviceIfaces({
			vr2_info: {
				interface: [{ name: 'GigabitEthernet 0/9/0', ipv4_static: '10.16.160.124/26' }],
			},
		});
		expect(ifaces[0]).toEqual({ name: 'GigabitEthernet 0/9/0', ipv4: '10.16.160.124' });
	});

	it('seeds default node vrrp with one instance and one group', () => {
		const node = createDefaultNodeVrrp('backup');
		expect(node.instances[0]?.priority).toBe(100);
		expect(node.instances[0]?.advertInterval).toBe(1);
		expect(node.instances[0]?.preempt).toBe(true);
		expect(node.groups[0]?.trackInterval).toBe(1);
	});
});
