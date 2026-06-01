import React from 'react';
import { Button, Divider, Layout, Tag, Tooltip, theme } from 'antd';
import { ExportOutlined, LockOutlined, MenuFoldOutlined, MenuUnfoldOutlined, UserOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useTenantConsoleHeaderSlot } from '../../contexts/TenantConsoleHeaderSlotContext';

const { Header } = Layout;

/** 与 Ant Design Layout Demo 顶栏高度一致（折叠按钮 64×64） */
export const TENANT_CONSOLE_HEADER_HEIGHT_PX = 64;

type TenantConsoleHeaderProps = {
  openChangePassword: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  showCollapseToggle: boolean;
};

const TenantConsoleHeader: React.FC<TenantConsoleHeaderProps> = ({
  openChangePassword,
  collapsed,
  onToggleCollapsed,
  showCollapseToggle,
}) => {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { centerSlot } = useTenantConsoleHeaderSlot();
  const {
    token: { colorBgContainer },
  } = theme.useToken();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <Header
      className="tenant-console-header"
      style={{
        padding: 0,
        background: colorBgContainer,
        height: TENANT_CONSOLE_HEADER_HEIGHT_PX,
        lineHeight: `${TENANT_CONSOLE_HEADER_HEIGHT_PX}px`,
      }}
    >
      <div className="tenant-console-header__inner">
        <div className="tenant-console-header__left">
          {showCollapseToggle && (
            <Button
              type="text"
              className="tenant-console-header__collapse-btn"
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={onToggleCollapsed}
              aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
            />
          )}
        </div>

        <div className="tenant-console-header__center">{centerSlot}</div>

        <div className="tenant-console-header__right">
          {user && (
            <>
              <div className="tenant-console-header__user">
                <UserOutlined className="tenant-console-header__user-icon" />
                <span className="tenant-console-header__username">
                  {(() => {
                    const full = String(user.fullName || '').trim();
                    const shouldUseUsername = !full || /\?/.test(full);
                    return shouldUseUsername ? user.username || '' : full;
                  })()}
                </span>
                {user.tenantName && (
                  <Tooltip title={`当前租户: ${user.tenantName}`}>
                    <Tag color="blue" className="tenant-console-header__tag">
                      <span className="tenant-console-header__tag-text">{user.tenantName}</span>
                    </Tag>
                  </Tooltip>
                )}
                {user.organizationName && (
                  <Tooltip title={`当前组织: ${user.organizationName}`}>
                    <Tag color="blue" className="tenant-console-header__tag">
                      <span className="tenant-console-header__tag-text">{user.organizationName}</span>
                    </Tag>
                  </Tooltip>
                )}
              </div>
              <Divider type="vertical" className="tenant-console-header__divider" />
              <Tooltip title="修改密码">
                <Button
                  type="text"
                  className="tenant-console-header__action-btn"
                  icon={<LockOutlined />}
                  onClick={openChangePassword}
                  aria-label="修改密码"
                />
              </Tooltip>
              <Button
                type="text"
                className="tenant-console-header__action-btn"
                icon={<ExportOutlined />}
                onClick={handleLogout}
                aria-label="退出登录"
              />
            </>
          )}
        </div>
      </div>
    </Header>
  );
};

export default TenantConsoleHeader;
