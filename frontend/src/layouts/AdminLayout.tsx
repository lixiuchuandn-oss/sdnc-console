import React, { useState, useEffect } from 'react';
import { Layout, Menu, Button, Input, Divider, Typography, Row, Col, Card, Space, Tag, AutoComplete, Badge, App, Select, Dropdown } from 'antd';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  SlidersOutlined,ProjectOutlined,CodeOutlined,CloudOutlined, UserOutlined, SettingOutlined, MenuUnfoldOutlined, MenuFoldOutlined, RightOutlined, CaretDownOutlined,
  ClusterOutlined, TeamOutlined, CodepenOutlined, DesktopOutlined, HddOutlined, GatewayOutlined,
  AppstoreAddOutlined, ApiOutlined, DatabaseOutlined, BellOutlined, RobotOutlined, EditOutlined, PlayCircleOutlined,
  BulbOutlined, CloudUploadOutlined, CloudServerOutlined, GlobalOutlined, UserSwitchOutlined, DeploymentUnitOutlined, LockOutlined, EnvironmentOutlined, BranchesOutlined, AppstoreOutlined, StarOutlined, StarFilled, InboxOutlined, LogoutOutlined, DashboardOutlined, CodeFilled, DatabaseFilled, SearchOutlined, PoweroffOutlined, ReloadOutlined
} from '@ant-design/icons';
import { useAuth } from '../contexts/AuthContext';
import { getRequiredActionForPath, hasPermissionForAction } from '../utils/accessMapping';
import { ROUTE_CATALOG, RouteItem } from '../catalogs/navCatalog';
import { routeSpecs } from '../routes/RouteSpec';
import { fetchClouds, fetchInventoryInstancesByCloud, refreshInventoryInstances, fetchAllInstances, startCloudProviderEcs, stopCloudProviderEcs, rebootCloudProviderEcs, fetchAliyunEcsVncUrl } from '../services/api';

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
  const [resourceClouds, setResourceClouds] = useState<any[]>([]);
  const [resourceLoading, setResourceLoading] = useState<boolean>(false);
  const [resInstanceStats, setResInstanceStats] = useState<Record<string, { running: number; stopped: number; total: number }>>({});
  const [resMatrixCols, setResMatrixCols] = useState<Record<string, number>>({});
  

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
 
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [searchActiveIndex, setSearchActiveIndex] = useState(0);
  const { message } = App.useApp();
  const [navEcs, setNavEcs] = useState<any[]>([]);
  const [navEcsLoading, setNavEcsLoading] = useState<boolean>(false);
  const [navStatusMode, setNavStatusMode] = useState<'all'|'prefer_running'|'only_running'|'only_non_running'>('prefer_running');

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
            if (next) setNavSection('resources');
            return next;
          });
        }} style={{height:40,width:40,display:'flex',alignItems:'center',justifyContent:'center'}} />
        <Space size={8} style={{ height:'100%', alignItems:'center' }}>
          <span style={{ fontSize:18, color:'#fff' }}><span style={{ fontWeight:700 }}>Compute</span>.Tower</span>
        </Space>
         <Dropdown
             menu={{
               items: visibleCenters.map((c: any) => ({
                 key: c.key,
                 label: (
                  <Space>
                    {c.icon}
                    <span style={{ fontWeight: 500 }}>{c.label}</span>
                  </Space>
                ),
                onClick: () => {
                  const firstGroup = (c.items || [])[0];
                  const firstPage = (firstGroup?.children || [])[0];
                  if (firstPage?.key) {
                    navigate(firstPage.key);
                  }
                },
              })),
              selectable: true,
              selectedKeys: [visibleCenters.find(c => c.key === activeSidebarKey)?.key || ''],
            }}
            trigger={['click']}
          >
           <div
              style={{
                marginLeft: 16,
                padding: '4px 12px',
                background: 'transparent',
                borderRadius: 0,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                border: 'none',
                borderBottom: '1px solid rgba(255,255,255,0.6)',
                transition: 'all 0.3s ease',
                height: 32,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderBottomColor = 'rgba(255,255,255,0.9)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderBottomColor = 'rgba(255,255,255,0.6)';
              }}
            >
              <span style={{ color: '#fff', fontSize: 16, display: 'flex', alignItems: 'center' }}>
                {visibleCenters.find(c => c.key === activeSidebarKey)?.icon || <AppstoreOutlined />}
              </span>
              <span style={{ color: '#fff', fontWeight: 600, fontSize: 14 }}>
                {visibleCenters.find(c => c.key === activeSidebarKey)?.label || '选择控制台'}
              </span>
              <CaretDownOutlined style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12 }} />
            </div>
          </Dropdown>
      </div>
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', padding:'0 20px' }}>
        <div
          role="button"
          tabIndex={0}
          onClick={()=> setSearchOpen(true)}
          onKeyDown={(e)=> { if (e.key === 'Enter' || e.key === ' ') setSearchOpen(true); }}
          style={{
            width: 520,
            height: 36,
            borderRadius: 10,
            border: '1px solid rgba(255,255,255,0.6)',
            background: '#1062fe',
            display:'flex',
            alignItems:'center',
            justifyContent:'space-between',
            padding:'0 10px',
            color:'#fff',
            boxShadow:'inset 0 0 0 1px rgba(255,255,255,0.25)'
          }}
        >
          <Space size={8} style={{ color:'#fff' }}>
            <SearchOutlined />
            <span>Search</span>
          </Space>
          <span style={{ border:'1px solid rgba(255,255,255,0.8)', color:'#fff', borderRadius:6, padding:'2px 8px', fontSize:12, lineHeight:'16px' }}>Ctrl+K</span>
        </div>
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

  const pageSearchOptions = React.useMemo(() => {
    const opts: any[] = [];
    (visibleCenters || []).forEach((c:any) => {
      (c.items || []).forEach((p:any) => {
        (p.children || []).forEach((it:any) => {
          const title = `${String(it.label || '')} ${String(p.label || '')} ${String(c.label || '')}`;
          opts.push({
            value: String(it.key || ''),
            title,
            label: (
              <Space size={8}>
                <span style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', width:20, height:20, borderRadius:6, background:'#f0f5ff' }}>{it.icon}</span>
                <span style={{ fontSize:13 }}>{it.label}</span>
                <Typography.Text type="secondary" style={{ marginLeft:8 }}>{p.label}</Typography.Text>
              </Space>
            ),
          });
        });
      });
    });
    return opts;
  }, [visibleCenters]);

  const filteredSearchList = React.useMemo(() => {
    const kw = String(searchText || '').toLowerCase();
    const base = pageSearchOptions.map((o:any)=> ({ path: o.value, title: o.title, icon: o.label?.props?.children?.[0], label: o.label?.props?.children?.[1]?.props?.children, group: o.label?.props?.children?.[2]?.props?.children }));
    const list = kw ? base.filter((it:any)=> String(it.title||'').toLowerCase().includes(kw)) : base.slice(0, 12);
    return list;
  }, [pageSearchOptions, searchText]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
        setSearchText('');
        setSearchActiveIndex(0);
      }
      if (searchOpen) {
        if (e.key === 'Escape') {
          setSearchOpen(false);
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSearchActiveIndex(i => Math.min(i + 1, Math.max(filteredSearchList.length - 1, 0)));
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSearchActiveIndex(i => Math.max(i - 1, 0));
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          const sel = filteredSearchList[searchActiveIndex];
          if (sel) {
            const path = sel.path;
            if (path === '/admin/clouds/console') {
              window.open(path, '_blank');
            } else {
              navigate(path);
              setActiveSidebarKey(sidebarForPath(path));
            }
            setSearchOpen(false);
          }
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [searchOpen, filteredSearchList]);

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

  useEffect(() => {
    if (navOpen) {
      setResourceLoading(true);
      setNavEcsLoading(true);
      fetchClouds().then((list:any[]) => {
        const arr = Array.isArray(list) ? list : [];
        setResourceClouds(arr);
      }).catch(() => {}).finally(() => setResourceLoading(false));
      fetchAllInstances().then((json:any) => {
        const list = Array.isArray(json?.data) ? json.data : [];
        setNavEcs(list);
      }).catch(()=> setNavEcs([])).finally(()=> setNavEcsLoading(false));
    }
  }, [navOpen, navSection]);

  const providerLabel = (p:string): string => {
    const s = String(p || '').toLowerCase();
    return (s === 'aliyun' && '阿里云') || (s === 'huaweicloud' && '华为云') || (s === 'harvester' && 'Harvester') || (s === 'cloudmap' && 'Cloudmap') || (p || '-');
  };
  const statusBadge = (raw:any) => {
    const v = String(raw || '').toLowerCase();
    if (['running','healthy','ok','active','on'].includes(v)) return <Badge status="success" text="运行中" />;
    if (['warning','degraded','maintenance'].includes(v)) return <Badge status="warning" text="维护/告警" />;
    if (['error','failed','unhealthy','offline','stopped','stop','inactive','terminated','off'].includes(v)) return <Badge status="error" text="异常/停止" />;
    return <Badge status="default" text="未知" />;
  };
  const isRunningRec = (r:any): boolean => {
    const s = String(r?.status || r?.Status || r?.State || r?.state || r?.power_state || r?.PowerState || r?.InstanceState?.Name || r?.statusName || '').toLowerCase();
    return s.includes('running') || s === 'active' || s === 'on';
  };
  const isStoppedRec = (r:any): boolean => {
    const s = String(r?.status || r?.Status || r?.State || r?.state || r?.power_state || r?.PowerState || r?.InstanceState?.Name || r?.statusName || '').toLowerCase();
    return s.includes('stopped') || s.includes('stop') || s.includes('shut') || s.includes('terminated') || s.includes('off') || s === 'inactive';
  };
  const isBusyRec = (r:any): boolean => {
    const s = String(r?.status || r?.Status || r?.State || r?.state || r?.statusName || '').toLowerCase();
    return s.includes('sched') || s.includes('pending') || s.includes('reboot') || s.includes('provision') || s.includes('creat') || s.includes('delet');
  };
  const parseMem = (v:any): number => {
    const s = String(v || '').trim().toLowerCase();
    if (!s) return 0;
    if (/^\d+$/.test(s)) return Number(s);
    const m = s.match(/^(\d+(?:\.\d+)?)(?:\s*)(gib?|gi|gb?|g|mib?|mi|mb?|m|kib?|ki|kb?|k|tib?|ti|tb?|t|b)$/);
    if (!m) return 0;
    const val = Number(m[1]);
    const unit = m[2];
    if (unit === 'gib' || unit === 'gi' || unit === 'gb' || unit === 'g') return val * 1024;
    if (unit === 'mib' || unit === 'mi' || unit === 'mb' || unit === 'm') return val;
    if (unit === 'kib' || unit === 'ki' || unit === 'kb' || unit === 'k') return val / 1024;
    if (unit === 'tib' || unit === 'ti' || unit === 'tb' || unit === 't') return val * 1024 * 1024;
    if (unit === 'b') return val / (1024 * 1024);
    return 0;
  };
  const specTextOf = (r:any): string => {
    const cpu = r?.cpu ?? r?.Extra?.CPU;
    const providerKey = String(r?.provider || '').toLowerCase();
    let memGi: number | undefined;
    if (providerKey === 'harvester' || providerKey === 'cloudmap') {
      const memMi = parseMem(r?.extra?.memory ?? r?.Extra?.Memory ?? r?.Memory ?? r?.memory);
      memGi = memMi && memMi > 0 ? Math.round(memMi / 1024) : undefined;
      if (memGi == null) {
        const memGbRaw = r?.memoryGb ?? r?.memoryGB ?? r?.memory;
        const gb = parseFloat(String(memGbRaw));
        if (Number.isFinite(gb)) {
          memGi = gb > 1024 && gb < 65536 ? Math.round((gb * 2) / 1024) : Math.round(gb);
        }
      }
    } else {
      const memGbRaw = r?.memoryGb ?? r?.memoryGB ?? r?.memory;
      const val = parseFloat(String(memGbRaw));
      memGi = Number.isFinite(val) ? Math.round(val) : undefined;
    }
    const base = (typeof cpu === 'number' || typeof memGi === 'number')
      ? `CPU ${cpu ?? '-'}核 / 内存 ${typeof memGi === 'number' ? memGi : '-'}G`
      : '-';
    return base;
  };
  const openVnc = async (r:any) => {
    const provider = String(r?.provider || '').toLowerCase();
    const cloudId = String(r?.cloudId || '');
    const iid = String(r?.id || r?.InstanceId || '');
    if (!cloudId || !iid) return;
    const isAliyun = provider.includes('aliyun');
    const isHuawei = provider.includes('huawei');
    if (isAliyun || isHuawei) {
      try {
        const json = await fetchAliyunEcsVncUrl(cloudId, iid);
        const url = json?.data?.VncUrl || json?.data?.vncUrl;
        if (url) {
          const w = Math.max(1280, (window.screen?.availWidth || 1600) - 40);
          const h = Math.max(800, (window.screen?.availHeight || 900) - 80);
          const features = `width=${w},height=${h},top=0,left=0,menubar=no,toolbar=no,location=no,status=no,scrollbars=yes,resizable=yes`;
          if (isAliyun) {
            const osRaw = String(r?.os || r?.image || '').toLowerCase();
            const isWindows = osRaw.includes('win');
            const page = 'https://g.alicdn.com/aliyun/ecs-console-vnc2/0.0.8/index.html';
            const web = `${page}?vncUrl=${encodeURIComponent(url)}&instanceId=${encodeURIComponent(iid)}&isWindows=${isWindows ? 'true' : 'false'}`;
            window.open(web, 'webvnc', features);
          } else {
            window.open(url, 'webvnc', features);
          }
        } else {
          message.warning('未获取到VNC地址');
        }
      } catch (e:any) {
        message.error(e?.message || '获取VNC地址失败');
      }
      return;
    }
    const isHarvester = provider.includes('harvester') || provider.includes('cloudmap');
    if (isHarvester) {
      const s = String(iid || '');
      const ns = s.includes('/') ? s.split('/')[0] : '';
      const nm = s.includes('/') ? s.split('/')[1] : s;
      const w = Math.max(1280, (window.screen?.availWidth || 1600) - 40);
      const h = Math.max(800, (window.screen?.availHeight || 900) - 80);
      const features = `width=${w},height=${h},top=0,left=0,menubar=no,toolbar=no,location=no,status=no,scrollbars=yes,resizable=yes`;
      const url = `/admin/clouds/${encodeURIComponent(cloudId)}/harvester/vnc?cloudId=${encodeURIComponent(cloudId)}&namespace=${encodeURIComponent(ns)}&name=${encodeURIComponent(nm)}`;
      window.open(url, 'harvester-vnc', features);
      return;
    }
    message.warning('WebVNC 已移除');
  };
  const lifecycleOp = async (r:any, op:'start'|'stop'|'reboot') => {
    try {
      const cloudId = String(r?.cloudId || '');
      const iid = String(r?.id || r?.InstanceId || '');
      const providerKey = String(r?.provider || '').toLowerCase();
      if (!cloudId || !iid) return;
      if (op === 'start') {
        if (providerKey.includes('aliyun') || providerKey.includes('huawei') || providerKey.includes('tencent') || providerKey.includes('harvester') || providerKey.includes('cloudmap')) {
          await startCloudProviderEcs(cloudId, iid);
        }
        message.success('启动指令已下发');
      } else if (op === 'stop') {
        if (providerKey.includes('aliyun') || providerKey.includes('huawei') || providerKey.includes('tencent') || providerKey.includes('harvester') || providerKey.includes('cloudmap')) {
          await stopCloudProviderEcs(cloudId, iid, true);
        }
        message.success('停止指令已下发');
      } else if (op === 'reboot') {
        if (providerKey.includes('aliyun') || providerKey.includes('huawei') || providerKey.includes('tencent') || providerKey.includes('harvester') || providerKey.includes('cloudmap')) {
          await rebootCloudProviderEcs(cloudId, iid, true);
        }
        message.success('重启指令已下发');
      }
    } catch(e:any) {
      message.error(e?.message || '操作失败');
    }
  };

  return (
    <Layout style={{ height:'100vh', overflow:'hidden' }}>
      {isProConsole ? <ProHeader /> : <StandardHeader />}
      <>
        {searchOpen && (
          <div
            onClick={()=> setSearchOpen(false)}
            style={{
              position:'fixed',
              inset:0,
              background:'rgba(0,0,0,0.25)',
              zIndex:3000
            }}
          >
            <div
              onClick={(e)=> e.stopPropagation()}
              style={{
                position:'absolute',
                top:'10%',
                left:'50%',
                transform:'translateX(-50%)',
                width:720,
                background:'#fff',
                borderRadius:12,
                boxShadow:'0 20px 40px rgba(0,0,0,0.2)',
                overflow:'hidden'
              }}
            >
              <div style={{ padding:16, borderBottom:'1px solid #f0f0f0' }}>
                <Input
                  autoFocus
                  value={searchText}
                  onChange={(e)=> { setSearchText(e.target.value); setSearchActiveIndex(0); }}
                  placeholder="搜索页面…  Ctrl+K 打开 / Esc 关闭"
                  size="large"
                />
              </div>
              <div style={{ maxHeight:360, overflow:'auto' }}>
                {filteredSearchList.length === 0 ? (
                  <div style={{ padding:16 }}>
                    <Typography.Text type="secondary">无匹配结果</Typography.Text>
                  </div>
                ) : (
                  filteredSearchList.map((it:any, idx:number) => (
                    <div
                      key={it.path}
                      onMouseEnter={()=> setSearchActiveIndex(idx)}
                      onClick={()=> {
                        const path = it.path;
                        if (path === '/admin/clouds/console') {
                          window.open(path, '_blank');
                        } else {
                          navigate(path);
                          setActiveSidebarKey(sidebarForPath(path));
                        }
                        setSearchOpen(false);
                      }}
                      style={{
                        padding:'12px 16px',
                        display:'flex',
                        alignItems:'center',
                        justifyContent:'space-between',
                        cursor:'pointer',
                        background: idx === searchActiveIndex ? '#f0f7ff' : '#fff',
                        borderBottom:'1px solid #f5f5f5'
                      }}
                    >
                      <Space size={10}>
                        <span style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', width:24, height:24, borderRadius:6, background:'#f0f5ff' }}>{it.icon}</span>
                        <span style={{ fontSize:14 }}>{it.label}</span>
                      </Space>
                      <Typography.Text type="secondary">{it.group}</Typography.Text>
                    </div>
                  ))
                )}
              </div>
              <div style={{ padding:'10px 16px', background:'#fafafa', borderTop:'1px solid #f0f0f0', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <Typography.Text type="secondary">Enter 打开 · ESC 关闭 · SCROLL 查看更多</Typography.Text>
                <Button type="text" onClick={()=> setSearchOpen(false)}>关闭</Button>
              </div>
            </div>
          </div>
        )}
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
            width:720,
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
          <div style={{ padding:'12px 20px' }}>
            <div>
              <Typography.Text style={{ fontSize:16, color:'#1f2a44' }}>云主机快速预览</Typography.Text>
            </div>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginTop:8 }}>
              <Space size={12}>
                <Input.Search allowClear placeholder="按名称过滤" style={{ width: 300 }} onSearch={(v)=> setNavKeyword(v)} onChange={(e)=> setNavKeyword(e.target.value)} />
                <Select
                  size="middle"
                  value={navStatusMode}
                  onChange={(v)=> setNavStatusMode(v)}
                  style={{ width: 110 }}
                  popupMatchSelectWidth={false}
                  getPopupContainer={(trigger)=> trigger?.parentElement as HTMLElement}
                >
                  <Select.Option value="prefer_running">运行优先</Select.Option>
                  <Select.Option value="only_running">仅运行中</Select.Option>
                  <Select.Option value="only_non_running">仅非运行</Select.Option>
                </Select>
                <Button type="primary" onClick={()=> window.open('/admin/clouds/console','_blank')}>资源控制台pro</Button>
              </Space>
              <Space size={12}>
                <Button type="default" style={{ borderColor: NAV_DIVIDER_COLOR }} onClick={()=> setNavOpen(false)}>收起</Button>
              </Space>
            </div>
          </div>
          <Divider style={{ margin: 0, borderColor: NAV_DIVIDER_COLOR }} />
          <div style={{ display:'flex', flex:1, minHeight:0 }}>
            <div style={{ flex:1, padding:'20px 24px', overflow:'auto', backgroundColor:'#fbfdff', backgroundImage:'radial-gradient(#eaeffb 1px, transparent 1px)', backgroundSize:'12px 12px' }}>
              {(() => {
                const kw = navKeyword.toLowerCase();
                const clouds = Array.isArray(resourceClouds) ? resourceClouds : [];
                const cloudMap: Record<string, any> = {};
                clouds.forEach(c => { cloudMap[String(c.id)] = c; });
                let list = (Array.isArray(navEcs) ? navEcs : []).filter((r:any)=> String(r?.name || r?.InstanceName || '').toLowerCase().includes(kw));
                if (navStatusMode === 'only_running') list = list.filter((r:any)=> isRunningRec(r));
                else if (navStatusMode === 'only_non_running') list = list.filter((r:any)=> !isRunningRec(r));
                else if (navStatusMode === 'prefer_running') list = list.slice().sort((a:any,b:any)=> (isRunningRec(b)?1:0) - (isRunningRec(a)?1:0));
                if (navEcsLoading) {
                  return <Typography.Text type="secondary">加载中…</Typography.Text>;
                }
                if (list.length === 0) {
                  return <Typography.Text type="secondary">暂无云主机</Typography.Text>;
                }
                return (
                  <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                    {list.map((r:any) => {
                      const name = r?.name || r?.InstanceName || '-';
                      const provider = String(r?.provider || '').toLowerCase();
                      const cloudId = String(r?.cloudId || '');
                      const cloudName = cloudMap[cloudId]?.name || '-';
                      const vendor = providerLabel(provider);
                      const spec = specTextOf(r);
                      const pri = Array.isArray(r?.privateIps) && r.privateIps.length > 0 ? r.privateIps[0] : (Array.isArray(r?.VpcAttributes?.PrivateIpAddress?.IpAddress) ? r?.VpcAttributes?.PrivateIpAddress?.IpAddress[0] : undefined);
                      const ipText = pri ? String(pri) : 'IP待配置';
                      return (
                        <Card key={String(r?.id || r?.InstanceId || name)} size="small" variant="outlined" hoverable style={{ borderRadius:12, border:'1px solid #e9edf3', boxShadow:'0 2px 10px rgba(16,98,254,0.06)', background:'#fff' }}>
                          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                            <Space size={8}>
                              {statusBadge(r?.status || r?.Status)}
                              <Typography.Text style={{ fontSize:14 }}>{name}</Typography.Text>
                            </Space>
                            <Button type="link" size="small" onClick={()=> { if (!cloudId || !(r?.id || r?.InstanceId)) return; navigate(`/admin/clouds/${cloudId}/instances/${encodeURIComponent(String(r?.id || r?.InstanceId))}`); }} style={{ padding:0 }}>详情</Button>
                          </div>
                          <div style={{ marginTop:6, color:'#8c8c8c' }}>
                            <Space size={8} wrap>
                              <span>{vendor}</span>
                              <span>·</span>
                              <span>{cloudName}</span>
                              <span>·</span>
                              <span>{spec}</span>
                              <span>·</span>
                              <span>{ipText}</span>
                            </Space>
                          </div>
                          <div style={{ marginTop:8 }}>
                            <Space size={8} wrap>
                              <Button shape="round" size="small" style={{ fontSize: 12, height: 24, paddingInline: 8 }} disabled={isRunningRec(r) || isBusyRec(r)} icon={<PlayCircleOutlined style={{ fontSize: 12, color: 'var(--primary-hex)' }} />} onClick={()=> lifecycleOp(r, 'start')}>启动</Button>
                              <Button shape="round" size="small" style={{ fontSize: 12, height: 24, paddingInline: 8 }} disabled={isStoppedRec(r) || isBusyRec(r)} icon={<PoweroffOutlined style={{ fontSize: 12, color: '#f5222d' }} />} onClick={()=> lifecycleOp(r, 'stop')}>停止</Button>
                              <Button shape="round" size="small" style={{ fontSize: 12, height: 24, paddingInline: 8 }} disabled={!isRunningRec(r) || isBusyRec(r)} icon={<ReloadOutlined style={{ fontSize: 12, color: 'var(--primary-hex)' }} />} onClick={()=> lifecycleOp(r, 'reboot')}>重启</Button>
                              <Button shape="round" size="small" style={{ fontSize: 12, height: 24, paddingInline: 8 }} icon={<DesktopOutlined style={{ fontSize: 12, color: 'var(--primary-hex)' }} />} onClick={()=> openVnc(r)}>VNC</Button>
                            </Space>
                          </div>
                        </Card>
                      );
                    })}
                  </div>
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
