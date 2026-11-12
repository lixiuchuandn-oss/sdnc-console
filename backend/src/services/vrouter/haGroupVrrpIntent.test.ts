import {
  memberPriorityFromIntent,
  normalizeHaGroupVrrpIntent,
  validateHaGroupVrrpIntent,
} from './haGroupVrrpIntent';

const legacyIntent = {
  scheme: 'srv6-segment-list-vrrp',
  placement: 'access',
  vrid: 10,
  virtual_ip: '10.0.0.1',
  advert_interval: 1,
  auth_pass: 'secret',
  preempt: true,
  members: [
    {
      role: 'primary',
      vr_uuid: 'vr-a',
      priority: 200,
      interface: 'GigabitEthernet0/0/1',
      track_gateway: '192.168.1.1',
      unicast_source: '10.16.160.124',
      unicast_peer: '10.16.160.125',
    },
    {
      role: 'backup',
      vr_uuid: 'vr-b',
      priority: 100,
      interface: 'GigabitEthernet0/0/1',
      track_gateway: '192.168.1.2',
      unicast_source: '10.16.160.125',
      unicast_peer: '10.16.160.124',
    },
  ],
};

describe('haGroupVrrpIntent', () => {
  it('normalizes legacy placement + single-instance members', () => {
    const intent = normalizeHaGroupVrrpIntent(legacyIntent);
    expect(intent?.side).toBe('local');
    const primary = intent?.members.find((m) => m.role === 'primary');
    expect(primary?.instances).toHaveLength(1);
    expect(primary?.instances[0]).toMatchObject({
      vrid: 10,
      virtual_ip: '10.0.0.1',
      interface: 'GigabitEthernet0/0/1',
      advert_mode: 'unicast',
      advert_interval: 1,
      preempt: true,
      unicast_source: '10.16.160.124',
      auth_pass: 'secret',
    });
    expect(primary?.groups[0]).toMatchObject({
      group_id: 10,
      vrrp_instance: 10,
      track_gateway: '192.168.1.1',
      track_interval: 1,
    });
    expect(memberPriorityFromIntent(intent, 'primary')).toBe(200);
  });

  it('maps egress placement to peer side', () => {
    const intent = normalizeHaGroupVrrpIntent({ ...legacyIntent, placement: 'egress' });
    expect(intent?.side).toBe('peer');
  });

  it('validates new multi-instance intent', () => {
    const raw = {
      scheme: 'srv6-segment-list-vrrp',
      side: 'peer',
      members: [
        {
          role: 'primary',
          vr_uuid: 'vr-a',
          instances: [
            {
              interface: 'GigabitEthernet0/9/0',
              vrid: 1,
              virtual_ip: '10.16.160.123/26',
              priority: 200,
              preempt: true,
              advert_mode: 'unicast',
              unicast_source: '10.16.160.124',
              unicast_peer: '10.16.160.125',
            },
            {
              interface: 'GigabitEthernet0/9/0',
              vrid: 2,
              virtual_ip: '10.16.160.122/26',
              priority: 200,
              preempt: true,
              advert_mode: 'multicast',
            },
          ],
          groups: [
            { group_id: 1, vrrp_instance: 1, track_gateway: '172.16.23.3', track_interval: 1 },
            { group_id: 2, vrrp_instance: 2, track_interval: 1 },
          ],
        },
        {
          role: 'backup',
          vr_uuid: 'vr-b',
          instances: [
            {
              interface: 'GigabitEthernet0/9/0',
              vrid: 1,
              virtual_ip: '10.16.160.123/26',
              priority: 100,
              preempt: true,
              advert_mode: 'unicast',
              unicast_source: '10.16.160.125',
              unicast_peer: '10.16.160.124',
            },
            {
              interface: 'GigabitEthernet0/9/0',
              vrid: 2,
              virtual_ip: '10.16.160.122/26',
              priority: 100,
              preempt: true,
              advert_mode: 'multicast',
            },
          ],
          groups: [
            { group_id: 1, vrrp_instance: 1, track_gateway: '172.16.24.3', track_interval: 1 },
            { group_id: 2, vrrp_instance: 2 },
          ],
        },
      ],
    };
    const intent = validateHaGroupVrrpIntent(raw, { primaryUuid: 'vr-a', backupUuid: 'vr-b' });
    expect(intent.side).toBe('peer');
    expect(intent.members[0].instances).toHaveLength(2);
    expect(intent.members[0].groups[1].track_interval).toBe(1);
  });

  it('rejects group policy pointing at missing vrid', () => {
    const raw = {
      scheme: 'srv6-segment-list-vrrp',
      side: 'local',
      members: [
        {
          role: 'primary',
          vr_uuid: 'vr-a',
          instances: [
            {
              interface: 'GigabitEthernet0/0/1',
              vrid: 1,
              virtual_ip: '10.0.0.1',
              priority: 200,
              preempt: true,
              advert_mode: 'multicast',
            },
          ],
          groups: [{ group_id: 1, vrrp_instance: 9, track_interval: 1 }],
        },
        {
          role: 'backup',
          vr_uuid: 'vr-b',
          instances: [
            {
              interface: 'GigabitEthernet0/0/1',
              vrid: 1,
              virtual_ip: '10.0.0.1',
              priority: 100,
              preempt: true,
              advert_mode: 'multicast',
            },
          ],
          groups: [{ group_id: 1, vrrp_instance: 1, track_interval: 1 }],
        },
      ],
    };
    expect(() => validateHaGroupVrrpIntent(raw)).toThrow(/VRRP 实例 ID/);
  });

  it('allows empty track-gateway', () => {
    const normalized = normalizeHaGroupVrrpIntent(legacyIntent);
    const primary = normalized!.members.find((m) => m.role === 'primary')!;
    delete primary.groups[0].track_gateway;
    expect(() => validateHaGroupVrrpIntent(normalized)).not.toThrow();
  });

  it('rejects interface names as track-gateway', () => {
    const normalized = normalizeHaGroupVrrpIntent(legacyIntent);
    const primary = normalized!.members.find((m) => m.role === 'primary')!;
    primary.groups[0].track_gateway = 'GigabitEthernet 0/8/0';
    expect(() => validateHaGroupVrrpIntent(normalized)).toThrow(/不能填接口名/);
  });

  it('parses string false as preempt false', () => {
    const intent = normalizeHaGroupVrrpIntent({
      ...legacyIntent,
      preempt: 'false',
      members: legacyIntent.members.map((m) => ({ ...m, preempt: 'false' })),
    });
    expect(intent?.members[0].instances[0].preempt).toBe(false);
  });
});
