/**
 * Harvester - 虚拟机迁移记录列表 Section
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Table, Input, Button, Select, message } from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';

import PageDetailSection from 'components/PageDetailSection';
import TableColumnSettingsButton from 'components/TableColumnSettingsButton';
import { useAuth } from 'contexts/AuthContext';
import { useTableColumnSettings } from 'hooks/useTableColumnSettings';
import {
  abortHarvesterMigration,
  fetchHarvesterMigrations,
  fetchHarvesterMigrationsDirect,
} from 'services/harvester/vm';
import { hasPermissionForAction } from 'utils/accessMapping';
import HarvesterResourceDrawer from '../../shared/components/HarvesterOpsinfoDrawer';
import { createHarvesterToolbarRefresh } from '../../shared/lib/harvesterSectionRefresh';
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
  onRefresh?: HarvesterSectionOnRefresh;
  vms?: unknown[];
  isTenant?: boolean;
};

const MigrationsSection: React.FC<Props> = ({ cloudId, onRefresh, vms, isTenant = false }) => {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<MigrationTableRow[]>([]);
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [namespaceFilter, setNamespaceFilter] = useState('');
  const { user } = useAuth();
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailRecord, setDetailRecord] = useState<unknown>(null);
  const [detailActiveTab, setDetailActiveTab] = useState('detail');

  const canWrite = useMemo(
    () =>
      hasPermissionForAction(user?.permissions || [], 'clouds.migrations:write') ||
      hasPermissionForAction(user?.permissions || [], 'clouds.ecs:write') ||
      hasPermissionForAction(user?.permissions || [], 'clouds:write'),
    [user?.permissions],
  );

  const loadData = useCallback(
    async (force = false) => {
      setLoading(true);
      try {
        const res = await fetchHarvesterMigrations(cloudId, force);
        let list = res?.data?.items || [];
        if (!Array.isArray(list) || list.length === 0) {
          try {
            const direct = await fetchHarvesterMigrationsDirect(cloudId, force);
            list = direct?.data?.items || direct?.items || [];
          } catch {
            // direct fallback optional
          }
        }
        setData(Array.isArray(list) ? (list as MigrationTableRow[]) : []);
      } catch (e: unknown) {
        const err = e as { message?: string };
        message.error(err?.message || '加载迁移记录失败');
      } finally {
        setLoading(false);
      }
    },
    [cloudId],
  );

  useEffect(() => {
    void loadData(true);
  }, [loadData]);

  const handleOpenDrawer = useCallback((record: MigrationTableRow, tab = 'detail') => {
    const row = record as { metadata?: { namespace?: string; name?: string }; links?: { view?: string } };
    const ns = row?.metadata?.namespace;
    const name = row?.metadata?.name;
    const view =
      ns && name
        ? `/apis/kubevirt.io/v1/namespaces/${encodeURIComponent(ns)}/virtualmachineinstancemigrations/${encodeURIComponent(name)}`
        : undefined;
    setDetailRecord({
      ...row,
      kind: 'VirtualMachineInstanceMigration',
      links: { ...(row?.links || {}), ...(view ? { view } : {}) },
    });
    setDetailActiveTab(tab);
    setDetailVisible(true);
  }, []);

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
        void loadData(true);
        onRefresh?.(true);
      } catch (e: unknown) {
        const err = e as { message?: string };
        message.error(err?.message || '取消失败');
      }
    },
    [cloudId, loadData, onRefresh],
  );

  const handleToolbarRefresh = useMemo(
    () => createHarvesterToolbarRefresh(onRefresh, { before: () => void loadData(true) }),
    [loadData, onRefresh],
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
        onOpenDrawer: handleOpenDrawer,
        onAbort: handleAbort,
      }),
    [canWrite, handleAbort, handleOpenDrawer, isTenant, vms],
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
      <HarvesterResourceDrawer
        open={detailVisible}
        onClose={() => setDetailVisible(false)}
        resourceType="VirtualMachineInstanceMigration"
        record={detailRecord}
        activeTab={detailActiveTab}
        onTabChange={setDetailActiveTab}
        cloudId={cloudId}
      />
    </PageDetailSection>
  );
};

export default MigrationsSection;
