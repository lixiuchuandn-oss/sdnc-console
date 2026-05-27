import { buildIpPoolCreatePayload, extractIpPoolNamespaceNames } from './ippoolCreateModalUtils';

describe('ippoolCreateModalUtils', () => {
  it('builds cidr payload', () => {
    const payload = buildIpPoolCreatePayload({
      name: 'pool-a',
      namespace: 'proj-1',
      type: 'cidr',
      cidr: '192.168.1.0/24',
    });
    expect(payload.metadata.name).toBe('pool-a');
    expect(payload.spec.cidrs).toEqual(['192.168.1.0/24']);
    expect(payload.spec.selector.scope).toEqual([{ namespace: 'proj-1' }]);
  });

  it('builds range payload', () => {
    const payload = buildIpPoolCreatePayload({
      name: 'pool-b',
      namespace: 'default',
      type: 'range',
      start: '10.0.0.10',
      end: '10.0.0.20',
      rangeSubnet: '10.0.0.0/24',
      rangeGateway: '10.0.0.1',
    });
    expect(payload.spec.ranges).toEqual([
      {
        start: '10.0.0.10',
        end: '10.0.0.20',
        subnet: '10.0.0.0/24',
        gateway: '10.0.0.1',
      },
    ]);
  });

  it('extracts namespace names', () => {
    const names = extractIpPoolNamespaceNames({
      data: { items: [{ metadata: { name: 'default' } }, { metadata: { name: 'proj-1' } }] },
    });
    expect(names).toEqual(['default', 'proj-1']);
  });
});
