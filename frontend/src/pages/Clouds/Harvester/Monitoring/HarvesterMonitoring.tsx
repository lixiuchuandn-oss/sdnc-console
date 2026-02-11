import React from 'react';
import { Tabs } from 'antd';
import MonitoringOverview from './MonitoringOverview';
import MonitoringAlerts from './MonitoringAlerts';
import LogsConfig from './LogsConfig';
import LogOutputs from './LogOutputs';
import LogsFlowConfig from './LogsFlowConfig';
import LogsOutputConfig from './LogsOutputConfig';

interface HarvesterMonitoringProps {
  cloudId: string;
}

const HarvesterMonitoring: React.FC<HarvesterMonitoringProps> = ({ cloudId }) => {
  return (
    <Tabs
      defaultActiveKey="overview"
      tabPosition="top"
      type="line"
      destroyInactiveTabPane
      items={[
        {
          key: 'overview',
          label: '概览',
          children: <MonitoringOverview cloudId={cloudId} />,
        },
        {
          key: 'alerts',
          label: '监控告警',
          children: <MonitoringAlerts cloudId={cloudId} />,
        },
        {
          key: 'logs-config',
          label: '集群日志配置',
          children: <LogsConfig cloudId={cloudId} />,
        },
        {
          key: 'log-outputs',
          label: '集群日志外发',
          children: <LogOutputs cloudId={cloudId} />,
        },
        {
          key: 'logs-flow-config',
          label: '命名空间日志配置',
          children: <LogsFlowConfig cloudId={cloudId} />,
        },
        {
          key: 'logs-output-config',
          label: '命名空间日志外发',
          children: <LogsOutputConfig cloudId={cloudId} />,
        },
      ]}
    />
  );
};

export default HarvesterMonitoring;
