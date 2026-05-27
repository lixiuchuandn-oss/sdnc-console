/**
 * 机房拓扑（HSM 机柜 + 内嵌面板）
 * Cloudmap 池：数据来自池状态 + `onRefresh` → `loadTabResource('datacenter_topology')`。
 */
import React, { useCallback, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Button, Empty } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import type { AswCtlSwitchProbeRecord } from 'services/harvester/types/aswProbe';
import PhysicalNodeDetailDrawer from '../../cluster/drawers/PhysicalNodeDetailDrawer';
import PhysicalSwitchDetailDrawer from '../../cluster/drawers/PhysicalSwitchDetailDrawer';
import {
  collectTakenRefKeys,
  filterSelectOptionsExcludingTakenRefs,
  harvesterNodeName,
  nextRackSortOrderDefault as calcNextRackSortOrderDefault,
  buildHarvesterNodeSelectOptions,
  buildSwitchSelectOptions,
  type HarvesterNodeRecord,
} from '../lib/datacenterTopologySectionUtils';
import DatacenterRackGrid from '../lib/DatacenterRackGrid';
import { useDatacenterRackCarousel } from '../hooks/useDatacenterRackCarousel';
import {
  runHarvesterSectionRefresh,
  type HarvesterSectionOnRefresh,
} from '../../shared/lib/harvesterSectionRefresh';
import '../hsm.css';
import AddRackDeviceModal from '../modals/AddRackDeviceModal';
import RackFormModal from '../modals/RackFormModal';
import type { DatacenterRack, DatacenterRackDevice } from '../../../../../../services/datacenterTopologyApi';
import type { NodeLiveMetrics } from '../lib/physicalNodeRackUtils';

type Props = {
  cloudId: string;
  checkPerm: (act: string) => boolean;
  racks: DatacenterRack[];
  nodes: HarvesterNodeRecord[];
  switches: AswCtlSwitchProbeRecord[];
  nodeMetricsMap: Record<string, NodeLiveMetrics>;
  loading: boolean;
  onRefresh?: HarvesterSectionOnRefresh;
};

const DatacenterTopologySection: React.FC<Props> = ({
  cloudId,
  checkPerm,
  racks,
  nodes,
  switches,
  nodeMetricsMap,
  loading,
  onRefresh,
}) => {
  const location = useLocation();
  const canWrite = checkPerm('clouds.cluster-networks:write') || checkPerm('clouds:read');

  const refreshList = useCallback(
    () => runHarvesterSectionRefresh(onRefresh, { force: true }),
    [onRefresh],
  );

  const nodeOptions = useMemo(() => buildHarvesterNodeSelectOptions(nodes), [nodes]);
  const switchOptions = useMemo(() => buildSwitchSelectOptions(switches), [switches]);

  const { setRackCarouselIndex, carouselCursor } = useDatacenterRackCarousel(
    cloudId,
    racks,
    loading,
    location.search,
  );

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

  const nextRackSortOrderDefault = useMemo(() => calcNextRackSortOrderDefault(racks), [racks]);
  const activeRack = racks[carouselCursor];
  const activeRackIdForDock = activeRack?.id;

  const openCreateRackModal = useCallback(() => setRackModalOpen(true), []);

  const handleOpenNodeDetail = useCallback((node: HarvesterNodeRecord) => {
    setSwitchDrawerOpen(false);
    setSwitchDrawerRecord(null);
    setNodeDrawerRecord(node);
    setNodeDrawerOpen(true);
  }, []);

  const handleOpenSwitchDetail = useCallback((sw: AswCtlSwitchProbeRecord) => {
    setNodeDrawerOpen(false);
    setNodeDrawerRecord(null);
    setSwitchDrawerRecord(sw);
    setSwitchDrawerOpen(true);
  }, []);

  const handleRackSelect = useCallback(
    (rackId: string) => {
      const i = racks.findIndex((x) => x.id === rackId);
      if (i >= 0) setRackCarouselIndex(i);
    },
    [racks, setRackCarouselIndex],
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
          ) : activeRack ? (
            <DatacenterRackGrid
              cloudId={cloudId}
              canWrite={canWrite}
              loading={loading}
              rack={activeRack}
              racks={racks}
              nodes={nodes}
              switches={switches}
              nodeMetricsMap={nodeMetricsMap}
              activeRackIdForDock={activeRackIdForDock}
              onRefresh={refreshList}
              onRackSelect={handleRackSelect}
              onRenameRack={setRenameRack}
              onAddToRack={(rack) => setDeviceModal({ rack, editingDevice: null })}
              onCreateRack={openCreateRackModal}
              onEditDevice={(rack, editingDevice) => setDeviceModal({ rack, editingDevice })}
              onOpenNodeDetail={handleOpenNodeDetail}
              onOpenSwitchDetail={handleOpenSwitchDetail}
            />
          ) : null}
        </div>

        <RackFormModal
          mode="create"
          open={rackModalOpen}
          onClose={() => setRackModalOpen(false)}
          onSuccess={() => void refreshList()}
          cloudId={cloudId}
          defaultSortOrder={nextRackSortOrderDefault}
        />
        <RackFormModal
          mode="edit"
          open={!!renameRack}
          rack={renameRack}
          onClose={() => setRenameRack(null)}
          onSuccess={() => void refreshList()}
          cloudId={cloudId}
        />
        <AddRackDeviceModal
          open={!!deviceModal}
          rack={deviceModal?.rack ?? null}
          editingDevice={deviceModal?.editingDevice ?? null}
          onClose={() => setDeviceModal(null)}
          onSuccess={() => void refreshList()}
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
        onRefreshFromCluster={() => void refreshList()}
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
        onRefreshFromCluster={() => void refreshList()}
        refreshLoading={loading}
      />
    </>
  );
};

export default DatacenterTopologySection;
