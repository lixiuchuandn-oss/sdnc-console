import {
  applyVrrpPatchToDeviceConfig,
  ensureVipCidr,
  materializeHaGroupVrrpForMember,
} from './haGroupVrrpMaterialize';
import type { HaGroupVrrpIntent } from './haGroupVrrpIntent';

const sampleIntent = (): HaGroupVrrpIntent => ({
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
    },
    {
      role: 'backup',
      vr_uuid: 'vr-b',
      priority: 100,
      interface: 'GigabitEthernet0/0/1',
      track_gateway: '192.168.1.2',
    },
  ],
});

describe('haGroupVrrpMaterialize', () => {
  it('ensureVipCidr defaults /32', () => {
    expect(ensureVipCidr('10.0.0.1')).toBe('10.0.0.1/32');
    expect(ensureVipCidr('10.0.0.1/24')).toBe('10.0.0.1/24');
  });

  it('materializeHaGroupVrrpForMember builds iface + top group', () => {
    const patch = materializeHaGroupVrrpForMember(sampleIntent(), 'primary');
    expect(patch.vrUuid).toBe('vr-a');
    expect(patch.ifaceVrrp).toMatchObject({
      vrid: 10,
      priority: 200,
      advert_interval: 1,
      auth_pass: 'secret',
      virtual_ipaddress: ['10.0.0.1/32'],
    });
    expect(patch.topVrrp).toEqual({
      group_id: 10,
      track_gateway: ['192.168.1.1'],
      vrrp_instance: [10],
    });
  });

  it('materializeHaGroupVrrpForMember emits unicast-peer/source when intent has them', () => {
    const intent = sampleIntent();
    intent.members[0].unicast_source = '10.16.160.124';
    intent.members[0].unicast_peer = '10.16.160.125';
    intent.members[1].unicast_source = '10.16.160.125';
    intent.members[1].unicast_peer = '10.16.160.124';
    const primary = materializeHaGroupVrrpForMember(intent, 'primary');
    expect(primary.ifaceVrrp.unicast_source).toBe('10.16.160.124');
    expect(primary.ifaceVrrp.unicast_peer).toBe('10.16.160.125');
    const backup = materializeHaGroupVrrpForMember(intent, 'backup');
    expect(backup.ifaceVrrp.unicast_source).toBe('10.16.160.125');
    expect(backup.ifaceVrrp.unicast_peer).toBe('10.16.160.124');
  });

  it('applyVrrpPatchToDeviceConfig upserts without wiping other interfaces', () => {
    const device = {
      uuid: 'vr-a',
      interface: [
        { name: 'GigabitEthernet0/0/0', ipv4_static: '1.1.1.1/30' },
        {
          name: 'GigabitEthernet0/0/1',
          ipv4_static: '10.0.0.2/24',
          vrrp: [{ vrid: 99, priority: 50, virtual_ipaddress: ['10.0.0.99/32'] }],
        },
      ],
      vrrp: [{ group_id: 99, track_gateway: ['9.9.9.9'], vrrp_instance: [99] }],
    };
    const patch = materializeHaGroupVrrpForMember(sampleIntent(), 'primary');
    const merged = applyVrrpPatchToDeviceConfig(device, patch);

    expect(merged.interface).toHaveLength(2);
    const iface = (merged.interface as Array<Record<string, unknown>>).find(
      (i) => i.name === 'GigabitEthernet0/0/1',
    );
    expect(iface?.ipv4_static).toBe('10.0.0.2/24');
    const vrrpList = iface?.vrrp as Array<Record<string, unknown>>;
    expect(vrrpList).toHaveLength(2);
    expect(vrrpList.find((v) => v.vrid === 99)).toBeTruthy();
    expect(vrrpList.find((v) => v.vrid === 10)?.priority).toBe(200);

    const top = merged.vrrp as Array<Record<string, unknown>>;
    expect(top).toHaveLength(2);
    expect(top.find((g) => g.group_id === 10)?.track_gateway).toEqual(['192.168.1.1']);
  });

  it('applyVrrpPatchToDeviceConfig clears sticky unicast when intent drops them', () => {
    const withUnicast = sampleIntent();
    withUnicast.members[0].unicast_source = '10.16.160.124';
    withUnicast.members[0].unicast_peer = '10.16.160.125';
    const device = {
      uuid: 'vr-a',
      interface: [{ name: 'GigabitEthernet0/0/1', ipv4_static: '10.16.160.124/26' }],
    };
    const first = applyVrrpPatchToDeviceConfig(device, materializeHaGroupVrrpForMember(withUnicast, 'primary'));
    const firstVrrp = (
      (first.interface as Array<Record<string, unknown>>)[0].vrrp as Array<Record<string, unknown>>
    )[0];
    expect(firstVrrp.unicast_peer).toBe('10.16.160.125');

    const cleared = applyVrrpPatchToDeviceConfig(
      first,
      materializeHaGroupVrrpForMember(sampleIntent(), 'primary'),
    );
    const clearedVrrp = (
      (cleared.interface as Array<Record<string, unknown>>)[0].vrrp as Array<Record<string, unknown>>
    )[0];
    expect(clearedVrrp.unicast_peer).toBeUndefined();
    expect(clearedVrrp.unicast_source).toBeUndefined();
  });

  it('applyVrrpPatchToDeviceConfig fails when interface missing', () => {
    const patch = materializeHaGroupVrrpForMember(sampleIntent(), 'primary');
    expect(() => applyVrrpPatchToDeviceConfig({ interface: [] }, patch)).toThrow(/未找到接口/);
  });
});
