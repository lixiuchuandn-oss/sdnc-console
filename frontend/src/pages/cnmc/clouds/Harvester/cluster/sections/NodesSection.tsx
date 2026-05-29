/**
 * Harvester - 节点 (Node) 列表 Section
 */
import React, { useCallback, useMemo, useState } from 'react';

import { Button, Input, Select, Space, Table, message } from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';

import PageDetailSection from 'components/PageDetailSection';
import TableColumnSettingsButton from 'components/TableColumnSettingsButton';
import { useTableColumnSettings } from 'hooks/useTableColumnSettings';
import PhysicalNodeDetailDrawer from '../drawers/PhysicalNodeDetailDrawer';
import { ResourceLinkYamlDrawer } from '../../shared/components/ResourceLinkYamlDrawer';
import { useNodesResourceBundle } from '../hooks/useNodesResourceBundle';
import type { NodesResourceMaps } from '../components/NodesSectionCells';
import type { NodeRow } from '../lib/nodesSectionUtils';
import {
  buildNodeRoleFilterOptions,
  filterNodesForTable,
  nodeRowKey,
  nodeRowToViewLink,
} from '../lib/nodesSectionUtils';
import {
  createClusterToolbarRefresh,
  runHarvesterSectionRefresh,
} from '../lib/clusterSectionRefresh';
import { buildNodesTableColumns } from '../lib/nodesTableColumns';

const COLUMN_SETTINGS_KEY = 'harvester_nodes_table';

export type Props = {
  nodes: NodeRow[];
  loading: boolean;
  onRefresh?: (force?: boolean) => void;
  cloudId?: string;
  isTenant?: boolean;
};

const NodesSection: React.FC<Props> = ({ nodes, loading, onRefresh, cloudId, isTenant = false }) => {
  const [keyword, setKeyword] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [readyFilter, setReadyFilter] = useState('');

  const [nodeDetailOpen, setNodeDetailOpen] = useState(false);
  const [nodeDetailRecord, setNodeDetailRecord] = useState<NodeRow | null>(null);

  const [yamlDrawerOpen, setYamlDrawerOpen] = useState(false);
  const [yamlViewLink, setYamlViewLink] = useState<string | undefined>();

  const { metricsMap, requestsMap, nodesDetailMap, resourceLoading, reload } = useNodesResourceBundle({
    cloudId,
    nodesLoading: loading,
    nodesLength: nodes?.length ?? 0,
  });

  // 指标（CPU/内存等）首批就绪后，后台刷新/轮询保留旧值，避免单元格反复闪 Spin
  const metricsReady = Object.keys(metricsMap).length > 0;
  const resourceMaps: NodesResourceMaps = useMemo(
    () => ({
      resourceLoading: resourceLoading && !metricsReady,
      metricsMap,
      requestsMap,
      nodesDetailMap,
    }),
    [metricsMap, metricsReady, nodesDetailMap, requestsMap, resourceLoading],
  );

  const handleOpenYaml = useCallback(
    (record: NodeRow) => {
      if (!cloudId) {
        message.warning('缺少云实例上下文，无法拉取 YAML');
        return;
      }
      const link = nodeRowToViewLink(record);
      if (!link) {
        message.warning('当前行缺少 View Link，无法拉取 YAML');
        return;
      }
      setYamlViewLink(link);
      setYamlDrawerOpen(true);
    },
    [cloudId],
  );

  const handleOpenNodeDetail = useCallback((record: NodeRow) => {
    setNodeDetailRecord(record);
    setNodeDetailOpen(true);
  }, []);

  const roleOptions = useMemo(() => buildNodeRoleFilterOptions(nodes), [nodes]);

  const filtered = useMemo(
    () => filterNodesForTable(nodes, { keyword, roleFilter, readyFilter }),
    [nodes, keyword, roleFilter, readyFilter],
  );

  const allColumns = useMemo(
    () =>
      buildNodesTableColumns({
        isTenant,
        resourceMaps,
        onOpenYaml: handleOpenYaml,
        onOpenNodeDetail: handleOpenNodeDetail,
      }),
    [handleOpenNodeDetail, handleOpenYaml, isTenant, resourceMaps],
  );

  const { displayColumns: tableColumns } = useTableColumnSettings(allColumns, COLUMN_SETTINGS_KEY);

  const resetToolbarFilters = useCallback(() => {
    setKeyword('');
    setRoleFilter('');
    setReadyFilter('');
  }, []);

  const handleToolbarRefresh = useMemo(
    () => createClusterToolbarRefresh(onRefresh, { before: () => reload(true) }),
    [onRefresh, reload],
  );

  // 表格遮罩只反映「节点列表」加载；指标(bundle)加载只驱动单元格内 Spin，
  // 避免整表遮罩与单元格 Spin 叠成两层，也避免指标轮询时整表被遮罩盖住「刷不出来」
  const listLoading = loading;
  const tableLoading = loading || resourceLoading;

  return (
    <PageDetailSection
      asCard={false}
      autoStyleInputs={false}
      toolbarLeft={(
        <Space wrap size={[8, 8]}>
          <Input
            allowClear
            placeholder="名称/IP"
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="toolbar-search"
          />
          <Select<string>
            allowClear
            placeholder="节点角色"
            value={roleFilter || undefined}
            onChange={(v?: string | null) => setRoleFilter(v || '')}
            className="toolbar-filter-sm"
            options={roleOptions}
          />
          <Select<string>
            allowClear
            placeholder="就绪状态"
            value={readyFilter || undefined}
            onChange={(v?: string | null) => setReadyFilter(v || '')}
            className="toolbar-filter-sm"
            options={[
              { value: 'ready', label: '就绪' },
              { value: 'notready', label: '未就绪' },
            ]}
          />
          <button type="button" className="toolbar-reset-btn" onClick={resetToolbarFilters}>
            重置
          </button>
        </Space>
      )}
      toolbarRight={(
        <div className="toolbar-actions">
          <TableColumnSettingsButton allColumns={allColumns} settingsKey={COLUMN_SETTINGS_KEY} />
          <Button
            icon={<ReloadOutlined />}
            onClick={handleToolbarRefresh}
            loading={listLoading}
            disabled={listLoading}
          />
        </div>
      )}
      refreshLoading={tableLoading}
    >
      <Table<NodeRow>
        key={`${keyword}|${roleFilter}|${readyFilter}`}
        className="std-table"
        scroll={{ x: true }}
        bordered={false}
        rowKey={(r, i) => nodeRowKey(r, typeof i === 'number' && Number.isFinite(i) ? i : 0)}
        columns={tableColumns}
        dataSource={filtered}
        loading={listLoading}
        pagination={{
          showTotal: (total) => `共 ${total} 条`,
        }}
      />
      <PhysicalNodeDetailDrawer
        open={nodeDetailOpen}
        onClose={() => setNodeDetailOpen(false)}
        record={nodeDetailRecord}
        metrics={metricsMap[String(nodeDetailRecord?.name || nodeDetailRecord?.metadata?.name || '')]}
        onRefreshFromCluster={(force) => {
          reload(!!force);
          void runHarvesterSectionRefresh(onRefresh, { force: force !== false });
        }}
        refreshLoading={tableLoading}
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
          title="节点 YAML"
        />
      ) : null}
    </PageDetailSection>
  );
};

export default NodesSection;
