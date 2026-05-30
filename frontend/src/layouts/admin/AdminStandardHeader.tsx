/**
 * 管理后台顶栏（平台切换、Logo/标题、可用区与资源池条、用户区与登出）。
 * 从 AdminLayout 抽出为模块级组件：避免在 AdminLayout 内每次渲染新建子组件类型，
 * 导致 Select 被卸载、切换不生效。
 */
import React from 'react';
import { Button, Dropdown, Layout, Select, Space, Spin, Tag, Tooltip } from 'antd';
import type { NavigateFunction } from 'react-router-dom';
import { HomeFilled, ApiFilled, LogoutOutlined, SearchOutlined, UserOutlined } from '@ant-design/icons';
import type { AdminSidebarCenter } from './AdminSidebar';
import { type Cloud, isCsmCloud } from '../../pages/cnmc/pools/lib/poolProviders';
import { renderMarkdownBold } from '../../utils/markdown';
import {
  ADMIN_HEADER_HEIGHT_PX,
  HEADER_POOL_STRIP_STYLE,
  byCloudCreatedAtAsc,
  firstMenuPathInCenter,
  poolOverviewPath,
} from './lib/adminLayoutNav';

const { Header } = Layout;

export type AdminStandardHeaderProps = {
  settings: {
    headerColor?: string;
    headerColorEnd?: string;
    headerIcon?: string;
    headerTitle?: string;
  };
  settingsLoading: boolean;
  summaryClouds: Cloud[];
  summaryLoading: boolean;
  visibleCenters: AdminSidebarCenter[];
  activeSidebarKey: string;
  /** 资源池详情时顶栏「平台」下拉不高亮具体平台 */
  platformDropdownSelectedKeys: string[];
  navigateToAdminContent: (path: string) => void;
  headerSelectedPoolId: string | undefined;
  setHeaderSelectedPoolId: React.Dispatch<React.SetStateAction<string | undefined>>;
  /** 顶栏切换池后是否可进入池内总览（未授权多云管理时仅依赖控制台读权限） */
  headerPoolOverviewEnabled: boolean;
  canWritePools: boolean;
  navigate: NavigateFunction;
  user: {
    username?: string;
    fullName?: string;
    role?: string;
    tenantName?: string;
    organizationName?: string;
  } | null;
  openChangePassword: () => void;
  handleLogout: () => void;
  openDefaultPoolWizardAction: () => void;
  /** 打开全局页面搜索（与 Ctrl+K 同源） */
  onOpenGlobalSearch: () => void;
};

