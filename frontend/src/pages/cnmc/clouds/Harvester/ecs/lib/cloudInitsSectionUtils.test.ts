import {
  filterCloudInitsForTable,
  mapCloudInitsToTableRows,
} from './cloudInitsSectionUtils';

describe('cloudInitsSectionUtils', () => {
  it('mapCloudInitsToTableRows reads metadata from rawData', () => {
    const rows = mapCloudInitsToTableRows([
      {
        rawData: {
          metadata: {
            uid: 'u1',
            name: 'ci-a',
            namespace: 'ns1',
            creationTimestamp: '2024-01-01T00:00:00Z',
            annotations: { 'harvesterhci.io/cloud-init-template-description': 'desc' },
          },
        },
      },
    ]);
    expect(rows[0].name).toBe('ci-a');
    expect(rows[0].description).toBe('desc');
  });

  it('filterCloudInitsForTable filters by keyword', () => {
    const rows = mapCloudInitsToTableRows([
      { rawData: { metadata: { uid: '1', name: 'alpha', namespace: 'n1' } } },
      { rawData: { metadata: { uid: '2', name: 'beta', namespace: 'n2' } } },
    ]);
    expect(filterCloudInitsForTable(rows, { keyword: 'beta', namespaceFilter: '' })).toHaveLength(1);
  });
});
