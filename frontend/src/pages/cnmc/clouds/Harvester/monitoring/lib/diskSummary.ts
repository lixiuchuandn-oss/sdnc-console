/**
 * 监控概览 · 磁盘卡片汇总：健康 / 异常 / 其他 与 total。
 * total 在 Ceph（OSD）分支为 OSD 个数，在 Harvester（BlockDevice）分支为块设备 CR 条数。
 */
import { normalizeCephBundle } from '../../ceph/lib/cephStorage';
import { clusterHasCeph } from './storageCardCeph';

export interface DiskSummary {
  healthy: number;
  warning: number;
  other: number;
  total: number;
}

export type DiskCardAggregateMode = 'ceph_osd' | 'block_device';

function getList(res: unknown): any[] {
  if (Array.isArray(res)) return res;
  if (res && typeof res === 'object' && Array.isArray((res as { data?: unknown }).data)) {
    return (res as { data: any[] }).data;
  }
  return [];
}

function blockDevicePhaseFailed(phase: unknown): boolean {
  if (phase == null || phase === '') return false;
  const s = String(phase).toLowerCase();
  return s.includes('fail');
}

function osdUpInTrue(v: unknown): boolean {
  return v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true';
}

/**
 * Ceph Dashboard `api/health/minimal`（或 Tower 合并后的同结构）中的 osd_map：逐 OSD 统计。
 * - 已就绪：`up` 且 `in`
 * - 异常：条目存在且可解析，但未同时 up+in
 * - 其他：缺字段或形态未知
 */
export function aggregateCephOsdDiskSummary(cephMinimal: unknown): DiskSummary | null {
  if (!cephMinimal || typeof cephMinimal !== 'object') return null;
  const m = cephMinimal as Record<string, unknown>;
  const osdMap = m.osd_map;
  if (!osdMap || typeof osdMap !== 'object') return null;
  const osds = (osdMap as { osds?: unknown }).osds;
  if (!Array.isArray(osds) || osds.length === 0) return null;

  let healthy = 0;
  let warning = 0;
  let other = 0;

  for (const raw of osds) {
    if (!raw || typeof raw !== 'object') {
      other++;
      continue;
    }
    const o = raw as Record<string, unknown>;
    const hasUp = 'up' in o && o.up !== undefined && o.up !== null;
    const hasIn = 'in' in o && o.in !== undefined && o.in !== null;
    if (!hasUp && !hasIn) {
      other++;
      continue;
    }
    const upOk = osdUpInTrue(o.up);
    const inOk = osdUpInTrue(o.in);
    if (upOk && inOk) healthy++;
    else warning++;
  }

  return {
    healthy,
    warning,
    other,
    total: osds.length,
  };
}

/**
 * 对集群内 harvesterhci.io.blockdevices 列表做分区：
 * - 已就绪：`provisionPhase === 'Provisioned'` 且无 error
 * - 异常：`metadata.state.error` 或阶段指示失败
 * - 其他：待发现、纳管中、未指定纳管等其余状态
 */
export function aggregateDiskSummaryFromBlockDevices(blockDevicesResponse: unknown): DiskSummary {
  const list = getList(blockDevicesResponse);
  let healthy = 0;
  let warning = 0;
  let other = 0;

  for (const bd of list) {
    const err = bd?.metadata?.state?.error === true;
    const phase = bd?.status?.provisionPhase;
    if (err || blockDevicePhaseFailed(phase)) {
      warning++;
      continue;
    }
    if (phase === 'Provisioned') {
      healthy++;
      continue;
    }
    other++;
  }

  return {
    healthy,
    warning,
    other,
    total: list.length,
  };
}

/**
 * 存在 Rook/Ceph 且 mgr minimal 带出 osd_map 时优先用 OSD；否则用 Harvester 块设备（Ceph 集群上常仍可看到节点块设备）。
 */
export function resolveMonitoringDiskSummary(
  cephMinimal: unknown,
  cephResourcesRaw: unknown,
  blockDevicesResponse: unknown,
): { mode: DiskCardAggregateMode; summary: DiskSummary } | null {
  const bundle = normalizeCephBundle(cephResourcesRaw);
  if (clusterHasCeph(bundle)) {
    const osd = aggregateCephOsdDiskSummary(cephMinimal);
    if (osd && osd.total > 0) {
      return { mode: 'ceph_osd', summary: osd };
    }
  }
  if (blockDevicesResponse == null) return null;
  return {
    mode: 'block_device',
    summary: aggregateDiskSummaryFromBlockDevices(blockDevicesResponse),
  };
}
