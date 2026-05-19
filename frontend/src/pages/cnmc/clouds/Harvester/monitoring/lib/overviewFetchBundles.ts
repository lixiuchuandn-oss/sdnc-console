/**
 * 监控概览「快车道 / 慢车道」各一轮并行请求（与历史 useDashboardNodeData / useDashboardSlowData 对齐）。
 * monitoringApi 走原生 fetch、无去重；若按卡片各自轮询会重复打同一 URL，首轮体感很慢。
 */
import {
  fetchAlertsRules,
  fetchBlockDevices,
  fetchCephDashboardSummary,
  fetchCephResources,
  fetchNodeMetrics,
  fetchNodeResources,
  fetchStorageNodes,
  fetchVirtualMachineInstances,
  fetchVirtualMachines,
} from '../../../../../../services/monitoringApi';
import { fetchHarvesterStorageClasses } from '../../../../../../services/harvesterApi';
import type { NodeMetricsData, NodeResourcesData } from './nodeResourceMetrics';

export interface MonitoringOverviewLaneOutcome<T> {
  data: T;
  laneError: string | null;
}

type MonitoringApiEnvelope = { ok: boolean; error?: string; data: unknown };

function settledToEnvelope(r: PromiseSettledResult<MonitoringApiEnvelope>): MonitoringApiEnvelope {
  if (r.status === 'fulfilled') return r.value;
  const reason = r.reason;
  const msg =
    reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : '请求失败';
  return { ok: false, error: msg, data: null };
}

/** 快车道合并视图：核心（节点 / 指标 / Longhorn）+ 附加（Ceph / 存储类），见两条 fetch 函数 */
export interface MonitoringOverviewFastLaneData {
  nodeResources: NodeResourcesData | null;
  nodeMetrics: NodeMetricsData | null;
  storageNodes: unknown;
  cephHealthMinimal: unknown | null;
  cephResourcesRaw: unknown | null;
  storageClassesJson: unknown | null;
}

const EMPTY_FAST_LANE: MonitoringOverviewFastLaneData = {
  nodeResources: null,
  nodeMetrics: null,
  storageNodes: null,
  cephHealthMinimal: null,
  cephResourcesRaw: null,
  storageClassesJson: null,
};

/**
 * 快车道 · 核心：节点资源 / 节点指标 / Longhorn 存储节点。
 * 无 Ceph 或非 Ceph 池也可独立完成；CPU / 内存 / 物理主机卡仅依赖本段 loading。
 */
