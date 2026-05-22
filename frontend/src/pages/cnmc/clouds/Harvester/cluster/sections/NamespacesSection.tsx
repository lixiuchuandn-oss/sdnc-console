/**
 * Harvester 集群 · 命名空间（项目）列表与创建/编辑。
 */
import React, { useCallback, useMemo, useState } from 'react';

import { Button, Input, Modal, Space, Select, Table, message } from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';

import PageDetailSection from 'components/PageDetailSection';
import TableColumnSettingsButton from 'components/TableColumnSettingsButton';
import { useAuth } from 'contexts/AuthContext';
import { useTableColumnSettings } from 'hooks/useTableColumnSettings';
import { deleteHarvesterNamespace } from 'services/harvester/clusterInventory';
import { hasPermissionForAction } from 'utils/accessMapping';
import { isTenantScenarioNamespace } from 'utils/harvesterUtils';
import { clearGetCacheForPath } from 'utils/requestManager';
import NamespaceFormDrawer from '../drawers/NamespaceFormDrawer';
import {
  DEFAULT_NAMESPACE_TYPE_FILTERS,
  filterNamespacesForTable,
  getNamespaceDisplayName,
  namespaceRowToViewLink,
  type NamespaceListRow,
} from '../lib/namespacesSectionUtils';
import { buildNamespacesTableColumns } from '../lib/namespacesTableColumns';
import { ResourceLinkYamlDrawer } from '../../shared/components/ResourceLinkYamlDrawer';

const TABLE_COLUMNS_SETTINGS_KEY = 'harvester_namespaces_table_v3';

const TYPE_FILTER_OPTIONS = [
  { label: '公共', value: 'public' },
  { label: '租户', value: 'tenant' },
  { label: '管理员', value: 'admin' },
  { label: '未标注场景', value: 'unlabeled' },
] as const;

const STATUS_FILTER_OPTIONS = [
  { label: 'Active', value: 'Active' },
  { label: 'Terminating', value: 'Terminating' },
] as const;

type Props = {
  cloudId: string;
  namespaces?: unknown[];
  loading?: boolean;
  onRefresh?: (force?: boolean, silent?: boolean) => void;
  isTenant?: boolean;
};

function tableFiltersKey(parts: readonly string[]): string {
  return parts.join('|');
}

