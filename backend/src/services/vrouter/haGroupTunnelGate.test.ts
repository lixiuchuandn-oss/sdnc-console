import {
  buildHaMemberTunnelEndpointWarnings,
  findOppositeCePairTunnelNames,
  type Srv6TunnelEndpointLite,
} from './haGroupTunnelGate';

const tunnels: Srv6TunnelEndpointLite[] = [
  {
    id: 't1',
    name: 'test-20261106',
    peA: 'pe1',
    peB: 'pe2',
    ceA: 'ce1',
    ceB: 'ce3',
  },
  {
    id: 't2',
    name: 'test-20261111',
    peA: 'pe3',
    peB: 'pe4',
    ceA: 'ce2',
    ceB: 'ce4',
  },
];

describe('haGroupTunnelGate', () => {
  it('findOppositeCePairTunnelNames blocks same-tunnel CE-A/CE-B pair', () => {
    expect(findOppositeCePairTunnelNames(tunnels, 'ce1', 'ce3')).toEqual(['test-20261106']);
    expect(findOppositeCePairTunnelNames(tunnels, 'ce3', 'ce1')).toEqual(['test-20261106']);
    expect(findOppositeCePairTunnelNames(tunnels, 'ce1', 'ce2')).toEqual([]);
  });

  it('buildHaMemberTunnelEndpointWarnings soft-warns when CE already endpoint', () => {
    const warnings = buildHaMemberTunnelEndpointWarnings(tunnels, 'ce1', 'ce2');
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('主节点');
    expect(warnings[0]).toContain('test-20261106');
    expect(warnings[0]).toContain('HA 组');
    expect(warnings[1]).toContain('备节点');
    expect(warnings[1]).toContain('test-20261111');
  });

  it('buildHaMemberTunnelEndpointWarnings empty when no tunnel refs', () => {
    expect(buildHaMemberTunnelEndpointWarnings(tunnels, 'ce-x', 'ce-y')).toEqual([]);
  });
});
