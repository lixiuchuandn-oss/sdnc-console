import type { ParsedSwitchPort } from '../../cluster/lib/parseAswCtlInterfaceStdout';
import {
  formatSwitchPortTrafficLine,
  portSortKey,
  splitIntoTwoRows,
} from './embeddedSwitchPortPanelUtils';

function mockPort(overrides: Partial<ParsedSwitchPort> & Pick<ParsedSwitchPort, 'name'>): ParsedSwitchPort {
  return {
    status: 'up',
    rawLine: '',
    ...overrides,
  };
}

describe('embeddedSwitchPortPanelUtils', () => {
  describe('formatSwitchPortTrafficLine', () => {
    it('prefers InUti/OutUti from raw CLI line', () => {
      const line = formatSwitchPortTrafficLine(
        mockPort({
          name: 'GE1/0/1',
          rawLine: 'GE1/0/1 up InUti: 12% OutUti: 3%',
        }),
      );
      expect(line).toBe('入 12% 出 3%');
    });

    it('falls back to speed fields', () => {
      expect(formatSwitchPortTrafficLine(mockPort({ name: 'p1', speed: '1G' }))).toBe('1G');
      expect(
        formatSwitchPortTrafficLine(mockPort({ name: 'p2', detectedSpeedMbps: '1000' })),
      ).toBe('检测 1000 Mbps');
    });
  });

  describe('portSortKey', () => {
    it('uses slot triplet or sentinel', () => {
      expect(portSortKey('GE1/0/3')).toEqual([1, 0, 3]);
      expect(portSortKey('unknown-port')).toEqual([9999, 9999, 9999]);
    });
  });

  describe('splitIntoTwoRows', () => {
    it('splits odd/even port numbers into top and bottom rows', () => {
      const ports = [
        mockPort({ name: 'GE1/0/2' }),
        mockPort({ name: 'GE1/0/1' }),
        mockPort({ name: 'GE1/0/4' }),
        mockPort({ name: 'GE1/0/3' }),
      ];
      const [top, bottom] = splitIntoTwoRows(ports);
      expect(top.map((p) => p.name)).toEqual(['GE1/0/1', 'GE1/0/3']);
      expect(bottom.map((p) => p.name)).toEqual(['GE1/0/2', 'GE1/0/4']);
    });
  });
});
