import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Modal, Space, Table, Tag, Tooltip, Typography, message } from 'antd';
import {
  ExpandOutlined,
  LockOutlined,
  ReloadOutlined,
  UnlockOutlined,
  UnorderedListOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
} from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import ReactFlow, {
  Background,
  Handle,
  MarkerType,
  Position,
  useReactFlow,
  type NodeProps,
} from 'react-flow-renderer';
import {
  fetchSrv6HubStatus,
  fetchSrv6Tunnel,
  fetchSrv6Tunnels,
  type Srv6HubVrStatus,
} from '../../../../services/api';
import IbrWizardPageHeader from '../lib/IbrWizardPageHeader';
import { loadIbrVrCatalog } from '../lib/ibrVrCatalog';

type TunnelLite = {
  id: string;
  name: string;
  peA: string;
  peB: string;
  ceA: string;
  ceB: string;
  tunnelTopology?: 'S' | 'H' | null;
  hubPeSlot?: 'peA' | 'peB' | null;
};

type SpokeRow = {
  tunnelId: string;
  tunnelName: string;
  spokeUuid: string;
  wanIf: string;
  peerPublicNeighbor: string;
  lanIf: string;
  highlight: boolean;
};

type HubNodeData = {
  name: string;
  tunnelCount: number;
};

type SpokeNodeData = {
  name: string;
  tunnelName: string;
  peerPublicNeighbor?: string;
  highlight?: boolean;
};

/** 四周透明锚点，星型布局时边从最近边接入 */
const NodeAnchors: React.FC<{ kind: 'source' | 'target' }> = ({ kind }) => (
  <>
    <Handle type={kind} id="top" position={Position.Top} className="srv6-arch-handle" />
    <Handle type={kind} id="right" position={Position.Right} className="srv6-arch-handle" />
    <Handle type={kind} id="bottom" position={Position.Bottom} className="srv6-arch-handle" />
    <Handle type={kind} id="left" position={Position.Left} className="srv6-arch-handle" />
  </>
);

const HubArchNode = memo(({ data }: NodeProps<HubNodeData>) => (
  <div className="srv6-arch-node srv6-arch-node--hub">
    <NodeAnchors kind="source" />
    <div className="srv6-arch-node-role">Hub PE</div>
    <div className="srv6-arch-node-name" title={data.name}>
      {data.name}
    </div>
    <div className="srv6-arch-node-meta">{data.tunnelCount} 条隧道</div>
  </div>
));
HubArchNode.displayName = 'HubArchNode';

const SpokeArchNode = memo(({ data }: NodeProps<SpokeNodeData>) => (
  <div
    className={`srv6-arch-node srv6-arch-node--spoke${data.highlight ? ' is-focus' : ''}`}
  >
    <NodeAnchors kind="target" />
    <div className="srv6-arch-node-role">
      Spoke PE
      {data.highlight ? <span className="srv6-arch-node-badge">当前</span> : null}
    </div>
    <div className="srv6-arch-node-name" title={data.name}>
      {data.name}
    </div>
    <div className="srv6-arch-node-meta" title={data.tunnelName}>
      {data.tunnelName}
    </div>
    {data.peerPublicNeighbor ? (
      <div className="srv6-arch-node-sub" title={data.peerPublicNeighbor}>
        {data.peerPublicNeighbor}
      </div>
    ) : null}
  </div>
));
SpokeArchNode.displayName = 'SpokeArchNode';

const ARCH_NODE_TYPES = {
  hub: HubArchNode,
  spoke: SpokeArchNode,
};

/** 由中心指向 Spoke 的极角，选最近边的 Handle */
function cardinalHandle(angle: number): 'top' | 'right' | 'bottom' | 'left' {
  const tau = Math.PI * 2;
  const a = ((angle % tau) + tau) % tau;
  if (a >= (7 * Math.PI) / 4 || a < Math.PI / 4) return 'right';
  if (a < (3 * Math.PI) / 4) return 'bottom';
  if (a < (5 * Math.PI) / 4) return 'left';
  return 'top';
}

