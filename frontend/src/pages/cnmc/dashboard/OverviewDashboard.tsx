import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Button, Card, Col, Empty, Progress, Row, Spin, theme } from 'antd';
import {
  AliyunOutlined,
  AmazonOutlined,
  AppstoreOutlined,
  BellFilled,
  BellOutlined,
  CheckCircleFilled,
  ClockCircleOutlined,
  CloudServerOutlined,
  DeploymentUnitOutlined,
  DesktopOutlined,
  EnvironmentOutlined,
  GoogleOutlined,
  HistoryOutlined,
  InfoCircleFilled,
  PieChartOutlined,
  RightOutlined,
  SafetyCertificateOutlined,
  StopFilled,
  TeamOutlined,
  UserOutlined,
  WarningFilled,
} from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '../../../contexts/AuthContext';
import { useSettings } from '../../../contexts/SettingsContext';
import {
  apiRequest,
  fetchClouds,
  fetchDashboardRecentActivities,
  fetchDashboardStats,
} from '../../../services/api';
import { isMustChangePasswordApiError } from '../../../utils/errorHandler';
import { getProviderChartOption } from './chartUtils';
import './Dashboard.css';
import { isCsmCloud } from '../pools/lib/poolProviders';
import { navigateToPoolDetail } from '../pools/lib/poolDetailNav';
import { OverviewMetricCard } from '../../../components/overview';

function pickSettledResult<T>(result: PromiseSettledResult<T>, fallback: T): T {
  return result.status === 'fulfilled' ? result.value : fallback;
}

/** 与 Cloudmap 详情 Tab「资源总览」MonitoringOverview 卡片对齐：阴影、页眉高度 */
const DASH_CARD_SHADOW = '0 4px 12px rgba(0, 0, 0, 0.08)';
const DASH_CARD_HEADER_STYLES = {
  padding: '10px 16px 0',
  height: 48,
  minHeight: 48,
  borderBottom: 'none',
} as const;

/** 概览 Card body：纵向 flex 占满，便于内部图表/列表撑开或滚动 */
const DASH_CARD_BODY_FLEX_COLUMN = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column' as const,
};

/** KPI / 图表 / 动态 / 资源池 共用同一套 body 内边距 */
const DASH_CARD_BODY_PADDING = '8px 16px 16px' as const;

const DASH_CARD_BODY_STANDARD = {
  ...DASH_CARD_BODY_FLEX_COLUMN,
  padding: DASH_CARD_BODY_PADDING,
} as const;

/** 概览区各 Card的 styles（header + body），避免在 JSX 里堆对象 */
const DASH_CARD_STYLES = {
  chart: {
    header: DASH_CARD_HEADER_STYLES,
    body: { ...DASH_CARD_BODY_STANDARD },
  },
  activity: {
    header: DASH_CARD_HEADER_STYLES,
    body: { ...DASH_CARD_BODY_STANDARD, overflow: 'auto' as const },
  },
  resources: {
    header: DASH_CARD_HEADER_STYLES,
    body: { ...DASH_CARD_BODY_STANDARD },
  },
} as const;

const DASH_ROW_CHART_MIN_HEIGHT = 380;

/** 图表栅格列：与内层 flex 配合占满行高 */
const CHART_COL_OUTER_STYLE: CSSProperties = { display: 'flex' };

/** 图表列外层：等高拉伸 */
const CHART_COL_WRAPPER_STYLE: CSSProperties = {
  minHeight: DASH_ROW_CHART_MIN_HEIGHT,
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
};

/** 云厂商 / 区域分布 / 最新动态 Card 外壳（与 Col 内 flex 配合） */
const CHART_CARD_SHELL_STYLE: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  boxShadow: DASH_CARD_SHADOW,
  height: '100%',
};

const CARD_TITLE_ICON_STYLE = { color: '#1677ff', fontSize: 20 } as const;

const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  aliyun: '阿里云',
  aws: '亚马逊云',
  huaweicloud: '华为云',
  tencentcloud: '腾讯云',
  azure: '微软云',
  google: '谷歌云',
  harvester: 'Harvester',
  'cloudmap.edge': 'Cloudmap边缘云',
  'cloudmap.private': 'Cloudmap私有云',
  'cloudmap.csm': 'CSM（SDN 业务域）',
  Unknown: '未知厂商',
};

