import React, { useCallback } from 'react';
import { Button, Divider, Popconfirm, Segmented, Space, message } from 'antd';
import { DeleteOutlined, EditOutlined, InboxOutlined, ReloadOutlined } from '@ant-design/icons';
import type { AswCtlSwitchProbeRecord } from 'services/harvester/types/aswProbe';
import {
  deleteDatacenterRack,
  deleteRackDevice,
  type DatacenterRack,
  type DatacenterRackDevice,
} from '../../../../../../services/datacenterTopologyApi';
import { EmbeddedPhysicalNodeBladeBody } from './embeddedPhysicalNodePanel';
import { EmbeddedSwitchPortPanelBody } from './embeddedSwitchPortPanel';
import type { NodeLiveMetrics } from './physicalNodeRackUtils';
import {
  DATACENTER_GRID_COLS,
  harvesterNodeName,
  rackGridFullSpan,
  resolveRackDeviceLabel,
  switchStableRef,
  type HarvesterNodeRecord,
} from './datacenterTopologySectionUtils';

type Props = {
  cloudId: string;
  canWrite: boolean;
  loading: boolean;
  rack: DatacenterRack;
  racks: DatacenterRack[];
  nodes: HarvesterNodeRecord[];
  switches: AswCtlSwitchProbeRecord[];
  nodeMetricsMap: Record<string, NodeLiveMetrics>;
  activeRackIdForDock: string | undefined;
  onRefresh: () => void | Promise<void>;
  onRackSelect: (rackId: string) => void;
  onRenameRack: (rack: DatacenterRack) => void;
  onAddToRack: (rack: DatacenterRack) => void;
  onCreateRack: () => void;
  onEditDevice: (rack: DatacenterRack, device: DatacenterRackDevice) => void;
  onOpenNodeDetail: (node: HarvesterNodeRecord) => void;
  onOpenSwitchDetail: (sw: AswCtlSwitchProbeRecord) => void;
};

const DatacenterRackGrid: React.FC<Props> = ({
  cloudId,
  canWrite,
  loading,
  rack,
  racks,
  nodes,
  switches,
  nodeMetricsMap,
  activeRackIdForDock,
  onRefresh,
  onRackSelect,
  onRenameRack,
  onAddToRack,
  onCreateRack,
  onEditDevice,
  onOpenNodeDetail,
  onOpenSwitchDetail,
}) => {
  const resolveDeviceLabel = useCallback(
    (d: DatacenterRackDevice) => resolveRackDeviceLabel(d, nodes, switches),
    [nodes, switches],
  );

  const renderDeviceBlade = useCallback(
    (d: DatacenterRackDevice, rackRow: DatacenterRack, viewDockActive = true) => {
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
        if (n) openBladeDetail = () => onOpenNodeDetail(n);
      } else if (d.sourceKind === 'switch' && d.refKey) {
        const sw = switches.find((x) => switchStableRef(x) === d.refKey);
        switchRecordForPanel = sw ?? null;
        if (sw) openBladeDetail = () => onOpenSwitchDetail(sw);
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
                    onEditDevice(rackRow, d);
                  }
                : undefined
            }
            onKeyDown={
              canWrite
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onEditDevice(rackRow, d);
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
                    await deleteRackDevice(cloudId, rackRow.id, d.id);
                    message.success('已移除');
                    await onRefresh();
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
    [
      canWrite,
      cloudId,
      nodeMetricsMap,
      nodes,
      onEditDevice,
      onOpenNodeDetail,
      onOpenSwitchDetail,
      onRefresh,
      resolveDeviceLabel,
      switches,
    ],
  );

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
      <div className="cloudmap-dc-rack" style={{ gridColumn: rackGridFullSpan(), minHeight: 0 }}>
        <div className="cloudmap-dc-rack-head">
          <div className="cloudmap-dc-rack-head-primary">
            {racks.length > 1 ? (
              <Segmented
                size="small"
                className="cloudmap-dc-rack-segmented"
                value={rack.id}
                onChange={(id) => onRackSelect(String(id))}
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
                <Button type="text" size="small" icon={<EditOutlined />} onClick={() => onRenameRack(rack)} />
                <Popconfirm
                  title="删除本机柜？"
                  description="该机柜及其中的设备占位将从库房中移除。"
                  onConfirm={async () => {
                    try {
                      await deleteDatacenterRack(cloudId, rack.id);
                      message.success('已删除');
                      await onRefresh();
                    } catch (e: unknown) {
                      const err = e as { response?: { data?: { message?: string } }; message?: string };
                      message.error(err?.response?.data?.message || err?.message || '删除失败');
                    }
                  }}
                >
                  <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                </Popconfirm>
                <Button type="text" size="small" onClick={() => onAddToRack(rack)}>
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
                onClick={() => void onRefresh()}
              />
              {canWrite ? (
                <Button type="link" size="small" onClick={onCreateRack}>
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
};

export default DatacenterRackGrid;
