/**
 * SRv6 隧道运行态叠加（R3）：流量标签 / BGP 颜色。
 * 设计：docs/ibr-srv6-runtime-topology.md §4.2 / §5.3
 * 口径：流量为对端 SRv6 localsid 解封装计数，不代表 CE 间连通。
 */
import type {
  Srv6DirectionTraffic,
  Srv6LinkHealth,
  Srv6RuntimeAttach,
  Srv6RuntimeNode,
  Srv6TopologyRuntimeResp,
  Srv6VbrasState,
  Srv6VrrpRole,
} from '../../../../../../services/api';

export type TunnelRuntime = Srv6TopologyRuntimeResp['tunnels'][string];
export type NodeRuntime = Srv6RuntimeNode;
export type AttachRuntime = Srv6RuntimeAttach;

export const BGP_UP_STROKE = '#00b42a';
export const BGP_DOWN_STROKE = '#f53f3f';

/** 自动刷新间隔：设计要求 ≥10s，默认关闭，开启后 15s */
export const AUTO_REFRESH_MS = 15_000;

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

export function directionHasBad(d?: Srv6DirectionTraffic): boolean {
  return (d?.badDelta ?? 0) > 0;
}

export function hasBadTraffic(rt?: TunnelRuntime): boolean {
  if (!rt) return false;
  return directionHasBad(rt.directions.aToB) || directionHasBad(rt.directions.bToA);
}

/** 运行态 stroke：Bad Δ>0 或公网 BGP down → 红；BGP up → 绿；否则不覆盖 */
export function runtimeStroke(rt?: TunnelRuntime): string | undefined {
  if (!rt) return undefined;
  if (rt.publicBgp === 'down' || hasBadTraffic(rt)) return BGP_DOWN_STROKE;
  if (rt.publicBgp === 'up') return BGP_UP_STROKE;
  return undefined;
}

export function attachStroke(att?: AttachRuntime): string | undefined {
  if (!att) return undefined;
  if (att.privateBgp === 'down') return BGP_DOWN_STROKE;
  if (att.privateBgp === 'up') return BGP_UP_STROKE;
  return undefined;
}

export function attachLiveLabel(att?: AttachRuntime): string | undefined {
  if (!att) return undefined;
  const parts = [privateBgpText(att.privateBgp)];
  if (att.vrf) parts.push(`VRF ${att.vrf}`);
  if (att.prefixReceived != null) parts.push(`前缀 ${att.prefixReceived}`);
  return parts.join(' · ');
}

export const TRAFFIC_TIP =
  '流量为隧道两端入向解封装计数按采样间隔折算的速率，不代表 CE 间连通；连通性以健康巡检为准。→ 为到对端方向，← 为到本端方向。';

export function edgeTrafficTip(rt?: TunnelRuntime): string {
  const rates = trafficSubLabel(rt);
  return rates ? `${rates}\n${TRAFFIC_TIP}` : TRAFFIC_TIP;
}

export function vbrasText(v?: Srv6VbrasState): string | undefined {
  if (v === 'running') return 'vbras 运行';
  if (v === 'stopped') return 'vbras 停止';
  return undefined;
}

export function vrrpText(role?: Srv6VrrpRole): string | undefined {
  if (role === 'master') return '主';
  if (role === 'backup') return '备';
  return undefined;
}

export function publicBgpText(h?: Srv6LinkHealth): string {
  if (h === 'up') return '公网 BGP 正常';
  if (h === 'down') return '公网 BGP 异常';
  return '公网 BGP 未知';
}

export function privateBgpText(h?: Srv6LinkHealth): string {
  if (h === 'up') return '私网 BGP 正常';
  if (h === 'down') return '私网 BGP 异常';
  return '私网 BGP 未知';
}

export function attachKey(peUuid: string, ceUuid: string): string {
  return `${String(peUuid || '').trim()}|${String(ceUuid || '').trim()}`;
}
