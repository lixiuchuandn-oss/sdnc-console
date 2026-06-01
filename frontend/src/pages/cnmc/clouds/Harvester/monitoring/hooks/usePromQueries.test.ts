import { resolveChartTimeBoundsMs } from './usePromQueries';

describe('resolveChartTimeBoundsMs', () => {
  it('uses fetched window when available', () => {
    expect(
      resolveChartTimeBoundsMs({ start: 100, end: 200 }, { start: 50, end: 150 }),
    ).toEqual({ chartMin: 50_000, chartMax: 150_000 });
  });

  it('falls back to resolved before first fetch completes', () => {
    expect(resolveChartTimeBoundsMs({ start: 100, end: 200 }, null)).toEqual({
      chartMin: 100_000,
      chartMax: 200_000,
    });
  });
});
