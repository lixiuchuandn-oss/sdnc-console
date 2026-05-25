/**
 * Harvester · 虚拟云盘 (PVC) 列表 Section
 */
import React, { useCallback, useMemo, useState } from 'react';
import { App, Button, Dropdown, Input, Select, Table, Tooltip } from 'antd';
import { EllipsisOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection from 'components/PageDetailSection';
import TableColumnSettingsButton from 'components/TableColumnSettingsButton';
import { useTableColumnSettings } from 'hooks/useTableColumnSettings';
import { useAuth } from 'contexts/AuthContext';
import { hasPermissionForAction } from 'utils/accessMapping';
import { fetchHarvesterNamespaces } from 'services/harvesterApi';
import { useHarvesterPublicNamespaces } from '../../context/HarvesterPublicNamespacesContext';
import HarvesterResourceDrawer from '../../shared/components/HarvesterOpsinfoDrawer';
import VolumeDetailDrawer from '../drawers/VolumeDetailDrawer';
import {
  createHarvesterToolbarRefresh,
  runHarvesterSectionRefresh,
  type HarvesterSectionOnRefresh,
} from '../lib/ebsSectionRefresh';
import VolumeCreateModal from '../modals/VolumeCreateModal';
import VolumeAttachModal from '../modals/VolumeAttachModal';
import VolumeCloneModal from '../modals/VolumeCloneModal';
import VolumeExportImageModal from '../modals/VolumeExportImageModal';
import VolumeSnapshotCreateModal from '../modals/VolumeSnapshotCreateModal';
import VolumeResizeModal from '../modals/VolumeResizeModal';
import { useVolumesListPoll } from '../hooks/useVolumesListPoll';
import { useVolumesSectionActions } from '../hooks/useVolumesSectionActions';
import { parseHarvesterNamespaceNames } from '../lib/parseHarvesterNamespaceNames';
import { cnVolumeStatus, VOLUME_STATUS_FILTER_OPTIONS } from '../lib/volumeQuantityUtils';
import {
  buildVolumeNamespaceOptions,
  filterVolumesForTable,
  normalizeVolumeList,
} from '../lib/volumesSectionUtils';
import { buildVolumesTableColumns } from '../lib/volumesTableColumns';

const TABLE_COLUMNS_SETTINGS_KEY = 'harvester_volumes_table';

type Props = {
  cloudId: string;
  volumes: unknown[];
  loading: boolean;
  vms?: unknown[];
  storageClasses?: unknown[];
  namespacesOptions?: string[];
  onRefresh?: HarvesterSectionOnRefresh;
  onRefreshStorageClasses?: (force?: boolean, skipSync?: boolean) => void;
  onRefreshImages?: HarvesterSectionOnRefresh;
  isTenant?: boolean;
  bordered?: boolean;
};

const VolumesSection: React.FC<Props> = ({
  cloudId,
  volumes,
  loading,
  vms,
  storageClasses: propStorageClasses,
  namespacesOptions,
  onRefresh,
  onRefreshStorageClasses,
  onRefreshImages,
  isTenant,
}) => {
  const { message } = App.useApp();
  const { user } = useAuth();
  const { isPublicNamespace } = useHarvesterPublicNamespaces();

  const perms = useMemo(() => (user?.permissions ?? []) as string[], [user?.permissions]);
  const hasDisksWrite = useMemo(
    () =>
      hasPermissionForAction(perms, 'clouds.disks:write') ||
      hasPermissionForAction(perms, 'clouds:write'),
    [perms],
  );
  const ensureDisksWrite = useCallback(() => {
    if (hasDisksWrite) return true;
    message.error('当前账号没有云盘操作权限（需要 clouds.disks:write 或 clouds:write 权限）');
    return false;
  }, [hasDisksWrite, message]);

  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [nsFilter, setNsFilter] = useState('');
  const [scFilter, setScFilter] = useState('');
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [fetchedNsOptions, setFetchedNsOptions] = useState<string[]>([]);

  const dataSource = useMemo(() => normalizeVolumeList(volumes), [volumes]);
  useVolumesListPoll(dataSource, cloudId, onRefresh);

  const filteredData = useMemo(
    () =>
      filterVolumesForTable(dataSource, {
        keyword,
        statusFilter,
        nsFilter,
        scFilter,
        isTenant,
        isPublicNamespace,
      }),
    [dataSource, keyword, statusFilter, nsFilter, scFilter, isTenant, isPublicNamespace],
  );

  const nsOptions = useMemo(
    () =>
      buildVolumeNamespaceOptions({
        dataSource,
        vms,
        namespacesOptions,
        fetchedNsOptions,
        isTenant,
        isPublicNamespace,
      }),
    [dataSource, vms, namespacesOptions, fetchedNsOptions, isTenant, isPublicNamespace],
  );

  const actions = useVolumesSectionActions({
    cloudId,
    vms,
    propStorageClasses,
    onRefresh,
    onRefreshImages,
    hasDisksWrite,
    ensureDisksWrite,
    isTenant,
    dataSource,
    selectedRowKeys,
    setSelectedRowKeys,
  });

  const allColumns = useMemo(
    () =>
      buildVolumesTableColumns({
        isTenant,
        hasDisksWrite,
        safeRead: actions.safeRead,
        onOpenVolumeDetail: actions.handleOpenVolumeDetail,
        onOpenOpsDrawer: actions.handleOpenOpsDrawer,
        buildRowActionItems: actions.buildRowActionItems,
      }),
    [actions, hasDisksWrite, isTenant],
  );

  const { displayColumns: tableColumns } = useTableColumnSettings(
    allColumns,
    TABLE_COLUMNS_SETTINGS_KEY,
    ['namespace', 'volumeMode'],
  );

  const handleToolbarRefresh = useMemo(
    () =>
      createHarvesterToolbarRefresh(onRefresh, {
        after: () => {
          window.setTimeout(async () => {
            try {
              const res = await fetchHarvesterNamespaces(cloudId, true, true);
              setFetchedNsOptions(parseHarvesterNamespaceNames(res));
            } catch {
              /* ignore */
            }
          }, 100);
        },
      }),
    [cloudId, onRefresh],
  );

  const refreshVolumesSilent = useMemo(
    () => () => void runHarvesterSectionRefresh(onRefresh, { force: true, silent: true }),
    [onRefresh],
  );

  const refreshVolumesAfterWrite = useMemo(
    () => () => void runHarvesterSectionRefresh(onRefresh, { force: true }),
    [onRefresh],
  );

  const refreshImagesSilent = useMemo(
    () => () => void runHarvesterSectionRefresh(onRefreshImages, { force: true, silent: true }),
    [onRefreshImages],
  );

  const resetFilters = useCallback(() => {
    setKeyword('');
    setStatusFilter('');
    setNsFilter('');
    setScFilter('');
  }, []);

  return (
    <PageDetailSection
      asCard={false}
      autoStyleInputs={false}
      toolbarLeft={
        <>
          <Input
            allowClear
            placeholder="名称/ID"
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="toolbar-search"
          />
          {!isTenant ? (
            <Select
              allowClear
              showSearch
              placeholder="项目"
              value={nsFilter || undefined}
              onChange={(v) => setNsFilter(v || '')}
              className="toolbar-filter-sm"
              options={[{ value: '', label: '全部' }, ...nsOptions]}
            />
          ) : null}
          <Select
            allowClear
            placeholder="状态"
            value={statusFilter || undefined}
            onChange={(v) => setStatusFilter(v || '')}
            className="toolbar-filter-sm"
            options={[
              { value: '', label: '全部' },
              ...VOLUME_STATUS_FILTER_OPTIONS.map((k) => ({ value: k, label: cnVolumeStatus(k) })),
            ]}
          />
          <button type="button" className="toolbar-reset-btn" onClick={resetFilters}>
            重置
          </button>
        </>
      }
      toolbarRight={
        <>
          <Button
            type="primary"
            disabled={!hasDisksWrite}
            onClick={() => {
              if (!ensureDisksWrite()) return;
              onRefreshStorageClasses?.(true, true);
              actions.setVolumeCreateSeed(null);
              actions.setCreateModalNonce((n) => n + 1);
              actions.setCreateOpen(true);
            }}
          >
            创建云盘
          </Button>
          <Tooltip
            title={
              !hasDisksWrite
                ? undefined
                : selectedRowKeys.length === 0
                  ? '请先选择云盘'
                  : undefined
            }
          >
            <span>
              <Dropdown
                trigger={['click']}
                menu={{
                  items: [
                    {
                      key: 'batchDelete',
                      label: '批量删除',
                      disabled: !hasDisksWrite || selectedRowKeys.length === 0,
                      danger: true,
                    },
                  ],
                  onClick: ({ key }) => {
                    if (!hasDisksWrite) {
                      message.error(
                        '当前账号没有批量操作云盘的权限（需要 clouds.disks:write 或 clouds:write 权限）',
                      );
                      return;
                    }
                    if (selectedRowKeys.length === 0) {
                      message.warning('请先选择云盘');
                      return;
                    }
                    if (key === 'batchDelete') actions.handleBatchDelete();
                  },
                }}
              >
                <Button
                  icon={<EllipsisOutlined />}
                  disabled={!hasDisksWrite || selectedRowKeys.length === 0}
                />
              </Dropdown>
            </span>
          </Tooltip>
          <TableColumnSettingsButton
            allColumns={allColumns}
            settingsKey={TABLE_COLUMNS_SETTINGS_KEY}
            defaultHiddenColumns={['namespace', 'volumeMode']}
          />
          <Button icon={<ReloadOutlined />} onClick={handleToolbarRefresh} loading={loading} />
        </>
      }
    >
      <Table
        className="std-table"
        scroll={{ x: true }}
        bordered={false}
        rowKey="key"
        rowSelection={{
          selectedRowKeys,
          onChange: setSelectedRowKeys,
        }}
        columns={tableColumns}
        dataSource={filteredData}
        loading={loading}
        pagination={{
          showTotal: (total) => `共 ${total} 条`,
        }}
      />

      <VolumeCreateModal
        open={actions.createOpen}
        openNonce={actions.createModalNonce}
        onCancel={() => {
          actions.setCreateOpen(false);
          actions.setVolumeCreateSeed(null);
        }}
        cloudId={cloudId}
        nsOptions={nsOptions}
        storageClassOptions={actions.createVolumeStorageClassOptions}
        defaultStorageClassName={actions.defaultStorageClassName}
        onNamespacesListFetched={(list) => setFetchedNsOptions(list)}
        onSuccess={refreshVolumesSilent}
        seed={actions.volumeCreateSeed}
        isTenant={isTenant}
      />

      <VolumeAttachModal
        open={actions.attachOpen}
        openNonce={actions.attachModalNonce}
        onCancel={() => actions.setAttachOpen(false)}
        cloudId={cloudId}
        pvcNamespace={actions.currentRecord?.namespace || ''}
        pvcName={actions.currentRecord?.name || ''}
        vms={vms || []}
        initialInstanceId={actions.attachInitialInstanceId}
        onSuccess={refreshVolumesAfterWrite}
      />

      <VolumeExportImageModal
        open={actions.exportOpen}
        onCancel={() => actions.setExportOpen(false)}
        cloudId={cloudId}
        volume={actions.currentRecord}
        storageClassOptions={actions.createVolumeStorageClassOptions}
        defaultStorageClassName={actions.defaultStorageClassName}
        storageClasses={actions.storageClasses}
        onSuccess={refreshImagesSilent}
      />

      <VolumeSnapshotCreateModal
        open={actions.snapshotOpen}
        onCancel={() => actions.setSnapshotOpen(false)}
        cloudId={cloudId}
        volume={actions.currentRecord}
        storageClasses={actions.storageClasses}
        onSuccess={refreshVolumesSilent}
      />

      <VolumeResizeModal
        open={actions.editOpen}
        onCancel={() => actions.setEditOpen(false)}
        cloudId={cloudId}
        volume={actions.currentRecord}
        onSuccess={refreshVolumesSilent}
      />

      <VolumeCloneModal
        open={actions.cloneOpen}
        openNonce={actions.cloneModalNonce}
        onCancel={() => actions.setCloneOpen(false)}
        cloudId={cloudId}
        source={
          actions.currentRecord
            ? {
                namespace: actions.currentRecord.namespace,
                name: actions.currentRecord.name,
                capacityBytes: actions.currentRecord.capacityBytes,
                storageClass: actions.currentRecord.storageClass,
                accessModes: actions.currentRecord.accessModes,
                volumeMode: actions.currentRecord.volumeMode,
              }
            : null
        }
        storageClasses={actions.storageClasses}
        nsOptions={nsOptions}
        onCloneSuccess={refreshVolumesAfterWrite}
        onBranchToCreateVolume={actions.handleBranchCloneToCreateVolume}
        isTenant={isTenant}
      />

      <VolumeDetailDrawer
        open={actions.detailVisible && !actions.detailOpsMode}
        onClose={() => actions.setDetailVisible(false)}
        record={actions.detailRecord}
        cloudId={cloudId}
        activeTab={actions.detailActiveTab}
        onTabChange={actions.setDetailActiveTab}
      />
      <HarvesterResourceDrawer
        open={actions.detailVisible && actions.detailOpsMode}
        onClose={() => actions.setDetailVisible(false)}
        resourceType="PersistentVolumeClaim"
        record={actions.detailRecord}
        cloudId={cloudId}
        activeTab={actions.detailActiveTab}
        onTabChange={actions.setDetailActiveTab}
      />
    </PageDetailSection>
  );
};

export default VolumesSection;
