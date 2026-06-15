/**
 * 存储 DRS（SDRS）— Tower 策略、任务与 Ceph 池聚合。
 */
import { randomUUID } from 'crypto';
import { AppDataSource } from '../../../config/database';
import { fetchCephDashboardApi } from '../../../routes/clouds/harvester/handlers/monitoring-ceph-dashboard.handlers';
import { findCephToolboxPod } from './sdrsRbdExec';
import { runRbdLiveMigration } from './sdrsRbdMigration';
import { listVmMigratableDisks, resolvePvcRbd } from './sdrsRbdResolve';
import type {
  SdrsMode,
  SdrsOverview,
  SdrsPolicyRow,
  SdrsPoolSummary,
  SdrsTaskPhase,
  SdrsTaskRow,
} from './sdrsTypes';

const DEFAULT_CAPACITY_THRESHOLD = 85;
const DEFAULT_LATENCY_THRESHOLD_MS = 20;

function cloudOrigin(endpoint: string): string {
  const base = String(endpoint || '').replace(/\/+$/, '');
  try {
    const u = new URL(base);
    return `${u.protocol}//${u.host}`;
  } catch {
    return base.replace(/\/v[0-9].*$/, '');
  }
}

function normalizeMode(raw: unknown): SdrsMode {
  const m = String(raw || 'manual')
    .trim()
    .toLowerCase();
  if (m === 'semi' || m === 'auto') return m;
  return 'manual';
}

function rowToPolicy(row: SdrsPolicyRow | undefined) {
  return {
    enabled: !!row?.enabled,
    mode: normalizeMode(row?.mode),
    capacityThresholdPct: Number(row?.capacityThresholdPct ?? DEFAULT_CAPACITY_THRESHOLD),
    latencyThresholdMs: Number(row?.latencyThresholdMs ?? DEFAULT_LATENCY_THRESHOLD_MS),
  };
}

async function getPolicyRow(cloudId: string): Promise<SdrsPolicyRow | undefined> {
  const rows = await AppDataSource.query(
    `SELECT cloudId, enabled, mode, capacityThresholdPct, latencyThresholdMs, updatedAt
     FROM cloud_sdrs_policy WHERE cloudId = ? LIMIT 1`,
    [cloudId],
  );
  return rows[0] as SdrsPolicyRow | undefined;
}

async function ensurePolicyRow(cloudId: string): Promise<SdrsPolicyRow> {
  let row = await getPolicyRow(cloudId);
  if (row) return row;
  await AppDataSource.query(
    `INSERT INTO cloud_sdrs_policy (cloudId, enabled, mode, capacityThresholdPct, latencyThresholdMs, updatedAt)
     VALUES (?, 0, 'manual', ?, ?, datetime('now'))`,
    [cloudId, DEFAULT_CAPACITY_THRESHOLD, DEFAULT_LATENCY_THRESHOLD_MS],
  );
  row = await getPolicyRow(cloudId);
  return row!;
}

function mapTaskRow(r: any): SdrsTaskRow {
  return {
    id: String(r.id),
    cloudId: String(r.cloudId),
    vmNamespace: String(r.vmNamespace),
    vmName: String(r.vmName),
    pvcName: String(r.pvcName),
    srcPool: String(r.srcPool),
    srcImage: String(r.srcImage),
    dstPool: String(r.dstPool),
    dstImage: String(r.dstImage),
    reason: String(r.reason || 'manual'),
    phase: String(r.phase) as SdrsTaskPhase,
    message: r.message != null ? String(r.message) : null,
    createdAt: String(r.createdAt),
    finishedAt: r.finishedAt != null ? String(r.finishedAt) : null,
  };
}

async function listTasks(cloudId: string, limit = 50): Promise<SdrsTaskRow[]> {
  const rows = await AppDataSource.query(
    `SELECT * FROM cloud_sdrs_tasks WHERE cloudId = ? ORDER BY createdAt DESC LIMIT ?`,
    [cloudId, limit],
  );
  return rows.map(mapTaskRow);
}

