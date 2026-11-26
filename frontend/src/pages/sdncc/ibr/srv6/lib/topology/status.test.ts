import { buildP2pTopology } from './buildTopology';
import {
  attachOffline,
  buildRuntimeMap,
  buildStatusMap,
  countOfflineNodes,
  relatedIds,
  tunnelPeOffline,
  tunnelStatus,
  worst,
} from './status';

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

  it('buildRuntimeMap uses same health keys as VR list', () => {
    const map = buildRuntimeMap([
      { uuid: 'A', health_status: 'running' },
      { uuid: 'B', status: 'stopped' },
      { id: 'CA', healthStatus: 'warning' },
      { uuid: '', health_status: 'running' },
    ]);
    expect(map.A).toBe('running');
    expect(map.B).toBe('stopped');
    expect(map.CA).toBe('warning');
    expect(map['']).toBeUndefined();
  });

  it('tunnelPeOffline only looks at PE ends; attachOffline includes CE', () => {
    const rt = buildRuntimeMap([
      { uuid: 'A', health_status: 'running' },
      { uuid: 'B', health_status: 'stopped' },
      { uuid: 'CA', health_status: 'stopped' },
      { uuid: 'CB', health_status: 'running' },
    ]);
    expect(tunnelPeOffline(topo, 't1', rt)).toBe(true);
    expect(attachOffline('A', 'CA', rt)).toBe(true);
    expect(attachOffline('B', 'CB', rt)).toBe(true);
    expect(countOfflineNodes(topo, rt)).toBe(2);

    const peOk = buildRuntimeMap([
      { uuid: 'A', health_status: 'running' },
      { uuid: 'B', health_status: 'running' },
      { uuid: 'CA', health_status: 'stopped' },
    ]);
    expect(tunnelPeOffline(topo, 't1', peOk)).toBe(false);
    expect(attachOffline('A', 'CA', peOk)).toBe(true);
  });
});
