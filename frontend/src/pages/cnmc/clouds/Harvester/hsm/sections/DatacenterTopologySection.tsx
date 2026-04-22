/**
 * 机房拓扑（HSM 机柜 + 内嵌面板）
 * 归属 `hsm/`，与 `kube-ovn/` 一致：`sections/` 入口 + `../lib` 可复用块 + 域级 `hsm.css`。
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Button, Card, Divider, Popconfirm, Segmented, Space, Tooltip, message } from 'antd';
import { 
  DeleteOutlined,
  EditOutlined,
  InboxOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import {
  fetchHarvesterNodes,
  fetchAswCtlSwitchesSummary,
  fetchHarvesterResourceByLink,
} from '../../../../../../services/harvesterApi';
import { parseSwitchDisplayNameFromInfoLines, switchRecordManagementHost } from '../../cluster/lib/physicalSwitchRecordUtils';
import PhysicalNodeDetailDrawer from '../../cluster/drawers/PhysicalNodeDetailDrawer';
import PhysicalSwitchDetailDrawer from '../../cluster/drawers/PhysicalSwitchDetailDrawer';
import { EmbeddedPhysicalNodeBladeBody } from '../lib/embeddedPhysicalNodePanel';
import { EmbeddedSwitchPortPanelBody } from '../lib/embeddedSwitchPortPanel';
import {
  type NodeLiveMetrics,
  nodeCpuModelName,
  nodeManagementIp,
  parseCpuToCores,
  parseMemoryToBytes,
} from '../lib/physicalNodeRackUtils';
import '../hsm.css';
import AddRackDeviceModal from '../modals/AddRackDeviceModal';
import RackFormModal from '../modals/RackFormModal';
import {
  deleteDatacenterRack,
  deleteRackDevice,
  fetchDatacenterRacks,
  type DatacenterRack,
  type DatacenterRackDevice,
} from '../../../../../../services/datacenterTopologyApi';

const GRID_COLS = 24;

/** 每个机柜独占一行，横向占满 24 列栅格（`grid-column: 1 / -1` 等效于 `1 / 25`） */
function rackGridFullSpan(): string {
  return `1 / ${GRID_COLS + 1}`;
}

function normalizeNodes(json: any): any[] {
  const raw = json?.data?.items ?? json?.items ?? json?.data ?? [];
  return Array.isArray(raw) ? raw : [];
}

function nodeName(n: any): string {
  return String(n?.metadata?.name || n?.name || '').trim();
}

/** 与「集群 → 物理交换机」表格一致：用管理地址作为落库 refKey（与 Tower 入库 switchHost 对齐） */
function switchStableRef(sw: any): string {
  const host = switchRecordManagementHost(sw);
  if (host && host !== '—') return host;
  return String(sw?.switchHost || sw?.host || sw?.id || '').trim();
}

/**
 * 与「集群 → 物理交换机」表格「交换机名称」列一致：仅用语义化探测名，不用 `name`（多为 ASW-CTL 实例名）。
 * 含管理地址时与地址分行（机架条用 `\n`；下拉等单行处请 `.replace(/\n/g, ' · ')`）。
 */
function switchDisplayLabel(sw: any): string {
  const fromLines = String(parseSwitchDisplayNameFromInfoLines(sw?.info?.lines) || '').trim();
  const host = switchStableRef(sw);
  if (fromLines && host && host !== '—' && fromLines !== host) return `${fromLines}\n${host}`;
  if (fromLines) return fromLines;
  if (host && host !== '—') return host;
  return '物理交换机';
}

type Props = {
  cloudId: string;
  checkPerm: (act: string) => boolean;
};

