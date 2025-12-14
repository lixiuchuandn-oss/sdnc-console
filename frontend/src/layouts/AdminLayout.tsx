import React, { useState, useEffect } from 'react';
import { Layout, Menu, Button, Input, Divider, Typography, Row, Col, Card, Space, Tag } from 'antd';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  SlidersOutlined,ProjectOutlined,CodeOutlined,CloudOutlined, UserOutlined, SettingOutlined, MenuUnfoldOutlined, MenuFoldOutlined, RightOutlined,
  ClusterOutlined, TeamOutlined, CodepenOutlined, DesktopOutlined, HddOutlined, GatewayOutlined,
  AppstoreAddOutlined, ApiOutlined, DatabaseOutlined, BellOutlined, RobotOutlined, EditOutlined, PlayCircleOutlined,
  BulbOutlined, CloudUploadOutlined, GlobalOutlined, UserSwitchOutlined, DeploymentUnitOutlined, LockOutlined, EnvironmentOutlined, BranchesOutlined, AppstoreOutlined, StarOutlined, StarFilled, InboxOutlined, LogoutOutlined, DashboardOutlined, CodeFilled, DatabaseFilled
} from '@ant-design/icons';
import { useAuth } from '../contexts/AuthContext';
import { getRequiredActionForPath, hasPermissionForAction } from '../utils/accessMapping';
import { ROUTE_CATALOG, RouteItem } from '../catalogs/navCatalog';
import { routeSpecs } from '../routes/RouteSpec';

const { Header, Sider, Content } = Layout;

