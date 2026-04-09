/**
 * ============================================================================
 * AdminLayout 组件 - 管理后台主布局
 * ============================================================================
 * 
 * 【功能概述】
 * 这是整个管理后台的核心布局组件，负责：
 * 1. 顶部导航栏（Header）- 包含 Logo、平台切换、搜索、用户信息等
 * 2. 左侧边栏（Sider）- 动态菜单导航，支持多平台切换
 * 3. 内容区域（Content）- 使用 Outlet 渲染子路由
 * 4. 快速导航抽屉 - 资源池快速展示
 * 
 * 【检索关键词】
 * - 布局组件 layout admin
 * - 侧边栏菜单 sidebar menu navigation
 * - 平台切换 platform switch cen_compute cen_sdn cen_secops cen_settings
 * - 菜单构建 menu build visibleCenters
 * - 权限控制 permission access canAccessPath
 * - 搜索功能 search Ctrl+K
 * - 资源池导航 resource pool navigation
 * - SETTINGS 平台特殊处理 settings platform flat menu
 * 
 * 【关键特性】
 * - 支持多平台（CNMC/SDNCC/CNSOC/SETTINGS）动态切换
 * - SETTINGS 平台菜单项直接平铺（无分组嵌套）
 * - 基于权限的菜单项过滤
 * - 全局搜索功能（Ctrl+K）
 * - 资源池快速展示
 * - 收藏和最近访问记录
 * ============================================================================
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Layout, Button, Input, Divider, Typography, Space, Tag, App, Dropdown, Tooltip, Spin, Empty, Modal, Form } from 'antd';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  CodeOutlined, UserOutlined, SettingOutlined, CaretDownOutlined,
  DatabaseOutlined, CloudServerOutlined, DeploymentUnitOutlined,
  AppstoreOutlined, LogoutOutlined, DatabaseFilled, SearchOutlined,
  SafetyCertificateOutlined,
  AliyunOutlined, AmazonOutlined, GoogleOutlined, CheckCircleFilled, StopFilled, LockOutlined
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
import AdminSidebar from './AdminSidebar';
import { CloudConsoleProHeaderSlotProvider, useCloudConsoleProHeaderSlot } from '../pages/Clouds/Console/CloudConsoleProHeaderSlotContext';

const { Header, Content } = Layout;

const AdminLayout: React.FC = () => {
  // ============================================================================
  // 【状态管理】State Management
  // ============================================================================
  // 检索关键词: state useState 状态管理
  
  // 【侧边栏状态】
  const [collapsed, setCollapsed] = useState(true); // 侧边栏是否折叠，默认折叠
  const [activeSidebarKey, setActiveSidebarKey] = useState<string>('/admin/cen_compute'); // 当前激活的平台 key (cen_compute/cen_sdn/cen_secops/cen_settings)
  const [openKeys, setOpenKeys] = useState<string[]>([]); // 菜单展开的分组 keys
  
  // 【快速导航抽屉状态】
  const [navOpen, setNavOpen] = useState(false); // 资源池快速展示抽屉是否打开
  const [navSection, setNavSection] = useState<'resources'|'favorites'|'products'>('products'); // 导航抽屉的标签页（保留用于未来扩展）
  // (侧边栏平台切换相关的状态由 AdminSidebar 管理；保留 collapsed/openKeys 即可)
  // const [activeTab, setActiveTab] = useState<string>('全部'); // 当前激活的标签（保留用于未来扩展）
  
  // 【资源池数据】
  const [resourceClouds, setResourceClouds] = useState<any[]>([]); // 资源池列表
  const [resourceLoading, setResourceLoading] = useState<boolean>(false); // 资源池加载状态
  const [resourcePoolInstanceCounts, setResourcePoolInstanceCounts] = useState<Record<string, { total: number, running: number }>>({}); // 资源池实例统计信息
  

  // ============================================================================
  // 【工具函数】Utility Functions
  // ============================================================================
  // 检索关键词: utility function helper 工具函数
  
  // ============================================================================
  // 【Hooks 和常量】Hooks & Constants
  // ============================================================================
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout, refreshUser } = useAuth();
  const { hasFeature } = useLicense();
  const { settings, loading: settingsLoading } = useSettings();
  const isProConsole = location.pathname.startsWith('/admin/clouds/console'); // 是否为 Pro 控制台模式

  const NAV_DIVIDER_COLOR = 'rgb(200, 207, 218)'; // 导航分隔线颜色
 
  // 【全局搜索状态】
  const [searchOpen, setSearchOpen] = useState(false); // 搜索弹窗是否打开
  const [searchText, setSearchText] = useState(''); // 搜索关键词
  const [searchActiveIndex, setSearchActiveIndex] = useState(0); // 当前选中的搜索结果索引
  const searchActiveIndexRef = useRef(0); // 用于在 useEffect 中获取最新值
  const { message } = App.useApp(); // Ant Design 消息提示
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [changePasswordSaving, setChangePasswordSaving] = useState(false);
  const [changePasswordForm] = Form.useForm();
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

  // ============================================================================
  // 【权限控制】Permission Control
  // ============================================================================
  // 检索关键词: permission access control canAccessPath 权限控制
  
  /**
   * 检查用户是否有权限访问指定路径
   * 检索关键词: canAccessPath permission check 权限检查
   * 
   * @param p - 路由路径
   * @returns 是否有权限访问
   * 
   * 【权限逻辑】
   * 1. super_admin 和 admin 角色拥有所有权限
   * 2. 其他角色根据 permissions 数组判断
   * 3. 通过 getRequiredActionForPath 获取路径所需的权限动作
   * 4. 通过 hasPermissionForAction 检查用户是否有该权限
   */
  const canAccessPath = useCallback((p: string): boolean => {
    const pure = String(p || '').split('?')[0];
    if (!user) return false;
    const role = String(user.role || '').toLowerCase();
    // 只有 super_admin 才跳过权限检查，admin 也需要检查权限（与后端保持一致）
    if (role === 'super_admin') return true;
    const act = getRequiredActionForPath(pure);
    const perms = Array.isArray(user.permissions) ? user.permissions : [];
    const hasAccess = hasPermissionForAction(perms, act);
    // 开发环境调试（已禁用）
    // if (process.env.NODE_ENV === 'development') {
    //   console.log(`[canAccessPath] Path: "${pure}", Action: "${act}", Permissions:`, perms, `HasAccess: ${hasAccess}`);
    // }
    return hasAccess;
  }, [user]);

  /**
   * 处理用户登出
   * 检索关键词: handleLogout logout 登出
   */
  const handleLogout = () => {
    logout();
    navigate('/admin/login');
  };

  // ============================================================================
  // 【Header 组件】Header Components
  // ============================================================================
  // 检索关键词: header StandardHeader ProHeader 顶部导航栏
  
  // StandardHeader 将在 visibleCenters 定义后定义

  /**
   * Pro Header 组件（资源控制台专用）
   * 检索关键词: ProHeader Pro 头部
   * 
   * 【功能模块】
   * 1. 左侧：Logo、页面内搜索
   * 2. 右侧：用户信息、登出按钮
   */
  const ProHeader: React.FC = () => {
    const primaryColor = settings.primaryColor;
    const { centerSlot } = useCloudConsoleProHeaderSlot();

    const headerTitle = settingsLoading ? '' : String(settings.headerTitle ?? '');

    return (
      <Header
        style={{
          background: '#fff',
          color: '#1f2a44',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 20px',
          position: 'sticky',
          top: 0,
          zIndex: 1000,
          height: 50,
          boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
          borderBottom: '1px solid ' + NAV_DIVIDER_COLOR,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: '100%', flexShrink: 0 }}>
          {settings.headerIcon ? (
            <img src={settings.headerIcon} alt="Logo" style={{ height: 28, width: 'auto', display: 'block' }} />
          ) : (
            <AppstoreOutlined style={{ color: primaryColor || undefined, fontSize: 18 }} />
          )}

          <span style={{ fontSize: 14, lineHeight: '14px', display: 'flex', alignItems: 'center' }}>
            {renderMarkdownBold(headerTitle)}
          </span>
        </div>

        {centerSlot ? (
          <Divider
            type="vertical"
            style={{
              height: 24,
              margin: '0 10px',
              borderColor: 'rgba(0,0,0,0.12)',
              flexShrink: 0,
            }}
          />
        ) : null}

        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            justifyContent: 'flex-start',
            alignItems: 'center',
            padding: centerSlot ? '0 12px 0 0' : '0 12px',
          }}
        >
          {centerSlot}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16, height: '100%', flexShrink: 0 }}>
          {user && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'nowrap', whiteSpace: 'nowrap' }}>
                <UserOutlined style={{ fontSize: 16 }} />
                <span
                  style={{
                    fontSize: 14,
                    maxWidth: 160,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {(() => {
                    const full = String(user.fullName || '').trim();
                    const shouldUseUsername = !full || /\?/.test(full);
                    return shouldUseUsername ? user.username || '' : full;
                  })()}
                </span>

                {user.tenantName && (
                  <Tooltip title={`当前租户: ${user.tenantName}`}>
                    <Tag
                      bordered={false}
                      color="blue"
                      style={{
                        margin: 0,
                        fontSize: 10,
                        lineHeight: '24px',
                        padding: '0 6px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        borderRadius: 4,
                      }}
                    >
                      <span style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {user.tenantName}
                      </span>
                    </Tag>
                  </Tooltip>
                )}

                {user.organizationName && (
                  <Tooltip title={`当前组织: ${user.organizationName}`}>
                    <Tag
                      bordered={false}
                      color="pink"
                      style={{
                        margin: 0,
                        fontSize: 10,
                        lineHeight: '24px',
                        padding: '0 6px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        borderRadius: 4,
                      }}
                    >
                      <span style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {user.organizationName}
                      </span>
                    </Tag>
                  </Tooltip>
                )}
              </div>

              <Divider type="vertical" style={{ height: 24, margin: 0, borderColor: 'rgba(255,255,255,0.35)' }} />

              {user.role !== 'tenant' && (
                <Tooltip title="修改密码">
                  <Button
                    type="text"
                    icon={<LockOutlined style={{ color: '#595959', fontSize: 16 }} />}
                    onClick={openChangePassword}
                    style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  />
                </Tooltip>
              )}

              <Tooltip title="退出登录">
                <Button
                  type="text"
                  icon={<LogoutOutlined style={{ color: '#595959', fontSize: 16 }} />}
                  onClick={handleLogout}
                  style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                />
              </Tooltip>
            </div>
          )}
        </div>
      </Header>
    );
  };

  

  // ============================================================================
  // 【菜单构建逻辑】Menu Building Logic
  // ============================================================================
  // 检索关键词: menu build centers visibleCenters 菜单构建
  
  /**
   * 获取分组的图标
   * 检索关键词: groupIconOf group icon 分组图标
   * 
   * @param pf - 平台标识 (CNMC/SDNCC/CNSOC/SETTINGS)
   * @param grp - 分组名称
   * @returns React 图标组件
   */
  const groupIconOf = (pf: string, grp: string) => {
    const visible = routeSpecs
      .filter(s => s.layout === 'admin' && s.platform === pf && s.group === grp && !s.hidden)
      .sort((a:any, b:any) => Number(a.order ?? 9999) - Number(b.order ?? 9999));

    const all = routeSpecs
      .filter(s => s.layout === 'admin' && s.platform === pf && s.group === grp)
      .sort((a:any, b:any) => Number(a.order ?? 9999) - Number(b.order ?? 9999));

    const list = visible.length > 0 ? visible : all;
    const firstWithIcon = list.find(s => !!s.icon) || list[0];
    return iconOf(firstWithIcon?.icon);
  };

  /**
   * 构建平台中心菜单结构
   * 检索关键词: centers menu structure 菜单结构
   * 
   * 【核心逻辑】
   * 1. 遍历所有平台（CNMC/SDNCC/CNSOC/SETTINGS）
   * 2. SETTINGS 平台：菜单项直接平铺（无分组嵌套）
   * 3. 其他平台：按分组（group）组织，每个分组包含多个菜单项（children）
   * 
   * 【数据结构】
   * {
   *   key: '/admin/cen_compute' | '/admin/cen_sdn' | '/admin/cen_secops' | '/admin/cen_settings',
   *   label: '平台名称',
   *   icon: <Icon />,
   *   items: [
   *     // SETTINGS: 直接是菜单项数组
   *     // 其他平台: 分组数组，每个分组有 children
   *   ]
   * }
   */
  const adminSpecs = React.useMemo(() => routeSpecs.filter(s => s.layout === 'admin' && !s.hidden), []);
  
  const centers = React.useMemo(() => PLATFORMS.filter(p => p !== '全部').map((pf: any) => {
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
        icon: groupIconOf(pf, grp),
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
  }), [adminSpecs]);

  /**
   * 移除菜单项中的自定义属性（避免传递给 DOM 元素）
   * 检索关键词: cleanMenuItem remove custom props 清理菜单项
   */
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

  /**
   * 过滤后的可见平台中心（根据权限过滤）
   * 检索关键词: visibleCenters filtered centers 可见平台
   * 
   * 【过滤逻辑】
   * 1. SETTINGS 平台：直接过滤 items 中的菜单项
   * 2. 其他平台：先过滤每个分组的 children，再过滤掉空分组
   * 3. 最后过滤掉没有菜单项的平台
   * 4. 移除 requiredFeature 属性（避免传递给 DOM 元素）
   */
  const visibleCenters = React.useMemo(() => (centers || [])
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

  /**
   * 标准 Header 组件
   * 检索关键词: StandardHeader 标准头部
   * 
   * 【功能模块】
   * 1. 左侧：Logo、平台切换下拉菜单
   * 2. 中间：全局搜索框（Ctrl+K）
   * 3. 右侧：API 文档、系统设置（齿轮图标）、用户信息、登出按钮
   */
  const StandardHeader: React.FC = () => {
    const headerColor = settings.headerColor;
    const headerColorEnd = settings.headerColorEnd;
    const gradient =
      headerColor && headerColorEnd
        ? `linear-gradient(90deg, ${headerColor} 0%, ${headerColorEnd} 100%)`
        : 'transparent';
    
    return (
    <Header style={{ background: gradient, color:'#fff', display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 20px', position:'sticky', top:0, zIndex:1000, height: 64, boxShadow:'0 4px 16px rgba(0,0,0,0.08)', borderBottom:'1px solid ' + NAV_DIVIDER_COLOR }}>
      <div style={{ display:'flex', alignItems:'center', height:64 }}>
        <Button type="text" icon={(navOpen ? <DatabaseOutlined style={{color:'#fff',fontSize:20}} /> : <DatabaseFilled style={{color:'#fff',fontSize:20}} />)} onClick={()=> {
          setNavOpen(v => {
            const next = !v;
            if (next) setNavSection('resources');
            return next;
          });
        }} style={{height:40,width:40,display:'flex',alignItems:'center',justifyContent:'center'}} />
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
                    const first = (c.items || [])[0];
                    const firstPage = first?.children ? (first.children || [])[0] : first;
                    if (firstPage?.key) navigate(firstPage.key);
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
                {(() => {
                  const current = visibleCenters.find(c => c.key === activeSidebarKey);
                  // 如果是系统设置，不显示图标，显示默认图标
                  if (activeSidebarKey === '/admin/cen_settings') {
                    return <AppstoreOutlined />;
                  }
                  return current?.icon || <AppstoreOutlined />;
                })()}
              </span>
              <span style={{ color: '#fff', fontWeight: 600, fontSize: 14 }}>
                {(() => {
                  const current = visibleCenters.find(c => c.key === activeSidebarKey);
                  // 如果是系统设置，显示"系统设置"，否则显示平台名称
                  if (activeSidebarKey === '/admin/cen_settings') {
                    return current?.label || '系统设置';
                  }
                  return current?.label || '选择控制台';
                })()}
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
        <SettingOutlined style={{color:'#fff',fontSize:18}} onClick={()=>{
          // 找到 SETTINGS 平台的第一个可访问页面
          const settingsCenter = visibleCenters.find((c: any) => c.key === '/admin/cen_settings');
          if (settingsCenter) {
            const first = (settingsCenter.items || [])[0];
            const firstPage = first?.children ? (first.children || [])[0] : first;
            if (firstPage?.key) {
              navigate(firstPage.key);
            } else {
              // 如果没有找到可访问的页面，跳转到默认设置页面
              navigate('/admin/settings/general');
            }
          } else {
            // 如果没有 SETTINGS 平台，跳转到默认设置页面
            navigate('/admin/settings/general');
          }
        }} />
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

  /**
   * 构建全局搜索的选项列表
   * 检索关键词: pageSearchOptions search options 搜索选项
   * 
   * 【数据结构】
   * 每个选项包含：
   * - value: 路由路径
   * - title: 完整标题（用于搜索匹配）
   * - label: React 节点（用于显示）
   * 
   * 【特殊处理】
   * - SETTINGS 平台：直接从 items 构建选项
   * - 其他平台：从分组的 children 构建选项
   */
  const pageSearchOptions = React.useMemo(() => {
    const opts: any[] = [];
    (visibleCenters || []).forEach((c:any) => {
      // SETTINGS 平台的菜单项是直接平铺的（没有 children 结构）
      if (c.key === '/admin/cen_settings') {
        (c.items || []).forEach((it:any) => {
          const title = `${String(it.label || '')} ${String(c.label || '')}`;
          opts.push({
            value: String(it.key || ''),
            title,
            label: (
              <Space size={8}>
                <span style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', width:20, height:20, borderRadius:6, background:'#f0f5ff' }}>{it.icon}</span>
                <span style={{ fontSize:13 }}>{it.label}</span>
                <Typography.Text type="secondary" style={{ marginLeft:8 }}>{c.label}</Typography.Text>
              </Space>
            ),
          });
        });
      } else {
        (c.items || []).forEach((p:any) => {
          if (!p.children) {
            const title = `${String(p.label || '')} ${String(c.label || '')}`;
            opts.push({
              value: String(p.key || ''),
              title,
              label: (
                <Space size={8}>
                  <span style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', width:20, height:20, borderRadius:6, background:'#f0f5ff' }}>{p.icon}</span>
                  <span style={{ fontSize:13 }}>{p.label}</span>
                  <Typography.Text type="secondary" style={{ marginLeft:8 }}>{c.label}</Typography.Text>
                </Space>
              ),
            });
            return;
          }
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
      }
    });
    return opts;
  }, [visibleCenters]);

  /**
   * 过滤后的搜索结果列表
   * 检索关键词: filteredSearchList search filter 搜索结果
   * 
   * 【过滤逻辑】
   * - 如果有搜索关键词：按标题模糊匹配
   * - 如果没有搜索关键词：显示前 12 条
   */
  const filteredSearchList = React.useMemo(() => {
    const kw = String(searchText || '').toLowerCase();
    const base = pageSearchOptions.map((o:any)=> ({ path: o.value, title: o.title, icon: o.label?.props?.children?.[0], label: o.label?.props?.children?.[1]?.props?.children, group: o.label?.props?.children?.[2]?.props?.children }));
    const list = kw ? base.filter((it:any)=> String(it.title||'').toLowerCase().includes(kw)) : base.slice(0, 12);
    return list;
  }, [pageSearchOptions, searchText]);

  // ============================================================================
  // 【全局搜索快捷键】Global Search Keyboard Shortcuts
  // ============================================================================
  // 检索关键词: search keyboard shortcut Ctrl+K 搜索快捷键
  
  /**
   * 全局搜索快捷键处理
   * 检索关键词: search keyboard handler 搜索快捷键处理
   * 
   * 【快捷键】
   * - Ctrl+K / Cmd+K: 打开搜索弹窗
   * - Esc: 关闭搜索弹窗
   * - ArrowDown: 向下选择
   * - ArrowUp: 向上选择
   * - Enter: 打开选中的页面
   */
  // 同步 searchActiveIndex 到 ref
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
            navigate(path);
            setActiveSidebarKey(sidebarForPath(path));
            setSearchOpen(false);
          }
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [searchOpen, filteredSearchList, navigate]);


  // ============================================================================
  // 【路由处理】Route Handling
  // ============================================================================
  // 检索关键词: route path sidebarForPath 路由处理
  
  /**
   * 根据路径确定应该激活哪个侧边栏平台
   * 检索关键词: sidebarForPath path to sidebar 路径转侧边栏
   * 
   * @param p - 路由路径
   * @returns 平台 key ('/admin/cen_compute' | '/admin/cen_sdn' | '/admin/cen_secops' | '/admin/cen_settings')
   * 
   * 【匹配逻辑】
   * 1. 优先从 routeSpecs 中查找精确匹配或前缀匹配
   * 2. 如果找到且指定了 platform，返回对应的平台 key
   * 3. 否则根据路径关键词判断：
   *    - /interconnect, /sec-mgr-plane, /security/traffic → cen_sdn
   *    - /alarms, /soc, /aisoc → cen_secops
   *    - /settings → cen_settings
   *    - 其他 → cen_compute（默认）
   */
  const sidebarForPath = (p: string) => {
    // Try to find exact match or prefix match in routeSpecs
    // This helps when routes are explicitly defined with a platform
    const found = routeSpecs.find(r => {
      if (r.path === p) return true;
      // Simple prefix check for parameterized routes
      if (r.path.includes(':')) {
        const base = r.path.split(':')[0];
        return p.startsWith(base);
      }
      return false;
    });
    
    if (found && found.platform) {
      if (found.platform === 'CNMC') return '/admin/cen_compute';
      if (found.platform === 'SDNCC') return '/admin/cen_sdn';
      if (found.platform === 'CNSOC') return '/admin/cen_secops';
      if (found.platform === 'SETTINGS') return '/admin/cen_settings';
    }

    const s = p.toLowerCase();
    if (s.includes('/interconnect') || s.includes('/sec-mgr-plane') || s.includes('/security/traffic')) return '/admin/cen_sdn';
    if (s.includes('/alarms') || s.includes('/soc') || s.includes('/aisoc')) return '/admin/cen_secops';
    if (s.includes('/settings')) return '/admin/cen_settings';
    return '/admin/cen_compute';
  };

  /**
   * 监听路径变化，自动切换侧边栏平台
   * 检索关键词: path change sidebar switch 路径变化侧边栏切换
   */
  useEffect(() => {
    setActiveSidebarKey(sidebarForPath(location.pathname + location.search));
  }, [location.pathname, location.search]);

  /**
   * 根据当前路径自动展开对应的菜单分组
   * 检索关键词: openKeys auto expand 自动展开菜单
   * 
   * 【逻辑说明】
   * - 找到包含当前路径的分组，展开该分组
   * - 如果当前路径是顶级菜单项（无分组），则不展开任何分组
   */
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

  /**
   * 导航抽屉标签页切换时重置标签（保留用于未来扩展）
   */
  // useEffect(() => {
  //   if (navSection === 'products') {
  //     setActiveTab('全部');
  //   }
  // }, [navSection]);

  /**
   * 打开导航抽屉时加载资源池数据
   * 检索关键词: nav drawer resource pool load 导航抽屉资源池加载
   */
  useEffect(() => {
    if (navOpen) {
      setResourceLoading(true);
      fetchClouds().then((list:any[]) => {
        const arr = Array.isArray(list) ? list : [];
        setResourceClouds(arr);
        
        // 计算每个资源池的实例统计
        const counts: Record<string, { total: number, running: number }> = {};
        arr.forEach((cloud: any) => {
          const count = Number(cloud.vmCount || 0);
          const running = Number(cloud.runningVmCount || 0);
          counts[cloud.id] = { total: count, running: running };
        });
        setResourcePoolInstanceCounts(counts);
      }).catch(() => {}).finally(() => setResourceLoading(false));
    }
  }, [navOpen, navSection]);


  // ============================================================================
  // 【主渲染】Main Render
  // ============================================================================
  // 检索关键词: render layout main 主渲染
  
  return (
    <CloudConsoleProHeaderSlotProvider>
    <Layout style={{ height:'100vh', overflow:'hidden' }}>
      {/* 根据路径选择 Header 组件 */}
      {isProConsole ? <ProHeader /> : <StandardHeader />}
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
                  filteredSearchList.map((it:any, idx:number) => (
                    <div
                      key={it.path}
                      onMouseEnter={()=> setSearchActiveIndex(idx)}
                      onClick={()=> {
                        const path = it.path;
                        navigate(path);
                        setActiveSidebarKey(sidebarForPath(path));
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
            top: isProConsole ? 50 : 64,
            left:0,
            bottom:0,
            width:400,
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
                {resourceClouds
                  .slice(0, 8)
                  .map((cloud: any) => {
                    const stats = resourcePoolInstanceCounts[cloud.id] || { total: 0, running: 0 };
                    const isOnline = cloud.status === 'online' || cloud.status === 'active';
                    const MATRIX_ARRAY = [...Array(100)];
                    
                    return (
                      <div key={cloud.id} style={{ width: '100%' }}>
                        <div 
                          className={`resource-card-professional ${isOnline ? 'active' : ''}`} 
                          onClick={() => navigate(`/admin/clouds/${cloud.id}`)}
                        >
                          <div className="resource-card-header-professional">
                            <div className="resource-header-content-professional">
                              <div className="resource-icon-professional">
                                {cloud.config?.provider === 'aliyun' ? <AliyunOutlined /> :
                                 cloud.config?.provider === 'aws' ? <AmazonOutlined /> :
                                 cloud.config?.provider === 'huaweicloud' ? <span style={{ fontWeight: 900, fontSize: '14px', fontFamily: 'Arial' }}>HW</span> :
                                 cloud.config?.provider === 'google' ? <GoogleOutlined /> :
                                (cloud.config?.provider === 'cloudmap.edge' || cloud.config?.provider === 'cloudmap.private') ? <CloudServerOutlined /> :
                                (cloud.config?.provider === 'cloudmap.csm') ? <SafetyCertificateOutlined /> :
                                 <DeploymentUnitOutlined />}
                              </div>
                              <div className="resource-info-professional">
                                <div className="resource-name-professional" title={cloud.name}>{cloud.name}</div>
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
        <style>{`
          .admin-sidebar {
            background: transparent !important;
          }
          .admin-sidebar .ant-layout-sider {
            background: transparent !important;
          }
          .admin-sidebar .ant-layout-sider-children {
            background: transparent !important;
          }
          .admin-sidebar-header {
            background: #F9F9FA !important;
          }
          .admin-sidebar-menu {
            background: #ffffff !important;
          }
          .admin-sidebar-menu.ant-menu {
            background: #ffffff !important;
          }
          .admin-sidebar .ant-menu {
            background: #ffffff !important;
          }
          .admin-sidebar-menu .ant-menu-item-selected {
            background-color: ${settings.sidebarMenuItemSelectedColor || 'transparent'} !important;
          }
          .admin-sidebar-menu .ant-menu-item-selected::after {
            border-right-color: ${settings.sidebarMenuItemSelectedColor || 'transparent'} !important;
          }
          .admin-sidebar-menu .ant-menu-item-selected > span {
            color: ${settings.sidebarMenuItemSelectedTextColor || 'inherit'} !important;
          }
          .admin-sidebar-menu .ant-menu-item-selected .anticon {
            color: ${settings.sidebarMenuItemSelectedIconColor || 'inherit'} !important;
          }
        `}</style>
        {/* 侧边栏菜单 */}
        {/* 在特定页面隐藏侧边栏：资源控制台 */}
        {!(location.pathname.includes('/admin/clouds/ecs') || location.pathname.includes('/admin/clouds/console')) && (
          <AdminSidebar
            collapsed={collapsed}
            onCollapse={(next) => setCollapsed(next)}
            openKeys={openKeys}
            setOpenKeys={setOpenKeys}
            activeSidebarKey={activeSidebarKey}
            visibleCenters={visibleCenters as any}
            selectedPathname={location.pathname}
            navigate={navigate}
            isProConsole={isProConsole}
            dividerColor={NAV_DIVIDER_COLOR}
          />
        )}
        {/* 内容区域 */}
        {/* 检索关键词: Content Outlet 内容区域 */}
        <Content style={{background: location.pathname.includes('/webssh') ? '#1e1e1e' : '#fff', height:`calc(100vh - ${isProConsole ? 50 : 64}px)`, overflow:'auto'}}>
          <Outlet /> {/* React Router 的子路由渲染出口 */}
        </Content>
      </Layout>
    </Layout>
    </CloudConsoleProHeaderSlotProvider>
  );
};

export default AdminLayout;
