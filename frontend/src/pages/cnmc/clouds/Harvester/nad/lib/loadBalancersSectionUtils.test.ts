import {
  buildLoadBalancerIpamOptions,
  buildLoadBalancerNamespaceOptions,
  filterLoadBalancersForTable,
  normalizeLoadBalancerList,
  splitLoadBalancersForBatchDelete,
} from './loadBalancersSectionUtils';

describe('loadBalancersSectionUtils', () => {
  const raw = {
    metadata: {
      uid: 'uid-1',
      name: 'lb-a',
      namespace: 'proj-1',
      creationTimestamp: '2026-01-01T00:00:00Z',
    },
    spec: {
      ipam: 'pool',
      listeners: [{ port: 80, backendPort: 8080, protocol: 'TCP' }],
    },
    status: { address: '10.0.0.1' },
  };

  it('normalizes load balancer rows', () => {
    const rows = normalizeLoadBalancerList([raw]);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('lb-a');
    expect(rows[0].listeners).toBe('80:8080/TCP');
    expect(rows[0].address).toBe('10.0.0.1');
  });

  it('filters by keyword and namespace', () => {
    const rows = normalizeLoadBalancerList([
      raw,
      {
        ...raw,
        metadata: { ...raw.metadata, uid: 'uid-2', name: 'lb-b', namespace: 'proj-2' },
      },
    ]);
    const filtered = filterLoadBalancersForTable(rows, {
      keyword: 'lb-b',
      nsFilter: '',
      ipamFilter: '',
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].name).toBe('lb-b');

    const byNs = filterLoadBalancersForTable(rows, {
      keyword: '',
      nsFilter: 'proj-1',
      ipamFilter: '',
    });
    expect(byNs).toHaveLength(1);
    expect(byNs[0].namespace).toBe('proj-1');
  });

  it('builds namespace and ipam options', () => {
    const rows = normalizeLoadBalancerList([raw]);
    expect(buildLoadBalancerNamespaceOptions(rows)).toEqual([
      { label: 'proj-1', value: 'proj-1' },
    ]);
    expect(buildLoadBalancerIpamOptions(rows)).toEqual([{ label: 'pool', value: 'pool' }]);
  });

  it('splits batch delete targets for tenant public ns', () => {
    const split = splitLoadBalancersForBatchDelete(
      [
        { namespace: 'proj-1' },
        { namespace: 'kube-system' },
        { namespace: 'harvester-public' },
      ],
      {
        isTenant: true,
        isPublicNamespace: (ns) => ns === 'harvester-public',
        isSystemNamespace: (ns) => ns === 'kube-system',
      },
    );
    expect(split.deletableTargets).toHaveLength(1);
    expect(split.systemTargets).toHaveLength(1);
    expect(split.publicTargets).toHaveLength(1);
  });
});
