import React from 'react';
import type { ColumnsType } from 'antd/es/table';
import { Tag } from 'antd';
import { HddTwoTone } from '@ant-design/icons';
import ResourceActionsDropdown from 'components/ResourceActionsDropdown';
import { gbText } from './volumeQuantityUtils';
import { renderVolumeStatusBadge } from './volumePhaseUtils';
import { checkIsVolumeSystemDisk, type VolumeSafeRead } from './volumeSafeRead';
import type { VolumeView } from './volumesSectionTypes';

export type VolumeRowActionItem =
  | {
      key: string;
      label: React.ReactNode;
      disabled?: boolean;
      danger?: boolean;
      onClick?: () => void;
    }
  | { type: 'divider'; key?: string };

export type BuildVolumesTableColumnsParams = {
  isTenant?: boolean;
  hasDisksWrite: boolean;
  safeRead: VolumeSafeRead;
  onOpenVolumeDetail: (record: VolumeView, tab?: string) => void;
  onOpenOpsDrawer: (record: VolumeView, tab?: string) => void;
  buildRowActionItems: (record: VolumeView) => VolumeRowActionItem[];
};

export function buildVolumesTableColumns({
  isTenant,
  hasDisksWrite: _hasDisksWrite,
  safeRead,
  onOpenVolumeDetail,
  onOpenOpsDrawer: _onOpenOpsDrawer,
  buildRowActionItems,
}: BuildVolumesTableColumnsParams): ColumnsType<VolumeView> {
  return [
    {
      title: '云盘名称 (PVC)',
      dataIndex: 'name',
      key: 'name',
      fixed: 'left',
      render: (_: string, r: VolumeView) => {
        const vm = safeRead.attachedVm(r);
        const isSystemDisk = checkIsVolumeSystemDisk(r, vm);
        return (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              maxWidth: '100%',
              whiteSpace: 'nowrap',
            }}
          >
            <HddTwoTone style={{ display: 'inline-block', verticalAlign: 'middle' }} />
            <span
              className="cell-link"
              onClick={() => onOpenVolumeDetail(r, 'detail')}
              style={{
                cursor: 'pointer',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: 1,
                minWidth: 0,
              }}
            >
              {r.alias || r.name}
            </span>
            {isSystemDisk ? (
              <Tag color="blue" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
                系统盘
              </Tag>
            ) : null}
          </span>
        );
      },
    },
    {
      title: '云盘ID',
      dataIndex: 'name',
      key: 'id',
      render: (v: string) => <span className="text-secondary">{v}</span>,
    },
    ...(!isTenant
      ? [
          {
            title: 'PV 名称',
            dataIndex: 'pvName',
            key: 'pvName',
            render: (v: string) => <span className="text-secondary">{v || '-'}</span>,
          },
        ]
      : []),
    {
      title: '状态',
      dataIndex: 'phase',
      key: 'phase',
      render: (v: string) => renderVolumeStatusBadge(v),
    },
    ...(isTenant
      ? []
      : [
          {
            title: '项目',
            dataIndex: 'namespace',
            key: 'namespace',
          },
        ]),
    ...(!isTenant
      ? [
          {
            title: '存储类',
            dataIndex: 'storageClass',
            key: 'storageClass',
            render: (v: string) => <span className="text-secondary">{v || '-'}</span>,
          },
        ]
      : []),
    {
      title: '访问模式',
      dataIndex: 'accessModes',
      key: 'accessModes',
      render: (modes: string[]) => {
        const list = Array.isArray(modes) ? modes : modes ? [modes] : [];
        if (list.length === 0) return '-';
        return list.map((m) => {
          const raw = String(m || '');
          const k = raw.toLowerCase();
          let cls = 'std-badge std-badge-default';
          let text = raw;
          if (k === 'readwriteonce') {
            cls = 'std-badge std-badge-info';
            text = 'RWO';
          } else if (k === 'readwritemany') {
            cls = 'std-badge std-badge-success';
            text = 'RWX';
          } else if (k === 'readonlymany') {
            cls = 'std-badge std-badge-warning';
            text = 'ROX';
          }
          return (
            <span key={raw} className={cls} style={{ marginRight: 4 }}>
              {text}
            </span>
          );
        });
      },
    },
    {
      title: '云盘类型',
      dataIndex: 'volumeMode',
      key: 'volumeMode',
      render: (v: string) => <span className="text-secondary">{v || '-'}</span>,
    },
    {
      title: '挂载云主机',
      key: 'attachedTo',
      render: (_: unknown, r: VolumeView) => {
        const vm = safeRead.attachedVm(r) as Record<string, unknown> | undefined;
        if (vm) {
          const meta = vm.metadata as { annotations?: Record<string, string>; name?: string } | undefined;
          const alias = meta?.annotations?.['tower.io/alias'];
          const name =
            alias ||
            (vm.name as string) ||
            meta?.name ||
            (vm.InstanceName as string) ||
            (vm.InstanceId as string);
          return name;
        }
        return r.attachedTo.length > 0 ? r.attachedTo.join(', ') : '-';
      },
    },
    {
      title: '大小',
      dataIndex: 'capacityBytes',
      key: 'size',
      render: (bytes: number) => gbText(bytes),
    },
    {
      title: '创建时间',
      dataIndex: 'creationTimestamp',
      key: 'creationTimestamp',
      sorter: (a: VolumeView, b: VolumeView) => {
        const ta = a?.creationTimestamp ? new Date(a.creationTimestamp).getTime() : 0;
        const tb = b?.creationTimestamp ? new Date(b.creationTimestamp).getTime() : 0;
        return ta - tb;
      },
      defaultSortOrder: 'descend',
      render: (v: string) => (
        <span className="text-secondary">{v ? new Date(v).toLocaleString() : '-'}</span>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      render: (_: unknown, r: VolumeView) => (
        <ResourceActionsDropdown
          items={buildRowActionItems(r)}
          buttonProps={{ className: 'row-actions-trigger' }}
        />
      ),
    },
  ];
}
