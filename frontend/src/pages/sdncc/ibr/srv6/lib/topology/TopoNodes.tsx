/**
 * SRv6 架构拓扑：节点组件 + Srv6Topology → react-flow elements 转换。
 */
import React, { memo } from 'react';
import { Handle, Position, type Edge, type Node, type NodeProps } from 'react-flow-renderer';
import { abbrIfName, type Srv6Topology, type TopoNode } from './buildTopology';
import { layoutTopology, type LayoutKind } from './layout';
import TunnelEdge, { type TunnelEdgeData } from './TunnelEdge';
import {
  OFFLINE_STROKE,
  RUNTIME_LABEL,
  STATUS_COLOR,
  STATUS_LABEL,
  attachOffline,
  isStopped,
  runtimeOf,
  tunnelPeOffline,
  tunnelStatus,
  type ConfigStatus,
  type RuntimeStatus,
  type VrStatus,
} from './status';
import { runtimeStroke, trafficSubLabel, type TunnelRuntime } from './runtimeTraffic';

export type PeNodeData = {
  role: TopoNode['role'];
  name: string;
  uuid: string;
  tunnelCount: number;
  focus: boolean;
  status: ConfigStatus;
  runtime: RuntimeStatus;
  dim?: boolean;
  /** Hub WAN 口：接口缩写 → 挂载隧道数 */
  wanPorts?: Array<{ ifName: string; count: number; focus: boolean }>;
};

export type CeNodeData = {
  name: string;
  uuid: string;
  focus: boolean;
  shared: number;
  status: ConfigStatus;
  runtime: RuntimeStatus;
  dim?: boolean;
};

/** 中心浮动锚点：自定义边直接使用节点中心 */
const CenterAnchors: React.FC = () => (
  <>
    <Handle type="source" id="c" position={Position.Top} className="srv6-arch-handle srv6-topo-center-handle" />
    <Handle type="target" id="c" position={Position.Top} className="srv6-arch-handle srv6-topo-center-handle" />
  </>
);

const StatusDot: React.FC<{ status: ConfigStatus }> = ({ status }) => (
  <i
    className={`srv6-topo-status-dot is-${status}`}
    style={{ background: STATUS_COLOR[status] }}
    title={STATUS_LABEL[status]}
  />
);

const RuntimeBadge: React.FC<{ runtime: RuntimeStatus }> = ({ runtime }) => {
  if (!isStopped(runtime) && runtime !== 'warning') return null;
  return (
    <span className={`srv6-topo-runtime-badge is-${runtime}`} title={RUNTIME_LABEL[runtime]}>
      {RUNTIME_LABEL[runtime]}
    </span>
  );
};

const ROLE_LABEL: Record<TopoNode['role'], string> = {
  hub: 'Hub PE',
  spoke: 'Spoke PE',
  pe: 'PE',
  ce: 'CE',
};

export const PeTopoNode = memo(({ data, selected }: NodeProps<PeNodeData>) => (
  <div
    className={`srv6-arch-node srv6-arch-node--${data.role === 'hub' ? 'hub' : 'spoke'}${
      data.focus ? ' is-focus' : ''
    }${data.dim ? ' is-dim' : ''}${selected ? ' is-selected' : ''}${
      data.status === 'issue' ? ' is-issue' : ''
    }${isStopped(data.runtime) ? ' is-stopped' : ''}${data.runtime === 'warning' ? ' is-runtime-warn' : ''}`}
  >
    <CenterAnchors />
    <div className="srv6-arch-node-role">
      {ROLE_LABEL[data.role]}
      {data.focus && data.role !== 'hub' ? <span className="srv6-arch-node-badge">当前</span> : null}
      <RuntimeBadge runtime={data.runtime} />
      <StatusDot status={data.status} />
    </div>
    <div className="srv6-arch-node-name" title={data.uuid}>
      {data.name}
    </div>
    <div className="srv6-arch-node-meta">{data.tunnelCount} 条隧道</div>
    {data.wanPorts && data.wanPorts.length ? (
      <div className="srv6-topo-ports">
        {data.wanPorts.map((p) => (
          <span
            key={p.ifName}
            className={`srv6-topo-port${p.focus ? ' is-focus' : ''}`}
            title={`WAN ${p.ifName} · ${p.count} 条隧道`}
          >
            {p.ifName}
            <b>{p.count}</b>
          </span>
        ))}
      </div>
    ) : null}
  </div>
));
PeTopoNode.displayName = 'PeTopoNode';

export const CeTopoNode = memo(({ data, selected }: NodeProps<CeNodeData>) => (
  <div
    className={`srv6-topo-ce${data.focus ? ' is-focus' : ''}${data.dim ? ' is-dim' : ''}${
      selected ? ' is-selected' : ''
    }${data.status === 'issue' ? ' is-issue' : ''}${isStopped(data.runtime) ? ' is-stopped' : ''}${
      data.runtime === 'warning' ? ' is-runtime-warn' : ''
    }`}
    title={data.uuid}
  >
    <CenterAnchors />
    <span className="srv6-topo-ce-role">CE</span>
    <span className="srv6-topo-ce-name">{data.name}</span>
    {data.shared > 1 ? <span className="srv6-topo-ce-shared">×{data.shared}</span> : null}
    <RuntimeBadge runtime={data.runtime} />
    <StatusDot status={data.status} />
  </div>
));
CeTopoNode.displayName = 'CeTopoNode';

export const TOPO_NODE_TYPES = { pe: PeTopoNode, ce: CeTopoNode };
export const TOPO_EDGE_TYPES = { tunnel: TunnelEdge };

