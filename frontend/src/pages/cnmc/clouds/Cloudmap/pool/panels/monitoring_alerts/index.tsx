import React from 'react';
import { Empty } from 'antd';
import MonitoringAlerts from '../../../../Harvester/monitoring/MonitoringAlerts';
import MonitoringPrometheusRules from '../../../../Harvester/monitoring/MonitoringPrometheusRules';
import MonitoringAlertNotificationPolicy from '../../../../Harvester/monitoring/MonitoringAlertNotificationPolicy';
import MonitoringAlertNotificationTargets from '../../../../Harvester/monitoring/MonitoringAlertNotificationTargets';
import MonitoringAlertSecrets from '../../../../Harvester/monitoring/MonitoringAlertSecrets';
import { MonitoringProvider } from '../../../../Harvester/monitoring/context/MonitoringContext';

export type CloudmapMonitoringAlertsTabProps = {
  cloudId: string;
  checkPerm: (act: string) => boolean;
  innerActiveKey: string;
};

function canViewMonitoringInner(key: string, checkPerm: (a: string) => boolean): boolean {
  if (key === 'alerts-list') return checkPerm('clouds.alerts:read');
  if (key === 'alert-rules') return checkPerm('clouds.alert-rules:read');
  if (key === 'notification-policy') return checkPerm('clouds.alert-policies:read');
  if (key === 'notification-targets') return checkPerm('clouds.alert-receivers:read');
  if (key === 'alert-secrets') return checkPerm('clouds.alert-secrets:read');
  return false;
}

/** Cloudmap 详情 — 监控告警（侧栏路径驱动，无内层 Tabs） */
const CloudmapMonitoringAlertsTab: React.FC<CloudmapMonitoringAlertsTabProps> = ({
  cloudId,
  checkPerm,
  innerActiveKey,
}) => {
  if (!canViewMonitoringInner(innerActiveKey, checkPerm)) {
    return <Empty description="无权限访问" style={{ marginTop: 48 }} />;
  }

  let body: React.ReactNode;
  switch (innerActiveKey) {
    case 'alerts-list':
      body = <MonitoringAlerts cloudId={cloudId} />;
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
    default:
      body = <Empty description="未知页面" style={{ marginTop: 48 }} />;
  }

  return <MonitoringProvider cloudId={cloudId}>{body}</MonitoringProvider>;
};

export default CloudmapMonitoringAlertsTab;