const DatacenterTopologySection: React.FC<Props> = ({ cloudId, checkPerm }) => {
  const location = useLocation();
  const canWrite = checkPerm('clouds.cluster-networks:write') || checkPerm('clouds:read');

  const [loading, setLoading] = useState(true);
  const [racks, setRacks] = useState<DatacenterRack[]>([]);
  const [nodes, setNodes] = useState<any[]>([]);
  const [switches, setSwitches] = useState<any[]>([]);
  const [nodeMetricsMap, setNodeMetricsMap] = useState<Record<string, NodeLiveMetrics>>({});

  const [rackModalOpen, setRackModalOpen] = useState(false);
  const [renameRack, setRenameRack] = useState<DatacenterRack | null>(null);

  const [deviceModal, setDeviceModal] = useState<{
    rack: DatacenterRack;
    /** null = 加设备；非空 = 编辑该机架条 */
    editingDevice: DatacenterRackDevice | null;
  } | null>(null);

  const [nodeDrawerOpen, setNodeDrawerOpen] = useState(false);
  const [nodeDrawerRecord, setNodeDrawerRecord] = useState<any | null>(null);
  const [switchDrawerOpen, setSwitchDrawerOpen] = useState(false);
  const [switchDrawerRecord, setSwitchDrawerRecord] = useState<any | null>(null);

  /** 多机柜时当前选中的机柜下标（与工具栏 Segmented 同步） */
  const [rackCarouselIndex, setRackCarouselIndex] = useState(0);
  const rackIdsKey = useMemo(() => racks.map((r) => r.id).join('|'), [racks]);

  useLayoutEffect(() => {
    setRackCarouselIndex(0);
  }, [cloudId, rackIdsKey]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [rackJson, nodeJson, swCache] = await Promise.all([
        fetchDatacenterRacks(cloudId),
        fetchHarvesterNodes(cloudId, false).catch(() => null),
        fetchAswCtlSwitchesSummary(cloudId).catch(() => null),
      ]);
      setRacks(Array.isArray(rackJson?.racks) ? rackJson.racks : []);
      const nodeList = normalizeNodes(nodeJson);
      setNodes(nodeList);
      setNodeMetricsMap({});
      // 与 NodesSection 一致：有节点即尝试拉 metrics（失败则静默为空，不依赖单独节点读权限位）
      if (nodeList.length > 0) {
        try {
          const res: any = await fetchHarvesterResourceByLink(
            cloudId,
            '/apis/metrics.k8s.io/v1beta1/nodes',
          );
          const mItems: any[] = Array.isArray(res?.items) ? res.items : [];
          const map: Record<string, NodeLiveMetrics> = {};
          for (const it of mItems) {
            const nm = String(it?.metadata?.name || '').trim();
            if (!nm) continue;
            const epRaw = it?.usage?.['ephemeral-storage'];
            const epStr = epRaw != null && String(epRaw).trim() !== '' ? String(epRaw) : '';
            map[nm] = {
              cpuUsedCores: parseCpuToCores(it?.usage?.cpu),
              memUsedBytes: parseMemoryToBytes(it?.usage?.memory),
              storageUsedBytes: epStr ? parseMemoryToBytes(epStr) : undefined,
            };
          }
          setNodeMetricsMap(map);
        } catch {
          setNodeMetricsMap({});
        }
      }
      setSwitches(Array.isArray(swCache?.items) ? swCache.items : []);
    } catch (e: any) {
      message.error(e?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, [cloudId, checkPerm]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  /** 自物理交换机表「端口面板」跳转：`?switch_ref=` 与机柜内交换机 refKey（管理地址）对齐时选中对应机柜 */
  useEffect(() => {
    if (loading || !racks.length) return;
    const sp = new URLSearchParams(location.search);
    const want = sp.get('switch_ref')?.trim();
    if (!want) return;
    const idx = racks.findIndex((rack) =>
      (rack.devices || []).some(
        (d: any) => d.sourceKind === 'switch' && String(d.refKey || '').trim() === want,
      ),
    );
    if (idx >= 0) setRackCarouselIndex(idx);
  }, [loading, racks, location.search]);

  const nodeOptions = useMemo(
    () =>
      nodes
        .map((n) => {
          const v = nodeName(n);
          if (!v) return null;
          const ip = nodeManagementIp(n);
          return { value: v, label: ip ? `${v} · ${ip}` : v };
        })
        .filter(Boolean) as { value: string; label: string }[],
    [nodes],
  );

  /** 可选物理交换机：按管理地址去重，与物理交换机页数据源同一套 items */
  const switchOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const sw of switches) {
      const ref = switchStableRef(sw);
      if (!ref) continue;
      const label = switchDisplayLabel(sw);
      if (!m.has(ref)) m.set(ref, label.replace(/\n/g, ' · '));
    }
    return Array.from(m.entries()).map(([value, label]) => ({ value, label }));
  }, [switches]);

  const openAddToRack = useCallback((rack: DatacenterRack) => {
    setDeviceModal({ rack, editingDevice: null });
  }, []);

  const openEditRackDevice = useCallback((rack: DatacenterRack, d: DatacenterRackDevice) => {
    setDeviceModal({ rack, editingDevice: d });
  }, []);

  /** 机柜内已占用的物理服务器名：编辑时把当前条目的 refKey 排除在「已占用」之外，便于改绑或保留原值 */
  const nodeSelectOptions = useMemo(() => {
    if (!deviceModal) return nodeOptions;
    const taken = new Set(
      (deviceModal.rack.devices || [])
        .filter((d) => d.sourceKind === 'node' && d.refKey)
        .map((d) => String(d.refKey)),
    );
    if (deviceModal.editingDevice?.refKey) {
      taken.delete(String(deviceModal.editingDevice.refKey));
    }
    return nodeOptions.filter((o) => !taken.has(o.value));
  }, [deviceModal, nodeOptions]);

  /** 当前机柜内已绑定的交换机管理地址，下拉中隐藏避免重复；编辑时允许保留当前机架条上的交换机 */
  const switchSelectOptions = useMemo(() => {
    if (!deviceModal) return switchOptions;
    const taken = new Set(
      (deviceModal.rack.devices || [])
        .filter((d) => d.sourceKind === 'switch' && d.refKey)
        .map((d) => String(d.refKey)),
    );
    if (deviceModal.editingDevice?.refKey) {
      taken.delete(String(deviceModal.editingDevice.refKey));
    }
    return switchOptions.filter((o) => !taken.has(o.value));
  }, [deviceModal, switchOptions]);

  const resolveDeviceLabel = useCallback(
    (d: DatacenterRackDevice) => {
      if (d.sourceKind === 'custom') return d.customLabel || '自定义';
      if (d.sourceKind === 'node' && d.refKey) {
        const n = nodes.find((x) => nodeName(x) === d.refKey);
        const miss = n ? '' : '（未在集群中找到）';
        if (!n) return d.refKey + miss;
        const cpuModel = nodeCpuModelName(n);
        return cpuModel ? `${d.refKey}\n${cpuModel}${miss}` : d.refKey + miss;
      }
      if (d.sourceKind === 'switch' && d.refKey) {
        const sw = switches.find((x) => switchStableRef(x) === d.refKey);
        return sw ? switchDisplayLabel(sw) : `${d.refKey}（未在物理交换机列表中找到）`;
      }
      return d.refKey || '—';
    },
    [nodes, switches],
  );

  const renderDeviceBlade = useCallback(
    (d: DatacenterRackDevice, rack: DatacenterRack, viewDockActive = true) => {
      const title =
        d.sourceKind === 'node' || d.sourceKind === 'switch' ? resolveDeviceLabel(d) : '';
      const bladeKindSuffix =
        d.sourceKind === 'node'
          ? 'cloudmap-dc-blade--node'
          : d.sourceKind === 'switch'
            ? 'cloudmap-dc-blade--switch'
            : d.sourceKind === 'custom'
              ? 'cloudmap-dc-blade--custom'
              : undefined;

      let openBladeDetail: (() => void) | undefined;
      let switchRecordForPanel: any | null = null;
      let nodeRecordForPanel: any | null = null;

      if (d.sourceKind === 'node' && d.refKey) {
        const n = nodes.find((x) => nodeName(x) === d.refKey);
        nodeRecordForPanel = n ?? null;
        if (n) {
          openBladeDetail = () => {
            setSwitchDrawerOpen(false);
            setSwitchDrawerRecord(null);
            setNodeDrawerRecord(n);
            setNodeDrawerOpen(true);
          };
        }
      } else if (d.sourceKind === 'switch' && d.refKey) {
        const sw = switches.find((x) => switchStableRef(x) === d.refKey);
        switchRecordForPanel = sw ?? null;
        if (sw) {
          openBladeDetail = () => {
            setNodeDrawerOpen(false);
            setNodeDrawerRecord(null);
            setSwitchDrawerRecord(sw);
            setSwitchDrawerOpen(true);
          };
        }
      }

      const useEmbedPanel = d.sourceKind === 'node' || d.sourceKind === 'switch';

      return (
        <div
          key={d.id}
          className={[
            'cloudmap-dc-blade',
            bladeKindSuffix,
            useEmbedPanel ? 'cloudmap-dc-blade--embed-panel' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <div
            className={['cloudmap-dc-blade-u', canWrite ? 'cloudmap-dc-blade-u--clickable' : '']
              .filter(Boolean)
              .join(' ')}
            title={canWrite ? '柜内排序 / U 位 · 点击编辑' : '柜内排序 / U 位'}
            role={canWrite ? 'button' : undefined}
            tabIndex={canWrite ? 0 : undefined}
            onClick={
              canWrite
                ? (e) => {
                    e.stopPropagation();
                    openEditRackDevice(rack, d);
                  }
                : undefined
            }
            onKeyDown={
              canWrite
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      openEditRackDevice(rack, d);
                    }
                  }
                : undefined
            }
          >
            U{d.slotOrder ?? 0}
          </div>
          {d.sourceKind === 'node' ? (
            <EmbeddedPhysicalNodeBladeBody
              nodeRefKey={d.refKey ?? ''}
              node={nodeRecordForPanel}
              title={title}
              nodeMetricsMap={nodeMetricsMap}
              bladeBodyWrap
              onOpenDetail={openBladeDetail}
            />
          ) : d.sourceKind === 'switch' ? (
            <EmbeddedSwitchPortPanelBody
              record={switchRecordForPanel}
              embedTitle={title}
              viewActive={viewDockActive}
              bladeBodyWrap
              onOpenPhysicalDetail={openBladeDetail}
              clusterNodesForLldp={nodes}
            />
          ) : (
            <div
              className="cloudmap-dc-blade-body-wrap cloudmap-dc-blade-body-wrap--custom-placeholder"
              title={d.customLabel || undefined}
              aria-label={d.customLabel ? `自定义占位：${d.customLabel}` : '自定义占位'}
            />
          )}
          <div className="cloudmap-dc-blade-actions">
            {canWrite ? (
              <Popconfirm
                title="移除此设备？"
                onConfirm={async () => {
                  try {
                    await deleteRackDevice(cloudId, rack.id, d.id);
                    message.success('已移除');
                    await loadAll();
                  } catch (e: any) {
                    message.error(e?.response?.data?.message || e?.message || '删除失败');
                  }
                }}
              >
                <Button type="text" size="small" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            ) : null}
          </div>
        </div>
      );
    },
    [canWrite, cloudId, loadAll, nodeMetricsMap, nodes, openEditRackDevice, resolveDeviceLabel, switches],
  );

  const nextRackSortOrderDefault = useMemo(() => {
    if (!racks.length) return 0;
    return Math.max(...racks.map((r) => Number(r.sortOrder) || 0)) + 1;
  }, [racks]);

  const openCreateRackModal = useCallback(() => {
    setRackModalOpen(true);
  }, []);

  const carouselCursor =
    racks.length <= 1 ? 0 : Math.min(Math.max(0, rackCarouselIndex), racks.length - 1);
  const activeRackIdForDock = racks[carouselCursor]?.id;

  const renderRackGrid = useCallback(
    (rack: DatacenterRack) => {
      const viewDockActive = racks.length <= 1 || rack.id === activeRackIdForDock;
      return (
        <div
          className="cloudmap-dc-topology-next-rack-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${GRID_COLS}, minmax(0, 1fr))`,
            /** 单行占满父级分配高度；勿用默认 auto 行高，否则 U 位增多会撑开整页滚动条 */
            gridTemplateRows: 'minmax(0, 1fr)',
            columnGap: 8,
            rowGap: 8,
            width: '100%',
            minHeight: 0,
          }}
        >
          <div
            className="cloudmap-dc-rack"
            style={{ gridColumn: rackGridFullSpan(), minHeight: 0 }}
          >
            <div className="cloudmap-dc-rack-head">
              <div className="cloudmap-dc-rack-head-primary">
                {racks.length > 1 ? (
                  <Segmented
                    size="small"
                    className="cloudmap-dc-rack-segmented"
                    value={rack.id}
                    onChange={(id) => {
                      const i = racks.findIndex((x) => x.id === id);
                      if (i >= 0) setRackCarouselIndex(i);
                    }}
                    options={racks.map((r) => ({ label: r.name, value: r.id }))}
                  />
                ) : (
                  <span className="cloudmap-dc-rack-title" title={rack.name}>
                    {rack.name}
                  </span>
                )}
              </div>
              <Space
                wrap
                align="center"
                size={[8, 8]}
                role="toolbar"
                aria-label="机柜与列表操作"
                style={{ flexShrink: 0, maxWidth: 'min(100%, 520px)', justifyContent: 'flex-end' }}
              >
                {canWrite ? (
                  <Space size={4} wrap role="group" aria-label="本机柜">
                      <Button
                        type="text"
                        size="small"
                        icon={<EditOutlined />}
                        onClick={() => setRenameRack(rack)}
                      />
                    <Popconfirm
                      title="删除本机柜？"
                      description="该机柜及其中的设备占位将从库房中移除。"
                      onConfirm={async () => {
                        try {
                          await deleteDatacenterRack(cloudId, rack.id);
                          message.success('已删除');
                          await loadAll();
                        } catch (e: any) {
                          message.error(e?.response?.data?.message || e?.message || '删除失败');
                        }
                      }}
                    >
                        <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                    <Button type="text" size="small" onClick={() => openAddToRack(rack)}>
                      加设备
                    </Button>
                  </Space>
                ) : null}
                {canWrite ? (
                  <Divider type="vertical" style={{ margin: 0, height: 22, borderColor: 'rgba(255,255,255,0.14)' }} />
                ) : null}
                <Space size={4} wrap role="group" aria-label="库房与列表">
                  <Button type="text" size="small" icon={<ReloadOutlined />} loading={loading} onClick={() => void loadAll()}>
                    
                  </Button>
                  {canWrite ? (
                      <Button type="link" size="small"  onClick={openCreateRackModal}>
                        新机柜
                      </Button>
                  ) : null}
                </Space>
              </Space>
            </div>
            <div className="cloudmap-dc-rack-body">
              <div className="cloudmap-dc-bay">
                {[...rack.devices]
                  .sort((a, b) => (a.slotOrder ?? 0) - (b.slotOrder ?? 0))
                  .map((d) => renderDeviceBlade(d, rack, viewDockActive))}
                {rack.devices.length === 0 ? (
                  <div className="cloudmap-dc-empty">
                    <InboxOutlined style={{ fontSize: 40, opacity: 0.4 }} />
                    <span>空机柜 — 请用顶部工具栏「加设备」向本柜添加交换机、节点或占位</span>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      );
    },
    [
      activeRackIdForDock,
      canWrite,
      cloudId,
      loadAll,
      loading,
      openAddToRack,
      openCreateRackModal,
      racks,
      renderDeviceBlade,
      setRackCarouselIndex,
    ],
  );

  return (
    <>
    <PageDetailSection
      style={{
        flex: 1,
        minHeight: 0,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
      contentStyle={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div className="cloudmap-dc-topology-body">
        {loading ? (
          <div style={{ padding: '48px 0', textAlign: 'center', color: 'rgba(0,0,0,0.45)' }}>加载中…</div>
        ) : racks.length === 0 ? (
          <div>
            <Card size="small">
              暂无机柜。请先「刷新」拉取列表；若有权限，可点「新机柜」在库房中创建第一台空机柜。
            </Card>
            <Space wrap style={{ marginTop: 10, width: '100%', justifyContent: 'flex-end' }} size="middle">
              <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void loadAll()}>
                刷新
              </Button>
              {canWrite ? (
                <Button type="primary" icon={<PlusOutlined />} onClick={openCreateRackModal}>
                  新机柜
                </Button>
              ) : null}
            </Space>
          </div>
        ) : (
          renderRackGrid(racks[carouselCursor])
        )}
      </div>

      <RackFormModal
        mode="create"
        open={rackModalOpen}
        onClose={() => setRackModalOpen(false)}
        onSuccess={() => void loadAll()}
        cloudId={cloudId}
        defaultSortOrder={nextRackSortOrderDefault}
      />
      <RackFormModal
        mode="edit"
        open={!!renameRack}
        rack={renameRack}
        onClose={() => setRenameRack(null)}
        onSuccess={() => void loadAll()}
        cloudId={cloudId}
      />
      <AddRackDeviceModal
        open={!!deviceModal}
        rack={deviceModal?.rack ?? null}
        editingDevice={deviceModal?.editingDevice ?? null}
        onClose={() => setDeviceModal(null)}
        onSuccess={() => void loadAll()}
        cloudId={cloudId}
        nodeOptions={nodeSelectOptions}
        switchSelectOptions={switchSelectOptions}
      />
    </PageDetailSection>
    <PhysicalNodeDetailDrawer
      open={nodeDrawerOpen}
      onClose={() => {
        setNodeDrawerOpen(false);
        setNodeDrawerRecord(null);
      }}
      record={nodeDrawerRecord}
      cloudId={cloudId}
      metrics={nodeDrawerRecord ? nodeMetricsMap[nodeName(nodeDrawerRecord)] : undefined}
      onRefreshFromCluster={() => void loadAll()}
      refreshLoading={loading}
    />
    <PhysicalSwitchDetailDrawer
      open={switchDrawerOpen}
      record={switchDrawerRecord}
      onClose={() => {
        setSwitchDrawerOpen(false);
        setSwitchDrawerRecord(null);
      }}
      initialTab="overview"
      onRefreshFromCluster={() => void loadAll()}
      refreshLoading={loading}
    />
    </>
  );
};

export default DatacenterTopologySection;
