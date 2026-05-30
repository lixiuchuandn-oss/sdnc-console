import { derivePanelLoadState, deriveQueryLoadState } from './panelLoadState';
import type { PromQueryResult } from '../hooks/usePromQueries';

function mockResult(partial: Partial<PromQueryResult> & Pick<PromQueryResult, 'key' | 'expr'>): PromQueryResult {
  return {
    series: [],
    loading: false,
    ...partial,
  };
}

describe('panelLoadState', () => {
  it('treats loading without cached series as initial load', () => {
    expect(
      deriveQueryLoadState(
        mockResult({ key: 'a', expr: 'up', loading: true, series: [] }),
      ),
    ).toEqual({ initialLoading: true, refreshing: false });
  });

  it('treats loading with cached series as refresh', () => {
    expect(
      deriveQueryLoadState(
        mockResult({
          key: 'a',
          expr: 'up',
          loading: true,
          series: [{ metric: {}, values: [[1, 1]] }],
        }),
      ),
    ).toEqual({ initialLoading: false, refreshing: true });
  });

  it('merges panel query states', () => {
    expect(
      derivePanelLoadState([
        mockResult({ key: 'a', expr: 'a', loading: true, series: [{ metric: {}, values: [[1, 2]] }] }),
        mockResult({ key: 'b', expr: 'b', loading: false, series: [] }),
      ]),
    ).toEqual({ initialLoading: false, refreshing: true });
  });
});
