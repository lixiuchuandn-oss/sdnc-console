import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Space, Table, Tag, Tooltip, Typography, message } from 'antd';
import {
  CloseOutlined,
  ExpandOutlined,
  LockOutlined,
  ReloadOutlined,
  UnlockOutlined,
  UnorderedListOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
} from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import ReactFlow, { Background, useReactFlow } from 'react-flow-renderer';
import {
  fetchSrv6HubStatus,
  fetchSrv6Reconcile,
  fetchSrv6Topology,
  fetchSrv6Tunnel,
  fetchSrv6Tunnels,
  type Srv6HubVrStatus,
  type Srv6ReconcileReport,
} from '../../../../services/api';
import IbrWizardPageHeader from '../lib/IbrWizardPageHeader';
import { loadIbrVrCatalog } from '../lib/ibrVrCatalog';
import {
  abbrIfName,
  buildHubTopology,
  buildP2pTopology,
  summarizeTopology,
  type Srv6Topology,
  type TunnelLite,
} from './lib/topology/buildTopology';
import { TOPO_EDGE_TYPES, TOPO_NODE_TYPES, toFlowElements } from './lib/topology/TopoNodes';
import {
  STATUS_COLOR,
  STATUS_LABEL,
  buildStatusMap,
  relatedIds,
  tunnelStatus,
  type ConfigStatus,
  type Selection,
  type VrStatus,
} from './lib/topology/status';
import TopoDetailDrawer from './lib/topology/TopoDetailDrawer';

type ArchFlowToolbarProps = {
  locked: boolean;
  onLockedChange: (locked: boolean) => void;
  tunnelCount: number;
  listOpen: boolean;
  refreshing: boolean;
  onToggleTunnelList: () => void;
  onRefresh: () => void;
};

