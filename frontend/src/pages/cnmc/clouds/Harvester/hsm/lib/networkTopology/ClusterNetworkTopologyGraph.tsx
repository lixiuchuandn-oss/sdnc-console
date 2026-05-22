/**
 * 集群网络拓扑：与 `ProviderNetworkTopologyGraph` 同一套 React Flow / 点阵 / 边样式；行距用 `NIC_STEP` 与物理网络左列一致。
 * 每个物理机块内行数 R = max(上行网口条数, 关联集群网络数)；左侧「交换机网口/网口」行由 startIdxAg 起算。
 * 当 集群网络数 ≤ 上行行数时，右侧集群网络卡嵌在上行行带内（startIdxCn = startIdxAg + (nU−nC)/2），保证与交换机网口同一 y，不会「只有右侧有卡、左侧空行」。
 * 列 0..4：交换体 / 交换口 / 网口 / 物理机 / 集群网络；中心 x 等距（`TOPO_COL_CENTER_PITCH` / `topoNodeLeftX`）。
 * 行顶 y 为 `blockTop + n * TOPO_ROW_CENTER_PITCH`；交换机体 y 用 `topoGridTopYForRowGroup`，不用像素偏移。
 * 有上行与 LLDP 时画左链+物理机+集群网络；无上行时仅画「集群网络」卡（不显示额外空态文案）。
 */
import React, { useMemo } from 'react';
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  type Edge,
  type Node,
  type ReactFlowInstance,
  Position,
} from 'react-flow-renderer';
import 'react-flow-renderer/dist/style.css';
import { Empty } from 'antd';
import {
  ACCENT,
  CARD_WIDTH,
  formatNicUplinkStatusInGrayBar,
  formatSwitchUplinkStatusInGrayBar,
  getEdgePalette,
  harvesterNodeManagementAddressText,
  getFlowChromeStyles,
  LabelBlock,
  NICO_UPLINK_CARD_WIDTH,
  safeNodeId,
  TopoVisualThemeContext,
  type TopoVisualTheme,
  topoNodeLeftX,
  topoGridTopYForRowGroup,
  TOPO_ROW_CENTER_PITCH,
} from './kubeOvnTopoPrimitives';
import type { HsmLldpPhysicalLink } from '../buildHsmLldpPhysicalLinks';

const FLOW_OUTER_STYLE: React.CSSProperties = {
  flex: 1,
  minHeight: 200,
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  borderRadius: 10,
  border: '1px solid #e8e8e8',
  background: '#edf4fc',
  overflow: 'hidden',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.85)',
};

const FLOW_OUTER_DARK: React.CSSProperties = {
  flex: 1,
  minHeight: 200,
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  borderRadius: 10,
  border: '1px solid rgba(255, 255, 255, 0.1)',
  background: '#16171c',
  overflow: 'hidden',
  boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.06)',
};

const DEFAULT_DOTS_LIGHT = '#d9dee8';
const DEFAULT_DOTS_DARK = 'rgba(255, 255, 255, 0.14)';

/** 集群网 5 列，首列中心使第 4 列(集群网络)左缘 600，列距 `TOPO_COL_CENTER_PITCH` */
const CN_FIRST_COL_CENTER = -660;
const cnX = (col: number, w: number = CARD_WIDTH) => topoNodeLeftX(col, CN_FIRST_COL_CENTER, w);
const NIC_STEP = TOPO_ROW_CENTER_PITCH;
const START_Y = 40;
const BLOCK_GAP = 32;

/** 块内 R 行时，将「中枢」类节点钉在中间网格行，与 Uplink/集群网络行共用同一 y 级距，视觉不错位。 */
function hubRowForBlock(R: number): number {
  if (R <= 0) return 0;
  return Math.max(0, Math.floor((R - 1) / 2));
}

