/**
 * 机房拓扑（HSM 机柜 + 内嵌面板）
 * 归属 `hsm/`，与 `kube-ovn/` 一致：`sections/` 入口 + `../lib` 可复用块 + 域级 `hsm.css`。
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Button, Divider, Empty, Popconfirm, Segmented, Space, message } from 'antd';
import {
  DeleteOutlined,
  EditOutlined,
  InboxOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import { fetchAswCtlSwitchesSummary } from 'services/harvester/cluster';
import { fetchHarvesterNodes } from 'services/harvester/clusterInventory';
import { fetchHarvesterResourceByLink } from 'services/harvester/resource';
import type { AswCtlSwitchProbeRecord } from 'services/harvester/types/aswProbe';
import PhysicalNodeDetailDrawer from '../../cluster/drawers/PhysicalNodeDetailDrawer';
import PhysicalSwitchDetailDrawer from '../../cluster/drawers/PhysicalSwitchDetailDrawer';
import { EmbeddedPhysicalNodeBladeBody } from '../lib/embeddedPhysicalNodePanel';
import { EmbeddedSwitchPortPanelBody } from '../lib/embeddedSwitchPortPanel';
import { type NodeLiveMetrics } from '../lib/physicalNodeRackUtils';
import {
  DATACENTER_GRID_COLS,
  buildHarvesterNodeSelectOptions,
  buildNodeMetricsMapFromK8sMetrics,
  buildSwitchSelectOptions,
  clampRackCarouselIndex,
  collectTakenRefKeys,
  filterSelectOptionsExcludingTakenRefs,
  findRackIndexBySwitchRef,
  harvesterNodeName,
  nextRackSortOrderDefault as calcNextRackSortOrderDefault,
  normalizeHarvesterNodesList,
  rackGridFullSpan,
  resolveRackDeviceLabel,
  switchStableRef,
  type HarvesterNodeRecord,
} from '../lib/datacenterTopologySectionUtils';
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

type Props = {
  cloudId: string;
  checkPerm: (act: string) => boolean;
};

const DatacenterTopologySection: React.FC<Props> = ({ cloudId, checkPerm }) => {
  const location = useLocation();
  const canWrite = checkPerm('clouds.cluster-networks:write') || checkPerm('clouds:read');

  const [loading, setLoading] = useState(true);
  const [racks, setRacks] = useState<DatacenterRack[]>([]);
  const [nodes, setNodes] = useState<HarvesterNodeRecord[]>([]);
  const [switches, setSwitches] = useState<AswCtlSwitchProbeRecord[]>([]);
  const [nodeMetricsMap, setNodeMetricsMap] = useState<Record<string, NodeLiveMetrics>>({});

  const [rackModalOpen, setRackModalOpen] = useState(false);
  const [renameRack, setRenameRack] = useState<DatacenterRack | null>(null);

  const [deviceModal, setDeviceModal] = useState<{
    rack: DatacenterRack;
    editingDevice: DatacenterRackDevice | null;
  } | null>(null);

  const [nodeDrawerOpen, setNodeDrawerOpen] = useState(false);
  const [nodeDrawerRecord, setNodeDrawerRecord] = useState<HarvesterNodeRecord | null>(null);
  const [switchDrawerOpen, setSwitchDrawerOpen] = useState(false);
  const [switchDrawerRecord, setSwitchDrawerRecord] = useState<AswCtlSwitchProbeRecord | null>(null);

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
      const nodeList = normalizeHarvesterNodesList(nodeJson);
      setNodes(nodeList);
      setNodeMetricsMap({});
      if (nodeList.length > 0) {
        try {
          const res = await fetchHarvesterResourceByLink(
            cloudId,
            '/apis/metrics.k8s.io/v1beta1/nodes',
          );
          const items =
            res && typeof res === 'object' && 'items' in res
              ? (res as { items?: unknown }).items
              : [];
          setNodeMetricsMap(buildNodeMetricsMapFromK8sMetrics(items));
        } catch {
          setNodeMetricsMap({});
        }
      }
      setSwitches(Array.isArray(swCache?.items) ? swCache.items : []);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '加载失败';
      message.error(msg);
    } finally {
      setLoading(false);
    }
  }, [cloudId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (loading || !racks.length) return;
    const sp = new URLSearchParams(location.search);
    const want = sp.get('switch_ref')?.trim();
    if (!want) return;
    const idx = findRackIndexBySwitchRef(racks, want);
    if (idx >= 0) setRackCarouselIndex(idx);
  }, [loading, racks, location.search]);

  const nodeOptions = useMemo(() => buildHarvesterNodeSelectOptions(nodes), [nodes]);
  const switchOptions = useMemo(() => buildSwitchSelectOptions(switches), [switches]);

  const openAddToRack = useCallback((rack: DatacenterRack) => {
    setDeviceModal({ rack, editingDevice: null });
  }, []);

  const openEditRackDevice = useCallback((rack: DatacenterRack, d: DatacenterRackDevice) => {
    setDeviceModal({ rack, editingDevice: d });
  }, []);

  const nodeSelectOptions = useMemo(() => {
    if (!deviceModal) return nodeOptions;
    const taken = collectTakenRefKeys(deviceModal.rack.devices, 'node');
    return filterSelectOptionsExcludingTakenRefs(
      nodeOptions,
      taken,
      deviceModal.editingDevice?.refKey,
    );
  }, [deviceModal, nodeOptions]);

  const switchSelectOptions = useMemo(() => {
    if (!deviceModal) return switchOptions;
    const taken = collectTakenRefKeys(deviceModal.rack.devices, 'switch');
    return filterSelectOptionsExcludingTakenRefs(
      switchOptions,
      taken,
      deviceModal.editingDevice?.refKey,
    );
  }, [deviceModal, switchOptions]);

  const resolveDeviceLabel = useCallback(
    (d: DatacenterRackDevice) => resolveRackDeviceLabel(d, nodes, switches),
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
      let switchRecordForPanel: AswCtlSwitchProbeRecord | null = null;
      let nodeRecordForPanel: HarvesterNodeRecord | null = null;

      if (d.sourceKind === 'node' && d.refKey) {
        const n = nodes.find((x) => harvesterNodeName(x) === d.refKey);
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
                  } catch (e: unknown) {
                    const err = e as { response?: { data?: { message?: string } }; message?: string };
                    message.error(err?.response?.data?.message || err?.message || '删除失败');
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

  const nextRackSortOrderDefault = useMemo(() => calcNextRackSortOrderDefault(racks), [racks]);

  const openCreateRackModal = useCallback(() => {
    setRackModalOpen(true);
  }, []);

  const carouselCursor = clampRackCarouselIndex(rackCarouselIndex, racks.length);
  const activeRackIdForDock = racks[carouselCursor]?.id;

  const renderRackGrid = useCallback(
    (rack: DatacenterRack) => {
      const viewDockActive = racks.length <= 1 || rack.id === activeRackIdForDock;
      return (
        <div
          className="cloudmap-dc-topology-next-rack-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${DATACENTER_GRID_COLS}, minmax(0, 1fr))`,
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
                        } catch (e: unknown) {
                          const err = e as { response?: { data?: { message?: string } }; message?: string };
                          message.error(err?.response?.data?.message || err?.message || '删除失败');
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
                  <Button
                    type="text"
                    size="small"
                    icon={<ReloadOutlined />}
                    loading={loading}
                    onClick={() => void loadAll()}
                  />
                  {canWrite ? (
                    <Button type="link" size="small" onClick={openCreateRackModal}>
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
          {loading && racks.length === 0 ? null : racks.length === 0 ? (
            <div
              style={{
                flex: 1,
                minHeight: 360,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '24px 16px',
              }}
            >
              <div style={{ textAlign: 'center', maxWidth: 440 }}>
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={canWrite ? '暂无机柜。请点击「创建机柜」。' : '暂无机柜。'}
                />
                {canWrite ? (
                  <Button type="primary" icon={<PlusOutlined />} onClick={openCreateRackModal}>
                    创建机柜
                  </Button>
                ) : null}
              </div>
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
        metrics={nodeDrawerRecord ? nodeMetricsMap[harvesterNodeName(nodeDrawerRecord)] : undefined}
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
