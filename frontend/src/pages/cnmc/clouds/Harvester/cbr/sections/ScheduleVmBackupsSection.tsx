import React, { useMemo, useState, useCallback } from 'react';
import { Table, Button, Input, Select, message } from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import TableColumnSettingsButton from '../../../../../../components/TableColumnSettingsButton';
import WriteGuard from '../../../../../../components/WriteGuard';
import { useTableColumnSettings } from '../../../../../../hooks/useTableColumnSettings';
import { ResourceLinkYamlDrawer } from '../../shared/components/ResourceLinkYamlDrawer';
import { useHarvesterResourceLinkYamlDrawer } from '../../shared/lib/useHarvesterResourceLinkYamlDrawer';
import ScheduleVmBackupCreateModal from '../modals/ScheduleVmBackupCreateModal';
import ScheduleVmBackupEditModal from '../modals/ScheduleVmBackupEditModal';
import { useAuth } from '../../../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../../../utils/accessMapping';
import {
  createHarvesterToolbarRefresh,
  runHarvesterSectionRefresh,
  type HarvesterSectionOnRefresh,
} from '../lib/cbrSectionRefresh';
import {
  buildScheduleVmBackupDataSource,
  buildScheduleVmBackupNamespaceOptions,
  filterScheduleVmBackupsForTable,
  type ScheduleVmBackupListRow,
} from '../lib/scheduleVmBackupsSectionUtils';
import { buildScheduleVmBackupYamlRecord } from '../lib/scheduleVmBackupYaml';
import { buildScheduleVmBackupsTableColumns } from '../lib/scheduleVmBackupsTableColumns';
import { useScheduleVmBackupsOptimistic } from '../hooks/useScheduleVmBackupsOptimistic';
import { useScheduleVmBackupsSectionActions } from '../hooks/useScheduleVmBackupsSectionActions';

interface Props {
  cloudId: string;
  data: any[];
  loading: boolean;
  onRefresh?: HarvesterSectionOnRefresh;
  vms?: any[];
  vmId?: string;
  targetVmPredicate?: (namespace: string, vmName: string) => boolean;
  defaultHiddenColumns?: string[];
  isTenant?: boolean;
}

