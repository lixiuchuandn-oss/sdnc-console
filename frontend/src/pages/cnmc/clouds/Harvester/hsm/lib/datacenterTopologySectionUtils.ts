/** 机房拓扑 Section 纯函数（Cloudmap 资源总览 · datacenter_topology） */

import type { DatacenterRack, DatacenterRackDevice } from '../../../../../../services/datacenterTopologyApi';
import type { AswCtlSwitchProbeRecord } from 'services/harvester/types/aswProbe';
import { parseSwitchDisplayNameFromInfoLines, switchRecordManagementHost } from '../../cluster/lib/physicalSwitchRecordUtils';
import {
  type NodeLiveMetrics,
  nodeCpuModelName,
  nodeManagementIp,
  parseCpuToCores,
  parseMemoryToBytes,
} from './physicalNodeRackUtils';

export const DATACENTER_GRID_COLS = 24;

export type HarvesterNodeRecord = Record<string, unknown>;

export function rackGridFullSpan(cols = DATACENTER_GRID_COLS): string {
  return `1 / ${cols + 1}`;
}

export function normalizeHarvesterNodesList(json: unknown): HarvesterNodeRecord[] {
  if (!json || typeof json !== 'object') return [];
  const o = json as { data?: { items?: unknown } | unknown[]; items?: unknown };
  const dataField = o.data;
  if (
    dataField &&
    typeof dataField === 'object' &&
    !Array.isArray(dataField) &&
    'items' in dataField
  ) {
    const items = (dataField as { items?: unknown }).items;
    if (Array.isArray(items)) return items as HarvesterNodeRecord[];
  }
  if (Array.isArray(o.items)) return o.items as HarvesterNodeRecord[];
  if (Array.isArray(dataField)) return dataField as HarvesterNodeRecord[];
  return [];
}

export function harvesterNodeName(n: HarvesterNodeRecord | null | undefined): string {
  if (!n || typeof n !== 'object') return '';
  const meta = n.metadata as { name?: string } | undefined;
  return String(meta?.name || (n as { name?: string }).name || '').trim();
}

/** 与「集群 → 物理交换机」表格一致：用管理地址作为落库 refKey */
export function switchStableRef(sw: AswCtlSwitchProbeRecord | Record<string, unknown>): string {
  const host = switchRecordManagementHost(sw as AswCtlSwitchProbeRecord);
  if (host && host !== '—') return host;
  const s = sw as { switchHost?: string; host?: string; id?: string };
  return String(s.switchHost || s.host || s.id || '').trim();
}

/** 含管理地址时与地址分行（机架条用 `\n`；下拉等单行处请 `.replace(/\n/g, ' · ')`） */
export function switchDisplayLabel(sw: AswCtlSwitchProbeRecord | Record<string, unknown>): string {
  const probe = sw as AswCtlSwitchProbeRecord;
  const fromLines = String(parseSwitchDisplayNameFromInfoLines(probe?.info?.lines) || '').trim();
  const host = switchStableRef(sw);
  if (fromLines && host && host !== '—' && fromLines !== host) return `${fromLines}\n${host}`;
  if (fromLines) return fromLines;
  if (host && host !== '—') return host;
  return '物理交换机';
}

export function buildNodeMetricsMapFromK8sMetrics(items: unknown): Record<string, NodeLiveMetrics> {
  const mItems = Array.isArray(items) ? items : [];
  const map: Record<string, NodeLiveMetrics> = {};
  for (const it of mItems) {
    if (!it || typeof it !== 'object') continue;
    const row = it as {
      metadata?: { name?: string };
      usage?: { cpu?: string; memory?: string; 'ephemeral-storage'?: string };
    };
    const nm = String(row.metadata?.name || '').trim();
    if (!nm) continue;
    const epRaw = row.usage?.['ephemeral-storage'];
    const epStr = epRaw != null && String(epRaw).trim() !== '' ? String(epRaw) : '';
    map[nm] = {
      cpuUsedCores: parseCpuToCores(row.usage?.cpu),
      memUsedBytes: parseMemoryToBytes(row.usage?.memory),
      storageUsedBytes: epStr ? parseMemoryToBytes(epStr) : undefined,
    };
  }
  return map;
}

