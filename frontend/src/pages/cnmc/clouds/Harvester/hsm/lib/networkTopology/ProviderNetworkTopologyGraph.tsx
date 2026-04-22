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
import { Spin } from 'antd';
import { TOWER_IO_ALIES_ANNOTATION } from '../../../../../../../utils/towerKubeOvnNames';
import { filterLldpLinksForPhysicalNetwork } from './filterLldpLinksForPhysicalNetwork';
import type { PnNicTopologyShape } from '../../../kube-ovn/lib/providerNetworkNodeInterface';
import { resolveNodeInterface } from '../../../kube-ovn/lib/providerNetworkNodeInterface';
import type { ProviderNetworkOriginNicsParse } from '../../../kube-ovn/lib/providerNetworkOriginNics';
import {
  ACCENT,
  CARD_WIDTH,
  getEdgePalette,
  getFlowChromeStyles,
  LabelBlock,
  safeNodeId,
  TOPO_CARD_LOADING_LAYOUT,
  TopoNodeCard,
  TopoVisualThemeContext,
  type TopoVisualTheme,
  topoLoadingCaptionStyle,
} from './kubeOvnTopoPrimitives';
import type { HsmLldpPhysicalLink } from '../buildHsmLldpPhysicalLinks';

export type { PnNicTopologyShape };

export type PnSubnetRef = {
  name: string;
  alias: string;
  vlan: string;
  cidr: string;
};

export type ProviderNetworkTopologyGraphProps = {
  pnDisplayTitle: string;
  pnMetaName: string;
  pnReady: boolean;
  pnNicTopology: PnNicTopologyShape | null;
  pnReadyNodes: string[];
  displayedVlans: any[];
  publicSubnetsForPn: PnSubnetRef[];
  flatSubnetsForPn: PnSubnetRef[];
  vlanLoading: boolean;
  /** 为 true 时不渲染内置 Controls，由父组件通过 onFlowReady 自行提供缩放按钮 */
  hideBuiltinFlowControls?: boolean;
  /** React Flow 初始化完成（含 remount）时回调，用于外部缩放 */
  onFlowReady?: (instance: ReactFlowInstance) => void;
  /** 画板外层容器背景（圆角边框内整片区域），不传则淡蓝 `#edf4fc` */
  chartSurfaceBackground?: string;
  /** 点阵颜色；浅色默认 `#d9dee8`，深色默认半透明白 */
  chartDotsColor?: string;
  /** 浅色 | 深色（影响卡片、边、控件样式） */
  visualTheme?: TopoVisualTheme;
  /** 物理交换机口 ↔ 物理机网口（HMS/LLDP 联合）— 自 `buildHsmLldpPhysicalLinks`；空则不生成本列 */
  physicalLldpLinks?: HsmLldpPhysicalLink[];
  /** `hci.manager.system/provider-network-origin-nics` 解析结果：声明 bond 与成员物理口，便于与 LLDP 本端口对照 */
  pnOriginNics?: ProviderNetworkOriginNicsParse | null;
};

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

const LAYER_X = {
  lldp: -300,
  nic: 0,
  provider: 300,
  vlan: 600,
  subnet: 900,
} as const;
const NIC_STEP = 104;
const LLD_LINK_STEP = 80;
const SUBNET_STEP = 92;
const START_Y = 40;

/** 与卡片固定宽度一致，便于 RF 计算边与 Handle 锚点 */
const NODE_CARD_STYLE: React.CSSProperties = { width: CARD_WIDTH };

function ProviderBlock(props: { title: string; ready: boolean }) {
  const { title, ready } = props;
  return (
    <LabelBlock
      kicker="物理网络"
      title={title}
      detail={ready ? '状态：已就绪' : '状态：未就绪'}
      accent={ACCENT.hub}
    />
  );
}