function oppositeHandle(
  h: 'top' | 'right' | 'bottom' | 'left',
): 'top' | 'right' | 'bottom' | 'left' {
  if (h === 'top') return 'bottom';
  if (h === 'bottom') return 'top';
  if (h === 'left') return 'right';
  return 'left';
}

type ArchFlowToolbarProps = {
  locked: boolean;
  onLockedChange: (locked: boolean) => void;
  tunnelCount: number;
  refreshing: boolean;
  onOpenTunnelList: () => void;
  onRefresh: () => void;
};

/** 画布工具栏：隧道列表 / 刷新 | 缩小 / 放大 / 适应 / 锁定 */
const ArchFlowToolbar: React.FC<ArchFlowToolbarProps> = ({
  locked,
  onLockedChange,
  tunnelCount,
  refreshing,
  onOpenTunnelList,
  onRefresh,
}) => {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  return (
    <div className="srv6-arch-flow-toolbar" role="toolbar" aria-label="画布工具">
      <Tooltip title={`隧道列表 · ${tunnelCount}`}>
        <Button
          type="text"
          size="small"
          icon={<UnorderedListOutlined />}
          onClick={onOpenTunnelList}
        />
      </Tooltip>
      <Tooltip title="刷新">
        <Button
          type="text"
          size="small"
          icon={<ReloadOutlined />}
          loading={refreshing}
          onClick={onRefresh}
        />
      </Tooltip>
      <span className="srv6-arch-flow-toolbar-sep" />
      <Tooltip title="缩小">
        <Button
          type="text"
          size="small"
          icon={<ZoomOutOutlined />}
          disabled={locked}
          onClick={() => zoomOut()}
        />
      </Tooltip>
      <Tooltip title="放大">
        <Button
          type="text"
          size="small"
          icon={<ZoomInOutlined />}
          disabled={locked}
          onClick={() => zoomIn()}
        />
      </Tooltip>
      <span className="srv6-arch-flow-toolbar-sep" />
      <Tooltip title="适应画布">
        <Button
          type="text"
          size="small"
          icon={<ExpandOutlined />}
          onClick={() => fitView({ padding: 0.18, duration: 200 })}
        />
      </Tooltip>
      <Tooltip title={locked ? '解锁画布' : '锁定画布'}>
        <Button
          type="text"
          size="small"
          icon={locked ? <LockOutlined /> : <UnlockOutlined />}
          className={locked ? 'is-locked' : undefined}
          onClick={() => onLockedChange(!locked)}
        />
      </Tooltip>
    </div>
  );
};

const ArchFlowLegend: React.FC = () => (
  <div className="srv6-arch-flow-legend" aria-label="图例">
    <span>
      <i className="srv6-arch-legend-swatch is-hub" />
      Hub PE
    </span>
    <span>
      <i className="srv6-arch-legend-swatch is-spoke" />
      Spoke PE
    </span>
    <span>
      <i className="srv6-arch-legend-swatch is-focus" />
      当前入口
    </span>
  </div>
);

type ArchCanvasProps = {
  nodes: React.ComponentProps<typeof ReactFlow>['nodes'];
  edges: React.ComponentProps<typeof ReactFlow>['edges'];
  tunnelCount: number;
  refreshing: boolean;
  onOpenTunnelList: () => void;
  onRefresh: () => void;
};

