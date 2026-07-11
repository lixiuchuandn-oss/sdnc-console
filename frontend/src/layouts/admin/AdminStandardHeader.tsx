/**
 * 管理后台顶栏（平台切换、Logo/标题、用户区与登出）。
 */
import React from 'react';
import { Button, Dropdown, Layout, Space, Tag, Tooltip } from 'antd';
import { HomeFilled, LogoutOutlined, SearchOutlined, UserOutlined } from '@ant-design/icons';
import type { AdminSidebarCenter } from './AdminSidebar';
import { renderMarkdownBold } from '../../utils/markdown';
import { ADMIN_HEADER_HEIGHT_PX, firstMenuPathInCenter } from './lib/adminLayoutNav';

const { Header } = Layout;

export type AdminStandardHeaderProps = {
  settings: {
    headerColor?: string;
    headerColorEnd?: string;
    headerIcon?: string;
    headerTitle?: string;
  };
  settingsLoading: boolean;
  visibleCenters: AdminSidebarCenter[];
  platformDropdownSelectedKeys: string[];
  navigateToAdminContent: (path: string) => void;
  user: {
    username?: string;
    fullName?: string;
    role?: string;
    tenantName?: string;
    organizationName?: string;
  } | null;
  openChangePassword: () => void;
  handleLogout: () => void;
  onOpenGlobalSearch: () => void;
};

function AdminStandardHeader({
  settings,
  settingsLoading,
  visibleCenters,
  platformDropdownSelectedKeys,
  navigateToAdminContent,
  user,
  openChangePassword,
  handleLogout,
  onOpenGlobalSearch,
}: AdminStandardHeaderProps) {
  const headerColor = settings.headerColor?.trim();
  const headerColorEnd = settings.headerColorEnd?.trim();
  const gradient =
    headerColor && headerColorEnd
      ? `linear-gradient(90deg, ${headerColor} 0%, ${headerColorEnd} 100%)`
      : 'transparent';

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
      </div>
      <div
        className="admin-header-actions"
        style={{ display: 'flex', alignItems: 'center', gap: 16, height: '100%', flexShrink: 0 }}
      >
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
            <div
              className="admin-header-user-strip"
              style={{
                display: 'flex',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '8px 12px',
                maxWidth: 520,
                minWidth: 0,
              }}
            >
              <span className="admin-header-login-user">
                <UserOutlined aria-hidden />
                <span className="admin-header-login-user-name">
                  {String(user.username || '').trim() || '—'}
                </span>
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
