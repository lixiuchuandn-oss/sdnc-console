import React from 'react';
import { Tabs } from 'antd';
import MonitoringOverview from '../Monitoring/MonitoringOverview';
import MonitoringAlerts from '../Monitoring/MonitoringAlerts';
import LogsConfig from '../Monitoring/LogsConfig';
import LogOutputs from '../Monitoring/LogOutputs';
import LogsFlowConfig from '../Monitoring/LogsFlowConfig';
import LogsOutputConfig from '../Monitoring/LogsOutputConfig';

interface HarvesterMonitoringProps {
  cloudId: string;
}

const HarvesterLog: React.FC<HarvesterMonitoringProps> = ({ cloudId }) => {
  return (
    <Tabs
      defaultActiveKey="overview"
      tabPosition="top"
      type="line"
      destroyInactiveTabPane
      items={[
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
          label: '租户日志配置',
          children: <LogsFlowConfig cloudId={cloudId} />,
        },
        {
          key: 'logs-output-config',
          label: '租户日志外发',
          children: <LogsOutputConfig cloudId={cloudId} />,
        },
      ]}
    />
  );
};

export default HarvesterLog;
