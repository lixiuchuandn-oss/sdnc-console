/**
 * 告警卡片 - 严重告警/注意 Tab + 告警列表
 */
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Card, Typography, Spin } from 'antd';
import { WarningOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useMonitoringOverviewSlowLane } from '../MonitoringOverviewLanesContext';
import { ALERT_LEVEL_CRITICAL, ALERT_LEVEL_INFO, ALERT_LEVEL_WARNING } from '../context/MonitoringContext';
import { parseAlerts, type ParsedAlert } from '../lib/prometheusAlerts';
import { CRITICAL_COLOR, WARNING_COLOR } from '../constants';

interface AlertsCardProps {
  cloudId: string;
}

export const AlertsCard: React.FC<AlertsCardProps> = ({ cloudId }) => {
  const navigate = useNavigate();
  const slow = useMonitoringOverviewSlowLane();
  const alertsLoading = slow.loading;
  const alertsData = slow.alertsRules ?? null;
  const [selectedLevel, setSelectedLevel] = useState<
    typeof ALERT_LEVEL_CRITICAL | typeof ALERT_LEVEL_WARNING
  >(ALERT_LEVEL_CRITICAL);

  const { alertsList, levelConfig } = useMemo(() => {
    const list = parseAlerts(alertsData ?? null);
    const criticalCount = list.filter((a) => a.level === ALERT_LEVEL_CRITICAL).length;
    const warningCount = list.filter((a) => a.level === ALERT_LEVEL_WARNING).length;
    return {
      alertsList: list,
      levelConfig: {
        [ALERT_LEVEL_CRITICAL]: { color: CRITICAL_COLOR, label: '严重告警', count: criticalCount },
        [ALERT_LEVEL_WARNING]: { color: WARNING_COLOR, label: '注意', count: warningCount }
      },
    };
  }, [alertsData]);

  const filteredAlerts = alertsList.filter((a) => a.level === selectedLevel);

  const hasInitialSwitchRef = useRef(false);
  useEffect(() => {
    if (alertsLoading || alertsData == null) return;
    if (hasInitialSwitchRef.current) return;
    if (levelConfig[ALERT_LEVEL_CRITICAL].count === 0 && levelConfig[ALERT_LEVEL_WARNING].count > 0) {
      hasInitialSwitchRef.current = true;
      setSelectedLevel(ALERT_LEVEL_WARNING);
    }
  }, [alertsLoading, alertsData, levelConfig]);

  const getAlertIcon = (level: string) => {
    if (level === ALERT_LEVEL_CRITICAL) return <WarningOutlined style={{ color: CRITICAL_COLOR, fontSize: 20 }} />;
    return <WarningOutlined style={{ color: WARNING_COLOR, fontSize: 20 }} />;
  };

  const getAlertItemBg = (level: ParsedAlert['level']) => {
    if (level === ALERT_LEVEL_CRITICAL) return 'rgba(255,92,124,0.05)';
    if (level === ALERT_LEVEL_WARNING) return 'rgba(245,158,11,0.08)';
    return 'rgba(22,119,255,0.06)';
  };

  const getAlertItemHoverBg = (level: ParsedAlert['level']) => {
    if (level === ALERT_LEVEL_CRITICAL) return 'rgba(255, 77, 79, 0.08)';
    if (level === ALERT_LEVEL_WARNING) return 'rgba(250, 140, 22, 0.08)';
    if (level === ALERT_LEVEL_INFO) return 'rgba(22, 119, 255, 0.08)';
    return 'rgba(22, 119, 255, 0.08)';
  };

  const goToOpsAlerts = () => {
    if (!cloudId) return;
    navigate(`/admin/clouds/${encodeURIComponent(cloudId)}/monitoring_alerts/ops-alert-dashboard`);
  };

  return (
    <Card
      size="small"
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <WarningOutlined style={{ color: CRITICAL_COLOR, fontSize: 20 }} />
          <span style={{ fontSize: 16 }}>告警</span>
        </span>
      }
      extra={
        <span style={{ display: 'inline-flex', gap: 8 }}>
          {([ALERT_LEVEL_CRITICAL, ALERT_LEVEL_WARNING] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setSelectedLevel(key)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                borderRadius: 4,
                border: 'none',
                background:
                  selectedLevel === key
                    ? key === ALERT_LEVEL_CRITICAL
                      ? 'rgba(255,92,124,0.1)'
                      : 'rgba(245,158,11,0.1)'
                    : 'transparent',
                cursor: 'pointer',
                fontSize: 14,
                color: '#666',
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: levelConfig[key].color,
                }}
              />
              <span>
                {levelConfig[key].label} {levelConfig[key].count}
              </span>
            </button>
          ))}
        </span>
      }
      styles={{
        header: { padding: '16px 20px', height: 60, minHeight: 60 },
        body: { padding: '20px 0', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
      }}
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 6px 16px rgba(0,0,0,0.1)',
      }}
    >
      <div
        style={{
          flex: 1,
          minHeight: 0,
          height: '100%',
          padding: '0 16px',
          display: 'flex',
          flexDirection: 'column',
          overflowX: 'hidden',
          overflowY: !alertsLoading && filteredAlerts.length === 0 ? 'hidden' : 'auto',
          ...(!alertsLoading && filteredAlerts.length === 0
            ? { justifyContent: 'center', alignItems: 'center' }
            : {}),
        }}
      >
        {alertsLoading ? (
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Spin />
          </div>
        ) : filteredAlerts.length === 0 ? ( /* 无告警时显示空状态 */
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 32,
            }}
          >
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: '50%',
                background: 'rgba(82,196,26,0.08)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 18,
              }}
            >
              <SafetyCertificateOutlined style={{ fontSize: 36, color: '#52c41a' }} />
            </div>
            <span style={{ fontSize: 16, fontWeight: 600 }}>
              {selectedLevel === ALERT_LEVEL_CRITICAL ? '无严重告警' : '无注意告警'}
            </span>
            <span style={{ fontSize: 14, marginTop: 10, color: 'rgba(0,0,0,0.5)' }}>
              {selectedLevel === ALERT_LEVEL_CRITICAL ? '系统运行状态良好' : '系统运行平稳'}
            </span>
          </div>
        ) : (
          filteredAlerts.map((alert: ParsedAlert) => ( /* 有告警时显示告警列表 */
            <div
              key={alert.id}
              role="button"
              tabIndex={0}
              onClick={goToOpsAlerts}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  goToOpsAlerts();
                }
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLDivElement).style.background = getAlertItemHoverBg(alert.level);
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLDivElement).style.background = getAlertItemBg(alert.level);
              }}
              style={{
                padding: 12,
                marginBottom: 8,
                borderRadius: 6,
                borderLeft: `4px solid ${alert.level === ALERT_LEVEL_CRITICAL ? CRITICAL_COLOR : WARNING_COLOR}`,
                background: getAlertItemBg(alert.level),
                cursor: 'pointer',
                transition: 'background-color .15s',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                {getAlertIcon(alert.level)}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                    <Typography.Text strong style={{ fontSize: 14 }}>
                      {alert.title}
                    </Typography.Text>
                    <span style={{ fontSize: 14, color: '#999' }}>{alert.activeAt}</span>
                  </div>
                  {alert.description && (
                    <Typography.Text style={{ fontSize: 14, color: 'rgba(0,0,0,0.7)' }}>
                      {alert.description}
                    </Typography.Text>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </Card>
  );
};
