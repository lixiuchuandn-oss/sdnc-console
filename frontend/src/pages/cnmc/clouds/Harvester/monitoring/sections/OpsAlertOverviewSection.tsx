/**
 * 告警中心概览 Section
 * 内容：运维告警统计 + 最新告警 Top 10
 * 落位：monitoring/sections/（与 MonitoringOverviewSection 相邻）
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DownOutlined, ReloadOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Dropdown, Empty, Space, Switch, Tag, Typography } from 'antd';
import type { MenuProps } from 'antd';
import { fetchAlertsRules, fetchPrometheusRulesGroups } from '../../../../../../services/monitoringApi';
import { SEVERITY_MAP } from '../constants';
import { ALERT_LEVEL_CRITICAL, ALERT_LEVEL_INFO, ALERT_LEVEL_WARNING } from '../context/MonitoringContext';
import MonitoringAlerts from '../MonitoringAlerts';
import { parseAlerts, type ParsedAlert } from '../lib/prometheusAlerts';
import AlertDetailModal from '../components/AlertDetailModal';
import MonitoringTooltip from '../components/MonitoringTooltip';

interface OpsAlertOverviewSectionProps {
  cloudId: string;
}

const DEFAULT_AUTO_REFRESH_MS = 10 * 60 * 1000;
const OVERVIEW_CONTENT_HEIGHT = 360;
type AlertLevelFilter = typeof ALERT_LEVEL_CRITICAL | typeof ALERT_LEVEL_WARNING | typeof ALERT_LEVEL_INFO;
type OpsAlertListTab = 'unresolved' | 'resolved';
const AUTO_REFRESH_OPTIONS: Array<{ label: string; value: number | null }> = [
  { label: '关', value: null },
  { label: '5m', value: 5 * 60 * 1000 },
  { label: '10m', value: 10 * 60 * 1000 },
  { label: '15m', value: 15 * 60 * 1000 },
  { label: '30m', value: 30 * 60 * 1000 },
];

const OpsAlertOverviewSection: React.FC<OpsAlertOverviewSectionProps> = ({ cloudId }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [alerts, setAlerts] = useState<ParsedAlert[]>([]);
  const [activeLevel, setActiveLevel] = useState<AlertLevelFilter>(ALERT_LEVEL_CRITICAL);
  const [activeListTab, setActiveListTab] = useState<OpsAlertListTab>('unresolved');
  const [autoRefreshMs, setAutoRefreshMs] = useState<number | null>(DEFAULT_AUTO_REFRESH_MS);
  /** 用户是否手动选择过等级；未手动选择时，按数据自动 fallback 到有数据的等级 */
  const userPickedLevelRef = useRef(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailRecord, setDetailRecord] = useState<ParsedAlert | null>(null);
  const [rulesGroupMap, setRulesGroupMap] = useState<Record<string, string>>({});

  const handlePickLevel = useCallback((lv: AlertLevelFilter) => {
    userPickedLevelRef.current = true;
    setActiveLevel(lv);
  }, []);

  const openAlertDetail = useCallback((record: ParsedAlert) => {
    setDetailRecord(record);
    setDetailOpen(true);
  }, []);

  const closeAlertDetail = useCallback(() => {
    setDetailOpen(false);
    setDetailRecord(null);
  }, []);

  /** 加载运维告警数据 */
  const loadDashboard = useCallback(async () => {
    if (!cloudId) return;
    setLoading(true);
    setError('');
    try {
      const { data, ok, error: err } = await fetchAlertsRules(cloudId, {
        datasource: 'prometheus',
        autoRefreshMs,
      });
      if (!ok) {
        setAlerts([]);
        setError(err || '加载运维告警数据失败');
        return;
      }
      const list = parseAlerts(data ?? null).sort((a, b) => {
        const at = a.activeAtRaw ? new Date(a.activeAtRaw).getTime() : 0;
        const bt = b.activeAtRaw ? new Date(b.activeAtRaw).getTime() : 0;
        return bt - at;
      });
      setAlerts(list);
    } finally {
      setLoading(false);
    }
  }, [autoRefreshMs, cloudId]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    if (!cloudId) return;
    fetchPrometheusRulesGroups(cloudId).then(({ data, ok }) => {
      if (ok && data?.rulesGroupMap && typeof data.rulesGroupMap === 'object') {
        setRulesGroupMap(data.rulesGroupMap);
      } else {
        setRulesGroupMap({});
      }
    });
  }, [cloudId]);

  useEffect(() => {
    if (!autoRefreshMs) return undefined;
    const timer = window.setInterval(() => {
      void loadDashboard();
    }, autoRefreshMs);
    return () => window.clearInterval(timer);
  }, [autoRefreshMs, loadDashboard]);

  const autoRefreshLabel = useMemo(() => {
    return AUTO_REFRESH_OPTIONS.find((item) => item.value === autoRefreshMs)?.label ?? '自定义';
  }, [autoRefreshMs]);

  const autoRefreshMenuItems = useMemo<MenuProps['items']>(
    () =>
      AUTO_REFRESH_OPTIONS.map((item) => ({
        key: item.value === null ? 'off' : String(item.value),
        label: item.label,
      })),
    []
  );

  const handleAutoRefreshMenuClick = useCallback<NonNullable<MenuProps['onClick']>>(({ key }) => {
    setAutoRefreshMs(key === 'off' ? null : Number(key));
  }, []);

  const metrics = useMemo(() => {
    const critical = alerts.filter((a) => a.level === ALERT_LEVEL_CRITICAL).length;
    const warning = alerts.filter((a) => a.level === ALERT_LEVEL_WARNING).length;
    const info = Math.max(alerts.length - critical - warning, 0);
    return {
      total: alerts.length,
      critical,
      warning,
      info,
    };
  }, [alerts]);

  /**
   * 智能默认等级：用户尚未手动点击前，自动落到第一个有数据的等级，避免「默认严重告警 0 条」时右侧大量留白。
   * 优先级：严重告警 > 注意 > 信息。
   */
  useEffect(() => {
    if (userPickedLevelRef.current) return;
    if (alerts.length === 0) return;
    const order: AlertLevelFilter[] = [ALERT_LEVEL_CRITICAL, ALERT_LEVEL_WARNING, ALERT_LEVEL_INFO];
    const counts: Record<AlertLevelFilter, number> = {
      [ALERT_LEVEL_CRITICAL]: metrics.critical,
      [ALERT_LEVEL_WARNING]: metrics.warning,
      [ALERT_LEVEL_INFO]: metrics.info,
    };
    const first = order.find((lv) => counts[lv] > 0);
    if (first && first !== activeLevel) setActiveLevel(first);
  }, [alerts.length, metrics.critical, metrics.warning, metrics.info, activeLevel]);

  const latestAlerts = useMemo(() => {
    const filtered = alerts.filter((item) => {
      if (activeLevel === ALERT_LEVEL_CRITICAL) return item.level === ALERT_LEVEL_CRITICAL;
      if (activeLevel === ALERT_LEVEL_WARNING) return item.level === ALERT_LEVEL_WARNING;
      if (activeLevel === ALERT_LEVEL_INFO) return item.level === ALERT_LEVEL_INFO;
      return (
        item.level !== ALERT_LEVEL_CRITICAL &&
        item.level !== ALERT_LEVEL_WARNING &&
        item.level !== ALERT_LEVEL_INFO
      );
    });
    return filtered.slice(0, 10);
  }, [activeLevel, alerts]);

  const topRuleCounts = useMemo(() => {
    const counter = new Map<string, number>();
    alerts.forEach((item) => {
      const ruleName = (item.title || item.groupName || '-').toString().trim() || '-';
      counter.set(ruleName, (counter.get(ruleName) ?? 0) + 1);
    });
    return Array.from(counter.entries())
      .map(([ruleName, count]) => ({ ruleName, count }))
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return a.ruleName.localeCompare(b.ruleName);
      })
      .slice(0, 10);
  }, [alerts]);

  const levelCards: Array<{ key: AlertLevelFilter; value: number; label: string; color: string }> = [
    { key: ALERT_LEVEL_CRITICAL, value: metrics.critical, label: SEVERITY_MAP.SEVERITY_CRITICAL, color: '#ff4d4f' },
    { key: ALERT_LEVEL_WARNING, value: metrics.warning, label: SEVERITY_MAP.SEVERITY_WARNING, color: '#fa8c16' },
    { key: ALERT_LEVEL_INFO, value: metrics.info, label: SEVERITY_MAP.SEVERITY_INFO, color: '#1677ff' },
  ];

  const levelEmptyState = (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
        height: '100%',
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
        {activeLevel === ALERT_LEVEL_CRITICAL ? '无严重告警' : activeLevel === ALERT_LEVEL_WARNING ? '无注意告警' : '无信息告警'}
      </span>
      <span style={{ fontSize: 14, marginTop: 10, color: 'rgba(0,0,0,0.5)' }}>
        {activeLevel === ALERT_LEVEL_CRITICAL ? '系统运行状态良好' : activeLevel === ALERT_LEVEL_WARNING ? '系统运行平稳' : '暂无信息级告警'}
      </span>
    </div>
  );

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {error ? <Alert type="error" showIcon message={error} /> : null}
      <div style={{ display: 'flex', gap: 16, alignItems: 'stretch' }}>
        {/* 运维告警概览 */}
        <Card
          size="small"
          title="运维告警概览"
          extra={
            <Space size={8}>
              <MonitoringTooltip title="刷新告警中心概览">
                <Button icon={<ReloadOutlined />} onClick={() => void loadDashboard()} loading={loading} />
              </MonitoringTooltip>
              <Dropdown
                trigger={['click']}
                menu={{
                  items: autoRefreshMenuItems,
                  selectedKeys: [autoRefreshMs === null ? 'off' : String(autoRefreshMs)],
                  onClick: handleAutoRefreshMenuClick,
                }}
              >
                <MonitoringTooltip title={autoRefreshMs === null ? '自动刷新关闭' : `自动刷新间隔：${autoRefreshLabel}`}>
                  <Button>
                    {autoRefreshLabel}
                    <DownOutlined />
                  </Button>
                </MonitoringTooltip>
              </Dropdown>
            </Space>
          }
          style={{ flex: 1.2, minWidth: 0 }}
        >
          <div style={{ display: 'flex', gap: 16, alignItems: 'stretch', height: OVERVIEW_CONTENT_HEIGHT }}>
            <div
              style={{
                width: 156,
                borderRadius: 8,
                background: '#f5f7fb',
                padding: 8,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                flexShrink: 0,
              }}
            >
              {levelCards.map((item) => {
                const checked = activeLevel === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => handlePickLevel(item.key)}
                    style={{
                      border: checked ? `1px solid ${item.color}` : '1px solid transparent',
                      background: checked ? `${item.color}14` : 'transparent',
                      borderRadius: 8,
                      cursor: 'pointer',
                      textAlign: 'center',
                      padding: '15px 0',
                      width: '100%',
                      display: 'block',
                      fontFamily: 'inherit',
                    }}
                  >
                    <div style={{ fontSize: 20, lineHeight: '30px', fontWeight: 700, color: item.color }}>{item.value}</div>
                    <div style={{ color: item.color, fontSize: 16 }}>{item.label}</div>
                  </button>
                );
              })}
            </div>

            <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', paddingRight: 4 }}>
              {latestAlerts.length === 0 ? (
                levelEmptyState
              ) : (
                latestAlerts.map((item: ParsedAlert, index: number) => (
                  <div
                    key={item.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => openAlertDetail(item)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        openAlertDetail(item);
                      }
                    }}
                    className="ops-alert-overview-row"
                    style={{
                      padding: '10px 8px',
                      borderRadius: 6,
                      borderBottom: index === latestAlerts.length - 1 ? 'none' : '1px solid #f0f0f0',
                      cursor: 'pointer',
                      transition: 'background-color .15s',
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLDivElement).style.background = 'rgba(250, 140, 22, 0.08)';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLDivElement).style.background = 'transparent';
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                      <Typography.Text type="secondary">{`${item.activeAt || '-'} 触发`}</Typography.Text>
                      <Typography.Text
                        strong
                        ellipsis
                        style={{ maxWidth: '60%', textAlign: 'right' }}
                      >
                        {item.title || item.alertname || '-'}
                      </Typography.Text>
                    </div>
                    <Typography.Paragraph
                      type="secondary"
                      ellipsis={{ rows: 1, tooltip: false }}
                      style={{ marginTop: 4, marginBottom: 0 }}
                    >
                      {item.description || item.title || '-'}
                    </Typography.Paragraph>
                  </div>
                ))
              )}
            </div>
          </div>
        </Card>
        {/* 告警规则 Top10 告警数目 */}
        <Card size="small" title="告警规则 Top10 告警数目" style={{ flex: 1, minWidth: 0 }}>
          <div style={{ height: OVERVIEW_CONTENT_HEIGHT, overflowY: 'auto', paddingRight: 4 }}>
            {topRuleCounts.length === 0 ? (
              <Empty description="暂无告警数据" />
            ) : (
              topRuleCounts.map((item, index) => (
                <div
                  key={`${item.ruleName}-${index}`}
                  style={{
                    padding: '10px 0',
                    borderBottom: index === topRuleCounts.length - 1 ? 'none' : '1px solid #f0f0f0',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                  }}
                >
                  <Space size={8} style={{ minWidth: 0 }}>
                    <Typography.Text type="secondary">{`#${index + 1}`}</Typography.Text>
                    <Typography.Text ellipsis style={{ maxWidth: 320 }}>
                      {item.ruleName}
                    </Typography.Text>
                  </Space>
                  <Tag color="blue">{`${item.count} 条`}</Tag>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
      <Card
        size="small"
        title="告警处理状态"
        extra={
          <Switch
            checkedChildren="未解决"
            unCheckedChildren="已解决"
            checked={activeListTab === 'unresolved'}
            onChange={(checked) => setActiveListTab(checked ? 'unresolved' : 'resolved')}
          />
        }
      >
        {activeListTab === 'unresolved' ? <MonitoringAlerts cloudId={cloudId} /> : <Empty description="已解决告警规划中" />}
      </Card>

      <AlertDetailModal
        open={detailOpen}
        onClose={closeAlertDetail}
        record={detailRecord}
        rulesGroupMap={rulesGroupMap}
      />
    </Space>
  );
};

export default OpsAlertOverviewSection;