const NODE_CARD_STYLE: React.CSSProperties = { width: CARD_WIDTH };
/** 与 `NIC_STEP` 一致，行中心点等距 */
const CLUSTER_RF_NODE_MIN_H = TOPO_ROW_CENTER_PITCH;
const CLUSTER_NODE_STYLE: React.CSSProperties = {
  ...NODE_CARD_STYLE,
  minHeight: CLUSTER_RF_NODE_MIN_H,
};
const CLUSTER_NIC_UPLINK_OUTER: React.CSSProperties = {
  ...CLUSTER_NODE_STYLE,
  width: NICO_UPLINK_CARD_WIDTH,
};

/** 拓扑展示用名称：与资源 metadata.name 一致，不对 mgmt/storage 等做别名映射 */
export function clusterNetworkTopologyLabel(metaName: string): string {
  const n = String(metaName || '').trim();
  return n || '集群网络';
}

function clusterNodeNames(nodes: any[]): string[] {
  return nodes
    .map((n) => String(n?.metadata?.name || '').trim())
    .filter(Boolean)
    .sort();
}

function nodeNamesForVlanConfig(vc: any, allNodes: any[]): string[] {
  const sel = vc?.spec?.nodeSelector;
  if (!sel || typeof sel !== 'object' || Array.isArray(sel)) {
    return clusterNodeNames(allNodes);
  }
  const keys = Object.keys(sel as object);
  if (keys.length === 0) {
    return clusterNodeNames(allNodes);
  }
  const out: string[] = [];
  for (const n of allNodes) {
    const labels = (n?.metadata?.labels || {}) as Record<string, string>;
    const ok = keys.every((k) => String(labels[k] ?? '') === String((sel as Record<string, string>)[k]));
    if (ok) out.push(String(n.metadata.name));
  }
  return out.sort();
}

export function nodeNamesForClusterNetwork(cn: any, allNodes: any[]): string[] {
  const configs = Array.isArray(cn?.vlanConfigs) ? cn.vlanConfigs : [];
  if (configs.length === 0) {
    return clusterNodeNames(allNodes);
  }
  const set = new Set<string>();
  for (const vc of configs) {
    for (const nm of nodeNamesForVlanConfig(vc, allNodes)) {
      set.add(nm);
    }
  }
  return Array.from(set).sort();
}

export function uplinkNicsListForClusterNetworkOnNode(
  cn: any,
  nodeName: string,
  allNodes: any[],
): string[] {
  const set = new Set<string>();
  const configs = Array.isArray(cn?.vlanConfigs) ? cn.vlanConfigs : [];
  if (configs.length > 0) {
    for (const vc of configs) {
      if (!nodeNamesForVlanConfig(vc, allNodes).includes(nodeName)) continue;
      for (const raw of vc?.spec?.uplink?.nics || []) {
        const t = String(raw || '').trim();
        if (t) set.add(t);
      }
    }
  } else {
    const upl = cn?.uplinks || cn?.rawData?.uplinks;
    for (const raw of Array.isArray(upl?.nics) ? upl.nics : []) {
      const t = String(raw || '').trim();
      if (t) set.add(t);
    }
  }
  return Array.from(set).sort();
}

function hostNicUplinkTitle(dev: string, clusterLabelHint: string | undefined): string {
  if (clusterLabelHint) return `${dev}（${clusterLabelHint}）`;
  return dev;
}

function clusterNetworkStatusLine(cn: any): string | undefined {
  const conds = cn?.status?.conditions;
  if (!Array.isArray(conds)) return undefined;
  const r = conds.find((c: any) => String(c?.type || '').toLowerCase() === 'ready');
  if (r?.status === 'True') return '就绪';
  if (r?.status === 'False') return '未就绪';
  return undefined;
}

function shortCnJoin(fromCns: string[]): string | undefined {
  if (fromCns.length <= 1) return undefined;
  return fromCns
    .map((c) => {
      const t = clusterNetworkTopologyLabel(c);
      return t && t !== c ? t : c;
    })
    .join('、');
}

