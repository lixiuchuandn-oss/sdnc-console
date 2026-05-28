import React, { useEffect, useMemo, useState } from 'react';
import { DownOutlined } from '@ant-design/icons';
import { Dropdown, Empty, Space, Tag } from 'antd';
import type { MenuProps } from 'antd';
import DashboardToolbar from './components/DashboardToolbar';
import OpsAlertOverviewSection from './sections/OpsAlertOverviewSection';
import OpsAlertGroupsSection from './sections/OpsAlertGroupsSection';
import MonitoringAlertNotificationTargets from './MonitoringAlertNotificationTargets';
import MonitoringAlertNotificationPolicy from './MonitoringAlertNotificationPolicy';
import MonitoringAlertSecrets from './MonitoringAlertSecrets';
import MonitoringPrometheusRules from './MonitoringPrometheusRules';
import {
  OPS_ALERT_OVERVIEW_AUTO_REFRESH_OPTIONS,
  useOpsAlertOverviewControls,
} from './hooks/useOpsAlertOverviewControls';
import '../../Cloudmap/pool/styles/layout.css';
import {
  OPS_DASHBOARD_PAGE_ROOT_STYLE,
  OPS_DASHBOARD_PAGE_STACK_GAP,
  OPS_DASHBOARD_TOOLBAR_ROW_STYLE,
  OPS_DASHBOARD_TOOLBAR_SPACE_SIZE,
  opsDashboardTagStyle,
} from './lib/opsDashboardLayout';
import {
  canViewOpsAlertInnerView,
  canViewOpsAlertManagementMenu,
  canViewOpsNotificationMenu,
  firstAccessibleOpsAlertInnerView,
  type OpsAlertInnerView,
} from './lib/monitoringPageAccess';

interface MonitoringOpsAlertDashboardProps {
  cloudId: string;
  checkPerm: (action: string) => boolean;
}

const NOTIFICATION_MENU_ITEMS: { key: OpsAlertInnerView; label: string }[] = [
  { key: 'notification-policy', label: '通知策略' },
  { key: 'notification-targets', label: '通知对象' },
  { key: 'alert-secrets', label: '通知密钥' },
];
const ALERT_MANAGEMENT_MENU_ITEMS: { key: OpsAlertInnerView; label: string }[] = [
  { key: 'alert-groups', label: '告警分组' },
  { key: 'alert-rules', label: '告警规则' },
];

const NOTIFICATION_VIEW_KEYS = new Set<OpsAlertInnerView>([
  'notification-policy',
  'notification-targets',
  'alert-secrets',
]);
const ALERT_MANAGEMENT_VIEW_KEYS = new Set<OpsAlertInnerView>(['alert-groups', 'alert-rules']);