function AdminStandardHeader({
  settings,
  settingsLoading,
  summaryClouds,
  summaryLoading,
  visibleCenters,
  activeSidebarKey: _activeSidebarKey,
  platformDropdownSelectedKeys,
  navigateToAdminContent,
  headerSelectedPoolId,
  setHeaderSelectedPoolId,
  headerPoolOverviewEnabled,
  canWritePools,
  navigate,
  user,
  openChangePassword,
  handleLogout,
  openDefaultPoolWizardAction,
  onOpenGlobalSearch,
}: AdminStandardHeaderProps) {
  const headerColor = settings.headerColor?.trim();
  const headerColorEnd = settings.headerColorEnd?.trim();
  const gradient =
    headerColor && headerColorEnd
      ? `linear-gradient(90deg, ${headerColor} 0%, ${headerColorEnd} 100%)`
      : 'transparent';

  const zoneOptions = [...summaryClouds].filter((c) => !isCsmCloud(c)).sort(byCloudCreatedAtAsc).map((c) => ({
    value: c.id,
    label: c.name,
  }));

  return (
    <Header
      style={{
        background: gradient,
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 20px',
        position: 'sticky',
        top: 0,
        zIndex: 1000,
        height: ADMIN_HEADER_HEIGHT_PX,
        boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
        borderBottom: '1px solid var(--admin-nav-divider-color, rgb(200, 207, 218))',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          height: ADMIN_HEADER_HEIGHT_PX,
          gap: 12,
          flex: 1,
          minWidth: 0,
        }}
      >
        <Dropdown
          menu={{
            items: visibleCenters.map((c: AdminSidebarCenter) => ({
              key: c.key,
              label: <span style={{ fontWeight: 500 }}>{c.label}</span>,
              onClick: () => {
                const path = firstMenuPathInCenter(c);
                if (path) navigateToAdminContent(path);
              },
            })),
            selectable: true,
            selectedKeys: platformDropdownSelectedKeys,
          }}
          trigger={['click']}
        >
          <button
            type="button"
            className="admin-header-platform-trigger"
            aria-label="切换平台"
            title="切换平台"
          >
            <HomeFilled />
          </button>
        </Dropdown>
        <Space size={8} style={{ height: '100%', alignItems: 'center' }}>
          {settings.headerIcon && (
            <img src={settings.headerIcon} alt="Logo" style={{ height: 28, width: 'auto', display: 'block' }} />
          )}
          <span
            style={{
              fontSize: 18,
              color: '#fff',
              lineHeight: '18px',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            {settingsLoading ? '' : renderMarkdownBold(settings.headerTitle ?? '')}
          </span>
        </Space>
        <div role="region" aria-label="可用区与资源池" style={{ ...HEADER_POOL_STRIP_STYLE, gap: 5 }}>
          {summaryLoading ? (
            <Spin size="small" />
          ) : (
            <>
              <Select
                prefix="可用区"
                className="admin-header-zone-select"
                size="small"
                showSearch
                optionFilterProp="label"
                disabled={!zoneOptions.length}
                loading={summaryLoading}
                placeholder={zoneOptions.length ? undefined : '暂无多云资源池'}
                value={headerSelectedPoolId}
                options={zoneOptions}
                style={{ width: 150 }}
                onChange={(id) => {
                  setHeaderSelectedPoolId(id);
                  if (headerPoolOverviewEnabled && id) navigate(poolOverviewPath(String(id), summaryClouds));
                }}
                aria-label="选择资源池（可用区）"
              />
              <button
                type="button"
                className="admin-header-pool-access-btn"
                disabled={!headerPoolOverviewEnabled || !headerSelectedPoolId || !zoneOptions.length}
                title="进入当前资源池总览"
                aria-label="访问当前资源池总览"
                onClick={() => {
                  if (headerPoolOverviewEnabled && headerSelectedPoolId) {
                    navigate(poolOverviewPath(String(headerSelectedPoolId), summaryClouds));
                  }
                }}
              >
                访问
              </button>
              {canWritePools && (
                <button
                  type="button"
                  className="admin-header-pool-icon-btn"
                  title={
                    !summaryClouds.filter((c) => !isCsmCloud(c)).length
                      ? '添加默认资源池'
                      : '编辑当前默认资源池（未显式指定时为最早添加的池）'
                  }
                  aria-label="设定默认资源池"
                  onClick={openDefaultPoolWizardAction}
                >
                  <ApiFilled />
                </button>
              )}
            </>
          )}
        </div>
      </div>
      <div className="admin-header-actions" style={{ display: 'flex', alignItems: 'center', gap: 16, height: '100%', flexShrink: 0 }}>
        <Tooltip title="搜索页面 (Ctrl+K)">
          <Button
            type="text"
            className="admin-header-search-btn"
            icon={<SearchOutlined style={{ color: '#fff', fontSize: 16 }} />}
            aria-label="搜索页面"
            onClick={onOpenGlobalSearch}
          />
        </Tooltip>
        {user && (
          <>
            <div className="admin-header-user-strip" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px 12px', maxWidth: 520, minWidth: 0 }}>
              <span className="admin-header-login-user">
                <UserOutlined aria-hidden />
                <span className="admin-header-login-user-name">{String(user.username || '').trim() || '—'}</span>
              </span>
              {user.tenantName && <Tag color="gold">租户: {user.tenantName}</Tag>}
              {user.organizationName && <Tag color="cyan">组织: {user.organizationName}</Tag>}
            </div>
            {user.role !== 'tenant' && (
              <Button
                type="link"
                size="small"
                className="admin-header-change-pwd-link"
                onClick={openChangePassword}
              >
                修改密码
              </Button>
            )}
            <Button
              type="default"
              size="small"
              className="admin-header-logout-btn"
              icon={<LogoutOutlined />}
              onClick={handleLogout}
            />
          </>
        )}
      </div>
    </Header>
  );
}

export default AdminStandardHeader;
