import React from 'react';
import type { ColumnsType } from 'antd/es/table';
import { Button, Tag, Tooltip } from 'antd';
import { ClockCircleOutlined, EditTwoTone } from '@ant-design/icons';
import { parseToChinese } from '../../components/CronExpressionHelper';
import ResourceActionsDropdown from '../../../../../../../components/ResourceActionsDropdown';
import { isSystemResource, getSystemResourceProtectionHint } from '../../../../../../../utils/harvesterUtils';
import { getMacroLabel, renderCronJobStatus, formatTime } from './jobHelpers';
import {
  confirmHighRiskDelete,
  confirmHighRiskOperation,
  CONTAINER_DELETE_RISK_ITEMS,
} from '../../../shared/lib/highRiskConfirm';

export type CronJobTableColumnActions = {
  handleViewDetail: (record: any) => void;
  handleViewYaml: (record: any) => void;
  handleOpenAliasModal: (record: any) => void;
  handleDelete: (record: any) => void;
  handleSuspend: (record: any) => void;
  handleResume: (record: any) => void;
  handleTrigger: (record: any) => void;
  operationsReadOnly: boolean;
};

export function buildCronJobTableColumns(actions: CronJobTableColumnActions): ColumnsType<any> {
  const {
    handleViewDetail,
    handleViewYaml,
    handleOpenAliasModal,
    handleDelete,
    handleSuspend,
    handleResume,
    handleTrigger,
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
      render: (_: any, record: any) => renderCronJobStatus(record),
    },
    {
      title: '调度计划',
      dataIndex: ['spec', 'schedule'],
      key: 'schedule',
      render: (schedule: string) => {
        const macroLabel = getMacroLabel(schedule);
        const chineseDesc = parseToChinese(schedule);
        const displayText = macroLabel || schedule;
        const fullText = chineseDesc ? `${schedule}（${chineseDesc}）` : schedule;
        return (
          <Tooltip title={fullText}>
            <Tag icon={<ClockCircleOutlined />}>
              {displayText}{chineseDesc && !macroLabel ? `（${chineseDesc}）` : ''}
            </Tag>
          </Tooltip>
        );
      },
    },
    {
      title: '最后一次执行',
      dataIndex: ['status', 'lastScheduleTime'],
      key: 'lastScheduleTime',
      render: formatTime,
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
        const isSuspended = record?.spec?.suspend;
        const alias = record?.metadata?.annotations?.['tower.io/alias'];
        const id = record?.metadata?.name || '';
        const displayName = alias ? `${alias}(${id})` : id;
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
          {
            key: 'trigger',
            label: '立即执行',
            disabled: isSystem,
            tooltip: systemHint,
            onClick: () => {
               void confirmHighRiskOperation({
                 title: '确认执行',
                 description: `确定要立即触发 CronJob「${displayName}」吗？`,
                 riskItems: [
                   '将立即创建一次 Job 执行任务，可能对生产负载产生瞬时压力。',
                   '若任务有副作用（写库、发消息等），请确认可重复执行或幂等。',
                 ],
                 requireTypeConfirm: false,
                 operationSummary: `立即执行 CronJob「${displayName}」`,
                 confirmText: '确认执行',
                 onConfirm: () => handleTrigger(record),
               }).catch(() => {});
             },
          },
          isSuspended ? {
            key: 'resume',
            label: '恢复',
            disabled: isSystem,
            tooltip: systemHint,
             onClick: () => {
               void confirmHighRiskOperation({
                 title: '确认恢复',
                 description: `确定要恢复 CronJob「${displayName}」吗？`,
                 riskItems: [
                   '恢复后将按调度计划继续自动创建 Job。',
                   '请确认调度表达式与资源配额符合预期。',
                 ],
                 requireTypeConfirm: false,
                 operationSummary: `恢复 CronJob「${displayName}」`,
                 confirmText: '确认恢复',
                 onConfirm: () => handleResume(record),
               }).catch(() => {});
             },
          } : {
            key: 'suspend',
            label: '暂停',
            disabled: isSystem,
            tooltip: systemHint,
             onClick: () => {
               void confirmHighRiskOperation({
                 title: '确认暂停',
                 description: `确定要暂停 CronJob「${displayName}」吗？`,
                 riskItems: [
                   '暂停后将不再按调度计划自动创建 Job。',
                   '已在运行中的 Job 不会因此终止。',
                 ],
                 requireTypeConfirm: false,
                 operationSummary: `暂停 CronJob「${displayName}」`,
                 confirmText: '确认暂停',
                 onConfirm: () => handleSuspend(record),
               }).catch(() => {});
             },
          },
          {
            key: 'delete',
            label: '删除',
            danger: true,
            disabled: isSystem,
            tooltip: systemHint,
            onClick: () => {
               void confirmHighRiskDelete({
                 resourceLabel: 'CronJob',
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
