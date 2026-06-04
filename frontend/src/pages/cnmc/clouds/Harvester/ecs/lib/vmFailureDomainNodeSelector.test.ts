import type { FailureDomainRow } from 'services/harvester/failureDomains';
import {
  buildVmFailureDomainSelectOptions,
  isFailureDomainWithAssignedNodes,
} from './vmFailureDomainNodeSelector';

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

describe('vmFailureDomainNodeSelector select options', () => {
  it('isFailureDomainWithAssignedNodes requires at least one node', () => {
    expect(isFailureDomainWithAssignedNodes(domain({ name: 'a', nodeNames: [] }))).toBe(false);
    expect(isFailureDomainWithAssignedNodes(domain({ name: 'b', nodeNames: ['n1'] }))).toBe(true);
  });

  it('buildVmFailureDomainSelectOptions lists only assigned domains', () => {
    const options = buildVmFailureDomainSelectOptions([
      domain({ name: 'empty', nodeNames: [] }),
      domain({ name: 'rack-a', nodeNames: ['node-1', 'node-2'] }),
    ]);
    expect(options).toEqual([
      { value: 'rack-a', label: 'rack-a（机架 · 2 节点）' },
    ]);
  });

  it('buildVmFailureDomainSelectOptions can include current unassigned domain as disabled', () => {
    const options = buildVmFailureDomainSelectOptions(
      [domain({ name: 'orphan', nodeNames: [] })],
      { extraIncludeNames: ['orphan'] },
    );
    expect(options).toEqual([
      {
        value: 'orphan',
        label: 'orphan（机架 · 无可用节点）',
        disabled: true,
      },
    ]);
  });
});
