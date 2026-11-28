import {
  AUTO_REFRESH_MS,
  BGP_DOWN_STROKE,
  BGP_UP_STROKE,
  attachKey,
  attachLiveLabel,
  attachStroke,
  directionText,
  edgeTrafficTip,
  formatBps,
  formatPps,
  hasBadTraffic,
  runtimeStroke,
  trafficSubLabel,
} from './runtimeTraffic';

const dir = (over: Partial<{ state: 'active' | 'sampling' | 'not_effective' | 'hub_aggregate'; bps: number; pps: number; badDelta: number }>) => ({
  state: 'active' as const,
  ...over,
});

describe('runtimeTraffic', () => {
  it('formats rates and placeholders', () => {
    expect(formatBps(1_200_000)).toBe('1.20 Mbps');
    expect(formatBps(8000)).toBe('8.0 Kbps');
    expect(formatBps(undefined)).toBe('—');
    expect(formatPps(300)).toBe('300 pps');
    expect(formatPps(1500)).toBe('1.5k pps');
  });

  it('directionText covers all states', () => {
    expect(directionText({ state: 'sampling' })).toBe('采样中');
    expect(directionText({ state: 'not_effective' })).toBe('未生效');
    expect(directionText({ state: 'hub_aggregate' })).toBe('—（Hub 汇总）');
    expect(directionText({ state: 'unknown' })).toBe('未知');
    expect(directionText({ state: 'active', bps: 8000, pps: 100 })).toBe('8.0 Kbps / 100 pps');
  });

  it('trafficSubLabel and tip', () => {
    const rt = {
      publicBgp: 'up' as const,
      directions: { aToB: dir({ bps: 1e6, pps: 10 }), bToA: { state: 'sampling' as const } },
    };
    expect(trafficSubLabel(rt)).toBe('→ 1.00 Mbps / 10 pps  ← 采样中');
    expect(edgeTrafficTip(rt)).toContain('→ 1.00 Mbps');
    expect(edgeTrafficTip(rt)).toContain('不代表 CE 间连通');
  });

  it('runtimeStroke: bad/down red, up green', () => {
    expect(runtimeStroke({ publicBgp: 'up', directions: { aToB: dir({}), bToA: dir({}) } })).toBe(BGP_UP_STROKE);
    expect(runtimeStroke({ publicBgp: 'down', directions: { aToB: dir({}), bToA: dir({}) } })).toBe(BGP_DOWN_STROKE);
    expect(
      runtimeStroke({
        publicBgp: 'up',
        directions: { aToB: dir({ badDelta: 2 }), bToA: dir({}) },
      }),
    ).toBe(BGP_DOWN_STROKE);
    expect(hasBadTraffic({ publicBgp: 'up', directions: { aToB: dir({ badDelta: 1 }), bToA: dir({}) } })).toBe(true);
  });

  it('attachStroke and live label', () => {
    expect(attachStroke({ privateBgp: 'up', vrf: '10001', prefixReceived: 7 })).toBe(BGP_UP_STROKE);
    expect(attachStroke({ privateBgp: 'down' })).toBe(BGP_DOWN_STROKE);
    expect(attachLiveLabel({ privateBgp: 'up', vrf: '10001', prefixReceived: 7 })).toBe(
      '私网 BGP 正常 · VRF 10001 · 前缀 7',
    );
    expect(attachKey(' pe ', 'ce')).toBe('pe|ce');
  });

  it('auto-refresh interval is at least 10s', () => {
    expect(AUTO_REFRESH_MS).toBeGreaterThanOrEqual(10_000);
  });
});
