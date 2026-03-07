import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Row, Col, Button, Empty, Spin } from 'antd';
import {
  CloudServerOutlined,
  DesktopOutlined,
  TeamOutlined,
  BellOutlined,
  RightOutlined,
  AliyunOutlined,
  AmazonOutlined,
  GoogleOutlined,
  DeploymentUnitOutlined,
  SafetyCertificateOutlined,
  CheckCircleFilled,
  StopFilled,
  WarningFilled,
  InfoCircleFilled,
  ClockCircleOutlined,
  BellFilled,
  UserOutlined,
} from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import { useNavigate } from 'react-router-dom';
import { 
  fetchDashboardStats, 
  fetchDashboardRecentActivities, 
  fetchClouds
} from '../../services/api';
import './Dashboard.css';
import { getProviderChartOption, getRegionChartOption } from './chartUtils';

// --- Professional KPI Card Component V2 (High Detail) ---
const KPICard = ({ title, value, total, icon, loading, color = '#1677ff', variant = 'default' }: any) => {
  return (
    <div className={`kpi-card-professional-v2 ${variant}`}>
      <div className="kpi-card-inner">
        <div className="kpi-main-section">
          <div className="kpi-header-v2">
            <div className="kpi-header-left">
              <div className="kpi-icon-wrapper-v2" style={{ backgroundColor: `${color}15`, color: color }}>
                {icon}
              </div>
              <span className="kpi-title-v2">{title}</span>
            </div>
            
            <Spin spinning={loading}>
              <div className="kpi-value-section-v2">
                 <span className="kpi-value-v2" style={{ color: color }}>{value}</span>
                 <span className="kpi-divider-v2">/</span>
                 <span className="kpi-total-v2">{total || '-'}</span>
              </div>
            </Spin>
          </div>
        </div>
      </div>
    </div>
  );
};

const MATRIX_ARRAY = [...Array(100)];

