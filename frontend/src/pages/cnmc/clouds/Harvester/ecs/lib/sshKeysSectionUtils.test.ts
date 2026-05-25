import {
  buildSshKeyNamespaceOptions,
  filterSshKeysBaseRows,
  filterSshKeysForTable,
  mapSshKeysToTableRows,
  sshKeyRowViewLink,
} from './sshKeysSectionUtils';

describe('sshKeysSectionUtils', () => {
  it('mapSshKeysToTableRows reads metadata from rawData', () => {
    const rows = mapSshKeysToTableRows([
      {
        rawData: {
          metadata: {
            uid: 'u1',
            name: 'key-a',
            namespace: 'ns1',
            creationTimestamp: '2024-01-01T00:00:00Z',
            annotations: { 'tower.io/alias': 'my-key' },
          },
          spec: { fingerprint: 'fp1' },
        },
      },
    ]);
    expect(rows[0].name).toBe('key-a');
    expect(rows[0].alias).toBe('my-key');
    expect(rows[0].fingerprint).toBe('fp1');
  });

  it('filterSshKeysForTable filters by keyword', () => {
    const rows = mapSshKeysToTableRows([
      { rawData: { metadata: { uid: '1', name: 'alpha', namespace: 'n1' } } },
      { rawData: { metadata: { uid: '2', name: 'beta', namespace: 'n2' } } },
    ]);
    expect(filterSshKeysForTable(rows, { keyword: 'beta', namespaceFilter: '' })).toHaveLength(1);
  });

  it('buildSshKeyNamespaceOptions dedupes namespaces', () => {
    const rows = mapSshKeysToTableRows([
      { rawData: { metadata: { uid: '1', name: 'a', namespace: 'proj-a' } } },
      { rawData: { metadata: { uid: '2', name: 'b', namespace: 'proj-a' } } },
    ]);
    expect(buildSshKeyNamespaceOptions(rows)).toEqual([{ value: 'proj-a', label: 'proj-a' }]);
  });

  it('sshKeyRowViewLink builds harvester keypairs path', () => {
    const rows = mapSshKeysToTableRows([
      { rawData: { metadata: { name: 'k1', namespace: 'ns1' } } },
    ]);
    expect(sshKeyRowViewLink(rows[0])).toContain('/keypairs/k1');
  });

  it('filterSshKeysBaseRows hides system namespace for admin', () => {
    const rows = mapSshKeysToTableRows([
      { rawData: { metadata: { uid: '1', name: 'a', namespace: 'kube-system' } } },
      { rawData: { metadata: { uid: '2', name: 'b', namespace: 'tenant-ns' } } },
    ]);
    const filtered = filterSshKeysBaseRows(rows, {
      isTenant: false,
      isPublicNamespace: () => false,
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].namespace).toBe('tenant-ns');
  });
});