const MATRIX_ARRAY = [...Array(100)];

const OverviewDashboard: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { settings } = useSettings();
  const { token } = theme.useToken();
  const chartDark = settings.theme === 'dark';
  /** 与资源池页一致：改密后首次拉取需 skipCache */
  const skipNextCloudsFetchCacheRef = useRef(false);
  const [statsLoading, setStatsLoading] = useState(false);
  const [chartsLoading, setChartsLoading] = useState(false);

  const [stats, setStats] = useState<any>({});
  const [clouds, setClouds] = useState<any[]>([]);
  const [recentActivities, setRecentActivities] = useState<any[]>([]);
  const [instanceStats, setInstanceStats] = useState<{running: number, total: number}>({ running: 0, total: 0 });
  const [instanceCounts, setInstanceCounts] = useState<Record<string, { total: number, running: number }>>({});
  const [cloudStats, setCloudStats] = useState({ online: 0, total: 0 });

  const loadCriticalData = useCallback(async (skipCloudsCache?: boolean) => {
    setStatsLoading(true);
    try {
      const cloudsFetch = skipCloudsCache
        ? apiRequest('/api/clouds', { skipCache: true })
        : fetchClouds();
      const results = await Promise.allSettled([
        fetchDashboardStats(),
        cloudsFetch,
      ]);

      const statsData = pickSettledResult(results[0], {});
      if (results[1].status === 'rejected' && isMustChangePasswordApiError(results[1].reason)) {
        skipNextCloudsFetchCacheRef.current = true;
      }
      const cloudsList = pickSettledResult(results[1], []);
      const cnmcClouds = (cloudsList || []).filter((c: any) => !isCsmCloud(c));

      setStats(statsData);
      setClouds(cnmcClouds);

      let totalRunning = 0;
      let totalInstances = 0;
      let onlineClouds = 0;
      const counts: Record<string, { total: number, running: number }> = {};

      cnmcClouds.forEach((c: any) => {
        const count = Number(c.vmCount || 0);
        const running = Number(c.runningVmCount || 0);
        if (c.status === 'online' || c.status === 'active') onlineClouds++;
        counts[c.id] = { total: count, running: running };
        totalInstances += count;
        totalRunning += running;
      });
      
      setInstanceStats({ running: totalRunning, total: totalInstances });
      setInstanceCounts(counts);
      setCloudStats({ online: onlineClouds, total: cnmcClouds.length });
    } catch (err) {
      console.error('Failed to load critical data:', err);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  const loadSecondaryData = useCallback(async () => {
    setChartsLoading(true);
    try {
      const list = await fetchDashboardRecentActivities();
      setRecentActivities(Array.isArray(list) ? list : []);
    } catch (err) {
      console.error('Failed to load secondary data:', err);
      setRecentActivities([]);
    } finally {
      setChartsLoading(false);
    }
  }, []);

  const loadAllData = useCallback((skipCloudsCache?: boolean) => {
    loadCriticalData(skipCloudsCache);
    setTimeout(() => {
      loadSecondaryData();
    }, 100);
  }, [loadCriticalData, loadSecondaryData]);

  useEffect(() => {
    if (!user?.id) return;
    if (user.mustChangePassword) {
      skipNextCloudsFetchCacheRef.current = true;
      return;
    }
    const skip = skipNextCloudsFetchCacheRef.current;
    skipNextCloudsFetchCacheRef.current = false;
    loadAllData(skip);
  }, [loadAllData, user?.id, user?.mustChangePassword]);

  const providerData = useMemo(() => {
    const map: Record<string, number> = {};
    clouds.forEach((c) => {
      const key = String(c.config?.provider || 'Unknown');
      map[key] = (map[key] || 0) + 1;
    });
    return Object.entries(map)
      .map(([key, value]) => ({
        name: PROVIDER_DISPLAY_NAMES[key] || key,
        value,
      }))
      .sort((a, b) => b.value - a.value);
  }, [clouds]);

  const regionData = useMemo(() => {
    const map: Record<string, number> = {};
    clouds.forEach(c => {
      const r = c.region || 'Unknown';
      map[r] = (map[r] || 0) + 1;
    });
    return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => a.value - b.value).slice(-10);
  }, [clouds]);

  const providerChartOption = useMemo(
    () => getProviderChartOption(providerData, token, chartDark),
    [providerData, token, chartDark]
  );
  const regionProgressDisplay = useMemo(() => {
    const sorted = [...regionData].sort((a, b) => b.value - a.value);
    const maxVal = Math.max(1, ...sorted.map((r) => r.value));
    return { sorted, maxVal };
  }, [regionData]);

  const alarmCount = useMemo(() => {
    return recentActivities.filter((a) => {
      const isAlarm =
        a?.type === 'alarm' || /告警|报警/i.test(String(a?.action)) || a?.status === 'failed';
      const isRecent = new Date(a.time).getTime() > Date.now() - 24 * 60 * 60 * 1000;
      return isAlarm && isRecent;
    }).length;
  }, [recentActivities]);

  const criticalAlertsCount = useMemo(
    () => recentActivities.filter((a) => a.severity === 'critical').length,
    [recentActivities]
  );

  const getActivityType = (action: string) => {
    if (/告警|报警|失败|错误|error|fail/i.test(action)) return 'error';
    if (/成功|完成|success/i.test(action)) return 'success';
    if (/警告|warning/i.test(action)) return 'warning';
    return 'info';
  };

  const getActivityIcon = (type: string) => {
    switch (type) {
      case 'error': return <BellFilled style={{ color: '#ff4d4f' }} />;
      case 'warning': return <WarningFilled style={{ color: '#faad14' }} />;
      case 'success': return <CheckCircleFilled style={{ color: '#52c41a' }} />;
      default: return <InfoCircleFilled style={{ color: '#1677ff' }} />;
    }
  };

  return (
    <div className="dashboard-modern">
      <Row gutter={[16, 16]} className="kpi-row dashboard-overview-row" align="stretch">
        <OverviewMetricCard
          title="纳管云资源"
          value={cloudStats.online}
          total={cloudStats.total}
          loading={statsLoading}
          valueColor="#1677ff"
          icon={<CloudServerOutlined style={{ color: '#1677ff' }} />}
          col={{ xs: 24, sm: 12, lg: 6 }}
        />
        <OverviewMetricCard
          title="运行中实例"
          value={instanceStats.running}
          total={instanceStats.total}
          loading={statsLoading}
          valueColor="#1677ff"
          icon={<DesktopOutlined style={{ color: '#1677ff' }} />}
          col={{ xs: 24, sm: 12, lg: 6 }}
        />
        <OverviewMetricCard
          title="活跃用户"
          value={stats.newUserCount || 0}
          total={stats.totalUserCount || 0}
          loading={statsLoading}
          valueColor="#1677ff"
          icon={<TeamOutlined style={{ color: '#1677ff' }} />}
          col={{ xs: 24, sm: 12, lg: 6 }}
        />
        <OverviewMetricCard
          title="24h 告警"
          value={criticalAlertsCount}
          total={alarmCount}
          loading={chartsLoading}
          valueColor={alarmCount > 0 ? '#ff4d4f' : '#1677ff'}
          icon={<BellOutlined style={{ color: alarmCount > 0 ? '#ff4d4f' : '#1677ff' }} />}
          col={{ xs: 24, sm: 12, lg: 6 }}
        />
      </Row>

      <Row gutter={[16, 16]} className="charts-row dashboard-overview-row" align="stretch">
        <Col xs={24} lg={6} style={CHART_COL_OUTER_STYLE}>
          <div style={CHART_COL_WRAPPER_STYLE}>
            <Card
              size="small"
              className="dashboard-overview-chart-card"
              title={
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <PieChartOutlined style={CARD_TITLE_ICON_STYLE} />
                  <span style={{ fontSize: 16 }}>云厂商分布</span>
                </span>
              }
              styles={DASH_CARD_STYLES.chart}
              style={CHART_CARD_SHELL_STYLE}
            >
              <div className="chart-container dashboard-overview-chart-body">
                {statsLoading ? (
                  <div className="chart-loading">
                    <Spin size="large" />
                  </div>
                ) : providerData.length > 0 ? (
                  <ReactECharts
                    option={providerChartOption}
                    style={{ width: '100%', height: '100%', minHeight: 320 }}
                    className="chart-wrapper"
                  />
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" className="chart-empty" />
                )}
              </div>
            </Card>
          </div>
        </Col>
        <Col xs={24} lg={6} style={CHART_COL_OUTER_STYLE}>
          <div style={CHART_COL_WRAPPER_STYLE}>
            <Card
              size="small"
              className="dashboard-overview-chart-card"
              title={
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <EnvironmentOutlined style={CARD_TITLE_ICON_STYLE} />
                  <span style={{ fontSize: 16 }}>区域资源分布 (Top 10)</span>
                </span>
              }
              styles={DASH_CARD_STYLES.chart}
              style={CHART_CARD_SHELL_STYLE}
            >
              <div className="chart-container dashboard-overview-chart-body">
                {statsLoading ? (
                  <div className="chart-loading">
                    <Spin size="large" />
                  </div>
                ) : regionData.length > 0 ? (
                  <div className="dashboard-region-progress-wrap">
                    {regionProgressDisplay.sorted.map((item) => (
                      <div key={item.name} className="dashboard-region-progress-row">
                        <span className="dashboard-region-progress-label" title={item.name}>
                          {item.name}
                        </span>
                        <div className="dashboard-region-progress-bar">
                          <Progress
                            percent={Math.round((item.value / regionProgressDisplay.maxVal) * 1000) / 10}
                            percentPosition={{ align: 'center', type: 'inner' }}
                            size={['100%', 20]}
                            format={() => String(item.value)}
                            strokeColor={token.colorPrimary}
                            trailColor={token.colorFillTertiary}
                            strokeLinecap="round"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" className="chart-empty" />
                )}
              </div>
            </Card>
          </div>
        </Col>
        <Col xs={24} lg={12} style={CHART_COL_OUTER_STYLE}>
          <div style={CHART_COL_WRAPPER_STYLE}>
            <Card
              size="small"
              className="dashboard-overview-activity-card"
              title={
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <HistoryOutlined style={CARD_TITLE_ICON_STYLE} />
                  <span style={{ fontSize: 16 }}>最新动态</span>
                </span>
              }
              styles={DASH_CARD_STYLES.activity}
              style={CHART_CARD_SHELL_STYLE}
            >
              <div>
                {chartsLoading && recentActivities.length === 0 ? (
                  <div className="activity-loading-professional">
                    <Spin />
                  </div>
                ) : recentActivities.length > 0 ? (
                  recentActivities.slice(0, 6).map((item, idx, arr) => {
                    const type = getActivityType(item.action);
                    return (
                      <div
                        className="activity-item-professional timeline-item"
                        key={`activity-${String(item.time)}-${String(item.user ?? '')}-${idx}`}
                      >
                        <div className="timeline-connector">
                          <div className={`timeline-dot ${type}`}>{getActivityIcon(type)}</div>
                          {idx !== arr.length - 1 && <div className="timeline-line" />}
                        </div>
                        <div className="activity-content-professional">
                          <div className="activity-title-professional" title={item.action}>
                            {item.action}
                          </div>
                          <div className="activity-meta-professional">
                            <span className="meta-item">
                              <ClockCircleOutlined />{' '}
                              {new Date(item.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                            <span className="meta-separator">•</span>
                            <span className="meta-item">
                              <UserOutlined /> {item.user}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无动态" className="activity-empty-professional" />
                )}
              </div>
            </Card>
          </div>
        </Col>
      </Row>

      <Row gutter={[16, 16]} className="resources-row dashboard-overview-row" align="stretch">
        <Col xs={24}>
          <Card
            size="small"
            className="dashboard-overview-resources-card"
            title={
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <AppstoreOutlined style={CARD_TITLE_ICON_STYLE} />
                <span style={{ fontSize: 16 }}>资源池状态</span>
              </span>
            }
            extra={
              <Button
                type="text"
                size="small"
                icon={<RightOutlined />}
                onClick={() => navigate('/admin/clouds')}
                className="manage-button-professional-v2"
              >
                资源池管理
              </Button>
            }
            styles={DASH_CARD_STYLES.resources}
            style={{ boxShadow: DASH_CARD_SHADOW }}
          >
            {statsLoading ? (
              <div className="resources-loading">
                <Spin size="large" />
              </div>
            ) : clouds.length > 0 ? (
              <Row gutter={[16, 16]} className="resources-grid">
                {clouds.slice(0, 8).map((cloud) => {
                  const vmStats = instanceCounts[cloud.id] || { total: 0, running: 0 };
                  const isOnline = cloud.status === 'online' || cloud.status === 'active';

                  return (
                    <Col xs={24} sm={12} lg={6} key={cloud.id}>
                      <div
                        className={`resource-card-professional ${isOnline ? 'active' : ''}`}
                        onClick={() => navigateToPoolDetail(navigate, cloud as unknown as Record<string, any>)}
                      >
                        <div className="resource-card-header-professional">
                          <div className="resource-header-content-professional">
                            <div className="resource-icon-professional">
                              {cloud.config?.provider === 'aliyun' ? (
                                <AliyunOutlined style={{ color: '#ff6a00' }} />
                              ) : cloud.config?.provider === 'aws' ? (
                                <AmazonOutlined style={{ color: '#ff9900' }} />
                              ) : cloud.config?.provider === 'huaweicloud' ? (
                                <span
                                  style={{
                                    fontWeight: 900,
                                    fontSize: '14px',
                                    color: '#e60012',
                                    fontFamily: 'Arial',
                                  }}
                                >
                                  HW
                                </span>
                              ) : cloud.config?.provider === 'google' ? (
                                <GoogleOutlined style={{ color: '#4285f4' }} />
                              ) : cloud.config?.provider === 'cloudmap.edge' ||
                                cloud.config?.provider === 'cloudmap.private' ? (
                                <CloudServerOutlined style={{ color: '#1677ff' }} />
                              ) : cloud.config?.provider === 'cloudmap.csm' ? (
                                <SafetyCertificateOutlined style={{ color: '#52c41a' }} />
                              ) : (
                                <DeploymentUnitOutlined style={{ color: '#64748b' }} />
                              )}
                            </div>
                            <div className="resource-info-professional">
                              <div className="resource-name-professional" title={cloud.name}>
                                {cloud.name}
                              </div>
                              <div className="resource-meta-professional">
                                <span className="region-tag-professional">{cloud.region}</span>
                              </div>
                            </div>
                          </div>
                          <div className={`status-badge-professional ${isOnline ? 'online' : 'offline'}`}>
                            {isOnline ? <CheckCircleFilled /> : <StopFilled />}
                            <span className="status-text">{isOnline ? '运行中' : cloud.status}</span>
                          </div>
                        </div>

                        <div className="resource-stats-row-professional">
                          <div className="stat-group">
                            <span className="stat-value running">{vmStats.running}</span>
                            <span className="stat-label">运行中</span>
                          </div>
                          <div className="stat-divider" />
                          <div className="stat-group">
                            <span className="stat-value total">{vmStats.total}</span>
                            <span className="stat-label">总实例</span>
                          </div>
                        </div>

                        <div className="resource-card-body-professional">
                          <div className="resource-matrix-professional">
                            {MATRIX_ARRAY.map((_, i) => {
                              let statusClass = 'empty-slot';
                              let title = '空闲资源槽位';

                              if (i < vmStats.running) {
                                statusClass = 'running-instance';
                                title = '运行中实例';
                              } else if (i < vmStats.total) {
                                statusClass = 'stopped-instance';
                                title = '已停止实例';
                              }

                              return (
                                <div
                                  key={i}
                                  className={`matrix-block-professional ${statusClass}`}
                                  title={title}
                                />
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </Col>
                  );
                })}
              </Row>
            ) : (
              <Empty description="未接入任何云资源" className="resources-empty" />
            )}
          </Card>
        </Col>
      </Row>

    </div>
  );
};

export default OverviewDashboard;