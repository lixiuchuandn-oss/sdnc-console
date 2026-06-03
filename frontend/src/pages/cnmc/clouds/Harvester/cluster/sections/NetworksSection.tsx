/**
 * Harvester 集群 · ClusterNetwork 列表；VlanConfig 在抽屉内展示。
 */
import React, { useCallback, useMemo, useState } from 'react';

import { Button, Input, Select, Space, Table, message } from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';

import PageDetailSection from 'components/PageDetailSection';
import TableColumnSettingsButton from 'components/TableColumnSettingsButton';
import { useTableColumnSettings } from 'hooks/useTableColumnSettings';
import VlanConfigsDrawer from '../drawers/VlanConfigsDrawer';
import { ResourceLinkYamlDrawer } from '../../shared/components/ResourceLinkYamlDrawer';
import {
  filterClusterNetworksForTable,
  type ClusterNetworkRow,
} from '../lib/networksSectionUtils';
import { createClusterToolbarRefresh } from '../lib/clusterSectionRefresh';
import { buildNetworksTableColumns } from '../lib/networksTableColumns';

const TABLE_SETTINGS_KEY = 'harvester_cluster_networks_table';

const STATUS_FILTER_OPTIONS = [
  { label: 'Active', value: 'active' },
  { label: 'Unknown', value: 'unknown' },
] as const;

type Props = {
  clusterNetworks: ClusterNetworkRow[];
  loading: boolean;
  onRefresh?: (force?: boolean) => void;
  cloudId?: string;
  isTenant?: boolean;
};

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

  const handleToolbarRefresh = useMemo(
    () => createClusterToolbarRefresh(onRefresh),
    [onRefresh],
  );

  const resetToolbar = useCallback(() => {
    setKeyword('');
    setStatusFilter('');
  }, []);

  const filtered = useMemo(
    () => filterClusterNetworksForTable(clusterNetworks, { keyword, statusFilter }),
    [clusterNetworks, keyword, statusFilter],
  );

  const vlanDrawerTitle = useMemo(() => {
    const n = String(vlanDrawerCluster?.metadata?.name || '').trim();
    return n ? `VlanConfig · ${n}` : 'VlanConfig';
  }, [vlanDrawerCluster]);

  const allColumns = useMemo(
    () =>
      buildNetworksTableColumns({
        isTenant,
        onOpenVlanConfigs: openVlanDrawer,
        onOpenYaml: handleOpenYaml,
      }),
    [handleOpenYaml, openVlanDrawer, isTenant],
  );

  const { displayColumns: tableColumns } = useTableColumnSettings(allColumns, TABLE_SETTINGS_KEY);

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
            onChange={(e) => setKeyword(e.target.value)}
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
          <TableColumnSettingsButton allColumns={allColumns} settingsKey={TABLE_SETTINGS_KEY} />
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
          showTotal: (total) => `共 ${total} 条`,
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
          title="集群网络配置"
        />
      ) : null}
    </PageDetailSection>
  );
};

export default NetworksSection;
