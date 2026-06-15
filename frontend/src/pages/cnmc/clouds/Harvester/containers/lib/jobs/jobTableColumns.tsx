import React from 'react';
import type { ColumnsType } from 'antd/es/table';
import { Button, Tag, Tooltip } from 'antd';
import { EditTwoTone } from '@ant-design/icons';
import ResourceActionsDropdown from '../../../../../../../components/ResourceActionsDropdown';
import { isSystemResource, getSystemResourceProtectionHint } from '../../../../../../../utils/harvesterUtils';
import { renderJobStatus, calculateAge, formatTime } from './jobHelpers';
import {
  confirmHighRiskDelete,
  confirmHighRiskOperation,
  CONTAINER_DELETE_RISK_ITEMS,
} from '../../../shared/lib/highRiskConfirm';

export type JobTableColumnActions = {
  handleViewDetail: (record: any) => void;
  handleViewYaml: (record: any) => void;
  handleOpenAliasModal: (record: any) => void;
  handleDelete: (record: any) => void;
  handleRetry: (record: any) => void;
  operationsReadOnly: boolean;
};

export function buildJobTableColumns(actions: JobTableColumnActions): ColumnsType<any> {
  const {
    handleViewDetail,
    handleViewYaml,
    handleOpenAliasModal,
    handleDelete,
    handleRetry,
    operationsReadOnly,
  } = actions;
  return [
    {
      title: '名称',
      key: 'name',
      ellipsis: true,
      render: (_: any, record: any) => {
        const alias = record?.metadata?.annotations?.['tower.io/alias'];
        const id = record?.metadata?.name || '';
        const hasAlias = !!alias;
    
        return (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <a onClick={() => handleViewDetail(record)} style={{ color: '#1890ff' }}>{hasAlias ? alias : id}</a>
            <Tooltip title={hasAlias ? '修改别名' : '设置别名'}>
              <Button
                type="text"
                size="small"
                icon={<EditTwoTone />}
                onClick={(e) => {
                  e.stopPropagation();
                  handleOpenAliasModal(record);
                }}
              />
            </Tooltip>
          </span>
        );
      },
    },
    {
      title: 'ID',
      dataIndex: ['metadata', 'name'],
      key: 'id',
      ellipsis: true,
      render: (id: string) => <span style={{ color: '#888', fontSize: 12 }}>{id}</span>,
    },
    {
      title: '项目',
      dataIndex: ['metadata', 'namespace'],
      key: 'namespace',
      ellipsis: true,
      render: (ns: string) => <Tag>{ns}</Tag>,
    },
    {
      title: '状态',
      key: 'status',
      render: (_: any, record: any) => renderJobStatus(record),
    },
    {
      title: '完成数',
      key: 'completions',
      render: (_: any, record: any) => {
        const succeeded = record?.status?.succeeded || 0;
        const completions = record?.spec?.completions || succeeded;
        return `${succeeded}/${completions}`;
      },
    },
    {
      title: '运行时长',
      key: 'age',
      render: (_: any, record: any) => calculateAge(record?.metadata?.creationTimestamp),
    },
    {
      title: '创建时间',
      dataIndex: ['metadata', 'creationTimestamp'],
      key: 'creationTimestamp',
      render: formatTime,
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: any, record: any) => {
        const isSystem = isSystemResource(record);
        const systemHint = getSystemResourceProtectionHint(record);
        const conditions = record?.status?.conditions || [];
        const failedCondition = conditions.find((c: any) => c.type === 'Failed' && c.status === 'True');
        const isFailed = !!failedCondition || (record?.status?.failed > 0);
        
        const itemsAll = [
          {
            key: 'detail',
            label: '详情',
            onClick: () => handleViewDetail(record),
          },
          {
            key: 'yaml',
            label: '查看 YAML',
            onClick: () => handleViewYaml(record),
          },
          ...(isFailed ? [{
            key: 'retry',
            label: '重试',
            disabled: isSystem,
            tooltip: systemHint,
            onClick: () => {
               const alias = record?.metadata?.annotations?.['tower.io/alias'];
               const id = record?.metadata?.name || '';
               const displayName = alias ? `${alias}(${id})` : id;
               void confirmHighRiskOperation({
                 title: '确认重试',
                 description: `确定要重新创建 Job「${displayName}」吗？这将先删除原 Job 并使用相同配置重新创建。`,
                 riskItems: CONTAINER_DELETE_RISK_ITEMS,
                 requireTypeConfirm: false,
                 operationSummary: `重试 Job「${displayName}」`,
                 confirmText: '确认重试',
                 onConfirm: () => handleRetry(record),
               }).catch(() => {});
             },
          }] : []),
          {
            key: 'delete',
            label: '删除',
            danger: true,
            disabled: isSystem,
            tooltip: systemHint,
            onClick: () => {
               const alias = record?.metadata?.annotations?.['tower.io/alias'];
               const id = record?.metadata?.name || '';
               const displayName = alias ? `${alias}(${id})` : id;
               void confirmHighRiskDelete({
                 resourceLabel: 'Job',
                 name: displayName,
                 riskItems: CONTAINER_DELETE_RISK_ITEMS,
                 onConfirm: () => handleDelete(record),
               }).catch(() => {});
             },
          },
        ];
        const items = operationsReadOnly
          ? itemsAll.filter((i) => i.key === 'detail' || i.key === 'yaml')
          : itemsAll;
    
        return <ResourceActionsDropdown items={items} buttonProps={{ className: 'row-actions-trigger' }} />;
      },
    },
  ];
}
