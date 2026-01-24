import React, { useEffect, useMemo, useState } from 'react';
import { Row, Col, Tabs, Tooltip, Button, Tag, Typography, Spin, Empty, Badge } from 'antd';
import {
  CloudOutlined,
  UserOutlined,
  AlertOutlined,
  ReloadOutlined,
  GlobalOutlined,
  DatabaseOutlined,
  SafetyCertificateOutlined,
  AppstoreOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  RightOutlined,
  AliyunOutlined,
  AmazonOutlined,
  GoogleOutlined,
  DeploymentUnitOutlined,
  CloudServerOutlined,
  GatewayOutlined,
  SecurityScanOutlined,
  SwapOutlined,
  ShareAltOutlined,
  NodeIndexOutlined,
} from '@ant-design/icons';
import * as echarts from 'echarts';
import ReactECharts from 'echarts-for-react';
import { useNavigate } from 'react-router-dom';
import { 
  fetchDashboardStats, 
  fetchDashboardRecentActivities, 
  fetchClouds,
  fetchCens,
  fetchInventoryInstancesByCloud,
  fetchCloudmapVirtualElements,
  fetchSrv6Tunnels,
  fetchIPsecVPNs
} from '../../services/api';
import { fetchCenAttachments } from '../../services/api';
import { getACLRules, getNATRules } from '../../services/networkApi';
import { fetchServiceChains } from '../../services/trafficOrchestration';
import { fetchVrRealtimeList } from '../../services/vrCacheApi';
import './Dashboard.css';

const { Text, Title } = Typography;

