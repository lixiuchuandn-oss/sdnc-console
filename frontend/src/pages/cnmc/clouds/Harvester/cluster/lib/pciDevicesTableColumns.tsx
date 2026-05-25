import React from 'react';
import type { ColumnsType } from 'antd/es/table';
import { Tag } from 'antd';
import { ApiTwoTone } from '@ant-design/icons';
import ResourceActionsDropdown from 'components/ResourceActionsDropdown';
import {
  getPciNodeName,
  pciDeviceRawObj,
  pciVendorLabel,
} from './pciDevicesSectionUtils';

export function renderPciStateCell(r: unknown): React.ReactNode {
  const row = r as Record<string, unknown>;
  const rawObj = pciDeviceRawObj(r);
  const st =
    row?.state ||
    (row?.metadata as { state?: unknown } | undefined)?.state ||
    (row?.status as { state?: unknown; phase?: unknown; conditions?: Array<{ type?: unknown }> } | undefined)
      ?.state ||
    (row?.status as { phase?: unknown } | undefined)?.phase ||
    (row?.status as { conditions?: Array<{ type?: unknown }> } | undefined)?.conditions?.[0]?.type;
  if (st && typeof st === 'object' && (st as { name?: string }).name) {
    const n = String((st as { name?: string }).name || '').toLowerCase();
    if (n === 'active' || n === 'enabled') return <Tag color="green">活跃</Tag>;
    if (n === 'inactive' || n === 'disabled') return <Tag color="default">非活跃</Tag>;
    if (n === 'transitioning') return <Tag color="blue">变更中</Tag>;
    if (n === 'error' || n === 'failed') return <Tag color="red">异常</Tag>;
  }
  if (typeof st === 'string' && st.trim()) {
    const s = st.trim();
    const sl = s.toLowerCase();
    if (sl === 'active' || sl === 'enabled') return <Tag color="green">活跃</Tag>;
    if (sl === 'inactive' || sl === 'disabled') return <Tag color="default">非活跃</Tag>;
    if (sl === 'transitioning') return <Tag color="blue">变更中</Tag>;
    if (sl === 'error' || sl === 'failed') return <Tag color="red">异常</Tag>;
    return <Tag>{s}</Tag>;
  }
  const driver =
    (rawObj?.status as { kernelDriverInUse?: string } | undefined)?.kernelDriverInUse ||
    row?.kernelDriverInUse;
  if (typeof driver === 'string' && driver.toLowerCase().includes('vfio')) {
    return <Tag color="success">可透传</Tag>;
  }
  if (driver) return <Tag color="processing">占用中</Tag>;
  return '-';
}

export type PciDevicesTableActions = {
  isTenant: boolean;
  onOpenYaml: (record: unknown) => void;
};

