import {
  assessVmMigrateEligibility,
  buildHarvesterNadTypeMap,
  buildVmAliasPatch,
  buildVmImportantTogglePatch,
  countMatchingHarvesterNodes,
  formatVmListTimestamp,
  isVmDeletionProtected,
  isVmHostnamePinned,
  isVmMigrateNetworkBlocked,
  listVmPvcClaimNames,
  partitionVmBatchRecycleTargets,
  resolveVmNsName,
  summarizeBatchRecycleMessage,
} from './vmSectionActions';

describe('vmSectionActions', () => {
  const safeRead = {
    namespace: (r: any) => r?.metadata?.namespace || '',
    vmId: (r: any) => r?.metadata?.name || '',
  };

  describe('resolveVmNsName', () => {
    it('parses iid or falls back to safeRead', () => {
      expect(resolveVmNsName('ns-a/vm-1', {}, safeRead)).toEqual({ ns: 'ns-a', name: 'vm-1' });
      expect(
        resolveVmNsName('legacy', { metadata: { namespace: 'ns-b', name: 'vm-2' } }, safeRead),
      ).toEqual({ ns: 'ns-b', name: 'vm-2' });
    });
  });

  describe('isVmDeletionProtected', () => {
    it('detects finalizer or important label', () => {
      expect(
        isVmDeletionProtected({ metadata: { finalizers: ['tower.io/deletion-protection'] } }),
      ).toBe(true);
      expect(isVmDeletionProtected({ metadata: { labels: { 'tower.io/important': 'true' } } })).toBe(
        true,
      );
      expect(isVmDeletionProtected({ metadata: {} })).toBe(false);
    });
  });

  describe('buildVmImportantTogglePatch', () => {
    it('adds protection when unprotected', () => {
      const patch = buildVmImportantTogglePatch({ metadata: { finalizers: [] } });
      expect(patch.some((p) => p.path === '/metadata/finalizers/-')).toBe(true);
    });

    it('removes protection when protected', () => {
      const patch = buildVmImportantTogglePatch({
        metadata: { finalizers: ['tower.io/deletion-protection', 'other'] },
      });
      expect(patch.some((p) => p.op === 'remove' && String(p.path).includes('finalizers'))).toBe(
        true,
      );
    });
  });

  describe('buildVmAliasPatch', () => {
    it('returns noop when unchanged', () => {
      expect(
        buildVmAliasPatch({ metadata: { annotations: { 'tower.io/alias': 'a' } } }, 'a'),
      ).toEqual({ kind: 'noop' });
    });

    it('builds add patch for new alias', () => {
      const result = buildVmAliasPatch({ metadata: { annotations: {} } }, 'new-name');
      expect(result.kind).toBe('patch');
    });
  });

  describe('migrate eligibility helpers', () => {
    it('blocks non-running VM', async () => {
      const result = await assessVmMigrateEligibility(
        { status: { printableStatus: 'Stopped' } },
        'cloud-1',
        async () => ({}),
        async () => ({}),
      );
      expect(result).toEqual({ allowed: false, reason: '只有运行中的实例才能进行热迁移' });
    });

    it('blocks hostname pinned VM', async () => {
      const result = await assessVmMigrateEligibility(
        {
          status: { printableStatus: 'Running' },
          spec: { template: { spec: { nodeSelector: { 'kubernetes.io/hostname': 'node-a' } } } },
        },
        'cloud-1',
        async () => ({}),
        async () => ({}),
      );
      expect(result.allowed).toBe(false);
    });

    it('detects hostname pin via affinity', () => {
      expect(
        isVmHostnamePinned({}, {
          nodeSelectorTerms: [
            {
              matchExpressions: [
                { key: 'kubernetes.io/hostname', operator: 'In', values: ['n1'] },
              ],
            },
          ],
        }),
      ).toBe(true);
    });

    it('counts matching nodes', () => {
      expect(
        countMatchingHarvesterNodes(
          { role: 'worker' },
          [{ metadata: { labels: { role: 'worker' } } }, { metadata: { labels: { role: 'cp' } } }],
        ),
      ).toBe(1);
    });

    it('blocks sriov/macvtap via NAD map', () => {
      const spec = {
        networks: [{ multus: { networkName: 'ns/nad1' } }],
        domain: { devices: { interfaces: [] } },
      };
      expect(isVmMigrateNetworkBlocked(spec, { 'ns/nad1': 'sriov' })).toBe(true);
    });

    it('builds NAD type map with namespace alias', () => {
      const map = buildHarvesterNadTypeMap(
        [{ metadata: { name: 'nad1', namespace: 'ns1' }, spec: { config: '{"type":"macvtap"}' } }],
        'ns1',
      );
      expect(map['ns1/nad1']).toBe('macvtap');
      expect(map.nad1).toBe('macvtap');
    });
  });

  describe('batch recycle helpers', () => {
    it('partitions protected targets', () => {
      const a = { metadata: {} };
      const b = { metadata: { labels: { 'tower.io/important': 'true' } } };
      const { protectedTargets, deletableTargets } = partitionVmBatchRecycleTargets([a, b]);
      expect(protectedTargets).toEqual([b]);
      expect(deletableTargets).toEqual([a]);
    });

    it('summarizes batch recycle message', () => {
      const msg = summarizeBatchRecycleMessage(
        [{ ok: true, iid: 'ns/vm', name: 'vm' }],
        [{ metadata: { name: 'p' } }],
        (r) => r?.metadata?.name || '',
      );
      expect(msg.success).toContain('成功移入');
      expect(msg.success).toContain('跳过');
    });
  });

  describe('formatVmListTimestamp', () => {
    it('formats valid date', () => {
      expect(formatVmListTimestamp('2026-01-02T03:04:05Z')).toMatch(/^2026-/);
      expect(formatVmListTimestamp(null)).toBe('-');
    });
  });

  describe('listVmPvcClaimNames', () => {
    it('joins pvc claim names', () => {
      const names = listVmPvcClaimNames({
        spec: {
          template: {
            spec: {
              volumes: [{ persistentVolumeClaim: { claimName: 'disk-1' } }],
            },
          },
        },
      });
      expect(names).toBe('disk-1');
    });
  });
});
