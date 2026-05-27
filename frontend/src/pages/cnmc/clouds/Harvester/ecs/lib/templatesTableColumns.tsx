import React from 'react';
import type { ColumnsType } from 'antd/es/table';
import { Tag, Tooltip } from 'antd';
import { CheckCircleTwoTone } from '@ant-design/icons';
import dayjs from 'dayjs';
import ResourceActionsDropdown from 'components/ResourceActionsDropdown';
import {
  getTemplateDefaultVersion,
  getTemplateDescription,
  getTemplateDisplayName,
  getTemplateLatestVersion,
  getTemplateName,
  getTemplateNamespace,
  getTemplateScope,
} from './templatesSectionUtils';

export const HARVESTER_TEMPLATES_TABLE_SETTINGS_KEY = 'harvester_templates_table';

export type TemplatesTableActions = {
  isTenant: boolean;
  hasTemplatesWrite: boolean;
  isPublicNamespace: (name: string) => boolean;
  onOpenDrawer: (record: any) => void;
  onOpenYaml: (record: any) => void;
  onQuickCreate: (record: any) => void;
  onDelete: (record: any) => void;
};

export function buildTemplatesTableColumns(
  actions: TemplatesTableActions,
): ColumnsType<any> {
  const {
    isTenant,
    hasTemplatesWrite,
    isPublicNamespace,
    onOpenDrawer,
    onOpenYaml,
    onQuickCreate,
    onDelete,
  } = actions;

  return [
    {
      title: '模板名称',
      key: 'displayName',
      fixed: 'left',
      render: (_: any, r: any) => {
        const displayName = getTemplateDisplayName(r);
        return (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, maxWidth: '100%' }}>
            <CheckCircleTwoTone />
            <span
              className="cell-link"
              style={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}
              onClick={() => onOpenDrawer(r)}
            >
              {displayName}
            </span>
          </span>
        );
      },
    },
    {
      title: '模板ID',
      key: 'name',
      render: (_: any, r: any) => getTemplateName(r) || '-',
    },
    {
      title: '版本',
      key: 'version',
      render: (_: any, r: any) => {
        const defaultVersion = getTemplateDefaultVersion(r);
        const latestVersion = getTemplateLatestVersion(r);
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Tag color="blue">默认: {defaultVersion}</Tag>
            <span>最新: {latestVersion}</span>
          </div>
        );
      },
    },
    ...(!isTenant
      ? [
          {
            title: '作用域',
            key: 'scope',
            render: (_: any, r: any) => {
              const scope = getTemplateScope(r, isPublicNamespace);
              const isPublic = scope === '公共模板';
              return <Tag color={isPublic ? 'orange' : 'cyan'}>{scope}</Tag>;
            },
          },
        ]
      : []),
    ...(!isTenant
      ? [
          {
            title: '命名空间',
            key: 'namespace',
            render: (_: any, r: any) => getTemplateNamespace(r) || '-',
          },
        ]
      : []),
    {
      title: '描述',
      key: 'description',
      ellipsis: true,
      render: (_: any, r: any) => (
        <Tooltip title={getTemplateDescription(r)} placement="topLeft">
          <span>{getTemplateDescription(r) || '-'}</span>
        </Tooltip>
      ),
    },
    {
      title: '创建时间',
      key: 'createdAt',
      className: 'std-time',
      sorter: (a: any, b: any) => {
        const t1 = a.metadata?.creationTimestamp || '';
        const t2 = b.metadata?.creationTimestamp || '';
        return t1.localeCompare(t2);
      },
      render: (_: any, r: any) => {
        const t = r.metadata?.creationTimestamp;
        return t ? dayjs(t).format('YYYY-MM-DD HH:mm:ss') : '-';
      },
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      render: (_: any, r: any) => {
        const items: any[] = [
          { key: 'detail', label: '资源详情', onClick: () => onOpenDrawer(r) },
        ];
        if (!isTenant) {
          items.push({
            key: 'view_yaml',
            label: '查看YAML',
            onClick: () => onOpenYaml(r),
          });
        }
        items.push({
          key: 'create_vm',
          label: '使用模板创建虚拟机',
          disabled: !hasTemplatesWrite,
          onClick: () => onQuickCreate(r),
        });
        items.push(
          { type: 'divider' as const },
          {
            key: 'delete',
            label: '删除',
            danger: true,
            disabled: !hasTemplatesWrite,
            onClick: () => onDelete(r),
          },
        );
        return (
          <ResourceActionsDropdown
            items={items}
            buttonProps={{ className: 'row-actions-trigger', style: { margin: 0 } }}
          />
        );
      },
    },
  ];
}
