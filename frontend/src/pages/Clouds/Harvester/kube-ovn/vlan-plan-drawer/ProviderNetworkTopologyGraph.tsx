import React, { useMemo } from 'react';
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  Position,
  type Edge,
  type Node,
} from 'react-flow-renderer';
import 'react-flow-renderer/dist/style.css';
import { PartitionOutlined } from '@ant-design/icons';
import { Spin } from 'antd';
import { TOWER_IO_ALIES_ANNOTATION } from '../../../../../utils/towerKubeOvnNames';

export type PnNicTopologyShape = {
  defaultIf: string;
  customList: Array<{ interface?: string; nodes?: unknown[] }>;
  nodesOnDefault: string[];
};

export type PnSubnetRef = {
  name: string;
  alias: string;
  vlan: string;
  cidr: string;
};

/** 与抽屉 / Ant Design 主色协调的节点色条 */
const ACCENT = {
  nicDefault: '#52c41a',
  nicCustom: '#fa8c16',
  nicMuted: '#bfbfbf',
  hub: '#1677ff',
  vlan: '#2f54eb',
  subnetPublic: '#1677ff',
  subnetFlat: '#13c2c2',
  neutral: '#d9d9d9',
} as const;

function safeNodeId(prefix: string, raw: string) {
  const s = String(raw || '').replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${prefix}_${s || 'x'}`;
}

const edgeDefault = {
  style: { stroke: '#c5cad3', strokeWidth: 2 },
  type: 'smoothstep' as const,
  markerEnd: {
    type: MarkerType.ArrowClosed,
    color: '#c5cad3',
    width: 11,
    height: 11,
  },
};

function TopoNodeCard(props: {
  accent: string;
  muted?: boolean;
  dashed?: boolean;
  children: React.ReactNode;
}) {
  const { accent, muted, dashed, children } = props;
  return (
    <div
      style={{
        display: 'flex',
        borderRadius: 10,
        overflow: 'hidden',
        border: dashed ? `1px dashed ${muted ? '#d9d9d9' : '#adc6ff'}` : '1px solid rgba(22, 119, 255, 0.08)',
        boxShadow: muted
          ? '0 1px 2px rgba(15, 23, 42, 0.04)'
          : '0 1px 3px rgba(15, 23, 42, 0.06), 0 4px 14px rgba(15, 23, 42, 0.05)',
      }}
    >
      <div style={{ width: 3, flexShrink: 0, background: accent }} aria-hidden />
      <div
        style={{
          flex: 1,
          minWidth: 0,
          background: muted ? '#fafafa' : '#fff',
        }}
      >
        {children}
      </div>
    </div>
  );
}

function LabelBlock(props: {
  kicker?: string;
  title: string;
  detail?: string;
  tone?: 'default' | 'muted';
  accent?: string;
  dashed?: boolean;
}) {
  const { kicker, title, detail, tone = 'default', accent = ACCENT.neutral, dashed } = props;
  const muted = tone === 'muted';
  return (
    <TopoNodeCard accent={muted ? ACCENT.nicMuted : accent} muted={muted} dashed={!!dashed && muted}>
      <div style={{ padding: '11px 14px', maxWidth: 236, lineHeight: 1.5 }}>
        {kicker ? (
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.06em',
              color: '#8c8c8c',
              textTransform: 'uppercase',
              marginBottom: 5,
            }}
          >
            {kicker}
          </div>
        ) : null}
        <div
          style={{
            fontWeight: 600,
            fontSize: 13,
            color: muted ? '#8c8c8c' : '#1f1f1f',
            wordBreak: 'break-word',
          }}
        >
          {title}
        </div>
        {detail ? (
          <div
            style={{
              fontSize: 11,
              color: '#8c8c8c',
              marginTop: 6,
              wordBreak: 'break-word',
              lineHeight: 1.45,
            }}
          >
            {detail}
          </div>
        ) : null}
      </div>
    </TopoNodeCard>
  );
}

function HubNodeLabel(props: {
  title: string;
  pnMetaName: string;
  pnReady: boolean;
}) {
  const { title, pnMetaName, pnReady } = props;
  return (
    <div
      style={{
        display: 'flex',
        borderRadius: 12,
        overflow: 'hidden',
        border: '1px solid rgba(22, 119, 255, 0.18)',
        boxShadow: '0 2px 6px rgba(22, 119, 255, 0.08), 0 8px 24px rgba(15, 23, 42, 0.06)',
        minWidth: 216,
        maxWidth: 280,
      }}
    >
      <div
        style={{
          width: 4,
          flexShrink: 0,
          background: 'linear-gradient(180deg, #4096ff 0%, #0958d9 100%)',
        }}
        aria-hidden
      />
      <div
        style={{
          flex: 1,
          minWidth: 0,
          padding: '14px 16px',
          background: 'linear-gradient(155deg, #f0f7ff 0%, #ffffff 52%, #fafcff 100%)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: 'linear-gradient(145deg, #e6f4ff, #f0f9ff)',
              border: '1px solid rgba(22, 119, 255, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <PartitionOutlined style={{ color: '#1677ff', fontSize: 22 }} />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontWeight: 600,
                fontSize: 14,
                color: '#1f1f1f',
                lineHeight: 1.35,
                wordBreak: 'break-word',
              }}
            >
              {title}
            </div>
            <div
              style={{
                marginTop: 10,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '3px 10px',
                borderRadius: 999,
                background: pnReady ? '#f6ffed' : '#fafafa',
                border: `1px solid ${pnReady ? '#b7eb8f' : '#e8e8e8'}`,
                fontSize: 11,
                fontWeight: 500,
                color: pnReady ? '#389e0d' : '#8c8c8c',
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: pnReady ? '#52c41a' : '#bfbfbf',
                  flexShrink: 0,
                }}
              />
              {pnReady ? '已就绪' : '未就绪'}
            </div>
            <div
              style={{
                marginTop: 10,
                fontSize: 11,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                color: '#8c8c8c',
                wordBreak: 'break-all',
                lineHeight: 1.4,
              }}
            >
              {pnMetaName || '—'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

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
};

const flowChromeStyles = `
.pn-provider-topology-flow .react-flow__node {
  padding: 0 !important;
  border: none !important;
  background: transparent !important;
  box-shadow: none !important;
  font-family: inherit;
}
.pn-provider-topology-flow .react-flow__node-default {
  padding: 0 !important;
  border: none !important;
  background: transparent !important;
  box-shadow: none !important;
}
.pn-provider-topology-flow .react-flow__attribution {
  display: none;
}
.pn-provider-topology-flow .react-flow__controls {
  top: 10px !important;
  right: 10px !important;
  bottom: auto !important;
  left: auto !important;
  display: flex !important;
  flex-direction: row !important;
  flex-wrap: nowrap !important;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 1px 4px rgba(15, 23, 42, 0.08);
  border: 1px solid #f0f0f0;
}
.pn-provider-topology-flow .react-flow__controls-button {
  border-bottom: none !important;
  border-right: 1px solid #f0f0f0;
}
.pn-provider-topology-flow .react-flow__controls-button:last-child {
  border-right: none;
}
`;

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
}) => {
  const { nodes, edges, flowKey } = useMemo(() => {
    const nodesOut: Node[] = [];
    const edgesOut: Edge[] = [];
    const PN_ID = 'topo_pn';

    const nicStep = 100;
    const nicBaseX = 0;
    const pnX = 288;
    const vlanX = 588;
    const subnetX = 888;

    let nicIndex = 0;
    const pushNic = (id: string, label: React.ReactNode) => {
      const y = 44 + nicIndex * nicStep;
      nicIndex += 1;
      nodesOut.push({
        id,
        position: { x: nicBaseX, y },
        data: { label },
        sourcePosition: Position.Right,
      });
      edgesOut.push({ id: `e_${id}_${PN_ID}`, source: id, target: PN_ID, ...edgeDefault });
    };

    if (pnNicTopology) {
      const { defaultIf, customList, nodesOnDefault } = pnNicTopology;
      if (defaultIf) {
        const nodesHint =
          customList.length > 0
            ? nodesOnDefault.length
              ? `节点：${nodesOnDefault.join('，')}`
              : '无节点走默认网卡（均已映射到自定义口）'
            : pnReadyNodes.length > 0
              ? `就绪节点：${pnReadyNodes.join('，')}`
              : undefined;
        pushNic(
          'topo_nic_default',
          <LabelBlock kicker="默认上行网卡" title={defaultIf} detail={nodesHint} accent={ACCENT.nicDefault} />,
        );
      }
      customList.forEach((c, i) => {
        const iface = String(c?.interface ?? '').trim() || '—';
        const nodes = (Array.isArray(c?.nodes) ? c.nodes : [])
          .map((x: unknown) => String(x ?? '').trim())
          .filter(Boolean);
        pushNic(
          safeNodeId('topo_nic_c', `${i}-${iface}`),
          <LabelBlock
            kicker="自定义网卡 → 节点"
            title={iface}
            detail={nodes.length ? `节点：${nodes.join('，')}` : '未指定节点'}
            accent={ACCENT.nicCustom}
          />,
        );
      });
      if (!defaultIf && customList.length === 0) {
        pushNic(
          'topo_nic_unset',
          <LabelBlock
            kicker="物理网卡"
            title="未配置 defaultInterface"
            detail="请检查 ProviderNetwork spec"
            tone="muted"
            dashed
          />,
        );
      }
    } else {
      pushNic(
        'topo_nic_na',
        <LabelBlock kicker="物理网卡" title="—" detail="无物理网络数据" tone="muted" dashed />,
      );
    }

    const nicCount = Math.max(nicIndex, 1);
    const stackCenterY = 44 + ((nicCount - 1) * nicStep) / 2;

    nodesOut.push({
      id: PN_ID,
      position: { x: pnX, y: stackCenterY - 52 },
      data: {
        label: (
          <HubNodeLabel
            title={pnDisplayTitle || pnMetaName || '物理网络'}
            pnMetaName={pnMetaName}
            pnReady={pnReady}
          />
        ),
      },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    });

    let yCursor = 36;
    const vlanMetaKeys = displayedVlans.map((v) => String(v?.metadata?.name ?? '').trim()).join('|');

    if (vlanLoading && displayedVlans.length === 0) {
      const VID = 'topo_vlan_loading';
      nodesOut.push({
        id: VID,
        position: { x: vlanX, y: yCursor },
        data: {
          label: (
            <TopoNodeCard accent={ACCENT.hub}>
              <div style={{ padding: '28px 24px', minWidth: 168, textAlign: 'center' }}>
                <Spin size="small" />
                <div style={{ marginTop: 10, fontSize: 12, color: '#8c8c8c', fontWeight: 500 }}>加载 VLAN…</div>
              </div>
            </TopoNodeCard>
          ),
        },
        targetPosition: Position.Left,
      });
      edgesOut.push({ id: `e_${PN_ID}_${VID}`, source: PN_ID, target: VID, ...edgeDefault });
      yCursor += 120;
    } else if (displayedVlans.length === 0) {
      const VID = 'topo_vlan_empty';
      nodesOut.push({
        id: VID,
        position: { x: vlanX, y: yCursor },
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
        targetPosition: Position.Left,
      });
      edgesOut.push({ id: `e_${PN_ID}_${VID}`, source: PN_ID, target: VID, ...edgeDefault });
      yCursor += 100;
    } else {
      displayedVlans.forEach((vlanItem) => {
        const ann = vlanItem?.metadata?.annotations || {};
        const displayAlias = String(ann[TOWER_IO_ALIES_ANNOTATION] || '').trim();
        const metaName = String(vlanItem?.metadata?.name || '').trim();
        const vTitle = displayAlias || metaName || '—';
        const vlanId = vlanItem?.spec?.id;
        const vlanIdStr = vlanId !== undefined && vlanId !== null ? String(vlanId) : '—';
        const vlanNodeId = safeNodeId('topo_vlan', metaName || vTitle);

        const pub = publicSubnetsForPn.filter((s) => String(s.vlan) === metaName);
        const flt = flatSubnetsForPn.filter((s) => String(s.vlan) === metaName);
        const combined = [
          ...pub.map((s) => ({ ...s, kind: 'public' as const })),
          ...flt.map((s) => ({ ...s, kind: 'flat' as const })),
        ];

        const blockTop = yCursor;
        nodesOut.push({
          id: vlanNodeId,
          position: { x: vlanX, y: blockTop },
          data: {
            label: (
              <LabelBlock
                kicker="VLAN"
                title={vTitle}
                detail={`标签 ID ${vlanIdStr} · 资源名 ${metaName || '—'}`}
                accent={ACCENT.vlan}
              />
            ),
          },
          sourcePosition: Position.Right,
          targetPosition: Position.Left,
        });
        edgesOut.push({ id: `e_${PN_ID}_${vlanNodeId}`, source: PN_ID, target: vlanNodeId, ...edgeDefault });

        if (combined.length === 0) {
          const sid = safeNodeId('topo_subnet_empty', metaName || vTitle);
          nodesOut.push({
            id: sid,
            position: { x: subnetX, y: blockTop },
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
          edgesOut.push({ id: `e_${vlanNodeId}_${sid}`, source: vlanNodeId, target: sid, ...edgeDefault });
          yCursor = blockTop + 104;
        } else {
          combined.forEach((s, j) => {
            const sid = safeNodeId('topo_sn', `${s.kind}-${s.name}`);
            const title = String(s.alias || '').trim() || s.name;
            const kindLabel = s.kind === 'public' ? '公共子网' : '扁平子网';
            const accent = s.kind === 'public' ? ACCENT.subnetPublic : ACCENT.subnetFlat;
            nodesOut.push({
              id: sid,
              position: { x: subnetX, y: blockTop + j * 92 },
              data: {
                label: (
                  <LabelBlock
                    kicker={kindLabel}
                    title={title}
                    detail={s.cidr && s.cidr !== '-' ? s.cidr : undefined}
                    accent={accent}
                  />
                ),
              },
              targetPosition: Position.Left,
            });
            edgesOut.push({ id: `e_${vlanNodeId}_${sid}`, source: vlanNodeId, target: sid, ...edgeDefault });
          });
          yCursor = blockTop + Math.max(100, combined.length * 92) + 28;
        }
      });
    }

    const flowKey = `${pnMetaName}_${vlanMetaKeys}_${publicSubnetsForPn.length}_${flatSubnetsForPn.length}_${vlanLoading ? 1 : 0}`;

    return { nodes: nodesOut, edges: edgesOut, flowKey };
  }, [
    pnDisplayTitle,
    pnMetaName,
    pnReady,
    pnNicTopology,
    pnReadyNodes,
    displayedVlans,
    publicSubnetsForPn,
    flatSubnetsForPn,
    vlanLoading,
  ]);

  return (
    <div
      className="pn-provider-topology-flow"
      style={{
        flex: 1,
        minHeight: 200,
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 10,
        border: '1px solid #e8e8e8',
        background: '#f5f7fa',
        overflow: 'hidden',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.85)',
      }}
    >
      <style>{flowChromeStyles}</style>
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
        defaultEdgeOptions={edgeDefault}
      >
        <Background
          id="pn-topo-bg"
          variant={BackgroundVariant.Dots}
          gap={22}
          size={1.15}
          color="#d9dee8"
        />
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
      </ReactFlow>
    </div>
  );
};

export default ProviderNetworkTopologyGraph;
