import {
  findNodeLldpForAswPort,
  lldpRowMatchesAswSwitchPort,
  normalizeManagementAddressForLink,
  portNamesLogicallyEqual,
} from './lldpSwitchLinkUtils';

describe('lldpSwitchLinkUtils', () => {
  const lldpRow = {
    Interface: 'eth0',
    'Management Address_IPv4': '192.168.1.10',
    'Port Description': 'GigabitEthernet0/0/1',
  };

  describe('normalizeManagementAddressForLink', () => {
    it('strips zone id and CIDR suffix', () => {
      expect(normalizeManagementAddressForLink('192.168.1.10%eth0')).toBe('192.168.1.10');
      expect(normalizeManagementAddressForLink('192.168.1.10/24')).toBe('192.168.1.10');
    });
  });

  describe('portNamesLogicallyEqual', () => {
    it('matches GE and GigabitEthernet aliases', () => {
      expect(portNamesLogicallyEqual('GigabitEthernet0/0/1', 'GE0/0/1')).toBe(true);
    });

    it('does not match different slot triplets', () => {
      expect(portNamesLogicallyEqual('GigabitEthernet0/0/10', 'GE0/0/1')).toBe(false);
    });
  });

  describe('lldpRowMatchesAswSwitchPort', () => {
    it('requires management IP and port name both match', () => {
      expect(lldpRowMatchesAswSwitchPort(lldpRow, '192.168.1.10', 'GE0/0/1')).toBe(true);
      expect(lldpRowMatchesAswSwitchPort(lldpRow, '10.0.0.1', 'GE0/0/1')).toBe(false);
      expect(lldpRowMatchesAswSwitchPort(lldpRow, '192.168.1.10', 'GE0/0/2')).toBe(false);
    });
  });

  describe('findNodeLldpForAswPort', () => {
    it('finds node and local interface from HMS hardware.switch rows', () => {
      const hit = findNodeLldpForAswPort(
        [
          {
            metadata: { name: 'node-a' },
            hardware: { switch: [lldpRow] },
          },
        ],
        '192.168.1.10',
        'GE0/0/1',
      );
      expect(hit?.nodeName).toBe('node-a');
      expect(hit?.localInterface).toBe('eth0');
    });

    it('returns null when no match', () => {
      expect(findNodeLldpForAswPort([], '192.168.1.10', 'GE0/0/1')).toBeNull();
    });
  });
});
