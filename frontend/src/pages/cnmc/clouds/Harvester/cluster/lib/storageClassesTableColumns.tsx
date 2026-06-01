import React from 'react';
import type { ColumnsType } from 'antd/es/table';
import { PieChartTwoTone } from '@ant-design/icons';
import ResourceActionsDropdown from 'components/ResourceActionsDropdown';
import type { StorageClassRow } from 'services/harvester/types/inventoryRows';
import { storageClassBackendPoolLabel } from './storageClassesSectionUtils';

export type StorageClassesTableActions = {
  isTenant?: boolean;
  onOpenOpsinfo: (record: StorageClassRow, tab?: string) => void;
};

export function buildStorageClassesTableColumns(
  actions: StorageClassesTableActions,
): ColumnsType<StorageClassRow> {
  const { isTenant, onOpenOpsinfo } = actions;

  return [
    {
      title: '名称',
      key: 'name',
      fixed: 'left',
      render: (_: unknown, r) => {
        const name = r?.metadata?.name || r?.name || '-';
        const isDefault =
          String(r?.metadata?.annotations?.['storageclass.kubernetes.io/is-default-class'] || '').toLowerCase() ===
          'true';
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <PieChartTwoTone />
            <span>{name}</span>
            {isDefault && <span className="std-badge std-badge-warning">Default</span>}
          </div>
        );
      },
    },
    {
      title: 'Provisioner',
      dataIndex: 'provisioner',
      key: 'provisioner',
    },
    {
      title: '关联存储池',
      key: 'backendPool',
      ellipsis: true,
      render: (_: unknown, r) => {
        const label = storageClassBackendPoolLabel(r);
        const tip =
          '来自 StorageClass 的 parameters（如 RBD 的 pool）；若无 pool 字段（例如 Longhorn）则与统一存储块池无直接对应。';
        return label ? (
          <span title={label}>{label}</span>
        ) : (
          <span style={{ color: 'rgba(0, 0, 0, 0.45)' }} title={tip}>
            —
          </span>
        );
      },
    },
    {
      title: '回收策略',
      dataIndex: 'reclaimPolicy',
      key: 'reclaimPolicy',
    },
    {
      title: '绑定模式',
      dataIndex: 'volumeBindingMode',
      key: 'volumeBindingMode',
    },
    {
      title: '副本数',
      key: 'numberOfReplicas',
      render: (_: unknown, r) => {
        const replicas = r?.parameters?.numberOfReplicas;
        return replicas !== undefined && replicas !== null && String(replicas).trim() !== ''
          ? String(replicas)
          : '-';
      },
    },
    {
      title: '允许扩容',
      key: 'allowVolumeExpansion',
      render: (_: unknown, r) => (r?.allowVolumeExpansion ? '是' : '否'),
    },
    {
      title: '创建时间',
      key: 'age',
      render: (_: unknown, r) => {
        const t = r?.metadata?.creationTimestamp;
        return t ? <span className="std-time">{t}</span> : '-';
      },
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      align: 'left',
      render: (_: unknown, r) => {
        const items = [];
        if (!isTenant) {
          items.push({ key: 'opsinfo', label: '查看YAML', onClick: () => onOpenOpsinfo(r, 'detail') });
        }
        return <ResourceActionsDropdown items={items} buttonProps={{ className: 'row-actions-trigger' }} />;
      },
    },
  ];
}
