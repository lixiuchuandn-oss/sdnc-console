/**
 * Harvester 集群 · 命名空间（项目）列表与创建/编辑。
 * 数据源由父级注入；刷新与写成功后通过 onRefresh(force) 对齐集群。
 * 本列表始终排除系统命名空间（不展示、不提供恢复开关）。
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Button, Input, Modal, message, Select, Table } from 'antd';
import { FolderOpenTwoTone, ReloadOutlined, SearchOutlined } from '@ant-design/icons';

import PageDetailSection from '../../../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../../../components/ResourceActionsDropdown';
import TableColumnSettingsButton from '../../../../../../components/TableColumnSettingsButton';
import { useAuth } from '../../../../../../contexts/AuthContext';
import { useTableColumnSettings } from '../../../../../../hooks/useTableColumnSettings';
import { hasPermissionForAction } from '../../../../../../utils/accessMapping';
import { deleteHarvesterNamespace } from '../../../../../../services/harvesterApi';
import {
  isSystemNamespace,
  isTenantScenarioNamespace,
  namespaceSectionType,
} from '../../../../../../utils/harvesterUtils';
import { clearGetCacheForPath } from '../../../../../../utils/requestManager';
import { ResourceLinkYamlDrawer } from '../../shared/components/ResourceLinkYamlDrawer';
import NamespaceFormDrawer from '../drawers/NamespaceFormDrawer';
import { useCloudmapOpsViewWrite } from '../../hooks/useCloudmapOpsViewWrite';

/** 表格列与用户列展示设置的持久化 key */
const TABLE_COLUMNS_SETTINGS_KEY = 'harvester_namespaces_table_v3';

type Props = {
  /** 云实例 ID */
  cloudId: string;
  namespaces?: unknown[];
  loading?: boolean;
  onRefresh?: (force?: boolean, silent?: boolean) => void;
  isTenant?: boolean;
};

/** 渲染 Namespace status.phase（与集群 Phase 对齐） */
function phaseBadge(phase?: string) {
  const k = String(phase || '').toLowerCase();
  let badgeClass = 'std-badge-default';
  if (k === 'active') badgeClass = 'std-badge-success';
  else if (k === 'terminating') badgeClass = 'std-badge-warning';
  return <span className={`std-badge ${badgeClass}`}>{phase || '-'}</span>;
}

/** Steve `links.view` 或集群级 Namespace API 路径（列表行常无 metadata.namespace） */
function namespaceRowToViewLink(row: unknown): string | undefined {
  const r = row as { links?: { view?: string }; metadata?: { name?: string }; name?: string };
  if (r?.links?.view) return String(r.links.view);
  const n = r?.metadata?.name || r?.name;
  if (n) return `/api/v1/namespaces/${n}`;
  return undefined;
}

