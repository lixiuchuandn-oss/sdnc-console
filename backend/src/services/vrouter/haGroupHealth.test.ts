import type { HaGroupVrrpIntent } from './haGroupVrrpIntent';
import {
  applyVrrpPatchToDeviceConfig,
  extractHaGroupVrrpSubset,
  materializeHaGroupVrrpForMember,
} from './haGroupVrrpMaterialize';
import {
  assessHaMemberHealth,
  haVrrpSliceEqual,
  inspectHaVrrpDeployDrift,
  rollupHaGroupHealth,
} from './haGroupHealth';

const sampleIntent = (): HaGroupVrrpIntent => ({
    scheme: 'srv6-segment-list-vrrp',
    side: 'local',
    members: [
      {
        role: 'primary',
        vr_uuid: 'vr-a',
        instances: [
          {
            interface: 'GigabitEthernet 0/8/0',
            vrid: 1,
            virtual_ip: '12.1.1.254/24',
            priority: 200,
            auth_pass: '123456',
            preempt: true,
            advert_interval: 1,
            advert_mode: 'multicast',
          },
        ],
        groups: [{ group_id: 1, vrrp_instance: 1, track_gateway: '12.1.1.2', track_interval: 1 }],
      },
      {
        role: 'backup',
        vr_uuid: 'vr-b',
        instances: [
          {
            interface: 'GigabitEthernet 0/8/0',
            vrid: 1,
            virtual_ip: '12.1.1.254/24',
            priority: 100,
            auth_pass: '123456',
            preempt: true,
            advert_interval: 1,
            advert_mode: 'multicast',
          },
        ],
        groups: [{ group_id: 1, vrrp_instance: 1, track_gateway: '12.1.1.3', track_interval: 1 }],
      },
    ],
  });

describe('haGroupHealth', () => {
  it('extracts only this group vrid and ignores foreign vrrp', () => {
    const patch = materializeHaGroupVrrpForMember(sampleIntent(), 'primary');
    const device = {
      interfaces_GigabitEthernet: [
        {
          name: 'GigabitEthernet 0/8/0',
          ipv4_static: '12.1.1.2/24',
          vrrp: [
            { vrid: 1, priority: 200, virtual_ipaddress: ['12.1.1.254/24'], preempt: true, advert_interval: 1, auth_pass: '123456' },
            { vrid: 9, priority: 50, virtual_ipaddress: ['9.9.9.9/32'] },
          ],
        },
      ],
      vrrp: [
        { group_id: 1, vrrp_instance: [1], track_gateway: ['12.1.1.2'], track_interval: 1 },
        { group_id: 99, vrrp_instance: [9], track_gateway: [] },
      ],
    };
    const subset = extractHaGroupVrrpSubset(device, patch);
    expect(subset.interfaces[0].vrrp).toHaveLength(1);
    expect((subset.vrrp as Array<{ group_id: number }>)[0].group_id).toBe(1);
    expect(haVrrpSliceEqual(subset, {
      interfaces: [{ name: 'GigabitEthernet 0/8/0', vrrp: [patch.ifacePatches[0].ifaceVrrp] }],
      vrrp: patch.topVrrp,
    })).toBe(true);
  });

  it('member health is not_deployed when device has no group vrid', () => {
    const patch = materializeHaGroupVrrpForMember(sampleIntent(), 'primary');
    const h = assessHaMemberHealth({
      role: 'primary',
      vrUuid: 'vr-a',
      patch,
      device: { interfaces_GigabitEthernet: [{ name: 'GigabitEthernet 0/8/0', ipv4_static: '12.1.1.2/24' }] },
    });
    expect(h.code).toBe('not_deployed');
  });

  it('member health is drift when priority differs', () => {
    const patch = materializeHaGroupVrrpForMember(sampleIntent(), 'primary');
    const device = applyVrrpPatchToDeviceConfig(
      { interfaces_GigabitEthernet: [{ name: 'GigabitEthernet 0/8/0' }] },
      patch,
    );
    const mutated = JSON.parse(JSON.stringify(device)) as typeof device;
    (mutated.interfaces_GigabitEthernet as Array<{ vrrp: Array<{ priority: number }> }>)[0].vrrp[0].priority = 50;
    const h = assessHaMemberHealth({ role: 'primary', vrUuid: 'vr-a', patch, device: mutated });
    expect(h.code).toBe('drift');
    expect(h.message).toMatch(/priority|意图/);
  });

  it('rollup mixed ok+drift is degraded; both missing is endpoint_missing', () => {
    expect(rollupHaGroupHealth('ok', 'drift')).toBe('degraded');
    expect(rollupHaGroupHealth('ok', 'ok')).toBe('ok');
    expect(rollupHaGroupHealth('not_deployed', 'not_deployed')).toBe('not_deployed');
    expect(rollupHaGroupHealth('endpoint_missing', 'ok')).toBe('endpoint_missing');
    expect(rollupHaGroupHealth('drift', 'drift')).toBe('drift');
  });

  it('deploy drift is silent on first inject and flags rewrite of existing group vrrp', () => {
    const patch = materializeHaGroupVrrpForMember(sampleIntent(), 'primary');
    const empty = { interfaces_GigabitEthernet: [{ name: 'GigabitEthernet 0/8/0' }] };
    expect(inspectHaVrrpDeployDrift(empty, patch)).toHaveLength(0);

    const onDevice = applyVrrpPatchToDeviceConfig(empty, patch);
    expect(inspectHaVrrpDeployDrift(onDevice, patch)).toHaveLength(0);

    const rewritten = JSON.parse(JSON.stringify(onDevice)) as typeof onDevice;
    (rewritten.interfaces_GigabitEthernet as Array<{ vrrp: Array<{ priority: number }> }>)[0].vrrp[0].priority = 10;
    const conflicts = inspectHaVrrpDeployDrift(rewritten, patch);
    expect(conflicts.some((c) => c.kind === 'DOMAIN_OVERWRITE' && c.key === 'vrrp')).toBe(true);
  });

  it('deploy drift does not treat foreign vrid as group overwrite', () => {
    const patch = materializeHaGroupVrrpForMember(sampleIntent(), 'primary');
    const device = {
      interfaces_GigabitEthernet: [
        {
          name: 'GigabitEthernet 0/8/0',
          vrrp: [{ vrid: 9, priority: 50, virtual_ipaddress: ['9.9.9.9/32'] }],
        },
      ],
      vrrp: [{ group_id: 99, vrrp_instance: [9] }],
    };
    expect(inspectHaVrrpDeployDrift(device, patch)).toHaveLength(0);
    const merged = applyVrrpPatchToDeviceConfig(device, patch);
    const foreign = (merged.interfaces_GigabitEthernet as Array<{ vrrp: Array<{ vrid: number }> }>)[0].vrrp;
    expect(foreign.some((v) => v.vrid === 9)).toBe(true);
  });
});