// --- KPI Card Component ---
const KPICard = ({ title, value, icon, trend, suffix, loading }: any) => (
  <div className="kpi-card">
    <div className="kpi-content">
      <div className="kpi-top-row">
        <span className="kpi-title">{title}</span>
        {trend !== undefined && (
          <div className={`kpi-trend ${trend > 0 ? 'trend-up' : 'trend-down'}`}>
            {trend > 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
            <span>{Math.abs(trend)}%</span>
          </div>
        )}
      </div>
      <Spin spinning={loading}>
        <div className="kpi-value-wrapper">
          <span className="kpi-value">{value}</span>
          {suffix && <span className="kpi-suffix">{suffix}</span>}
        </div>
      </Spin>
    </div>
    <div className="kpi-icon-wrapper">
      {icon}
    </div>
  </div>
);

// --- Chart Options ---
const getProviderChartOption = (data: any[], isDark: boolean) => ({
  color: [
    '#3b82f6', // Blue 500
    '#6366f1', // Indigo 500
    '#0ea5e9', // Sky 500
    '#94a3b8', // Slate 400
    '#cbd5e1', // Slate 300
  ],
  tooltip: { 
    trigger: 'item', 
    backgroundColor: '#fff',
    borderColor: '#e5e7eb',
    borderWidth: 1,
    textStyle: { color: '#374151' },
    padding: [8, 12],
    extraCssText: 'box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); border-radius: 6px;'
  },
  legend: { 
    bottom: '0%', 
    left: 'center', 
    icon: 'circle',
    itemWidth: 8,
    itemHeight: 8,
    itemGap: 16,
    textStyle: { color: '#6b7280', fontSize: 12 } 
  },
  series: [
    {
      name: '资源分布',
      type: 'pie',
      radius: ['50%', '80%'],
      center: ['50%', '40%'],
      avoidLabelOverlap: false,
      itemStyle: { 
        borderRadius: 8, 
        borderColor: '#fff', 
        borderWidth: 2 
      },
      label: { show: false, position: 'center' },
      emphasis: { 
        label: { show: true, fontSize: 18, fontWeight: 'bold', color: '#111827' },
        scale: true,
        scaleSize: 10,
        itemStyle: {
          shadowBlur: 10,
          shadowOffsetX: 0,
          shadowColor: 'rgba(0, 0, 0, 0.5)'
        }
      },
      labelLine: { show: false },
      data: data,
      animationType: 'scale',
      animationEasing: 'elasticOut',
      animationDuration: 1200,
      animationDelay: function (idx: number) {
        return idx * 100;
      }
    }
  ]
});

const getRegionChartOption = (data: any[], isDark: boolean) => ({
  tooltip: { 
    trigger: 'axis', 
    axisPointer: { type: 'shadow' }, // Shadow pointer for better focus
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderColor: '#e5e7eb',
    borderWidth: 0,
    textStyle: { color: '#374151' },
    padding: [12, 16],
    extraCssText: 'box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05); border-radius: 8px;'
  },
  grid: { left: '150', right: '10%', bottom: '3%', top: '3%', containLabel: false },
  xAxis: { 
    type: 'value', 
    splitLine: { show: false }, // Clean look, no grid lines
    axisLabel: { show: false },
    axisLine: { show: false },
    axisTick: { show: false }
  },
  yAxis: { 
    type: 'category', 
    data: data.map(i => i.name), 
    axisLabel: { 
      color: '#64748b', 
      fontWeight: 600, 
      fontSize: 13,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial',
      margin: 130,
      width: 120,
      overflow: 'truncate',
      align: 'left',
    },
    axisLine: { show: false },
    axisTick: { show: false },
    inverse: true // Top items first
  },
  series: [
    {
      name: '资源',
      type: 'bar',
      data: data.map(i => i.value),
      itemStyle: { 
        borderRadius: 20, // Full capsule shape
        color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
          { offset: 0, color: '#2563eb' }, // Blue 600
          { offset: 1, color: '#60a5fa' }  // Blue 400
        ]),
        shadowBlur: 5,
        shadowColor: 'rgba(37, 99, 235, 0.2)',
        shadowOffsetY: 2
      },
      barWidth: 24, 
      showBackground: true,
      backgroundStyle: { color: '#f1f5f9', borderRadius: 20 },
      label: {
        show: true,
        position: 'right',
        color: '#64748b',
        fontSize: 13,
        fontWeight: 600,
        formatter: '{c}',
        fontFamily: 'Monaco, Menlo, Consolas, "Courier New", monospace' // Tech feel for numbers
      },
      animationDelay: function (idx: number) {
        return idx * 100;
      },
      animationEasing: 'elasticOut',
      animationDuration: 1200
    }
  ]
});

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<any>({});
  const [clouds, setClouds] = useState<any[]>([]);
  const [cens, setCens] = useState<any[]>([]);
  const [recentActivities, setRecentActivities] = useState<any[]>([]);
  const [isDark, setIsDark] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');
  const [instanceStats, setInstanceStats] = useState<{running: number, total: number}>({ running: 0, total: 0 });

  const [instanceCounts, setInstanceCounts] = useState<Record<string, number>>({});
  const [sdnStats, setSdnStats] = useState<{ cenCount: number; attachCount: number; srv6Count: number; ipsecCount: number; vrCount: number; aclCount: number; natCount: number; scCount: number }>({ cenCount: 0, attachCount: 0, srv6Count: 0, ipsecCount: 0, vrCount: 0, aclCount: 0, natCount: 0, scCount: 0 });
  const [aclDist, setAclDist] = useState<Array<{ name: string; value: number }>>([]);
  const [natDist, setNatDist] = useState<Array<{ name: string; value: number }>>([]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [statsData, activitiesData, cloudsList, cenList, srv6List, ipsecList, aclAll, natAll, scAll, vrRealtime] = await Promise.all([
        fetchDashboardStats(),
        fetchDashboardRecentActivities(),
        fetchClouds(),
        fetchCens(),
        fetchSrv6Tunnels(),
        fetchIPsecVPNs(),
        getACLRules(),
        getNATRules(),
        fetchServiceChains(),
        fetchVrRealtimeList(500, 1)
      ]);
      setStats(statsData);
      setRecentActivities(activitiesData);
      setClouds(cloudsList || []);
      const cenArr: any[] = Array.isArray(cenList) ? cenList : [];
      let cenWithAttach: any[] = cenArr;
      let attachCount = 0;
      try {
        const attResults = await Promise.allSettled(cenArr.map((c: any) => fetchCenAttachments(String(c.id))));
        const uniqueDomainIds = new Set<string>();
        const attachCountsByCen: Record<string, number> = {};
        attResults.forEach((res, idx) => {
          if (res.status === 'fulfilled') {
            const list: any[] = Array.isArray((res.value as any)) ? (res.value as any) : Array.isArray((res.value as any)?.data) ? (res.value as any).data : [];
            let cnt = 0;
            list.forEach((att: any) => {
              const st = String(att?.status || '').toLowerCase();
              const domId = String(att?.securityDomain?.id || att?.securityDomainId || '').trim();
              if (st === 'attached' && domId) {
                cnt += 1;
                uniqueDomainIds.add(domId);
              }
            });
            const cenId = String(cenArr[idx]?.id || '');
            if (cenId) attachCountsByCen[cenId] = cnt;
          }
        });
        attachCount = uniqueDomainIds.size;
        cenWithAttach = cenArr.map(c => ({ ...c, attachCount: attachCountsByCen[String(c.id)] || 0 }));
      } catch {
        attachCount = (cenArr || []).reduce((s: number, c: any) => s + (c?.attachCount || 0), 0);
        cenWithAttach = cenArr;
      }
      setCens(cenWithAttach);
      const cenCount = cenArr.length;
      const srv6Count = Array.isArray(srv6List) ? srv6List.length : (Array.isArray((srv6List as any)?.data) ? (srv6List as any).data.length : 0);
      const ipsecCount = Array.isArray(ipsecList) ? ipsecList.length : (Array.isArray((ipsecList as any)?.data) ? (ipsecList as any).data.length : 0);
      const aclArr: any[] = Array.isArray((aclAll as any)?.data) ? (aclAll as any).data : (Array.isArray(aclAll) ? aclAll as any[] : []);
      const natArr: any[] = Array.isArray((natAll as any)?.data) ? (natAll as any).data : (Array.isArray(natAll) ? natAll as any[] : []);
      const scArr: any[] = Array.isArray((scAll as any)?.data) ? (scAll as any).data : (Array.isArray(scAll) ? scAll as any[] : []);
      const vrData: any = (vrRealtime as any)?.data ?? vrRealtime;
      const vrList: any[] = Array.isArray(vrData?.page) ? vrData.page : Array.isArray(vrData?.list) ? vrData.list : Array.isArray(vrData?.rows) ? vrData.rows : (Array.isArray(vrData) ? vrData : []);
      const vrCount = Array.isArray(vrList) ? vrList.length : 0;
      const aclCount = Array.isArray(aclArr) ? aclArr.length : 0;
      const natCount = Array.isArray(natArr) ? natArr.length : 0;
      const scCount = Array.isArray(scArr) ? scArr.length : 0;
      setSdnStats({ cenCount, attachCount, srv6Count, ipsecCount, vrCount, aclCount, natCount, scCount });
      const permit = aclArr.filter((r: any) => String(r.action || '').toLowerCase() === 'permit').length;
      const deny = aclArr.filter((r: any) => String(r.action || '').toLowerCase() === 'deny').length;
      setAclDist([{ name: '允许', value: permit }, { name: '拒绝', value: deny }]);
      const snat = natArr.filter((r: any) => String(r.type || '').toLowerCase() === 'snat').length;
      const dnat = natArr.filter((r: any) => String(r.type || '').toLowerCase() === 'dnat').length;
      const statNat = natArr.filter((r: any) => String(r.type || '').toLowerCase() === 'static').length;
      setNatDist([{ name: 'SNAT', value: snat }, { name: 'DNAT', value: dnat }, { name: '静态NAT', value: statNat }]);
      
      // Load instance stats from cached fields
      let totalRunning = 0;
      let totalInstances = 0;
      const counts: Record<string, number> = {};

      (cloudsList || []).forEach((c: any) => {
        const count = Number(c.vmCount || 0);
        const running = Number(c.runningVmCount || 0);
        counts[c.id] = count;
        totalInstances += count;
        totalRunning += running;
      });
      
      setInstanceStats({ running: totalRunning, total: totalInstances });
      setInstanceCounts(counts);

    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // Theme handler
    const el = document.documentElement;
    if (isDark) el.setAttribute('data-theme', 'dark');
    else el.removeAttribute('data-theme');
  }, [isDark]);

  // Process data for charts
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
    return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => a.value - b.value).slice(-10); // Top 10
  }, [clouds]);

  const alarmCount = useMemo(() => {
    return recentActivities.filter(a => {
       const isAlarm = (a?.type === 'alarm') || /告警|报警/i.test(String(a?.action)) || a?.status === 'failed';
       const isRecent = new Date(a.time).getTime() > Date.now() - 24 * 60 * 60 * 1000;
       return isAlarm && isRecent;
    }).length;
  }, [recentActivities]);

  const cenAttachData = useMemo(() => {
    return cens.map(c => ({ name: c.name, value: c.attachCount || 0 })).sort((a, b) => b.value - a.value).slice(0, 8);
  }, [cens]);

  const cenStatusData = useMemo(() => {
    const m: Record<string, number> = {};
    cens.forEach(c => {
      const s = (c.status || 'Unknown');
      m[s] = (m[s] || 0) + 1;
    });
    return Object.entries(m).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [cens]);

  const getBarOption = (data: any[], isDarkTheme: boolean) => {
    const names = data.map(d => String(d.name || ''));
    const maxLen = names.reduce((m, n) => Math.max(m, n.length), 0);
    const labelWidth = Math.min(220, Math.max(120, maxLen * 9));
    const leftGap = Math.min(240, Math.max(120, labelWidth + 18));
    return {
      grid: { left: leftGap, right: '6%', top: '8%', bottom: '12%' },
      xAxis: { type: 'value', axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: true, lineStyle: { color: isDarkTheme ? '#303030' : '#e5e7eb' } } },
      yAxis: { 
        type: 'category', 
        data: names, 
        axisLabel: { align: 'right', margin: 12, color: isDarkTheme ? '#e5e7eb' : '#374151', width: labelWidth, overflow: 'truncate', ellipsis: '…' }, 
        axisLine: { show: false }, 
        axisTick: { show: false } 
      },
      series: [{ type: 'bar', data: data.map(d => d.value), barWidth: 14, itemStyle: { color: '#1677ff', borderRadius: [6, 6, 6, 6] } }],
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } }
    };
  };

  const getDonutOption = (data: any[], isDarkTheme: boolean) => ({
    tooltip: { trigger: 'item' },
    legend: { bottom: 0, left: 'center' },
    series: [{ type: 'pie', radius: ['50%', '75%'], center: ['50%', '40%'], label: { show: false }, data: data, itemStyle: { borderColor: '#fff', borderWidth: 2 } }]
  });

  return (
    <div className="dashboard">
      <Tabs 
        activeKey={activeTab} 
        onChange={setActiveTab} 
        className="custom-tabs"
        tabBarGutter={12}
        tabBarExtraContent={
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
             <Tooltip title="刷新数据"><Button icon={<ReloadOutlined />} onClick={loadData} /></Tooltip>
          </div>
        }
        items={[
          { key: 'overview', label: '多云总览', icon: <AppstoreOutlined /> },
          { key: 'cen', label: 'SDN总览', icon: <SafetyCertificateOutlined /> },
        ]}
      />

      {activeTab === 'overview' && (
        <>
          {/* Row 1: KPI Cards */}
          <Row gutter={[24, 24]} style={{ marginBottom: 24 }}>
            <Col xs={24} sm={12} lg={6}>
              <KPICard 
                title="纳管云资源" 
                value={stats.cloudCount || 0} 
                icon={<CloudOutlined />} 
                loading={loading}
                suffix="个"
              />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <KPICard 
                title="运行中实例" 
                value={instanceStats.running} 
                icon={<DatabaseOutlined />} 
                loading={loading}
                suffix={`/ ${instanceStats.total}`}
                trend={instanceStats.total > 0 ? Number(((instanceStats.running / instanceStats.total) * 100).toFixed(1)) : 0}
              />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <KPICard 
                title="活跃用户" 
                value={stats.userCount || 0} 
                icon={<UserOutlined />} 
                loading={loading}
                suffix="人"
              />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <KPICard 
                title="24h 告警" 
                value={alarmCount} 
                icon={<AlertOutlined />} 
                loading={loading}
                suffix="条"
                trend={alarmCount > 0 ? 10 : 0} 
              />
            </Col>
          </Row>

          {/* Row 2: Charts */}
          <Row gutter={[24, 24]} style={{ marginBottom: 24 }}>
            <Col xs={24} lg={8}>
              <div className="content-card">
                <div className="card-header">
                  <span className="card-title">云厂商分布</span>
                </div>
                {providerData.length > 0 ? (
                  <ReactECharts option={getProviderChartOption(providerData, isDark)} style={{ height: '300px' }} />
                ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}
              </div>
            </Col>
            <Col xs={24} lg={10}>
              <div className="content-card">
                <div className="card-header">
                  <span className="card-title">区域资源分布 (Top 10)</span>
                </div>
                 {regionData.length > 0 ? (
                  <ReactECharts 
                    option={getRegionChartOption(regionData, isDark)} 
                    style={{ height: '300px' }} 
                    notMerge={true}
                    lazyUpdate={true}
                  />
                ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}
              </div>
            </Col>
            <Col xs={24} lg={6}>
               <div className="content-card">
                <div className="card-header">
                  <span className="card-title">最新动态</span>
                  <Button type="link" size="small">更多</Button>
                </div>
                <div className="activity-list">
                  {recentActivities.slice(0, 5).map((item, idx) => (
                    <div className="activity-item" key={idx}>
                      <div className="activity-time">{new Date(item.time).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
                      <div className="activity-content">
                        <div className="activity-title" title={item.action}>{item.action}</div>
                        <div className="activity-desc">{item.user}</div>
                      </div>
                    </div>
                  ))}
                  {recentActivities.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无动态" />}
                </div>
              </div>
            </Col>
          </Row>

          {/* Row 3: Resource Pools */}
          <div className="content-card">
            <div className="card-header">
              <span className="card-title">资源池状态</span>
              <Button icon={<RightOutlined />} onClick={() => navigate('/clouds')}>管理资源</Button>
            </div>
            <Row gutter={[20, 20]}>
              {clouds.slice(0, 8).map(cloud => (
                <Col xs={24} md={12} lg={6} key={cloud.id}>
                  <div className={`resource-card ${cloud.status === 'online' || cloud.status === 'active' ? 'active' : ''}`} 
                       onClick={() => navigate(`/admin/clouds/${cloud.id}`)}>
                    <div className="resource-card-header">
                      <div className="resource-icon">
                        {cloud.config?.provider === 'aliyun' ? <AliyunOutlined style={{ color: '#ff6a00' }} /> :
                         cloud.config?.provider === 'aws' ? <AmazonOutlined style={{ color: '#ff9900' }} /> :
                         cloud.config?.provider === 'huaweicloud' ? <span style={{ fontWeight: 900, fontSize: '14px', color: '#e60012', fontFamily: 'Arial' }}>HW</span> :
                         cloud.config?.provider === 'google' ? <GoogleOutlined style={{ color: '#4285f4' }} /> :
                        (cloud.config?.provider === 'cloudmap.edge' || cloud.config?.provider === 'cloudmap.private') ? <CloudServerOutlined style={{ color: '#1677ff' }} /> :
                        (cloud.config?.provider === 'cloudmap.csm') ? <SafetyCertificateOutlined style={{ color: '#52c41a' }} /> :
                         <DeploymentUnitOutlined style={{ color: '#64748b' }} />}
                      </div>
                      <div className={`status-badge-container ${cloud.status === 'online' || cloud.status === 'active' ? 'online' : 'offline'}`}>
                        {cloud.status === 'online' || cloud.status === 'active' ? 
                          <Badge status="success" text="运行中" /> : 
                          <Badge status="default" text={cloud.status} />
                        }
                      </div>
                    </div>
                    <div className="resource-card-body">
                      <div className="resource-name" title={cloud.name}>{cloud.name}</div>
                      <div className="resource-meta">
                        <span className="region-tag">{cloud.region}</span>
                      </div>
                      <div className="resource-matrix">
                        {[...Array(100)].map((_, i) => {
                          // Calculate active instances ratio for visualization
                          const instanceCount = instanceCounts[cloud.id] || 0;
                          const isActive = i < instanceCount;
                          
                          // Calculate delay for wave effect (diagonal wave)
                          const col = i % 20;
                          const row = Math.floor(i / 20);
                          const delay = (col + row) * 100;

                          return (
                            <div 
                              key={i} 
                              className={`matrix-block ${isActive ? 'active-instance' : 'empty-slot'}`}
                              title={isActive ? '运行中实例' : '空闲资源槽位'}
                              style={isActive ? { animationDelay: `${delay}ms` } : undefined}
                            />
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </Col>
              ))}
              {clouds.length === 0 && <Col span={24}><Empty description="未接入任何云资源" /></Col>}
            </Row>
          </div>
        </>
      )}

      {activeTab === 'cen' && (
        <>
          {/* SDN Metrics Row 1 */}
          <Row gutter={[24, 24]} style={{ marginBottom: 24 }}>
            <Col xs={24} sm={12} lg={6}>
              <KPICard title="VR 实例" value={sdnStats.vrCount} icon={<GatewayOutlined />} loading={loading} />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <KPICard title="ACL 规则" value={sdnStats.aclCount} icon={<SecurityScanOutlined />} loading={loading} />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <KPICard title="NAT 规则" value={sdnStats.natCount} icon={<SwapOutlined />} loading={loading} />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <KPICard title="服务链数" value={sdnStats.scCount} icon={<NodeIndexOutlined />} loading={loading} />
            </Col>
          </Row>
          {/* SDN Metrics Row 2 */}
          <Row gutter={[24, 24]} style={{ marginBottom: 24 }}>
            <Col xs={24} sm={12} lg={6}>
              <KPICard title="级联通道数量" value={sdnStats.cenCount} icon={<SafetyCertificateOutlined />} loading={loading} />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <KPICard title="已挂载安全域总数" value={sdnStats.attachCount} icon={<GlobalOutlined />} loading={loading} />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <KPICard title="SRv6 隧道" value={sdnStats.srv6Count} icon={<ShareAltOutlined />} loading={loading} />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <KPICard title="IPsec VPN" value={sdnStats.ipsecCount} icon={<AlertOutlined />} loading={loading} />
            </Col>
          </Row>
          {/* SDN Charts */}
          <Row gutter={[24, 24]} style={{ marginBottom: 24 }}>
            <Col xs={24} lg={12}>
              <div className="content-card">
                <div className="card-header">
                  <span className="card-title">ACL 允许/拒绝占比</span>
                </div>
                {aclDist.length > 0 ? (
                  <ReactECharts option={getDonutOption(aclDist, isDark)} style={{ height: '300px' }} />
                ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}
              </div>
            </Col>
            <Col xs={24} lg={12}>
              <div className="content-card">
                <div className="card-header">
                  <span className="card-title">NAT 类型分布</span>
                </div>
                {natDist.length > 0 ? (
                  <ReactECharts option={getDonutOption(natDist, isDark)} style={{ height: '300px' }} />
                ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}
              </div>
            </Col>
          </Row>
          <Row gutter={[24, 24]} style={{ marginBottom: 24 }}>
            <Col xs={24} lg={12}>
              <div className="content-card">
                <div className="card-header">
                  <span className="card-title">级联通道附加安全域 Top 8</span>
                </div>
                {cenAttachData.length > 0 ? (
                  <ReactECharts option={getBarOption(cenAttachData, isDark)} style={{ height: '300px' }} />
                ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}
              </div>
            </Col>
            <Col xs={24} lg={12}>
              <div className="content-card">
                <div className="card-header">
                  <span className="card-title">级联通道状态分布</span>
                </div>
                {cenStatusData.length > 0 ? (
                  <ReactECharts option={getDonutOption(cenStatusData, isDark)} style={{ height: '300px' }} />
                ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}
              </div>
            </Col>
          </Row>
          <div className="content-card">
            <div className="card-header">
              <span className="card-title">级联通道列表</span>
              <Button type="primary" onClick={() => navigate('/admin/sec-mgr-plane/instances')}>管理实例</Button>
            </div>
            <Row gutter={[24, 24]}>
              {cens.length > 0 ? cens.map(cen => (
                <Col xs={24} md={12} lg={8} key={cen.id}>
                  <div className="resource-card">
                    <div className="resource-card-header">
                      <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                        <div className="resource-icon"><SafetyCertificateOutlined /></div>
                        <div>
                          <div style={{ fontSize:16, fontWeight:600 }}>{cen.name}</div>
                          <div style={{ fontSize:12, color:'var(--text-secondary)' }}>{new Date(cen.createdAt).toLocaleDateString()}</div>
                        </div>
                      </div>
                      <Tag color="blue">{cen.status}</Tag>
                    </div>
                    <div className="resource-card-body">
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                        <div style={{ fontSize:13, color:'var(--text-secondary)' }}>已附加安全域</div>
                        <div style={{ fontSize:22, fontWeight:700 }}>{cen.attachCount || 0}</div>
                      </div>
                    </div>
                    <div style={{ marginTop: 12 }}>
                      <Button block onClick={() => navigate('/admin/sec-mgr-plane/instances')}>查看详情</Button>
                    </div>
                  </div>
                </Col>
              )) : <Col span={24}><Empty description="暂无级联通道" /></Col>}
            </Row>
          </div>
        </>
      )}

    </div>
  );
};

export default Dashboard;
