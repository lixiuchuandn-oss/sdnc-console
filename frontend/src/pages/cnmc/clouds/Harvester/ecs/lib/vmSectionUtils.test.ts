import {
  buildTenantOrgFilterOptions,
  filterActiveVmListRows,
  filterRecycledVmListRows,
  getVmInstanceId,
  isVmInRecycleBin,
  matchesActiveVmListRow,
  selectRecycledVmRows,
  sortVmRowsByCreationDesc,
} from './vmSectionUtils';
import { createVmListSafeRead, createVmRecycleBinListSafeRead } from './vmSafeRead';

describe('vmSectionUtils', () => {
  const activeVm = {
    metadata: {
      name: 'vm-a',
      namespace: 'proj-1',
      creationTimestamp: '2026-01-02T00:00:00Z',
    },
    status: { printableStatus: 'Running' },
  };

  const recycledVm = {
    metadata: {
      name: 'vm-bin',
      namespace: 'proj-1',
      finalizers: ['tower.io/recycle-bin'],
      creationTimestamp: '2026-01-01T00:00:00Z',
    },
  };

  const paasVm = {
    metadata: {
      name: 'db-vm',
      namespace: 'proj-1',
      labels: { 'tower.io/paas-managed': 'true' },
    },
  };

  describe('getVmInstanceId', () => {
    it('prefers namespace/name', () => {
      expect(getVmInstanceId(activeVm)).toBe('proj-1/vm-a');
    });

    it('falls back to InstanceId or id', () => {
      expect(getVmInstanceId({ InstanceId: 'legacy-id' })).toBe('legacy-id');
      expect(getVmInstanceId({ id: 'row-id' })).toBe('row-id');
    });
  });

  describe('isVmInRecycleBin / selectRecycledVmRows', () => {
    it('detects recycle-bin finalizer or label', () => {
      expect(isVmInRecycleBin(recycledVm)).toBe(true);
      expect(
        isVmInRecycleBin({
          metadata: { labels: { 'tower.io/recycle-bin': 'true' } },
        }),
      ).toBe(true);
      expect(isVmInRecycleBin(activeVm)).toBe(false);
    });

    it('selects only recycled rows', () => {
      expect(selectRecycledVmRows([activeVm, recycledVm])).toEqual([recycledVm]);
    });
  });

  describe('buildTenantOrgFilterOptions', () => {
    it('builds org -> tenant cascader tree', () => {
      const options = buildTenantOrgFilterOptions([
        {
          metadata: {
            name: 'ns-a',
            annotations: {
              'tower.io/organization': 'org-1',
              'tower.io/tenant': 'tenant-a',
            },
          },
        },
        {
          metadata: {
            name: 'ns-b',
            annotations: {
              'tower.io/organization': 'org-1',
              'tower.io/tenant': 'tenant-b',
            },
          },
        },
      ]);
      expect(options).toHaveLength(1);
      expect(options[0]?.value).toBe('org-1');
      expect(options[0]?.children?.map((c) => c.value)).toEqual(
        expect.arrayContaining(['tenant-a', 'tenant-b']),
      );
    });
  });

  describe('filterActiveVmListRows', () => {
    const safeRead = createVmListSafeRead([], [], []);
    const baseParams = {
      keyword: '',
      statusFilter: '',
      namespaces: [],
      isTenant: false,
      isPublicNamespace: () => false,
      safeRead,
    };

    it('excludes recycle-bin and paas-managed VMs', () => {
      const rows = filterActiveVmListRows([activeVm, recycledVm, paasVm], baseParams);
      expect(rows).toEqual([activeVm]);
    });

    it('filters by keyword and status', () => {
      const rows = filterActiveVmListRows([activeVm], {
        ...baseParams,
        keyword: 'vm-a',
        statusFilter: 'running',
      });
      expect(rows).toHaveLength(1);

      expect(
        matchesActiveVmListRow(activeVm, {
          ...baseParams,
          statusFilter: 'stopped',
        }),
      ).toBe(false);
    });

    it('applies tenant org path', () => {
      const vm = {
        metadata: { name: 'vm-t', namespace: 'ns-t' },
        status: { printableStatus: 'Running' },
      };
      const params = {
        ...baseParams,
        tenantOrgPath: ['org-x'],
        namespaces: [
          {
            metadata: {
              name: 'ns-t',
              annotations: {
                'tower.io/organization': 'org-x',
                'tower.io/tenant': 'tenant-y',
              },
            },
          },
        ],
      };
      expect(matchesActiveVmListRow(vm, params)).toBe(true);
      expect(matchesActiveVmListRow(vm, { ...params, tenantOrgPath: ['org-other'] })).toBe(
        false,
      );
    });
  });

  describe('filterRecycledVmListRows', () => {
    it('filters recycled list by keyword and stopped status', () => {
      const safeRead = createVmRecycleBinListSafeRead([], [], []);
      const vm = {
        metadata: { name: 'vm-r', namespace: 'ns-1', finalizers: ['tower.io/recycle-bin'] },
      };
      expect(
        filterRecycledVmListRows([vm], {
          keyword: 'vm-r',
          statusFilter: 'stopped',
          safeRead,
        }),
      ).toHaveLength(1);
      expect(
        filterRecycledVmListRows([vm], {
          keyword: 'missing',
          safeRead,
        }),
      ).toHaveLength(0);
    });
  });

  describe('sortVmRowsByCreationDesc', () => {
    it('sorts by creationTimestamp descending', () => {
      const sorted = sortVmRowsByCreationDesc([recycledVm, activeVm]);
      expect(sorted[0]).toBe(activeVm);
      expect(sorted[1]).toBe(recycledVm);
    });
  });
});
