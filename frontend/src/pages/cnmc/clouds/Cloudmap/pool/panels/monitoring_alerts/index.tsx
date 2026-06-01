import React from 'react';
import { Empty } from 'antd';
import MonitoringOpsDashboard from '../../../../Harvester/monitoring/MonitoringOpsDashboard';
import MonitoringOpsAlertDashboard from '../../../../Harvester/monitoring/MonitoringOpsAlertDashboard';
import MonitoringPrometheusRules from '../../../../Harvester/monitoring/MonitoringPrometheusRules';
import MonitoringAlertNotificationPolicy from '../../../../Harvester/monitoring/MonitoringAlertNotificationPolicy';
import MonitoringAlertNotificationTargets from '../../../../Harvester/monitoring/MonitoringAlertNotificationTargets';
import MonitoringAlertSecrets from '../../../../Harvester/monitoring/MonitoringAlertSecrets';
import MonitoringAccessManagement from '../../../../Harvester/monitoring/MonitoringAccessManagement';
import { MonitoringProvider } from '../../../../Harvester/monitoring/context/MonitoringContext';
import { canViewMonitoringSidebarLeaf } from '../../../../Harvester/monitoring/lib/monitoringPageAccess';

export type CloudmapMonitoringAlertsRoutePanelProps = {
  cloudId: string;
  checkPerm: (act: string) => boolean;
  innerActiveKey: string;
};

/** Cloudmap 池 — 监控告警（侧栏 + 路由 RoutePanel） */
const CloudmapMonitoringAlertsRoutePanel: React.FC<CloudmapMonitoringAlertsRoutePanelProps> = ({
  cloudId,
  checkPerm,
  innerActiveKey,
}) => {
  if (!canViewMonitoringSidebarLeaf(innerActiveKey, checkPerm)) {
    return <Empty description="无权限访问" style={{ marginTop: 48 }} />;
  }

  let body: React.ReactNode;
  switch (innerActiveKey) {
    case 'ops-alert-dashboard':
      body = <MonitoringOpsAlertDashboard cloudId={cloudId} checkPerm={checkPerm} />;
      break;
    case 'alerts-list':
      body = <MonitoringOpsDashboard cloudId={cloudId} />;
      break;
    case 'alert-rules':
      body = <MonitoringPrometheusRules cloudId={cloudId} />;
      break;
    case 'notification-policy':
      body = <MonitoringAlertNotificationPolicy cloudId={cloudId} />;
      break;
    case 'notification-targets':
      body = <MonitoringAlertNotificationTargets cloudId={cloudId} />;
      break;
    case 'alert-secrets':
      body = <MonitoringAlertSecrets cloudId={cloudId} />;
      break;
    case 'access-management':
      body = <MonitoringAccessManagement cloudId={cloudId} />;
      break;
    default:
      body = <Empty description="未知页面" style={{ marginTop: 48 }} />;
  }

  return <MonitoringProvider cloudId={cloudId}>{body}</MonitoringProvider>;
};

export default CloudmapMonitoringAlertsRoutePanel;
