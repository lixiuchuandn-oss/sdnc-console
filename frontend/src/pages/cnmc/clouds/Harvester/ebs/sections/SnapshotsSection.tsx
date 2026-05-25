/**
 * Harvester · 云盘快照列表 Section
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Button, Dropdown, Input, Select, Table, message } from 'antd';
import { EllipsisOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection from 'components/PageDetailSection';
import TableColumnSettingsButton from 'components/TableColumnSettingsButton';
import { useTableColumnSettings } from 'hooks/useTableColumnSettings';
import { useAuth } from 'contexts/AuthContext';
import { hasPermissionForAction } from 'utils/accessMapping';
import { useHarvesterPublicNamespaces } from '../../context/HarvesterPublicNamespacesContext';
import HarvesterResourceDrawer from '../../shared/components/HarvesterOpsinfoDrawer';
import {
  createHarvesterToolbarRefresh,
  runHarvesterSectionRefresh,
  type HarvesterSectionOnRefresh,
} from '../lib/ebsSectionRefresh';
import VolumeSnapshotRestoreModal from '../modals/VolumeSnapshotRestoreModal';
import { useSnapshotsSectionActions } from '../hooks/useSnapshotsSectionActions';
import {
  buildSnapshotNamespaceOptions,
  filterSnapshotsForTable,
  normalizeSnapshotList,
} from '../lib/snapshotsSectionUtils';
import { buildSnapshotsTableColumns } from '../lib/snapshotsTableColumns';

const TABLE_COLUMNS_SETTINGS_KEY = 'harvester_volume_snapshots_list';

type Props = {
  cloudId: string;
  snapshots: unknown[];
  loading: boolean;
  onRefresh?: HarvesterSectionOnRefresh;
  isTenant?: boolean;
  namespaces?: unknown[];
  bordered?: boolean;
};

const SnapshotsSection: React.FC<Props> = ({
  cloudId,
  snapshots,
  loading,
  onRefresh,
  isTenant = false,
  namespaces = [],
}) => {
  const { isPublicNamespace } = useHarvesterPublicNamespaces();
  const { user } = useAuth();
  const perms = useMemo(() => (user?.permissions ?? []) as string[], [user?.permissions]);
  const hasSnapshotsWrite = useMemo(
    () =>
      hasPermissionForAction(perms, 'clouds.snapshots:write') ||
      hasPermissionForAction(perms, 'clouds:write'),
    [perms],
  );

  const [keyword, setKeyword] = useState('');
  const [namespaceFilter, setNamespaceFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  const dataSource = useMemo(() => normalizeSnapshotList(snapshots), [snapshots]);

  const filteredData = useMemo(
    () =>
      filterSnapshotsForTable(dataSource, {
        keyword,
        namespaceFilter,
        statusFilter,
        isTenant,
        isPublicNamespace,
      }),
    [dataSource, keyword, namespaceFilter, statusFilter, isTenant, isPublicNamespace],
  );

  const snapshotActions = useSnapshotsSectionActions({
    cloudId,
    dataSource,
    hasSnapshotsWrite,
    isTenant,
    onRefresh,
    selectedRowKeys,
    setSelectedRowKeys,
  });

  const allColumns = useMemo(
    () =>
      buildSnapshotsTableColumns({
        isTenant,
        buildRowActionItems: snapshotActions.buildRowActionItems,
      }),
    [isTenant, snapshotActions.buildRowActionItems],
  );

  const { displayColumns: tableColumns } = useTableColumnSettings(
    allColumns,
    TABLE_COLUMNS_SETTINGS_KEY,
  );

  const namespaceFilterOptions = useMemo(
    () => buildSnapshotNamespaceOptions(namespaces as Array<{ name?: string; metadata?: { name?: string } }>, { excludeSystem: true }),
    [namespaces],
  );

  const handleToolbarRefresh = useMemo(
    () => createHarvesterToolbarRefresh(onRefresh),
    [onRefresh],
  );

  const resetFilters = useCallback(() => {
    setKeyword('');
    setNamespaceFilter('');
    setStatusFilter('');
  }, []);

  return (
    <PageDetailSection
      asCard={false}
      toolbarLeft={
        <>
          <Input
            placeholder="名称/ID"
            className="toolbar-search"
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            allowClear
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          {!isTenant ? (
            <Select
              allowClear
              showSearch
              placeholder="项目"
              className="toolbar-filter-sm"
              value={namespaceFilter || undefined}
              onChange={(v) => setNamespaceFilter(v || '')}
              options={[
                { value: '', label: '全部' },
                ...namespaceFilterOptions,
              ]}
            />
          ) : null}
          <Select
            allowClear
            placeholder="状态"
            className="toolbar-filter-sm"
            value={statusFilter || undefined}
            onChange={(v) => setStatusFilter(v || '')}
            options={[
              { value: '', label: '全部' },
              { value: 'ready', label: '就绪' },
              { value: 'notReady', label: '未就绪' },
            ]}
          />
          <button type="button" className="toolbar-reset-btn" onClick={resetFilters}>
            重置
          </button>
        </>
      }
      toolbarRight={
        <>
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                {
                  key: 'batchDelete',
                  label: '批量删除',
                  disabled: !hasSnapshotsWrite || selectedRowKeys.length === 0,
                  danger: true,
                },
              ],
              onClick: ({ key }) => key === 'batchDelete' && snapshotActions.handleBatchDelete(),
            }}
          >
            <Button
              icon={<EllipsisOutlined />}
              disabled={!hasSnapshotsWrite || selectedRowKeys.length === 0}
            />
          </Dropdown>
          <TableColumnSettingsButton allColumns={allColumns} settingsKey={TABLE_COLUMNS_SETTINGS_KEY} />
          <Button icon={<ReloadOutlined />} onClick={handleToolbarRefresh} loading={loading} />
        </>
      }
    >
      <Table
        className="std-table"
        bordered={false}
        dataSource={filteredData}
        columns={tableColumns}
        rowKey="key"
        loading={loading}
        scroll={{ x: true }}
        rowSelection={{
          selectedRowKeys,
          onChange: setSelectedRowKeys,
        }}
        pagination={{
          showTotal: (total) => `共 ${total} 条`,
        }}
      />

      <VolumeSnapshotRestoreModal
        visible={snapshotActions.restoreVisible}
        cloudId={cloudId}
        resource={snapshotActions.restoreRecord}
        onCancel={() => snapshotActions.setRestoreVisible(false)}
        onSuccess={() => {
          snapshotActions.setRestoreVisible(false);
          message.success('已提交恢复任务，请前往“云盘”列表查看');
          void runHarvesterSectionRefresh(onRefresh, { force: true });
        }}
      />

      <HarvesterResourceDrawer
        open={snapshotActions.detailVisible}
        onClose={() => snapshotActions.setDetailVisible(false)}
        resourceType="VolumeSnapshot"
        record={snapshotActions.detailRecord}
        cloudId={cloudId}
        activeTab={snapshotActions.detailActiveTab}
        onTabChange={snapshotActions.setDetailActiveTab}
      />
    </PageDetailSection>
  );
};

export default SnapshotsSection;