function cnMetaName(cn: any): string {
  return String(cn?.metadata?.name ?? cn?.name ?? '').trim() || 'cn';
}

/** 单张集群网络卡文案（不合并多网络）；上行网口由拓扑连线体现，卡内不重复展示 */
function oneClusterNetworkCardContent(cn: any): { title: string; detail: string } {
  const mname = cnMetaName(cn);
  const label = clusterNetworkTopologyLabel(mname);
  const st = clusterNetworkStatusLine(cn);
  const parts = [
    mname && label !== mname ? `名称 ${mname}` : null,
    st ? `状态 ${st}` : null,
  ].filter(Boolean) as string[];
  return { title: label || mname, detail: parts.join('\n') };
}

function findLldp(links: HsmLldpPhysicalLink[], nodeName: string, localIf: string): HsmLldpPhysicalLink | undefined {
  const n = String(nodeName).trim();
  const lif = String(localIf).trim();
  return links.find((l) => String(l.nodeName).trim() === n && String(l.localIf).trim() === lif);
}

type NicAgg = { nodeName: string; dev: string; fromCns: string[] };

export type ClusterNetworkTopologyGraphProps = {
  clusterNetworks: any[];
  nodes: any[];
  physicalLldpLinks?: HsmLldpPhysicalLink[];
  loading?: boolean;
  visualTheme?: TopoVisualTheme;
  chartSurfaceBackground?: string;
  chartDotsColor?: string;
  hideBuiltinFlowControls?: boolean;
  onFlowReady?: (instance: ReactFlowInstance) => void;
};