const NamespacesSection: React.FC<Props> = ({
  cloudId,
  namespaces = [],
  loading = false,
  onRefresh,
  isTenant,
}) => {
  const { user } = useAuth();

  const hasNamespacesWrite = useMemo(() => {
    const perms = (user?.permissions ?? []) as string[];
    return (
      hasPermissionForAction(perms, 'clouds.namespaces:write') ||
      hasPermissionForAction(perms, 'clouds:write')
    );
  }, [user?.permissions]);

  const [keyword, setKeyword] = useState('');
  const [namespaceFormOpen, setNamespaceFormOpen] = useState(false);
  const [editingNamespace, setEditingNamespace] = useState<unknown>(null);
  const [filterTypes, setFilterTypes] = useState<string[]>([...DEFAULT_NAMESPACE_TYPE_FILTERS]);
  const [filterStatus, setFilterStatus] = useState('');

  const [yamlDrawerOpen, setYamlDrawerOpen] = useState(false);
  const [yamlViewLink, setYamlViewLink] = useState<string | undefined>();

  const closeNamespaceFormDrawer = useCallback(() => {
    setNamespaceFormOpen(false);
    setEditingNamespace(null);
  }, []);

  const handleToolbarRefresh = useCallback(() => {
    if (!onRefresh) {
      message.warning('刷新功能未配置');
      return;
    }
    void Promise.resolve(onRefresh(true)).catch((e: unknown) => {
      const err = e as { message?: string };
      message.error(`刷新失败: ${err?.message || '未知错误'}`);
    });
  }, [onRefresh]);

  const handleOpenYaml = useCallback((record: NamespaceListRow) => {
    const link = namespaceRowToViewLink(record);
    if (!link) {
      message.warning('当前行缺少 View Link，无法拉取 YAML');
      return;
    }
    setYamlViewLink(link);
    setYamlDrawerOpen(true);
  }, []);

  const handleEdit = useCallback(
    (record: NamespaceListRow) => {
      if (!hasNamespacesWrite) {
        message.error('无权限执行该操作');
        return;
      }
      setEditingNamespace(record);
      setNamespaceFormOpen(true);
    },
    [hasNamespacesWrite],
  );

  const handleDelete = useCallback(
    (record: NamespaceListRow) => {
      if (!hasNamespacesWrite) {
        message.error('无权限执行该操作');
        return;
      }
      if (!isTenantScenarioNamespace(record)) {
        message.warning('仅允许删除租户项目（须带 tower.io/scenario=tenant）');
        return;
      }

      const name = getNamespaceDisplayName(record);
      if (!name) return;

      Modal.confirm({
        title: '删除项目',
        content: `确定删除命名空间「${name}」吗？删除后不可恢复；请确认集群内已无虚拟机及其他重要资源。`,
        okText: '删除',
        okType: 'danger',
        cancelText: '取消',
        onOk: async () => {
          try {
            await deleteHarvesterNamespace(cloudId, name);
            message.success('删除成功');
            clearGetCacheForPath(`/api/clouds/${cloudId}/resources/harvester/namespaces`);
            onRefresh?.(true, true);
          } catch (e: unknown) {
            const err = e as { message?: string };
            message.error(err?.message || '删除失败');
            throw e;
          }
        },
      });
    },
    [cloudId, hasNamespacesWrite, onRefresh],
  );

  const filtered = useMemo(
    () =>
      filterNamespacesForTable(namespaces, {
        keyword,
        filterTypes,
        filterStatus,
      }),
    [namespaces, keyword, filterTypes, filterStatus],
  );

  const typeFilterSortedKey = useMemo(() => [...filterTypes].sort().join(','), [filterTypes]);
  const tableKey = tableFiltersKey([keyword.trim(), typeFilterSortedKey, filterStatus]);

  const allColumns = useMemo(
    () =>
      buildNamespacesTableColumns({
        isTenant,
        hasNamespacesWrite,
        onOpenYaml: handleOpenYaml,
        onEdit: handleEdit,
        onDelete: handleDelete,
      }),
    [handleDelete, handleEdit, handleOpenYaml, hasNamespacesWrite, isTenant],
  );

  const { displayColumns: tableColumns } = useTableColumnSettings(allColumns, TABLE_COLUMNS_SETTINGS_KEY);

  const resetToolbar = useCallback(() => {
    setKeyword('');
    setFilterTypes([...DEFAULT_NAMESPACE_TYPE_FILTERS]);
    setFilterStatus('');
  }, []);

  return (
    <PageDetailSection
      asCard={false}
      toolbarLeft={(
        <Space wrap size={[8, 8]}>
          <Input
            allowClear
            placeholder="名称/标签"
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="toolbar-search"
          />
          <Select<string[]>
            mode="multiple"
            allowClear
            placeholder="项目类型"
            value={filterTypes}
            onChange={(v) => setFilterTypes(v ?? [])}
            maxTagCount="responsive"
            options={[...TYPE_FILTER_OPTIONS]}
            className="toolbar-filter-sm"
          />
          <Select<string>
            allowClear
            placeholder="项目状态"
            value={filterStatus || undefined}
            onChange={(v?: string | null) => setFilterStatus(v ? String(v) : '')}
            options={[...STATUS_FILTER_OPTIONS]}
            className="toolbar-filter-sm"
          />
          <button type="button" className="toolbar-reset-btn" onClick={resetToolbar}>
            重置
          </button>
        </Space>
      )}
      toolbarRight={(
        <div className="toolbar-actions">
          <Button
            type="primary"
            disabled={!hasNamespacesWrite}
            onClick={() => {
              if (!hasNamespacesWrite) return;
              setEditingNamespace(null);
              setNamespaceFormOpen(true);
            }}
          >
            创建项目
          </Button>
          <TableColumnSettingsButton allColumns={allColumns} settingsKey={TABLE_COLUMNS_SETTINGS_KEY} />
          <Button
            icon={<ReloadOutlined />}
            onClick={handleToolbarRefresh}
            loading={loading}
            disabled={loading}
          />
        </div>
      )}
    >
      <Table<NamespaceListRow>
        key={tableKey}
        className="std-table"
        scroll={{ x: true }}
        bordered={false}
        rowKey={(row, index) => row.metadata?.uid || row.metadata?.name || row.name || `row-${index}`}
        loading={loading}
        dataSource={filtered}
        pagination={{
          showTotal: (total) => `共 ${total} 条`,
        }}
        columns={tableColumns}
      />

      <NamespaceFormDrawer
        open={namespaceFormOpen}
        onClose={closeNamespaceFormDrawer}
        cloudId={cloudId}
        editingRecord={editingNamespace}
        onCommitted={() => onRefresh?.(true, true)}
      />

      <ResourceLinkYamlDrawer
        open={yamlDrawerOpen}
        onClose={() => {
          setYamlDrawerOpen(false);
          setYamlViewLink(undefined);
        }}
        cloudId={cloudId}
        viewLink={yamlViewLink}
        title="项目 YAML"
      />
    </PageDetailSection>
  );
};

export default NamespacesSection;
