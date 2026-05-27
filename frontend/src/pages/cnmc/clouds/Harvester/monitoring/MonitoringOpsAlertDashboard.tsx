import React, { useMemo, useState } from 'react';
import { DownOutlined } from '@ant-design/icons';
import { Dropdown, Space, Tag } from 'antd';
import type { MenuProps } from 'antd';
import OpsAlertOverviewSection from './sections/OpsAlertOverviewSection';
import OpsAlertGroupsSection from './sections/OpsAlertGroupsSection';
import MonitoringAlertNotificationTargets from './MonitoringAlertNotificationTargets';
import MonitoringAlertNotificationPolicy from './MonitoringAlertNotificationPolicy';
import MonitoringAlertSecrets from './MonitoringAlertSecrets';
import MonitoringPrometheusRules from './MonitoringPrometheusRules';

interface MonitoringOpsAlertDashboardProps {
  cloudId: string;
}

type OpsAlertView =
  | 'overview'
  | 'alert-groups'
  | 'alert-rules'
  | 'notification-targets'
  | 'notification-policy'
  | 'alert-secrets';

const NOTIFICATION_MENU_ITEMS: { key: Exclude<OpsAlertView, 'overview'>; label: string }[] = [
  { key: 'notification-policy', label: '通知策略' },
  { key: 'notification-targets', label: '通知对象' },
  { key: 'alert-secrets', label: '通知密钥' },
];
const ALERT_MANAGEMENT_MENU_ITEMS: { key: 'alert-groups' | 'alert-rules'; label: string }[] = [
  { key: 'alert-groups', label: '告警分组' },
  { key: 'alert-rules', label: '告警规则' },
];

const NOTIFICATION_VIEW_KEYS = new Set<OpsAlertView>([
  'notification-policy',
  'notification-targets',
  'alert-secrets',
]);
const ALERT_MANAGEMENT_VIEW_KEYS = new Set<OpsAlertView>(['alert-groups', 'alert-rules']);

const tagStyle = (active: boolean): React.CSSProperties => ({
  padding: '4px 12px',
  fontSize: 14,
  borderRadius: 16,
  border: active ? undefined : '1px solid #d9d9d9',
  cursor: 'pointer',
  userSelect: 'none',
});

const MonitoringOpsAlertDashboard: React.FC<MonitoringOpsAlertDashboardProps> = ({ cloudId }) => {
  const [activeView, setActiveView] = useState<OpsAlertView>('overview');

  const isNotificationActive = NOTIFICATION_VIEW_KEYS.has(activeView);
  const isAlertManagementActive = ALERT_MANAGEMENT_VIEW_KEYS.has(activeView);

  const notificationMenu: MenuProps = useMemo(
    () => ({
      items: NOTIFICATION_MENU_ITEMS.map((it) => ({ key: it.key, label: it.label })),
      selectable: true,
      selectedKeys: isNotificationActive ? [activeView] : [],
      onClick: ({ key }) => setActiveView(key as OpsAlertView),
    }),
    [activeView, isNotificationActive]
  );
  const alertManagementMenu: MenuProps = useMemo(
    () => ({
      items: ALERT_MANAGEMENT_MENU_ITEMS.map((it) => ({ key: it.key, label: it.label })),
      selectable: true,
      selectedKeys: isAlertManagementActive ? [activeView] : [],
      onClick: ({ key }) => setActiveView(key as OpsAlertView),
    }),
    [activeView, isAlertManagementActive]
  );

  const renderBody = () => {
    switch (activeView) {
      case 'alert-groups':
        return <OpsAlertGroupsSection cloudId={cloudId} />;
      case 'alert-rules':
        return <MonitoringPrometheusRules cloudId={cloudId} />;
      case 'notification-targets':
        return <MonitoringAlertNotificationTargets cloudId={cloudId} />;
      case 'notification-policy':
        return <MonitoringAlertNotificationPolicy cloudId={cloudId} />;
      case 'alert-secrets':
        return <MonitoringAlertSecrets cloudId={cloudId} />;
      case 'overview':
      default:
        return <OpsAlertOverviewSection cloudId={cloudId} />;
    }
  };

  return (
    <div style={{ maxHeight: 'calc(100vh - 180px)', overflowY: 'auto', overflowX: 'hidden', paddingRight: 4 }}>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Space size={8} wrap>
        <Tag.CheckableTag
          checked={activeView === 'overview'}
          onChange={() => setActiveView('overview')}
          style={tagStyle(activeView === 'overview')}
        >
          告警中心概览
        </Tag.CheckableTag>
        <Dropdown menu={alertManagementMenu} trigger={['click']}>
          <Tag.CheckableTag
            checked={isAlertManagementActive}
            onChange={() => {}}
            style={{
              ...tagStyle(isAlertManagementActive),
              display: 'inline-flex',
              alignItems: 'center',
            }}
          >
            告警管理
            <DownOutlined style={{ fontSize: 10, marginLeft: 10 }} />
          </Tag.CheckableTag>
        </Dropdown>
        <Dropdown menu={notificationMenu} trigger={['click']}>
          <Tag.CheckableTag
            checked={isNotificationActive}
            onChange={() => {}}
            style={{
              ...tagStyle(isNotificationActive),
              display: 'inline-flex',
              alignItems: 'center',
            }}
          >
            通知管理
            <DownOutlined style={{ fontSize: 10, marginLeft: 10 }} />
          </Tag.CheckableTag>
        </Dropdown>
        </Space>

        {renderBody()}
      </Space>
    </div>
  );
};

export default MonitoringOpsAlertDashboard;