export function buildHarvesterNodeSelectOptions(
  nodes: readonly HarvesterNodeRecord[],
): { value: string; label: string }[] {
  return nodes
    .map((n) => {
      const v = harvesterNodeName(n);
      if (!v) return null;
      const ip = nodeManagementIp(n);
      return { value: v, label: ip ? `${v} · ${ip}` : v };
    })
    .filter(Boolean) as { value: string; label: string }[];
}

export function buildSwitchSelectOptions(
  switches: readonly (AswCtlSwitchProbeRecord | Record<string, unknown>)[],
): { value: string; label: string }[] {
  const m = new Map<string, string>();
  for (const sw of switches) {
    const ref = switchStableRef(sw);
    if (!ref) continue;
    const label = switchDisplayLabel(sw);
    if (!m.has(ref)) m.set(ref, label.replace(/\n/g, ' · '));
  }
  return Array.from(m.entries()).map(([value, label]) => ({ value, label }));
}

/** 编辑时把当前条目的 refKey 排除在「已占用」之外 */
export function filterSelectOptionsExcludingTakenRefs(
  options: { value: string; label: string }[],
  takenRefs: Iterable<string>,
  editingRefKey?: string | null,
): { value: string; label: string }[] {
  const taken = new Set(Array.from(takenRefs, (r) => String(r)));
  if (editingRefKey) taken.delete(String(editingRefKey));
  return options.filter((o) => !taken.has(o.value));
}

export function collectTakenRefKeys(
  devices: readonly DatacenterRackDevice[] | undefined,
  sourceKind: DatacenterRackDevice['sourceKind'],
): string[] {
  return (devices || [])
    .filter((d) => d.sourceKind === sourceKind && d.refKey)
    .map((d) => String(d.refKey));
}

export function resolveRackDeviceLabel(
  d: DatacenterRackDevice,
  nodes: readonly HarvesterNodeRecord[],
  switches: readonly (AswCtlSwitchProbeRecord | Record<string, unknown>)[],
): string {
  if (d.sourceKind === 'custom') return d.customLabel || '自定义';
  if (d.sourceKind === 'node' && d.refKey) {
    const n = nodes.find((x) => harvesterNodeName(x) === d.refKey);
    const miss = n ? '' : '（未在集群中找到）';
    if (!n) return d.refKey + miss;
    const cpuModel = nodeCpuModelName(n);
    return cpuModel ? `${d.refKey}\n${cpuModel}${miss}` : d.refKey + miss;
  }
  if (d.sourceKind === 'switch' && d.refKey) {
    const sw = switches.find((x) => switchStableRef(x) === d.refKey);
    return sw ? switchDisplayLabel(sw) : `${d.refKey}（未在物理交换机列表中找到）`;
  }
  return d.refKey || '—';
}

export function findRackIndexBySwitchRef(
  racks: readonly DatacenterRack[],
  switchRef: string,
): number {
  const want = switchRef.trim();
  if (!want) return -1;
  return racks.findIndex((rack) =>
    (rack.devices || []).some(
      (d) => d.sourceKind === 'switch' && String(d.refKey || '').trim() === want,
    ),
  );
}

export function nextRackSortOrderDefault(racks: readonly DatacenterRack[]): number {
  if (!racks.length) return 0;
  return Math.max(...racks.map((r) => Number(r.sortOrder) || 0)) + 1;
}

export function clampRackCarouselIndex(index: number, rackCount: number): number {
  if (rackCount <= 1) return 0;
  return Math.min(Math.max(0, index), rackCount - 1);
}
