/**
 * 机房拓扑（HSM 机柜 + 内嵌面板）
 * 归属 `hsm/`，与 `kube-ovn/` 一致：`sections/` 入口 + `../lib` 可复用块 + 域级 `hsm.css`。
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
  type HarvesterNodeRecord,
} from '../lib/datacenterTopologySectionUtils';
import DatacenterRackGrid from '../lib/DatacenterRackGrid';
import { useDatacenterRackCarousel } from '../hooks/useDatacenterRackCarousel';
import { useDatacenterTopologyData } from '../hooks/useDatacenterTopologyData';
import '../hsm.css';
import AddRackDeviceModal from '../modals/AddRackDeviceModal';
import RackFormModal from '../modals/RackFormModal';
import type { DatacenterRack, DatacenterRackDevice } from '../../../../../../services/datacenterTopologyApi';

type Props = {
  cloudId: string;
  checkPerm: (act: string) => boolean;
};

const DatacenterTopologySection: React.FC<Props> = ({ cloudId, checkPerm }) => {
  const location = useLocation();
  const canWrite = checkPerm('clouds.cluster-networks:write') || checkPerm('clouds:read');

  const {
    loading,
    racks,
    nodes,
    switches,
    nodeMetricsMap,
    loadAll,
    nodeOptions,
    switchOptions,
  } = useDatacenterTopologyData(cloudId);

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
              onRefresh={loadAll}
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
