/**
 * 告警通知
 * 展示告警通知相关配置与记录（占位，待后续实现）
 */
import React from 'react';
import { Empty } from 'antd';

interface MonitoringAlertNotificationsProps {
  cloudId: string;
}

const MonitoringAlertNotifications: React.FC<MonitoringAlertNotificationsProps> = ({ cloudId }) => {
  if (!cloudId) return null;
  return (
    <div style={{ padding: 24 }}>
      <Empty description="告警通知功能开发中" />
    </div>
  );
};

export default MonitoringAlertNotifications;
