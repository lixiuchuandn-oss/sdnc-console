import type { ReactNode } from "react";

/** 诊断聚合结果（供 UI 步骤与摘要使用） */
export interface DiagnosisResult {
  vmStatus?: any;
  vmiStatus?: any;
  podInfo?: any;
  podLogs?: {
    checked: boolean;
    error?: string;
    highlights: string[];
    hints: string[];
    summary?: string;
    suggestions?: string[];
    severity?: "error" | "warning" | "info";
  };
  events?: any[];
  nodeAffinity?: {
    required: boolean;
    valid: boolean;
    checked: boolean;
    label: string;
    nodesWithLabel: number;
    totalNodes?: number;
    matchedNodeNames?: string[];
    message: string;
  };
  nodeSelector?: {
    configured: boolean;
    checked: boolean;
    selector: Record<string, string>;
    matchedNodeNames?: string[];
    totalNodes?: number;
    message: string;
  };
  podSchedulingAffinity?: {
    configured: boolean;
    valid: boolean;
    affinityRequiredCount: number;
    affinityPreferredCount: number;
    antiAffinityRequiredCount: number;
    antiAffinityPreferredCount: number;
    message: string;
    summary: string;
  };
  resources?: {
    cpuRequest: string;
    memoryRequest: string;
    cpuLimit: string;
    memoryLimit: string;
    nodeResourceCheck?: {
      checked: boolean;
      sufficient: boolean;
      message: string;
      requiredCpu?: string;
      requiredMemory?: string;
      nodes?: Array<{
        name: string;
        totalCpu: string;
        totalMemory: string;
        usedCpu: string;
        usedMemory: string;
        availableCpu: string;
        availableMemory: string;
        cpuSufficient: boolean;
        memorySufficient: boolean;
        sufficient: boolean;
      }>;
    };
  };
  pvcStatus?: any[];
  networkStatus?: {
    multusNetworks: any[];
    message: string;
  };
  eventAnalysis?: {
    podCreateDeleteCycle: boolean;
    podCreateCount: number;
    podDeleteCount: number;
    vmiStoppedCount: number;
    recentPattern: string;
    suggestions: string[];
    ipExhaustionNodes?: string[];
    volumeConflictDetails?: Array<{
      volume: string;
      currentNode: string;
      targetNode: string;
    }>;
  };
}

export type StepStatus = "wait" | "process" | "finish" | "error";

export interface DiagnosisStep {
  key: string;
  title: string;
  description?: string;
  status: StepStatus;
  content?: ReactNode;
}