const ArchCanvas: React.FC<ArchCanvasProps> = ({
  nodes,
  edges,
  tunnelCount,
  refreshing,
  onOpenTunnelList,
  onRefresh,
}) => {
  const [locked, setLocked] = useState(false);
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={ARCH_NODE_TYPES}
      fitView
      minZoom={0.2}
      maxZoom={1.5}
      attributionPosition="bottom-right"
      nodesDraggable={!locked}
      nodesConnectable={false}
      elementsSelectable={!locked}
      panOnDrag={!locked}
      zoomOnScroll={!locked}
      zoomOnPinch={!locked}
      zoomOnDoubleClick={!locked}
      preventScrolling
    >
      <Background gap={20} size={1} color="#f0f0f0" />
      <ArchFlowToolbar
        locked={locked}
        onLockedChange={setLocked}
        tunnelCount={tunnelCount}
        refreshing={refreshing}
        onOpenTunnelList={onOpenTunnelList}
        onRefresh={onRefresh}
      />
      <ArchFlowLegend />
    </ReactFlow>
  );
};

function resolveArchitecturePeUuid(row: TunnelLite, tunnels: TunnelLite[]): string | null {
  if (row.tunnelTopology === 'H' && row.hubPeSlot) {
    const hub = row.hubPeSlot === 'peA' ? row.peA : row.peB;
    return String(hub || '').trim() || null;
  }
  const peA = String(row.peA || '').trim();
  const peB = String(row.peB || '').trim();
  const countFor = (pe: string) =>
    pe ? tunnels.filter((t) => [t.peA, t.peB].map(String).includes(pe)).length : 0;
  const nA = countFor(peA);
  const nB = countFor(peB);
  if (nA >= 2 && nA >= nB) return peA;
  if (nB >= 2) return peB;
  return null;
}

