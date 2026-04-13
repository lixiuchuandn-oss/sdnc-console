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

/** Cloudmap \u8be6\u60c5\u9875 \u2014 \u65e5\u5fd7\u7ba1\u7406 Tab\uff1aLoggingProvider + \u5185\u5c42 Tabs + \u6743\u9650\u8fc7\u6ee4 */
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
          label: '\u65e5\u5fd7\u91c7\u96c6\u5bf9\u8c61',
          children: <LogsTarget cloudId={cloudId} />,
        },
        {
          key: 'log-outputs',
          label: '\u65e5\u5fd7\u63a5\u6536\u7aef',
          children: <LogOutputs cloudId={cloudId} />,
        },
        {
          key: 'logs-flow-config',
          label: '\u65e5\u5fd7\u91c7\u96c6\u914d\u7f6e',
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
