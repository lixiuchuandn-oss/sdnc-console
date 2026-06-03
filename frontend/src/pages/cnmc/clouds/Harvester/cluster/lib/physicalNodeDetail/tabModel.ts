import React from 'react';
import type { Typography } from 'antd';
import {
  parseCpuToCoresLoose,
  parseMemoryToBytesLoose,
} from '../physicalNodeDetailFormatters';
import { mapHmsLldpRowToKeyFields } from '../physicalNodeDetailDrawerLib';
import type { NodeStatusSummary, PhysicalNodeDetailTabContext } from './types';
import { filterHmsDisksForDisplay } from './hmsDiskList';

export type PhysicalNodeDetailDerived = {
  status: NodeStatusSummary | undefined;
  capCpu: unknown;
  capMem: unknown;
  allocCpu: unknown;
  allocMem: unknown;
  cpuUsageDisplay: string;
  memUsageDisplay: string;
  cpuUsageTextType: React.ComponentProps<typeof Typography.Text>['type'];
  memUsageTextType: React.ComponentProps<typeof Typography.Text>['type'];
  diskList: unknown[];
  memListSorted: unknown[];
  swList: unknown[];
  lldpTableRows: ReturnType<typeof mapHmsLldpRowToKeyFields>[];
  systemObj: Record<string, unknown> | null;
  cpuObj: Record<string, unknown> | null;
  systemInfo: Record<string, string> | undefined;
};

export function buildPhysicalNodeDetailDerived(ctx: PhysicalNodeDetailTabContext): PhysicalNodeDetailDerived {
  const { record, hardware, metrics } = ctx;

  const status = record?.status as NodeStatusSummary | undefined;
  const cpuTotal = parseCpuToCoresLoose(
    status?.allocatable?.cpu || status?.capacity?.cpu || (record?.cpu as string | undefined),
  );
  const memTotalBytes = parseMemoryToBytesLoose(
    status?.allocatable?.memory || status?.capacity?.memory || (record?.memory as string | undefined),
  );
  const cpuUsed = metrics?.cpuUsedCores ?? 0;
  const memUsedBytes = metrics?.memUsedBytes ?? 0;
  const cpuPct = cpuTotal > 0 ? (cpuUsed / cpuTotal) * 100 : null;
  const memPct = memTotalBytes > 0 ? (memUsedBytes / memTotalBytes) * 100 : null;
  const hasMetrics = metrics != null && (metrics.cpuUsedCores != null || metrics.memUsedBytes != null);

  const cpuUsageDisplay =
    cpuTotal > 0 && cpuPct !== null
      ? `${Math.max(0, Math.min(100, cpuPct)).toFixed(1)}% · ${cpuUsed.toFixed(2)}/${cpuTotal.toFixed(2)} core`
      : hasMetrics
        ? ''
        : '无实时指标（需 metrics.k8s.io）';

  const memUsageDisplay =
    memTotalBytes > 0 && memPct !== null
      ? `${Math.max(0, Math.min(100, memPct)).toFixed(1)}% · ${(memUsedBytes / (1024 * 1024 * 1024)).toFixed(2)}/${(memTotalBytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`
      : hasMetrics
        ? ''
        : '无实时指标（需 metrics.k8s.io）';

  const cpuUsageTextType: React.ComponentProps<typeof Typography.Text>['type'] =
    !hasMetrics || cpuTotal <= 0 ? 'secondary' : cpuPct != null && cpuPct >= 90 ? 'warning' : undefined;

  const memUsageTextType: React.ComponentProps<typeof Typography.Text>['type'] =
    !hasMetrics || memTotalBytes <= 0 ? 'secondary' : memPct != null && memPct >= 90 ? 'warning' : undefined;

  const hw = hardware;
  const diskList: unknown[] =
    hw && Array.isArray(hw.disk) ? filterHmsDisksForDisplay(hw.disk as unknown[]) : [];
  const memList: unknown[] = hw && Array.isArray(hw.memory) ? (hw.memory as unknown[]) : [];
  const memListSorted = [...memList].sort((a, b) => {
    const ae = /no module installed/i.test(String((a as { Size?: string })?.Size ?? ''));
    const be = /no module installed/i.test(String((b as { Size?: string })?.Size ?? ''));
    if (ae !== be) return ae ? 1 : -1;
    return 0;
  });
  const swList: unknown[] = hw && Array.isArray(hw.switch) ? (hw.switch as unknown[]) : [];
  const lldpTableRows = swList.map((row, i) => mapHmsLldpRowToKeyFields(row as Record<string, unknown>, i));
  const systemObj = hw?.system && typeof hw.system === 'object' ? (hw.system as Record<string, unknown>) : null;
  const cpuObj = hw?.cpu && typeof hw.cpu === 'object' ? (hw.cpu as Record<string, unknown>) : null;

  return {
    status,
    capCpu: status?.capacity?.cpu ?? record?.cpu,
    capMem: status?.capacity?.memory ?? record?.memory,
    allocCpu: status?.allocatable?.cpu,
    allocMem: status?.allocatable?.memory,
    cpuUsageDisplay,
    memUsageDisplay,
    cpuUsageTextType,
    memUsageTextType,
    diskList,
    memListSorted,
    swList,
    lldpTableRows,
    systemObj,
    cpuObj,
    systemInfo: hardware?.system as Record<string, string> | undefined,
  };
}
