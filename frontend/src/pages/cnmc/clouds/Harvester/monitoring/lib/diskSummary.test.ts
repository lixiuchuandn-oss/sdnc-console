import {
  aggregateCephOsdDiskSummary,
  aggregateDiskSummaryFromBlockDevices,
  resolveMonitoringDiskSummary,
} from './diskSummary';

describe('diskSummary', () => {
  describe('aggregateCephOsdDiskSummary', () => {
    it('counts healthy/warning/other OSDs', () => {
      const summary = aggregateCephOsdDiskSummary({
        osd_map: {
          osds: [
            { up: true, in: true },
            { up: false, in: true },
            { foo: 'bar' },
          ],
        },
      });
      expect(summary).toEqual({ healthy: 1, warning: 1, other: 1, total: 3 });
    });

    it('returns null when osd_map missing', () => {
      expect(aggregateCephOsdDiskSummary(null)).toBeNull();
    });
  });

  describe('aggregateDiskSummaryFromBlockDevices', () => {
    it('partitions block devices by phase and error', () => {
      const summary = aggregateDiskSummaryFromBlockDevices({
        data: [
          { status: { provisionPhase: 'Provisioned' }, metadata: { state: { error: false } } },
          { status: { provisionPhase: 'Failed' }, metadata: { state: { error: false } } },
          { metadata: { state: { error: true } } },
          { status: { provisionPhase: 'Discovered' }, metadata: { state: { error: false } } },
        ],
      });
      expect(summary).toEqual({ healthy: 1, warning: 2, other: 1, total: 4 });
    });
  });

  describe('resolveMonitoringDiskSummary', () => {
    it('prefers ceph OSD summary when cluster has ceph and osd_map present', () => {
      const resolved = resolveMonitoringDiskSummary(
        { osd_map: { osds: [{ up: true, in: true }] } },
        { clusters: [{ metadata: { name: 'rook-ceph' } }], blockPools: [] },
        { data: [] },
      );
      expect(resolved?.mode).toBe('ceph_osd');
      expect(resolved?.summary.total).toBe(1);
    });

    it('falls back to block devices when no ceph osd_map', () => {
      const resolved = resolveMonitoringDiskSummary(
        null,
        { clusters: [], blockPools: [] },
        { data: [{ status: { provisionPhase: 'Provisioned' }, metadata: { state: { error: false } } }] },
      );
      expect(resolved?.mode).toBe('block_device');
      expect(resolved?.summary.healthy).toBe(1);
    });
  });
});