const AdminLayout: React.FC = () => {
  const [collapsed, setCollapsed] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [navKeyword, setNavKeyword] = useState('');
  const [selectedGroupKey, setSelectedGroupKey] = useState<string>('');
  const [activeSidebarKey, setActiveSidebarKey] = useState<string>('/admin/cen_compute');
  const [activeTab, setActiveTab] = useState<string>('全部');
  const [navSection, setNavSection] = useState<'resources'|'favorites'|'products'>('products');
  const [openKeys, setOpenKeys] = useState<string[]>([]);
  const [menuKey, setMenuKey] = useState<number>(0);
  const [favorites, setFavorites] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('ct_fav')||'[]'); } catch { return []; }
  });
  const [recents, setRecents] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('ct_recent')||'[]'); } catch { return []; }
  });
  

  const getItemMeta = (k: string): any => {
    for (const c of visibleCenters) {
      for (const p of (c.items||[])) {
        const found = (p.children||[]).find((it:any)=> it.key === k);
        if (found) return { ...found, platformLabel: p.label, platformIcon: p.icon };
      }
    }
    return null;
  };

  const getItemPlatformLabel = (k: string): string | null => {
    for (const c of visibleCenters) {
      for (const p of (c.items||[])) {
        const found = (p.children||[]).find((it:any)=> it.key === k);
        if (found) return p.label;
      }
    }
    return null;
  };

  const toggleFavorite = (item:any) => {
    setFavorites(prev => {
      const exists = prev.includes(item.key);
      const next = exists ? prev.filter(k=> k !== item.key) : [item.key, ...prev];
      localStorage.setItem('ct_fav', JSON.stringify(next));
      return next;
    });
  };

  const pushRecent = (item:any) => {
    setRecents(prev => {
      const filtered = prev.filter(k=> k !== item.key);
      const next = [item.key, ...filtered].slice(0, 12);
      localStorage.setItem('ct_recent', JSON.stringify(next));
      return next;
    });
  };
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const isProConsole = location.pathname.startsWith('/admin/clouds/console');

  const NAV_DIVIDER_COLOR = 'rgb(200, 207, 218)';
 
  const canAccessPath = (p: string): boolean => {
    const pure = String(p || '').split('?')[0];
    if (!user) return false;
    const role = String(user.role || '').toLowerCase();
    if (role === 'super_admin' || role === 'admin') return true;
    const act = getRequiredActionForPath(pure);
    const perms = Array.isArray(user.permissions) ? user.permissions : [];
    return hasPermissionForAction(perms, act);
  };

  const handleLogout = () => {
    logout();
    navigate('/admin/login');
  };

  const StandardHeader: React.FC = () => (
    <Header style={{ background:'linear-gradient(90deg, #0A4CC0 0%, #1B64ED 100%)', color:'#fff', display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 20px', position:'sticky', top:0, zIndex:1000, height: 64, lineHeight:'64px', boxShadow:'0 4px 16px rgba(0,0,0,0.08)', borderBottom:'1px solid ' + NAV_DIVIDER_COLOR }}>
      <div style={{ display:'flex', alignItems:'center', height:64 }}>
        <Button type="text" icon={(navOpen ? <DatabaseOutlined style={{color:'#fff',fontSize:20}} /> : <DatabaseFilled style={{color:'#fff',fontSize:20}} />)} onClick={()=> {
          setNavOpen(v => {
            const next = !v;
            if (next && !selectedGroupKey) {
              const first = (centers || [])[0]?.key;
              if (first) setSelectedGroupKey(first);
            }
            return next;
          });
        }} style={{height:40,width:40,display:'flex',alignItems:'center',justifyContent:'center'}} />
        <Space size={8} style={{ height:'100%', alignItems:'center' }}>
          <span style={{ fontSize:18, color:'#fff' }}><span style={{ fontWeight:700 }}>Compute</span>.Tower</span>
        </Space>
        <Button type="default" ghost size="small" style={{ marginLeft:8, height:28, padding:'0 10px' }} icon={<DesktopOutlined />} onClick={()=> window.open('/admin/clouds/console','_blank')}>
          控制台
        </Button>
      </div>
      <div style={{ display:'flex',alignItems:'center',gap:16, height:'100%' }}>
        <BellOutlined style={{color:'#fff',fontSize:18}} onClick={()=>navigate('/admin/alarms')} />
        <SettingOutlined style={{color:'#fff',fontSize:18}} onClick={()=>navigate('/admin/settings')} />
        {user && (<>
          <div>
          <UserOutlined style={{color:'#fff',fontSize:18,marginRight:6}} />
          {(() => {
            const full = String(user.fullName || '').trim();
            const shouldUseUsername = (user.role === 'leased_lines_admin') || !full || /\?/.test(full);
            const display = shouldUseUsername ? (user.username || '') : full;
            return <span style={{color:'#fff'}}>{display}</span>;
          })()}
          </div>
          <Button style={{color:'#1062fe',borderRadius:16,fontSize:12}} size="small" onClick={handleLogout}>Logout</Button>
        </>)}
      </div>
    </Header>
  );

  const ProHeader: React.FC = () => (
    <Header style={{ background:'#fff', color:'#1f2a44', display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 20px', position:'sticky', top:0, zIndex:1000, height: 50, lineHeight:'50px', boxShadow:'0 2px 8px rgba(0,0,0,0.08)', borderBottom:'1px solid ' + NAV_DIVIDER_COLOR }}>
      <div style={{display:'inline-flex', alignItems:'center', gap:4}}>
          <AppstoreOutlined style={{color:'#1062fe',fontSize:18}} />
          <span style={{ fontSize:14, color:'#1062fe', marginTop:-2 }}><span style={{ fontWeight:700 }}>Compute</span>.Tower Pro</span>
          <Input.Search allowClear placeholder="搜索当前页面" size="middle" style={{ marginLeft:8, width:240 }}
            onSearch={(v)=> window.dispatchEvent(new CustomEvent('pro-search',{ detail: String(v||'').trim() }))}
          />
      </div>

      <div style={{ display:'flex',alignItems:'center',gap:16, height:'100%' }}>
        <BellOutlined style={{color:'#555555',fontSize:14}} onClick={()=>navigate('/admin/alarms')} />
        {user && (<>
          <div style={{ display:'inline-flex', alignItems:'center', gap:4 }}>
            <UserOutlined style={{color:'#555555',fontSize:14}} />
            {(() => {
              const full = String(user.fullName || '').trim();
              const shouldUseUsername = (user.role === 'leased_lines_admin') || !full || /\?/.test(full);
              const display = shouldUseUsername ? (user.username || '') : full;
              return <span style={{color:'#555555'}}>{display}</span>;
            })()}
          </div>
          <div style={{ display:'inline-flex', alignItems:'center', gap:4 }}>
          <LogoutOutlined style={{color:'#1062fe',fontSize:14}} />
          <Typography.Link onClick={handleLogout} style={{ color:'#1062fe' }}>logout</Typography.Link>
          </div>
        </>)}
      </div>
    </Header>
  );

  const iconOf = (key?: string) => {
    const m: Record<string, React.ReactNode> = {
      AppstoreOutlined: <AppstoreOutlined />,
      DashboardOutlined: <DashboardOutlined />,
      DeploymentUnitOutlined: <DeploymentUnitOutlined />,
      CloudUploadOutlined: <CloudUploadOutlined />,
      DesktopOutlined: <DesktopOutlined />,
      TeamOutlined: <TeamOutlined />,
      UserOutlined: <UserOutlined />,
      UserSwitchOutlined: <UserSwitchOutlined />,
      GatewayOutlined: <GatewayOutlined />,
      LockOutlined: <LockOutlined />,
      ApiOutlined: <ApiOutlined />,
      BranchesOutlined: <BranchesOutlined />,
      GlobalOutlined: <GlobalOutlined />,
      EnvironmentOutlined: <EnvironmentOutlined />,
      BellOutlined: <BellOutlined />,
      DatabaseOutlined: <DatabaseOutlined />,
    };
    return key ? (m[key] || <AppstoreOutlined />) : <AppstoreOutlined />;
  };

  const groupIconOf = (pf: string, grp: string) => {
    const firstSpec = routeSpecs.find(s => s.layout === 'admin' && s.platform === pf && s.group === grp);
    const iconKey = firstSpec?.icon;
    return iconOf(iconKey);
  };

  const adminSpecs = routeSpecs.filter(s => s.layout === 'admin' && !s.hidden);
  const centers: any[] = ['CNMC','SDNCC','CNSOC'].map((pf: any) => ({
    key: pf === 'CNMC' ? '/admin/cen_compute' : pf === 'SDNCC' ? '/admin/cen_sdn' : '/admin/cen_secops',
    label: pf,
    icon: <CodeOutlined />,
    items: Array.from(new Set(adminSpecs.filter(s => s.platform === pf).map(s => String(s.group || '')))).map((grp) => ({
      key: `${pf}_${grp}`,
      label: grp,
      icon: groupIconOf(pf, grp),
      children: adminSpecs
        .filter(s => s.platform === pf && s.group === grp)
        .map((s) => ({ key: s.path, label: s.title || s.breadcrumbLabel || s.id, icon: iconOf(s.icon) })),
    })),
  }));

  const visibleCenters = (centers || [])
    .map((c:any) => ({
      ...c,
      items: (c.items || [])
        .map((p:any) => ({
          ...p,
          children: (p.children || []).filter((it:any) => canAccessPath(String(it.key || ''))),
        }))
        .filter((p:any) => (p.children || []).length > 0),
    }))
    .filter((c:any) => (c.items || []).length > 0);

  useEffect(() => {}, [user, location.pathname]);

  const sidebarForPath = (p: string) => {
    const s = p.toLowerCase();
    if (s.includes('/interconnect') || s.includes('/sec-mgr-plane')) return '/admin/cen_sdn';
    if (s.includes('/alarms')) return '/admin/cen_secops';
    return '/admin/cen_compute';
  };

  useEffect(() => {
    setActiveSidebarKey(sidebarForPath(location.pathname + location.search));
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!collapsed) {
      const center = (visibleCenters.find(c => c.key === activeSidebarKey) || (visibleCenters || [])[0]);
      const currentPath = location.pathname;
      const activeGroup = (center?.items || []).find((p:any) => (p.children || []).some((it:any) => String(it.key || '').split('?')[0] === currentPath));
      const keys = activeGroup ? [activeGroup.key] : [];
      setOpenKeys(keys);
    }
  }, [collapsed, activeSidebarKey, location.pathname]);

  useEffect(() => {
    if (navSection === 'products') {
      setActiveTab('全部');
    }
  }, [navSection]);

  return (
    <Layout style={{ height:'100vh', overflow:'hidden' }}>
      {isProConsole ? <ProHeader /> : <StandardHeader />}
      <>
        <div
          onClick={()=> setNavOpen(false)}
          style={{
            position:'fixed',
            inset:0,
            background:'rgba(0,0,0,0.12)',
            zIndex:1999,
            opacity: navOpen ? 1 : 0,
            transition: 'opacity 200ms ease',
            pointerEvents: navOpen ? 'auto' : 'none',
          }}
        />
        <div
          style={{
            position:'fixed',
            top: isProConsole ? 50 : 64,
            left:0,
            bottom:0,
            width:960,
            zIndex:2000,
            background:'#fff',
            borderRight:'1px solid ' + NAV_DIVIDER_COLOR,
            boxShadow:'0 6px 16px rgba(0,0,0,0.12)',
            display:'flex',
            flexDirection:'column',
            transform: navOpen ? 'translateX(0)' : 'translateX(-100%)',
            transition: 'transform 220ms ease',
          }}
        >
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 20px' }}>
            <Space size={12}>
              <AppstoreOutlined style={{ fontSize:18, color:'#1062fe' }} />
              <Typography.Text style={{ fontSize:16, color:'#1f2a44' }}>全部导航</Typography.Text>
            </Space>
            <Space size={12}>
              <Input.Search allowClear placeholder="搜索功能" style={{ width: 300 }} onSearch={(v)=> setNavKeyword(v)} onChange={(e)=> setNavKeyword(e.target.value)} />
              <Button type="default" style={{ borderColor: NAV_DIVIDER_COLOR }} onClick={()=> setNavOpen(false)}>收起</Button>
            </Space>
          </div>
          <Divider style={{ margin: 0, borderColor: NAV_DIVIDER_COLOR }} />
          <div style={{ display:'flex', flex:1, minHeight:0 }}>
            <div style={{ width: 260, borderRight:'1px solid ' + NAV_DIVIDER_COLOR, padding:'12px 12px', height:'100%', overflow:'auto' }}>
              <Menu
                mode="inline"
                selectedKeys={[navSection]}
                onClick={({ key }) => setNavSection(String(key) as any)}
                style={{ borderRight: '0' }}
                items={[
                  { key: 'resources', icon: <HddOutlined />, label: '我的资源' },
                  { key: 'favorites', icon: <StarOutlined />, label: '我的收藏' },
                  { key: 'products', icon: <AppstoreOutlined />, label: '产品与服务' },
                ]}
              />
              {(() => {
                const platformLabels = Array.from(new Set((visibleCenters || []).flatMap((c:any)=> (c.items||[]).map((p:any)=> p.label))));
                const items = [{ key:'全部', label:'全部' }, ...platformLabels.map((l:string)=> ({ key:l, label:l }))];
                return (
                  <>
                    <Divider style={{ margin: '12px 0', borderColor: NAV_DIVIDER_COLOR }} />
                    <Menu
                      mode="inline"
                      selectedKeys={[activeTab]}
                      onClick={({ key }) => setActiveTab(String(key))}
                      style={{ borderRight: '0' }}
                      items={items}
                    />
                  </>
                );
              })()}
            </div>
            <div style={{ flex:1, padding:'20px 24px', overflow:'auto', background:'#fafcff' }}>
              {(() => {
                const kw = navKeyword.toLowerCase();
                if (navSection === 'resources') {
                  let list = (recents || []).map(k => getItemMeta(k)).filter((m:any)=> m && String(m.label||'').toLowerCase().includes(kw));
                  if (activeTab !== '全部') list = list.filter((m:any)=> m.platformLabel === activeTab);
                  if (list.length === 0) return <Typography.Text type="secondary">暂无最近访问</Typography.Text>;
                  return (
                    <>
                      <Typography.Text style={{ fontSize:16, display:'block', marginBottom:12 }}>最近访问</Typography.Text>
                      <Space size={8} wrap>
                        {list.map((item:any)=> (
                          <Tag key={item.key} onClick={()=> { pushRecent(item); if (item.key === '/admin/clouds/console') { window.open(item.key, '_blank'); } else { navigate(item.key); setActiveSidebarKey(sidebarForPath(item.key)); } setNavOpen(false); }} style={{ cursor:'pointer', padding:'2px 8px', borderRadius:16 }}>
                            <Space size={6}>
                              <span style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', width:20, height:20, borderRadius:6, background:'#f0f5ff' }}>{item.icon}</span>
                              <span style={{ fontSize:13 }}>{item.label}</span>
                            </Space>
                          </Tag>
                        ))}
                      </Space>
                    </>
                  );
                }
                if (navSection === 'favorites') {
                  let list = (favorites || []).map(k => getItemMeta(k)).filter((m:any)=> m && String(m.label||'').toLowerCase().includes(kw));
                  if (activeTab !== '全部') list = list.filter((m:any)=> m.platformLabel === activeTab);
                  if (list.length === 0) {
                    return (
                      <div style={{ padding:'40px 24px' }}>
                        <Typography.Text style={{ fontSize:16, display:'block', marginBottom:12 }}>我的收藏({(favorites||[]).length} / 50)</Typography.Text>
                        <div style={{ background:'#fafafa', border:'1px solid #f5f5f5', borderRadius:8, padding:'40px 0', textAlign:'center' }}>
                          <InboxOutlined style={{ fontSize:36, color:'#bfbfbf', marginBottom:8 }} />
                          <div style={{ color:'#8c8c8c' }}>收藏列表为空 您可以点击产品名称旁边的星号，将常用云产品添加到收藏</div>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <>
                      <Typography.Text style={{ fontSize:16, display:'block', marginBottom:12 }}>我的收藏({(favorites||[]).length} / 50)</Typography.Text>
                      <Space size={8} wrap>
                        {list.map((item:any)=> (
                          <Tag key={item.key} onClick={()=> { pushRecent(item); navigate(item.key); setActiveSidebarKey(sidebarForPath(item.key)); setNavOpen(false); }} style={{ cursor:'pointer', padding:'2px 8px', borderRadius:16 }}>
                            <Space size={6}>
                              <span style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', width:20, height:20, borderRadius:6, background:'#f0f5ff' }}>{item.icon}</span>
                              <span style={{ fontSize:13 }}>{item.label}</span>
                            </Space>
                          </Tag>
                        ))}
                      </Space>
                    </>
                  );
                }
                const platformMap = new Map<string, any>();
                (visibleCenters || []).forEach((c:any)=> {
                  (c.items || []).forEach((p:any)=> {
                    const existed = platformMap.get(p.label);
                    if (!existed) platformMap.set(p.label, { key: p.key, label: p.label, icon: p.icon, children: [] });
                    const tgt = platformMap.get(p.label);
                    (p.children || []).forEach((it:any)=> tgt.children.push(it));
                  });
                });
                let platforms = Array.from(platformMap.values()).map((p:any)=> ({
                  key: p.key,
                  label: p.label,
                  icon: p.icon,
                  children: (p.children || []).filter((it:any)=> String(it.label || '').toLowerCase().includes(kw))
                })).filter((p:any)=> (p.children || []).length > 0);
                if (platforms.length === 0) return <Typography.Text type="secondary">无匹配的功能项</Typography.Text>;
                const displayPlatforms = activeTab === '全部' ? platforms : platforms.filter((p:any)=> p.label === activeTab);
                return (
                  <>
                    {displayPlatforms.map((p:any) => (
                      <div key={p.key} style={{ marginBottom:16, border:'1px solid #f0f0f0', borderRadius:10, overflow:'hidden', background:'#fff', boxShadow:'0 2px 8px rgba(0,0,0,0.04)' }}>
                        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 14px', background:'#f7f9fc', borderBottom:'1px solid #f0f0f0' }}>
                          <Space size={8}>
                            <span style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', width:24, height:24, borderRadius:6, background:'#edf3ff' }}>{p.icon}</span>
                            <Typography.Text style={{ fontSize:14, color:'#1f2a44' }}>{p.label}</Typography.Text>
                          </Space>
                          <RightOutlined style={{ color:'#bfbfbf' }} />
                        </div>
                        <div style={{ padding:'12px 14px' }}>
                          <Space size={8} wrap>
                            {(p.children || []).map((item:any)=> {
                              const fav = favorites.includes(item.key);
                              return (
                                <Tag key={item.key} onClick={()=> { pushRecent(item); if (item.key === '/admin/clouds/console') { window.open(item.key, '_blank'); } else { navigate(item.key); setActiveSidebarKey(sidebarForPath(item.key)); } setNavOpen(false); }} style={{ cursor:'pointer', padding:'2px 10px', borderRadius:16, background:'#f7faff', border:'1px solid #e9edf3' }}>
                                  <Space size={6}>
                                    <span style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', width:20, height:20, borderRadius:6, background:'#edf3ff' }}>{item.icon}</span>
                                    <span style={{ fontSize:13, color:'#1f2a44' }}>{item.label}</span>
                                    <span onClick={(e)=> { e.stopPropagation(); toggleFavorite(item); }} style={{ display:'inline-flex', alignItems:'center', marginLeft:6 }}>
                                      {fav ? <StarFilled style={{ color:'#faad14' }} /> : <StarOutlined style={{ color:'#bfbfbf' }} />}
                                    </span>
                                  </Space>
                                </Tag>
                              );
                            })}
                          </Space>
                        </div>
                      </div>
                    ))}
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      </>
      <Layout>
        {!(location.pathname.includes('/admin/clouds/ecs') || location.pathname.includes('/admin/clouds/console')) && (
          <Sider collapsible collapsed={collapsed} trigger={null} style={{background:'#F9F9FA', borderRight:'1px solid ' + NAV_DIVIDER_COLOR, position:'sticky', top: isProConsole ? 50 : 64, height:`calc(100vh - ${isProConsole ? 50 : 64}px)`, transition:'all 200ms ease'}}>
            {(() => {
              const center = (visibleCenters.find(c => c.key === activeSidebarKey) || (visibleCenters || [])[0]);
              return (
                <>
                  <div style={{ display:'flex', alignItems:'center', justifyContent: collapsed ? 'center' : 'space-between', padding: collapsed ? '12px' : '12px', borderBottom:'1px solid ' + NAV_DIVIDER_COLOR }}>
                    {!collapsed && (
                      <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                        <Typography.Text>{center.label}</Typography.Text>
                        <span style={{ display:'inline-flex', alignItems:'center', color:'#8c8c8c', fontSize:14 }}>{center.icon}</span>
                      </div>
                    )}
                    <Button type="text" icon={collapsed? <MenuUnfoldOutlined style={{color:'#1062fe',fontSize:16}} />:<MenuFoldOutlined style={{color:'#1062fe',fontSize:16}} />} onClick={()=>{ setOpenKeys([]); setCollapsed(!collapsed); setMenuKey(k=>k+1); }} style={{height:28,width:28,display:'flex',alignItems:'center',justifyContent:'center'}} />
                  </div>
                  <Menu key={menuKey} mode="inline" theme="light" style={{height:'calc(100% - 56px)', borderRight: '0', overflow: collapsed ? 'visible' : 'auto'}}
                    items={(center?.items || [])}
                    selectedKeys={[location.pathname + location.search]}
                    openKeys={collapsed ? undefined : openKeys}
                    inlineCollapsed={collapsed}
                    onClick={({ key }) => {
                      if (typeof key === 'string' && key.startsWith('/')) {
                        if (key === '/admin/clouds/console') { window.open(key, '_blank'); return; }
                        navigate(key);
                      }
                    }}
                    onOpenChange={(keys)=> { if (!collapsed) setOpenKeys(keys as string[]); }}
                  />
                </>
              );
            })()}
          </Sider>
        )}
        <Content style={{background: location.pathname.includes('/webssh') ? '#1e1e1e' : '#fff', height:`calc(100vh - ${isProConsole ? 50 : 64}px)`, overflow:'auto'}}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
};

export default AdminLayout;
