import type { HmsSwitchCr } from 'services/harvester/cluster';
import {
  hmsSwitchCrManagementHost,
  matchAswProbeRecordByCr,
  parseSwitchDisplayNameFromInfoLines,
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
});
