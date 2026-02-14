/**
 * 告警通知对象
 * 占位，待后续实现
 */
import React from 'react';
import { Empty } from 'antd';

interface Props {
  cloudId: string;
}

const MonitoringAlertNotificationTargets: React.FC<Props> = ({ cloudId }) => {
  if (!cloudId) return null;
  return (
    <div style={{ padding: 24 }}>
      <Empty description="告警通知对象功能开发中" />
    </div>
  );
};

export default MonitoringAlertNotificationTargets;
