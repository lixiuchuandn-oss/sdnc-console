import { collectVrPhysicalInterfaces } from './vrListDisplay';

describe('collectVrPhysicalInterfaces', () => {
  const ge70 = {
    name: 'GigabitEthernet 0/7/0',
    receivePacketsPerSecond: 4,
    receiveRateBps: 566,
    transmitPacketsPerSecond: 0,
    transmitRateBps: 0,
  };
  const ge80 = {
    name: 'GigabitEthernet 0/8/0',
    receivePacketsPerSecond: 4,
    receiveRateBps: 402,
    transmitPacketsPerSecond: 0,
    transmitRateBps: 0,
  };

  it('keeps one copy when the list row spreads VR3 and also keeps vr3_info', () => {
    const extended = { interfaces: [ge70, ge80] };
    const row = { ...extended, vr3_info: extended };
    const names = collectVrPhysicalInterfaces(row).map((iface) => iface.name);
    expect(names).toEqual(['GigabitEthernet 0/7/0', 'GigabitEthernet 0/8/0']);
    const rxPps = collectVrPhysicalInterfaces(row).reduce(
      (sum, iface) => sum + Number(iface.receivePacketsPerSecond || 0),
      0,
    );
    expect(rxPps).toBe(8);
  });

  it('treats spaced and compact interface names as the same port', () => {
    const row = {
      interfaces: [{ name: 'GigabitEthernet 0/7/0', ipv4_static: '20.1.1.100/24' }],
      interfaces_GigabitEthernet: [
        { name: 'GigabitEthernet0/7/0', receivePacketsPerSecond: 4, receiveRateBps: 566 },
      ],
    };
    const ifaces = collectVrPhysicalInterfaces(row);
    expect(ifaces).toHaveLength(1);
    expect(ifaces[0].ipv4_static).toBe('20.1.1.100/24');
    expect(ifaces[0].receiveRateBps).toBe(566);
  });

  it('drops non-physical interfaces', () => {
    const row = {
      interfaces: [
        { name: 'Loopback 1', receivePacketsPerSecond: 9 },
        { name: 'GigabitEthernet 0/7/0', receivePacketsPerSecond: 1 },
      ],
    };
    expect(collectVrPhysicalInterfaces(row).map((iface) => iface.name)).toEqual([
      'GigabitEthernet 0/7/0',
    ]);
  });
});
