/**
 * SRv6 架构拓扑：配置态（对账结果）着色 + 设备运行态叠加 + 选中关联集合。
 * - 对账按 VR（PE/CE）粒度返回 issues；隧道配置态 = 其四端中最差者
 * - 运行态来自 IBR 实例目录 health_status，与配置态解耦（可「对账一致但已停止」）
 */
import type { Srv6ReconcileItem, Srv6ReconcileReport } from '../../../../../../services/api';
import { ibrVrRowId, type IbrVrRow } from '../../../lib/ibrVrCatalog';
import { getVrHealthStatusKey } from '../../../routers/vrListDisplay';
import type { Srv6Topology } from './buildTopology';

export type ConfigStatus = 'ok' | 'issue' | 'repaired' | 'unknown';
export type RuntimeStatus = 'running' | 'warning' | 'stopped' | 'unknown';

export type VrStatus = {
  status: ConfigStatus;
  issues: Array<{ code: string; message: string }>;
};

export const STATUS_COLOR: Record<ConfigStatus, string> = {
  ok: '#00b42a',
  issue: '#f53f3f',
  repaired: '#ff7d00',
  unknown: '#c9cdd4',
};

export const STATUS_LABEL: Record<ConfigStatus, string> = {
  ok: '对账一致',
  issue: '存在差异',
  repaired: '已修复',
  unknown: '未对账',
};

export const RUNTIME_COLOR: Record<RuntimeStatus, string> = {
  running: '#00b42a',
  warning: '#ff7d00',
  stopped: '#f53f3f',
  unknown: '#c9cdd4',
};

export const RUNTIME_LABEL: Record<RuntimeStatus, string> = {
  running: '运行中',
  warning: '警告',
  stopped: '已停止',
  unknown: '未知',
};

export const OFFLINE_STROKE = '#f53f3f';

const RANK: Record<ConfigStatus, number> = { unknown: 0, ok: 1, repaired: 2, issue: 3 };
export const worst = (list: ConfigStatus[]): ConfigStatus =>
  list.reduce<ConfigStatus>((a, b) => (RANK[b] > RANK[a] ? b : a), list.length ? 'ok' : 'unknown');

export function itemStatus(item?: Srv6ReconcileItem | null): VrStatus {
  if (!item) return { status: 'unknown', issues: [] };
  const issues = Array.isArray(item.issues) ? item.issues : [];
  if (issues.length) return { status: item.repaired ? 'repaired' : 'issue', issues };
  return { status: 'ok', issues: [] };
}

/**
 * 对账报告只列出被扫描的 VR；报告存在但未列出的 VR 视为 ok（无差异），
 * 报告缺失（接口失败）则全部 unknown。
 */
export function buildStatusMap(
  topo: Srv6Topology,
  report: (Srv6ReconcileReport & { scope?: string[] }) | null,
): Record<string, VrStatus> {
  const map: Record<string, VrStatus> = {};
  const byUuid = new Map((report?.items || []).map((it) => [String(it.vrUuid || '').trim(), it]));
  // 聚合接口带 scope：精确语义，未覆盖 = 未对账；旧全量接口无 scope：未列出视为一致
  const scoped = Array.isArray(report?.scope);
  topo.nodes.forEach((n) => {
    if (!report) map[n.uuid] = { status: 'unknown', issues: [] };
    else if (byUuid.has(n.uuid)) map[n.uuid] = itemStatus(byUuid.get(n.uuid));
    else map[n.uuid] = { status: scoped ? 'unknown' : 'ok', issues: [] };
  });
  return map;
}

/** 隧道四端 uuid */
export function tunnelEndUuids(topo: Srv6Topology, tunnelId: string): string[] {
  const t = topo.tunnels.find((x) => x.id === tunnelId);
  if (!t) return [];
  const ces = topo.attaches
    .filter((a) => a.tunnelIds.includes(tunnelId))
    .map((a) => topo.nodes.find((n) => n.id === a.ceNodeId)?.uuid)
    .filter(Boolean) as string[];
  return [t.sourceUuid, t.targetUuid, ...ces];
}

export function tunnelStatus(
  topo: Srv6Topology,
  tunnelId: string,
  statusMap: Record<string, VrStatus>,
): ConfigStatus {
  return worst(tunnelEndUuids(topo, tunnelId).map((u) => statusMap[u]?.status || 'unknown'));
}

/** 从 IBR 实例目录构建 uuid → 运行态（与实例列表同一套判定） */
export function buildRuntimeMap(vrs: IbrVrRow[] | null | undefined): Record<string, RuntimeStatus> {
  const map: Record<string, RuntimeStatus> = {};
  (vrs || []).forEach((row) => {
    const id = ibrVrRowId(row);
    if (!id) return;
    map[id] = getVrHealthStatusKey(row.health_status ?? row.healthStatus ?? row.status);
  });
  return map;
}

export function runtimeOf(map: Record<string, RuntimeStatus> | null | undefined, uuid: string): RuntimeStatus {
  return map?.[uuid] || 'unknown';
}

export function isStopped(rt: RuntimeStatus): boolean {
  return rt === 'stopped';
}

/** 隧道两端 PE 任一已停止 → 端点离线（不看 CE） */
export function tunnelPeOffline(
  topo: Srv6Topology,
  tunnelId: string,
  runtimeMap: Record<string, RuntimeStatus>,
): boolean {
  const t = topo.tunnels.find((x) => x.id === tunnelId);
  if (!t) return false;
  return isStopped(runtimeOf(runtimeMap, t.sourceUuid)) || isStopped(runtimeOf(runtimeMap, t.targetUuid));
}

/** 接入边：PE 或 CE 已停止 → 离线提示 */
export function attachOffline(
  peUuid: string,
  ceUuid: string,
  runtimeMap: Record<string, RuntimeStatus>,
): boolean {
  return isStopped(runtimeOf(runtimeMap, peUuid)) || isStopped(runtimeOf(runtimeMap, ceUuid));
}

export function countOfflineNodes(topo: Srv6Topology, runtimeMap: Record<string, RuntimeStatus>): number {
  return topo.nodes.filter((n) => isStopped(runtimeOf(runtimeMap, n.uuid))).length;
}

export type Selection = { kind: 'node' | 'tunnel' | 'attach'; id: string } | null;

/** 选中后需要保持高亮的节点/边 id（边 id 与 toFlowElements 一致） */
export function relatedIds(topo: Srv6Topology, sel: Selection): Set<string> | null {
  if (!sel) return null;
  if (sel.kind === 'attach') {
    const a = topo.attaches.find((x) => x.id === sel.id);
    const out = new Set<string>();
    if (a) {
      out.add(a.id);
      out.add(a.peNodeId);
      out.add(a.ceNodeId);
    }
    return out;
  }
  const tunnelIds = new Set<string>();
  if (sel.kind === 'tunnel') tunnelIds.add(sel.id);
  else {
    const n = topo.nodes.find((x) => x.id === sel.id);
    n?.tunnelIds.forEach((id) => tunnelIds.add(id));
  }
  const out = new Set<string>();
  if (sel.kind === 'node') out.add(sel.id);
  topo.tunnels.forEach((t) => {
    if (!tunnelIds.has(t.id)) return;
    out.add(`t:${t.id}`);
    out.add(t.source);
    out.add(t.target);
  });
  topo.attaches.forEach((a) => {
    if (a.tunnelIds.some((id) => tunnelIds.has(id))) {
      out.add(a.id);
      out.add(a.peNodeId);
      out.add(a.ceNodeId);
    }
  });
  return out;
}
