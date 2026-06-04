import type { FailureDomainRow } from 'services/harvester/failureDomains';
import { buildFailureDomainAssignableNodeNames } from './failureDomainAssignableNodes';

function domain(partial: Partial<FailureDomainRow> & Pick<FailureDomainRow, 'name'>): FailureDomainRow {
  return {
    id: partial.id ?? 'id-1',
    cloudId: partial.cloudId ?? 'cloud-1',
    name: partial.name,
    domainType: partial.domainType ?? 'rack',
    sortOrder: partial.sortOrder ?? 0,
    nodeNames: partial.nodeNames ?? [],
    description: partial.description,
  };
}

describe('failureDomainAssignableNodes', () => {
  it('includes unassigned nodes and current domain nodes only', () => {
    const names = buildFailureDomainAssignableNodeNames({
      unassignedNodeNames: ['node-c', 'node-a'],
      domain: domain({ name: 'rack-a', nodeNames: ['node-b'] }),
    });
    expect(names).toEqual(['node-a', 'node-b', 'node-c']);
  });

  it('returns empty when no domain and no unassigned nodes', () => {
    expect(
      buildFailureDomainAssignableNodeNames({
        unassignedNodeNames: [],
        domain: null,
      }),
    ).toEqual([]);
  });
});