const ProviderNetworkTopologyGraph: React.FC<ProviderNetworkTopologyGraphProps> = ({
  pnDisplayTitle,
  pnMetaName,
  pnReady,
  pnNicTopology,
  pnReadyNodes,
  displayedVlans,
  publicSubnetsForPn,
  flatSubnetsForPn,
  vlanLoading,
  hideBuiltinFlowControls,
  onFlowReady,
  chartSurfaceBackground,
  chartDotsColor,
  visualTheme = 'light',
  physicalLldpLinks: physicalLldpLinksProp,
  pnOriginNics: pnOriginNicsProp,
}) => {
  const flowOuterStyle = useMemo(() => {
    const base = visualTheme === 'dark' ? FLOW_OUTER_DARK : FLOW_OUTER_STYLE;
    return {
      ...base,
      ...(chartSurfaceBackground ? { background: chartSurfaceBackground } : {}),
    } as React.CSSProperties;
  }, [chartSurfaceBackground, visualTheme]);

  const defaultEdgeOpts = useMemo(() => getEdgePalette(visualTheme).edgeDefault, [visualTheme]);

  const { nodes, edges, flowKey } = useMemo(() => {
    const { edgeDefault: edgeDef, edgeLldp: edgeLldpTh } = getEdgePalette(visualTheme);
    const nodesOut: Node[] = [];
    const edgesOut: Edge[] = [];
    const providerNodeId = 'topo_pn';
    const lldpListRaw =
      Array.isArray(physicalLldpLinksProp) && physicalLldpLinksProp.length > 0
        ? physicalLldpLinksProp
        : [];
    const lldpList = filterLldpLinksForPhysicalNetwork(
      lldpListRaw,
      pnNicTopology,
      pnOriginNicsProp ?? null,
    );

    lldpList.forEach((link, i) => {
      const y = START_Y + i * LLD_LINK_STEP;
      const id = safeNodeId('topo_lldp', link.id);
      nodesOut.push({
        id,
        position: { x: LAYER_X.lldp, y },
        style: NODE_CARD_STYLE,
        data: {
          label: (
            <LabelBlock
              kicker="LLDP 物理连接"
              title={`${link.port} → ${link.nodeName}`}
              detail={`${link.switchTitle}（${link.switchHost}）· 本端 ${link.localIf}`}
              accent={ACCENT.phyLldp}
            />
          ),
        },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      });
    });

    /** 就绪物理节点名 → 其网卡节点 id，供 LLDP 边按对端机名与 Provider 的节点卡对齐，而非一律连到物理网络 */
    const nicIdByNodeName = new Map<string, string>();

    let nicIndex = 0;
    const pushNicNode = (id: string, label: React.ReactNode) => {
      const y = START_Y + nicIndex * NIC_STEP;
      nicIndex += 1;
      nodesOut.push({
        id,
        position: { x: LAYER_X.nic, y },
        style: NODE_CARD_STYLE,
        data: { label },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      });
      edgesOut.push({ id: `e_${id}_${providerNodeId}`, source: id, target: providerNodeId, ...edgeDef });
    };

    if (pnNicTopology) {
      const { defaultIf, customList } = pnNicTopology;
      const hasSpec = Boolean(String(defaultIf || '').trim()) || customList.length > 0;

      if (pnReadyNodes.length > 0) {
        pnReadyNodes.forEach((rawName) => {
          const nodeName = String(rawName ?? '').trim() || '—';
          const { iface, fromCustom } = resolveNodeInterface(nodeName, pnNicTopology);
          const hasIface = iface && iface !== '—';
          const logicalLine = hasIface
            ? pnOriginNicsProp?.bondFromAnnotation
              ? `逻辑口：${iface}（Bond）`
              : `逻辑口：${iface}`
            : '逻辑口：未配置';
          const memberArr = pnOriginNicsProp?.bondFromAnnotation
            ? pnOriginNicsProp.byNode[nodeName]
            : undefined;
          const memberLine =
            memberArr && memberArr.length ? `成员口：${memberArr.join('、')}` : null;
          const nodeDetail = [logicalLine, memberLine].filter(Boolean).join('\n');

          const nicId = safeNodeId('topo_nic_node', nodeName);
          nicIdByNodeName.set(nodeName, nicId);
          pushNicNode(
            nicId,
            <LabelBlock
              kicker="物理节点"
              title={nodeName}
              detail={nodeDetail}
              accent={fromCustom ? ACCENT.nicCustom : ACCENT.nicDefault}
            />,
          );
        });
      } else if (!hasSpec) {
        pushNicNode(
          'topo_nic_unset',
          <LabelBlock
            kicker="物理网卡"
            title="未配置 defaultInterface"
            detail="请检查 ProviderNetwork spec"
            tone="muted"
            dashed
          />,
        );
      } else {
        pushNicNode(
          'topo_nic_no_ready',
          <LabelBlock
            kicker="物理节点"
            title="暂无就绪节点"
            detail="status.readyNodes 为空，无法按节点展示网卡；请待节点就绪后刷新"
            tone="muted"
            dashed
          />,
        );
      }
    } else {
      pushNicNode(
        'topo_nic_na',
        <LabelBlock kicker="物理网卡" title="—" detail="无物理网络数据" tone="muted" dashed />,
      );
    }

    const lldpH = lldpList.length;
    const nicSpan = Math.max(0, nicIndex - 1) * NIC_STEP;
    const lldpSpan = Math.max(0, lldpH - 1) * LLD_LINK_STEP;
    const maxLeftSpan = Math.max(nicSpan, lldpSpan);
    const providerY = START_Y + maxLeftSpan / 2;

    nodesOut.push({
      id: providerNodeId,
      position: { x: LAYER_X.provider, y: providerY },
      style: NODE_CARD_STYLE,
      data: {
        label: <ProviderBlock title={pnDisplayTitle || pnMetaName || '物理网络'} ready={pnReady} />,
      },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    });

    lldpList.forEach((link) => {
      const lldpId = safeNodeId('topo_lldp', link.id);
      const n = String(link.nodeName ?? '').trim();
      const nicId = n ? nicIdByNodeName.get(n) : undefined;
      if (nicId) {
        edgesOut.push({ id: `e_${lldpId}_${nicId}_lldp_nic`, source: lldpId, target: nicId, ...edgeLldpTh });
      } else {
        edgesOut.push({ id: `e_${lldpId}_${providerNodeId}_lldp`, source: lldpId, target: providerNodeId, ...edgeLldpTh });
      }
    });

    let yCursor = START_Y;
    const vlanMetaKeys = displayedVlans.map((item) => String(item?.metadata?.name ?? '').trim()).join('|');

    if (vlanLoading && displayedVlans.length === 0) {
      const loadingNodeId = 'topo_vlan_loading';
      nodesOut.push({
        id: loadingNodeId,
        position: { x: LAYER_X.vlan, y: yCursor },
        style: NODE_CARD_STYLE,
        data: {
          label: (
            <TopoNodeCard accent={ACCENT.hub}>
              <div style={TOPO_CARD_LOADING_LAYOUT}>
                <Spin size="small" style={visualTheme === 'dark' ? { color: '#69b1ff' } : undefined} />
                <div style={topoLoadingCaptionStyle(visualTheme)}>加载 VLAN…</div>
              </div>
            </TopoNodeCard>
          ),
        },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      });
      edgesOut.push({ id: `e_${providerNodeId}_${loadingNodeId}`, source: providerNodeId, target: loadingNodeId, ...edgeDef });
      yCursor += 120;
    } else if (displayedVlans.length === 0) {
      const emptyNodeId = 'topo_vlan_empty';
      nodesOut.push({
        id: emptyNodeId,
        position: { x: LAYER_X.vlan, y: yCursor },
        style: NODE_CARD_STYLE,
        data: {
          label: (
            <LabelBlock
              kicker="VLAN"
              title="暂无 VLAN"
              detail="需先有 VLAN（spec.provider 指向该物理网络）才能挂子网"
              tone="muted"
              accent={ACCENT.vlan}
              dashed
            />
          ),
        },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      });
      edgesOut.push({ id: `e_${providerNodeId}_${emptyNodeId}`, source: providerNodeId, target: emptyNodeId, ...edgeDef });
      yCursor += 100;
    } else {
      displayedVlans.forEach((vlanItem) => {
        const ann = vlanItem?.metadata?.annotations || {};
        const metaName = String(vlanItem?.metadata?.name || '').trim();
        const displayAlias = String(ann[TOWER_IO_ALIES_ANNOTATION] || '').trim();
        const title = displayAlias || metaName || '—';
        const vlanId = vlanItem?.spec?.id;
        const vlanIdText = vlanId !== undefined && vlanId !== null ? String(vlanId) : '—';
        const vlanNodeId = safeNodeId('topo_vlan', metaName || title);

        const relatedSubnets = [
          ...publicSubnetsForPn
            .filter((subnet) => String(subnet.vlan) === metaName)
            .map((subnet) => ({ ...subnet, kind: 'public' as const })),
          ...flatSubnetsForPn
            .filter((subnet) => String(subnet.vlan) === metaName)
            .map((subnet) => ({ ...subnet, kind: 'flat' as const })),
        ];

        const blockTop = yCursor;

        nodesOut.push({
          id: vlanNodeId,
          position: { x: LAYER_X.vlan, y: blockTop },
          style: NODE_CARD_STYLE,
          data: {
            label: (
              <LabelBlock
                kicker="虚拟局域网 (VLAN)"
                title={title}
                detail={`vlan tag ${vlanIdText}`}
                accent={ACCENT.vlan}
              />
            ),
          },
          sourcePosition: Position.Right,
          targetPosition: Position.Left,
        });
        edgesOut.push({ id: `e_${providerNodeId}_${vlanNodeId}`, source: providerNodeId, target: vlanNodeId, ...edgeDef });

        if (relatedSubnets.length === 0) {
          const emptySubnetNodeId = safeNodeId('topo_subnet_empty', metaName || title);
          nodesOut.push({
            id: emptySubnetNodeId,
            position: { x: LAYER_X.subnet, y: blockTop },
            style: NODE_CARD_STYLE,
            data: {
              label: (
                <LabelBlock
                  kicker="子网"
                  title="无公共/扁平子网"
                  detail="spec.vlan 未引用此 VLAN"
                  tone="muted"
                  dashed
                />
              ),
            },
            targetPosition: Position.Left,
          });
          edgesOut.push({ id: `e_${vlanNodeId}_${emptySubnetNodeId}`, source: vlanNodeId, target: emptySubnetNodeId, ...edgeDef });
          yCursor = blockTop + 104;
        } else {
          relatedSubnets.forEach((subnet, index) => {
            const subnetNodeId = safeNodeId('topo_sn', `${subnet.kind}-${subnet.name}`);
            const subnetTitle = String(subnet.alias || '').trim() || subnet.name;
            const kindLabel = subnet.kind === 'public' ? '公共子网' : '扁平子网';
            const accent = subnet.kind === 'public' ? ACCENT.subnetPublic : ACCENT.subnetFlat;

            nodesOut.push({
              id: subnetNodeId,
              position: { x: LAYER_X.subnet, y: blockTop + index * SUBNET_STEP },
              style: NODE_CARD_STYLE,
              data: {
                label: (
                  <LabelBlock
                    kicker={kindLabel}
                    title={subnetTitle}
                    detail={subnet.cidr && subnet.cidr !== '-' ? subnet.cidr : undefined}
                    accent={accent}
                  />
                ),
              },
              targetPosition: Position.Left,
            });
            edgesOut.push({ id: `e_${vlanNodeId}_${subnetNodeId}`, source: vlanNodeId, target: subnetNodeId, ...edgeDef });
          });
          yCursor = blockTop + Math.max(100, relatedSubnets.length * SUBNET_STEP) + 28;
        }
      });
    }

    const originKey =
      pnOriginNicsProp == null
        ? 'o0'
        : `o1${pnOriginNicsProp.bondFromAnnotation ? 1 : 0}_${JSON.stringify(pnOriginNicsProp.byNode)}`;
    const nicNodeKey = `nic${pnReadyNodes.map((n) => String(n)).join('|')}`;
    const flowKey = `${visualTheme}_${pnMetaName}_${vlanMetaKeys}_${publicSubnetsForPn.length}_${flatSubnetsForPn.length}_${vlanLoading ? 1 : 0}_lldp${lldpH}_${originKey}_${nicNodeKey}`;
    return { nodes: nodesOut, edges: edgesOut, flowKey };
  }, [
    pnDisplayTitle,
    pnMetaName,
    pnReady,
    pnNicTopology,
    pnOriginNicsProp,
    pnReadyNodes,
    physicalLldpLinksProp,
    displayedVlans,
    publicSubnetsForPn,
    flatSubnetsForPn,
    vlanLoading,
    visualTheme,
  ]);

  const dotsColor = chartDotsColor ?? (visualTheme === 'dark' ? DEFAULT_DOTS_DARK : DEFAULT_DOTS_LIGHT);

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
          id="pn-topo-bg"
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

export default ProviderNetworkTopologyGraph;