export async function fetchMonitoringOverviewFastLaneCoreOutcome(
  cloudId: string,
  signal: AbortSignal,
): Promise<MonitoringOverviewLaneOutcome<MonitoringOverviewFastLaneData>> {
  try {
    const [resourcesResult, metricsResult, storageResult] = await Promise.allSettled([
      fetchNodeResources(cloudId, { signal }),
      fetchNodeMetrics(cloudId, { signal }),
      fetchStorageNodes(cloudId, { signal }),
    ]);

    const resourcesRes = settledToEnvelope(resourcesResult);
    const metricsRes = settledToEnvelope(metricsResult);
    const storageRes = settledToEnvelope(storageResult);

    const errMsg = !resourcesRes.ok
      ? resourcesRes.error
      : !metricsRes.ok
        ? metricsRes.error
        : !storageRes.ok
          ? storageRes.error
          : null;

    return {
      data: {
        nodeResources: resourcesRes.ok ? (resourcesRes.data as NodeResourcesData) : null,
        nodeMetrics: metricsRes.ok ? (metricsRes.data as NodeMetricsData) : null,
        storageNodes: storageRes.ok ? storageRes.data : null,
        cephHealthMinimal: null,
        cephResourcesRaw: null,
        storageClassesJson: null,
      },
      laneError: errMsg ?? null,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { data: EMPTY_FAST_LANE, laneError: msg };
  }
}

/**
 * 快车道 · 附加：Ceph Dashboard minimal、ceph-resources、Harvester 存储类。
 * 无 Ceph / 接口慢时不再阻塞 CPU / 内存卡；储存卡 / 磁盘卡 ceph 侧仍等本段。
 */
export async function fetchMonitoringOverviewFastLaneExtrasOutcome(
  cloudId: string,
  signal: AbortSignal,
): Promise<MonitoringOverviewLaneOutcome<MonitoringOverviewFastLaneData>> {
  try {
    const [cephMinimalResult, cephResourcesResult, storageClassesResult] = await Promise.allSettled([
      fetchCephDashboardSummary(cloudId, { path: 'api/health/minimal', signal }),
      fetchCephResources(cloudId, { signal }),
      fetchHarvesterStorageClasses(cloudId),
    ]);

    const cephMinimalRes = settledToEnvelope(cephMinimalResult);
    const cephResourcesRes = settledToEnvelope(cephResourcesResult);

    let cephHealthMinimal: unknown | null = null;
    if (cephMinimalRes.ok && cephMinimalRes.data != null) {
      const env = cephMinimalRes.data as {
        data?: unknown;
        _tower?: { cephDashboardError?: boolean | string };
      };
      if (!env._tower?.cephDashboardError) {
        cephHealthMinimal = env.data ?? null;
      }
    }

    let cephResourcesRaw: unknown | null = null;
    if (cephResourcesRes.ok && cephResourcesRes.data != null) {
      cephResourcesRaw = cephResourcesRes.data;
    }

    let storageClassesJson: unknown | null = null;
    if (storageClassesResult.status === 'fulfilled') {
      storageClassesJson = storageClassesResult.value ?? null;
    }

    return {
      data: {
        nodeResources: null,
        nodeMetrics: null,
        storageNodes: null,
        cephHealthMinimal,
        cephResourcesRaw,
        storageClassesJson,
      },
      laneError: null,
    };
  } catch {
    return { data: EMPTY_FAST_LANE, laneError: null };
  }
}

/** 慢车道：告警 / 块设备 / VM（~30s） */
export interface MonitoringOverviewSlowLaneData {
  alertsRules: unknown;
  blockDevices: unknown;
  virtualMachines: unknown;
  vmInstances: unknown;
}

const EMPTY_SLOW_LANE: MonitoringOverviewSlowLaneData = {
  alertsRules: null,
  blockDevices: null,
  virtualMachines: null,
  vmInstances: null,
};

export async function fetchMonitoringOverviewSlowLaneOutcome(
  cloudId: string,
  signal: AbortSignal,
): Promise<MonitoringOverviewLaneOutcome<MonitoringOverviewSlowLaneData>> {
  try {
    const [alertsResult, blockResult, vmResult, vmiResult] = await Promise.allSettled([
      fetchAlertsRules(cloudId, { signal }),
      fetchBlockDevices(cloudId, { signal }),
      fetchVirtualMachines(cloudId, { signal }),
      fetchVirtualMachineInstances(cloudId, { signal }),
    ]);

    const alertsRes = settledToEnvelope(alertsResult);
    const blockRes = settledToEnvelope(blockResult);
    const vmRes = settledToEnvelope(vmResult);
    const vmiRes = settledToEnvelope(vmiResult);

    const laneError = !alertsRes.ok
      ? alertsRes.error ?? null
      : !blockRes.ok
        ? blockRes.error ?? null
        : !vmRes.ok
          ? vmRes.error ?? null
          : !vmiRes.ok
            ? vmiRes.error ?? null
            : null;

    return {
      data: {
        alertsRules: alertsRes.ok ? alertsRes.data : null,
        blockDevices: blockRes.ok ? blockRes.data : null,
        virtualMachines: vmRes.ok ? vmRes.data : null,
        vmInstances: vmiRes.ok ? vmiRes.data : null,
      },
      laneError,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { data: EMPTY_SLOW_LANE, laneError: msg };
  }
}