const ScheduleVmBackupsSection: React.FC<Props> = ({
  cloudId,
  data,
  loading,
  onRefresh,
  vms,
  vmId,
  targetVmPredicate,
  defaultHiddenColumns,
  isTenant,
}) => {
  const { user } = useAuth();
  const perms = useMemo(() => (user?.permissions ?? []) as string[], [user?.permissions]);
  const hasBackupsWrite = useMemo(
    () =>
      hasPermissionForAction(perms, 'clouds.backups:write') ||
      hasPermissionForAction(perms, 'clouds:write'),
    [perms],
  );
  const ensureBackupsWrite = useCallback(() => {
    if (hasBackupsWrite) return true;
    message.error('当前账号没有备份操作权限（需要 clouds.backups:write 或 clouds:write 权限）');
    return false;
  }, [hasBackupsWrite]);
  const handleToolbarRefresh = useMemo(
    () => createHarvesterToolbarRefresh(onRefresh),
    [onRefresh],
  );

  const [keyword, setKeyword] = useState('');
  const [typeFilter, setTypeFilter] = useState<string | undefined>(undefined);
  const [namespaceFilter, setNamespaceFilter] = useState<string | undefined>(undefined);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [currentRecord, setCurrentRecord] = useState<ScheduleVmBackupListRow | null>(null);

  const { yamlDrawerOpen, yamlViewLink, yamlDrawerTitle, openYamlDrawer, closeYamlDrawer } =
    useHarvesterResourceLinkYamlDrawer(cloudId);

  const optimistic = useScheduleVmBackupsOptimistic({ data, onRefresh });
  const { optimisticItems, removed, suspendedOverrides } = optimistic;
  const { handleSuspend, handleDelete, handleCreateSuccess } = useScheduleVmBackupsSectionActions({
    cloudId,
    onRefresh,
    hasBackupsWrite,
    ensureBackupsWrite,
    optimistic,
    vms,
  });

  const dataSource = useMemo(
    () =>
      buildScheduleVmBackupDataSource({
        data,
        vms,
        optimisticItems,
        removed,
        suspendedOverrides,
      }),
    [data, vms, optimisticItems, removed, suspendedOverrides],
  );

  const filteredData = useMemo(
    () =>
      filterScheduleVmBackupsForTable(dataSource, {
        keyword,
        typeFilter,
        namespaceFilter,
        vmId,
        targetVmPredicate,
      }),
    [dataSource, keyword, typeFilter, vmId, namespaceFilter, targetVmPredicate],
  );

  const namespaceOptions = useMemo(
    () => buildScheduleVmBackupNamespaceOptions(dataSource),
    [dataSource],
  );

  const columns = useMemo(
    () =>
      buildScheduleVmBackupsTableColumns({
        isTenant,
        hasBackupsWrite,
        onOpenYaml: (r) =>
          openYamlDrawer(buildScheduleVmBackupYamlRecord(r.raw), { title: '定时策略 YAML' }),
        onEdit: (r) => {
          setCurrentRecord(r);
          setEditModalVisible(true);
        },
        onSuspend: handleSuspend,
        onDelete: handleDelete,
      }),
    [handleDelete, handleSuspend, hasBackupsWrite, isTenant, openYamlDrawer],
  );

  const { displayColumns: visibleColumns } = useTableColumnSettings(
    columns,
    'harvester_schedule_backups_list',
    defaultHiddenColumns,
  );

  return (
    <>
      <PageDetailSection
        asCard={false}
        toolbarLeft={(
          <>
            <Input
              className="toolbar-search"
              placeholder="名称/ID"
              suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              allowClear
            />
            {!isTenant && (
              <Select
                className="toolbar-filter-sm"
                allowClear
                showSearch
                placeholder="项目"
                value={namespaceFilter}
                onChange={setNamespaceFilter}
                options={namespaceOptions}
              />
            )}
            <Select
              className="toolbar-filter-sm"
              allowClear
              placeholder="选择类型"
              value={typeFilter}
              onChange={setTypeFilter}
              options={[
                { label: '全部类型', value: 'all' },
                { label: '备份定时策略', value: 'backup' },
                { label: '快照定时策略', value: 'snapshot' },
              ]}
            />
            <button
              type="button"
              className="toolbar-reset-btn"
              onClick={() => {
                setKeyword('');
                setTypeFilter(undefined);
                setNamespaceFilter(undefined);
              }}
            >
              重置
            </button>
          </>
        )}
        toolbarRight={(
          <div className="toolbar-actions">
            <WriteGuard canWrite={hasBackupsWrite}>
              <Button
                type="primary"
                onClick={() => {
                  if (!ensureBackupsWrite()) return;
                  setCreateModalVisible(true);
                }}
              >
                创建定时策略
              </Button>
            </WriteGuard>
            <TableColumnSettingsButton
              allColumns={columns}
              settingsKey="harvester_schedule_backups_list"
              defaultHiddenColumns={defaultHiddenColumns}
            />
            <Button icon={<ReloadOutlined />} onClick={handleToolbarRefresh} loading={loading} />
          </div>
        )}
      >
        <Table
          className="std-table"
          scroll={{ x: true }}
          bordered={false}
          dataSource={filteredData}
          columns={visibleColumns || columns}
          rowKey={(record) => record.key || record.id || `${record.namespace}-${record.name}`}
          loading={loading}
          pagination={{
            showTotal: (total) => `共 ${total} 条`,
          }}
        />
      </PageDetailSection>

      <ResourceLinkYamlDrawer
        open={yamlDrawerOpen}
        onClose={closeYamlDrawer}
        cloudId={cloudId}
        viewLink={yamlViewLink}
        title={yamlDrawerTitle}
      />

      <ScheduleVmBackupCreateModal
        open={createModalVisible}
        cloudId={cloudId}
        onCancel={() => setCreateModalVisible(false)}
        onSuccess={(created) => {
          setCreateModalVisible(false);
          handleCreateSuccess(created);
        }}
      />

      <ScheduleVmBackupEditModal
        open={editModalVisible}
        cloudId={cloudId}
        record={currentRecord}
        vms={vms}
        onCancel={() => setEditModalVisible(false)}
        onSuccess={() => {
          setEditModalVisible(false);
          void runHarvesterSectionRefresh(onRefresh, { force: true });
        }}
      />
    </>
  );
};

export default ScheduleVmBackupsSection;