/** 画布工具栏：隧道列表 / 刷新 | 缩小 / 放大 | 适应 / 锁定 */
const ArchFlowToolbar: React.FC<ArchFlowToolbarProps> = ({
  locked,
  onLockedChange,
  tunnelCount,
  listOpen,
  refreshing,
  onToggleTunnelList,
  onRefresh,
}) => {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  return (
    <div className="srv6-arch-flow-toolbar" role="toolbar" aria-label="画布工具">
      <Tooltip title={`${listOpen ? '收起' : '展开'}隧道列表 · ${tunnelCount}`}>
        <Button
          type="text"
          size="small"
          icon={<UnorderedListOutlined />}
          className={listOpen ? 'is-locked' : undefined}
          onClick={onToggleTunnelList}
        />
      </Tooltip>
      <Tooltip title="刷新">
        <Button type="text" size="small" icon={<ReloadOutlined />} loading={refreshing} onClick={onRefresh} />
      </Tooltip>
      <span className="srv6-arch-flow-toolbar-sep" />
      <Tooltip title="缩小">
        <Button type="text" size="small" icon={<ZoomOutOutlined />} disabled={locked} onClick={() => zoomOut()} />
      </Tooltip>
      <Tooltip title="放大">
        <Button type="text" size="small" icon={<ZoomInOutlined />} disabled={locked} onClick={() => zoomIn()} />
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

const ArchFlowLegend: React.FC<{ mode: Srv6Topology['mode']; hasStatus: boolean }> = ({ mode, hasStatus }) => (
  <div className="srv6-arch-flow-legend" aria-label="图例">
    {mode === 'hub' ? (
      <>
        <span>
          <i className="srv6-arch-legend-swatch is-hub" />
          Hub PE
        </span>
        <span>
          <i className="srv6-arch-legend-swatch is-spoke" />
          Spoke PE
        </span>
      </>
    ) : (
      <span>
        <i className="srv6-arch-legend-swatch is-spoke" />
        PE
      </span>
    )}
    <span>
      <i className="srv6-arch-legend-swatch is-ce" />
      CE
    </span>
    <span>
      <i className="srv6-arch-legend-line is-tunnel" />
      隧道
    </span>
    <span>
      <i className="srv6-arch-legend-line is-attach" />
      接入
    </span>
    <span className="srv6-arch-legend-sep" />
    {(['ok', 'issue', 'repaired', 'unknown'] as ConfigStatus[])
      .filter((s) => hasStatus || s === 'unknown')
      .map((s) => (
        <span key={s}>
          <i className="srv6-topo-status-dot" style={{ background: STATUS_COLOR[s] }} />
          {STATUS_LABEL[s]}
        </span>
      ))}
  </div>
);

type ArchCanvasProps = {
  topo: Srv6Topology;
  nameOf: (uuid: string) => string;
  statusMap: Record<string, VrStatus>;
  selection: Selection;
  hoverTunnelId: string | null;
  listOpen: boolean;
  refreshing: boolean;
  onSelect: (sel: Selection) => void;
  onToggleTunnelList: () => void;
  onRefresh: () => void;
};

const ArchCanvas: React.FC<ArchCanvasProps> = ({
  topo,
  nameOf,
  statusMap,
  selection,
  hoverTunnelId,
  listOpen,
  refreshing,
  onSelect,
  onToggleTunnelList,
  onRefresh,
}) => {
  const [locked, setLocked] = useState(false);
  const related = useMemo(() => relatedIds(topo, selection), [topo, selection]);
  const { nodes, edges } = useMemo(
    () => toFlowElements(topo, nameOf, { statusMap, related, hoverTunnelId }),
    [topo, nameOf, statusMap, related, hoverTunnelId],
  );
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={TOPO_NODE_TYPES}
      edgeTypes={TOPO_EDGE_TYPES}
      fitView
      fitViewOptions={{ padding: 0.18 }}
      minZoom={0.2}
      maxZoom={1.5}
      attributionPosition="bottom-right"
      nodesDraggable={!locked}
      nodesConnectable={false}
      elementsSelectable
      panOnDrag={!locked}
      zoomOnScroll={!locked}
      zoomOnPinch={!locked}
      zoomOnDoubleClick={!locked}
      preventScrolling
      onNodeClick={(_, n) => onSelect({ kind: 'node', id: n.id })}
      onEdgeClick={(_, e) => {
        if (e.id.startsWith('t:')) onSelect({ kind: 'tunnel', id: e.id.slice(2) });
      }}
      onPaneClick={() => onSelect(null)}
    >
      <Background gap={20} size={1} color="#f0f0f0" />
      <ArchFlowToolbar
        locked={locked}
        onLockedChange={setLocked}
        tunnelCount={topo.tunnels.length}
        listOpen={listOpen}
        refreshing={refreshing}
        onToggleTunnelList={onToggleTunnelList}
        onRefresh={onRefresh}
      />
      <ArchFlowLegend mode={topo.mode} hasStatus={Object.values(statusMap).some((s) => s.status !== 'unknown')} />
    </ReactFlow>
  );
};

function toTunnelLite(it: any): TunnelLite {
  return {
    id: it?.id,
    name: it?.name,
    peA: it?.peA,
    peB: it?.peB,
    ceA: it?.ceA,
    ceB: it?.ceB,
    tunnelTopology: it?.tunnelTopology,
    hubPeSlot: it?.hubPeSlot,
    peAInnerIf: it?.peAInnerIf ?? null,
    peBInnerIf: it?.peBInnerIf ?? null,
  };
}

/** 判定架构中心 PE：H 型取 Hub；否则取被 ≥2 条隧道引用的一端；均无则为点对点 */
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
  const [hubs, setHubs] = useState<Srv6HubVrStatus[]>([]);
  const setHub = (h: Srv6HubVrStatus | null) => setHubs(h ? [h] : []);
  const [reconcile, setReconcile] = useState<Srv6ReconcileReport | null>(null);
  const [vrNameMap, setVrNameMap] = useState<Record<string, string>>({});
  const [listOpen, setListOpen] = useState(false);
  const [selection, setSelection] = useState<Selection>(null);
  const [hoverTunnelId, setHoverTunnelId] = useState<string | null>(null);

  const vrLabel = useCallback(
    (uuid?: string | null) => {
      const id = String(uuid || '').trim();
      if (!id) return '—';
      return vrNameMap[id] || id;
    },
    [vrNameMap],
  );

  const loadSeqRef = useRef(0);

  const load = useCallback(
    async (opts?: { soft?: boolean }) => {
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
        setSelection(null);
      }
      try {
        // P2：优先走聚合接口（一次请求 + 双 Hub + 拓扑内精确对账）；后端未升级时回退旧链路
        const [agg, catalogFirst] = await Promise.all([
          fetchSrv6Topology(tunnelId).catch(() => null),
          loadIbrVrCatalog({ force: true }).catch(() => ({ nameMap: {} as Record<string, string> })),
        ]);
        if (seq !== loadSeqRef.current) return;
        if (agg && Array.isArray(agg.tunnels)) {
          setVrNameMap(catalogFirst.nameMap || {});
          const all = agg.tunnels.map(toTunnelLite);
          setTunnels(all);
          setFocusTunnel(all.find((t) => t.id === agg.focusTunnelId) || all[0] || null);
          setHubs(agg.mode === 'hub' ? agg.hubs || [] : []);
          setReconcile(agg.reconcile && !agg.reconcile.error ? agg.reconcile : null);
          setHint(null);
          return;
        }
        const [detail, list, catalog, recon] = await Promise.all([
          fetchSrv6Tunnel(tunnelId),
          fetchSrv6Tunnels({ skipCache: true }),
          loadIbrVrCatalog({ force: true }).catch(() => ({ nameMap: {} as Record<string, string> })),
          // 对账只读；失败不阻塞拓扑，状态降级为「未对账」
          fetchSrv6Reconcile().catch(() => null),
        ]);
        if (seq !== loadSeqRef.current) return;
        setVrNameMap(catalog.nameMap || {});
        setReconcile(recon && Array.isArray(recon.items) ? recon : null);
        const all = (Array.isArray(list) ? list : []).map(toTunnelLite);
        setTunnels(all);
        const focus = toTunnelLite({ ...detail, id: detail?.id || tunnelId, name: detail?.name || tunnelId });
        setFocusTunnel(focus);

        const hubUuid = resolveArchitecturePeUuid(focus, all);
        if (!hubUuid) {
          setHub(null);
          setHint(null);
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
    },
    [tunnelId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const topo: Srv6Topology | null = useMemo(() => {
    if (!focusTunnel) return null;
    if (hubs.length) {
      const t = buildHubTopology(hubs, tunnels, focusTunnel.id);
      if (t.tunnels.length) return t;
    }
    return buildP2pTopology(focusTunnel, focusTunnel.id);
  }, [hubs, tunnels, focusTunnel]);

  const statusMap = useMemo(() => (topo ? buildStatusMap(topo, reconcile) : {}), [topo, reconcile]);
  const summary = topo ? summarizeTopology(topo) : null;
  const issueTunnels = topo ? topo.tunnels.filter((t) => tunnelStatus(topo, t.id, statusMap) === 'issue').length : 0;

  const tunnelRows = useMemo(() => {
    if (!topo) return [];
    return topo.tunnels.map((t) => ({ ...t, status: tunnelStatus(topo, t.id, statusMap) }));
  }, [topo, statusMap]);

  const enterTunnel = (id: string) =>
    navigate(`/admin/interconnect/srv6/architecture?tunnelId=${encodeURIComponent(id)}`);

  const title =
    topo?.mode === 'hub' && hubs.length > 1
      ? `架构拓扑 · 多 Hub（${hubs.map((h) => vrLabel(h.vrUuid)).join(' / ')}）`
      : topo?.mode === 'hub' && topo.centerUuid
      ? `架构拓扑 · 以 ${vrLabel(topo.centerUuid)} 为中心`
      : focusTunnel
        ? `架构拓扑 · ${focusTunnel.name}`
        : '架构拓扑';

  const canvasH = listOpen ? 'calc(100vh - 220px - 260px)' : 'calc(100vh - 220px)';

  return (
    <div className="ibr-wizard-page">
      <IbrWizardPageHeader title={title} onBack={() => navigate('/admin/interconnect/srv6')} />
      {hint ? (
        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          {hint}
        </Typography.Text>
      ) : null}

      {loading ? (
        <Card loading style={{ minHeight: 480 }} />
      ) : topo && topo.nodes.length > 0 ? (
        <>
          <Card
            size="small"
            className="srv6-arch-flow-card"
            styles={{ body: { padding: 0, height: canvasH, minHeight: 420 } }}
          >
            <div style={{ width: '100%', height: '100%', position: 'relative' }}>
              {summary ? (
                <div className="srv6-topo-summary" aria-label="拓扑摘要">
                  {topo.mode === 'hub' ? (
                    <>
                      <span>
                        Hub <b>{summary.hub}</b>
                      </span>
                      <span>
                        Spoke <b>{summary.spoke}</b>
                      </span>
                    </>
                  ) : (
                    <span>点对点</span>
                  )}
                  <span>
                    CE <b>{summary.ce}</b>
                  </span>
                  <span>
                    隧道 <b>{summary.tunnels}</b>
                    {issueTunnels ? <em className="is-issue">（差异 {issueTunnels}）</em> : null}
                  </span>
                  {!reconcile ? <span className="is-muted">对账不可用</span> : null}
                </div>
              ) : null}
              <ArchCanvas
                topo={topo}
                nameOf={vrLabel}
                statusMap={statusMap}
                selection={selection}
                hoverTunnelId={hoverTunnelId}
                listOpen={listOpen}
                refreshing={refreshing}
                onSelect={setSelection}
                onToggleTunnelList={() => setListOpen((v) => !v)}
                onRefresh={() => {
                  void load({ soft: true });
                }}
              />
            </div>
          </Card>

          {listOpen ? (
            <Card
              size="small"
              className="srv6-topo-list-panel"
              title={`隧道列表 · ${tunnelRows.length}`}
              extra={<Button type="text" size="small" icon={<CloseOutlined />} onClick={() => setListOpen(false)} />}
              styles={{ body: { padding: 0, height: 210, overflow: 'auto' } }}
            >
              <Table
                className="std-table"
                bordered={false}
                size="small"
                pagination={false}
                rowKey="id"
                scroll={{ x: true }}
                dataSource={tunnelRows}
                rowClassName={(r) =>
                  selection?.kind === 'tunnel' && selection.id === r.id ? 'srv6-topo-row-active' : ''
                }
                onRow={(r) => ({
                  onMouseEnter: () => setHoverTunnelId(r.id),
                  onMouseLeave: () => setHoverTunnelId(null),
                  onClick: () => setSelection({ kind: 'tunnel', id: r.id }),
                })}
                columns={[
                  {
                    title: '隧道',
                    dataIndex: 'name',
                    key: 'name',
                    fixed: 'left',
                    render: (name: string, r) => (
                      <Space>
                        <i className="srv6-topo-status-dot" style={{ background: STATUS_COLOR[r.status] }} />
                        <span>{name}</span>
                        {r.focus ? <Tag color="blue">当前</Tag> : null}
                      </Space>
                    ),
                  },
                  {
                    title: '配置态',
                    key: 'status',
                    render: (_: unknown, r) => STATUS_LABEL[r.status as ConfigStatus],
                  },
                  {
                    title: topo.mode === 'hub' ? 'Hub PE' : 'PE-A',
                    key: 'src',
                    render: (_: unknown, r) => vrLabel(r.sourceUuid),
                  },
                  {
                    title: topo.mode === 'hub' ? 'Spoke PE' : 'PE-B',
                    key: 'dst',
                    render: (_: unknown, r) => vrLabel(r.targetUuid),
                  },
                  {
                    title: 'Hub WAN',
                    dataIndex: 'hubWanIf',
                    key: 'wan',
                    render: (v) => (v ? abbrIfName(v) : '-'),
                  },
                  { title: '公网邻居', dataIndex: 'peerPublicNeighbor', key: 'nbr', render: (v) => v || '-' },
                  { title: 'LAN', dataIndex: 'lanIf', key: 'lanIf', render: (v) => v || '-' },
                  {
                    title: '操作',
                    key: 'actions',
                    fixed: 'right',
                    render: (_: unknown, r) => (
                      <Button
                        type="link"
                        size="small"
                        disabled={r.focus}
                        onClick={(e) => {
                          e.stopPropagation();
                          enterTunnel(r.id);
                        }}
                      >
                        以此为入口
                      </Button>
                    ),
                  },
                ]}
              />
            </Card>
          ) : null}

          <TopoDetailDrawer
            topo={topo}
            selection={selection}
            statusMap={statusMap}
            nameOf={vrLabel}
            onClose={() => setSelection(null)}
            onSelectTunnel={(id) => setSelection({ kind: 'tunnel', id })}
            onEnterTunnel={enterTunnel}
          />
        </>
      ) : !hint ? (
        <Typography.Text type="secondary">暂无可用的架构数据</Typography.Text>
      ) : null}
    </div>
  );
};

export default Srv6ArchitecturePage;
