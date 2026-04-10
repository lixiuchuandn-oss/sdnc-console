/**
 * 管理后台主布局：顶栏、侧栏（多平台菜单）、内容区 Outlet、资源池抽屉、全局搜索等。
 * 检索关键词: AdminLayout layout admin sidebar visibleCenters canAccessPath Ctrl+K
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  App,
  Button,
  Dropdown,
  Empty,
  Form,
  Input,
  Layout,
  Modal,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  AliyunOutlined,
  AmazonOutlined,
  AppstoreOutlined,
  CaretDownOutlined,
  CheckCircleFilled,
  CloudServerOutlined,
  CodeOutlined,
  DatabaseFilled,
  DatabaseOutlined,
  DeploymentUnitOutlined,
  GoogleOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  SettingOutlined,
  StopFilled,
  UserOutlined,
} from '@ant-design/icons';
import { useAuth } from '../contexts/AuthContext';
import { useLicense } from '../contexts/LicenseContext';
import { useSettings } from '../contexts/SettingsContext';
import { getRequiredActionForPath, hasPermissionForAction } from '../utils/accessMapping';
import { PLATFORMS, PLATFORM_LABELS, GROUPS } from '../constants/navigation';
import { routeSpecs } from '../routes/RouteSpec';
import { iconOf } from '../components/PageContainer';
import { fetchClouds, apiPost } from '../services/api';
import { getPublicAdminPasswordPolicy } from '../services/systemApi';
import { validateAdminPasswordClient, type AdminPasswordPolicy } from '../utils/adminPasswordPolicy';
import { renderMarkdownBold } from '../utils/markdown';
import '../pages/Dashboard/Dashboard.css';
import AdminSidebar, { type AdminSidebarCenter } from './AdminSidebar';

const { Header, Content } = Layout;

/** 顶栏高度（与 sticky、抽屉 top、侧栏 top 对齐） */
const ADMIN_HEADER_HEIGHT_PX = 64;

/** 左侧资源池抽屉宽度 */
const RESOURCE_DRAWER_WIDTH_PX = 400;

/** 资源池卡片矩阵格数（与概览页一致） */
const RESOURCE_MATRIX_SLOT_COUNT = 100;
const RESOURCE_MATRIX_SLOTS = [...Array(RESOURCE_MATRIX_SLOT_COUNT)];

/** 顶栏底边、侧栏右边线等与导航分割相关的颜色 */
const NAV_DIVIDER_COLOR = 'rgb(200, 207, 218)';

type PageSearchEntry = {
  path: string;
  title: string;
  icon: React.ReactNode;
  label: string;
  group: string;
};

function firstMenuPathInCenter(center: { items?: unknown[] }): string | null {
  const first = (center.items || [])[0] as { key?: string; children?: { key?: string }[] } | undefined;
  const page = first?.children?.length ? first.children[0] : first;
  const key = page && 'key' in page ? page.key : undefined;
  return typeof key === 'string' && key.startsWith('/') ? key : null;
}

/** 导航抽屉内资源池卡片 — 云厂商图标 */
const CloudDrawerProviderIcon: React.FC<{ provider?: string }> = ({ provider }) => {
  const p = provider || '';
  if (p === 'aliyun') return <AliyunOutlined />;
  if (p === 'aws') return <AmazonOutlined />;
  if (p === 'huaweicloud') {
    return (
      <span style={{ fontWeight: 900, fontSize: '14px', fontFamily: 'Arial' }}>HW</span>
    );
  }
  if (p === 'google') return <GoogleOutlined />;
  if (p === 'cloudmap.edge' || p === 'cloudmap.private') return <CloudServerOutlined />;
  if (p === 'cloudmap.csm') return <SafetyCertificateOutlined />;
  return <DeploymentUnitOutlined />;
};

