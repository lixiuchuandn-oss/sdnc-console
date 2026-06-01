import React from 'react';
import type { ColumnsType } from 'antd/es/table';
import { Tag } from 'antd';
import { UsbTwoTone } from '@ant-design/icons';
import ResourceActionsDropdown, { type ResourceActionItem } from 'components/ResourceActionsDropdown';
import { filterMenuItemsForReadOnly } from 'utils/rbacUi';
import {
  getUsbState,
  usbVendorLabel,
} from './usbDevicesSectionUtils';

export function renderUsbStateTag(state: string): React.ReactNode {
  const s = String(state || '').toLowerCase();
  if (s === 'active' || s === 'enabled') return <Tag color="green">活跃</Tag>;
  if (s === 'inactive' || s === 'disabled') return <Tag color="default">非活跃</Tag>;
  if (s === 'transitioning') return <Tag color="blue">变更中</Tag>;
  if (s === 'error' || s === 'failed') return <Tag color="red">异常</Tag>;
  if (s === 'unknown') return <Tag>未知</Tag>;
  return state || '-';
}

export type UsbDevicesTableActions = {
  isTenant: boolean;
  hasUsbWrite: boolean;
  onOpenYaml: (record: unknown) => void;
  onSetPassthrough: (rows: unknown[], passthrough: boolean) => void;
};

export function buildUsbDevicesTableColumns(
  actions: UsbDevicesTableActions,
): ColumnsType<Record<string, unknown>> {
  const { isTenant, hasUsbWrite, onOpenYaml, onSetPassthrough } = actions;

  return [
    {
      title: '名称',
      key: 'name',
      fixed: 'left',
      ellipsis: true,
      render: (_: unknown, r) => {
        const row = r as Record<string, unknown>;
        return (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <UsbTwoTone style={{ flexShrink: 0 }} />
            <span>{String(row?.name || '-')}</span>
          </span>
        );
      },
    },
    {
      title: '资源名',
      key: 'resource',
      ellipsis: true,
      render: (_: unknown, r) => String((r as Record<string, unknown>)?.resourceName || '-'),
    },
    {
      title: '节点',
      key: 'node',
      ellipsis: true,
      render: (_: unknown, r) => {
        const row = r as Record<string, unknown>;
        const raw = row?.raw as { status?: { nodeName?: string }; spec?: { nodeName?: string } } | undefined;
        return row?.nodeName || raw?.status?.nodeName || raw?.spec?.nodeName || '-';
      },
    },
    {
      title: '状态',
      key: 'state',
      ellipsis: true,
      render: (_: unknown, r) => renderUsbStateTag(getUsbState(r)),
    },
    {
      title: 'PCI地址',
      key: 'addr',
      ellipsis: true,
      render: (_: unknown, r) => {
        const row = r as Record<string, unknown>;
        const raw = row?.raw as {
          status?: { pciAddress?: string; address?: string };
          spec?: { pciAddress?: string; address?: string };
        } | undefined;
        return (
          row?.pciAddress ||
          raw?.status?.pciAddress ||
          raw?.status?.address ||
          raw?.spec?.pciAddress ||
          raw?.spec?.address ||
          '-'
        );
      },
    },
    {
      title: '厂商',
      key: 'vendor',
      ellipsis: true,
      render: (_: unknown, r) => {
        const row = r as Record<string, unknown>;
        const raw = row?.raw as {
          status?: { vendorID?: string; vendorId?: string };
          spec?: { vendorID?: string; vendorId?: string };
        } | undefined;
        return usbVendorLabel(
          String(
            row?.vendorId ||
              raw?.status?.vendorID ||
              raw?.status?.vendorId ||
              raw?.spec?.vendorID ||
              raw?.spec?.vendorId ||
              '',
          ),
        );
      },
    },
    {
      title: '设备ID',
      key: 'productId',
      ellipsis: true,
      render: (_: unknown, r) => {
        const row = r as Record<string, unknown>;
        const raw = row?.raw as {
          status?: { productID?: string; productId?: string };
          spec?: { productID?: string; productId?: string };
        } | undefined;
        return (
          row?.productId ||
          raw?.status?.productID ||
          raw?.status?.productId ||
          raw?.spec?.productID ||
          raw?.spec?.productId ||
          '-'
        );
      },
    },
    {
      title: '描述',
      key: 'desc',
      ellipsis: true,
      render: (_: unknown, r) => {
        const row = r as Record<string, unknown>;
        const raw = row?.raw as { status?: { description?: string }; spec?: { description?: string } } | undefined;
        return row?.description || raw?.status?.description || raw?.spec?.description || '-';
      },
    },
    {
      title: '绑定到',
      key: 'binding',
      ellipsis: true,
      render: (_: unknown, r) => {
        const row = r as Record<string, unknown> & {
          claimed?: boolean;
          vmInfo?: { vmDisplayName?: string; vmName?: string; vmNamespace?: string };
          bindingTo?: string;
          claimedBy?: string;
          claimName?: string;
        };
        if (!row?.claimed) return <Tag>未绑定</Tag>;
        if (row?.vmInfo) {
          const vmInfo = row.vmInfo;
          const displayName = vmInfo.vmDisplayName || vmInfo.vmName;
          const vmText = `${displayName} (${vmInfo.vmNamespace}/${vmInfo.vmName})`;
          return <span style={{ wordBreak: 'break-word' }}>{vmText}</span>;
        }
        const txt = row?.bindingTo || row?.claimedBy || row?.claimName || '已绑定';
        return <span style={{ wordBreak: 'break-word' }}>{String(txt)}</span>;
      },
    },
    {
      title: '设备路径',
      key: 'path',
      ellipsis: true,
      render: (_: unknown, r) => {
        const row = r as Record<string, unknown>;
        const raw = row?.raw as { status?: { devicePath?: string }; spec?: { devicePath?: string } } | undefined;
        return raw?.status?.devicePath || raw?.spec?.devicePath || '-';
      },
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      render: (_: unknown, r) => {
        const row = r as Record<string, unknown> & {
          enabled?: boolean;
          claimed?: boolean;
          vmInfo?: { vmDisplayName?: string; vmName?: string };
          raw?: { status?: { enabled?: boolean } };
          rawData?: { status?: { enabled?: boolean } };
        };
        const enabled = row?.enabled ?? row?.raw?.status?.enabled ?? row?.rawData?.status?.enabled;
        const isUsedByVm = Boolean(row?.claimed && row?.vmInfo);
        const vmName = isUsedByVm ? row.vmInfo!.vmDisplayName || row.vmInfo!.vmName : '';

        const items: ResourceActionItem[] = [
          ...(hasUsbWrite && enabled === true
            ? [
                {
                  key: 'unclaim',
                  label: '设为非直通',
                  onClick: () => onSetPassthrough([r], false),
                  disabled: isUsedByVm,
                  tooltip: isUsedByVm ? `设备已被虚拟机（${vmName}）使用，不能设置为非直通` : undefined,
                },
              ]
            : []),
          ...(hasUsbWrite && enabled === false
            ? [{ key: 'claim', label: '设为直通', onClick: () => onSetPassthrough([r], true) }]
            : []),
          ...(!isTenant ? [{ key: 'view_yaml', label: '查看YAML', onClick: () => onOpenYaml(r) }] : []),
        ];

        return (
          <ResourceActionsDropdown
            items={filterMenuItemsForReadOnly(items as any, hasUsbWrite) as ResourceActionItem[]}
            buttonProps={{ className: 'row-actions-trigger' }}
          />
        );
      },
    },
  ];
}
