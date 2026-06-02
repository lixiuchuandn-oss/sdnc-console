/**
 * 物理节点运维状态（维护模式 / 隔离 / MaintenanceMode condition）。
 * 与 monitoring/hostSegments 及 Harvester Host 状态语义对齐。
 */
import type { NodeRow } from './nodesSectionUtils';

export const MAINTENANCE_STATUS_ANNOTATION = 'harvesterhci.io/maintain-status';
export const NODE_SCHEDULABLE_LABEL = 'kubevirt.io/schedulable';
export const NODE_ROLE_ETCD_LABEL = 'node-role.harvesterhci.io/witness';

export type NodeOpsStatusKey =
  | 'active'
  | 'entering_maintenance'
  | 'maintenance'
  | 'cordoned'
  | 'other';

export type NodeMaintenanceModeCondition = {
  type: string;
  status?: string;
  reason?: string;
  message?: string;
};

export type NodeOpsStatus = {
  key: NodeOpsStatusKey;
  label: string;
  badgeClass: string;
  maintenanceCondition?: NodeMaintenanceModeCondition | null;
};

const LABELS: Record<NodeOpsStatusKey, string> = {
  active: '活跃',
  entering_maintenance: '进入维护中',
  maintenance: '维护中',
  cordoned: '隔离中',
  other: '其他',
};

const BADGE: Record<NodeOpsStatusKey, string> = {
  active: 'std-badge-success',
  entering_maintenance: 'std-badge-warning',
  maintenance: 'std-badge-warning',
  cordoned: 'std-badge-error',
  other: 'std-badge-default',
};

function nodeRecord(row: unknown): NodeRow & {
  spec?: { unschedulable?: boolean };
  status?: NodeRow['status'] & {
    conditions?: Array<{
      type?: string;
      status?: string;
      reason?: string;
      message?: string;
    }>;
  };
} {
  return row as NodeRow & {
    spec?: { unschedulable?: boolean };
    status?: NodeRow['status'] & {
      conditions?: Array<{
        type?: string;
        status?: string;
        reason?: string;
        message?: string;
      }>;
    };
  };
}

export function getMaintenanceModeCondition(row: unknown): NodeMaintenanceModeCondition | null {
  const conds = nodeRecord(row)?.status?.conditions;
  if (!Array.isArray(conds)) return null;
  const hit = conds.find((c) => String(c?.type || '') === 'MaintenanceMode');
  return hit ? { ...hit, type: 'MaintenanceMode' } : null;
}

export function isNodeInMaintenance(row: unknown): boolean {
  const ann = nodeRecord(row)?.metadata?.annotations?.[MAINTENANCE_STATUS_ANNOTATION];
  return ann === 'completed' || ann === 'running';
}

export function isNodeEnteringMaintenance(row: unknown): boolean {
  return nodeRecord(row)?.metadata?.annotations?.[MAINTENANCE_STATUS_ANNOTATION] === 'running';
}

export function isNodeMaintenanceCompleted(row: unknown): boolean {
  return nodeRecord(row)?.metadata?.annotations?.[MAINTENANCE_STATUS_ANNOTATION] === 'completed';
}

export function isNodeCordoned(row: unknown): boolean {
  const n = nodeRecord(row);
  if (n?.metadata?.labels?.[NODE_ROLE_ETCD_LABEL] !== undefined) return false;
  return n?.spec?.unschedulable === true || n?.metadata?.labels?.[NODE_SCHEDULABLE_LABEL] === 'false';
}

export function canEnableNodeMaintenance(row: unknown): boolean {
  const ann = nodeRecord(row)?.metadata?.annotations?.[MAINTENANCE_STATUS_ANNOTATION];
  return !ann;
}

export function canDisableNodeMaintenance(row: unknown): boolean {
  const ann = nodeRecord(row)?.metadata?.annotations?.[MAINTENANCE_STATUS_ANNOTATION];
  return !!ann;
}

export function parseNodeOpsStatus(row: unknown): NodeOpsStatus {
  const maintenanceCondition = getMaintenanceModeCondition(row);
  let key: NodeOpsStatusKey = 'active';

  if (isNodeMaintenanceCompleted(row)) key = 'maintenance';
  else if (isNodeEnteringMaintenance(row)) key = 'entering_maintenance';
  else if (isNodeCordoned(row)) key = 'cordoned';
  else {
    const ready = nodeRecord(row)?.status?.conditions?.some(
      (c) => String(c?.type || '') === 'Ready' && String(c?.status || '').toLowerCase() === 'true',
    );
    if (ready === false) key = 'other';
  }

  return {
    key,
    label: LABELS[key],
    badgeClass: BADGE[key],
    maintenanceCondition,
  };
}

export function nodeOpsStatusTooltip(status: NodeOpsStatus): string | undefined {
  const c = status.maintenanceCondition;
  if (!c) return undefined;
  const parts = [c.reason, c.message].map((s) => String(s || '').trim()).filter(Boolean);
  return parts.length ? parts.join('：') : undefined;
}

export function nodeDisplayName(row: unknown): string {
  const n = nodeRecord(row);
  return String(n?.name || n?.metadata?.name || '').trim();
}
