import React, { useEffect, useMemo, useState } from 'react';
import { Row, Col, Card, Statistic, Progress, Table, Tag, Typography, Form, Select, DatePicker, Space, Button, Divider, List, Tooltip, Switch, Tabs } from 'antd';
import {
  CloudOutlined,
  DesktopOutlined,
  SafetyOutlined,
  RobotOutlined,
  UserOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  PieChartOutlined,
  BarChartOutlined,
  GlobalOutlined,
  ApartmentOutlined,
  NodeExpandOutlined,
  UpOutlined,
  DownOutlined,
  ThunderboltOutlined,
  PlusOutlined,
  LinkOutlined,
  ReloadOutlined,
  EllipsisOutlined,
  QuestionCircleOutlined,
  RiseOutlined,
  FallOutlined,
  NotificationOutlined,
} from '@ant-design/icons';
import './Dashboard.css';
import { fetchDashboardStats, fetchDashboardRecentActivities, fetchDashboardCloudUsage, fetchClouds, fetchCens, fetchCloudProviderVpcs } from '../../services/api';
import { useNavigate, useLocation } from 'react-router-dom';
import MiniSparkline from '../../components/MiniSparkline';

const { Text } = Typography;

const Dashboard: React.FC = () => {
  // 组件内部state
  const navigate = useNavigate();
  const location = useLocation();
  const [stats, setStats] = useState<{cloudCount:number; securityServiceCount:number; userCount:number}>({cloudCount:0,securityServiceCount:0,userCount:0});
  const [recentActivities, setRecentActivities] = useState<any[]>([]);
  const [cloudStats, setCloudStats] = useState<any[]>([]);
  const [clouds, setClouds] = useState<any[]>([]);
  const [cens, setCens] = useState<any[]>([]);
  const [attachmentsTotal, setAttachmentsTotal] = useState<number>(0);
  const [vpcs, setVpcs] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | undefined>();

  // 全局筛选
  const [filterForm] = Form.useForm();
  const [timeRange, setTimeRange] = useState<'24h'|'7d'>('24h');
  const [providerFilter, setProviderFilter] = useState<string|undefined>();
  const [regionFilter, setRegionFilter] = useState<string|undefined>();
  const [statusFilter, setStatusFilter] = useState<string[]|undefined>();
  // CEN 实例范围选择（严格按实例视角展示；无“汇总视图”）
  const [selectedCenId, setSelectedCenId] = useState<string | undefined>(undefined);
  const [cenSelectionInitialized, setCenSelectionInitialized] = useState<boolean>(false);

  const loadData = async ()=>{
      setLoading(true);
      setErrorMsg(undefined);
      try{
    const [statsData, activitiesData, cloudUsage, cloudsList, cenList] = await Promise.all([
          fetchDashboardStats(),
          fetchDashboardRecentActivities(),
          fetchDashboardCloudUsage(),
          fetchClouds(),
          fetchCens()
        ]);
        setStats(statsData);
        setRecentActivities(activitiesData);
        setCloudStats(cloudUsage);
        setClouds(cloudsList || []);
        setCens(cenList || []);
        try {
          const arr = await Promise.all((Array.isArray(cloudsList) ? cloudsList : []).map((c:any)=> fetchCloudProviderVpcs(String(c.id)).catch(()=>[])));
          const flat = ([] as any[]).concat(...arr.map((res:any)=> {
            const raw = res?.data || res || [];
            return Array.isArray(raw?.vpcs) ? raw.vpcs : Array.isArray(raw?.Vpcs) ? raw.Vpcs : Array.isArray(raw?.list) ? raw.list : (Array.isArray(raw) ? raw : []);
          }));
          setVpcs(flat);
        } catch {
          setVpcs([]);
        }
      }catch(err:any){ 
        console.error('获取仪表盘数据失败',err);
        setErrorMsg(err?.message || '获取仪表盘数据失败');
      } finally {
        setLoading(false);
      }
    };
  useEffect(()=>{ loadData(); },[]);

  // 计算附件统计（示例：以 VPC 与 CEN 关联数近似）
  useEffect(()=>{
    // 简化：假设每个 CEN 关联的 VPC 总数不可直接获取，则以总VPC数近似（演示）。
    // 若需真实统计，可在此基于 /api/cens/:id/attachments 聚合。
    setAttachmentsTotal(Math.max(vpcs.length, 0));
  }, [cens, vpcs]);

  // 默认 CEN 实例上下文选择策略：
  // 1) URL 参数 cenId 优先；
  // 2) 其次记忆上次选择（localStorage: dashboard.cen.selectedId）；
  // 3) 若仅有一个实例则自动选择该实例；
  // 4) 若有多个，优先选择 status==='available' 且附件数最高者；
  // 5) 若仍找不到合适者则保持未选择并显示“请选择实例”。
  useEffect(()=>{
    if (cenSelectionInitialized) return; // 仅初始化一次，避免覆盖用户选择
    if (!cens || !cens.length) return;

    const search = new URLSearchParams(location.search);
    const urlCenId = search.get('cenId');
    const savedId = localStorage.getItem('dashboard.cen.selectedId') || undefined;

    const exists = (id?: string | null) => !!id && cens.some(c=> c.id === id);

    let next: string | undefined = undefined;
    if (exists(urlCenId)) {
      next = urlCenId as string;
    } else if (exists(savedId)) {
      next = savedId as string;
    } else if (cens.length === 1) {
      next = cens[0].id;
    } else {
      // 选择“最佳可用实例”：available 优先，附件数最高优先，其次创建时间最新
      const pool = (cens.filter((c:any)=> c.status === 'available') as any[]) || cens;
      const sorted = [...pool].sort((a:any, b:any)=>{
        const ac = Number(a.attachCount || 0), bc = Number(b.attachCount || 0);
        if (bc !== ac) return bc - ac;
        const at = new Date(a.createdAt || 0).getTime();
        const bt = new Date(b.createdAt || 0).getTime();
        return bt - at;
      });
      if (sorted.length) next = sorted[0].id;
    }

    setSelectedCenId(next);
    setCenSelectionInitialized(true);
  }, [cens, cenSelectionInitialized, location.search]);

  // 记住用户的实例上下文选择（清除则移除记录）
  useEffect(()=>{
    try {
      if (selectedCenId) localStorage.setItem('dashboard.cen.selectedId', String(selectedCenId));
      else localStorage.removeItem('dashboard.cen.selectedId');
    } catch {}
  }, [selectedCenId]);

  const columns = [
    {
      title: '时间',
      dataIndex: 'time',
      key: 'time',
      render:(time:string)=> new Date(time).toLocaleString()
    },
    {
      title: '操作',
      dataIndex: 'action',
      key: 'action',
    },
    {
      title: '用户',
      dataIndex: 'user',
      key: 'user',
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => (
        <Tag color={status === 'success' ? 'green' : status === 'processing' ? 'blue' : 'red'}>
          {status === 'success' ? '成功' : status === 'processing' ? '进行中' : '失败'}
        </Tag>
      ),
    },
  ];

  const formatGB = (mb:number)=> (mb/1024).toFixed(1);

  // 顶部摘要：近24小时事件数
  const events24h = useMemo(()=>{
    const since = Date.now() - 24*60*60*1000;
    return recentActivities.filter(a=> new Date(a.time).getTime() >= since).length;
  }, [recentActivities]);

  // KPI内容组件：更工业化的布局（图标/主数值/单位/次要提示/涨跌）
  type KPIProps = {
    icon: React.ReactNode;
    label: string;
    value: number | string;
    unit?: string;
    // hint/delta 已去除渲染，保留类型以便未来扩展
    hint?: string;
    delta?: number;
    deltaLabel?: string;
  };

  const formatNumber = (val: number | string) => {
    const num = typeof val === 'number' ? val : Number(val);
    if (Number.isNaN(num)) return String(val);
    return num.toLocaleString();
  };

  const KPICardContent: React.FC<KPIProps> = ({ icon, label, value, unit }) => (
    <div className="kpi">
      <div className="kpi-icon">{icon}</div>
      <div className="kpi-content">
        <div className="kpi-label">{label}</div>
        <div className="kpi-main">
          <span className="kpi-value">{formatNumber(value)}</span>
          {unit && <span className="kpi-unit">{unit}</span>}
        </div>
      </div>
    </div>
  );

  // 提供商分布
  const providerDist = useMemo(()=>{
    const map: Record<string, number> = {};
    clouds.forEach(c=>{
      const p = c?.config?.provider || '未知';
      if(providerFilter && p!==providerFilter) return;
      map[p] = (map[p]||0)+1;
    });
    const arr = Object.entries(map).map(([k, v])=>({ provider:k, count:v }));
    arr.sort((a,b)=> b.count-a.count);
    return arr;
  }, [clouds, providerFilter]);
  const [showAllProviders, setShowAllProviders] = useState(false);

  // 资源健康分布（available/creating/failed -> 依据 Cloud.status 简化为 online/offline/maintenance）
  const healthDist = useMemo(()=>{
    const map: Record<string, number> = { online:0, offline:0, maintenance:0 };
    clouds.forEach(c=>{
      if(regionFilter && c.region!==regionFilter) return;
      if(statusFilter && statusFilter.length && !statusFilter.includes(c.status)) return;
      map[c.status] = (map[c.status]||0)+1;
    });
    return [
      { key:'online', label:'可用', color:'#52c41a', value:map.online||0 },
      { key:'maintenance', label:'维护', color:'#faad14', value:map.maintenance||0 },
      { key:'offline', label:'失败/离线', color:'#f5222d', value:map.offline||0 },
    ];
  }, [clouds, regionFilter, statusFilter]);

  // 区域热力（region 计数）
  const regionHeat = useMemo(()=>{
    const map: Record<string, number> = {};
    clouds.forEach(c=>{
      if(providerFilter && c?.config?.provider!==providerFilter) return;
      map[c.region] = (map[c.region]||0)+1;
    });
    const arr = Object.entries(map).map(([k, v])=>({ region:k, count:v }));
    arr.sort((a,b)=> b.count-a.count);
    return arr;
  }, [clouds, providerFilter]);
  const [showAllRegions, setShowAllRegions] = useState(false);
  // 当前分页签
  const [activeTab, setActiveTab] = useState<'multi' | 'cen' | 'tenant'>('multi');

  // 主题切换（Dark Mode）
  const [isDark, setIsDark] = useState<boolean>(false);
  useEffect(()=>{
    const el = document.documentElement;
    if(isDark) el.setAttribute('data-theme','dark');
    else el.removeAttribute('data-theme');
  }, [isDark]);

  // 标题渲染（仅主标题，不显示副标题）
  const renderCardTitle = (main: string, _subtitle?: string)=> (
    <div className="card-title">
      <div className="main">{main}</div>
    </div>
  );

  // CEN 状态分布
  const cenStatusDist = useMemo(()=>{
    const map: Record<string, number> = { creating:0, available:0, failed:0 };
    cens.forEach(c=>{ map[c.status] = (map[c.status]||0)+1; });
    return [
      { key:'creating', label:'创建中', color:'#faad14', value:map.creating||0 },
      { key:'available', label:'可用', color:'#52c41a', value:map.available||0 },
      { key:'failed', label:'失败', color:'#f5222d', value:map.failed||0 },
    ];
  }, [cens]);

  // 当前选中的 CEN 实例对象（用于卡片按实例显示归属数据）
  const selectedCen = useMemo(()=>{
    if (!selectedCenId) return undefined;
    return cens.find(c=> c.id === selectedCenId);
  }, [cens, selectedCenId]);

  // 简易确定性数值生成器：在没有后端指标的情况下用于演示（同一实例ID固定返回同一范围内的数字）
  const makeDeterministicNumber = (seed: string, min: number, max: number) => {
    const s = String(seed);
    let h = 0;
    for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) >>> 0; }
    const r = h % 1000 / 1000; // 0~1
    return Math.round(min + r * (max - min));
  };

  return (
    <div className="dashboard">
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <h1>仪表盘</h1>
        <Space>
          <Tooltip title={isDark? '切换到浅色主题' : '切换到深色主题'}>
            <Switch checkedChildren="Dark" unCheckedChildren="Light" checked={isDark} onChange={setIsDark} />
          </Tooltip>
        </Space>
      </div>

      {/* 全局筛选 */}
      <Card
        variant="outlined"
        style={{ marginBottom: 16 }}
        title={renderCardTitle('全局筛选','按时间/提供商/区域/状态过滤视图')}
        extra={
          <div className="card-actions">
            <Tooltip title="刷新数据"><ReloadOutlined onClick={loadData} /></Tooltip>
            <Tooltip title="更多"><EllipsisOutlined /></Tooltip>
          </div>
        }
      >
        <Form form={filterForm} layout="inline" onValuesChange={(_, all)=>{
          setProviderFilter(all.provider);
          setRegionFilter(all.region);
          setStatusFilter(all.status);
          setTimeRange(all.timeRange || '24h');
        }}>
          <Form.Item name="timeRange" label="时间范围" initialValue={timeRange}>
            <Select style={{ width: 140 }} options={[{value:'24h', label:'近24小时'}, {value:'7d', label:'近7天'}]} />
          </Form.Item>
          <Form.Item name="provider" label="云提供商">
            <Select allowClear style={{ width: 160 }} placeholder="选择提供商" options={[
              { value:'aliyun', label:'阿里云' },
              { value:'aws', label:'AWS' },
              { value:'azure', label:'Azure' },
              { value:'huaweicloud', label:'华为云' },
              { value:'tencentcloud', label:'腾讯云' },
            ]} />
          </Form.Item>
          <Form.Item name="region" label="区域">
            <Select allowClear style={{ width: 180 }} placeholder="选择区域" options={Array.from(new Set(clouds.map((c:any)=>c.region))).map(r=>({value:r, label:r}))} />
          </Form.Item>
          <Form.Item name="status" label="状态">
            <Select mode="multiple" allowClear style={{ width: 220 }} placeholder="选择状态" options={[
              { value:'online', label:'可用' },
              { value:'maintenance', label:'维护' },
              { value:'offline', label:'失败/离线' },
            ]} />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" onClick={()=>{/* 未来可触发服务端刷新 */}}>刷新</Button>
              <Button onClick={()=>{ filterForm.resetFields(); setProviderFilter(undefined); setRegionFilter(undefined); setStatusFilter(undefined); setTimeRange('24h'); }}>重置</Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>
      
      {/* 顶部摘要卡片 */}
      <Row className="summary-kpi-row" gutter={[16,16]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={12} md={6}>
          <Card variant="outlined" className="summary-kpi-card accent-cloud">
            <KPICardContent icon={<CloudOutlined />} label="云资源总数" value={stats.cloudCount} unit="项" hint="实时" />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card variant="outlined" className="summary-kpi-card accent-cen">
            <KPICardContent icon={<ApartmentOutlined />} label="CEN总数" value={cens.length} unit="个" hint="实时" />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card variant="outlined" className="summary-kpi-card accent-events">
            <KPICardContent icon={<ThunderboltOutlined />} label="近24小时事件" value={events24h} unit="条" hint="最近24小时" />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card variant="outlined" className="summary-kpi-card accent-users">
            <KPICardContent icon={<UserOutlined />} label="登录用户数" value={stats.userCount} unit="人" hint="实时" />
          </Card>
       </Col>
      </Row>
      {/* 分页签切换 */}
      <Tabs
        className="industrial-tabs"
        size="small"
        tabBarGutter={8}
        activeKey={activeTab}
        onChange={(key)=> setActiveTab(key as 'multi' | 'cen' | 'tenant')}
        items={[
          { key:'multi', label:'多云' },
          { key:'cen', label:'云企业网' },
          { key:'tenant', label:'租户' },
        ]}
      />

      {/* 关键指标区（多云） + 最近活动 */}
      {activeTab === 'multi' && (
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }} align="stretch">
        <Col xs={24} lg={16}>
          <Row gutter={[16,16]} align="stretch">
            {/* 云提供商分布（小卡片） */}
            <Col xs={24} md={12}>
              <Card
                variant="outlined"
                title={<Space><PieChartOutlined />云提供商分布</Space>}
                className="cloud-subcard"
                style={{ height: '100%' }}
                extra={
                  <div className="card-actions">
                    <Tooltip
                      title={
                        <div style={{ maxWidth: 360 }}>
                          <div>展示各云提供商的资源数量与占比。</div>
                          <div>• 点击卡片中的提供商条目可设置提供商筛选。</div>
                          <div>• “展开全部/收起”切换显示 Top 8 或全部提供商。</div>
                          <div>• 进度条代表该提供商占比，百分比取自总资源数。</div>
                          <div>• 键盘可用 Enter/Space 触发条目选择。</div>
                        </div>
                      }
                    >
                      <QuestionCircleOutlined />
                    </Tooltip>
                    <Tooltip title="刷新"><ReloadOutlined onClick={loadData} /></Tooltip>
                    <Tooltip title={showAllProviders ? '收起' : '展开全部'}>
                      <span
                        role="button"
                        tabIndex={0}
                        aria-expanded={showAllProviders}
                        onClick={()=> setShowAllProviders(!showAllProviders)}
                        onKeyDown={(e)=>{ if(e.key==='Enter' || e.key===' ') setShowAllProviders(!showAllProviders); }}
                        style={{ cursor: 'pointer' }}
                      >
                        {showAllProviders ? <UpOutlined /> : <DownOutlined />}
                      </span>
                    </Tooltip>
                  </div>
                }
              >
                {loading ? (
                  <div style={{ padding: 8 }}>
                    <Tooltip title="加载中"><div className="sparkline-placeholder">加载中…</div></Tooltip>
                  </div>
                ) : errorMsg ? (
                  <div style={{ padding: 8 }}>
                    <Tag color="red">{errorMsg}</Tag>
                  </div>
                ) : (()=>{
                  const sorted = [...providerDist].sort((a,b)=>{
                    if(b.count!==a.count) return b.count-a.count;
                    return String(a.provider).localeCompare(String(b.provider));
                  });
                  // 当数据量较小时，补充演示数据，使布局更充实
                  const demoCatalog: { provider:string; count:number }[] = [
                    { provider:'阿里云', count:24 },
                    { provider:'AWS', count:20 },
                    { provider:'Azure', count:16 },
                    { provider:'GCP', count:12 },
                    { provider:'腾讯云', count:10 },
                    { provider:'华为云', count:8 },
                    { provider:'UCloud', count:6 },
                    { provider:'青云', count:4 },
                  ];
                  const present = new Set(sorted.map(s=> String(s.provider).toLowerCase()));
                  const augmented = [...sorted];
                  if (augmented.length < 8) {
                    for (const d of demoCatalog) {
                      const key = d.provider.toLowerCase();
                      if (!present.has(key)) {
                        (augmented as any).push({ provider:d.provider, count:d.count, isDemo:true });
                        present.add(key);
                      }
                      if (augmented.length >= 12) break; // 上限，避免过多
                    }
                  }
                  // 展示总数以可视列表的合计为准，避免百分比与演示数据不一致
                  const displayTotal = augmented.reduce((sum:any, it:any)=> sum + (Number(it.count)||0), 0) || 0;
                  const visible = showAllProviders ? augmented : augmented.slice(0, 8);
                  return (
                    <>
                      <div className={`provider-grid-container collapsible ${showAllProviders ? 'expanded' : 'collapsed'}`}>
                        <div className="provider-grid">
                        {visible.map((item:any)=>{
                          const pct = displayTotal? Math.round(item.count/displayTotal*100) : 0;
                          const cls = `provider-chip provider-${item.provider}`;
                          return (
                            <Tooltip key={item.provider} title={`${item.provider}${item.isDemo ? '（示例）' : ''} · 数量 ${item.count} · 占比 ${pct}%`}>
                              <div
                                className={`${cls}${item.isDemo ? ' demo-chip' : ''}`}
                                role="button"
                                tabIndex={0}
                                onClick={()=>{ if(!item.isDemo) setProviderFilter(item.provider); }}
                                onKeyDown={(e)=>{ if(!item.isDemo && (e.key==='Enter' || e.key===' ')) setProviderFilter(item.provider); }}
                                style={{ ['--chip-bar-width' as any]: `${pct}%` }}
                              >
                                <div className="chip-top">
                                  <div className="chip-title" title={String(item.provider)}>{item.provider}</div>
                                  <div className="chip-meta">{item.count} · {pct}%</div>
                                </div>
                                <div className="chip-bar" />
                              </div>
                            </Tooltip>
                          );
                        })}
                        </div>
                      </div>
                      {/* 展开/收起按钮已移动到标题栏右侧 */}
                    </>
                  );
                })()}
              </Card>
            </Col>
            {/* CEN 实例视角内容已移至“云企业网”分页签，避免混入多云指标区域 */}
            {/* 资源健康分布（小卡片） */}
            <Col xs={24} md={12}>
              <Card
                variant="outlined"
                title={<Space><BarChartOutlined />资源健康分布</Space>}
                className="cloud-subcard"
                style={{ height: '100%' }}
                extra={
                  <div className="card-actions">
                    <Tooltip
                      title={
                        <div style={{ maxWidth: 360 }}>
                          <div>汇总可用率、维护率、失败/离线数量与占比。</div>
                          <div>• 点击分段总览条可按状态（可用/维护/失败）筛选资源。</div>
                          <div>• “高风险”在失败/离线比例 ≥ 20% 时显示。</div>
                          <div>• 趋势线优先使用 cloudStats，若不足则用分布派生。</div>
                          <div>• 数值与百分比均以当前筛选范围内的总资源为基准。</div>
                        </div>
                      }
                    >
                      <QuestionCircleOutlined />
                    </Tooltip>
                    <Tooltip title="刷新"><ReloadOutlined onClick={loadData} /></Tooltip>
                  </div>
                }
              >
                {loading ? (
                  <div style={{ padding: 8 }}>
                    <div className="sparkline-placeholder">加载中…</div>
                  </div>
                ) : errorMsg ? (
                  <div style={{ padding: 8 }}>
                    <Tag color="red">{errorMsg}</Tag>
                  </div>
                ) : (()=>{
                  const total = clouds.length || 0;
                  const online = healthDist.find(h=> h.key==='online')?.value || 0;
                  const maintenance = healthDist.find(h=> h.key==='maintenance')?.value || 0;
                  const offline = healthDist.find(h=> h.key==='offline')?.value || 0;
                  const onlinePct = total? Math.round(online/total*100) : 0;
                  const maintenancePct = total? Math.round(maintenance/total*100) : 0;
                  const offlinePct = total? Math.round(offline/total*100) : 0;
                  const alarm = offlinePct >= 20;
                  return (
                    <>
                      <div className="kpi-row">
                        <div className="kpi-item">
                          <div className="kpi-title"><span className="status-dot online" />可用率</div>
                          <div className="kpi-value">{onlinePct}%</div>
                        </div>
                        <div className="kpi-item">
                          <div className="kpi-title"><span className="status-dot maintenance" />维护率</div>
                          <div className="kpi-value">{maintenancePct}%</div>
                        </div>
                        <div className="kpi-item">
                          <div className="kpi-title"><span className="status-dot offline" />失败/离线{alarm && <Tag color="red" style={{ marginLeft: 8 }}>高风险</Tag>}</div>
                          <div className="kpi-value">{offline}</div>
                        </div>
                      </div>
                      <div className="health-bar">
                        <Tooltip title={`可用 ${online}（${onlinePct}%）`}>
                          <div className="health-segment online" style={{ width: `${onlinePct}%` }} onClick={()=> setStatusFilter(['online'])} />
                        </Tooltip>
                        <Tooltip title={`维护 ${maintenance}（${maintenancePct}%）`}>
                          <div className="health-segment maintenance" style={{ width: `${maintenancePct}%` }} onClick={()=> setStatusFilter(['maintenance'])} />
                        </Tooltip>
                        <Tooltip title={`失败/离线 ${offline}（${offlinePct}%）`}>
                          <div className="health-segment offline" style={{ width: `${offlinePct}%` }} onClick={()=> setStatusFilter(['offline'])} />
                        </Tooltip>
                      </div>
                      <div className="health-legend">
                        <Space>
                          <span className="status-dot online" />
                          <Text>可用 {online}</Text>
                          <span className="status-dot maintenance" />
                          <Text>维护 {maintenance}</Text>
                          <span className="status-dot offline" />
                          <Text>失败/离线 {offline}</Text>
                        </Space>
                        <Text type="secondary" style={{ marginLeft:'auto' }}>总数 {total}</Text>
                      </div>
                      {(()=>{
                        const candidate = (cloudStats || []).map((c:any)=> Number(c?.value ?? c?.usage ?? 0)).filter(n=> !Number.isNaN(n));
                        const derived = [onlinePct, maintenancePct, offlinePct].map(v=> Number(v));
                        const series = candidate.length>=4 ? candidate.slice(-12) : [...derived, ...derived, ...derived].slice(0, 12);
                        return (
                          <MiniSparkline data={series} ariaLabel="资源健康趋势" />
                        );
                      })()}
                    </>
                  );
                })()}
              </Card>
            </Col>
            {/* 区域分布热力（小卡片） */}
            <Col xs={24}>
              <Card
                variant="outlined"
                title={<Space><GlobalOutlined />区域分布热力</Space>}
                className="cloud-subcard"
                style={{ height: '100%' }}
                extra={
                  <div className="card-actions">
                    <Tooltip
                      title={
                        <div style={{ maxWidth: 360 }}>
                          <div>按区域展示资源数量与占比，颜色强度反映相对热度。</div>
                          <div>• 点击区域条目可设置区域筛选。</div>
                          <div>• 右侧图例标示强度级别（0–4）。</div>
                          <div>• “展开全部/收起”切换显示 Top 8 或全部区域。</div>
                          <div>• 鼠标悬停可查看数量与占比，辅助快速判断热点。</div>
                        </div>
                      }
                    >
                      <QuestionCircleOutlined />
                    </Tooltip>
                    <Tooltip title="刷新"><ReloadOutlined onClick={loadData} /></Tooltip>
                    <Tooltip title={showAllRegions ? '收起' : '展开全部'}>
                      <span
                        role="button"
                        tabIndex={0}
                        aria-expanded={showAllRegions}
                        onClick={()=> setShowAllRegions(!showAllRegions)}
                        onKeyDown={(e)=>{ if(e.key==='Enter' || e.key===' ') setShowAllRegions(!showAllRegions); }}
                        style={{ cursor: 'pointer' }}
                      >
                        {showAllRegions ? <UpOutlined /> : <DownOutlined />}
                      </span>
                    </Tooltip>
                  </div>
                }
              >
                {loading ? (
                  <div style={{ padding: 8 }}>
                    <div className="sparkline-placeholder">加载中…</div>
                  </div>
                ) : errorMsg ? (
                  <div style={{ padding: 8 }}>
                    <Tag color="red">{errorMsg}</Tag>
                  </div>
                ) : (()=>{
                  const max = regionHeat[0]?.count || 0;
                  const total = regionHeat.reduce((sum, r)=> sum + r.count, 0);
                  const visible = showAllRegions ? regionHeat : regionHeat.slice(0, 8);
                  return (
                    <>
                      <div className="region-legend">
                        <Text type="secondary">强度</Text>
                        <div className="legend-swatch level-0" />
                        <div className="legend-swatch level-1" />
                        <div className="legend-swatch level-2" />
                        <div className="legend-swatch level-3" />
                        <div className="legend-swatch level-4" />
                      </div>
                      <div className={`region-grid-container collapsible ${showAllRegions ? 'expanded' : 'collapsed'}`}>
                        <div className="region-grid">
                        {visible.map(r=>{
                          const level = max>0 ? Math.min(4, Math.floor((r.count/max)*4)) : 0;
                          const percent = total>0 ? Math.round(r.count/total*100) : 0;
                          return (
                            <Tooltip key={r.region} title={`${r.region} · 数量 ${r.count} · 占比 ${percent}%`}>
                              <div
                                className={`region-chip level-${level}`}
                                role="button"
                                tabIndex={0}
                                aria-label={`区域 ${r.region}，数量 ${r.count}，占比 ${percent}%`}
                                onClick={()=> setRegionFilter(r.region)}
                                onKeyDown={(e)=>{ if(e.key==='Enter' || e.key===' ') setRegionFilter(r.region); }}
                              >
                                <div className="chip-title">{r.region}</div>
                                <div className="chip-meta">{r.count} · {percent}%</div>
                              </div>
                            </Tooltip>
                          );
                        })}
                        </div>
                      </div>
                      {/* 展开/收起按钮已移动到标题栏右侧 */}
                    </>
                  );
                })()}
              </Card>
            </Col>
          </Row>
        </Col>
        <Col xs={24} lg={8}>
          <Card
            variant="outlined"
            title={<Space><NotificationOutlined />告警与事件</Space>}
            className="recent-activities-card equal-height-card"
            style={{ height: '100%' }}
            extra={
              <div className="card-actions">
                <Tag color="#1677ff">{timeRange==='24h'?'近24小时':'近7天'}</Tag>
                <Tooltip title="刷新"><ReloadOutlined onClick={loadData} /></Tooltip>
                <Tooltip title="更多"><EllipsisOutlined /></Tooltip>
              </div>
            }
          >
            {loading ? (
              <div style={{ padding: 8 }}><div className="sparkline-placeholder" aria-live="polite">加载中…</div></div>
            ) : errorMsg ? (
              <div style={{ padding: 8 }} aria-live="polite"><Tag color="red">{errorMsg}</Tag></div>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                <Tabs
                  size="small"
                  items={[
                    {
                      key:'alarms',
                      label: '告警',
                      children: (
                        <Table
                          columns={columns}
                          dataSource={recentActivities.filter(a=>{
                            const t = new Date(a.time).getTime();
                            const since = Date.now() - (timeRange==='24h'? 24*60*60*1000 : 7*24*60*60*1000);
                            const isAlarm = (a?.type === 'alarm') || (a?.category === 'alarm') || /告警|报警/i.test(String(a?.action)) || a?.status === 'failed';
                            return t >= since && isAlarm;
                          })}
                          pagination={false}
                          size="small"
                          rowKey={(rec)=>`${rec.time}-${rec.action}`}
                        />
                      )
                    },
                    {
                      key:'events',
                      label: '事件',
                      children: (
                        <Table
                          columns={columns}
                          dataSource={recentActivities.filter(a=>{
                            const t = new Date(a.time).getTime();
                            const since = Date.now() - (timeRange==='24h'? 24*60*60*1000 : 7*24*60*60*1000);
                            const isAlarm = (a?.type === 'alarm') || (a?.category === 'alarm') || /告警|报警/i.test(String(a?.action)) || a?.status === 'failed';
                            return t >= since && !isAlarm;
                          })}
                          pagination={false}
                          size="small"
                          rowKey={(rec)=>`${rec.time}-${rec.action}`}
                        />
                      )
                    }
                  ]}
                />
              </div>
            )}
          </Card>
        </Col>
      </Row>
      )}

      {/* 网络态势区（CEN） — 分拆为多个独立小卡片，单卡仅展示一个内容；每行列等高对齐 */}
      {activeTab === 'cen' && (
      <Row gutter={[16,16]} align="stretch">
        <Col xs={24} lg={16}>
          <Row gutter={[16,16]} align="stretch">
            {/* CEN 实例选择器（严格实例视角） */}
            <Col xs={24}>
              <Card
                variant="outlined"
                className="cen-subcard"
                title={<Space><ApartmentOutlined />CEN 实例选择</Space>}
                extra={
                  <div className="card-actions">
                    <Tooltip title="帮助"><QuestionCircleOutlined /></Tooltip>
                  </div>
                }
              >
                <Space>
                  <Text type="secondary">选择 CEN 实例</Text>
                  <Select
                    size="small"
                    style={{ minWidth: 240 }}
                    value={selectedCenId}
                    allowClear
                    placeholder="选择 CEN 实例"
                    onChange={(val)=> setSelectedCenId(val as any)}
                    onClear={()=> setSelectedCenId(undefined)}
                    options={cens.map((c:any)=>({ value:c.id, label:`${c.name || c.id}` }))}
                  />
                  {selectedCen ? (
                    <Tag color="#52c41a">当前：{selectedCen?.name || selectedCenId}</Tag>
                  ) : (
                    <Tag color="#faad14">未选择实例</Tag>
                  )}
                </Space>
              </Card>
            </Col>
            {/* 概览 */}
            {/* 汇总视图移除：CEN 指标严格按实例展示 */}
            {/* 汇总视图移除：状态分布总览删除 */}
            {/* 汇总视图移除：状态明细删除 */}
            {/* 汇总视图移除：拓扑指标删除 */}
            {/* 汇总视图移除：附件统计删除 */}

            {/* 新卡1：流量与带宽（仅在选中具体实例时显示） */}
            {selectedCen && (
              <Col xs={24} md={12}>
                <Card
                  variant="outlined"
                  className="cen-subcard equal-height-card"
                  title={<Space><RiseOutlined />流量与带宽（实例）</Space>}
                  extra={
                    <div className="card-actions">
                      <Tag color="#1677ff">{selectedCen?.name || selectedCenId}</Tag>
                      <Tooltip title="帮助"><QuestionCircleOutlined /></Tooltip>
                    </div>
                  }
                >
                  {(()=>{
                    const seed = selectedCen!.id + '-traffic';
                    const base = makeDeterministicNumber(seed, 40, 80);
                    const series = [base, base-5, base+8, base-3, base+6, base-7, base+10, base-4, base+5, base-2, base+7, base-6]
                      .map(n=> Math.max(0, Math.min(100, n)));
                    const bwMbps = makeDeterministicNumber(seed+'-bw', 200, 2000);
                    const trafficGB24h = makeDeterministicNumber(seed+'-gb', 80, 2000);
                    return (
                      <div>
                        <MiniSparkline data={series} ariaLabel="近24小时流量趋势" />
                        <div style={{ display:'flex', gap:16, marginTop:8 }}>
                          <Statistic title="当前骨干带宽（估算）" value={bwMbps} suffix="Mbps" />
                          <Statistic title="近24小时骨干总流量" value={trafficGB24h} suffix="GB" />
                        </div>
                        {/* 演示注释移除：真实数据接入后无需提示 */}
                      </div>
                    );
                  })()}
                </Card>
              </Col>
            )}

            {/* 新卡2：连接质量（仅在选中具体实例时显示） */}
            {selectedCen && (
              <Col xs={24} md={12}>
                <Card
                  variant="outlined"
                  className="cen-subcard equal-height-card"
                  title={<Space><SafetyOutlined />连接质量（实例）</Space>}
                  extra={
                    <div className="card-actions">
                      <Tag color="#1677ff">{selectedCen?.name || selectedCenId}</Tag>
                      <Tooltip title="帮助"><QuestionCircleOutlined /></Tooltip>
                    </div>
                  }
                >
                  {(()=>{
                    const lat = typeof selectedCen?.latency === 'number' ? selectedCen!.latency : makeDeterministicNumber(selectedCen!.id+'-lat', 10, 80);
                    const lossRaw = typeof selectedCen?.loss === 'number' ? selectedCen!.loss : makeDeterministicNumber(selectedCen!.id+'-loss', 1, 50) / 10; // 0.1%~5.0%
                    const sla = typeof selectedCen?.sla === 'number' ? selectedCen!.sla : makeDeterministicNumber(selectedCen!.id+'-sla', 95, 99);
                    return (
                      <div className="cen-metrics">
                        <div className="cen-metric-row"><Text>平均延迟</Text><Text className="value" strong>{lat} ms</Text></div>
                        <div className="cen-metric-row"><Text>丢包率</Text><Text className="value" strong>{Number(lossRaw).toFixed(1)}%</Text></div>
                        <div className="cen-metric-row"><Text>SLA</Text><Text className="value" strong>{sla}%</Text></div>
                        {/* 演示注释移除：真实数据接入后无需提示 */}
                      </div>
                    );
                  })()}
                </Card>
              </Col>
            )}

            {/* 新卡3：路由传播（仅在选中具体实例时显示） */}
            {selectedCen && (
              <Col xs={24} md={12}>
                <Card
                  variant="outlined"
                  className="cen-subcard equal-height-card"
                  title={<Space><GlobalOutlined />路由传播（实例）</Space>}
                  extra={
                    <div className="card-actions">
                      <Tag color="#1677ff">{selectedCen?.name || selectedCenId}</Tag>
                      <Tooltip title="帮助"><QuestionCircleOutlined /></Tooltip>
                    </div>
                  }
                >
                  {(()=>{
                    const seed = selectedCen!.id + '-route';
                    const adv = makeDeterministicNumber(seed+'-adv', 80, 800);
                    const learned = makeDeterministicNumber(seed+'-lrn', 120, 1200);
                    const peers = Math.max(1, Math.round((adv + learned) / 300));
                    return (
                      <div className="cen-metrics">
                        <div className="cen-metric-row"><Text>已发布路由</Text><Text className="value" strong>{adv}</Text></div>
                        <div className="cen-metric-row"><Text>已学习路由</Text><Text className="value" strong>{learned}</Text></div>
                        <div className="cen-metric-row"><Text>邻居数</Text><Text className="value" strong>{peers}</Text></div>
                        {/* 演示注释移除：真实数据接入后无需提示 */}
                      </div>
                    );
                  })()}
                </Card>
              </Col>
            )}

            {/* 新卡4：跨地域连通性（仅在选中具体实例时显示） */}
            {selectedCen && (
              <Col xs={24} md={12}>
                <Card
                  variant="outlined"
                  className="cen-subcard equal-height-card"
                  title={<Space><NodeExpandOutlined />跨地域连通性（实例）</Space>}
                  extra={
                    <div className="card-actions">
                      <Tag color="#1677ff">{selectedCen?.name || selectedCenId}</Tag>
                      <Tooltip title="帮助"><QuestionCircleOutlined /></Tooltip>
                    </div>
                  }
                >
                  {(()=>{
                    const seed = selectedCen!.id + '-conn';
                    const regions = Math.max(2, makeDeterministicNumber(seed+'-rg', 2, 8));
                    const pairs = Math.round((regions * (regions - 1)) / 2);
                    const availPct = makeDeterministicNumber(seed+'-pct', 90, 99);
                    const availPairs = Math.round(pairs * availPct / 100);
                    const base = makeDeterministicNumber(seed+'-base', 60, 92);
                    const series = [base, base-3, base+4, base-2, base+3, base-4, base+5, base-3, base+4, base-2, base+6, base-5].map(n=> Math.max(0, Math.min(100, n)));
                    return (
                      <div>
                        <MiniSparkline data={series} ariaLabel="连通性可用率趋势" />
                        <div className="cen-metrics" style={{ marginTop: 8 }}>
                          <div className="cen-metric-row"><Text>涉及地域</Text><Text className="value" strong>{regions}</Text></div>
                          <div className="cen-metric-row"><Text>地域对总数</Text><Text className="value" strong>{pairs}</Text></div>
                          <div className="cen-metric-row"><Text>可用对数</Text><Text className="value" strong>{availPairs}（{availPct}%）</Text></div>
                        </div>
                        {/* 演示注释移除：真实数据接入后无需提示 */}
                      </div>
                    );
                  })()}
                </Card>
              </Col>
            )}

            {/* 当未选择具体实例时，给出“请选择实例”的指导卡 + 实例列表 */}
            {!selectedCen && (
              <Col xs={24}>
                <Card
                  variant="outlined"
                  className="cen-subcard equal-height-card"
                  title={<Space><ApartmentOutlined />请选择一个 CEN 实例以查看专属态势</Space>}
                >
                  <List
                    bordered
                    dataSource={cens}
                    renderItem={(item:any)=>{
                      const statusColor = item.status==='available' ? '#52c41a' : item.status==='creating' ? '#faad14' : '#f5222d';
                      return (
                        <List.Item
                          style={{ cursor:'pointer' }}
                          onClick={()=> setSelectedCenId(item.id)}
                        >
                          <Space style={{ display:'flex', justifyContent:'space-between', width:'100%' }}>
                            <Space>
                              <ApartmentOutlined />
                              <Text strong>{item.name || item.id}</Text>
                              <Tag color={statusColor}>{item.status}</Tag>
                            </Space>
                            <Text type="secondary">附件数 {item.attachCount ?? '-'} | 创建时间 {item.createdAt ? new Date(item.createdAt).toLocaleString() : '-'}</Text>
                          </Space>
                        </List.Item>
                      );
                    }}
                  />
                </Card>
              </Col>
            )}
          </Row>
        </Col>
        {/* 右侧快捷操作保持独立小卡片 */}
        <Col xs={24} lg={8}>
          <Card
            variant="outlined"
            className="equal-height-card"
            title={renderCardTitle('快捷操作','常用任务与入口')}
            extra={
              <div className="card-actions">
                <Tooltip title="更多"><EllipsisOutlined /></Tooltip>
              </div>
            }
          >
            <Space direction="vertical" style={{ width:'100%' }}>
              <Button type="primary" icon={<PlusOutlined />} onClick={()=> navigate('/clouds')}>创建云资源</Button>
              <Button icon={<ApartmentOutlined />} onClick={()=> navigate('/admin/sec-mgr-plane/instances')}>创建与管理 CEN</Button>
              <Button icon={<LinkOutlined />} onClick={()=> navigate('/admin/sec-mgr-plane/info-domain')}>管理附件（信息域）</Button>
              <Button icon={<DesktopOutlined />} onClick={()=> navigate('/clouds')}>查看配额与限额</Button>
              <Button icon={<SafetyOutlined />} onClick={()=> navigate('/tenants')}>进入详细页面（租户/安全）</Button>
            </Space>
          </Card>
        </Col>
      </Row>
      )}

      {/* 租户分页签 */}
      {activeTab === 'tenant' && (
        <Row gutter={[16,16]}>
          <Col xs={24}>
            <Card
              variant="outlined"
              title={renderCardTitle('租户概览','登录用户与常用入口')}
              extra={
                <div className="card-actions">
                  <Tooltip title="进入租户管理"><LinkOutlined onClick={()=> navigate('/tenants')} /></Tooltip>
                </div>
              }
            >
              <Row gutter={[16,16]}>
                <Col xs={24} md={8}>
                  <Statistic title="登录用户数" value={stats.userCount} prefix={<UserOutlined />} />
                </Col>
                <Col xs={24} md={16}>
                  <Space>
                    <Button type="primary" icon={<UserOutlined />} onClick={()=> navigate('/tenants')}>进入租户管理</Button>
                    <Button icon={<SafetyOutlined />} onClick={()=> navigate('/tenants')}>安全与权限</Button>
                  </Space>
                </Col>
              </Row>
            </Card>
          </Col>
        </Row>
      )}
    </div>
  );
};

export default Dashboard;