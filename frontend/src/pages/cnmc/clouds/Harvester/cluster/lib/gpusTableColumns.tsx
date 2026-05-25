import React from 'react';
import type { ColumnsType } from 'antd/es/table';
import { Tag } from 'antd';
import { ApiTwoTone } from '@ant-design/icons';
import ResourceActionsDropdown from 'components/ResourceActionsDropdown';
import type { GpuRow } from 'services/harvester/types/inventoryRows';
import {
  deriveGpuType,
  getGpuDeviceState,
  getGpuNodeName,
  gpuPciAddress,
  gpuVendorName,
} from './gpusSectionUtils';

export function renderGpuStateTag(rawState?: string): React.ReactNode {
  const s = String(rawState || '').toLowerCase();
  if (s === 'active' || s === 'enabled') return <Tag color="green">活跃</Tag>;
  if (s === 'inactive' || s === 'disabled') return <Tag color="default">非活跃</Tag>;
  if (s === 'transitioning') return <Tag color="blue">变更中</Tag>;
  if (s === 'error' || s === 'failed') return <Tag color="red">异常</Tag>;
  if (!s) return '-';
  return <Tag>{rawState}</Tag>;
}

export function renderGpuTypeTag(x: GpuRow): React.ReactNode {
  const m = String(deriveGpuType(x) || '').toLowerCase();
  if (m === 'passthrough') return <Tag color="blue">直通</Tag>;
  if (m === 'vgpu') return <Tag color="green">vGPU</Tag>;
  if (m === 'sriov') return <Tag color="purple">SR-IOV</Tag>;
  return <Tag>未知</Tag>;
}

export type GpusTableActions = {
  isTenant: boolean;
  onOpenYaml: (record: GpuRow) => void;
};

export function buildGpusTableColumns(actions: GpusTableActions): ColumnsType<GpuRow> {
  const { isTenant, onOpenYaml } = actions;

  return [
    {
      title: '名称',
      key: 'name',
      fixed: 'left',
      render: (_: unknown, r) => {
        const text =
          r?.name ||
          (r?.status as { deviceName?: string } | undefined)?.deviceName ||
          (r?.spec as { deviceName?: string } | undefined)?.deviceName ||
          r?.metadata?.name ||
          (r?.raw as { status?: { deviceName?: string } } | undefined)?.status?.deviceName ||
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
      key: 'resourceName',
      render: (_: unknown, r) =>
        r?.resourceName ||
        (r?.status as { resourceName?: string } | undefined)?.resourceName ||
        (r?.spec as { resourceName?: string } | undefined)?.resourceName ||
        (r?.raw as { status?: { resourceName?: string } } | undefined)?.status?.resourceName ||
        '-',
    },
    { title: '节点', key: 'node', render: (_: unknown, r) => getGpuNodeName(r) || '-' },
    {
      title: '状态',
      key: 'state',
      render: (_: unknown, r) => {
        const s = getGpuDeviceState(r);
        return renderGpuStateTag(s?.name);
      },
    },
    { title: 'PCI地址', key: 'pci', render: (_: unknown, r) => gpuPciAddress(r) || '-' },
    {
      title: '厂商',
      key: 'vendor',
      render: (_: unknown, r) =>
        gpuVendorName(
          (r?.raw as { status?: { vendorId?: string } } | undefined)?.status?.vendorId ||
            (r?.status as { vendorId?: string } | undefined)?.vendorId,
        ),
    },
    {
      title: '设备ID',
      key: 'deviceId',
      render: (_: unknown, r) =>
        (r?.raw as { status?: { deviceId?: string } } | undefined)?.status?.deviceId ||
        (r?.status as { deviceId?: string } | undefined)?.deviceId ||
        '-',
    },
    {
      title: '描述',
      key: 'desc',
      render: (_: unknown, r) =>
        (r?.raw as { status?: { description?: string } } | undefined)?.status?.description ||
        (r?.status as { description?: string } | undefined)?.description ||
        '-',
    },
    {
      title: '绑定到',
      key: 'binding',
      render: (_: unknown, r) => {
        if (!r?.claimed) return <Tag>未绑定</Tag>;
        if (r?.vmInfo) {
          const vmInfo = r.vmInfo;
          const displayName = vmInfo.vmDisplayName || vmInfo.vmName;
          const vmText = `${displayName} (${vmInfo.vmNamespace}/${vmInfo.vmName})`;
          return <span style={{ wordBreak: 'break-word' }}>{vmText}</span>;
        }
        const txt = r?.bindingTo || r?.claimedBy || r?.claimName || '已绑定';
        return <span style={{ wordBreak: 'break-word' }}>{String(txt)}</span>;
      },
    },
    { title: '类型', key: 'type', render: (_: unknown, r) => renderGpuTypeTag(r) },
    {
      title: '配额',
      key: 'quota',
      render: (_: unknown, r) => {
        const q = r?.quota;
        const alloc = q?.allocatable;
        const free = q?.free;
        if (typeof alloc === 'number' && typeof free === 'number') return `${free}/${alloc}`;
        if (typeof alloc === 'number') return `${alloc}`;
        if (typeof free === 'number') return `${free}`;
        return '-';
      },
    },
    {
      title: 'ClassID',
      key: 'classId',
      render: (_: unknown, r) =>
        (r?.raw as { status?: { classId?: string } } | undefined)?.status?.classId ||
        (r?.status as { classId?: string } | undefined)?.classId ||
        '-',
    },
    {
      title: '驱动',
      key: 'driver',
      render: (_: unknown, r) =>
        (r?.raw as { status?: { kernelDriverInUse?: string } } | undefined)?.status?.kernelDriverInUse ||
        (r?.status as { kernelDriverInUse?: string } | undefined)?.kernelDriverInUse ||
        '-',
    },
    {
      title: 'IOMMU组',
      key: 'iommu',
      render: (_: unknown, r) =>
        (r?.raw as { status?: { iommuGroup?: string } } | undefined)?.status?.iommuGroup ||
        (r?.status as { iommuGroup?: string } | undefined)?.iommuGroup ||
        '-',
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      render: (_: unknown, r) => {
        const items = [
          ...(!isTenant ? [{ key: 'view_yaml', label: '查看YAML', onClick: () => onOpenYaml(r) }] : []),
          ...(r?.claimRaw
            ? [{ key: 'binding', label: '查看绑定', onClick: () => onOpenYaml(r.claimRaw as GpuRow) }]
            : []),
          ...(r?.links?.view
            ? [{ key: 'view', label: '查看 SourceData', onClick: () => window.open(r.links!.view!, '_blank') }]
            : []),
        ];
        return <ResourceActionsDropdown items={items} buttonProps={{ className: 'row-actions-trigger' }} />;
      },
    },
  ];
}