export function buildPciDevicesTableColumns(
  actions: PciDevicesTableActions,
): ColumnsType<Record<string, unknown>> {
  const { isTenant, onOpenYaml } = actions;

  return [
    {
      title: '名称',
      key: 'name',
      fixed: 'left',
      ellipsis: true,
      render: (_: unknown, r) => {
        const row = r as Record<string, unknown>;
        const text =
          row?.name ||
          (row?.status as { deviceName?: string } | undefined)?.deviceName ||
          (row?.metadata as { name?: string } | undefined)?.name ||
          '-';
        return (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <ApiTwoTone />
            <span>{String(text)}</span>
          </span>
        );
      },
    },
    {
      title: '资源名',
      key: 'resource',
      ellipsis: true,
      render: (_: unknown, r) => {
        const row = r as Record<string, unknown>;
        return row?.resourceName || (row?.status as { resourceName?: string } | undefined)?.resourceName || '-';
      },
    },
    { title: '节点', key: 'node', ellipsis: true, render: (_: unknown, r) => getPciNodeName(r) || '-' },
    { title: '状态', key: 'state', ellipsis: true, render: (_: unknown, r) => renderPciStateCell(r) },
    {
      title: 'PCI地址',
      key: 'addr',
      ellipsis: true,
      render: (_: unknown, r) => {
        const row = r as Record<string, unknown>;
        const rawObj = pciDeviceRawObj(r);
        return (
          row?.address ||
          row?.pciAddress ||
          (row?.status as { pciAddress?: string; address?: string } | undefined)?.pciAddress ||
          (row?.status as { address?: string } | undefined)?.address ||
          (rawObj?.status as { pciAddress?: string; address?: string } | undefined)?.pciAddress ||
          (rawObj?.status as { address?: string } | undefined)?.address ||
          '-'
        );
      },
    },
    {
      title: '厂商',
      key: 'vendorId',
      ellipsis: true,
      render: (_: unknown, r) => {
        const row = r as Record<string, unknown>;
        const rawObj = pciDeviceRawObj(r);
        const id =
          row?.vendorId ||
          (row?.status as { vendorId?: string } | undefined)?.vendorId ||
          (rawObj?.status as { vendorId?: string } | undefined)?.vendorId;
        return pciVendorLabel(String(id || ''));
      },
    },
    {
      title: '设备ID',
      key: 'productId',
      ellipsis: true,
      render: (_: unknown, r) => {
        const row = r as Record<string, unknown>;
        const rawObj = pciDeviceRawObj(r);
        return (
          row?.productId ||
          row?.deviceId ||
          (row?.status as { deviceId?: string } | undefined)?.deviceId ||
          (rawObj?.status as { deviceId?: string } | undefined)?.deviceId ||
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
        const rawObj = pciDeviceRawObj(r);
        return (
          row?.description ||
          (row?.status as { description?: string } | undefined)?.description ||
          (rawObj?.status as { description?: string } | undefined)?.description ||
          '-'
        );
      },
    },
    {
      title: '绑定到',
      key: 'binding',
      ellipsis: true,
      render: (_: unknown, r) => {
        const row = r as Record<string, unknown> & { vmInfo?: { vmDisplayName?: string; vmName?: string; vmNamespace?: string } };
        if (!row?.vmInfo) return <Tag>未绑定</Tag>;
        const vmInfo = row.vmInfo;
        const displayName = vmInfo.vmDisplayName || vmInfo.vmName;
        const vmText = `${displayName} (${vmInfo.vmNamespace}/${vmInfo.vmName})`;
        return <span style={{ wordBreak: 'break-word' }}>{vmText}</span>;
      },
    },
    {
      title: 'ClassID',
      key: 'classId',
      ellipsis: true,
      render: (_: unknown, r) => {
        const row = r as Record<string, unknown>;
        const rawObj = pciDeviceRawObj(r);
        return (
          row?.classId ||
          (row?.status as { classId?: string } | undefined)?.classId ||
          (rawObj?.status as { classId?: string } | undefined)?.classId ||
          '-'
        );
      },
    },
    {
      title: '驱动',
      key: 'driver',
      ellipsis: true,
      render: (_: unknown, r) => {
        const row = r as Record<string, unknown>;
        const rawObj = pciDeviceRawObj(r);
        return (
          (rawObj?.status as { kernelDriverInUse?: string } | undefined)?.kernelDriverInUse ||
          (row?.status as { kernelDriverInUse?: string } | undefined)?.kernelDriverInUse ||
          '-'
        );
      },
    },
    {
      title: 'IOMMU组',
      key: 'iommu',
      ellipsis: true,
      render: (_: unknown, r) => {
        const row = r as Record<string, unknown>;
        const rawObj = pciDeviceRawObj(r);
        return (
          (rawObj?.status as { iommuGroup?: string } | undefined)?.iommuGroup ||
          (row?.status as { iommuGroup?: string } | undefined)?.iommuGroup ||
          '-'
        );
      },
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      render: (_: unknown, r) => {
        const row = r as Record<string, unknown> & { links?: { view?: string } };
        const items = [
          ...(!isTenant ? [{ key: 'view_yaml', label: '查看YAML', onClick: () => onOpenYaml(r) }] : []),
          ...(row?.links?.view
            ? [{ key: 'view', label: '查看 SourceData', onClick: () => window.open(row.links!.view!, '_blank') }]
            : []),
        ];
        return <ResourceActionsDropdown items={items} buttonProps={{ className: 'row-actions-trigger' }} />;
      },
    },
  ];
}
