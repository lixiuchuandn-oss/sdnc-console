/**
 * 云监控业务域权限门控（与 backend atoms、cloudmapPoolNavRows 对齐）。
 * 不改变侧栏/页内 Tab 结构，仅统一 read/write 判定。
 */
import {
  CLOUD_ALERT_POLICIES_READ,
  CLOUD_ALERT_RECEIVERS_READ,
  CLOUD_ALERT_RULES_READ,
  CLOUD_ALERT_SECRETS_READ,
  CLOUD_ALERTS_READ,
  CLOUD_MONITORING_OVERVIEW_READ,
} from '../../../../../../constants/cloudPermissions';

/** 侧栏：运维监控（Prometheus 大盘） */
export const MONITORING_OPS_LIST_READ = CLOUD_MONITORING_OVERVIEW_READ;

/** 侧栏：运维告警 / 接入管理 */
export const MONITORING_ALERTS_SIDEBAR_READ = CLOUD_ALERTS_READ;

/** 仅有子域权限时也可进入「运维告警」页（页内 Tab 结构不变） */
export const OPS_ALERT_DASHBOARD_ENTRY_READS: readonly string[] = [
  MONITORING_ALERTS_SIDEBAR_READ,
  CLOUD_ALERT_RULES_READ,
  CLOUD_ALERT_POLICIES_READ,
  CLOUD_ALERT_RECEIVERS_READ,
  CLOUD_ALERT_SECRETS_READ,
];

export function canEnterOpsAlertDashboard(checkPerm: (action: string) => boolean): boolean {
  return OPS_ALERT_DASHBOARD_ENTRY_READS.some((act) => checkPerm(act));
}

export type OpsAlertInnerView =
  | 'overview'
  | 'alert-groups'
  | 'alert-rules'
  | 'notification-targets'
  | 'notification-policy'
  | 'alert-secrets';

export function opsAlertInnerViewReadAction(view: OpsAlertInnerView): string {
  switch (view) {
    case 'overview':
      return MONITORING_ALERTS_SIDEBAR_READ;
    case 'alert-groups':
    case 'alert-rules':
      return CLOUD_ALERT_RULES_READ;
    case 'notification-policy':
      return CLOUD_ALERT_POLICIES_READ;
    case 'notification-targets':
      return CLOUD_ALERT_RECEIVERS_READ;
    case 'alert-secrets':
      return CLOUD_ALERT_SECRETS_READ;
    default:
      return MONITORING_ALERTS_SIDEBAR_READ;
  }
}

export function canViewOpsAlertInnerView(
  view: OpsAlertInnerView,
  checkPerm: (action: string) => boolean,
): boolean {
  return checkPerm(opsAlertInnerViewReadAction(view));
}

/** Cloudmap 池 · monitoring_alerts 侧栏叶子（pathSeg / innerActiveKey） */
export function canViewMonitoringSidebarLeaf(
  leafKey: string,
  checkPerm: (action: string) => boolean,
): boolean {
  switch (leafKey) {
    case 'alerts-list':
      return checkPerm(MONITORING_OPS_LIST_READ);
    case 'ops-alert-dashboard':
      return canEnterOpsAlertDashboard(checkPerm);
    case 'access-management':
      return checkPerm(MONITORING_ALERTS_SIDEBAR_READ);
    case 'alert-rules':
      return checkPerm(CLOUD_ALERT_RULES_READ);
    case 'notification-policy':
      return checkPerm(CLOUD_ALERT_POLICIES_READ);
    case 'notification-targets':
      return checkPerm(CLOUD_ALERT_RECEIVERS_READ);
    case 'alert-secrets':
      return checkPerm(CLOUD_ALERT_SECRETS_READ);
    default:
      return false;
  }
}

/** 运维告警页内：是否展示「告警管理 / 通知管理」下拉（至少一项可读） */
export function canViewOpsAlertManagementMenu(checkPerm: (action: string) => boolean): boolean {
  return (
    canViewOpsAlertInnerView('alert-groups', checkPerm) ||
    canViewOpsAlertInnerView('alert-rules', checkPerm)
  );
}

export function canViewOpsNotificationMenu(checkPerm: (action: string) => boolean): boolean {
  return (
    canViewOpsAlertInnerView('notification-policy', checkPerm) ||
    canViewOpsAlertInnerView('notification-targets', checkPerm) ||
    canViewOpsAlertInnerView('alert-secrets', checkPerm)
  );
}

const OPS_ALERT_INNER_VIEW_ORDER: readonly OpsAlertInnerView[] = [
  'overview',
  'alert-groups',
  'alert-rules',
  'notification-policy',
  'notification-targets',
  'alert-secrets',
];

export function firstAccessibleOpsAlertInnerView(
  checkPerm: (action: string) => boolean,
): OpsAlertInnerView | null {
  for (const view of OPS_ALERT_INNER_VIEW_ORDER) {
    if (canViewOpsAlertInnerView(view, checkPerm)) return view;
  }
  return null;
}

/** 云监控侧栏分组是否可见（任一叶子或子域 read） */
export function canViewMonitoringNavGroup(checkPerm: (action: string) => boolean): boolean {
  return (
    checkPerm(MONITORING_OPS_LIST_READ) ||
    checkPerm(MONITORING_ALERTS_SIDEBAR_READ) ||
    checkPerm(CLOUD_ALERT_RULES_READ) ||
    checkPerm(CLOUD_ALERT_POLICIES_READ) ||
    checkPerm(CLOUD_ALERT_RECEIVERS_READ) ||
    checkPerm(CLOUD_ALERT_SECRETS_READ)
  );
}