export type FlowOptions = {
  layout?: LayoutKind;
  statusMap?: Record<string, VrStatus>;
  runtimeMap?: Record<string, RuntimeStatus>;
  /** 选中后的关联集合；null 表示无选中 */
  related?: Set<string> | null;
  hoverTunnelId?: string | null;
  /** R3：隧道运行态（流量 / 公网 BGP），key = tunnelId */
  trafficMap?: Record<string, TunnelRuntime>;
};

export function toFlowElements(
  topo: Srv6Topology,
  nameOf: (uuid: string) => string,
  opts: FlowOptions = {},
): { nodes: Node[]; edges: Edge<TunnelEdgeData>[] } {
  const pos = layoutTopology(topo, opts.layout);
  const statusMap = opts.statusMap || {};
  const runtimeMap = opts.runtimeMap || {};
  const related = opts.related || null;
  const dim = (id: string) => (related ? !related.has(id) : false);
  const st = (uuid: string): ConfigStatus => statusMap[uuid]?.status || 'unknown';
  const rt = (uuid: string): RuntimeStatus => runtimeOf(runtimeMap, uuid);

  const wanByHub = new Map<string, Map<string, { count: number; focus: boolean }>>();
  topo.tunnels.forEach((t) => {
    if (!t.hubWanIf) return;
    const m = wanByHub.get(t.source) || new Map();
    const k = abbrIfName(t.hubWanIf);
    const cur = m.get(k) || { count: 0, focus: false };
    m.set(k, { count: cur.count + 1, focus: cur.focus || t.focus });
    wanByHub.set(t.source, m);
  });

  const nodes: Node[] = topo.nodes.map((n) => {
    const base = { id: n.id, position: pos[n.id] || { x: 0, y: 0 } };
    if (n.role === 'ce') {
      return {
        ...base,
        type: 'ce',
        data: {
          name: nameOf(n.uuid),
          uuid: n.uuid,
          focus: n.focus,
          shared: n.tunnelIds.length,
          status: st(n.uuid),
          runtime: rt(n.uuid),
          dim: dim(n.id),
        } as CeNodeData,
      };
    }
    const ports = wanByHub.get(n.id);
    return {
      ...base,
      type: 'pe',
      data: {
        role: n.role,
        name: nameOf(n.uuid),
        uuid: n.uuid,
        tunnelCount: n.tunnelIds.length,
        focus: n.focus,
        status: st(n.uuid),
        runtime: rt(n.uuid),
        dim: dim(n.id),
        wanPorts: ports ? Array.from(ports.entries()).map(([ifName, v]) => ({ ifName, ...v })) : undefined,
      } as PeNodeData,
    };
  });

  const uuidOf = new Map(topo.nodes.map((n) => [n.id, n.uuid]));
  const hasStatus = Object.keys(statusMap).length > 0;

  const edges: Edge<TunnelEdgeData>[] = [
    ...topo.attaches.map((a) => {
      const peUuid = uuidOf.get(a.peNodeId) || '';
      const ceUuid = uuidOf.get(a.ceNodeId) || '';
      const offline = attachOffline(peUuid, ceUuid, runtimeMap);
      const cfgIssue =
        hasStatus && (st(ceUuid) === 'issue' || st(peUuid) === 'issue') ? 'issue' : null;
      return {
        id: a.id,
        source: a.peNodeId,
        target: a.ceNodeId,
        sourceHandle: 'c',
        targetHandle: 'c',
        type: 'tunnel',
        className: dim(a.id) ? 'is-dim' : undefined,
        data: {
          kind: 'attach' as const,
          label: offline ? '端点离线' : abbrIfName(a.innerIf) || undefined,
          subLabel: offline && a.innerIf ? abbrIfName(a.innerIf) : undefined,
          focus: a.focus,
          stroke: offline ? OFFLINE_STROKE : cfgIssue ? STATUS_COLOR.issue : undefined,
          dashed: offline,
        },
      };
    }),
    ...topo.tunnels.map((t) => {
      const offline = tunnelPeOffline(topo, t.id, runtimeMap);
      const ts = hasStatus ? tunnelStatus(topo, t.id, statusMap) : null;
      const hover = opts.hoverTunnelId === t.id;
      const trt = opts.trafficMap?.[t.id];
      let stroke: string | undefined;
      if (offline) stroke = OFFLINE_STROKE;
      else if (runtimeStroke(trt)) stroke = runtimeStroke(trt);
      else if (ts && !(t.focus && ts === 'ok')) stroke = ts === 'ok' ? '#7bc96f' : STATUS_COLOR[ts];
      const wanSub = t.hubWanIf ? `WAN ${abbrIfName(t.hubWanIf)}` : undefined;
      const trafficSub = offline ? undefined : trafficSubLabel(trt);
      return {
        id: `t:${t.id}`,
        source: t.source,
        target: t.target,
        sourceHandle: 'c',
        targetHandle: 'c',
        type: 'tunnel',
        zIndex: t.focus || hover || offline ? 2 : 1,
        className: `${dim(`t:${t.id}`) ? 'is-dim' : ''}${hover ? ' is-hover' : ''}${
          offline ? ' is-offline' : ''
        }`.trim() || undefined,
        data: {
          kind: 'tunnel' as const,
          label: offline ? '端点离线' : t.name,
          subLabel: offline
            ? t.name + (t.hubWanIf ? ` · WAN ${abbrIfName(t.hubWanIf)}` : '')
            : trafficSub
              ? (wanSub ? `${wanSub} · ` : '') + trafficSub
              : wanSub,
          focus: t.focus || hover,
          groupIndex: t.groupIndex,
          groupSize: t.groupSize,
          stroke,
          dashed: offline,
        },
      };
    }),
  ];
  return { nodes, edges };
}
