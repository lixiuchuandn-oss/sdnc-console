/**
 * Harvester 集群 · ClusterNetwork 列表；VlanConfig 在抽屉内展示。
 */
import React, { useCallback, useMemo, useState } from 'react';

import { Badge, Button, Input, Select, Space, Table, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { LayoutTwoTone, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';

import PageDetailSection from 'components/PageDetailSection';
import ResourceActionsDropdown from 'components/ResourceActionsDropdown';
import TableColumnSettingsButton from 'components/TableColumnSettingsButton';
import { useTableColumnSettings } from 'hooks/useTableColumnSettings';
import VlanConfigsDrawer from '../drawers/VlanConfigsDrawer';
import { ResourceLinkYamlDrawer } from '../../shared/components/ResourceLinkYamlDrawer';

const TABLE_SETTINGS_KEY = 'harvester_cluster_networks_table';

const STATUS_FILTER_OPTIONS = [
  { label: 'Active', value: 'active' },
  { label: 'Unknown', value: 'unknown' },
] as const;

type ClusterNetworkRow = {
  metadata?: { name?: string; uid?: string; creationTimestamp?: string; annotations?: Record<string, string> };
  status?: { conditions?: Array<{ type?: string; status?: string }> };
  vlanConfigs?: unknown[];
  links?: { view?: string };
  kind?: string;
};

type Props = {
  clusterNetworks: ClusterNetworkRow[];
  loading: boolean;
  onRefresh?: (force?: boolean) => void;
  cloudId?: string;
  isTenant?: boolean;
};

function isConditionReadyTrue(c: { type?: string; status?: string }): boolean {
  return (
    String(c?.type || '').toLowerCase() === 'ready' && String(c?.status || '').toLowerCase() === 'true'
  );
}

function isClusterNetworkReady(record: ClusterNetworkRow): boolean {
  const conditions = record?.status?.conditions;
  return Array.isArray(conditions) && conditions.some(isConditionReadyTrue);
}

const NetworksSection: React.FC<Props> = ({
  clusterNetworks,
  loading,
  onRefresh,
  cloudId,
  isTenant,
}) => {

  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [yamlDrawerOpen, setYamlDrawerOpen] = useState(false);
  const [yamlViewLink, setYamlViewLink] = useState<string | undefined>();

  const [vlanDrawerOpen, setVlanDrawerOpen] = useState(false);
  const [vlanDrawerCluster, setVlanDrawerCluster] = useState<ClusterNetworkRow | null>(null);

  const openVlanDrawer = useCallback((record: ClusterNetworkRow) => {
    setVlanDrawerCluster(record);
    setVlanDrawerOpen(true);
  }, []);

  const closeVlanDrawer = useCallback(() => {
    setVlanDrawerOpen(false);
    setVlanDrawerCluster(null);
  }, []);

  const handleOpenYaml = useCallback(
    (record: ClusterNetworkRow) => {
      if (!cloudId) {
        message.warning('缺少云实例上下文，无法拉取 YAML');
        return;
      }
      const name = String(record?.metadata?.name || '').trim();
      const existing = record?.links?.view;
      const link = existing
        ? String(existing).trim()
        : name
          ? `/apis/network.harvesterhci.io/v1beta1/clusternetworks/${encodeURIComponent(name)}`
          : undefined;
      if (!link) {
        message.warning('当前行缺少 View Link，无法拉取 YAML');
        return;
      }
      setYamlViewLink(link);
      setYamlDrawerOpen(true);
    },
    [cloudId],
  );

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

  const resetToolbar = useCallback(() => {
    setKeyword('');
    setStatusFilter('');
  }, []);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return (clusterNetworks || []).filter((r: ClusterNetworkRow) => {
      const name = String(r?.metadata?.name || '').toLowerCase();
      if (kw && !name.includes(kw)) return false;

      if (statusFilter) {
        const ready = isClusterNetworkReady(r);
        if (statusFilter === 'active' && !ready) return false;
        if (statusFilter === 'unknown' && ready) return false;
      }

      return true;
    });
  }, [clusterNetworks, keyword, statusFilter]);

  const vlanDrawerTitle = useMemo(() => {
    const n = String(vlanDrawerCluster?.metadata?.name || '').trim();
    return n ? `VlanConfig · ${n}` : 'VlanConfig';
  }, [vlanDrawerCluster]);

  const allColumns = useMemo((): ColumnsType<ClusterNetworkRow> => {
    return [
      {
        title: '名称',
        dataIndex: ['metadata', 'name'],
        key: 'name',
        fixed: 'left',
        render: (text: string | undefined) => (
          <Space align="center" size={6}>
            <LayoutTwoTone />
            <span>{text}</span>
          </Space>
        ),
        sorter: (a, b) =>
          String(a.metadata?.name || '').localeCompare(String(b.metadata?.name || '')),
      },
      {
        title: '状态',
        key: 'status',
        render: (_cell, record) => {
          const ok = isClusterNetworkReady(record);
          return ok ? <Badge status="success" text="Active" /> : <Badge status="default" text="Unknown" />;
        },
      },
      {
        title: 'MTU',
        key: 'mtu',
        render: (_cell, record) =>
          record.metadata?.annotations?.['network.harvesterhci.io/uplink-mtu'] || '—',
      },
      {
        title: '描述',
        key: 'description',
        render: (_cell, record) =>
          record.metadata?.annotations?.['field.cattle.io/description'] || '—',
      },
      {
        title: '创建时间',
        dataIndex: ['metadata', 'creationTimestamp'],
        key: 'age',
        render: (t: string | undefined) =>
          t ? dayjs(t).format('YYYY-MM-DD HH:mm:ss') : '—',
        sorter: (a, b) =>
          new Date(a.metadata?.creationTimestamp || 0).getTime() -
          new Date(b.metadata?.creationTimestamp || 0).getTime(),
      },
      {
        title: '操作',
        key: 'action',
        align: 'left',
        fixed: 'right',
        render: (_cell, record) => {
          const items: { key: string; label: string; onClick: () => void }[] = [];
          items.push({
            key: 'vlanConfigs',
            label: '查看VLAN配置',
            onClick: () => openVlanDrawer(record),
          });
          if (!isTenant) {
            items.push({
              key: 'opsinfo',
              label: '查看YAML',
              onClick: () => handleOpenYaml(record),
            });
          }
          return <ResourceActionsDropdown items={items} />;
        },
      },
    ];
  }, [handleOpenYaml, openVlanDrawer, isTenant]);

  const { displayColumns: tableColumns } = useTableColumnSettings(
    allColumns as ColumnsType<object>,
    TABLE_SETTINGS_KEY,
  );

  const tableKey = `${keyword.trim()}|${statusFilter}`;

  return (
    <PageDetailSection
      asCard={false}
      toolbarLeft={(
        <Space wrap size={[8, 8]}>
          <Input
            allowClear
            placeholder="名称"
            prefix={<SearchOutlined />}
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
          />
          <Select<string>
            allowClear
            placeholder="状态"
            value={statusFilter || undefined}
            onChange={(v?: string | null) => setStatusFilter(v ? String(v) : '')}
            options={[...STATUS_FILTER_OPTIONS]}
          />
          <Button onClick={resetToolbar}>重置</Button>
        </Space>
      )}
      toolbarRight={(
        <Space wrap>
          <TableColumnSettingsButton allColumns={allColumns as never} settingsKey={TABLE_SETTINGS_KEY} />
          <Button
            icon={<ReloadOutlined />}
            onClick={handleToolbarRefresh}
            loading={loading}
            disabled={loading}
          />
        </Space>
      )}
    >
      <Table<ClusterNetworkRow>
        key={tableKey}
        className="std-table"
        scroll={{ x: true }}
        bordered={false}
        rowKey={(r, index) => r.metadata?.uid || r.metadata?.name || `row-${index}`}
        dataSource={filtered}
        columns={tableColumns}
        loading={loading}
        pagination={{
          showTotal: total => `共 ${total} 条`,
        }}
      />

      <VlanConfigsDrawer
        open={vlanDrawerOpen}
        onClose={closeVlanDrawer}
        title={vlanDrawerTitle}
        vlanConfigs={vlanDrawerCluster?.vlanConfigs}
      />

      {cloudId ? (
        <ResourceLinkYamlDrawer
          open={yamlDrawerOpen}
          onClose={() => {
            setYamlDrawerOpen(false);
            setYamlViewLink(undefined);
          }}
          cloudId={cloudId}
          viewLink={yamlViewLink}
          title="集群网络 YAML"
        />
      ) : null}
    </PageDetailSection>
  );
};

export default NetworksSection;
