/**
 * 告警通知策略
 * 占位，待后续实现
 */
import React from 'react';
import { Empty } from 'antd';

interface Props {
  cloudId: string;
}

const MonitoringAlertNotificationPolicy: React.FC<Props> = ({ cloudId }) => {
  if (!cloudId) return null;
  return (
    <div style={{ padding: 24 }}>
      <Empty description="告警通知策略功能开发中" />
    </div>
  );
};

export default MonitoringAlertNotificationPolicy;
