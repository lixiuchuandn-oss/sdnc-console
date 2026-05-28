/**
 * 告警中心概览 Section
 * 内容：运维告警统计 + 最新告警 Top 10
 * 落位：monitoring/sections/（与 MonitoringOverviewSection 相邻）
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SafetyCertificateOutlined } from '@ant-design/icons';
import { Alert, Card, Empty, Space, Spin, Switch, Tag, Typography } from 'antd';
import { fetchPrometheusRulesGroups } from '../../../../../../services/monitoringApi';
import { SEVERITY_MAP } from '../constants';
import { ALERT_LEVEL_CRITICAL, ALERT_LEVEL_INFO, ALERT_LEVEL_WARNING } from '../context/MonitoringContext';
import MonitoringAlerts from '../MonitoringAlerts';
import type { ParsedAlert } from '../lib/prometheusAlerts';
import AlertDetailModal from '../components/AlertDetailModal';
import type { OpsAlertOverviewControls } from '../hooks/useOpsAlertOverviewControls';
import { OPS_DASHBOARD_PAGE_STACK_GAP } from '../lib/opsDashboardLayout';

interface OpsAlertOverviewSectionProps {
  cloudId: string;
  controls: OpsAlertOverviewControls;
}

const OVERVIEW_CONTENT_HEIGHT = 360;
type AlertLevelFilter = typeof ALERT_LEVEL_CRITICAL | typeof ALERT_LEVEL_WARNING | typeof ALERT_LEVEL_INFO;
type OpsAlertListTab = 'unresolved' | 'resolved';

/** 概览区首次拉取数据前的居中加载态（与空状态同高，避免误显示「无告警」） */
const overviewLoadingState = (
  <div
    style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      padding: 32,
    }}
  >
    <Spin size="large" />
    <span style={{ marginTop: 16, fontSize: 14, color: 'rgba(0,0,0,0.45)' }}>正在加载中</span>
  </div>
);

const OpsAlertOverviewSection: React.FC<OpsAlertOverviewSectionProps> = ({ cloudId, controls }) => {
  const { loading, error, alerts } = controls;
  const [activeLevel, setActiveLevel] = useState<AlertLevelFilter>(ALERT_LEVEL_CRITICAL);
  const [activeListTab, setActiveListTab] = useState<OpsAlertListTab>('unresolved');
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

  /** 尚无告警数据且正在请求：展示加载态，不展示「无严重告警」等空状态 */
  const showOverviewLoading = loading && alerts.length === 0 && !error;

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
    <Space direction="vertical" size={OPS_DASHBOARD_PAGE_STACK_GAP} style={{ width: '100%' }}>
      {error ? <Alert type="error" showIcon message={error} /> : null}
      <div style={{ display: 'flex', gap: 16, alignItems: 'stretch' }}>
        <Card size="small" title="运维告警概览" style={{ flex: 1.2, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'stretch', height: OVERVIEW_CONTENT_HEIGHT }}>
            {showOverviewLoading ? (
              <div style={{ flex: 1, minWidth: 0 }}>{overviewLoadingState}</div>
            ) : (
              <>
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
              </>
            )}
          </div>
        </Card>
        <Card size="small" title="告警规则 Top10 告警数目" style={{ flex: 1, minWidth: 0 }}>
          <div style={{ height: OVERVIEW_CONTENT_HEIGHT, overflowY: 'auto', paddingRight: 4 }}>
            {showOverviewLoading ? (
              overviewLoadingState
            ) : topRuleCounts.length === 0 ? (
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