async function updateTaskPhase(
  taskId: string,
  phase: SdrsTaskPhase,
  message?: string,
  finished = false,
) {
  if (finished) {
    await AppDataSource.query(
      `UPDATE cloud_sdrs_tasks SET phase = ?, message = ?, finishedAt = datetime('now') WHERE id = ?`,
      [phase, message ?? null, taskId],
    );
  } else {
    await AppDataSource.query(`UPDATE cloud_sdrs_tasks SET phase = ?, message = ? WHERE id = ?`, [
      phase,
      message ?? null,
      taskId,
    ]);
  }
}

async function listCephPools(cloud: {
  endpoint?: string;
  secretKey?: string;
  config?: any;
  id?: string;
}): Promise<SdrsPoolSummary[]> {
  const token = cloud.secretKey || '';
  const insecure = !!(cloud.config as any)?.ignoreTls;
  const origin = cloudOrigin(String(cloud.endpoint || ''));
  const namespace =
    String((cloud.config as any)?.cephRookNamespace || 'rook-ceph').trim() || 'rook-ceph';
  const rancherHint = String((cloud.config as any)?.rancherClusterId || '').trim() || undefined;
  try {
    const data = await fetchCephDashboardApi(
      origin,
      token,
      insecure,
      namespace,
      'api/pool?stats=true',
      {
        rancherClusterIdHint: rancherHint,
      },
    );
    const pools = Array.isArray(data) ? data : [];
    return pools
      .map((p: any) => {
        const stats = p?.stats || p?.pool_stats || {};
        const used = Number(stats.bytes_used ?? stats.used ?? 0);
        const total = Number(stats.max_avail ?? stats.total_bytes ?? stats.num_bytes ?? 0) + used;
        const usedPercent = total > 0 ? Math.round((used / total) * 1000) / 10 : undefined;
        return {
          name: String(p?.pool_name || p?.pool || p?.name || '').trim(),
          usedPercent,
          stats: typeof stats === 'object' ? stats : undefined,
        };
      })
      .filter((p) => p.name);
  } catch {
    return [];
  }
}

async function probeCephReady(
  cloud: { endpoint?: string; secretKey?: string; config?: any },
  pools: SdrsPoolSummary[],
) {
  const toolbox = await findCephToolboxPod(cloud);
  return {
    toolboxAvailable: !!toolbox,
    toolboxPod: toolbox?.podName,
    toolboxNamespace: toolbox?.namespace,
    dashboardAvailable: pools.length > 0,
    message: toolbox
      ? undefined
      : '未检测到存储运维工具 Pod；手动迁盘需部署运维工具或设置 SDRS_MOCK_MIGRATION=1 做演示',
  };
}

export async function getSdrsOverview(cloud: {
  id: string;
  endpoint?: string;
  secretKey?: string;
  config?: any;
}): Promise<SdrsOverview> {
  const policyRow = await ensurePolicyRow(cloud.id);
  const tasksRecent = await listTasks(cloud.id, 20);
  const pools = await listCephPools(cloud);
  const cephReady = await probeCephReady(cloud, pools);
  const running = tasksRecent.filter((t) =>
    ['pending', 'preparing', 'executing', 'committing'].includes(t.phase),
  ).length;
  const failed = tasksRecent.filter((t) => t.phase === 'failed').length;
  return {
    policy: rowToPolicy(policyRow),
    cephReady,
    pools,
    tasksRecent,
    summary: {
      totalTasks: tasksRecent.length,
      running,
      failed,
    },
  };
}

export async function updateSdrsPolicy(
  cloudId: string,
  input: {
    enabled?: boolean;
    mode?: SdrsMode;
    capacityThresholdPct?: number;
    latencyThresholdMs?: number;
  },
) {
  await ensurePolicyRow(cloudId);
  const row = await getPolicyRow(cloudId);
  const enabled = input.enabled != null ? (input.enabled ? 1 : 0) : Number(row?.enabled ?? 0);
  const mode = input.mode != null ? normalizeMode(input.mode) : normalizeMode(row?.mode);
  const capacityThresholdPct =
    input.capacityThresholdPct != null
      ? Number(input.capacityThresholdPct)
      : Number(row?.capacityThresholdPct ?? DEFAULT_CAPACITY_THRESHOLD);
  const latencyThresholdMs =
    input.latencyThresholdMs != null
      ? Number(input.latencyThresholdMs)
      : Number(row?.latencyThresholdMs ?? DEFAULT_LATENCY_THRESHOLD_MS);
  await AppDataSource.query(
    `UPDATE cloud_sdrs_policy SET enabled = ?, mode = ?, capacityThresholdPct = ?, latencyThresholdMs = ?, updatedAt = datetime('now') WHERE cloudId = ?`,
    [enabled, mode, capacityThresholdPct, latencyThresholdMs, cloudId],
  );
  return rowToPolicy(await getPolicyRow(cloudId));
}

