import React from 'react';
import { Button, Divider, Layout, Tag, Tooltip } from 'antd';
import { useNavigate } from 'react-router-dom';
import { DesktopOutlined, ExportOutlined, LockOutlined, UserOutlined } from '@ant-design/icons';
import { useAuth } from '../../contexts/AuthContext';
import { useSettings } from '../../contexts/SettingsContext';
import { useTenantConsoleHeaderSlot } from '../../contexts/TenantConsoleHeaderSlotContext';
import { renderMarkdownBold } from '../../utils/markdown';

const { Header } = Layout;

const TENANT_HEADER_BG = '#001529';
const TENANT_HEADER_FG = 'rgba(255,255,255,0.85)';

export const TENANT_CONSOLE_HEADER_HEIGHT_PX = 50;

const TenantConsoleHeader: React.FC<{
  openChangePassword: () => void;
}> = ({ openChangePassword }) => {
  const navigate = useNavigate();
  const { settings, loading: settingsLoading } = useSettings();
  const { user, logout } = useAuth();
  const { centerSlot } = useTenantConsoleHeaderSlot();
  const headerTitle = settingsLoading ? '' : String(settings.headerTitle ?? '');

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <Header
      style={{
        background: TENANT_HEADER_BG,
        color: TENANT_HEADER_FG,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 20px',
        position: 'sticky',
        top: 0,
        zIndex: 1000,
        height: TENANT_CONSOLE_HEADER_HEIGHT_PX,
        boxShadow: '0 2px 8px rgba(0,0,0,0.28)',
        borderBottom: '1px solid rgba(255,255,255,0.12)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: '100%', flexShrink: 0 }}>
        {settings.headerIcon ? (
          <img src={settings.headerIcon} alt="Logo" style={{ height: 28, width: 'auto', display: 'block' }} />
        ) : (
          <DesktopOutlined style={{ color: TENANT_HEADER_FG, fontSize: 18 }} />
        )}
        <span
          style={{
            fontSize: 14,
            lineHeight: '14px',
            display: 'flex',
            alignItems: 'center',
            color: TENANT_HEADER_FG,
          }}
        >
          {renderMarkdownBold(headerTitle)}
        </span>
      </div>

      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          justifyContent: 'flex-start',
          alignItems: 'center',
          padding: centerSlot ? '0 12px 0 0' : '0 12px',
          marginLeft: centerSlot ? 12 : 0,
        }}
      >
        {centerSlot}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16, height: '100%', flexShrink: 0 }}>
        {user && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'nowrap', whiteSpace: 'nowrap' }}>
              <UserOutlined style={{ fontSize: 16, color: TENANT_HEADER_FG }} />
              <span
                style={{
                  fontSize: 14,
                  maxWidth: 160,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  color: TENANT_HEADER_FG,
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
                    style={{
                      margin: 0,
                      fontSize: 11,
                      lineHeight: '20px',
                      padding: '0 8px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      borderRadius: 4,
                      background: 'rgba(255, 255, 255, 0.08)',
                      color: TENANT_HEADER_FG,
                      border: '1px solid rgba(125, 178, 255, 0.42)',
                    }}
                  >
                    <span
                      style={{
                        maxWidth: 140,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {user.tenantName}
                    </span>
                  </Tag>
                </Tooltip>
              )}

              {user.organizationName && (
                <Tooltip title={`当前组织: ${user.organizationName}`}>
                  <Tag
                    bordered={false}
                    style={{
                      margin: 0,
                      fontSize: 11,
                      lineHeight: '20px',
                      padding: '0 8px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      borderRadius: 4,
                      background: 'rgba(255, 255, 255, 0.08)',
                      color: TENANT_HEADER_FG,
                      border: '1px solid rgba(255, 214, 140, 0.4)',
                    }}
                  >
                    <span
                      style={{
                        maxWidth: 160,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {user.organizationName}
                    </span>
                  </Tag>
                </Tooltip>
              )}
            </div>

            <Divider type="vertical" style={{ height: 24, margin: 0, borderColor: 'rgba(255,255,255,0.35)' }} />

            <Tooltip title="修改密码">
              <Button
                type="text"
                className="tenant-console-header-action-btn"
                icon={<LockOutlined style={{ color: TENANT_HEADER_FG, fontSize: 16 }} />}
                onClick={openChangePassword}
                aria-label="修改密码"
              />
            </Tooltip>

            <Button
              type="text"
              className="tenant-console-header-action-btn"
              icon={<ExportOutlined style={{ color: TENANT_HEADER_FG, fontSize: 16 }} />}
              onClick={handleLogout}
              aria-label="退出登录"
            />
          </div>
        )}
      </div>
    </Header>
  );
};

export default TenantConsoleHeader;
