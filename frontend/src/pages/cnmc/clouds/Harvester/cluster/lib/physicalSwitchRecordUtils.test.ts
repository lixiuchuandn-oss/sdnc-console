import type { HmsSwitchCr } from 'services/harvester/cluster';
import {
  buildPerformanceMetrics,
  hmsSwitchCrManagementHost,
  isH3cSwitchRecord,
  matchAswProbeRecordByCr,
  parseSwitchDisplayNameFromInfoLines,
  parseSwitchProductModelFromInfoLines,
  switchRecordManagementHost,
} from './physicalSwitchRecordUtils';

describe('physicalSwitchRecordUtils', () => {
  const switchCr: HmsSwitchCr = {
    metadata: { name: 'sw-core-1' },
    spec: { primaryHost: '192.168.1.10', hosts: ['192.168.1.10'] },
  };

  describe('hmsSwitchCrManagementHost', () => {
    it('prefers primaryHost over hosts[0]', () => {
      expect(hmsSwitchCrManagementHost(switchCr)).toBe('192.168.1.10');
    });
  });

  describe('switchRecordManagementHost', () => {
    it('reads host from nested probe sections', () => {
      expect(
        switchRecordManagementHost({
          info: { host: '192.168.1.10' },
        }),
      ).toBe('192.168.1.10');
    });

    it('returns em dash when host missing', () => {
      expect(switchRecordManagementHost({})).toBe('—');
    });
  });

  describe('matchAswProbeRecordByCr', () => {
    it('matches probe item by management host', () => {
      const probe = { info: { host: '192.168.1.10' }, productModel: 'S5560' };
      expect(matchAswProbeRecordByCr([probe], switchCr)).toBe(probe);
    });

    it('returns null when no host on CR', () => {
      expect(matchAswProbeRecordByCr([{ info: { host: '1.1.1.1' } }], { spec: {} })).toBeNull();
    });
  });

  describe('parseSwitchDisplayNameFromInfoLines', () => {
    it('parses WOS Name from winicssec dump', () => {
      const name = parseSwitchDisplayNameFromInfoLines([
        {
          stdout: 'winicssec WES7100\nName: DRAGON\nDescription: long text',
        },
      ]);
      expect(name).toBe('DRAGON');
    });

    it('parses Hostname from generic dump', () => {
      const name = parseSwitchDisplayNameFromInfoLines([
        { stdout: 'System Information\nHostname: core-sw-01\n' },
      ]);
      expect(name).toBe('core-sw-01');
    });
  });

  describe('parseSwitchProductModelFromInfoLines', () => {
    it('parses H3C BOARD TYPE when vendor is H3C', () => {
      expect(
        parseSwitchProductModelFromInfoLines(
          [
            {
              stdout:
                'Slot 1 CPU 0:\nDEVICE_NAME          : S5560X-54C-EI\nBOARD TYPE           : S5560X-54C-EI\n',
            },
          ],
          { vendor: 'H3C' },
        ),
      ).toBe('S5560X-54C-EI');
    });

    it('prefers H3C BOARD TYPE over H3C Switch line when vendor is H3C', () => {
      expect(
        parseSwitchProductModelFromInfoLines(
          [
            {
              stdout: 'H3C Comware Platform Software\nBOARD TYPE: S5130S-28F-EI\nH3C S5130S Switch',
            },
          ],
          { vendor: 'H3C' },
        ),
      ).toBe('S5130S-28F-EI');
    });

    it('does not use BOARD TYPE when vendor is not H3C', () => {
      expect(
        parseSwitchProductModelFromInfoLines(
          [{ stdout: 'BOARD TYPE: S5560X-54C-EI\nHUAWEI S5720 Routing Switch' }],
          { vendor: '华为' },
        ),
      ).toBe('S5720');
    });
  });

  describe('buildPerformanceMetrics · H3C', () => {
    it('parses display cpu-usage and display memory for H3C Comware', () => {
      const record = {
        info: { lines: [{ stdout: 'H3C Comware Software\nBOARD TYPE: S6800-54QF\n' }] },
        performance: {
          lines: [
            {
              command: 'display cpu-usage',
              stdout: 'Slot 1 CPU 0 CPU usage:\n      18% in last 5 seconds\n',
            },
            {
              command: 'display memory',
              stdout: 'Mem:       2024320   1324704    699616         0      2480    299008       35.2%\n',
            },
          ],
        },
      };
      expect(isH3cSwitchRecord(record)).toBe(true);
      const metrics = buildPerformanceMetrics(record);
      expect(metrics.cpu).toBe('18%');
      expect(metrics.memory).toBe('65.4%');
    });
  });
});
