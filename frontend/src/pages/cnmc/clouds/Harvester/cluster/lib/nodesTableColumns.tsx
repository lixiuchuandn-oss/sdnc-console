import React from 'react';
import type { ColumnsType } from 'antd/es/table';
import { Tooltip } from 'antd';
import { DatabaseTwoTone, QuestionCircleOutlined } from '@ant-design/icons';
import ResourceActionsDropdown from 'components/ResourceActionsDropdown';
import {
  NODE_CPU_USAGE_TOOLTIP,
  NODE_MEM_USAGE_TOOLTIP,
  NodeCpuResourceCell,
  NodeMemResourceCell,
} from '../components/NodesSectionCells';
import type { NodesResourceMaps } from '../components/NodesSectionCells';
import type { NodeRow } from './nodesSectionUtils';
import { getRoles, isReady, nodeInternalIp } from './nodesSectionUtils';

export type NodesTableActions = {
  isTenant: boolean;
  resourceMaps: NodesResourceMaps;
  onOpenYaml: (record: NodeRow) => void;
  onOpenNodeDetail: (record: NodeRow) => void;
};

export function buildNodesTableColumns(actions: NodesTableActions): ColumnsType<NodeRow> {
  const { isTenant, resourceMaps, onOpenYaml, onOpenNodeDetail } = actions;

  const opsItems = (record: NodeRow) => {
    const items: { key: string; label: string; onClick: () => void }[] = [];
    if (!isTenant) {
      items.push({
        key: 'yaml',
        label: '查看YAML',
        onClick: () => onOpenYaml(record),
      });
    }
    items.push({
      key: 'detail',
      label: '查看详情',
      onClick: () => onOpenNodeDetail(record),
    });
    return items;
  };

  return [
    {
      title: '名称',
      key: 'name',
      fixed: 'left',
      render: (_cell, row) => {
        const text = row?.name || row?.metadata?.name || '-';
        return (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <DatabaseTwoTone style={{ color: '#1890ff', flexShrink: 0 }} />
            <span role="presentation" className="cell-link" onClick={() => onOpenNodeDetail(row)}>
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
      render: (_cell, row) => nodeInternalIp(row),
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
      render: (_cell, row) => String(row?.architecture || row?.status?.nodeInfo?.architecture || '-'),
    },
    {
      title: '系统镜像',
      key: 'os',
      render: (_cell, row) => String(row?.osImage || row?.status?.nodeInfo?.osImage || '-'),
    },
    {
      title: '内核版本',
      key: 'kernel',
      render: (_cell, row) => String(row?.kernelVersion || row?.status?.nodeInfo?.kernelVersion || '-'),
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
}
