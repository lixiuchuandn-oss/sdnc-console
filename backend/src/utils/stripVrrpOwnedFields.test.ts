import { stripVrrpOwnedFields } from './stripVrrpOwnedFields';
import { configBusinessEqual } from './configSemanticEqual';

describe('stripVrrpOwnedFields', () => {
  it('drops top-level vrrp and interface vrrp without mutating input', () => {
    const input = {
      bgp: [{ asn: 65001 }],
      vrrp: [{ group_id: 1, vrrp_instance: [1] }],
      interfaces_GigabitEthernet: [
        {
          name: 'GigabitEthernet 0/8/0',
          ipv4_static: '12.1.1.2/24',
          vrrp: [{ vrid: 1, priority: 100, preempt: true }],
        },
      ],
    };
    const stripped = stripVrrpOwnedFields(input) as Record<string, unknown>;
    expect(stripped.vrrp).toBeUndefined();
    expect(input.vrrp).toHaveLength(1);
    const ifaces = stripped.interfaces_GigabitEthernet as Array<Record<string, unknown>>;
    expect(ifaces[0].vrrp).toBeUndefined();
    expect(ifaces[0].ipv4_static).toBe('12.1.1.2/24');
    expect((input.interfaces_GigabitEthernet[0] as { vrrp: unknown }).vrrp).toHaveLength(1);
  });

  it('ledger with HA vrrp equals SRv6 baseline without vrrp', () => {
    const ledger = {
      bgp: [{ asn: 65001 }],
      interfaces_GigabitEthernet: [
        {
          name: 'GigabitEthernet 0/8/0',
          ipv4_static: '12.1.1.2/24',
          vrrp: [{ vrid: 1, priority: 100 }],
        },
      ],
      vrrp: [{ group_id: 1, vrrp_instance: [1] }],
    };
    const baseline = {
      bgp: [{ asn: 65001 }],
      interfaces_GigabitEthernet: [{ name: 'GigabitEthernet 0/8/0', ipv4_static: '12.1.1.2/24' }],
    };
    expect(configBusinessEqual(stripVrrpOwnedFields(ledger), stripVrrpOwnedFields(baseline))).toBe(
      true,
    );
  });

  it('ledger with ipv6_nd_proxy equals SRv6 baseline without that field', () => {
    const ledger = {
      bgp: [{ asn: 65001 }],
      interfaces_GigabitEthernet: [
        {
          name: 'GigabitEthernet 0/7/0',
          ipv6_static: '240e:398:8507:1:1::1/64',
          ipv6_nd_proxy: '240e:398:8507:1:1::301',
        },
      ],
    };
    const baseline = {
      bgp: [{ asn: 65001 }],
      interfaces_GigabitEthernet: [
        { name: 'GigabitEthernet 0/7/0', ipv6_static: '240e:398:8507:1:1::1/64' },
      ],
    };
    expect(configBusinessEqual(stripVrrpOwnedFields(ledger), stripVrrpOwnedFields(baseline))).toBe(
      true,
    );
  });

  it('still reports real SRv6 diffs after stripping vrrp', () => {
    const ledger = {
      bgp: [{ asn: 65001 }],
      interfaces_GigabitEthernet: [
        { name: 'GigabitEthernet 0/8/0', ipv4_static: '12.1.1.9/24', vrrp: [{ vrid: 1 }] },
      ],
    };
    const baseline = {
      bgp: [{ asn: 65001 }],
      interfaces_GigabitEthernet: [{ name: 'GigabitEthernet 0/8/0', ipv4_static: '12.1.1.2/24' }],
    };
    expect(configBusinessEqual(stripVrrpOwnedFields(ledger), stripVrrpOwnedFields(baseline))).toBe(
      false,
    );
  });
});
