import { interpretCephClusterProbe } from './cloudmapStorageDashboardProbe';

describe('cloudmapStorageDashboardProbe', () => {
  it('returns longhorn for empty or invalid payload', () => {
    expect(interpretCephClusterProbe(null)).toBe('longhorn');
    expect(interpretCephClusterProbe({ data: [] })).toBe('longhorn');
  });

  it('returns ceph when cluster list is non-empty', () => {
    expect(interpretCephClusterProbe({ data: [{ metadata: { name: 'rook-ceph' } }] })).toBe('ceph');
    expect(interpretCephClusterProbe({ items: [{ metadata: { name: 'rook-ceph' } }] })).toBe('ceph');
  });

  it('returns forbidden when tower hint says so', () => {
    expect(interpretCephClusterProbe({ _tower: { cephHint: 'forbidden' }, data: [{ x: 1 }] })).toBe(
      'forbidden',
    );
  });
});