/** 侧栏透明壳 + 折叠条右侧补线（trigger 为 fixed，需单独画右边线） */
function adminSidebarLayoutCss(dividerColor: string): string {
  return `
 .admin-sidebar {
            background: transparent !important;
          }
          .admin-sidebar .ant-layout-sider {
            background: transparent !important;
          }
          .admin-sidebar .ant-layout-sider-children {
            background: transparent !important;
          }
          .admin-sidebar.ant-layout-sider .ant-layout-sider-trigger {
            border-inline-end: 1px solid ${dividerColor} !important;
            box-sizing: border-box;
          }
        `;
}

/** 由当前路径解析应高亮的平台侧栏 key */
function sidebarForPath(p: string): string {
  const found = routeSpecs.find((r) => {
    if (r.path === p) return true;
    if (r.path.includes(':')) {
      const base = r.path.split(':')[0];
      return p.startsWith(base);
    }
    return false;
  });

  if (found?.platform) {
    if (found.platform === 'CNMC') return '/admin/cen_compute';
    if (found.platform === 'SDNCC') return '/admin/cen_sdn';
    if (found.platform === 'CNSOC') return '/admin/cen_secops';
    if (found.platform === 'SETTINGS') return '/admin/cen_settings';
  }

  const s = p.toLowerCase();
  if (s.includes('/interconnect') || s.includes('/sec-mgr-plane') || s.includes('/security/traffic')) {
    return '/admin/cen_sdn';
  }
  if (s.includes('/alarms') || s.includes('/soc') || s.includes('/aisoc')) {
    return '/admin/cen_secops';
  }
  if (s.includes('/settings')) {
    return '/admin/cen_settings';
  }
  return '/admin/cen_compute';
}

