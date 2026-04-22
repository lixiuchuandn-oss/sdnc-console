import React from 'react';
import { Tabs } from 'antd';
import LogsConfig from '../../../Harvester/monitoring/LogsConfig';
import LogsTarget from '../../../Harvester/monitoring/LogsTarget';
import LogOutputs from '../../../Harvester/monitoring/LogOutputs';
import { LoggingProvider } from '../../../Harvester/monitoring/context/LoggingContext';

export type CloudmapLogsConfigTabProps = {
  cloudId: string;
  checkPerm: (act: string) => boolean;
};

/** Cloudmap 详情页 — 日志管理 Tab：LoggingProvider + 内层 Tabs + 权限过滤 */
const CloudmapLogsConfigTab: React.FC<CloudmapLogsConfigTabProps> = ({
  cloudId,
  checkPerm,
}) => (
  <LoggingProvider cloudId={cloudId}>
    <Tabs
      defaultActiveKey="logs-target"
      tabPosition="top"
      type="line"
      destroyOnHidden
      items={[
        {
          key: 'logs-target',
          label: '日志采集对象',
          children: <LogsTarget cloudId={cloudId} />,
        },
        {
          key: 'log-outputs',
          label: '日志接收端',
          children: <LogOutputs cloudId={cloudId} />,
        },
        {
          key: 'logs-flow-config',
          label: '日志采集配置',
          children: <LogsConfig cloudId={cloudId} />,
        },
      ].filter((i: any) => {
        if (i.key === 'logs-target')
          return checkPerm('clouds.log-targets:read');
        if (i.key === 'log-outputs')
          return checkPerm('clouds.log-receivers:read');
        if (i.key === 'logs-flow-config')
          return checkPerm('clouds.log-configs:read');
        return true;
      })}
    />
  </LoggingProvider>
);

export default CloudmapLogsConfigTab;
