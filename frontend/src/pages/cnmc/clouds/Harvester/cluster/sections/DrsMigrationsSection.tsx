/**
 * 计算资源 · DRS 触发的虚拟机迁移记录（VMIM）
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Button, Input, Select, Table, message } from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection from 'components/PageDetailSection';
import TableColumnSettingsButton from 'components/TableColumnSettingsButton';
import { useTableColumnSettings } from 'hooks/useTableColumnSettings';
import { abortHarvesterMigration } from 'services/harvester/vm';
import {
  createHarvesterToolbarRefresh,
  runHarvesterSectionRefresh,
} from '../../shared/lib/harvesterSectionRefresh';
import { ResourceLinkYamlDrawer } from '../../shared/components/ResourceLinkYamlDrawer';
import { useHarvesterResourceLinkYamlDrawer } from '../../shared/lib/useHarvesterResourceLinkYamlDrawer';
import {
  buildMigrationsTableColumns,
  type MigrationsTableActions,
} from '../../ecs/lib/migrationsTableColumns';
import {
  buildMigrationNamespaceOptions,
  buildMigrationStatusOptions,
  filterMigrationsForTable,
  migrationRowFields,
  type MigrationTableRow,
} from '../../ecs/lib/migrationsSectionUtils';
import { useDrsSectionData } from '../hooks/useDrsSectionData';

const REALLOCATION_TABLE_KEY = 'harvester_drs_reallocation_migrations_table';

export type DrsMigrationsSectionProps = {
  cloudId: string;
  checkPerm: (act: string) => boolean;
  vms?: unknown[];
  isTenant?: boolean;
};

const DrsMigrationsSection: React.FC<DrsMigrationsSectionProps> = ({
  cloudId,
  checkPerm,
  vms,
  isTenant = false,
}) => {
  const canRead =
    checkPerm('clouds.migrations:read') ||
    checkPerm('clouds.drs:read') ||
    checkPerm('clouds.ecs:read');
  const canWriteMigration = checkPerm('clouds.migrations:write') || checkPerm('clouds.ecs:write');

  const [reallocationKeyword, setReallocationKeyword] = useState('');
  const [reallocationStatusFilter, setReallocationStatusFilter] = useState('');
  const [reallocationNamespaceFilter, setReallocationNamespaceFilter] = useState('');

  const { loading, reallocationMigrations, loadAll } = useDrsSectionData(cloudId, canRead);

  const { yamlDrawerOpen, yamlViewLink, yamlDrawerTitle, openYamlDrawer, closeYamlDrawer } =
    useHarvesterResourceLinkYamlDrawer(cloudId);

  const handleRefresh = useMemo(() => createHarvesterToolbarRefresh(loadAll), [loadAll]);

  const handleOpenMigrationYaml = useCallback(
    (record: MigrationTableRow) => {
      openYamlDrawer(
        { ...record, kind: 'VirtualMachineInstanceMigration' },
        { title: '迁移任务配置' },
      );
    },
    [openYamlDrawer],
  );

  const handleAbortMigration = useCallback(
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
        void runHarvesterSectionRefresh(loadAll, { force: true });
      } catch (e: unknown) {
        const err = e as { message?: string };
        message.error(err?.message || '取消失败');
      }
    },
    [cloudId, loadAll],
  );

  const filteredReallocationMigrations = useMemo(
    () =>
      filterMigrationsForTable(
        reallocationMigrations,
        {
          keyword: reallocationKeyword,
          statusFilter: reallocationStatusFilter,
          namespaceFilter: reallocationNamespaceFilter,
          triggerFilter: '',
        },
        vms,
      ),
    [
      reallocationKeyword,
      reallocationMigrations,
      reallocationNamespaceFilter,
      reallocationStatusFilter,
      vms,
    ],
  );

  const reallocationStatusOptions = useMemo(
    () => buildMigrationStatusOptions(reallocationMigrations),
    [reallocationMigrations],
  );
  const reallocationNamespaceOptions = useMemo(
    () => buildMigrationNamespaceOptions(reallocationMigrations),
    [reallocationMigrations],
  );

  const migrationActions: MigrationsTableActions = useMemo(
    () => ({
      isTenant,
      vms,
      canWrite: canWriteMigration,
      onOpenYaml: handleOpenMigrationYaml,
      onAbort: handleAbortMigration,
    }),
    [canWriteMigration, handleAbortMigration, handleOpenMigrationYaml, isTenant, vms],
  );

  const reallocationColumnsAll = useMemo(() => {
    return buildMigrationsTableColumns(migrationActions).filter((c) => c.key !== 'trigger');
  }, [migrationActions]);

  const { displayColumns: reallocationColumns } = useTableColumnSettings(
    reallocationColumnsAll,
    REALLOCATION_TABLE_KEY,
  );

  const resetReallocationFilters = useCallback(() => {
    setReallocationKeyword('');
    setReallocationNamespaceFilter('');
    setReallocationStatusFilter('');
  }, []);

  if (!canRead) {
    return <Alert type="warning" showIcon message="无权限查看迁移记录" />;
  }

  return (
    <>
      <PageDetailSection
        asCard={false}
        autoStyleInputs={false}
        toolbarLeft={
          <>
            <Input
              allowClear
              placeholder="任务ID/虚拟机/触发指纹"
              suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
              value={reallocationKeyword}
              onChange={(e) => setReallocationKeyword(e.target.value)}
              className="toolbar-search"
            />
            {!isTenant ? (
              <Select
                allowClear
                showSearch
                placeholder="命名空间"
                value={reallocationNamespaceFilter || undefined}
                onChange={(v) => setReallocationNamespaceFilter(v || '')}
                className="toolbar-filter-sm"
                options={reallocationNamespaceOptions.map((v) => ({ value: v, label: v }))}
              />
            ) : null}
            <Select
              allowClear
              placeholder="状态"
              value={reallocationStatusFilter || undefined}
              onChange={(v) => setReallocationStatusFilter(v || '')}
              className="toolbar-filter-sm"
              options={reallocationStatusOptions}
            />
            <button type="button" className="toolbar-reset-btn" onClick={resetReallocationFilters}>
              重置
            </button>
          </>
        }
        toolbarRight={
          <div className="toolbar-actions">
            <TableColumnSettingsButton
              allColumns={reallocationColumnsAll}
              settingsKey={REALLOCATION_TABLE_KEY}
            />
            <Button icon={<ReloadOutlined />} onClick={handleRefresh} loading={loading} />
          </div>
        }
      >
        <Table
          className="std-table"
          bordered={false}
          scroll={{ x: true }}
          rowKey={(r) => String(migrationRowFields.uidOrKey(r))}
          columns={reallocationColumns}
          dataSource={filteredReallocationMigrations}
          loading={loading}
          pagination={{ showTotal: (total) => `共 ${total} 条`, size: 'small' }}
        />
      </PageDetailSection>

      <ResourceLinkYamlDrawer
        open={yamlDrawerOpen}
        onClose={closeYamlDrawer}
        cloudId={cloudId}
        viewLink={yamlViewLink}
        title={yamlDrawerTitle || 'YAML'}
      />
    </>
  );
};

export default DrsMigrationsSection;
