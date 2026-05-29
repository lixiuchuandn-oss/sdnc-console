/**
 * Harvester - 云主机备份 / 快照列表 Section
 */
import React, { useMemo, useState } from 'react';
import { Button, Input, Select, Table } from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import TableColumnSettingsButton from '../../../../../../components/TableColumnSettingsButton';
import WriteGuard from '../../../../../../components/WriteGuard';
import { useTableColumnSettings } from '../../../../../../hooks/useTableColumnSettings';
import { useHarvesterPublicNamespaces } from '../../shared/context/HarvesterPublicNamespacesContext';
import { useAuth } from '../../../../../../contexts/AuthContext';
import { canWriteVmBackupSnapshots, canWriteVmBackups } from '../lib/cbrPermissions';
import HarvesterResourceDrawer from '../../shared/components/HarvesterOpsinfoDrawer';
import VmBackupCreateModal from '../modals/VmBackupCreateModal';
import VmRestoreModal from '../modals/VmRestoreModal';
import { useBackupsSectionActions } from '../hooks/useBackupsSectionActions';
import {
  buildBackupNamespaceOptions,
  filterBackupsForTable,
  normalizeBackupList,
  type BackupListType,
} from '../lib/backupsSectionUtils';
import { buildBackupsTableColumns } from '../lib/backupsTableColumns';
import {
  createHarvesterToolbarRefresh,
  type HarvesterSectionOnRefresh,
} from '../lib/cbrSectionRefresh';

interface Props {
  cloudId: string;
  backups: unknown[];
  loading: boolean;
  onRefresh?: HarvesterSectionOnRefresh;
  namespaces: unknown[];
  vms: unknown[];
  type?: BackupListType;
  vmId?: string;
  targetVmPredicate?: (namespace: string, vmName: string) => boolean;
  restoreVms?: unknown[];
  isTenant?: boolean;
}

const BackupsSection: React.FC<Props> = ({
  cloudId,
  backups,
  loading,
  onRefresh,
  namespaces,
  vms,
  type = 'backup',
  vmId,
  targetVmPredicate,
  restoreVms,
  isTenant,
}) => {
  const vmsForRestore = restoreVms ?? vms;
  const { isPublicNamespace } = useHarvesterPublicNamespaces();
  const { user } = useAuth();
  const perms = useMemo(() => (user?.permissions ?? []) as string[], [user?.permissions]);
  const hasBackupsWrite = useMemo(
    () => (type === 'snapshot' ? canWriteVmBackupSnapshots(perms) : canWriteVmBackups(perms)),
    [perms, type],
  );

  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [namespaceFilter, setNamespaceFilter] = useState<string | undefined>(undefined);

  const dataSource = useMemo(
    () =>
      normalizeBackupList({
        backups,
        type,
        vms,
        vmId,
        targetVmPredicate,
      }),
    [backups, type, vmId, vms, targetVmPredicate],
  );

  const filteredData = useMemo(
    () =>
      filterBackupsForTable(dataSource, {
        keyword,
        statusFilter,
        namespaceFilter,
        isTenant,
        isPublicNamespace,
      }),
    [dataSource, isPublicNamespace, isTenant, keyword, namespaceFilter, statusFilter],
  );

  const namespaceOptions = useMemo(
    () => buildBackupNamespaceOptions(dataSource, { isTenant, isPublicNamespace }),
    [dataSource, isPublicNamespace, isTenant],
  );

  const actions = useBackupsSectionActions({
    cloudId,
    type,
    hasBackupsWrite,
    onRefresh,
  });

  const handleToolbarRefresh = useMemo(
    () => createHarvesterToolbarRefresh(onRefresh),
    [onRefresh],
  );

  const columns = useMemo(
    () =>
      buildBackupsTableColumns({
        isTenant,
        hasBackupsWrite,
        onOpenYaml: actions.handleOpenYaml,
        onRestore: actions.handleRestore,
        onDelete: actions.handleDelete,
      }),
    [
      actions.handleDelete,
      actions.handleOpenYaml,
      actions.handleRestore,
      hasBackupsWrite,
      isTenant,
    ],
  );

  const { displayColumns: visibleColumns } = useTableColumnSettings(
    columns,
    `harvester_${type}_list`,
  );

  const drawerResourceType = type === 'backup' ? 'VmBackup' : 'VmSnapshot';

  return (
    <>
      <PageDetailSection
        asCard={false}
        toolbarLeft={
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
                allowClear
                showSearch
                className="toolbar-filter-sm"
                placeholder="项目"
                value={namespaceFilter}
                onChange={setNamespaceFilter}
                options={namespaceOptions}
              />
            )}
            <Select
              allowClear
              className="toolbar-filter-sm"
              placeholder="选择状态"
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { label: '就绪', value: 'ready' },
                { label: '未就绪', value: 'not_ready' },
              ]}
            />
            <button
              type="button"
              className="toolbar-reset-btn"
              onClick={() => {
                setKeyword('');
                setStatusFilter(undefined);
                setNamespaceFilter(undefined);
              }}
            >
              重置
            </button>
          </>
        }
        toolbarRight={
          <div className="toolbar-actions">
            <WriteGuard canWrite={hasBackupsWrite}>
              <Button
                type="primary"
                onClick={() => actions.setCreateModalVisible(true)}
              >
                创建{type === 'backup' ? '备份' : '快照'}
              </Button>
            </WriteGuard>
            <TableColumnSettingsButton
              allColumns={columns}
              settingsKey={`harvester_${type}_list`}
            />
            <Button icon={<ReloadOutlined />} onClick={handleToolbarRefresh} loading={loading} />
          </div>
        }
      >
        <Table
          className="std-table"
          scroll={{ x: true }}
          bordered={false}
          dataSource={filteredData}
          columns={visibleColumns || columns}
          rowKey={(record) => record.key || `${record.namespace}-${record.name}`}
          loading={loading}
          pagination={{
            showTotal: (total) => `共 ${total} 条`,
          }}
        />
      </PageDetailSection>

      <HarvesterResourceDrawer
        open={actions.drawerVisible}
        onClose={() => actions.setDrawerVisible(false)}
        resourceType={drawerResourceType}
        record={actions.drawerRecord}
        cloudId={cloudId}
        activeTab={actions.drawerActiveTab}
        onTabChange={actions.setDrawerActiveTab}
      />

      <VmBackupCreateModal
        open={actions.createModalVisible}
        onCancel={() => actions.setCreateModalVisible(false)}
        onSuccess={actions.handleCreateSuccess}
        cloudId={cloudId}
        namespaces={namespaces}
        vms={vms}
        initialType={type}
        backups={backups}
      />

      <VmRestoreModal
        open={actions.restoreModalVisible}
        onCancel={() => actions.setRestoreModalVisible(false)}
        onSuccess={() => actions.setRestoreModalVisible(false)}
        cloudId={cloudId}
        resource={actions.currentSnapshot}
        resourceType={type}
        vms={vmsForRestore}
      />
    </>
  );
};

export default BackupsSection;
