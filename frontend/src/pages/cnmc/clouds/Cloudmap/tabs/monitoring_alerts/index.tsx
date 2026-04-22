import React from 'react';
import { Tabs } from 'antd';
import MonitoringAlerts from '../../../Harvester/monitoring/MonitoringAlerts';
import MonitoringPrometheusRules from '../../../Harvester/monitoring/MonitoringPrometheusRules';
import MonitoringAlertNotificationPolicy from '../../../Harvester/monitoring/MonitoringAlertNotificationPolicy';
import MonitoringAlertNotificationTargets from '../../../Harvester/monitoring/MonitoringAlertNotificationTargets';
import MonitoringAlertSecrets from '../../../Harvester/monitoring/MonitoringAlertSecrets';
import { MonitoringProvider } from '../../../Harvester/monitoring/context/MonitoringContext';

export type CloudmapMonitoringAlertsTabProps = {
  cloudId: string;
  checkPerm: (act: string) => boolean;
};

/** Cloudmap 详情 — 监控告警分组（内层 Tabs + 权限过滤） */
const CloudmapMonitoringAlertsTab: React.FC<
  CloudmapMonitoringAlertsTabProps
> = ({ cloudId, checkPerm }) => (
  <MonitoringProvider cloudId={cloudId}>
    <Tabs
      defaultActiveKey="alerts-list"
      tabPosition="top"
      type="line"
      destroyOnHidden
      items={[
        {
          key: 'alerts-list',
          label: '告警列表',
          children: <MonitoringAlerts cloudId={cloudId} />,
        },
        {
          key: 'alert-rules',
          label: '告警规则',
          children: <MonitoringPrometheusRules cloudId={cloudId} />,
        },
        {
          key: 'notification-policy',
          label: '告警通知策略',
          children: (
            <MonitoringAlertNotificationPolicy cloudId={cloudId} />
          ),
        },
        {
          key: 'notification-targets',
          label: '告警通知对象',
          children: (
            <MonitoringAlertNotificationTargets cloudId={cloudId} />
          ),
        },
        {
          key: 'alert-secrets',
          label: '告警密钥',
          children: <MonitoringAlertSecrets cloudId={cloudId} />,
        },
      ].filter((i: any) => {
        if (i.key === 'alerts-list')
          return checkPerm('clouds.alerts:read');
        if (i.key === 'alert-rules')
          return checkPerm('clouds.alert-rules:read');
        if (i.key === 'notification-policy')
          return checkPerm('clouds.alert-policies:read');
        if (i.key === 'notification-targets')
          return checkPerm('clouds.alert-receivers:read');
        if (i.key === 'alert-secrets')
          return checkPerm('clouds.alert-secrets:read');
        return true;
      })}
    />
  </MonitoringProvider>
);

export default CloudmapMonitoringAlertsTab;
