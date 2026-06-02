import React from 'react';
import type { ColumnsType } from 'antd/es/table';
import { Tag } from 'antd';
import ResourceActionsDropdown, {
  type ResourceActionItem,
} from 'components/ResourceActionsDropdown';
import {
  formatMetricRuleCreatedAt,
  metricRuleRowFields,
  type MetricRuleTableRow,
} from './drsMetricRuleUtils';

export type MetricRulesTableActions = {
  canManage: boolean;
  onOpenYaml: (record: MetricRuleTableRow) => void;
  onEdit: (record: MetricRuleTableRow) => void;
  onDelete: (record: MetricRuleTableRow) => void;
};

export function buildMetricRulesTableColumns(
  actions?: MetricRulesTableActions,
): ColumnsType<MetricRuleTableRow> {
  const base: ColumnsType<MetricRuleTableRow> = [
    {
      title: '规则名称',
      key: 'name',
      fixed: 'left',
      render: (_: unknown, r: MetricRuleTableRow) => metricRuleRowFields.name(r),
    },
    {
      title: '作用域',
      key: 'scope',
      render: () => <Tag>集群</Tag>,
    },
    {
      title: '指标类型',
      key: 'metricType',
      render: (_: unknown, r: MetricRuleTableRow) => metricRuleRowFields.metricType(r),
    },
    {
      title: '安全阈值',
      key: 'metricSafeThreshold',
      render: (_: unknown, r: MetricRuleTableRow) => metricRuleRowFields.metricSafeThreshold(r),
    },
    {
      title: '最大迁移 VM 数',
      key: 'migrateMaxCount',
      render: (_: unknown, r: MetricRuleTableRow) => metricRuleRowFields.migrateMaxCount(r),
    },
    {
      title: '并发迁移数',
      key: 'migrateConcurrentNum',
      render: (_: unknown, r: MetricRuleTableRow) =>
        metricRuleRowFields.migrateConcurrentNum(r),
    },
    {
      title: '目标 TopN 随机',
      key: 'randTopN',
      render: (_: unknown, r: MetricRuleTableRow) => metricRuleRowFields.randTopN(r),
    },
    {
      title: '创建时间',
      key: 'createdAt',
      className: 'std-time',
      render: (_: unknown, r: MetricRuleTableRow) => formatMetricRuleCreatedAt(r),
    },
  ];

  if (!actions) {
    return base;
  }

  return [
    ...base,
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      render: (_: unknown, r: MetricRuleTableRow) => {
        const items: ResourceActionItem[] = [
          { key: 'yaml', label: '查看 YAML', onClick: () => actions.onOpenYaml(r) },
        ];
        if (actions.canManage) {
          items.push(
            { key: 'edit', label: '编辑', onClick: () => actions.onEdit(r) },
            { key: 'delete', label: '删除', danger: true, onClick: () => actions.onDelete(r) },
          );
        }
        return <ResourceActionsDropdown items={items} />;
      },
    },
  ];
}
