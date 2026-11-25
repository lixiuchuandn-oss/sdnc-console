import { buildP2pTopology } from './buildTopology';
import { buildStatusMap, relatedIds, tunnelStatus, worst } from './status';

const topo = buildP2pTopology(
  { id: 't1', name: 't1', peA: 'A', peB: 'B', ceA: 'CA', ceB: 'CB', tunnelTopology: 'S' },
  't1',
);

describe('topology status', () => {
  it('worst picks highest severity', () => {
    expect(worst(['ok', 'repaired', 'ok'])).toBe('repaired');
    expect(worst(['ok', 'issue', 'repaired'])).toBe('issue');
    expect(worst([])).toBe('unknown');
  });

  it('no report => unknown; listed-without-issue/unlisted => ok', () => {
    expect(buildStatusMap(topo, null).A.status).toBe('unknown');
    const map = buildStatusMap(topo, {
      scanned: 2,
      withIssues: 1,
      repaired: 0,
      items: [{ vrUuid: 'CB', tunnelCount: 1, issues: [{ code: 'X', message: 'm' }], repaired: false, repairActions: [] }],
    });
    expect(map.A.status).toBe('ok');
    expect(map.CB.status).toBe('issue');
    // 四端中 CE-B 异常 → 隧道异常
    expect(tunnelStatus(topo, 't1', map)).toBe('issue');
  });

  it('relatedIds covers tunnel, both PEs and CEs', () => {
    const ids = relatedIds(topo, { kind: 'tunnel', id: 't1' })!;
    ['t:t1', 'pe:A', 'pe:B', 'ce:CA', 'ce:CB'].forEach((id) => expect(ids.has(id)).toBe(true));
    expect(relatedIds(topo, null)).toBeNull();
  });
});
