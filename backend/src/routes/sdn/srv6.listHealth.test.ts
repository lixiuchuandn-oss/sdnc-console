import { summarizeSrv6TunnelHealth } from './srv6.listHealth';

describe('summarizeSrv6TunnelHealth', () => {
  const checkedAt = '2026-07-14T00:00:00.000Z';
  const base = {
    id: 't1',
    peA: 'pe-a',
    peB: 'pe-b',
    ceA: 'ce-a',
    ceB: 'ce-b',
    injectedDelta: {
      peA: { segments: ['fc00:1::/64'] },
      peB: { segments: ['fc00:2::/64'] },
    },
  } as any;

  it('reports ok when endpoints reconcile clean and archive exists', () => {
    const map = new Map([
      ['pe-a', { issues: [] }],
      ['pe-b', { issues: [] }],
      ['ce-a', { issues: [] }],
      ['ce-b', { issues: [] }],
    ]);
    const r = summarizeSrv6TunnelHealth(base, map, checkedAt);
    expect(r.configHealth).toBe('ok');
    expect(r.issueCount).toBe(0);
  });

  it('reports drift when any endpoint has reconcile issues', () => {
    const map = new Map([
      ['pe-a', { issues: [{ code: 'INVARIANT_DRIFT', message: '漂移' }] }],
      ['pe-b', { issues: [] }],
      ['ce-a', { issues: [] }],
      ['ce-b', { issues: [] }],
    ]);
    const r = summarizeSrv6TunnelHealth(base, map as any, checkedAt);
    expect(r.configHealth).toBe('drift');
    expect(r.issueCount).toBe(1);
    expect(r.message).toContain('peA');
  });

  it('reports missing_archive when injectedDelta empty or shell-only', () => {
    const map = new Map([
      ['pe-a', { issues: [] }],
      ['pe-b', { issues: [] }],
      ['ce-a', { issues: [] }],
      ['ce-b', { issues: [] }],
    ]);
    expect(summarizeSrv6TunnelHealth({ ...base, injectedDelta: {} }, map, checkedAt).configHealth).toBe(
      'missing_archive',
    );
    expect(
      summarizeSrv6TunnelHealth(
        { ...base, injectedDelta: { peA: {}, peB: { segments: [] } } },
        map,
        checkedAt,
      ).configHealth,
    ).toBe('missing_archive');
  });

  it('reports endpoint_missing when slot empty', () => {
    const map = new Map();
    const r = summarizeSrv6TunnelHealth(
      { ...base, peB: '', injectedDelta: { peA: { segments: [1] } } },
      map,
      checkedAt,
    );
    expect(r.configHealth).toBe('endpoint_missing');
    expect(r.message).toContain('peB');
  });
});
