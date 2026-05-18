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
import { TOWER_IO_ALIES_ANNOTATION } from '../../../../../../../utils/towerKubeOvnNames';
import { filterLldpLinksForPhysicalNetwork } from './filterLldpLinksForPhysicalNetwork';
import type { PnNicTopologyShape } from '../../../kube-ovn/lib/providerNetworkNodeInterface';
import { resolveNodeInterface } from '../../../kube-ovn/lib/providerNetworkNodeInterface';
import type { ProviderNetworkOriginNicsParse } from '../../../kube-ovn/lib/providerNetworkOriginNics';
import {
  ACCENT,
  CARD_WIDTH,
  formatNicUplinkStatusInGrayBar,
  formatSwitchUplinkStatusInGrayBar,
  getEdgePalette,
  getFlowChromeStyles,
  harvesterNodeManagementAddressText,
  LabelBlock,
  NICO_UPLINK_CARD_WIDTH,
  safeNodeId,
  TOPO_CARD_LOADING_LAYOUT,
  TopoNodeCard,
  TopoVisualThemeContext,
  type TopoVisualTheme,
  topoLoadingCaptionStyle,
  topoNodeLeftX,
  topoGridTopYForRowGroup,
  TOPO_ROW_CENTER_PITCH,
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
  /** 用于在「网口」卡灰条内显示接口状态；与对端机名在 `nics[]` 中按 device 匹配 */
  harvesterNodes?: any[] | null;
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

/**
 * 物理网络主链 8 列，`TOPO_COL_CENTER_PITCH` 列中心等距；首列中心使第 5 列(中枢)左缘 520。
 * 0 交换体 / 1 交换口 / 2 网口 / 3 网卡 / 4 物理机 / 5 中枢 / 6 vlan / 7 子网
 */
const PN_FIRST_COL_CENTER = -1080;
const pnX = (col: number, w: number = CARD_WIDTH) => topoNodeLeftX(col, PN_FIRST_COL_CENTER, w);
/** 行顶 y 等距 = `TOPO_ROW_CENTER_PITCH`，行与行垂直中心点等距 */
const NIC_STEP = TOPO_ROW_CENTER_PITCH;
const START_Y = 40;

/** 与卡片固定宽度一致，便于 RF 计算边与 Handle 锚点 */
const NODE_CARD_STYLE: React.CSSProperties = { width: CARD_WIDTH };
const NICO_HPORT_OUTER: React.CSSProperties = { width: NICO_UPLINK_CARD_WIDTH };

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
  harvesterNodes: harvesterNodesProp,
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

    const linkRowY: number[] = lldpList.map((_, i) => START_Y + i * NIC_STEP);
    const harvesterNodes = Array.isArray(harvesterNodesProp) ? harvesterNodesProp : [];

    /** 就绪节点名 → 网卡 id（LLDP 网口 接 网卡；再 网卡→物理机→中枢 单链） */
    const nicSpecIdByNodeName = new Map<string, string>();

    let nicIndex = 0;
    /** 占位 / 无数据时：仅一列，仍连中枢 */
    const pushSingleHostColumn = (id: string, label: React.ReactNode) => {
      const y = START_Y + nicIndex * NIC_STEP;
      nicIndex += 1;
      nodesOut.push({
        id,
        position: { x: pnX(3), y },
        style: NODE_CARD_STYLE,
        data: { label },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      });
      edgesOut.push({ id: `e_${id}_${providerNodeId}`, source: id, target: providerNodeId, ...edgeDef });
    };

    const pushHostAndNicSpec = (
      nodeName: string,
      hostLabel: React.ReactNode,
      nicLabel: React.ReactNode,
    ) => {
      const y = START_Y + nicIndex * NIC_STEP;
      nicIndex += 1;
      const hostId = safeNodeId('topo_host', nodeName);
      const nicSpecId = safeNodeId('topo_nic_spec', nodeName);
      nicSpecIdByNodeName.set(nodeName, nicSpecId);
      nodesOut.push({
        id: nicSpecId,
        position: { x: pnX(3), y },
        style: NODE_CARD_STYLE,
        data: { label: nicLabel },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      });
      nodesOut.push({
        id: hostId,
        position: { x: pnX(4), y },
        style: NODE_CARD_STYLE,
        data: { label: hostLabel },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      });
      /* 单链：网口→网卡→物理机→中枢，网卡不直连 Provider，避免 Y 形分叉 */
      edgesOut.push({ id: `e_${nicSpecId}_${hostId}_nichost`, source: nicSpecId, target: hostId, ...edgeDef });
      edgesOut.push({ id: `e_${hostId}_${providerNodeId}_hostpn`, source: hostId, target: providerNodeId, ...edgeDef });
    };

    if (pnNicTopology) {
      const { defaultIf, customList } = pnNicTopology;
      const hasSpec = Boolean(String(defaultIf || '').trim()) || customList.length > 0;

      if (pnReadyNodes.length > 0) {
        pnReadyNodes.forEach((rawName) => {
          const nodeName = String(rawName ?? '').trim() || '—';
          const { iface, fromCustom } = resolveNodeInterface(nodeName, pnNicTopology);
          const hasIface = iface && iface !== '—';
          const memberArr = pnOriginNicsProp?.bondFromAnnotation
            ? pnOriginNicsProp.byNode[nodeName]
            : undefined;
          /** 网卡卡灰条仅展示成员口；标题为接口名 */
          const memberDetail =
            memberArr && memberArr.length ? `成员口：${memberArr.join('、')}` : undefined;
          const hNode = harvesterNodes.find((h: any) => String(h?.metadata?.name ?? '').trim() === nodeName);
          const mgmtLine = harvesterNodeManagementAddressText(hNode);
          const accent = fromCustom ? ACCENT.nicCustom : ACCENT.nicDefault;
          const nicTitle = hasIface ? String(iface).trim() : '—';

          pushHostAndNicSpec(
            nodeName,
            <LabelBlock kicker="物理机" title={nodeName} detail={mgmtLine} accent={accent} />,
            <LabelBlock kicker="网卡" title={nicTitle} detail={memberDetail} accent={accent} />,
          );
        });
      } else if (!hasSpec) {
        pushSingleHostColumn(
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
        pushSingleHostColumn(
          'topo_nic_no_ready',
          <LabelBlock
            kicker="物理机"
            title="暂无就绪节点"
            detail="status.readyNodes 为空，无法按节点展示；请待节点就绪后刷新"
            tone="muted"
            dashed
          />,
        );
      }
    } else {
      pushSingleHostColumn(
        'topo_nic_na',
        <LabelBlock kicker="物理网卡" title="—" detail="无物理网络数据" tone="muted" dashed />,
      );
    }

    const hostPnicAccent = (nodeName: string) => {
      if (!pnNicTopology) return ACCENT.nicDefault;
      const { fromCustom } = resolveNodeInterface(String(nodeName || '').trim() || '—', pnNicTopology);
      return fromCustom ? ACCENT.nicCustom : ACCENT.nicDefault;
    };

    lldpList.forEach((link, i) => {
      const y = linkRowY[i];
      const swpId = safeNodeId('topo_swport', link.id);
      const hportId = safeNodeId('topo_hport', link.id);
      const n = String(link.nodeName ?? '').trim();
      const hasNicSpec = n ? Boolean(nicSpecIdByNodeName.get(n)) : false;
      const hNode = n
        ? harvesterNodes.find((h: any) => String(h?.metadata?.name ?? '').trim() === n)
        : null;
      const pnicAccent = n ? hostPnicAccent(n) : ACCENT.nicDefault;
      const localIf = String(link.localIf || '—').trim() || '—';
      const port = String(link.port || '—').trim() || '—';
      const swTitle = port;
      const hTitle = n
        ? hasNicSpec
          ? `${localIf} · 对端 ${n}（与物理机主卡相连）`
          : `${localIf} · 对端 ${n}（未在 readyNodes，直连物理网络）`
        : localIf;
      nodesOut.push({
        id: swpId,
        position: { x: pnX(1), y },
        style: NODE_CARD_STYLE,
        data: {
          label: (
            <LabelBlock
              kicker="交换机网口"
              title={swTitle}
              detail={formatSwitchUplinkStatusInGrayBar(link.switchPortStatus, true)}
              accent={ACCENT.phyLldp}
            />
          ),
        },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      });
      nodesOut.push({
        id: hportId,
        position: { x: pnX(2, NICO_UPLINK_CARD_WIDTH), y },
        style: NICO_HPORT_OUTER,
        data: {
          label: (
            <LabelBlock
              kicker="网口"
              title={hTitle}
              width={NICO_UPLINK_CARD_WIDTH}
              detail={formatNicUplinkStatusInGrayBar(hNode, localIf)}
              accent={pnicAccent}
            />
          ),
        },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      });
    });

    const ysBySwHost = new Map<string, number[]>();
    lldpList.forEach((link, i) => {
      const h = String(link.switchHost ?? '').trim() || '—';
      if (!ysBySwHost.has(h)) ysBySwHost.set(h, []);
      ysBySwHost.get(h)!.push(linkRowY[i]);
    });
    ysBySwHost.forEach((ys, h) => {
      const link0 = lldpList.find((l) => String(l.switchHost ?? '').trim() === h);
      if (!link0) return;
      const ySw = topoGridTopYForRowGroup(START_Y, ys, NIC_STEP);
      const swId = safeNodeId('topo_lldpsw', h);
      nodesOut.push({
        id: swId,
        position: { x: pnX(0), y: ySw },
        style: NODE_CARD_STYLE,
        data: {
          label: (
            <LabelBlock
              kicker="交换机"
              title={String(link0.switchTitle || '').trim() || h}
              detail={String(link0.switchHost || '').trim() || h}
              accent={ACCENT.phyLldp}
            />
          ),
        },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      });
    });

    const lldpH = lldpList.length;
    const nicSpan = Math.max(0, nicIndex - 1) * NIC_STEP;
    const lldpSpan = Math.max(0, lldpH - 1) * NIC_STEP;
    const maxLeftSpan = Math.max(nicSpan, lldpSpan);
    const providerY = START_Y + maxLeftSpan / 2;

    nodesOut.push({
      id: providerNodeId,
      position: { x: pnX(5), y: providerY },
      style: NODE_CARD_STYLE,
      data: {
        label: <ProviderBlock title={pnDisplayTitle || pnMetaName || '物理网络'} ready={pnReady} />,
      },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    });

    lldpList.forEach((link) => {
      const n = String(link.nodeName ?? '').trim();
      const nicSpecId = n ? nicSpecIdByNodeName.get(n) : undefined;
      const swpId = safeNodeId('topo_swport', link.id);
      const hportId = safeNodeId('topo_hport', link.id);
      const h = String(link.switchHost ?? '').trim() || '—';
      const swId = safeNodeId('topo_lldpsw', h);
      edgesOut.push({ id: `e_${swId}_${swpId}_int`, source: swId, target: swpId, ...edgeDef });
      edgesOut.push({ id: `e_${swpId}_${hportId}_ld`, source: swpId, target: hportId, ...edgeLldpTh });
      if (nicSpecId) {
        edgesOut.push({ id: `e_${hportId}_${nicSpecId}_hport`, source: hportId, target: nicSpecId, ...edgeDef });
      } else {
        edgesOut.push({ id: `e_${hportId}_${providerNodeId}_hpn`, source: hportId, target: providerNodeId, ...edgeDef });
      }
    });

    let yCursor = START_Y;
    const vlanMetaKeys = displayedVlans.map((item) => String(item?.metadata?.name ?? '').trim()).join('|');

    if (vlanLoading && displayedVlans.length === 0) {
      const loadingNodeId = 'topo_vlan_loading';
      nodesOut.push({
        id: loadingNodeId,
        position: { x: pnX(6), y: yCursor },
        style: NODE_CARD_STYLE,
        data: {
          label: (
            <TopoNodeCard accent={ACCENT.hub}>
              <div style={TOPO_CARD_LOADING_LAYOUT}>
                <div style={topoLoadingCaptionStyle(visualTheme)}>加载 VLAN…</div>
              </div>
            </TopoNodeCard>
          ),
        },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      });
      edgesOut.push({ id: `e_${providerNodeId}_${loadingNodeId}`, source: providerNodeId, target: loadingNodeId, ...edgeDef });
      yCursor += NIC_STEP;
    } else if (displayedVlans.length === 0) {
      const emptyNodeId = 'topo_vlan_empty';
      nodesOut.push({
        id: emptyNodeId,
        position: { x: pnX(6), y: yCursor },
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
      yCursor += NIC_STEP;
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
          position: { x: pnX(6), y: blockTop },
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
            position: { x: pnX(7), y: blockTop },
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
          yCursor = blockTop + NIC_STEP;
        } else {
          relatedSubnets.forEach((subnet, index) => {
            const subnetNodeId = safeNodeId('topo_sn', `${subnet.kind}-${subnet.name}`);
            const subnetTitle = String(subnet.alias || '').trim() || subnet.name;
            const kindLabel = subnet.kind === 'public' ? '公共子网' : '扁平子网';
            const accent = subnet.kind === 'public' ? ACCENT.subnetPublic : ACCENT.subnetFlat;

            nodesOut.push({
              id: subnetNodeId,
              position: { x: pnX(7), y: blockTop + index * NIC_STEP },
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
          yCursor = blockTop + Math.max(1, relatedSubnets.length) * NIC_STEP;
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
    harvesterNodesProp,
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