const OverviewDashboard: React.FC = () => {
  const navigate = useNavigate();
  const [statsLoading, setStatsLoading] = useState(false);
  const [chartsLoading, setChartsLoading] = useState(false);
  
  const [stats, setStats] = useState<any>({});
  const [clouds, setClouds] = useState<any[]>([]);
  const [recentActivities, setRecentActivities] = useState<any[]>([]);
  const [isDark, setIsDark] = useState(false);
  const [instanceStats, setInstanceStats] = useState<{running: number, total: number}>({ running: 0, total: 0 });
  const [instanceCounts, setInstanceCounts] = useState<Record<string, { total: number, running: number }>>({});
  const [cloudStats, setCloudStats] = useState({ online: 0, total: 0 });

  const loadCriticalData = useCallback(async () => {
    setStatsLoading(true);
    try {
      const results = await Promise.allSettled([
        fetchDashboardStats(),
        fetchClouds(),
      ]);

      const getValue = (res: PromiseSettledResult<any>, defaultVal: any) => 
        res.status === 'fulfilled' ? res.value : defaultVal;

      const statsData = getValue(results[0], {});
      const cloudsList = getValue(results[1], []);

      setStats(statsData);
      setClouds(cloudsList || []);

      let totalRunning = 0;
      let totalInstances = 0;
      let onlineClouds = 0;
      const counts: Record<string, { total: number, running: number }> = {};

      (cloudsList || []).forEach((c: any) => {
        const count = Number(c.vmCount || 0);
        const running = Number(c.runningVmCount || 0);
        if (c.status === 'online' || c.status === 'active') onlineClouds++;
        counts[c.id] = { total: count, running: running };
        totalInstances += count;
        totalRunning += running;
      });
      
      setInstanceStats({ running: totalRunning, total: totalInstances });
      setInstanceCounts(counts);
      setCloudStats({ online: onlineClouds, total: cloudsList.length });
    } catch (err) {
      console.error('Failed to load critical data:', err);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  const loadSecondaryData = useCallback(async () => {
    setChartsLoading(true);
    try {
      const results = await Promise.allSettled([
        fetchDashboardRecentActivities(),
      ]);

      const getValue = (res: PromiseSettledResult<any>, defaultVal: any) => 
        res.status === 'fulfilled' ? res.value : defaultVal;

      const activitiesData = getValue(results[0], []);
      setRecentActivities(activitiesData);
    } catch (err) {
      console.error('Failed to load secondary data:', err);
    } finally {
      setChartsLoading(false);
    }
  }, []);

  const loadAllData = useCallback(() => {
    loadCriticalData();
    setTimeout(() => {
      loadSecondaryData();
    }, 100);
  }, [loadCriticalData, loadSecondaryData]);

  useEffect(() => {
    loadAllData();
    const el = document.documentElement;
    if (el.getAttribute('data-theme') === 'dark') setIsDark(true);
    
    // Observer for theme changes
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'data-theme') {
          setIsDark(el.getAttribute('data-theme') === 'dark');
        }
      });
    });
    
    observer.observe(el, { attributes: true });
    return () => observer.disconnect();
  }, [loadAllData]);

  const providerData = useMemo(() => {
    const map: Record<string, number> = {};
    const providerMap: Record<string, string> = {
      'aliyun': '阿里云',
      'aws': '亚马逊云',
      'huaweicloud': '华为云',
      'tencentcloud': '腾讯云',
      'azure': '微软云',
      'google': '谷歌云',
      'harvester': 'Harvester',
      'cloudmap.edge': 'Cloudmap边缘云',
      'cloudmap.private': 'Cloudmap私有云',
      'cloudmap.csm': 'CSM安全资源池',
      'Unknown': '未知厂商'
    };
    
    clouds.forEach(c => {
      const key = String(c.config?.provider || 'Unknown');
      map[key] = (map[key] || 0) + 1;
    });
    
    return Object.entries(map).map(([key, value]) => ({ 
      name: providerMap[key] || key, 
      value 
    })).sort((a, b) => b.value - a.value);
  }, [clouds]);

  const regionData = useMemo(() => {
    const map: Record<string, number> = {};
    clouds.forEach(c => {
      const r = c.region || 'Unknown';
      map[r] = (map[r] || 0) + 1;
    });
    return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => a.value - b.value).slice(-10);
  }, [clouds]);

  const alarmCount = useMemo(() => {
    return recentActivities.filter(a => {
       const isAlarm = (a?.type === 'alarm') || /告警|报警/i.test(String(a?.action)) || a?.status === 'failed';
       const isRecent = new Date(a.time).getTime() > Date.now() - 24 * 60 * 60 * 1000;
       return isAlarm && isRecent;
    }).length;
  }, [recentActivities]);

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
      <Row gutter={[20, 20]} className="kpi-row" style={{ marginBottom: 20 }}>
        <Col xs={24} sm={12} lg={6}>
          <KPICard 
            title="纳管云资源" 
            value={cloudStats.online} 
            total={cloudStats.total}
            loading={statsLoading}
            color="#1677ff"
            icon={<CloudServerOutlined />}
          />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <KPICard 
            title="运行中实例" 
            value={instanceStats.running} 
            total={instanceStats.total}
            loading={statsLoading}
            color="#1677ff"
            icon={<DesktopOutlined />}
          />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <KPICard 
            title="活跃用户" 
            value={stats.newUserCount || 0} 
            total={stats.totalUserCount || 0}
            loading={statsLoading}
            color="#1677ff"
            icon={<TeamOutlined />}
          />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <KPICard 
            title="24h 告警" 
            value={recentActivities.filter(a => a.severity === 'critical').length || 0}
            total={alarmCount} 
            loading={chartsLoading}
            color={alarmCount > 0 ? "#ff4d4f" : "#1677ff"}
            icon={<BellOutlined />}
          />
        </Col>
      </Row>

      <Row gutter={[20, 20]} className="charts-row">
        <Col xs={24} lg={9}>
          <div className="content-card-professional chart-card">
            <div className="card-header-professional">
              <span className="card-title-professional">云厂商分布</span>
            </div>
            <div className="chart-container">
              {statsLoading ? (
                <div className="chart-loading">
                  <Spin size="large" />
                </div>
              ) : providerData.length > 0 ? (
                <ReactECharts 
                  option={getProviderChartOption(providerData, isDark)} 
                  style={{ height: '320px' }}
                  className="chart-wrapper"
                />
              ) : (
                <Empty 
                  image={Empty.PRESENTED_IMAGE_SIMPLE} 
                  description="暂无数据"
                  className="chart-empty"
                />
              )}
            </div>
          </div>
        </Col>
        <Col xs={24} lg={9}>
          <div className="content-card-professional chart-card">
            <div className="card-header-professional">
              <span className="card-title-professional">区域资源分布 (Top 10)</span>
            </div>
            <div className="chart-container">
              {statsLoading ? (
                <div className="chart-loading">
                  <Spin size="large" />
                </div>
              ) : regionData.length > 0 ? (
                <ReactECharts 
                  option={getRegionChartOption(regionData, isDark)} 
                  style={{ height: '320px' }}
                  className="chart-wrapper"
                  notMerge={true}
                  lazyUpdate={true}
                />
              ) : (
                <Empty 
                  image={Empty.PRESENTED_IMAGE_SIMPLE} 
                  description="暂无数据"
                  className="chart-empty"
                />
              )}
            </div>
          </div>
        </Col>
        <Col xs={24} lg={6}>
          <div className="content-card-professional activity-card">
            <div className="card-header-professional">
              <span className="card-title-professional">最新动态</span>
              <Button type="link" size="small" className="more-button-professional">更多</Button>
            </div>
            <div className="activity-list-professional timeline-style">
              {chartsLoading && recentActivities.length === 0 ? (
                <div className="activity-loading-professional">
                  <Spin />
                </div>
              ) : recentActivities.length > 0 ? (
                recentActivities.slice(0, 6).map((item, idx) => {
                  const type = getActivityType(item.action);
                  return (
                    <div className="activity-item-professional timeline-item" key={idx}>
                      <div className="timeline-connector">
                        <div className={`timeline-dot ${type}`}>
                          {getActivityIcon(type)}
                        </div>
                        {idx !== recentActivities.slice(0, 6).length - 1 && <div className="timeline-line"></div>}
                      </div>
                      <div className="activity-content-professional">
                        <div className="activity-title-professional" title={item.action}>
                          {item.action}
                        </div>
                        <div className="activity-meta-professional">
                          <span className="meta-item"><ClockCircleOutlined /> {new Date(item.time).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                          <span className="meta-separator">•</span>
                          <span className="meta-item"><UserOutlined /> {item.user}</span>
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <Empty 
                  image={Empty.PRESENTED_IMAGE_SIMPLE} 
                  description="暂无动态"
                  className="activity-empty-professional"
                />
              )}
            </div>
          </div>
        </Col>
      </Row>

      <Row gutter={[20, 20]} className="resources-row">
        <Col xs={24}>
          <div className="content-card-professional resources-card">
            <div className="card-header-professional">
              <span className="card-title-professional">资源池状态</span>
              <Button 
                type="text"
                size="small"
                icon={<RightOutlined />} 
                onClick={() => navigate('/admin/clouds')}
                className="manage-button-professional-v2"
              >
                资源池管理
              </Button>
            </div>
            {statsLoading ? (
              <div className="resources-loading">
                <Spin size="large" />
              </div>
            ) : clouds.length > 0 ? (
              <Row gutter={[16, 16]} className="resources-grid">
                {clouds.slice(0, 8).map(cloud => {
                  const stats = instanceCounts[cloud.id] || { total: 0, running: 0 };
                  const isOnline = cloud.status === 'online' || cloud.status === 'active';
                  
                  return (
                  <Col xs={24} sm={12} lg={6} key={cloud.id}>
                    <div 
                      className={`resource-card-professional ${isOnline ? 'active' : ''}`} 
                      onClick={() => navigate(`/admin/clouds/${cloud.id}`)}
                    >
                      <div className="resource-card-header-professional">
                        <div className="resource-header-content-professional">
                          <div className="resource-icon-professional">
                            {cloud.config?.provider === 'aliyun' ? <AliyunOutlined style={{ color: '#ff6a00' }} /> :
                             cloud.config?.provider === 'aws' ? <AmazonOutlined style={{ color: '#ff9900' }} /> :
                             cloud.config?.provider === 'huaweicloud' ? <span style={{ fontWeight: 900, fontSize: '14px', color: '#e60012', fontFamily: 'Arial' }}>HW</span> :
                             cloud.config?.provider === 'google' ? <GoogleOutlined style={{ color: '#4285f4' }} /> :
                            (cloud.config?.provider === 'cloudmap.edge' || cloud.config?.provider === 'cloudmap.private') ? <CloudServerOutlined style={{ color: '#1677ff' }} /> :
                            (cloud.config?.provider === 'cloudmap.csm') ? <SafetyCertificateOutlined style={{ color: '#52c41a' }} /> :
                             <DeploymentUnitOutlined style={{ color: '#64748b' }} />}
                          </div>
                          <div className="resource-info-professional">
                            <div className="resource-name-professional" title={cloud.name}>{cloud.name}</div>
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
                            <span className="stat-value running">{stats.running}</span>
                            <span className="stat-label">运行中</span>
                         </div>
                         <div className="stat-divider"></div>
                         <div className="stat-group">
                            <span className="stat-value total">{stats.total}</span>
                            <span className="stat-label">总实例</span>
                         </div>
                      </div>

                      <div className="resource-card-body-professional">
                        <div className="resource-matrix-professional">
                          {MATRIX_ARRAY.map((_, i) => {
                            let statusClass = 'empty-slot';
                            let title = '空闲资源槽位';
                            
                            if (i < stats.running) {
                                statusClass = 'running-instance';
                                title = '运行中实例';
                            } else if (i < stats.total) {
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
          </div>
        </Col>
      </Row>

    </div>
  );
};

export default OverviewDashboard;