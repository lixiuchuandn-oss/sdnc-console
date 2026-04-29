/**
 * 租户云资源控制台 — 独立 Layout（深色顶栏 + 全宽内容区），与 AdminLayout 分离。
 * 样式：`tenant-console-shell.css`。侧栏状态见 `TenantConsoleSiderContext.tsx`。
 */
import React, { useEffect, useState } from 'react';
import { Layout, Menu, Button, Divider, Tag, App, Tooltip, Modal, Form, Input } from 'antd';
import { Outlet, useNavigate } from 'react-router-dom';
import { DesktopOutlined, UserOutlined, ExportOutlined, LockOutlined } from '@ant-design/icons';
import { useAuth } from '../../contexts/AuthContext';
import { useSettings } from '../../contexts/SettingsContext';
import { apiPost } from '../../services/api';
import { getPublicAdminPasswordPolicy } from '../../services/systemApi';
import { validateAdminPasswordClient, type AdminPasswordPolicy } from '../../utils/adminPasswordPolicy';
import { renderMarkdownBold } from '../../utils/markdown';
import './tenant-console-shell.css';
import {
  TenantConsoleHeaderSlotProvider,
  useTenantConsoleHeaderSlot,
} from '../../contexts/TenantConsoleHeaderSlotContext';
import { TenantConsoleSiderProvider, useTenantConsoleSider } from './TenantConsoleSiderContext';

const { Header, Content, Sider } = Layout;

const TENANT_SIDER_COLLAPSED_WIDTH = 64;

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
    navigate('/admin/login');
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
                    <span style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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

/** light Sider + inline Menu，antd 自带底部折叠条（与管理端一致） */
const TenantConsoleProductSider: React.FC = () => {
  const { model } = useTenantConsoleSider();
  /** 默认展开侧栏（false = 未折叠）；用户可用底部收起按钮收起 */
  const [tenantSiderCollapsed, setTenantSiderCollapsed] = useState(false);

  if (!model) return null;

  return (
    <Sider
      theme="light"
      width={model.width ?? 200}
      collapsible
      collapsed={tenantSiderCollapsed}
      collapsedWidth={TENANT_SIDER_COLLAPSED_WIDTH}
      onCollapse={setTenantSiderCollapsed}
      style={{ flexShrink: 0 }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          minHeight: 0,
          minWidth: 0,
          overflowX: 'hidden',
        }}
      >
        <Menu
          theme="light"
          mode="inline"
          selectedKeys={model.selectedKeys}
          items={model.items}
          onClick={model.onClick}
          inlineCollapsed={tenantSiderCollapsed}
          style={{
            flex: 1,
            minHeight: 0,
            minWidth: 0,
            height: '100%',
            borderRight: 0,
            overflowX: 'hidden',
            overflowY: tenantSiderCollapsed ? 'visible' : 'auto',
          }}
        />
      </div>
    </Sider>
  );
};

const TenantConsoleLayout: React.FC = () => {
  const { user, refreshUser } = useAuth();
  const { message } = App.useApp();
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [changePasswordSaving, setChangePasswordSaving] = useState(false);
  const [changePasswordForm] = Form.useForm();
  const [adminPwdPolicy, setAdminPwdPolicy] = useState<AdminPasswordPolicy | null>(null);

  const forcePasswordChange = user?.mustChangePassword === true;

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

  return (
    <TenantConsoleHeaderSlotProvider>
      <TenantConsoleSiderProvider>
        <Layout style={{ height: '100vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <TenantConsoleHeader openChangePassword={openChangePassword} />
          <Modal
            title={forcePasswordChange ? '密码已过期，请修改密码' : '修改密码'}
            open={changePasswordOpen}
            centered
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
          <Layout
            style={{
              flex: 1,
              minHeight: 0,
              overflow: 'hidden',
            }}
          >
            <TenantConsoleProductSider />
            <Content
              style={{
                flex: 1,
                minWidth: 0,
                background: '#fff',
                overflow: 'auto',
              }}
            >
              <Outlet />
            </Content>
          </Layout>
        </Layout>
      </TenantConsoleSiderProvider>
    </TenantConsoleHeaderSlotProvider>
  );
};

export default TenantConsoleLayout;