export async function getSdrsPools(cloud: {
  id: string;
  endpoint?: string;
  secretKey?: string;
  config?: any;
}) {
  return listCephPools(cloud);
}

export async function getVmSdrsDisks(
  cloud: { endpoint?: string; secretKey?: string; config?: any },
  vmNamespace: string,
  vmName: string,
) {
  return listVmMigratableDisks(cloud, vmNamespace, vmName);
}

export async function getSdrsTask(cloudId: string, taskId: string) {
  const rows = await AppDataSource.query(
    `SELECT * FROM cloud_sdrs_tasks WHERE cloudId = ? AND id = ? LIMIT 1`,
    [cloudId, taskId],
  );
  if (!rows[0]) return null;
  return mapTaskRow(rows[0]);
}

async function executeTaskAsync(
  cloud: { endpoint?: string; secretKey?: string; config?: any },
  taskId: string,
) {
  setImmediate(async () => {
    try {
      await updateTaskPhase(taskId, 'preparing', '准备在线迁盘');
      const rows = await AppDataSource.query(
        `SELECT * FROM cloud_sdrs_tasks WHERE id = ? LIMIT 1`,
        [taskId],
      );
      const t = rows[0];
      if (!t) return;
      await runRbdLiveMigration(
        cloud,
        t.srcPool,
        t.srcImage,
        t.dstPool,
        t.dstImage,
        (step, detail) => {
          const phase =
            step === 'prepare' ? 'preparing' : step === 'execute' ? 'executing' : 'committing';
          void updateTaskPhase(taskId, phase as SdrsTaskPhase, detail.slice(0, 2000));
        },
      );
      await updateTaskPhase(taskId, 'succeeded', '迁移完成', true);
    } catch (e: any) {
      await updateTaskPhase(taskId, 'failed', e?.message || String(e), true);
    }
  });
}

export async function createSdrsTask(
  cloud: { id: string; endpoint?: string; secretKey?: string; config?: any },
  input: {
    vmNamespace: string;
    vmName: string;
    pvcName: string;
    targetPool: string;
    targetImage?: string;
  },
) {
  const ns = String(input.vmNamespace || '').trim();
  const vmName = String(input.vmName || '').trim();
  const pvcName = String(input.pvcName || '').trim();
  const dstPool = String(input.targetPool || '').trim();
  if (!ns || !vmName || !pvcName || !dstPool) {
    throw new Error('缺少 vmNamespace、vmName、pvcName 或 targetPool');
  }

  const disk = await resolvePvcRbd(cloud, ns, pvcName);
  if (!disk.migratable || !disk.pool || !disk.image) {
    throw new Error(disk.skipReason || '该 PVC 不可迁移');
  }
  if (disk.pool === dstPool) {
    throw new Error('目标存储池与当前存储池相同');
  }

  const dstImage = String(input.targetImage || disk.image).trim() || disk.image;
  const id = randomUUID();
  await AppDataSource.query(
    `INSERT INTO cloud_sdrs_tasks (
      id, cloudId, vmNamespace, vmName, pvcName,
      srcPool, srcImage, dstPool, dstImage,
      reason, phase, message, createdAt, finishedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', 'pending', NULL, datetime('now'), NULL)`,
    [id, cloud.id, ns, vmName, pvcName, disk.pool, disk.image, dstPool, dstImage],
  );

  void executeTaskAsync(cloud, id);
  return getSdrsTask(cloud.id, id);
}

export async function listSdrsTasks(cloudId: string, limit = 100) {
  return listTasks(cloudId, limit);
}
