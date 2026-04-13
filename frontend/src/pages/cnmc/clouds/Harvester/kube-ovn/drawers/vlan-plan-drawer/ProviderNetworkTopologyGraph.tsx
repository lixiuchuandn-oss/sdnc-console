import React, { useMemo } from 'react';
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  Position,
  type Edge,
  type Node,
} from 'react-flow-renderer';
import 'react-flow-renderer/dist/style.css';
import { Spin } from 'antd';
import { TOWER_IO_ALIES_ANNOTATION } from '../../../../../../../utils/towerKubeOvnNames';
import {
  ACCENT,
  edgeDefault,
  flowChromeStyles,
  LabelBlock,
  safeNodeId,
  TopoNodeCard,
} from '../../lib/topology/kubeOvnTopoPrimitives';

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

const LAYER_X = {
  nic: 0,
  provider: 300,
  vlan: 600,
  subnet: 900,
} as const;
const NIC_STEP = 104;
const SUBNET_STEP = 92;
const START_Y = 40;

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
    const providerNodeId = 'topo_pn';

    let nicIndex = 0;
    const pushNicNode = (id: string, label: React.ReactNode) => {
      const y = START_Y + nicIndex * NIC_STEP;
      nicIndex += 1;
      nodesOut.push({
        id,
        position: { x: LAYER_X.nic, y },
        data: { label },
        sourcePosition: Position.Right,
      });
      edgesOut.push({ id: `e_${id}_${providerNodeId}`, source: id, target: providerNodeId, ...edgeDefault });
    };

    if (pnNicTopology) {
      const { defaultIf, customList, nodesOnDefault } = pnNicTopology;

      if (defaultIf) {
        const nodesHint =
          customList.length > 0
            ? nodesOnDefault.length
              ? `包含节点：${nodesOnDefault.join('，')}`
              : '其他节点已配置自定义网卡'
            : pnReadyNodes.length > 0
              ? `包含节点：${pnReadyNodes.join('，')}`
              : '当前无可用节点';

        pushNicNode(
          'topo_nic_default',
          <LabelBlock
            kicker="物理节点"
            title={`使用网卡 ${defaultIf}`}
            detail={nodesHint}
            accent={ACCENT.nicDefault}
          />,
        );
      }

      customList.forEach((item, index) => {
        const iface = String(item?.interface ?? '').trim() || '—';
        const nodes = (Array.isArray(item?.nodes) ? item.nodes : [])
          .map((value: unknown) => String(value ?? '').trim())
          .filter(Boolean);

        pushNicNode(
          safeNodeId('topo_nic_c', `${index}-${iface}`),
          <LabelBlock
            kicker="物理节点组 (自定义配置)"
            title={`使用网卡 ${iface}`}
            detail={nodes.length ? `包含节点：${nodes.join('，')}` : '未指定节点'}
            accent={ACCENT.nicCustom}
          />,
        );
      });

      if (!defaultIf && customList.length === 0) {
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
      }
    } else {
      pushNicNode(
        'topo_nic_na',
        <LabelBlock kicker="物理网卡" title="—" detail="无物理网络数据" tone="muted" dashed />,
      );
    }

    const nicCount = Math.max(nicIndex, 1);
    const providerY = START_Y + ((nicCount - 1) * NIC_STEP) / 2;

    nodesOut.push({
      id: providerNodeId,
      position: { x: LAYER_X.provider, y: providerY },
      data: {
        label: <ProviderBlock title={pnDisplayTitle || pnMetaName || '物理网络'} ready={pnReady} />,
      },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    });

    let yCursor = START_Y;
    const vlanMetaKeys = displayedVlans.map((item) => String(item?.metadata?.name ?? '').trim()).join('|');

    if (vlanLoading && displayedVlans.length === 0) {
      const loadingNodeId = 'topo_vlan_loading';
      nodesOut.push({
        id: loadingNodeId,
        position: { x: LAYER_X.vlan, y: yCursor },
        data: {
          label: (
            <TopoNodeCard accent={ACCENT.hub}>
              <div style={{ padding: '28px 24px', minHeight: 78, textAlign: 'left' }}>
                <Spin size="small" />
                <div style={{ marginTop: 10, fontSize: 12, color: '#8c8c8c', fontWeight: 500 }}>加载 VLAN…</div>
              </div>
            </TopoNodeCard>
          ),
        },
        targetPosition: Position.Left,
      });
      edgesOut.push({ id: `e_${providerNodeId}_${loadingNodeId}`, source: providerNodeId, target: loadingNodeId, ...edgeDefault });
      yCursor += 120;
    } else if (displayedVlans.length === 0) {
      const emptyNodeId = 'topo_vlan_empty';
      nodesOut.push({
        id: emptyNodeId,
        position: { x: LAYER_X.vlan, y: yCursor },
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
      edgesOut.push({ id: `e_${providerNodeId}_${emptyNodeId}`, source: providerNodeId, target: emptyNodeId, ...edgeDefault });
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
        edgesOut.push({ id: `e_${providerNodeId}_${vlanNodeId}`, source: providerNodeId, target: vlanNodeId, ...edgeDefault });

        if (relatedSubnets.length === 0) {
          const emptySubnetNodeId = safeNodeId('topo_subnet_empty', metaName || title);
          nodesOut.push({
            id: emptySubnetNodeId,
            position: { x: LAYER_X.subnet, y: blockTop },
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
          edgesOut.push({ id: `e_${vlanNodeId}_${emptySubnetNodeId}`, source: vlanNodeId, target: emptySubnetNodeId, ...edgeDefault });
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
            edgesOut.push({ id: `e_${vlanNodeId}_${subnetNodeId}`, source: vlanNodeId, target: subnetNodeId, ...edgeDefault });
          });
          yCursor = blockTop + Math.max(100, relatedSubnets.length * SUBNET_STEP) + 28;
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
