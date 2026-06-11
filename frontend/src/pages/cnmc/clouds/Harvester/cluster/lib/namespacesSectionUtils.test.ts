import {
  DEFAULT_NAMESPACE_TYPE_FILTERS,
  filterNamespacesForTable,
  getNamespaceDisplayName,
  namespaceRowToViewLink,
} from './namespacesSectionUtils';

describe('namespacesSectionUtils', () => {
  const publicNs = {
    metadata: { name: 'default', labels: { 'tower.io/scenario': 'public' } },
    status: { phase: 'Active' },
    links: { view: '/api/v1/namespaces/default' },
  };
  const adminNs = {
    metadata: { name: 'tower-admin', labels: { 'tower.io/scenario': 'admin' } },
    status: { phase: 'Active' },
  };
  const tenantNs = {
    metadata: { name: 'tenant-a', labels: { 'tower.io/scenario': 'tenant' } },
    status: { phase: 'Active' },
  };
  const systemNs = {
    metadata: { name: 'kube-system' },
    status: { phase: 'Active' },
  };

  describe('namespaceRowToViewLink', () => {
    it('prefers links.view', () => {
      expect(namespaceRowToViewLink(publicNs)).toBe('/api/v1/namespaces/default');
    });

    it('falls back to api path from name', () => {
      expect(namespaceRowToViewLink({ metadata: { name: 'my-ns' } })).toBe('/api/v1/namespaces/my-ns');
    });
  });

  describe('getNamespaceDisplayName', () => {
    it('reads metadata.name', () => {
      expect(getNamespaceDisplayName(publicNs)).toBe('default');
    });
  });

  describe('filterNamespacesForTable', () => {
    const all = [publicNs, adminNs, tenantNs, systemNs];

    it('default type filters show tenant only and exclude system', () => {
      const rows = filterNamespacesForTable(all, {
        keyword: '',
        filterTypes: [...DEFAULT_NAMESPACE_TYPE_FILTERS],
        filterStatus: '',
      });
      expect(rows.map((r) => r.metadata?.name)).not.toContain('kube-system');
      expect(rows).toHaveLength(1);
      expect(rows[0].metadata?.name).toBe('tenant-a');
    });

    it('filters by type union', () => {
      const rows = filterNamespacesForTable(all, {
        keyword: '',
        filterTypes: ['tenant'],
        filterStatus: '',
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].metadata?.name).toBe('tenant-a');
    });

    it('filters by phase', () => {
      const terminating = {
        metadata: { name: 'gone', labels: { 'tower.io/scenario': 'admin' } },
        status: { phase: 'Terminating' },
      };
      const rows = filterNamespacesForTable([adminNs, terminating], {
        keyword: '',
        filterTypes: ['admin'],
        filterStatus: 'Terminating',
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].metadata?.name).toBe('gone');
    });

    it('matches keyword against name and label keys', () => {
      const tagged = {
        metadata: {
          name: 'proj-x',
          labels: { 'tower.io/scenario': 'admin', env: 'prod' },
        },
        status: { phase: 'Active' },
      };
      expect(
        filterNamespacesForTable([tagged], {
          keyword: 'proj-x',
          filterTypes: ['admin'],
          filterStatus: '',
        }),
      ).toHaveLength(1);
      expect(
        filterNamespacesForTable([tagged], {
          keyword: 'env',
          filterTypes: ['admin'],
          filterStatus: '',
        }),
      ).toHaveLength(1);
    });
  });
});
