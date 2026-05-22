import type { HmsSwitchCr } from 'services/harvester/cluster';
import {
  apiErrorMessage,
  buildSwitchTableRows,
  buildVendorFilterOptions,
  countMatchedProbeRows,
  filterSwitchTableRows,
  probeMetaFromSummaryResponse,
} from './physicalSwitchesSectionUtils';

const mockSwitchA: HmsSwitchCr = {
  metadata: { name: 'sw-a' },
  spec: {
    vendor: 'H3C',
    primaryHost: '10.0.0.1',
    deviceProfile: 'profile-a',
  },
};

const mockSwitchB: HmsSwitchCr = {
  metadata: { name: 'sw-b' },
  spec: {
    vendor: 'Huawei',
    primaryHost: '10.0.0.2',
    deviceProfile: 'profile-b',
  },
};

describe('physicalSwitchesSectionUtils', () => {
  describe('buildSwitchTableRows', () => {
    it('merges probe match onto each CR row', () => {
      const probeItems = [{ info: { host: '10.0.0.1' }, productModel: 'S5560' }];
      const rows = buildSwitchTableRows([mockSwitchA, mockSwitchB], probeItems);
      expect(rows).toHaveLength(2);
      expect(rows[0]._probe).not.toBeNull();
      expect(rows[1]._probe).toBeNull();
    });
  });

  describe('countMatchedProbeRows', () => {
    it('counts rows with non-null probe', () => {
      const rows = buildSwitchTableRows([mockSwitchA, mockSwitchB], [{ info: { host: '10.0.0.1' } }]);
      expect(countMatchedProbeRows(rows)).toBe(1);
    });
  });

  describe('buildVendorFilterOptions', () => {
    it('returns sorted unique vendors', () => {
      const opts = buildVendorFilterOptions([mockSwitchA, mockSwitchB, mockSwitchA]);
      expect(opts).toEqual([
        { label: 'H3C', value: 'H3C' },
        { label: 'Huawei', value: 'Huawei' },
      ]);
    });
  });

  describe('filterSwitchTableRows', () => {
    const rows = buildSwitchTableRows([mockSwitchA, mockSwitchB], []);

    it('filters by vendor', () => {
      const filtered = filterSwitchTableRows(rows, '', 'H3C');
      expect(filtered).toHaveLength(1);
      expect(filtered[0].metadata?.name).toBe('sw-a');
    });

    it('filters by keyword on name and host', () => {
      expect(filterSwitchTableRows(rows, 'sw-b', '')).toHaveLength(1);
      expect(filterSwitchTableRows(rows, '10.0.0.1', '')).toHaveLength(1);
      expect(filterSwitchTableRows(rows, 'profile-b', '')).toHaveLength(1);
    });
  });

  describe('probeMetaFromSummaryResponse', () => {
    it('maps cache metadata fields', () => {
      expect(
        probeMetaFromSummaryResponse({ cacheSyncedAt: '2026-01-01', source: 'cache' }),
      ).toEqual({
        cacheSyncedAt: '2026-01-01',
        source: 'cache',
      });
    });
  });

  describe('apiErrorMessage', () => {
    it('prefers response message', () => {
      const err = { response: { data: { message: 'bad request' } }, message: 'fallback' };
      expect(apiErrorMessage(err, 'default')).toBe('bad request');
    });

    it('falls back to Error.message then default', () => {
      expect(apiErrorMessage(new Error('network'), 'default')).toBe('network');
      expect(apiErrorMessage({}, 'default')).toBe('default');
    });
  });
});
