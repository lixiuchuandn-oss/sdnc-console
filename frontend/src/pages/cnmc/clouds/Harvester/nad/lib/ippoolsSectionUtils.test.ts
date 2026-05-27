import { isSystemNamespace } from '../../../../../../utils/harvesterUtils';
import {
  buildIpPoolNamespaceOptions,
  filterIpPoolsForTable,
  isIpPoolDeleteBlockedError,
  normalizeIpPoolList,
  splitIpPoolsForBatchDelete,
} from './ippoolsSectionUtils';

describe('ippoolsSectionUtils', () => {
  const raw = {
    metadata: {
      uid: 'uid-1',
      name: 'pool-a',
      namespace: 'proj-1',
      creationTimestamp: '2026-01-01T00:00:00Z',
    },
    spec: {
      ranges: [{ rangeStart: '10.0.0.1', rangeEnd: '10.0.0.10' }],
      selector: { network: 'net-a' },
    },
  };

  it('normalizes ip pool rows', () => {
    const rows = normalizeIpPoolList([raw]);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('pool-a');
    expect(rows[0].ranges).toBe('10.0.0.1-10.0.0.10');
    expect(rows[0].network).toBe('net-a');
  });

  it('filters by keyword', () => {
    const rows = normalizeIpPoolList([
      raw,
      {
        ...raw,
        metadata: { ...raw.metadata, uid: 'uid-2', name: 'pool-b' },
      },
    ]);
    const filtered = filterIpPoolsForTable(rows, { keyword: 'pool-b', nsFilter: '' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].name).toBe('pool-b');
  });

  it('builds namespace options excluding system ns', () => {
    const rows = normalizeIpPoolList([
      raw,
      {
        ...raw,
        metadata: { ...raw.metadata, uid: 'uid-2', namespace: 'kube-system' },
      },
    ]);
    const opts = buildIpPoolNamespaceOptions(rows, isSystemNamespace);
    expect(opts.map((o) => o.value)).toEqual(['proj-1']);
  });

  it('detects delete blocked error', () => {
    expect(
      isIpPoolDeleteBlockedError("can't delete pool before releasing all the allocated IP"),
    ).toBe(true);
    expect(isIpPoolDeleteBlockedError('other')).toBe(false);
  });

  it('splits batch delete targets', () => {
    const split = splitIpPoolsForBatchDelete(
      [{ namespace: 'proj-1' }, { namespace: 'kube-system' }],
      {
        isTenant: false,
        isPublicNamespace: () => false,
        isSystemNamespace,
      },
    );
    expect(split.deletableTargets).toHaveLength(1);
    expect(split.systemTargets).toHaveLength(1);
  });
});
