import React from 'react';
import type { ColumnsType } from 'antd/es/table';
import { Tag } from 'antd';
import type { HmsSwitchCr } from '../../../../../../services/harvesterApi';
import ResourceActionsDropdown from '../../../../../../components/ResourceActionsDropdown';
import {
  HmsProbeDimTag,
  resolveHmsProbeDimState,
  switchProbeProductModel,
} from './hmsSwitchProbeStatus';
import type { SwitchTableRow } from './physicalSwitchesSectionUtils';

export type PhysicalSwitchesTableActions = {
  canRead: boolean;
  canManageSwitchCr: boolean;
  onDetail: (cr: HmsSwitchCr) => void;
  onYaml: (cr: HmsSwitchCr) => void;
  onEdit: (cr: HmsSwitchCr) => void;
  onDelete: (cr: HmsSwitchCr) => void;
};

export function buildPhysicalSwitchesTableColumns(
  actions: PhysicalSwitchesTableActions,
): ColumnsType<SwitchTableRow> {
  const { canRead, canManageSwitchCr, onDetail, onYaml, onEdit, onDelete } = actions;

  return [
    {
      title: '配置名称',
      key: 'name',
      fixed: 'left',
      render: (_: unknown, r) => r.metadata?.name || '—',
    },
    {
      title: '管理地址',
      key: 'primaryHost',
      render: (_: unknown, r) => r.spec?.primaryHost || r.spec?.hosts?.[0] || '—',
    },
    {
      title: '厂商',
      key: 'vendor',
      render: (_: unknown, r) => r.spec?.vendor || '—',
    },
    {
      title: '设备模板',
      key: 'deviceProfile',
      ellipsis: true,
      render: (_: unknown, r) => r.spec?.deviceProfile || '—',
    },
    {
      title: 'SSH',
      key: 'ssh',
      render: (_: unknown, r) => `${r.spec?.user || 'root'}@${r.spec?.port ?? 22}`,
    },
    {
      title: 'HSM 匹配',
      key: 'probeMatch',
      render: (_: unknown, r) =>
        r._probe ? <Tag color="success">已匹配</Tag> : <Tag>未匹配</Tag>,
    },
    {
      title: '基本信息',
      key: 'probeInfo',
      render: (_: unknown, r) => (
        <HmsProbeDimTag
          state={resolveHmsProbeDimState(r._probe, {
            errorKey: 'infoError',
            dataKey: 'info',
          })}
        />
      ),
    },
    {
      title: '接口状态',
      key: 'probeIf',
      render: (_: unknown, r) => (
        <HmsProbeDimTag
          state={resolveHmsProbeDimState(r._probe, {
            errorKey: 'interfacesError',
            dataKey: 'interfaces',
          })}
        />
      ),
    },
    {
      title: '性能探测',
      key: 'probePerf',
      render: (_: unknown, r) => (
        <HmsProbeDimTag
          state={resolveHmsProbeDimState(r._probe, {
            errorKey: 'performanceError',
            dataKey: 'performance',
            naKey: 'performanceNotApplicable',
          })}
          naLabel="未配置"
        />
      ),
    },
    {
      title: '型号',
      key: 'probeModel',
      ellipsis: true,
      render: (_: unknown, r) => switchProbeProductModel(r._probe) || '—',
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      render: (_: unknown, r) => {
        const items: Array<{
          key: string;
          label: string;
          onClick: () => void;
          danger?: boolean;
        }> = [];
        if (canRead) {
          items.push(
            { key: 'detail', label: '查看详情', onClick: () => onDetail(r) },
            { key: 'yaml-view', label: '查看 YAML', onClick: () => onYaml(r) },
          );
        }
        if (canManageSwitchCr) {
          items.push(
            { key: 'edit', label: '编辑交换机', onClick: () => onEdit(r) },
            { key: 'delete', label: '删除', danger: true, onClick: () => onDelete(r) },
          );
        }
        if (!items.length) return '—';
        return (
          <ResourceActionsDropdown
            items={items}
            buttonProps={{ className: 'row-actions-trigger' }}
          />
        );
      },
    },
  ];
}