const MonitoringOpsAlertDashboard: React.FC<MonitoringOpsAlertDashboardProps> = ({
  cloudId,
  checkPerm,
}) => {
  const overviewControls = useOpsAlertOverviewControls(cloudId);
  const defaultView = useMemo(
    () => firstAccessibleOpsAlertInnerView(checkPerm) ?? 'overview',
    [checkPerm],
  );
  const [activeView, setActiveView] = useState<OpsAlertInnerView>(defaultView);

  useEffect(() => {
    if (canViewOpsAlertInnerView(activeView, checkPerm)) return;
    const next = firstAccessibleOpsAlertInnerView(checkPerm);
    if (next) setActiveView(next);
  }, [activeView, checkPerm]);

  const isNotificationActive = NOTIFICATION_VIEW_KEYS.has(activeView);
  const isAlertManagementActive = ALERT_MANAGEMENT_VIEW_KEYS.has(activeView);

  const showOverviewTag = canViewOpsAlertInnerView('overview', checkPerm);
  const showAlertManagementMenu = canViewOpsAlertManagementMenu(checkPerm);
  const showNotificationMenu = canViewOpsNotificationMenu(checkPerm);

  const alertManagementMenuItems = useMemo(
    () => ALERT_MANAGEMENT_MENU_ITEMS.filter((it) => canViewOpsAlertInnerView(it.key, checkPerm)),
    [checkPerm],
  );
  const notificationMenuItems = useMemo(
    () => NOTIFICATION_MENU_ITEMS.filter((it) => canViewOpsAlertInnerView(it.key, checkPerm)),
    [checkPerm],
  );

  const notificationMenu: MenuProps = useMemo(
    () => ({
      items: notificationMenuItems.map((it) => ({ key: it.key, label: it.label })),
      selectable: true,
      selectedKeys: isNotificationActive ? [activeView] : [],
      onClick: ({ key }) => setActiveView(key as OpsAlertInnerView),
    }),
    [activeView, isNotificationActive, notificationMenuItems],
  );
  const alertManagementMenu: MenuProps = useMemo(
    () => ({
      items: alertManagementMenuItems.map((it) => ({ key: it.key, label: it.label })),
      selectable: true,
      selectedKeys: isAlertManagementActive ? [activeView] : [],
      onClick: ({ key }) => setActiveView(key as OpsAlertInnerView),
    }),
    [activeView, isAlertManagementActive, alertManagementMenuItems],
  );

  const renderBody = () => {
    if (!canViewOpsAlertInnerView(activeView, checkPerm)) {
      return <Empty description="无权限访问" style={{ marginTop: 48 }} />;
    }
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
        return <OpsAlertOverviewSection cloudId={cloudId} controls={overviewControls} />;
    }
  };

  return (
    <div className="cloudmap-monitoring-page-root" style={OPS_DASHBOARD_PAGE_ROOT_STYLE}>
      <Space direction="vertical" size={OPS_DASHBOARD_PAGE_STACK_GAP} style={{ width: '100%' }}>
        <div style={OPS_DASHBOARD_TOOLBAR_ROW_STYLE}>
          <Space size={OPS_DASHBOARD_TOOLBAR_SPACE_SIZE} wrap>
            {showOverviewTag ? (
              <Tag.CheckableTag
                checked={activeView === 'overview'}
                onChange={() => setActiveView('overview')}
                style={opsDashboardTagStyle(activeView === 'overview')}
              >
                告警中心概览
              </Tag.CheckableTag>
            ) : null}
            {showAlertManagementMenu ? (
              <Dropdown menu={alertManagementMenu} trigger={['click']} disabled={!alertManagementMenuItems.length}>
                <Tag.CheckableTag
                  checked={isAlertManagementActive}
                  onChange={() => {}}
                  style={{
                    ...opsDashboardTagStyle(isAlertManagementActive),
                    display: 'inline-flex',
                    alignItems: 'center',
                  }}
                >
                  告警管理
                  <DownOutlined style={{ fontSize: 10, marginLeft: 10 }} />
                </Tag.CheckableTag>
              </Dropdown>
            ) : null}
            {showNotificationMenu ? (
              <Dropdown menu={notificationMenu} trigger={['click']} disabled={!notificationMenuItems.length}>
                <Tag.CheckableTag
                  checked={isNotificationActive}
                  onChange={() => {}}
                  style={{
                    ...opsDashboardTagStyle(isNotificationActive),
                    display: 'inline-flex',
                    alignItems: 'center',
                  }}
                >
                  通知管理
                  <DownOutlined style={{ fontSize: 10, marginLeft: 10 }} />
                </Tag.CheckableTag>
              </Dropdown>
            ) : null}
          </Space>
          {activeView === 'overview' && showOverviewTag ? (
            <DashboardToolbar
              showTimeRange={false}
              autoRefreshMs={overviewControls.autoRefreshMs}
              onAutoRefreshChange={overviewControls.setAutoRefreshMs}
              onManualRefresh={() => void overviewControls.loadDashboard()}
              loading={overviewControls.loading}
              autoRefreshOptions={OPS_ALERT_OVERVIEW_AUTO_REFRESH_OPTIONS}
              manualRefreshTooltip="刷新告警中心概览"
            />
          ) : null}
        </div>

        {renderBody()}
      </Space>
    </div>
  );
};

export default MonitoringOpsAlertDashboard;
