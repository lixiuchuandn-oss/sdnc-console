/**
 * Harvester - 虚拟机迁移记录列表 Section
 * 列表数据由 Cloudmap 池 `loadTabResource('migrations')` 注入；刷新见 `computeRefresh.ts`。
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Table, Input, Button, Select, message } from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';

import PageDetailSection from 'components/PageDetailSection';
import TableColumnSettingsButton from 'components/TableColumnSettingsButton';
import { useAuth } from 'contexts/AuthContext';
import { useTableColumnSettings } from 'hooks/useTableColumnSettings';
import { abortHarvesterMigration } from 'services/harvester/vm';
import { hasPermissionForAction } from 'utils/accessMapping';
import { ResourceLinkYamlDrawer } from '../../shared/components/ResourceLinkYamlDrawer';
import { useHarvesterResourceLinkYamlDrawer } from '../../shared/lib/useHarvesterResourceLinkYamlDrawer';
import {
  createHarvesterToolbarRefresh,
  runHarvesterSectionRefresh,
} from '../../shared/lib/harvesterSectionRefresh';
import type { HarvesterSectionOnRefresh } from '../../shared/lib/harvesterSectionRefresh';
import {
  buildMigrationNamespaceOptions,
  buildMigrationStatusOptions,
  filterMigrationsForTable,
  migrationRowFields,
  type MigrationTableRow,
} from '../lib/migrationsSectionUtils';
import { buildMigrationsTableColumns } from '../lib/migrationsTableColumns';

const TABLE_SETTINGS_KEY = 'harvester_migrations_table';

type Props = {
  cloudId: string;
  onRefresh: HarvesterSectionOnRefresh;
  migrations: MigrationTableRow[];
  loading?: boolean;
  vms?: unknown[];
  isTenant?: boolean;
};

const MigrationsSection: React.FC<Props> = ({
  cloudId,
  onRefresh,
  migrations,
  loading = false,
  vms,
  isTenant = false,
}) => {
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [namespaceFilter, setNamespaceFilter] = useState('');
  const { user } = useAuth();
  const { yamlDrawerOpen, yamlViewLink, yamlDrawerTitle, openYamlDrawer, closeYamlDrawer } =
    useHarvesterResourceLinkYamlDrawer(cloudId);

  const canWrite = useMemo(
    () =>
      hasPermissionForAction(user?.permissions || [], 'clouds.migrations:write') ||
      hasPermissionForAction(user?.permissions || [], 'clouds.ecs:write') ||
      hasPermissionForAction(user?.permissions || [], 'clouds:write'),
    [user?.permissions],
  );

  const data = migrations;

  const handleOpenYaml = useCallback((record: MigrationTableRow) => {
    openYamlDrawer(
      { ...record, kind: 'VirtualMachineInstanceMigration' },
      { title: '迁移任务 YAML' },
    );
  }, [openYamlDrawer]);

  const handleAbort = useCallback(
    async (record: MigrationTableRow) => {
      try {
        const row = record as { spec?: { vmiName?: string }; metadata?: { namespace?: string } };
        const vmName = row.spec?.vmiName;
        const namespace = row.metadata?.namespace;
        if (!vmName || !namespace) {
          message.error('无法解析关联的虚拟机信息');
          return;
        }
        await abortHarvesterMigration(cloudId, `${namespace}/${vmName}`);
        message.success('已发送取消请求');
        void runHarvesterSectionRefresh(onRefresh, { force: true });
      } catch (e: unknown) {
        const err = e as { message?: string };
        message.error(err?.message || '取消失败');
      }
    },
    [cloudId, onRefresh],
  );

  const handleToolbarRefresh = useMemo(
    () => createHarvesterToolbarRefresh(onRefresh),
    [onRefresh],
  );

  const filteredData = useMemo(
    () => filterMigrationsForTable(data, { keyword, statusFilter, namespaceFilter }, vms),
    [data, keyword, namespaceFilter, statusFilter, vms],
  );

  const statusOptions = useMemo(() => buildMigrationStatusOptions(data), [data]);
  const namespaceOptions = useMemo(() => buildMigrationNamespaceOptions(data), [data]);

  const allColumns = useMemo(
    () =>
      buildMigrationsTableColumns({
        isTenant,
        vms,
        canWrite,
        onOpenYaml: handleOpenYaml,
        onAbort: handleAbort,
      }),
    [canWrite, handleAbort, handleOpenYaml, isTenant, vms],
  );

  const { displayColumns: tableColumns } = useTableColumnSettings(allColumns, TABLE_SETTINGS_KEY);

  return (
    <PageDetailSection
      title="迁移记录"
      refreshLoading={loading}
      toolbarLeft={
        <>
          <Input
            allowClear
            placeholder="任务ID/虚拟机"
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="toolbar-search"
          />
          {!isTenant && (
            <Select
              allowClear
              showSearch
              placeholder="命名空间"
              value={namespaceFilter || undefined}
              onChange={(v) => setNamespaceFilter(v || '')}
              className="toolbar-filter-sm"
              options={namespaceOptions.map((v) => ({ value: v, label: v }))}
            />
          )}
          <Select
            allowClear
            placeholder="状态"
            value={statusFilter || undefined}
            onChange={(v) => setStatusFilter(v || '')}
            className="toolbar-filter-sm"
            options={statusOptions}
          />
          <button
            type="button"
            className="toolbar-reset-btn"
            onClick={() => {
              setKeyword('');
              setNamespaceFilter('');
              setStatusFilter('');
            }}
          >
            重置
          </button>
        </>
      }
      toolbarRight={
        <div className="toolbar-actions">
          <TableColumnSettingsButton allColumns={allColumns} settingsKey={TABLE_SETTINGS_KEY} />
          <Button icon={<ReloadOutlined />} onClick={handleToolbarRefresh} loading={loading} />
        </div>
      }
    >
      <Table
        className="std-table"
        scroll={{ x: true }}
        bordered={false}
        rowKey={(r) => String(migrationRowFields.uidOrKey(r))}
        columns={tableColumns}
        dataSource={filteredData}
        loading={loading}
        pagination={{
          showTotal: (total) => `共 ${total} 条`,
        }}
      />
      <ResourceLinkYamlDrawer
        open={yamlDrawerOpen}
        onClose={closeYamlDrawer}
        cloudId={cloudId}
        viewLink={yamlViewLink}
        title={yamlDrawerTitle || '迁移任务 YAML'}
      />
    </PageDetailSection>
  );
};

export default MigrationsSection;
