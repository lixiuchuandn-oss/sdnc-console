/**
 * SRv6 隧道运行态叠加（R3）：流量标签 / BGP 颜色。
 * 设计：docs/ibr-srv6-runtime-topology.md §4.2 / §5.3
 * 口径：流量为对端 SRv6 localsid 解封装计数，不代表 CE 间连通。
 */
import type { Srv6DirectionTraffic, Srv6TopologyRuntimeResp } from '../../../../../../services/api';

export type TunnelRuntime = Srv6TopologyRuntimeResp['tunnels'][string];

export const BGP_DOWN_STROKE = '#f53f3f';

export function formatBps(bps?: number): string {
  if (bps == null || !Number.isFinite(bps)) return '—';
  if (bps >= 1e9) return `${(bps / 1e9).toFixed(2)} Gbps`;
  if (bps >= 1e6) return `${(bps / 1e6).toFixed(2)} Mbps`;
  if (bps >= 1e3) return `${(bps / 1e3).toFixed(1)} Kbps`;
  return `${Math.round(bps)} bps`;
}

export function formatPps(pps?: number): string {
  if (pps == null || !Number.isFinite(pps)) return '—';
  return pps >= 1000 ? `${(pps / 1000).toFixed(1)}k pps` : `${Math.round(pps)} pps`;
}

/** 单方向简短文案 */
export function directionText(d?: Srv6DirectionTraffic): string {
  switch (d?.state) {
    case 'active':
      return `${formatBps(d.bps)} / ${formatPps(d.pps)}`;
    case 'sampling':
      return '采样中';
    case 'not_effective':
      return '未生效';
    case 'hub_aggregate':
      return '—（Hub 汇总）';
    default:
      return '未知';
  }
}

/** 边副标题：`→ a  ← b`（A→B 为 source→target） */
export function trafficSubLabel(rt?: TunnelRuntime): string | undefined {
  if (!rt) return undefined;
  return `→ ${directionText(rt.directions.aToB)}  ← ${directionText(rt.directions.bToA)}`;
}

export function hasBadTraffic(rt?: TunnelRuntime): boolean {
  if (!rt) return false;
  return (rt.directions.aToB.badDelta ?? 0) > 0 || (rt.directions.bToA.badDelta ?? 0) > 0;
}

/** 运行态 stroke：公网 BGP down 或 Bad Δ>0 → 红；否则不覆盖 */
export function runtimeStroke(rt?: TunnelRuntime): string | undefined {
  if (!rt) return undefined;
  if (rt.publicBgp === 'down' || hasBadTraffic(rt)) return BGP_DOWN_STROKE;
  return undefined;
}

export const TRAFFIC_TIP = '流量为对端 SRv6 解封装（localsid Good）计数，不代表 CE 间连通；连通性以健康巡检为准。';
