import { apiPost, apiPut, apiRequest } from '../api';

export type SdrsMode = 'manual' | 'semi' | 'auto';

export type SdrsTaskPhase =
  | 'pending'
  | 'preparing'
  | 'executing'
  | 'committing'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export type SdrsPolicy = {
  enabled: boolean;
  mode: SdrsMode;
  capacityThresholdPct: number;
  latencyThresholdMs: number;
};

export type SdrsPoolSummary = {
  name: string;
  usedPercent?: number;
};

export type SdrsTaskRow = {
  id: string;
  cloudId: string;
  vmNamespace: string;
  vmName: string;
  pvcName: string;
  srcPool: string;
  srcImage: string;
  dstPool: string;
  dstImage: string;
  reason: string;
  phase: SdrsTaskPhase;
  message: string | null;
  createdAt: string;
  finishedAt: string | null;
};

export type SdrsMigratableDisk = {
  pvcName: string;
  pool: string;
  image: string;
  storageClassName?: string;
  size?: string;
  migratable: boolean;
  skipReason?: string;
};

export type SdrsOverview = {
  policy: SdrsPolicy;
  cephReady: {
    toolboxAvailable: boolean;
    toolboxPod?: string;
    toolboxNamespace?: string;
    dashboardAvailable: boolean;
    message?: string;
  };
  pools: SdrsPoolSummary[];
  tasksRecent: SdrsTaskRow[];
  summary: {
    totalTasks: number;
    running: number;
    failed: number;
  };
};

export async function fetchSdrsOverview(cloudId: string, force = false) {
  const qs = force ? '?force=true' : '';
  return apiRequest(`/api/clouds/${cloudId}/resources/harvester/sdrs/overview${qs}`, {
    skipCache: true,
  });
}

export async function updateSdrsPolicy(cloudId: string, body: Partial<SdrsPolicy>) {
  return apiPut(`/api/clouds/${cloudId}/resources/harvester/sdrs/policy`, body);
}

export async function fetchSdrsPools(cloudId: string) {
  return apiRequest(`/api/clouds/${cloudId}/resources/harvester/sdrs/pools`, {
    skipCache: true,
  });
}

export async function fetchSdrsVmDisks(cloudId: string, vmNamespace: string, vmName: string) {
  const qs = new URLSearchParams({
    vmNamespace,
    vmName,
  }).toString();
  return apiRequest(`/api/clouds/${cloudId}/resources/harvester/sdrs/disks?${qs}`, {
    skipCache: true,
  });
}

export async function fetchSdrsTasks(cloudId: string) {
  return apiRequest(`/api/clouds/${cloudId}/resources/harvester/sdrs/tasks`, {
    skipCache: true,
  });
}

export async function createSdrsTask(
  cloudId: string,
  body: {
    vmNamespace: string;
    vmName: string;
    pvcName: string;
    targetPool: string;
    targetImage?: string;
  },
) {
  return apiPost(`/api/clouds/${cloudId}/resources/harvester/sdrs/tasks`, body);
}

export const SDRS_MODE_LABELS: Record<SdrsMode, string> = {
  manual: '手动',
  semi: '半自动',
  auto: '全自动',
};

export const SDRS_TASK_PHASE_LABELS: Record<SdrsTaskPhase, string> = {
  pending: '等待中',
  preparing: '准备中',
  executing: '执行中',
  committing: '提交中',
  succeeded: '成功',
  failed: '失败',
  cancelled: '已取消',
};
