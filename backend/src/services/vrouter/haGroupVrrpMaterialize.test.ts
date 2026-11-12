import { normalizeHaGroupVrrpIntent, type HaGroupVrrpIntent } from './haGroupVrrpIntent';
import {
  applyVrrpPatchToDeviceConfig,
  ensureVipCidr,
  materializeHaGroupVrrpForMember,
  pickHaVrrpDeploySlice,
  stripHaGroupVrrpFromDeviceConfig,
} from './haGroupVrrpMaterialize';

const sampleIntent = (): HaGroupVrrpIntent => ({
  scheme: 'srv6-segment-list-vrrp',
  side: 'local',
  members: [
    {
      role: 'primary',
      vr_uuid: 'vr-a',
      instances: [
        {
          interface: 'GigabitEthernet0/0/1',
          vrid: 10,
          virtual_ip: '10.0.0.1',
          priority: 200,
          auth_pass: 'secret',
          preempt: true,
          advert_interval: 1,
          advert_mode: 'multicast',
        },
      ],
      groups: [
        {
          group_id: 1,
          vrrp_instance: 10,
          track_gateway: '192.168.1.1',
          track_interval: 1,
        },
      ],
    },
    {
      role: 'backup',
      vr_uuid: 'vr-b',
      instances: [
        {
          interface: 'GigabitEthernet0/0/1',
          vrid: 10,
          virtual_ip: '10.0.0.1',
          priority: 100,
          auth_pass: 'secret',
          preempt: true,
          advert_interval: 1,
          advert_mode: 'multicast',
        },
      ],
      groups: [
        {
          group_id: 1,
          vrrp_instance: 10,
          track_gateway: '192.168.1.2',
          track_interval: 1,
        },
      ],
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
    expect(patch.ifacePatches).toHaveLength(1);
    expect(patch.ifacePatches[0]).toMatchObject({
      interfaceName: 'GigabitEthernet0/0/1',
      ifaceVrrp: {
        vrid: 10,
        priority: 200,
        auth_pass: 'secret',
        advert_interval: 1,
        preempt: true,
        virtual_ipaddress: ['10.0.0.1/32'],
      },
    });
    expect(patch.ifacePatches[0].ifaceVrrp.advert_interval).toBe(1);
    expect(patch.topVrrp).toEqual([
      {
        group_id: 1,
        track_gateway: ['192.168.1.1'],
        vrrp_instance: [10],
        track_interval: 1,
      },
    ]);
  });

  it('materializeHaGroupVrrpForMember emits preempt false and advert_interval', () => {
    const intent = sampleIntent();
    intent.members[0].instances[0].preempt = false;
    intent.members[0].instances[0].advert_interval = 5;
    const patch = materializeHaGroupVrrpForMember(intent, 'primary');
    expect(patch.ifacePatches[0].ifaceVrrp.preempt).toBe(false);
    expect(patch.ifacePatches[0].ifaceVrrp.advert_interval).toBe(5);
  });

  it('materializeHaGroupVrrpForMember emits unicast only in unicast mode', () => {
    const intent = sampleIntent();
    intent.members[0].instances[0].advert_mode = 'unicast';
    intent.members[0].instances[0].unicast_source = '10.16.160.124';
    intent.members[0].instances[0].unicast_peer = '10.16.160.125';
    intent.members[1].instances[0].advert_mode = 'unicast';
    intent.members[1].instances[0].unicast_source = '10.16.160.125';
    intent.members[1].instances[0].unicast_peer = '10.16.160.124';
    const primary = materializeHaGroupVrrpForMember(intent, 'primary');
    expect(primary.ifacePatches[0].ifaceVrrp.unicast_source).toBe('10.16.160.124');
    expect(primary.ifacePatches[0].ifaceVrrp.unicast_peer).toBe('10.16.160.125');
    const multicast = materializeHaGroupVrrpForMember(sampleIntent(), 'primary');
    expect(multicast.ifacePatches[0].ifaceVrrp.unicast_source).toBeUndefined();
  });

  it('materializes two instances on the same interface', () => {
    const intent = sampleIntent();
    intent.members[0].instances.push({
      interface: 'GigabitEthernet0/0/1',
      vrid: 2,
      virtual_ip: '10.0.0.2/24',
      priority: 200,
      preempt: true,
      advert_interval: 1,
      advert_mode: 'multicast',
    });
    intent.members[0].groups.push({ group_id: 2, vrrp_instance: 2, track_interval: 1 });
    const patch = materializeHaGroupVrrpForMember(intent, 'primary');
    expect(patch.ifacePatches).toHaveLength(2);
    expect(patch.topVrrp).toHaveLength(2);
  });

  it('upsertTopVrrp matches only by group_id, not shared vrrp_instance', () => {
    const device = {
      uuid: 'vr-a',
      interface: [{ name: 'GigabitEthernet0/0/1', ipv4_static: '10.0.0.2/24' }],
      vrrp: [{ group_id: 99, track_gateway: ['9.9.9.9'], vrrp_instance: [10], track_interval: 9 }],
    };
    const patch = materializeHaGroupVrrpForMember(sampleIntent(), 'primary');
    // sample primary group_id=1, vrrp_instance=[10] — must not overwrite group 99
    const merged = applyVrrpPatchToDeviceConfig(device, patch);
    const top = merged.vrrp as Array<Record<string, unknown>>;
    expect(top).toHaveLength(2);
    expect(top.find((g) => g.group_id === 99)?.track_interval).toBe(9);
    expect(top.find((g) => g.group_id === 1)?.track_interval).toBe(1);
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
    expect(vrrpList.find((v) => v.vrid === 10)?.advert_interval).toBe(1);
    expect(vrrpList.find((v) => v.vrid === 10)?.preempt).toBe(true);

    const top = merged.vrrp as Array<Record<string, unknown>>;
    expect(top).toHaveLength(2);
    expect(top.find((g) => g.group_id === 1)?.track_gateway).toEqual(['192.168.1.1']);
    expect(top.find((g) => g.group_id === 1)?.track_interval).toBe(1);

    const slice = pickHaVrrpDeploySlice(merged, patch);
    expect(slice.interfaces).toHaveLength(1);
    expect(slice.interfaces[0]?.name).toBe('GigabitEthernet0/0/1');
    expect(Array.isArray(slice.vrrp)).toBe(true);
  });

  it('stripHaGroupVrrpFromDeviceConfig removes only this group vrid/group_id', () => {
    const device = {
      uuid: 'vr-a',
      interface: [
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
    const stripped = stripHaGroupVrrpFromDeviceConfig(merged, patch);
    const iface = (stripped.interface as Array<Record<string, unknown>>)[0];
    expect(iface.vrrp).toEqual([{ vrid: 99, priority: 50, virtual_ipaddress: ['10.0.0.99/32'] }]);
    expect(stripped.vrrp).toEqual([{ group_id: 99, track_gateway: ['9.9.9.9'], vrrp_instance: [99] }]);
  });

  it('stripHaGroupVrrpFromDeviceConfig drops empty vrrp keys', () => {
    const device = {
      uuid: 'vr-a',
      interfaces_GigabitEthernet: [{ name: 'GigabitEthernet 0/7/0', ipv4_static: '11.1.1.11/24' }],
    };
    const patch = materializeHaGroupVrrpForMember(sampleIntent(), 'primary');
    patch.ifacePatches[0].interfaceName = 'GigabitEthernet 0/7/0';
    const merged = applyVrrpPatchToDeviceConfig(device, patch);
    const stripped = stripHaGroupVrrpFromDeviceConfig(merged, patch);
    const iface = (stripped.interfaces_GigabitEthernet as Array<Record<string, unknown>>)[0];
    expect(iface.vrrp).toBeUndefined();
    expect(stripped.vrrp).toBeUndefined();
  });

  it('stripHaGroupVrrpFromDeviceConfig keeps same vrid on other interfaces', () => {
    const device = {
      uuid: 'vr-a',
      interfaces_GigabitEthernet: [
        { name: 'GigabitEthernet 0/7/0', ipv4_static: '11.1.1.11/24' },
        {
          name: 'GigabitEthernet 0/8/0',
          ipv4_static: '12.1.1.1/24',
          vrrp: [{ vrid: 10, priority: 50, virtual_ipaddress: ['12.1.1.100/24'] }],
        },
      ],
    };
    const patch = materializeHaGroupVrrpForMember(sampleIntent(), 'primary');
    patch.ifacePatches[0].interfaceName = 'GigabitEthernet 0/7/0';
    const merged = applyVrrpPatchToDeviceConfig(device, patch);
    const stripped = stripHaGroupVrrpFromDeviceConfig(merged, patch);
    const ifaces = stripped.interfaces_GigabitEthernet as Array<Record<string, unknown>>;
    expect(ifaces[0].vrrp).toBeUndefined();
    expect(ifaces[1].vrrp).toEqual([{ vrid: 10, priority: 50, virtual_ipaddress: ['12.1.1.100/24'] }]);
  });

  it('applyVrrpPatchToDeviceConfig clears sticky unicast when intent drops them', () => {
    const withUnicast = sampleIntent();
    withUnicast.members[0].instances[0].advert_mode = 'unicast';
    withUnicast.members[0].instances[0].unicast_source = '10.16.160.124';
    withUnicast.members[0].instances[0].unicast_peer = '10.16.160.125';
    const device = {
      uuid: 'vr-a',
      interface: [{ name: 'GigabitEthernet0/0/1', ipv4_static: '10.16.160.124/26' }],
    };
    const first = applyVrrpPatchToDeviceConfig(
      device,
      materializeHaGroupVrrpForMember(withUnicast, 'primary'),
    );
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

  it('applyVrrpPatchToDeviceConfig writes vrrp into interfaces_GigabitEthernet', () => {
    const intent = sampleIntent();
    intent.members[0].instances[0].interface = 'GigabitEthernet 0/7/0';
    const device = {
      uuid: 'vr-a',
      interfaces_GigabitEthernet: [
        { name: 'GigabitEthernet 0/7/0', ipv4_static: '11.1.1.11/24' },
      ],
    };
    const merged = applyVrrpPatchToDeviceConfig(
      device,
      materializeHaGroupVrrpForMember(intent, 'primary'),
    );
    expect(merged.interface).toBeUndefined();
    const ifaces = merged.interfaces_GigabitEthernet as Array<Record<string, unknown>>;
    expect(ifaces[0].ipv4_static).toBe('11.1.1.11/24');
    const vrrpList = ifaces[0].vrrp as Array<Record<string, unknown>>;
    expect(vrrpList[0].vrid).toBe(10);
    expect(vrrpList[0].priority).toBe(200);
  });

  it('applyVrrpPatchToDeviceConfig matches iface names with or without spaces', () => {
    const intent = sampleIntent();
    intent.members[0].instances[0].interface = 'GigabitEthernet0/7/0';
    const device = {
      uuid: 'vr-a',
      interfaces_GigabitEthernet: [{ name: 'GigabitEthernet 0/7/0', ipv4_static: '11.1.1.11/24' }],
    };
    const merged = applyVrrpPatchToDeviceConfig(
      device,
      materializeHaGroupVrrpForMember(intent, 'primary'),
    );
    const ifaces = merged.interfaces_GigabitEthernet as Array<Record<string, unknown>>;
    expect((ifaces[0].vrrp as Array<Record<string, unknown>>)[0].vrid).toBe(10);
  });

  it('applyVrrpPatchToDeviceConfig fails when interface missing', () => {
    const patch = materializeHaGroupVrrpForMember(sampleIntent(), 'primary');
    expect(() => applyVrrpPatchToDeviceConfig({ interface: [] }, patch)).toThrow(/未找到接口/);
  });

  it('legacy intent still materializes after normalize', () => {
    const normalized = normalizeHaGroupVrrpIntent({
      scheme: 'srv6-segment-list-vrrp',
      placement: 'egress',
      vrid: 1,
      virtual_ip: '192.168.1.254',
      advert_interval: 1,
      preempt: true,
      members: [
        {
          role: 'primary',
          vr_uuid: 'vr-a',
          priority: 200,
          interface: 'GigabitEthernet0/0/1',
          track_gateway: '1.1.1.1',
        },
        {
          role: 'backup',
          vr_uuid: 'vr-b',
          priority: 100,
          interface: 'GigabitEthernet0/0/1',
          track_gateway: '2.2.2.2',
        },
      ],
    });
    expect(normalized?.side).toBe('peer');
    const patch = materializeHaGroupVrrpForMember(normalized!, 'backup');
    expect(patch.topVrrp[0].track_gateway).toEqual(['2.2.2.2']);
    expect(patch.ifacePatches[0].ifaceVrrp.vrid).toBe(1);
  });
});