const ClusterNetworkTopologyGraph: React.FC<ClusterNetworkTopologyGraphProps> = ({
  clusterNetworks,
  nodes: clusterNodeRecords,
  loading = false,
  visualTheme = 'light',
  chartSurfaceBackground,
  chartDotsColor,
  hideBuiltinFlowControls,
  onFlowReady,
  physicalLldpLinks: physicalLldpLinksProp,
}) => {
  const flowOuterStyle = useMemo(() => {
    const base = visualTheme === 'dark' ? FLOW_OUTER_DARK : FLOW_OUTER_STYLE;
    return {
      ...base,
      ...(chartSurfaceBackground ? { background: chartSurfaceBackground } : {}),
    } as React.CSSProperties;
  }, [chartSurfaceBackground, visualTheme]);

  const defaultEdgeOpts = useMemo(() => getEdgePalette(visualTheme).edgeDefault, [visualTheme]);
  const dotsColor = chartDotsColor ?? (visualTheme === 'dark' ? DEFAULT_DOTS_DARK : DEFAULT_DOTS_LIGHT);

  const { nodes, edges, flowKey } = useMemo(() => {
    const { edgeDefault: edgeDef, edgeLldp: edgeLldpTh } = getEdgePalette(visualTheme);
    const nodesOut: Node[] = [];
    const edgesOut: Edge[] = [];
    let eSeq = 0;
    const lldpList = Array.isArray(physicalLldpLinksProp) ? physicalLldpLinksProp : [];
    const cnList = Array.isArray(clusterNetworks) ? clusterNetworks : [];
    const nodeList = Array.isArray(clusterNodeRecords) ? clusterNodeRecords : [];
    const nodeByName = new Map<string, any>();
    nodeList.forEach((n) => {
      const nm = String(n?.metadata?.name || '').trim();
      if (nm) nodeByName.set(nm, n);
    });

    const nicKeyToAgg = new Map<string, NicAgg>();
    cnList.forEach((cn) => {
      const cname = cnMetaName(cn);
      for (const nodeName of nodeNamesForClusterNetwork(cn, nodeList)) {
        for (const dev of uplinkNicsListForClusterNetworkOnNode(cn, nodeName, nodeList)) {
          const k = `${nodeName}::${dev}`;
          let rec = nicKeyToAgg.get(k);
          if (!rec) {
            rec = { nodeName, dev, fromCns: [] };
            nicKeyToAgg.set(k, rec);
          }
          if (!rec.fromCns.includes(cname)) rec.fromCns.push(cname);
        }
      }
    });

    const nodeNameList = Array.from(new Set([...nicKeyToAgg.values()].map((a) => a.nodeName))).sort();

    let yCursor = START_Y;

    for (const nm of nodeNameList) {
      const cnsRelevant = cnList
        .filter((cn) => {
          if (!nodeNamesForClusterNetwork(cn, nodeList).includes(nm)) return false;
          if (uplinkNicsListForClusterNetworkOnNode(cn, nm, nodeList).length === 0) return false;
          return true;
        })
        .sort((a, b) => cnMetaName(a).localeCompare(cnMetaName(b), undefined, { numeric: true }));
      const aggs = Array.from(nicKeyToAgg.values())
        .filter((x) => x.nodeName === nm)
        .sort((a, b) => a.dev.localeCompare(b.dev));

      const blockTop = yCursor;
      const nU = aggs.length;
      const nC = cnsRelevant.length;
      const R = Math.max(nU, nC, 1);
      const blockH = R * NIC_STEP;
      const rHub = hubRowForBlock(R);
      const hubY = blockTop + rHub * NIC_STEP;
      const startIdxAg = Math.floor((R - nU) / 2);
      /** 与左侧交换机网口/网口同 y；nC≤nU 时嵌在 uplink 行带内，与 LLDP 行对齐 */
      const startIdxCn =
        nC > 0 && nC <= nU
          ? startIdxAg + Math.floor((nU - nC) / 2)
          : Math.floor((R - nC) / 2);

      const knodeId = safeNodeId('topo_cknode', nm);
      const nodeRec = nodeByName.get(nm);

      nodesOut.push({
        id: knodeId,
        position: { x: cnX(3), y: hubY },
        style: CLUSTER_NODE_STYLE,
        data: {
          label: (
            <LabelBlock
              kicker="物理机"
              title={nm}
              detail={harvesterNodeManagementAddressText(nodeRec)}
              accent={ACCENT.nicDefault}
            />
          ),
        },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      });
      for (let ci = 0; ci < cnsRelevant.length; ci++) {
        const cn = cnsRelevant[ci];
        const mname = cnMetaName(cn);
        const cnetId = safeNodeId('topo_cnetb', `${nm}__${mname}`);
        const { title, detail } = oneClusterNetworkCardContent(cn);
        const rowCn = startIdxCn + ci;
        nodesOut.push({
          id: cnetId,
          position: { x: cnX(4), y: blockTop + rowCn * NIC_STEP },
          style: CLUSTER_NODE_STYLE,
          data: {
            label: <LabelBlock kicker="集群网络" title={title} detail={detail || undefined} accent={ACCENT.hub} />,
          },
          sourcePosition: Position.Right,
          targetPosition: Position.Left,
        });
        edgesOut.push({ id: `e_ns_${eSeq++}`, source: knodeId, target: cnetId, ...edgeDef });
      }

      const rows = aggs.map((agg, i) => {
        const rowAgg = startIdxAg + i;
        return {
          agg,
          i,
          y: blockTop + rowAgg * NIC_STEP,
          link: findLldp(lldpList, nm, agg.dev),
        };
      });
        const bySwHost = new Map<
          string,
          { ys: number[]; link0: HsmLldpPhysicalLink }
        >();
        for (const r of rows) {
          if (!r.link) continue;
          const h = String(r.link.switchHost ?? '').trim() || '—';
          if (!bySwHost.has(h)) {
            bySwHost.set(h, { ys: [], link0: r.link });
          }
          bySwHost.get(h)!.ys.push(r.y);
        }
        bySwHost.forEach((rec, h) => {
          const ySw = topoGridTopYForRowGroup(blockTop, rec.ys, NIC_STEP);
          const swId = safeNodeId('topo_csw', `${nm}__${h}`);
          nodesOut.push({
            id: swId,
            position: { x: cnX(0), y: ySw },
            style: CLUSTER_NODE_STYLE,
            data: {
              label: (
                <LabelBlock
                  kicker="交换机"
                  title={String(rec.link0.switchTitle || '').trim() || h}
                  detail={String(rec.link0.switchHost || '').trim() || h}
                  accent={ACCENT.phyLldp}
                />
              ),
            },
            sourcePosition: Position.Right,
            targetPosition: Position.Left,
          });
        });
        for (const r of rows) {
          const { agg, y, link } = r;
          const pnicId = safeNodeId('topo_cpnic', `${agg.nodeName}_${agg.dev}`);
          const nObj = nodeByName.get(agg.nodeName);
          const netHint = shortCnJoin(agg.fromCns);
          const pnicTitle = hostNicUplinkTitle(agg.dev, netHint);
          if (link) {
            const h = String(link.switchHost ?? '').trim() || '—';
            const swId = safeNodeId('topo_csw', `${nm}__${h}`);
            const swpId = safeNodeId('topo_cswp', link.id);
            const p = String(link.port || '—').trim() || '—';
            nodesOut.push({
              id: swpId,
              position: { x: cnX(1), y },
              style: CLUSTER_NODE_STYLE,
              data: {
                label: (
                  <LabelBlock
                    kicker="交换机网口"
                    title={p}
                    detail={formatSwitchUplinkStatusInGrayBar(link.switchPortStatus, true)}
                    accent={ACCENT.phyLldp}
                  />
                ),
              },
              sourcePosition: Position.Right,
              targetPosition: Position.Left,
            });
            nodesOut.push({
              id: pnicId,
              position: { x: cnX(2, NICO_UPLINK_CARD_WIDTH), y },
              style: CLUSTER_NIC_UPLINK_OUTER,
              data: {
                label: (
                  <LabelBlock
                    kicker="网口"
                    title={pnicTitle}
                    width={NICO_UPLINK_CARD_WIDTH}
                    detail={formatNicUplinkStatusInGrayBar(nObj, agg.dev)}
                    accent={ACCENT.nicDefault}
                  />
                ),
              },
              sourcePosition: Position.Right,
              targetPosition: Position.Left,
            });
            edgesOut.push({ id: `e_sws_${eSeq++}`, source: swId, target: swpId, ...edgeDef });
            edgesOut.push({ id: `e_ll_p_${eSeq++}`, source: swpId, target: pnicId, ...edgeLldpTh });
            edgesOut.push({ id: `e_p_k_${eSeq++}`, source: pnicId, target: knodeId, ...edgeDef });
          } else {
            const lldpPh = safeNodeId('topo_clldp_ph', `${nm}_${agg.dev}`);
            const swhR = safeNodeId('topo_cswrow', `${nm}_r${r.i}`);
            nodesOut.push({
              id: swhR,
              position: { x: cnX(0), y },
              style: CLUSTER_NODE_STYLE,
              data: {
                label: (
                  <LabelBlock
                    kicker="交换机"
                    title="无 LLDP 匹配"
                    detail="未在交换机侧解析"
                    tone="muted"
                    dashed
                    accent={ACCENT.phyLldp}
                  />
                ),
              },
              sourcePosition: Position.Right,
              targetPosition: Position.Left,
            });
            nodesOut.push({
              id: lldpPh,
              position: { x: cnX(1), y },
              style: CLUSTER_NODE_STYLE,
              data: {
                label: (
                  <LabelBlock
                    kicker="交换机网口"
                    title="未匹配"
                    detail={formatSwitchUplinkStatusInGrayBar(undefined, false)}
                    tone="muted"
                    dashed
                    accent={ACCENT.phyLldp}
                  />
                ),
              },
              sourcePosition: Position.Right,
              targetPosition: Position.Left,
            });
            nodesOut.push({
              id: pnicId,
              position: { x: cnX(2, NICO_UPLINK_CARD_WIDTH), y },
              style: CLUSTER_NIC_UPLINK_OUTER,
              data: {
                label: (
                  <LabelBlock
                    kicker="网口"
                    title={pnicTitle}
                    width={NICO_UPLINK_CARD_WIDTH}
                    detail={formatNicUplinkStatusInGrayBar(nObj, agg.dev)}
                    accent={ACCENT.nicDefault}
                  />
                ),
              },
              sourcePosition: Position.Right,
              targetPosition: Position.Left,
            });
            edgesOut.push({ id: `e_swr_${eSeq++}`, source: swhR, target: lldpPh, ...edgeDef });
            edgesOut.push({ id: `e_l_p_${eSeq++}`, source: lldpPh, target: pnicId, ...edgeLldpTh });
            edgesOut.push({ id: `e_p_k2_${eSeq++}`, source: pnicId, target: knodeId, ...edgeDef });
          }
        }

      yCursor = blockTop + blockH + BLOCK_GAP;
    }

    /** 无上联节点时只展示「集群网络」卡，无单独空态提示 */
    if (nodeNameList.length === 0 && cnList.length > 0) {
      cnList.forEach((cn, i) => {
        const mname = cnMetaName(cn);
        const cnetId = safeNodeId('topo_cnet_solo', mname);
        const { title, detail } = oneClusterNetworkCardContent(cn);
        nodesOut.push({
          id: cnetId,
          position: { x: cnX(4), y: START_Y + i * NIC_STEP },
          style: CLUSTER_NODE_STYLE,
          data: {
            label: <LabelBlock kicker="集群网络" title={title} detail={detail || undefined} accent={ACCENT.hub} />,
          },
          sourcePosition: Position.Right,
          targetPosition: Position.Left,
        });
      });
    }

    const flowKey = `cn-pn-mirror-${visualTheme}-${nodeNameList.join('|')}-${nicKeyToAgg.size}-${lldpList.length}-s${nodeNameList.length === 0 ? cnList.map(cnMetaName).sort().join('|') : 'x'}`;
    return {
      nodes: nodesOut,
      edges: edgesOut,
      flowKey,
    };
  }, [clusterNetworks, clusterNodeRecords, defaultEdgeOpts, physicalLldpLinksProp, visualTheme]);

  if (loading && (!clusterNetworks || clusterNetworks.length === 0)) {
    return null;
  }

  if (!clusterNetworks || clusterNetworks.length === 0) {
    return (
      <div style={{ ...flowOuterStyle, minHeight: 240, alignItems: 'center', justifyContent: 'center' }}>
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无集群网络" />
      </div>
    );
  }

  return (
    <TopoVisualThemeContext.Provider value={visualTheme}>
      <div className="pn-provider-topology-flow" style={flowOuterStyle}>
        <style>{getFlowChromeStyles(visualTheme)}</style>
        <ReactFlow
          key={flowKey}
          style={{ flex: 1, minHeight: 0, width: '100%' }}
          nodes={nodes}
          edges={edges}
          fitView
          fitViewOptions={{ padding: 0.18, maxZoom: 1.05 }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          zoomOnDoubleClick={false}
          panOnScroll
          preventScrolling={false}
          minZoom={0.32}
          maxZoom={1.2}
          defaultEdgeOptions={defaultEdgeOpts}
          onInit={hideBuiltinFlowControls ? onFlowReady : undefined}
        >
          <Background
            id="cn-mesh-tbg"
            variant={BackgroundVariant.Dots}
            gap={22}
            size={1.15}
            color={dotsColor}
          />
          {!hideBuiltinFlowControls ? (
            <Controls
              showInteractive={false}
              style={{
                position: 'absolute',
                top: 10,
                right: 10,
                bottom: 'auto',
                left: 'auto',
                display: 'flex',
                flexDirection: 'row',
              }}
            />
          ) : null}
        </ReactFlow>
      </div>
    </TopoVisualThemeContext.Provider>
  );
};

export default ClusterNetworkTopologyGraph;