const Srv6ArchitecturePage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const tunnelId = String(searchParams.get('tunnelId') || '').trim();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [focusTunnel, setFocusTunnel] = useState<TunnelLite | null>(null);
  const [tunnels, setTunnels] = useState<TunnelLite[]>([]);
  const [hub, setHub] = useState<Srv6HubVrStatus | null>(null);
  const [vrNameMap, setVrNameMap] = useState<Record<string, string>>({});
  const [tunnelListOpen, setTunnelListOpen] = useState(false);

  const vrLabel = useCallback(
    (uuid?: string | null) => {
      const id = String(uuid || '').trim();
      if (!id) return '—';
      return vrNameMap[id] || id;
    },
    [vrNameMap],
  );

  const loadSeqRef = useRef(0);

  const load = useCallback(async (opts?: { soft?: boolean }) => {
    if (!tunnelId) {
      setHint('缺少隧道参数 tunnelId');
      setLoading(false);
      return;
    }
    const seq = ++loadSeqRef.current;
    const soft = !!opts?.soft;
    if (soft) {
      setRefreshing(true);
    } else {
      setLoading(true);
      setHint(null);
      setHub(null);
    }
    try {
      const [detail, list, catalog] = await Promise.all([
        fetchSrv6Tunnel(tunnelId),
        fetchSrv6Tunnels({ skipCache: true }),
        loadIbrVrCatalog({ force: true }).catch(() => ({ nameMap: {} as Record<string, string> })),
      ]);
      if (seq !== loadSeqRef.current) return;
      setVrNameMap(catalog.nameMap || {});
      const all: TunnelLite[] = (Array.isArray(list) ? list : []).map((it: any) => ({
        id: it.id,
        name: it.name,
        peA: it.peA,
        peB: it.peB,
        ceA: it.ceA,
        ceB: it.ceB,
        tunnelTopology: it.tunnelTopology,
        hubPeSlot: it.hubPeSlot,
      }));
      setTunnels(all);
      const focus: TunnelLite = {
        id: detail?.id || tunnelId,
        name: detail?.name || tunnelId,
        peA: detail?.peA,
        peB: detail?.peB,
        ceA: detail?.ceA,
        ceB: detail?.ceB,
        tunnelTopology: detail?.tunnelTopology,
        hubPeSlot: detail?.hubPeSlot,
      };
      setFocusTunnel(focus);

      const hubUuid = resolveArchitecturePeUuid(focus, all);
      if (!hubUuid) {
        setHub(null);
        setHint(
          '当前为单条点对点隧道，四端已在列表可见，不再提供重复四端图。架构拓扑面向「Hub 多 Spoke / 同 PE 多隧道」场景。',
        );
        return;
      }
      const status = await fetchSrv6HubStatus(hubUuid);
      if (seq !== loadSeqRef.current) return;
      setHub(status);
      setHint(
        !status.isHub && status.tunnelCount < 2
          ? '该 PE 尚未形成 Hub 多隧道架构；下图仅展示当前引用关系。'
          : null,
      );
    } catch (e: any) {
      if (seq !== loadSeqRef.current) return;
      setHint(`加载架构失败：${e?.message || '请稍后重试'}`);
      message.error(e?.message || '加载架构失败');
    } finally {
      if (seq === loadSeqRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [tunnelId]);

  useEffect(() => {
    void load();
  }, [load]);

  const hubSpokes: SpokeRow[] = useMemo(() => {
    if (!hub) return [];
    return (hub.tunnels || [])
      .filter((t) => t.tunnelTopology === 'H' || hub.isHub || hub.tunnelCount >= 2)
      .map((t) => {
        const listRow = tunnels.find((r) => r.id === t.tunnelId);
        let spokeUuid = String(t.hubBindings?.spokePeUuid || '').trim();
        if (!spokeUuid && listRow) {
          const hubSlot = t.hubPeSlot || listRow.hubPeSlot;
          if (hubSlot === 'peA') spokeUuid = String(listRow.peB || '').trim();
          else if (hubSlot === 'peB') spokeUuid = String(listRow.peA || '').trim();
          else {
            spokeUuid = String(listRow.peA === hub.vrUuid ? listRow.peB : listRow.peA).trim();
          }
        }
        return {
          tunnelId: t.tunnelId,
          tunnelName: t.tunnelName,
          spokeUuid,
          wanIf: t.hubBindings?.wanIf || '',
          peerPublicNeighbor: t.hubBindings?.peerPublicNeighbor || '',
          lanIf: t.hubBindings?.lanIf || '',
          highlight: focusTunnel?.id === t.tunnelId,
        };
      })
      .filter((s) => s.spokeUuid);
  }, [hub, tunnels, focusTunnel?.id]);

  const topoNodes = useMemo(() => {
    if (!hub) return [];
    const hubId = hub.vrUuid;
    const cx = 480;
    const cy = 320;
    const nodes: Array<{
      id: string;
      type: 'hub' | 'spoke';
      position: { x: number; y: number };
      data: HubNodeData | SpokeNodeData;
      draggable?: boolean;
    }> = [
      {
        id: `hub-${hubId}`,
        type: 'hub',
        position: { x: cx - 96, y: cy - 44 },
        data: {
          name: vrLabel(hubId),
          tunnelCount: hub.tunnelCount,
        },
      },
    ];
    const n = Math.max(hubSpokes.length, 1);
    const r = Math.min(340, 170 + n * 30);
    hubSpokes.forEach((s, i) => {
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      nodes.push({
        id: `spoke-${s.tunnelId}`,
        type: 'spoke',
        position: {
          x: cx + Math.cos(angle) * r - 88,
          y: cy + Math.sin(angle) * r - 48,
        },
        data: {
          name: vrLabel(s.spokeUuid),
          tunnelName: s.tunnelName,
          peerPublicNeighbor: s.peerPublicNeighbor || undefined,
          highlight: s.highlight,
        },
      });
    });
    return nodes;
  }, [hub, hubSpokes, vrLabel]);

  const topoEdges = useMemo(() => {
    if (!hub) return [];
    const n = Math.max(hubSpokes.length, 1);
    return hubSpokes.map((s, i) => {
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      const from = cardinalHandle(angle);
      const stroke = s.highlight ? '#1677ff' : '#c9cdd4';
      return {
        id: `e-${s.tunnelId}`,
        source: `hub-${hub.vrUuid}`,
        target: `spoke-${s.tunnelId}`,
        sourceHandle: from,
        targetHandle: oppositeHandle(from),
        type: 'smoothstep',
        animated: s.highlight,
        label: s.wanIf ? `WAN ${s.wanIf}` : s.tunnelName,
        labelStyle: { fill: s.highlight ? '#1677ff' : '#86909c', fontSize: 11, fontWeight: 500 },
        labelBgStyle: { fill: '#fff', fillOpacity: 0.92 },
        labelBgPadding: [4, 6] as [number, number],
        labelBgBorderRadius: 4,
        style: { stroke, strokeWidth: s.highlight ? 2.25 : 1.5 },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: stroke,
          width: 16,
          height: 16,
        },
      };
    });
  }, [hub, hubSpokes]);

  const title = hub
    ? `架构拓扑 · Hub ${vrLabel(hub.vrUuid)}`
    : focusTunnel
      ? `架构拓扑 · ${focusTunnel.name}`
      : '架构拓扑';

  return (
    <div className="ibr-wizard-page">
      <IbrWizardPageHeader
        title={title}
        onBack={() => navigate('/admin/interconnect/srv6')}
      />
      {hint ? (
        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          {hint}
        </Typography.Text>
      ) : null}

      {loading ? (
        <Card loading style={{ minHeight: 480 }} />
      ) : hub && hubSpokes.length > 0 ? (
        <Card
          size="small"
          className="srv6-arch-flow-card"
          styles={{ body: { padding: 0, height: 'calc(100vh - 220px)', minHeight: 560 } }}
        >
          <div style={{ width: '100%', height: '100%', position: 'relative' }}>
            <ArchCanvas
              nodes={topoNodes}
              edges={topoEdges}
              tunnelCount={hubSpokes.length}
              refreshing={refreshing}
              onOpenTunnelList={() => setTunnelListOpen(true)}
              onRefresh={() => {
                void load({ soft: true });
              }}
            />
          </div>
        </Card>
      ) : !loading && !hint ? (
        <Typography.Text type="secondary">暂无可用的 Hub 多隧道架构数据</Typography.Text>
      ) : null}

      <Modal
        title={hub ? `隧道列表 · Hub ${vrLabel(hub.vrUuid)}` : '隧道列表'}
        open={tunnelListOpen}
        onCancel={() => setTunnelListOpen(false)}
        footer={null}
        width={960}
        destroyOnHidden
      >
        <Table
          className="std-table"
          bordered={false}
          size="small"
          pagination={false}
          rowKey="tunnelId"
          scroll={{ x: true }}
          dataSource={hubSpokes}
          columns={[
            {
              title: '隧道',
              dataIndex: 'tunnelName',
              key: 'tunnelName',
              fixed: 'left',
              render: (name: string, r) => (
                <Space>
                  <span>{name}</span>
                  {r.highlight ? <Tag color="blue">当前</Tag> : null}
                </Space>
              ),
            },
            {
              title: 'Spoke PE',
              key: 'spoke',
              render: (_: unknown, r) => vrLabel(r.spokeUuid),
            },
            { title: 'Hub WAN', dataIndex: 'wanIf', key: 'wanIf', render: (v) => v || '-' },
            {
              title: '公网邻居',
              dataIndex: 'peerPublicNeighbor',
              key: 'nbr',
              render: (v) => v || '-',
            },
            { title: 'LAN', dataIndex: 'lanIf', key: 'lanIf', render: (v) => v || '-' },
            {
              title: '操作',
              key: 'actions',
              fixed: 'right',
              render: (_: unknown, r) => (
                <Button
                  type="link"
                  size="small"
                  disabled={r.highlight}
                  onClick={() => {
                    setTunnelListOpen(false);
                    navigate(
                      `/admin/interconnect/srv6/architecture?tunnelId=${encodeURIComponent(r.tunnelId)}`,
                    );
                  }}
                >
                  以此为入口
                </Button>
              ),
            },
          ]}
        />
      </Modal>
    </div>
  );
};

export default Srv6ArchitecturePage;