const AdminLayout: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout, refreshUser } = useAuth();
  const { hasFeature } = useLicense();
  const { settings, loading: settingsLoading } = useSettings();
  const { message } = App.useApp();
  const [changePasswordForm] = Form.useForm();

  const [collapsed, setCollapsed] = useState(true);
  const [activeSidebarKey, setActiveSidebarKey] = useState('/admin/cen_compute');
  const [openKeys, setOpenKeys] = useState<string[]>([]);
  const [navOpen, setNavOpen] = useState(false);
  const [resourceClouds, setResourceClouds] = useState<any[]>([]);
  const [resourceLoading, setResourceLoading] = useState(false);
  const [resourcePoolInstanceCounts, setResourcePoolInstanceCounts] = useState<
    Record<string, { total: number; running: number }>
  >({});
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [searchActiveIndex, setSearchActiveIndex] = useState(0);
  const searchActiveIndexRef = useRef(0);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [changePasswordSaving, setChangePasswordSaving] = useState(false);
  const [adminPwdPolicy, setAdminPwdPolicy] = useState<AdminPasswordPolicy | null>(null);

  const forcePasswordChange = user?.mustChangePassword === true && user?.role !== 'tenant';

  useEffect(() => {
    getPublicAdminPasswordPolicy().then(setAdminPwdPolicy);
  }, []);

  useEffect(() => {
    if (forcePasswordChange) {
      changePasswordForm.resetFields();
      setChangePasswordOpen(true);
    }
  }, [forcePasswordChange, user?.id, changePasswordForm]);

  const openChangePassword = () => {
    changePasswordForm.resetFields();
    setChangePasswordOpen(true);
  };

  const submitChangePassword = async () => {
    try {
      const values = await changePasswordForm.validateFields();
      setChangePasswordSaving(true);
      await apiPost('/api/users/me/password', {
        oldPassword: String(values.oldPassword || ''),
        newPassword: String(values.newPassword || ''),
      });
      await refreshUser();
      message.success('密码修改成功');
      setChangePasswordOpen(false);
    } catch (e: any) {
      if (Array.isArray(e?.errorFields) && e.errorFields.length > 0) return;
      message.error(e?.message || '修改密码失败');
    } finally {
      setChangePasswordSaving(false);
    }
  };

  /** super_admin 全放行；其余按路径 required action 与 permissions 校验 */
  const canAccessPath = useCallback((p: string): boolean => {
    const pure = String(p || '').split('?')[0];
    if (!user) return false;
    const role = String(user.role || '').toLowerCase();
    // 只有 super_admin 才跳过权限检查，admin 也需要检查权限（与后端保持一致）
    if (role === 'super_admin') return true;
    const act = getRequiredActionForPath(pure);
    const perms = Array.isArray(user.permissions) ? user.permissions : [];
    return hasPermissionForAction(perms, act);
  }, [user]);

  /**
   * 侧栏 / 搜索等入口的统一跳转：`/console`（租户资源控制台）始终新标签打开，其余路径当前页路由。
   */
  const navigateToAdminContent = useCallback(
    (path: string) => {
      const pure = String(path || '').split('?')[0];
      if (pure === '/console') {
        const w = window.open(`${window.location.origin}${path}`, '_blank');
        if (w == null) {
          message.warning('无法打开新窗口，请检查浏览器是否拦截了弹出窗口');
        }
        return;
      }
      navigate(path);
    },
    [navigate, message],
  );

  const handleLogout = () => {
    logout();
    navigate('/admin/login');
  };

  const groupIconOf = useCallback((pf: string, grp: string) => {
    const visible = routeSpecs
      .filter(s => s.layout === 'admin' && s.platform === pf && s.group === grp && !s.hidden)
      .sort((a:any, b:any) => Number(a.order ?? 9999) - Number(b.order ?? 9999));

    const all = routeSpecs
      .filter(s => s.layout === 'admin' && s.platform === pf && s.group === grp)
      .sort((a:any, b:any) => Number(a.order ?? 9999) - Number(b.order ?? 9999));

    const list = visible.length > 0 ? visible : all;
    const firstWithIcon = list.find((s) => !!s.icon) || list[0];
    return iconOf(firstWithIcon?.icon);
  }, []);

  const adminSpecs = useMemo(() => routeSpecs.filter((s) => s.layout === 'admin' && !s.hidden), []);
  
  const centers = useMemo(() => PLATFORMS.filter(p => p !== '全部').map((pf: any) => {
    const key = pf === 'CNMC' ? '/admin/cen_compute' : pf === 'SDNCC' ? '/admin/cen_sdn' : pf === 'CNSOC' ? '/admin/cen_secops' : '/admin/cen_settings';
    const platformSpecs = adminSpecs.filter(s => s.platform === pf);
    const topLevelSpecs = platformSpecs.filter(s => !s.group);
    const groupedSpecs = platformSpecs.filter(s => !!s.group);
    const topLevelItems = topLevelSpecs
      .sort((a:any, b:any) => Number(a.order ?? 0) - Number(b.order ?? 0))
      .map((s) => ({ key: s.path, label: s.title || s.breadcrumbLabel || s.id, icon: iconOf(s.icon), requiredFeature: s.requiredFeature }));
    const groupItems = Array.from(new Set(groupedSpecs.map(s => String(s.group || ''))))
      .sort((a, b) => {
        const idxA = GROUPS.indexOf(a as any);
        const idxB = GROUPS.indexOf(b as any);
        const safeA = idxA === -1 ? 999 : idxA;
        const safeB = idxB === -1 ? 999 : idxB;
        return safeA - safeB;
      })
      .map((grp) => ({
        key: `${pf}_${grp}`,
        label: grp,
        icon: groupIconOf(pf, grp as string),
        children: groupedSpecs
          .filter(s => s.group === grp)
          .sort((a:any, b:any) => Number(a.order ?? 0) - Number(b.order ?? 0))
          .map((s) => ({ key: s.path, label: s.title || s.breadcrumbLabel || s.id, icon: iconOf(s.icon), requiredFeature: s.requiredFeature })),
      }));
    return ({
      key,
      label: PLATFORM_LABELS[pf as keyof typeof PLATFORM_LABELS] || pf,
      icon: pf === 'SETTINGS' ? <SettingOutlined /> : <CodeOutlined />,
      // SETTINGS 平台也按 group 构建，确保系统管理侧边栏满足“分组块”展示需求
      items: [...topLevelItems, ...groupItems],
    });
  }), [adminSpecs, groupIconOf]);

  /** 去掉 requiredFeature，避免传入 DOM */
  const cleanMenuItem = useCallback((item: any): any => {
    const { requiredFeature, ...rest } = item;
    if (rest.children) {
      return {
        ...rest,
        children: rest.children.map(cleanMenuItem),
      };
    }
    return rest;
  }, []);

  const visibleCenters = useMemo(() => (centers || [])
    .filter((c: any) => {
      if (c.key === '/admin/cen_sdn' && !hasFeature('platform.sdn')) return false;
      if (c.key === '/admin/cen_secops' && !hasFeature('platform.aisoc')) return false;
      return true;
    })
    .map((c:any) => {
      return {
        ...c,
        items: (c.items || [])
          .map((p:any) => {
            if (!p.children) return p;
            return {
              ...p,
              children: (p.children || [])
                .filter((it:any) => 
                  canAccessPath(String(it.key || '')) &&
                  (!it.requiredFeature || hasFeature(it.requiredFeature))
                )
                .map(cleanMenuItem),
            };
          })
          .filter((p:any) => {
            if (p.children) return (p.children || []).length > 0;
            return (
              canAccessPath(String(p.key || '')) &&
              (!p.requiredFeature || hasFeature(p.requiredFeature))
            );
          })
          .map(cleanMenuItem),
      };
    })
    .filter((c:any) => (c.items || []).length > 0), [centers, hasFeature, canAccessPath, cleanMenuItem]);

  const activeCenter = useMemo(
    () => visibleCenters.find((c) => c.key === activeSidebarKey),
    [visibleCenters, activeSidebarKey],
  );

  const StandardHeader: React.FC = () => {
    const headerColor = settings.headerColor;
    const headerColorEnd = settings.headerColorEnd;
    const gradient =
      headerColor && headerColorEnd
        ? `linear-gradient(90deg, ${headerColor} 0%, ${headerColorEnd} 100%)`
        : 'transparent';
    
    return (
    <Header style={{ background: gradient, color:'#fff', display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 20px', position:'sticky', top:0, zIndex:1000, height: ADMIN_HEADER_HEIGHT_PX, boxShadow:'0 4px 16px rgba(0,0,0,0.08)', borderBottom:'1px solid ' + NAV_DIVIDER_COLOR }}>
      <div style={{ display:'flex', alignItems:'center', height: ADMIN_HEADER_HEIGHT_PX }}>
        <Button type="text" icon={(navOpen ? <DatabaseOutlined style={{color:'#fff',fontSize:20}} /> : <DatabaseFilled style={{color:'#fff',fontSize:20}} />)} onClick={() => setNavOpen((v) => !v)} style={{height:40,width:40,display:'flex',alignItems:'center',justifyContent:'center'}} />
        <Space size={8} style={{ height:'100%', alignItems:'center' }}>
          {settings.headerIcon && (
            <img 
              src={settings.headerIcon} 
              alt="Logo" 
              style={{ height: 28, width: 'auto', display: 'block' }} 
            />
          )}
          <span style={{ fontSize:18, color:'#fff', lineHeight: '18px', display: 'flex', alignItems: 'center' }}>
            {settingsLoading ? '' : renderMarkdownBold(settings.headerTitle ?? '')}
          </span>
        </Space>
         <Dropdown
            menu={{
              items: visibleCenters
                .map((c: any) => ({
                  key: c.key,
                  label: (
                    <Space>
                      {c.icon}
                      <span style={{ fontWeight: 500 }}>{c.label}</span>
                    </Space>
                  ),
                  onClick: () => {
                    const path = firstMenuPathInCenter(c);
                    if (path) navigateToAdminContent(path);
                  },
                })),
              selectable: true,
              selectedKeys: [activeSidebarKey],
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
                {activeSidebarKey === '/admin/cen_settings' ? (
                  <AppstoreOutlined />
                ) : (
                  activeCenter?.icon || <AppstoreOutlined />
                )}
              </span>
              <span style={{ color: '#fff', fontWeight: 600, fontSize: 14 }}>
                {activeSidebarKey === '/admin/cen_settings'
                  ? activeCenter?.label || '系统设置'
                  : activeCenter?.label || '选择控制台'}
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
            background: settings.searchBackgroundColor || 'transparent',
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
        <SettingOutlined
          style={{ color: '#fff', fontSize: 18 }}
          onClick={() => {
            const settingsCenter = visibleCenters.find((c: any) => c.key === '/admin/cen_settings');
            const path = settingsCenter ? firstMenuPathInCenter(settingsCenter) : null;
            navigate(path || '/admin/settings/general');
          }}
        />
        {user && (<>
          <div>
          <UserOutlined style={{color:'#fff',fontSize:18,marginRight:6}} />
          {(() => {
            const full = String(user.fullName || '').trim();
            const shouldUseUsername = !full || /\?/.test(full);
            const display = shouldUseUsername ? (user.username || '') : full;
            
            return (
              <Space>
                <span style={{color:'#fff'}}>{display}</span>
                {user.tenantName && <Tag color="gold" style={{marginRight:0}}>租户: {user.tenantName}</Tag>}
                {user.organizationName && <Tag color="cyan" style={{marginRight:0}}>组织: {user.organizationName}</Tag>}
              </Space>
            );
          })()}
          </div>
          {user.role !== 'tenant' && (
            <Button
              type="link"
              size="small"
              onClick={openChangePassword}
              style={{ color: '#fff', padding: 0 }}
            >
              修改密码
            </Button>
          )}
          <Button style={{color:'#1062fe',borderRadius:16,fontSize:12}} size="small" onClick={handleLogout}>Logout</Button>
        </>)}
      </div>
    </Header>
    );
  };

  const pageSearchEntries = useMemo(() => {
    const opts: PageSearchEntry[] = [];
    (visibleCenters || []).forEach((c: any) => {
      const push = (path: string, label: string, icon: React.ReactNode, group: string, title: string) => {
        if (path && path.startsWith('/')) opts.push({ path, title, icon, label, group });
      };
      if (c.key === '/admin/cen_settings') {
        (c.items || []).forEach((it: any) => {
          push(
            String(it.key || ''),
            String(it.label || ''),
            it.icon,
            String(c.label || ''),
            `${String(it.label || '')} ${String(c.label || '')}`,
          );
        });
      } else {
        (c.items || []).forEach((p: any) => {
          if (!p.children) {
            push(
              String(p.key || ''),
              String(p.label || ''),
              p.icon,
              String(c.label || ''),
              `${String(p.label || '')} ${String(c.label || '')}`,
            );
            return;
          }
          (p.children || []).forEach((it: any) => {
            push(
              String(it.key || ''),
              String(it.label || ''),
              it.icon,
              String(p.label || ''),
              `${String(it.label || '')} ${String(p.label || '')} ${String(c.label || '')}`,
            );
          });
        });
      }
    });
    return opts;
  }, [visibleCenters]);

  const filteredSearchList = useMemo(() => {
    const kw = String(searchText || '').toLowerCase().trim();
    const base = pageSearchEntries;
    if (!kw) return base.slice(0, 12);
    return base.filter((e) => e.title.toLowerCase().includes(kw));
  }, [pageSearchEntries, searchText]);

  useEffect(() => {
    searchActiveIndexRef.current = searchActiveIndex;
  }, [searchActiveIndex]);

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
          setSearchActiveIndex(i => {
            const newIndex = Math.min(i + 1, Math.max(filteredSearchList.length - 1, 0));
            searchActiveIndexRef.current = newIndex;
            return newIndex;
          });
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSearchActiveIndex(i => {
            const newIndex = Math.max(i - 1, 0);
            searchActiveIndexRef.current = newIndex;
            return newIndex;
          });
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          const sel = filteredSearchList[searchActiveIndexRef.current];
          if (sel) {
            const path = sel.path;
            const pure = String(path || '').split('?')[0];
            navigateToAdminContent(path);
            if (pure !== '/console') {
              setActiveSidebarKey(sidebarForPath(path));
            }
            setSearchOpen(false);
          }
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [searchOpen, filteredSearchList, navigateToAdminContent]);

  useEffect(() => {
    setActiveSidebarKey(sidebarForPath(location.pathname + location.search));
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (collapsed) {
      // 折叠状态下不展开任何分组
      return;
    }
    
    const center = visibleCenters.find(c => c.key === activeSidebarKey) || visibleCenters[0];
    if (!center) return;
    
    const currentPath = location.pathname.split('?')[0]; // 移除查询参数
    
    // 查找包含当前路径的分组
    const activeGroup = (center.items || []).find((item: any) => {
      // 如果是分组（有 children），检查其子项是否包含当前路径
      if (item.children && Array.isArray(item.children)) {
        return item.children.some((child: any) => {
          const childPath = String(child.key || '').split('?')[0];
          return childPath === currentPath;
        });
      }
      // 如果是顶级菜单项，检查是否匹配当前路径
      const itemPath = String(item.key || '').split('?')[0];
      return itemPath === currentPath;
    });
    
    // 如果找到分组，展开它；否则保持当前展开状态
    if (activeGroup && activeGroup.children) {
      const groupKey = activeGroup.key;
      setOpenKeys(prev => {
        if (prev.includes(groupKey)) return prev;

        // 只保留当前平台的展开状态，避免切平台后残留其它平台的 openKeys
        const pfPrefix = String(groupKey).split('_')[0];
        const nextBase = prev.filter(k => String(k).startsWith(pfPrefix + '_'));

        // 保留其它已展开分组，只新增当前分组到 openKeys，避免“点第一个分组导致其它折叠”
        return [...nextBase, groupKey];
      });
    }
  }, [collapsed, activeSidebarKey, location.pathname, visibleCenters]);

  useEffect(() => {
    if (!navOpen) return;
    setResourceLoading(true);
    fetchClouds()
      .then((list: any[]) => {
        const arr = Array.isArray(list) ? list : [];
        setResourceClouds(arr);
        const counts: Record<string, { total: number; running: number }> = {};
        arr.forEach((cloud: any) => {
          counts[cloud.id] = {
            total: Number(cloud.vmCount || 0),
            running: Number(cloud.runningVmCount || 0),
          };
        });
        setResourcePoolInstanceCounts(counts);
      })
      .catch(() => {})
      .finally(() => setResourceLoading(false));
  }, [navOpen]);

  return (
    <Layout style={{ height:'100vh', overflow:'hidden' }}>
      <StandardHeader />
      <>
        <Modal
          title={forcePasswordChange ? '密码已过期，请修改密码' : '修改密码'}
          open={changePasswordOpen}
          onCancel={() => {
            if (!forcePasswordChange) setChangePasswordOpen(false);
          }}
          onOk={submitChangePassword}
          confirmLoading={changePasswordSaving}
          okText="确认修改"
          cancelText="取消"
          closable={!forcePasswordChange}
          maskClosable={!forcePasswordChange}
          destroyOnHidden
        >
          <Form form={changePasswordForm} layout="vertical">
            <Form.Item
              label="原密码"
              name="oldPassword"
              rules={[{ required: true, message: '请输入原密码' }]}
            >
              <Input.Password autoComplete="current-password" />
            </Form.Item>
            <Form.Item
              label="新密码"
              name="newPassword"
              rules={[
                { required: true, message: '请输入新密码' },
                {
                  validator: async (_, v) => {
                    const pol =
                      adminPwdPolicy || {
                        minLength: 8,
                        maxLength: 64,
                        requireUppercase: false,
                        requireLowercase: false,
                        requireDigit: false,
                        requireSpecial: false,
                        maxPasswordAgeDays: 0,
                        requirePasswordChangeOnFirstLogin: false,
                      };
                    const err = validateAdminPasswordClient(pol, String(v || ''), user?.username);
                    if (err) throw new Error(err);
                  },
                },
              ]}
            >
              <Input.Password autoComplete="new-password" />
            </Form.Item>
            <Form.Item
              label="确认新密码"
              name="confirmPassword"
              dependencies={['newPassword']}
              rules={[
                { required: true, message: '请再次输入新密码' },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    if (!value || getFieldValue('newPassword') === value) return Promise.resolve();
                    return Promise.reject(new Error('两次输入的新密码不一致'));
                  },
                }),
              ]}
            >
              <Input.Password autoComplete="new-password" />
            </Form.Item>
          </Form>
        </Modal>
        {/* 全局搜索弹窗 */}
        {/* 检索关键词: search modal dialog 搜索弹窗 */}
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
                  filteredSearchList.map((it: PageSearchEntry, idx: number) => (
                    <div
                      key={it.path}
                      onMouseEnter={()=> setSearchActiveIndex(idx)}
                      onClick={()=> {
                        const path = it.path;
                        const pure = String(path || '').split('?')[0];
                        navigateToAdminContent(path);
                        if (pure !== '/console') {
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
        {/* 资源池快速展示抽屉 */}
        {/* 检索关键词: resource pool drawer navigation 资源池导航抽屉 */}
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
            top: ADMIN_HEADER_HEIGHT_PX,
            left:0,
            bottom:0,
            width: RESOURCE_DRAWER_WIDTH_PX,
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
          <div style={{ display:'flex', flex:1, minHeight:0, padding:'16px', overflow:'auto' }}>
            {resourceLoading ? (
              <div style={{ width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '40px 0' }}>
                <Spin size="large" />
              </div>
            ) : resourceClouds.length > 0 ? (
              <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 12 }}>
                {resourceClouds.slice(0, 8).map((cloud: any) => {
                  const vmStats = resourcePoolInstanceCounts[cloud.id] || { total: 0, running: 0 };
                  const isOnline = cloud.status === 'online' || cloud.status === 'active';

                  return (
                    <div key={cloud.id} style={{ width: '100%' }}>
                      <div
                        className={`resource-card-professional ${isOnline ? 'active' : ''}`}
                        onClick={() => navigate(`/admin/clouds/${cloud.id}`)}
                      >
                        <div className="resource-card-header-professional">
                          <div className="resource-header-content-professional">
                            <div className="resource-icon-professional">
                              <CloudDrawerProviderIcon provider={cloud.config?.provider} />
                            </div>
                            <div className="resource-info-professional">
                              <div className="resource-name-professional" title={cloud.name}>
                                {cloud.name}
                              </div>
                              <div className="resource-meta-professional">
                                <span className="region-tag-professional">{cloud.region || '-'}</span>
                              </div>
                            </div>
                          </div>
                          <div className={`status-badge-professional ${isOnline ? 'online' : 'offline'}`}>
                            {isOnline ? <CheckCircleFilled /> : <StopFilled />}
                            <span className="status-text">{isOnline ? '运行中' : cloud.status || '离线'}</span>
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
                            {RESOURCE_MATRIX_SLOTS.map((_, i) => {
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
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '60px 0' }}>
                <Empty description="未接入任何资源池" />
              </div>
            )}
          </div>
        </div>
      </>
      {/* 侧边栏和内容区域 */}
      <Layout>
        <style>{adminSidebarLayoutCss(NAV_DIVIDER_COLOR)}</style>
        {/* 侧边栏菜单 */}
        {/* 多云管理侧栏（资源池管理、资源控制台 等） */}
        <AdminSidebar
          collapsed={collapsed}
          onCollapse={setCollapsed}
          openKeys={openKeys}
          setOpenKeys={setOpenKeys}
          activeSidebarKey={activeSidebarKey}
          visibleCenters={visibleCenters as AdminSidebarCenter[]}
          selectedPathname={location.pathname}
          navigate={navigateToAdminContent}
          dividerColor={NAV_DIVIDER_COLOR}
          headerOffsetPx={ADMIN_HEADER_HEIGHT_PX}
        />
        <Content
          style={{
            background: location.pathname.includes('/webssh') ? '#1e1e1e' : '#fff',
            height: `calc(100vh - ${ADMIN_HEADER_HEIGHT_PX}px)`,
            overflow: 'auto',
          }}
        >
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
};

export default AdminLayout;
