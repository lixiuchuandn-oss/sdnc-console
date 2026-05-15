/**
 * 告警卡片 - 严重/警告 Tab + 告警列表
 */
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Card, Typography } from 'antd';
import { WarningOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { useDashboardSlowDataContext } from '../DashboardContext';
import { parseAlerts, type ParsedAlert } from '../utils/prometheusAlerts';
import { CRITICAL_COLOR, WARNING_COLOR } from '../constants';

export const AlertsCard: React.FC = () => {
  const slowCtx = useDashboardSlowDataContext();
  const [selectedLevel, setSelectedLevel] = useState<'critical' | 'warning'>('critical');

  const alertsLoading = slowCtx?.loading ?? false;
  const alertsData = slowCtx?.alertsRules ?? null;

  const { alertsList, levelConfig } = useMemo(() => {
    const list = parseAlerts(alertsData ?? null);
    const criticalCount = list.filter((a) => a.level === 'critical').length;
    const warningCount = list.filter((a) => a.level === 'warning').length;
    return {
      alertsList: list,
      levelConfig: {
        critical: { color: CRITICAL_COLOR, label: '严重', count: criticalCount },
        warning: { color: WARNING_COLOR, label: '警告', count: warningCount },
      },
    };
  }, [alertsData]);

  const filteredAlerts = alertsList.filter((a) => a.level === selectedLevel);

  const hasInitialSwitchRef = useRef(false);
  useEffect(() => {
    if (alertsLoading || alertsData == null) return;
    if (hasInitialSwitchRef.current) return;
    if (levelConfig.critical.count === 0 && levelConfig.warning.count > 0) {
      hasInitialSwitchRef.current = true;
      setSelectedLevel('warning');
    }
  }, [alertsLoading, alertsData, levelConfig.critical.count, levelConfig.warning.count]);

  const getAlertIcon = (level: string) => {
    if (level === 'critical') return <WarningOutlined style={{ color: CRITICAL_COLOR, fontSize: 20 }} />;
    return <WarningOutlined style={{ color: WARNING_COLOR, fontSize: 20 }} />;
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
          {(['critical', 'warning'] as const).map((key) => (
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
                    ? key === 'critical'
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
            {!alertsLoading && filteredAlerts.length === 0 ? (
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
                  {selectedLevel === 'critical' ? '无严重告警' : '无警告告警'}
                </span>
                <span style={{ fontSize: 14, marginTop: 10, color: 'rgba(0,0,0,0.5)' }}>
                  {selectedLevel === 'critical' ? '系统运行状态良好' : '系统运行平稳'}
                </span>
              </div>
            ) : (
              filteredAlerts.map((alert: ParsedAlert) => (
                <div
                  key={alert.id}
                  style={{
                    padding: 12,
                    marginBottom: 8,
                    borderRadius: 6,
                    borderLeft: `4px solid ${alert.level === 'critical' ? CRITICAL_COLOR : WARNING_COLOR}`,
                    background:
                      alert.level === 'critical' ? 'rgba(255,92,124,0.05)' : 'rgba(245,158,11,0.08)',
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
