/**
 * Harvester - 节点 (Node) 列表 Section
 * 展示 Kubernetes/Harvester 集群中的 Node 资源，
 * 支持：过滤、metrics 使用率、运维视图 YAML（ResourceLinkYamlDrawer）
 */
import React, { useCallback, useMemo, useState } from 'react';

import {
  Button,
  Input,
  Select,
  Space,
  Table,
  Tooltip,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  DatabaseTwoTone,
  QuestionCircleOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons';

import PageDetailSection from '../../../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../../../components/ResourceActionsDropdown';
import TableColumnSettingsButton from '../../../../../../components/TableColumnSettingsButton';
import { useTableColumnSettings } from '../../../../../../hooks/useTableColumnSettings';
import PhysicalNodeDetailDrawer from '../drawers/PhysicalNodeDetailDrawer';
import { ResourceLinkYamlDrawer } from '../../shared/components/ResourceLinkYamlDrawer';
import { useNodesResourceBundle } from '../hooks/useNodesResourceBundle';

import {
  NODE_CPU_USAGE_TOOLTIP,
  NODE_MEM_USAGE_TOOLTIP,
  NodeCpuResourceCell,
  NodeMemResourceCell,
} from '../components/NodesSectionCells';
import type { NodesResourceMaps } from '../components/NodesSectionCells';
import type { NodeRow } from '../lib/nodesSectionUtils';
import { getRoles, isReady, nodeRowToViewLink } from '../lib/nodesSectionUtils';

const COLUMN_SETTINGS_KEY = 'harvester_nodes_table';

export type Props = {
  nodes: NodeRow[];
  loading: boolean;
  onRefresh?: (force?: boolean) => void;
  cloudId?: string;
  isTenant?: boolean;
};

type NodeTableRecord = NodeRow;

function nodeRowKey(row: NodeRow, index: number): string {
  const r = row as NodeRow & { metadata?: { uid?: string } };
  const key =
    String(r?.metadata?.uid || r?.metadata?.name || r?.name || '') ||
    `row-${Number.isFinite(index) ? index : 0}`;
  return key;
}

function internalIp(row: NodeRow): string {
  const r = row;
  return (
    r?.internalIP ||
    r?.status?.addresses?.find(a => String(a?.type) === 'InternalIP')?.address ||
    '-'
  );
}

const NodesSection: React.FC<Props> = ({ nodes, loading, onRefresh, cloudId, isTenant = false }) => {

  const [keyword, setKeyword] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [readyFilter, setReadyFilter] = useState('');

  const [nodeDetailOpen, setNodeDetailOpen] = useState(false);
  const [nodeDetailRecord, setNodeDetailRecord] = useState<NodeRow | null>(null);

  const [yamlDrawerOpen, setYamlDrawerOpen] = useState(false);
  const [yamlViewLink, setYamlViewLink] = useState<string | undefined>();

  const { metricsMap, requestsMap, nodesDetailMap, resourceLoading } = useNodesResourceBundle({
    cloudId,
    nodesLoading: loading,
    nodesLength: nodes?.length ?? 0,
  });

  const resourceMaps: NodesResourceMaps = useMemo(
    () => ({
      resourceLoading,
      metricsMap,
      requestsMap,
      nodesDetailMap,
    }),
    [metricsMap, nodesDetailMap, requestsMap, resourceLoading],
  );

  const handleOpenYaml = useCallback(
    (record: unknown) => {
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

  const handleOpenNodeDetail = useCallback((record: unknown) => {
    setNodeDetailRecord(record as NodeRow);
    setNodeDetailOpen(true);
  }, []);

  const roleOptions = useMemo(() => {
    const set = new Set<string>();
    for (const n of nodes || []) {
      for (const r of getRoles(n)) set.add(r);
    }
    return Array.from(set).map(x => ({ label: x, value: x }));
  }, [nodes]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const role = roleFilter.trim().toLowerCase();
    const rf = readyFilter.trim().toLowerCase();
    return (nodes || []).filter(r => {
      const name = String(r?.name || r?.metadata?.name || '').toLowerCase();
      if (kw && !name.includes(kw)) return false;
      if (role) {
        const rolesLower = getRoles(r).map(s => s.toLowerCase());
        if (!rolesLower.includes(role)) return false;
      }
      if (rf) {
        const ok = isReady(r);
        if (rf === 'ready' && !ok) return false;
        if (rf === 'notready' && ok) return false;
      }
      return true;
    });
  }, [nodes, keyword, roleFilter, readyFilter]);

  const allColumns = useMemo((): ColumnsType<NodeTableRecord> => {
    const opsItems = (record: NodeRow) => {
      const items: { key: string; label: string; onClick: () => void }[] = [];
      if (!isTenant) items.push({
        key: 'yaml',
        label: '查看YAML',
        onClick: () => handleOpenYaml(record),
      });
      items.push({
        key: 'detail',
        label: '查看详情',
        onClick: () => handleOpenNodeDetail(record),
      });
      return items;
    };

    return [
      {
        title: '名称',
        key: 'name',
        fixed: 'left',
        render: (_cell, row) => {
          const r = row;
          const text = r?.name || r?.metadata?.name || '-';
          return (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <DatabaseTwoTone style={{ color: '#1890ff', flexShrink: 0 }} />
              <span
                role="presentation"
                className="cell-link"
                onClick={() => handleOpenNodeDetail(r)}
              >
                {text}
              </span>
            </span>
          );
        },
      },
      {
        title: '角色',
        key: 'roles',
        render: (_cell, row) => {
          const roles = getRoles(row);
          const text = roles.join(', ') || '-';
          return (
            <Tooltip title={text}>
              <span className="tags-badge">{text}</span>
            </Tooltip>
          );
        },
      },
      {
        title: '内网IP',
        key: 'inip',
        render: (_cell, row) => internalIp(row),
      },
      {
        title: '就绪',
        key: 'ready',
        render: (_cell, row) => {
          const ok = isReady(row);
          return (
            <span className={`std-badge ${ok ? 'std-badge-success' : 'std-badge-error'}`}>
              {ok ? 'Ready' : 'NotReady'}
            </span>
          );
        },
      },
      {
        title: (
          <span>
            CPU
            <Tooltip title={NODE_CPU_USAGE_TOOLTIP} placement="top">
              <QuestionCircleOutlined
                style={{ marginLeft: 4, color: '#999', fontSize: 12, cursor: 'help' }}
              />
            </Tooltip>
          </span>
        ),
        key: 'cpu',
        render: (_cell, row) => <NodeCpuResourceCell row={row} maps={resourceMaps} />,
      },
      {
        title: (
          <span>
            内存
            <Tooltip title={NODE_MEM_USAGE_TOOLTIP} placement="top">
              <QuestionCircleOutlined
                style={{ marginLeft: 4, color: '#999', fontSize: 12, cursor: 'help' }}
              />
            </Tooltip>
          </span>
        ),
        key: 'mem',
        render: (_cell, row) => <NodeMemResourceCell row={row} maps={resourceMaps} />,
      },
      {
        title: '架构',
        key: 'arch',
        render: (_cell, row) =>
          String(row?.architecture || row?.status?.nodeInfo?.architecture || '-'),
      },
      {
        title: '系统镜像',
        key: 'os',
        render: (_cell, row) =>
          String(row?.osImage || row?.status?.nodeInfo?.osImage || '-'),
      },
      {
        title: '内核版本',
        key: 'kernel',
        render: (_cell, row) =>
          String(
            row?.kernelVersion || row?.status?.nodeInfo?.kernelVersion || '-',
          ),
      },
      {
        title: '操作',
        key: 'actions',
        fixed: 'right',
        render: (_cell, row) => (
          <ResourceActionsDropdown buttonProps={{ className: 'row-actions-trigger' }} items={opsItems(row)} />
        ),
      },
    ];
  }, [
    handleOpenNodeDetail,
    handleOpenYaml,
    isTenant,
    resourceMaps,
  ]);

  const { displayColumns: tableColumns } = useTableColumnSettings(allColumns, COLUMN_SETTINGS_KEY);

  const resetToolbarFilters = useCallback(() => {
    setKeyword('');
    setRoleFilter('');
    setReadyFilter('');
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
            onChange={e => setKeyword(e.target.value)}
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
            loading={loading}
            disabled={loading}
          />
        </div>
      )}
      refreshLoading={loading}
    >
      <Table<NodeTableRecord>
        key={`${keyword}|${roleFilter}|${readyFilter}`}
        className="std-table"
        scroll={{ x: true }}
        bordered={false}
        rowKey={(r, i) =>
          nodeRowKey(r as NodeRow, typeof i === 'number' && Number.isFinite(i) ? i : 0)}
        columns={tableColumns}
        dataSource={filtered}
        loading={loading}
        pagination={{
          showTotal: total => `共 ${total} 条`,
        }}
      />
      <PhysicalNodeDetailDrawer
        open={nodeDetailOpen}
        onClose={() => setNodeDetailOpen(false)}
        record={nodeDetailRecord}
        metrics={metricsMap[String(nodeDetailRecord?.name || nodeDetailRecord?.metadata?.name || '')]}
        onRefreshFromCluster={onRefresh}
        refreshLoading={loading}
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
