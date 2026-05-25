import type { ColumnsType } from 'antd/es/table';
import type { HmsNic } from '../physicalNodeDetailDrawerLib';

/** 物理节点详情抽屉 · Tab 组装上下文（Harvester 节点 + HMS 库存） */
export type PhysicalNodeDetailTabContext = {
  record: Record<string, unknown>;
  titleName: string;
  ready: boolean;
  nodeRoles: string[];
  internalIP: string;
  harvesterVersion: string;
  annotations: Record<string, unknown>;
  ntp: { ntpSyncStatus?: string; currentNtpServers?: string } | null;
  podRequests: Record<string, unknown> | null;
  podLimits: Record<string, unknown> | null;
  nics: HmsNic[];
  nicColumns: ColumnsType<HmsNic>;
  hardware: Record<string, unknown> | null;
  physicalIfaces: string[];
  ifaceStatusMap: Record<string, string>;
  metrics?: { cpuUsedCores?: number; memUsedBytes?: number };
};

export type NodeStatusSummary = {
  capacity?: { cpu?: string; memory?: string };
  allocatable?: { cpu?: string; memory?: string };
  nodeInfo?: Record<string, string>;
};
