import React from 'react';
import { Empty } from 'antd';
import LogsConfig from '../../../../Harvester/monitoring/LogsConfig';
import LogsTarget from '../../../../Harvester/monitoring/LogsTarget';
import LogOutputs from '../../../../Harvester/monitoring/LogOutputs';
import { LoggingProvider } from '../../../../Harvester/monitoring/context/LoggingContext';

export type CloudmapLogsConfigTabProps = {
  cloudId: string;
  checkPerm: (act: string) => boolean;
  innerActiveKey: string;
};

function canViewLogsInner(key: string, checkPerm: (a: string) => boolean): boolean {
  if (key === 'logs-target') return checkPerm('clouds.log-targets:read');
  if (key === 'log-outputs') return checkPerm('clouds.log-receivers:read');
  if (key === 'logs-flow-config') return checkPerm('clouds.log-configs:read');
  return false;
}

/** Cloudmap 详情 — 日志管理（侧栏路径驱动，无内层 Tabs） */
const CloudmapLogsConfigTab: React.FC<CloudmapLogsConfigTabProps> = ({
  cloudId,
  checkPerm,
  innerActiveKey,
}) => {
  if (!canViewLogsInner(innerActiveKey, checkPerm)) {
    return <Empty description="无权限访问" style={{ marginTop: 48 }} />;
  }

  let body: React.ReactNode;
  switch (innerActiveKey) {
    case 'logs-target':
      body = <LogsTarget cloudId={cloudId} />;
      break;
    case 'log-outputs':
      body = <LogOutputs cloudId={cloudId} />;
      break;
    case 'logs-flow-config':
      body = <LogsConfig cloudId={cloudId} />;
      break;
    default:
      body = <Empty description="未知页面" style={{ marginTop: 48 }} />;
  }

  return <LoggingProvider cloudId={cloudId}>{body}</LoggingProvider>;
};

export default CloudmapLogsConfigTab;