const NamespacesSection: React.FC<Props> = ({
  cloudId,
  namespaces = [],
  loading = false,
  onRefresh,
  isTenant,
}) => {
  const hasOpsView = useCloudmapOpsViewWrite();
  const { user } = useAuth();
  const perms = useMemo(() => (user?.permissions ?? []) as string[], [user?.permissions]);
  const hasNamespacesWrite = useMemo(
    () =>
      hasPermissionForAction(perms, 'clouds.namespaces:write') || hasPermissionForAction(perms, 'clouds:write'),
    [perms],
  );
  /** Cloudmap 非运维写视图时不展示 YAML 抽屉入口 */
  const isStandardView = !hasOpsView;

  const [keyword, setKeyword] = useState('');
  /** 创建/编辑项目侧滑表单 */
  const [namespaceFormOpen, setNamespaceFormOpen] = useState(false);
  const [editingNamespace, setEditingNamespace] = useState<unknown>(null);
  /** 类型多选过滤器；空数组表示不按类型筛选 */
  const [filterTypes, setFilterTypes] = useState<string[]>(['public', 'admin']);
  const [filterStatus, setFilterStatus] = useState('');

  const [yamlDrawerOpen, setYamlDrawerOpen] = useState(false);
  const [yamlViewLink, setYamlViewLink] = useState<string | undefined>(undefined);

  const closeNamespaceFormDrawer = useCallback(() => {
    setNamespaceFormOpen(false);
    setEditingNamespace(null);
  }, []);

  const handleOpenYaml = useCallback((record: unknown) => {
    const link = namespaceRowToViewLink(record);
    if (!link) {
      message.warning('当前行缺少 View Link，无法拉取 YAML');
      return;
    }
    setYamlViewLink(link);
    setYamlDrawerOpen(true);
  }, []);

  const handleEdit = useCallback(
    (record: unknown) => {
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
    (record: unknown) => {
      if (!hasNamespacesWrite) {
        message.error('无权限执行该操作');
        return;
      }
      if (!isTenantScenarioNamespace(record)) {
        message.warning('仅允许删除租户项目（须带 tower.io/scenario=tenant）');
        return;
      }
      const row = record as { metadata?: { name?: string }; name?: string };
      const name = String(row?.metadata?.name || row?.name || '').trim();
      if (!name) return;

      Modal.confirm({
        title: '删除项目',
        content: `确定删除命名空间「${name}」吗？删除后不可恢复；请确认集群内已无虚拟机及其他重要资源。`,
        okText: '删除',
        okType: 'danger',
        cancelText: '取消',
        onOk: async () => {
          await deleteHarvesterNamespace(cloudId, name);
          message.success('删除成功');
          clearGetCacheForPath(`/api/clouds/${cloudId}/resources/harvester/namespaces`);
          onRefresh?.(true, true);
        },
      });
    },
    [cloudId, hasNamespacesWrite, onRefresh],
  );

  /** 表格数据：先排除系统命名空间 → 类型并集筛选 → Phase → 名称/标签关键字 */
  const filtered = useMemo(() => {
    let res = Array.isArray(namespaces) ? namespaces : [];
    res = res.filter((row) => namespaceSectionType(row) !== 'system');

    const typeFilters = filterTypes.filter((t) => t !== 'system');
    if (typeFilters.length > 0) {
      res = res.filter((row) => typeFilters.includes(namespaceSectionType(row)));
    }

    if (filterStatus) {
      res = res.filter((row) => {
        const r = row as { status?: { phase?: string } };
        const phase = r?.status?.phase || 'Unknown';
        return phase === filterStatus;
      });
    }

    const kw = keyword.trim().toLowerCase();
    if (!kw) return res;

    return res.filter((row) => {
      const r = row as {
        metadata?: { name?: string; labels?: Record<string, unknown> };
        name?: string;
      };
      const name = String(r?.metadata?.name || r?.name || '').toLowerCase();
      const labels = r?.metadata?.labels || {};
      const labelKeys = Object.keys(labels || {}).map((k) => k.toLowerCase());
      return name.includes(kw) || labelKeys.some((k) => k.includes(kw));
    });
  }, [namespaces, keyword, filterTypes, filterStatus]);

  const allColumns = useMemo(
    () => [
      {
        title: '名称',
        dataIndex: 'name',
        key: 'name',
        fixed: 'left' as const,
        render: (_: unknown, r: unknown) => {
          const row = r as { metadata?: { name?: string }; name?: string };
          return (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <FolderOpenTwoTone />
              <span>{row?.metadata?.name || row?.name}</span>
            </span>
          );
        },
      },
      {
        title: '状态',
        key: 'status',
        render: (_: unknown, r: unknown) => {
          const row = r as { status?: { phase?: string } };
          return phaseBadge(row?.status?.phase);
        },
      },
      {
        title: 'UID',
        dataIndex: ['metadata', 'uid'],
        key: 'uid',
        render: (v: string) => v || '-',
      },
      {
        title: '项目类型',
        key: 'type',
        render: (_: unknown, r: unknown) => {
          const t = namespaceSectionType(r);
          if (t === 'public') {
            return <span className="std-badge std-badge-info">公共</span>;
          }
          if (t === 'admin') {
            return <span className="std-badge std-badge-warning">管理员</span>;
          }
          if (t === 'tenant') {
            return <span className="std-badge std-badge-success">租户</span>;
          }
          return <span className="std-badge std-badge-default">未标注场景</span>;
        },
      },
      {
        title: '标签',
        key: 'labels',
        render: (_: unknown, r: unknown) => {
          const row = r as { metadata?: { labels?: Record<string, string> } };
          const n = Object.keys(row?.metadata?.labels || {}).length;
          return n;
        },
      },
      {
        title: '注解',
        key: 'annotations',
        render: (_: unknown, r: unknown) => {
          const row = r as { metadata?: { annotations?: Record<string, string> } };
          const n = Object.keys(row?.metadata?.annotations || {}).length;
          return n;
        },
      },
      {
        title: 'Finalizers',
        key: 'finalizers',
        render: (_: unknown, r: unknown) => {
          const row = r as { metadata?: { finalizers?: string[] } };
          const n = row?.metadata?.finalizers?.length ?? 0;
          return n;
        },
      },
      {
        title: '创建时间',
        dataIndex: ['metadata', 'creationTimestamp'],
        key: 'creationTimestamp',
        render: (v: string) => v || '-',
      },
      {
        title: '操作',
        key: 'actions',
        align: 'left' as const,
        fixed: 'right' as const,
        render: (_: unknown, r: unknown) => {
          const row = r as { metadata?: { name?: string }; name?: string };
          const name = row?.metadata?.name || row?.name;
          const isSys = isSystemNamespace(String(name ?? ''));
          const items: { key: string; label: string; onClick: () => void; danger?: boolean }[] = [];
          if (!isTenant && !isStandardView) {
            items.push({
              key: 'yaml',
              label: '查看YAML',
              onClick: () => handleOpenYaml(r),
            });
          }
          if (!isSys) {
            items.push({ key: 'edit', label: '编辑项目', onClick: () => handleEdit(r) });
          }
          if (hasNamespacesWrite && !isSys && isTenantScenarioNamespace(r)) {
            items.push({
              key: 'delete',
              label: '删除项目',
              danger: true,
              onClick: () => handleDelete(r),
            });
          }
          return (
            <ResourceActionsDropdown items={items} buttonProps={{ className: 'row-actions-trigger' }} />
          );
        },
      },
    ],
    [handleDelete, handleEdit, handleOpenYaml, hasNamespacesWrite, isStandardView, isTenant],
  );

  const { displayColumns: tableColumns } = useTableColumnSettings(allColumns, TABLE_COLUMNS_SETTINGS_KEY);

  return (
    <PageDetailSection
      asCard={false}
      toolbarLeft={
        <>
          <Input
            allowClear
            placeholder="名称/标签"
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="toolbar-search"
          />
          <Select
            mode="multiple"
            allowClear
            placeholder="项目类型"
            value={filterTypes}
            onChange={(v) => setFilterTypes(v ?? [])}
            maxTagCount="responsive"
            options={[
              { label: '公共', value: 'public' },
              { label: '租户', value: 'tenant' },
              { label: '管理员', value: 'admin' },
              { label: '未标注场景', value: 'unlabeled' },
            ]}
            className="toolbar-filter-sm"
          />
          <Select
            allowClear
            placeholder="项目状态"
            value={filterStatus || undefined}
            onChange={(v) => setFilterStatus(v || '')}
            options={[
              { label: 'Active', value: 'Active' },
              { label: 'Terminating', value: 'Terminating' },
            ]}
            className="toolbar-filter-sm"
          />
          <button
            type="button"
            className="toolbar-reset-btn"
            onClick={() => {
              setKeyword('');
              setFilterTypes(['public', 'admin']);
              setFilterStatus('');
            }}
          >
            重置
          </button>
        </>
      }
      toolbarRight={
        <>
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
            onClick={() => {
              if (onRefresh) {
                try {
                  onRefresh(true);
                } catch (e: unknown) {
                  const err = e as { message?: string };
                  message.error('刷新失败: ' + (err?.message || '未知错误'));
                }
              } else {
                message.warning('刷新功能未配置');
              }
            }}
            loading={loading}
            disabled={loading}
          />
        </>
      }
    >
      <Table
        className="std-table"
        scroll={{ x: true }}
        bordered={false}
        rowKey={(r, index) => {
          const row = r as { metadata?: { uid?: string; name?: string }; name?: string };
          return row?.metadata?.uid || row?.metadata?.name || row?.name || `row-${index}`;
        }}
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
