import {
  filterClusterNetworksForTable,
  isClusterNetworkReady,
  type ClusterNetworkRow,
} from './networksSectionUtils';

const baseRow = (name: string, ready: boolean): ClusterNetworkRow => ({
  metadata: { name },
  status: ready
    ? { conditions: [{ type: 'Ready', status: 'True' }] }
    : { conditions: [{ type: 'Ready', status: 'False' }] },
});

describe('networksSectionUtils', () => {
  it('isClusterNetworkReady detects Ready=True', () => {
    expect(isClusterNetworkReady(baseRow('net-a', true))).toBe(true);
    expect(isClusterNetworkReady(baseRow('net-b', false))).toBe(false);
  });

  it('filterClusterNetworksForTable filters by keyword and status', () => {
    const rows = [baseRow('prod-net', true), baseRow('dev-net', false)];
    expect(
      filterClusterNetworksForTable(rows, { keyword: 'prod', statusFilter: '' }),
    ).toHaveLength(1);
    expect(
      filterClusterNetworksForTable(rows, { keyword: '', statusFilter: 'active' }),
    ).toHaveLength(1);
    expect(
      filterClusterNetworksForTable(rows, { keyword: '', statusFilter: 'unknown' }),
    ).toHaveLength(1);
  });
});
