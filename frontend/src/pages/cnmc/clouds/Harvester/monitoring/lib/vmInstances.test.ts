import { parseVMInstancesToStatusCounts } from './vmInstances';

describe('vmInstances', () => {
  const vm = (name: string, ns = 'default', extra: Record<string, unknown> = {}) => ({
    metadata: { name, namespace: ns, ...((extra.metadata as object) || {}) },
    status: extra.status,
  });

  const vmi = (name: string, ns = 'default', extra: Record<string, unknown> = {}) => ({
    metadata: { name, namespace: ns },
    status: extra.status,
  });

  it('counts running VMs via VMI phase', () => {
    const summary = parseVMInstancesToStatusCounts(
      { items: [vm('vm-a')] },
      { items: [vmi('vm-a', 'default', { status: { phase: 'Running' } })] },
    );
    expect(summary.total).toBe(1);
    expect(summary.segments.find((s) => s.key === 'running')?.value).toBe(1);
  });

  it('counts paused VMs', () => {
    const summary = parseVMInstancesToStatusCounts(
      { items: [vm('vm-a')] },
      {
        items: [
          vmi('vm-a', 'default', {
            status: { phase: 'Running', conditions: [{ type: 'Paused' }] },
          }),
        ],
      },
    );
    expect(summary.segments.find((s) => s.key === 'paused')?.value).toBe(1);
  });

  it('counts stopped VMs when VMI absent', () => {
    const summary = parseVMInstancesToStatusCounts(
      { items: [vm('vm-off', 'default', { status: { printableStatus: 'Stopped' } })] },
      { items: [] },
    );
    expect(summary.segments.find((s) => s.key === 'stopped')?.value).toBe(1);
  });

  it('excludes recycle-bin VMs from total', () => {
    const summary = parseVMInstancesToStatusCounts({
      items: [
        vm('keep'),
        vm('bin', 'default', {
          metadata: { labels: { 'tower.io/recycle-bin': 'true' } },
        }),
      ],
    });
    expect(summary.total).toBe(1);
  });

  it('counts deleting VMs as other', () => {
    const summary = parseVMInstancesToStatusCounts({
      items: [vm('del', 'default', { metadata: { deletionTimestamp: '2024-01-01T00:00:00Z' } })],
    });
    expect(summary.segments.find((s) => s.key === 'other')?.value).toBe(1);
  });

  it('builds namespace and node summaries', () => {
    const summary = parseVMInstancesToStatusCounts(
      {
        items: [vm('vm-a', 'ns-a'), vm('vm-b', 'ns-a'), vm('vm-c', 'ns-b')],
      },
      {
        items: [
          vmi('vm-a', 'ns-a', { status: { phase: 'Running', nodeName: 'node-1' } }),
          vmi('vm-b', 'ns-a', { status: { phase: 'Running', nodeName: 'node-2' } }),
        ],
      },
    );
    expect(summary.namespaceSummary).toEqual([
      { name: 'ns-a', value: 2 },
      { name: 'ns-b', value: 1 },
    ]);
    expect(summary.nodeSummary).toEqual([
      { name: 'node-1', value: 1 },
      { name: 'node-2', value: 1 },
      { name: '未分配节点', value: 1 },
    ]);
  });
});
