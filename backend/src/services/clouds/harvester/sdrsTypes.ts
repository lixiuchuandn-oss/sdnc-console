export type SdrsMode = 'manual' | 'semi' | 'auto';

export type SdrsTaskPhase =
  | 'pending'
  | 'preparing'
  | 'executing'
  | 'committing'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export type SdrsPolicyRow = {
  cloudId: string;
  enabled: number;
  mode: SdrsMode;
  capacityThresholdPct: number;
  latencyThresholdMs: number;
  updatedAt: string;
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

export type SdrsPoolSummary = {
  name: string;
  usedPercent?: number;
  stats?: Record<string, unknown>;
};

export type SdrsCephReady = {
  toolboxAvailable: boolean;
  toolboxPod?: string;
  toolboxNamespace?: string;
  dashboardAvailable: boolean;
  message?: string;
};

export type SdrsOverview = {
  policy: {
    enabled: boolean;
    mode: SdrsMode;
    capacityThresholdPct: number;
    latencyThresholdMs: number;
  };
  cephReady: SdrsCephReady;
  pools: SdrsPoolSummary[];
  tasksRecent: SdrsTaskRow[];
  summary: {
    totalTasks: number;
    running: number;
    failed: number;
  };
};
