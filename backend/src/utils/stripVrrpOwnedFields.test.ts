import {
  freezeSrv6BaselineJson,
  stitchHaVrrpSlice,
  stripHaVrrpSlice,
  stripVrrpOwnedFields,
} from './stripVrrpOwnedFields';
import { configBusinessEqual } from './configSemanticEqual';

describe('stripVrrpOwnedFields', () => {
  it('stripHaVrrpSlice drops vrrp but keeps ipv6_nd_proxy', () => {
    const input = {
      bgp: [{ asn: 65001 }],
      vrrp: [{ group_id: 1, vrrp_instance: [1] }],
      interfaces_GigabitEthernet: [
        {
          name: 'GigabitEthernet 0/8/0',
          ipv4_static: '12.1.1.2/24',
          ipv6_nd_proxy: '240e::301',
          vrrp: [{ vrid: 1, auth_pass: '654321', priority: 200 }],
        },
      ],
    };
    const stripped = stripHaVrrpSlice(input) as Record<string, unknown>;
    expect(stripped.vrrp).toBeUndefined();
    const ifaces = stripped.interfaces_GigabitEthernet as Array<Record<string, unknown>>;
    expect(ifaces[0].vrrp).toBeUndefined();
    expect(ifaces[0].ipv6_nd_proxy).toBe('240e::301');
    expect(ifaces[0].ipv4_static).toBe('12.1.1.2/24');
    expect(input.vrrp).toHaveLength(1);
  });

  it('stitchHaVrrpSlice restores HA vrrp onto VRRP-free SRv6 formula', () => {
    const formula = {
      bgp: [{ asn: 65001 }],
      interfaces_GigabitEthernet: [{ name: 'GigabitEthernet 0/8/0', ipv4_static: '34.1.1.3/24' }],
    };
    const source = {
      vrrp: [{ group_id: 1, vrrp_instance: [1] }],
      interfaces_GigabitEthernet: [
        {
          name: 'GigabitEthernet0/8/0',
          ipv4_static: '34.1.1.3/24',
          vrrp: [{ vrid: 1, priority: 200, auth_pass: '654321' }],
        },
      ],
      bgp: [{ asn: 999 }],
    };
    const ledger = stitchHaVrrpSlice(formula, source);
    expect(ledger.bgp).toEqual([{ asn: 65001 }]);
    expect(ledger.vrrp).toEqual([{ group_id: 1, vrrp_instance: [1] }]);
    const ifaces = ledger.interfaces_GigabitEthernet as Array<Record<string, unknown>>;
    expect(ifaces[0].vrrp).toEqual([{ vrid: 1, priority: 200, auth_pass: '654321' }]);
    expect(ifaces[0].ipv4_static).toBe('34.1.1.3/24');
  });

  it('stitchHaVrrpSlice does not invent vrrp when source has none', () => {
    const formula = {
      interfaces_GigabitEthernet: [
        { name: 'GigabitEthernet 0/8/0', ipv4_static: '1.1.1.1/24', vrrp: [{ vrid: 9 }] },
      ],
      vrrp: [{ group_id: 9 }],
    };
    const ledger = stitchHaVrrpSlice(formula, {
      interfaces_GigabitEthernet: [{ name: 'GigabitEthernet 0/8/0', ipv4_static: '1.1.1.1/24' }],
    });
    expect(ledger.vrrp).toBeUndefined();
    expect((ledger.interfaces_GigabitEthernet as Array<Record<string, unknown>>)[0].vrrp).toBeUndefined();
  });

  it('freezeSrv6BaselineJson persists SRv6 snapshot without HA vrrp', () => {
    const frozen = JSON.parse(
      freezeSrv6BaselineJson(
        JSON.stringify({
          bgp: [{ asn: 1 }],
          vrrp: [{ group_id: 1 }],
          interfaces_GigabitEthernet: [
            { name: 'GigabitEthernet 0/8/0', ipv4_static: '1.1.1.1/24', vrrp: [{ vrid: 1 }] },
          ],
        }),
      ),
    );
    expect(frozen.vrrp).toBeUndefined();
    expect(frozen.interfaces_GigabitEthernet[0].vrrp).toBeUndefined();
    expect(frozen.interfaces_GigabitEthernet[0].ipv4_static).toBe('1.1.1.1/24');
  });

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
