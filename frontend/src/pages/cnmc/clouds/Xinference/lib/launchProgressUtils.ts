/** Xinference 启动/下载综合进度（0～1）阶段提示 */
import { message } from 'antd';

/** 与启动抽屉一致：progress + instances 轮询间隔 */
export const LAUNCH_PROGRESS_POLL_MS = 2000;

export function matchModelInstanceUid(instanceUid: string, targetUid: string): boolean {
  return (
    instanceUid === targetUid ||
    instanceUid.startsWith(`${targetUid}-`) ||
    targetUid.startsWith(instanceUid)
  );
}

export function launchProgressHint(ratio: number): string {
  const p = ratio * 100;
  if (p < 5) return '已向集群提交启动任务…';
  if (p < 35) return '正在下载或准备模型文件（首次启动可能较久）…';
  if (p < 85) return '正在加载推理引擎与模型权重…';
  if (p < 100) return '即将完成，正在就绪…';
  return '启动完成';
}

/** CREATING 超过该秒数视为可能卡住（启发式） */
export const STUCK_CREATING_SEC = 30 * 60;

export const XINFERENCE_CANCEL_STALE_MSG =
  '取消接口已失效（元数据可能已异常）。若列表仍显示该任务，请点「清理记录」；下载线程若仍在后台，请在节点执行 stop.sh → start.sh。';

export const XINFERENCE_CANCEL_RESTART_HINT =
  '若 Xinference 日志仍在下载，请勿重复取消；请在集群节点执行 stop.sh / start.sh 彻底停止。';

export function isLikelyStuckCreating(instance: {
  status: string;
  instanceCreatedTs?: number;
}): boolean {
  if (instance.status.toUpperCase() !== 'CREATING') return false;
  if (instance.instanceCreatedTs == null || !Number.isFinite(instance.instanceCreatedTs)) return false;
  return Date.now() / 1000 - instance.instanceCreatedTs > STUCK_CREATING_SEC;
}

export function hasMissingReplicas(instance: {
  status: string;
  replicaStatuses: unknown[];
}): boolean {
  return instance.status.toUpperCase() === 'CREATING' && instance.replicaStatuses.length === 0;
}

export function isCancelStaleErrorMessage(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('has not been launched yet') ||
    m.includes('not been launched') ||
    m.includes('keyerror')
  );
}

export function instanceStatusLabel(status: string): string {
  const s = status.toUpperCase();
  if (s === 'CREATING') return '下载/加载中';
  if (s === 'READY') return '已就绪';
  if (s === 'ERROR') return '失败';
  if (s === 'TERMINATED') return '已终止';
  return status || '—';
}

export function instanceStatusColor(status: string): string {
  const s = status.toUpperCase();
  if (s === 'CREATING') return 'processing';
  if (s === 'READY') return 'success';
  if (s === 'ERROR') return 'error';
  if (s === 'TERMINATED') return 'default';
  return 'default';
}

/** 是否属于「下载/加载任务」视图应展示的实例 */
export function isActiveDownloadInstance(status: string): boolean {
  const s = status.toUpperCase();
  return s === 'CREATING' || s === 'ERROR';
}

export function formatUnixTs(ts?: number): string {
  if (ts == null || !Number.isFinite(ts)) return '—';
  try {
    return new Date(ts * 1000).toLocaleString();
  } catch {
    return '—';
  }
}

export function collectInstanceErrorMessage(
  replicaStatuses: { errorMessage?: string | null }[],
): string | null {
  for (const r of replicaStatuses) {
    const msg = r.errorMessage?.trim();
    if (msg) return msg;
  }
  return null;
}

/** 副本 → 实例 → ERROR 兜底（Worker 日志里的错误通常进不了 API） */
export function resolveInstanceErrorMessage(instance: {
  status: string;
  errorMessage?: string | null;
  replicaStatuses: { errorMessage?: string | null }[];
}): string | null {
  if (hasMissingReplicas(instance)) {
    return 'Worker 未就绪，建议取消后重试';
  }
  const fromReplica = collectInstanceErrorMessage(instance.replicaStatuses);
  if (fromReplica) return fromReplica;
  const fromInstance = instance.errorMessage?.trim();
  if (fromInstance) return fromInstance;
  if (instance.status.toUpperCase() === 'ERROR') {
    return '启动失败（详见 Xinference 集群日志）';
  }
  return null;
}

/** 自 Unix 秒时间戳起的已等待时长（人类可读） */
export function formatElapsedSince(ts?: number): string {
  if (ts == null || !Number.isFinite(ts)) return '—';
  const sec = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (sec < 60) return `${sec} 秒`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return remMin > 0 ? `${hr} 小时 ${remMin} 分` : `${hr} 小时`;
}

/** 清理实例元数据失败时的用户提示 */
export function notifyRemoveInstanceMetadataFailure(error: unknown): void {
  const err = error as Error & { hint?: string };
  const detail = err?.message?.trim() || '清理实例记录失败';
  const lower = detail.toLowerCase();
  let hint = err?.hint?.trim();
  if (!hint) {
    if (/still registered|still running/i.test(lower)) {
      hint = '该模型仍在运行，请先在列表点击「终止」';
    } else if (/no instance metadata|not found/i.test(lower)) {
      hint = '记录可能已被清理，请刷新列表';
    }
  }
  message.warning({
    content: hint ? `${detail}。${hint}` : detail,
    duration: 8,
  });
}

/** 取消失败时的用户提示；返回 true 表示僵尸下载 / cancel 已失效，需重启集群 */
export function notifyCancelLaunchFailure(error: unknown): boolean {
  const err = error as Error & { hint?: string };
  const detail = err?.message?.trim() || '取消失败';
  const stale = isCancelStaleErrorMessage(detail);
  if (stale) {
    message.warning({ content: XINFERENCE_CANCEL_STALE_MSG, duration: 10 });
    return true;
  }
  const hint = err?.hint?.trim() || XINFERENCE_CANCEL_RESTART_HINT;
  message.warning({ content: `${detail}。${hint}`, duration: 8 });
  return false;
}
