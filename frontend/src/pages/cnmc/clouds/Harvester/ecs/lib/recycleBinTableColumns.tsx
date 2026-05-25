import React from 'react';
import type { ColumnsType } from 'antd/es/table';
import { Badge, Tooltip } from 'antd';
import { SafetyCertificateFilled } from '@ant-design/icons';
import ResourceActionsDropdown from 'components/ResourceActionsDropdown';
import { OsIcon } from 'components/OsIcon';
import { cnVmStatus } from 'utils/harvesterUtils';
import { formatStorageSize } from './storageSize';
import type { VmListSafeRead } from './vmSafeRead';
import { formatVmListTimestamp } from './vmSectionActions';

export const HARVESTER_RECYCLE_BIN_TABLE_SETTINGS_KEY = 'harvester_recycle_bin_table';

export type RecycleBinTableActions = {
  safeRead: VmListSafeRead;
  isTenant: boolean;
  hasRecycleBinWrite: boolean;
  onRestore: (record: any) => void;
  onForceDelete: (record: any) => void;
  onOpenYaml: (record: any) => void;
};

export function buildRecycleBinTableColumns(
  actions: RecycleBinTableActions,
): ColumnsType<any> {
  const { safeRead, isTenant, hasRecycleBinWrite, onRestore, onForceDelete, onOpenYaml } =
    actions;

  return [
    {
      title: '云主机名称',
      key: 'name',
      fixed: 'left',
      ellipsis: true,
      render: (_: any, r: any) => {
        const text = safeRead.name(r) || '-';
        const osName =
          safeRead.os(r) || safeRead.imageDisplayName(r) || safeRead.name(r) || '';
        const isImportant = r?.metadata?.labels?.['tower.io/important'] === 'true';
        return (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <OsIcon osName={osName} style={{ flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{text}</span>
            {isImportant && (
              <Tooltip title="重要实例">
                <SafetyCertificateFilled
                  style={{ color: '#faad14', fontSize: 14, flexShrink: 0 }}
                />
              </Tooltip>
            )}
          </span>
        );
      },
    },
    {
      title: '云主机ID',
      key: 'vmId',
      ellipsis: true,
      render: (_: any, r: any) => {
        const id = safeRead.vmId(r);
        return id ? <Tooltip title={id}>{id}</Tooltip> : '-';
      },
    },
    {
      title: '状态',
      key: 'status',
      render: (_: any, r: any) => {
        const s = String(safeRead.status(r));
        const k = s.toLowerCase();
        const status = (() => {
          if (k === 'running') return 'success';
          if (k === 'starting' || k === 'migrating') return 'processing';
          if (k === 'stopping' || k === 'terminating') return 'warning';
          if (k === 'error' || k === 'errorunschedulable') return 'error';
          return 'default';
        })();
        return <Badge status={status as any} text={cnVmStatus(s)} />;
      },
    },
    ...(!isTenant
      ? [
          {
            title: '项目',
            key: 'namespace',
            ellipsis: true,
            render: (_: any, r: any) => safeRead.namespace(r) || '-',
          },
          {
            title: '租户',
            key: 'tenant',
            ellipsis: true,
            render: (_: any, r: any) => safeRead.tenant(r) || '-',
          },
          {
            title: '组织',
            key: 'organization',
            ellipsis: true,
            render: (_: any, r: any) => safeRead.organization(r) || '-',
          },
        ]
      : []),
    {
      title: '节点',
      key: 'node',
      ellipsis: true,
      render: (_: any, r: any) => {
        const node = String(safeRead.node(r)).trim();
        return node ? <span className="std-badge std-badge-info">{node}</span> : '-';
      },
    },
    {
      title: 'CPU',
      key: 'cpu',
      render: (_: any, r: any) => {
        const v = safeRead.cpu(r);
        return v ? `${v} C` : '-';
      },
    },
    {
      title: '内存',
      key: 'memory',
      render: (_: any, r: any) => safeRead.memory(r) || '-',
    },
    {
      title: '说明',
      key: 'memSpec',
      ellipsis: true,
      render: (_: any, r: any) => safeRead.memSpec(r) || '-',
    },
    {
      title: '镜像',
      key: 'image',
      ellipsis: true,
      render: (_: any, r: any) => {
        const displayName = safeRead.imageDisplayName(r);
        const img = safeRead.image(r);
        const size = safeRead.imageSize(r);
        if (!displayName && !img) return '-';
        const content = (
          <div>
            {displayName && <div>{displayName}</div>}
            <div>
              {img && <span className="std-time">{img}</span>}
              {size && (
                <span style={{ marginLeft: 6 }} className="std-badge std-badge-default">
                  {size}
                </span>
              )}
            </div>
          </div>
        );
        return (
          <Tooltip title={content}>
            <div
              style={{
                maxWidth: 210,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {displayName || img}
            </div>
          </Tooltip>
        );
      },
    },
    {
      title: '操作系统',
      key: 'os',
      ellipsis: true,
      render: (_: any, r: any) => safeRead.os(r) || '-',
    },
    {
      title: 'IP地址',
      key: 'ip',
      ellipsis: true,
      render: (_: any, r: any) => {
        const ip = safeRead.ip(r);
        return ip ? (
          <Tooltip title={ip}>
            <div
              style={{
                maxWidth: 210,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {ip}
            </div>
          </Tooltip>
        ) : (
          '-'
        );
      },
    },
    {
      title: 'MAC地址',
      key: 'mac',
      ellipsis: true,
      render: (_: any, r: any) => {
        const mac = safeRead.macAddress(r);
        return mac ? <Tooltip title={mac}>{mac}</Tooltip> : '-';
      },
    },
    {
      title: '存储卷',
      key: 'volumes',
      ellipsis: false,
      render: (_: any, r: any) => {
        const details = safeRead.volumeDetails(r);
        if (!details || details.length === 0) return '-';
        return (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {details.map((v: any, i: number) =>
              v.kind !== 'cloudinit' ? (
                <Tooltip title={v.claimName || v.name} key={i}>
                  <span
                    className={`std-badge ${v.kind === 'data' ? 'std-badge-success' : 'std-badge-info'}`}
                  >
                    {[
                      v.kind === 'system' ? '系统卷' : v.kind === 'data' ? '数据卷' : '',
                      formatStorageSize(v.capacityBytes),
                      v.phase,
                    ]
                      .filter(Boolean)
                      .join(' | ')}
                  </span>
                </Tooltip>
              ) : null,
            )}
          </div>
        );
      },
    },
    {
      title: '创建时间',
      key: 'created',
      render: (_: any, r: any) => (
        <span className="std-time">{formatVmListTimestamp(safeRead.creationTimestamp(r))}</span>
      ),
    },
    {
      title: '删除时间',
      key: 'deletedAt',
      render: (_: any, r: any) => (
        <span className="std-time">
          {formatVmListTimestamp(r?.metadata?.annotations?.['tower.io/deletion-scheduled'])}
        </span>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      render: (_: any, r: any) => {
        const items: any[] = [
          { key: 'restore', label: '恢复', onClick: () => onRestore(r) },
          ...(!isTenant
            ? [
                { type: 'divider' },
                { key: 'yaml', label: '查看YAML', onClick: () => onOpenYaml(r) },
              ]
            : []),
          { type: 'divider' },
          { key: 'force_delete', label: '彻底删除', danger: true, onClick: () => onForceDelete(r) },
        ];
        return (
          <span>
            <ResourceActionsDropdown
              items={items}
              buttonProps={{
                className: 'row-actions-trigger',
                style: { margin: 0 },
                disabled: !hasRecycleBinWrite,
              }}
            />
          </span>
        );
      },
    },
  ];
}
