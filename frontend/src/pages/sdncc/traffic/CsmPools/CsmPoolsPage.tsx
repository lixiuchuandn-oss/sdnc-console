/**
 * SDN / 流量编排 — CSM 安全资源池列表（不纳入多云「资源池管理」）。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EllipsisOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { Button, Dropdown, Form, Input, Modal, Select, Space, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';

import PageContainer from '../../../../components/PageContainer';
import TableColumnSettingsButton from '../../../../components/TableColumnSettingsButton';
import { useTableColumnSettings } from '../../../../hooks/useTableColumnSettings';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import WriteGuard from '../../../../components/WriteGuard';
import { filterMenuItemsForReadOnly } from '../../../../utils/rbacUi';
import { fetchClouds as fetchCloudsApi, apiDelete } from '../../../../services/api';
import { useAuth } from '../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../utils/accessMapping';
import { routeSpecs } from '../../../../routes/RouteSpec';
import CloudEditModal from '../../../cnmc/clouds/Harvester/ecs/modals/CloudEditModal';
import CsmPoolAccessModal from './modals/CsmPoolAccessModal';
import {
  CLOUD_STATUS_MAP,
  resolvePoolTypeLabel,
  type Cloud,
  getProviderLogo,
  getProviderName,
  isCsmCloud,
} from '../../../cnmc/pools/lib/poolProviders';

const { Text } = Typography;

/** 与 `RouteSpec` 中 `traffic-csm-pools` 对齐：路径、文案、权限均单点维护 */
const trafficCsmPoolsSpec = routeSpecs.find((s) => s.id === 'traffic-csm-pools');
const csmPoolsListPath = trafficCsmPoolsSpec?.path ?? '/admin/security/traffic/csm-pools';
const csmPoolsPageAction = trafficCsmPoolsSpec?.requiredActions?.page ?? null;
const csmPoolsWriteAction = trafficCsmPoolsSpec?.requiredActions?.write ?? null;

/** 与 `useTableColumnSettings` / `TableColumnSettingsButton` 的 localStorage 键一致 */
const CSM_POOLS_TABLE_COL_KEY = 'traffic_csm_pools';

const CsmPoolsPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const perms = user && Array.isArray(user.permissions) ? user.permissions : [];
  const canRead = hasPermissionForAction(perms, csmPoolsPageAction);
  const canWrite = hasPermissionForAction(perms, csmPoolsWriteAction);

  const [clouds, setClouds] = useState<Cloud[]>([]);
  const [loading, setLoading] = useState(false);
  const [wizardVisible, setWizardVisible] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<Cloud | null>(null);
  const [filterForm] = Form.useForm();
  const [filters, setFilters] = useState<Record<string, unknown>>({});
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const raw = await fetchCloudsApi();
      const list = Array.isArray(raw) ? raw : (raw as { data?: Cloud[] })?.data || [];
      setClouds((Array.isArray(list) ? list : []).filter(isCsmCloud));
    } catch (e: unknown) {
      const err = e as { message?: string };
      message.error(err?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const typeFilterOptions = useMemo(() => {
    const seen = new Set<string>();
    const rows: { value: string; label: string }[] = [];
    for (const c of clouds) {
      const t = c.type;
      if (t && !seen.has(t)) {
        seen.add(t);
        rows.push({ value: t, label: resolvePoolTypeLabel(t) });
      }
    }
    return rows.sort((a, b) => a.label.localeCompare(b.label, 'zh-Hans'));
  }, [clouds]);

  const statusOptions = useMemo(
    () =>
      Object.entries(CLOUD_STATUS_MAP).map(([value, label]) => ({
        value,
        label,
      })),
    [],
  );

  const filteredClouds = useMemo(() => {
    let list = clouds;
    const status = filters.status as string | undefined;
    const type = filters.type as string | undefined;
    if (status) {
      list = list.filter((c) => String(c.status || '') === status);
    }
    if (type) {
      list = list.filter((c) => String(c.type || '') === type);
    }
    const k = String(filters.keyword || '').trim().toLowerCase();
    if (!k) return list;
    return list.filter((c) => {
      const name = (c.name || '').toLowerCase();
      const region = (c.region || '').toLowerCase();
      const id = String(c.id || '').toLowerCase();
      return name.includes(k) || region.includes(k) || id.includes(k);
    });
  }, [clouds, filters]);

  /** 与 VmSection 一致：有数据时才设 scroll.x，避免空表出现横向滚动条 */
  const csmPoolsTableScroll = useMemo(
    () => (filteredClouds.length > 0 ? ({ x: true } as const) : undefined),
    [filteredClouds.length],
  );

  const handleBatchDelete = useCallback(() => {
    if (!canWrite || selectedRowKeys.length === 0) return;
    Modal.confirm({
      title: '确认批量删除',
      content: `将删除选中的 ${String(selectedRowKeys.length)} 个 CSM 资源池，相关流量编排配置可能失效且不可恢复。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        let ok = 0;
        let fail = 0;
        for (const id of selectedRowKeys) {
          try {
            await apiDelete(`/api/clouds/${String(id)}`);
            ok++;
          } catch {
            fail++;
          }
        }
        if (ok > 0) message.success(`已删除 ${ok} 个${fail > 0 ? `，${fail} 个失败` : ''}`);
        else if (fail > 0) message.error('删除失败');
        setSelectedRowKeys([]);
        void load();
      },
    });
  }, [canWrite, selectedRowKeys, load]);

  const handleDelete = useCallback(
    (id: string) => {
      if (!canWrite) return;
      Modal.confirm({
        title: '确认删除该 CSM 资源池？',
        content: '删除后不可恢复，相关流量编排配置可能失效。',
        okText: '删除',
        okType: 'danger',
        cancelText: '取消',
        onOk: async () => {
          try {
            await apiDelete(`/api/clouds/${id}`);
            message.success('已删除');
            void load();
          } catch (e: unknown) {
            const err = e as { message?: string };
            message.error(err?.message || '删除失败');
          }
        },
      });
    },
    [canWrite, load],
  );

  const allColumns: ColumnsType<Cloud> = useMemo(
    () => [
      {
        title: '名称',
        dataIndex: 'name',
        key: 'name',
        align: 'left',
        render: (text: string, record) => (
          <Button
            type="link"
            className="cell-link"
            onClick={() => navigate(`${csmPoolsListPath}/${record.id}`)}
          >
            {text}
          </Button>
        ),
      },
      {
        title: '状态',
        dataIndex: 'status',
        key: 'status',
        align: 'left',
        render: (s: string) => CLOUD_STATUS_MAP[s] || s,
      },
      {
        title: '类型',
        dataIndex: 'type',
        key: 'type',
        align: 'left',
        render: (t: string) => <Tag>{resolvePoolTypeLabel(t)}</Tag>,
      },
      {
        title: '厂商',
        key: 'provider',
        align: 'left',
        render: (_: unknown, record) => (
          <Space>
            <span className="table-provider-logo-wrap">
              {getProviderLogo(record.config?.provider, record.type)}
            </span>
            <Text>{getProviderName(record.config?.provider)}</Text>
          </Space>
        ),
      },
      {
        title: '地域',
        dataIndex: 'region',
        key: 'region',
        align: 'left',
      },
      {
        title: '操作',
        key: 'op',
        width: 80,
        align: 'left',
        fixed: 'right',
        render: (_: unknown, record) => (
          <ResourceActionsDropdown
            items={filterMenuItemsForReadOnly(
              [
                { key: 'edit', label: '编辑' },
                { type: 'divider' },
                { key: 'delete', label: '删除', danger: true },
              ],
              canWrite,
            )}
            onClick={({ key }) => {
              if (key === 'edit') {
                setEditing(record);
                setEditOpen(true);
              }
              if (key === 'delete') handleDelete(record.id);
            }}
            buttonProps={{ className: 'row-actions-trigger' }}
          />
        ),
      },
    ],
    [navigate, canWrite, handleDelete, csmPoolsListPath],
  );

  const { displayColumns } = useTableColumnSettings(
    allColumns,
    CSM_POOLS_TABLE_COL_KEY,
    [],
  );

  if (!canRead) {
    return (
      <PageContainer titleLevel={3} asCard={false}>
        <div style={{ padding: 24 }}>
          无访问权限。需要安全服务的读权限
          {csmPoolsPageAction ? `（${csmPoolsPageAction}）` : ''}。
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer
      titleLevel={3}
      asCard={false}
      externalColumnControl
      toolbarRight={
        <div className="toolbar-actions">
          <WriteGuard canWrite={canWrite}>
            <Button type="primary" onClick={() => setWizardVisible(true)}>
              接入资源池
            </Button>
          </WriteGuard>
          {canWrite && (
            <Dropdown
              menu={{
                items: [
                  {
                    key: 'batch-delete',
                    label: '批量删除',
                    danger: true,
                    disabled: selectedRowKeys.length === 0,
                  },
                ],
                onClick: ({ key }) => {
                  if (key === 'batch-delete') void handleBatchDelete();
                },
              }}
            >
              <Button icon={<EllipsisOutlined />} />
            </Dropdown>
          )}
          <TableColumnSettingsButton<Cloud>
            allColumns={allColumns}
            settingsKey={CSM_POOLS_TABLE_COL_KEY}
            defaultHiddenColumns={[]}
          />
          <Button icon={<ReloadOutlined />} onClick={() => void load()} />
        </div>
      }
      toolbarLeft={
        <Form
          form={filterForm}
          className="toolbar-container"
          layout="inline"
          style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
          onValuesChange={(_, all) => setFilters(all)}
        >
          <Form.Item name="keyword" style={{ marginBottom: 0 }}>
            <Input
              allowClear
              placeholder="名称/地域/ID"
              className="toolbar-search"
              suffix={<SearchOutlined />}
            />
          </Form.Item>
          <Form.Item name="status" style={{ marginBottom: 0 }}>
            <Select
              allowClear
              placeholder="状态"
              className="toolbar-filter-sm"
              options={statusOptions}
            />
          </Form.Item>
          <Form.Item name="type" style={{ marginBottom: 0 }}>
            <Select
              allowClear
              placeholder="类型"
              className="toolbar-filter-sm"
              options={typeFilterOptions}
            />
          </Form.Item>
          <button
            type="button"
            className="toolbar-reset-btn"
            onClick={() => {
              filterForm.resetFields();
              setFilters({});
            }}
          >
            重置
          </button>
        </Form>
      }
      tableProps={{
        columns: displayColumns,
        dataSource: filteredClouds,
        loading,
        rowKey: 'id',
        className: 'std-table',
        rowSelection: canWrite
          ? {
              selectedRowKeys,
              onChange: (keys) => setSelectedRowKeys(keys),
              align: 'left',
            }
          : undefined,
        pagination: { size: 'small' as const, showTotal: (t: number) => `共 ${t} 条` },
        scroll: csmPoolsTableScroll,
        bordered: false,
      }}
    >
      <CsmPoolAccessModal
        visible={wizardVisible}
        canWrite={canWrite}
        writeAction={csmPoolsWriteAction}
        onCancel={() => setWizardVisible(false)}
        onSuccess={() => {
          setWizardVisible(false);
          void load();
        }}
      />
      <CloudEditModal
        visible={editOpen}
        cloud={editing}
        onCancel={() => {
          setEditOpen(false);
          setEditing(null);
        }}
        onSuccess={() => {
          setEditOpen(false);
          setEditing(null);
          void load();
        }}
      />
    </PageContainer>
  );
};

export default CsmPoolsPage;
