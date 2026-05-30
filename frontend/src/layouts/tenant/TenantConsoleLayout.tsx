/**
 * 租户云资源控制台 — Ant Design Layout Demo 风格：
 * 深色全高 Sider（Logo + Menu）+ 浅色顶栏（折叠 / 插槽 / 用户）+ 卡片化 Content。
 */
import React, { useState } from 'react';
import { Layout, theme } from 'antd';
import { Outlet } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import ChangePasswordModal from '../shared/ChangePasswordModal';
import { useChangePasswordGate } from '../shared/hooks/useChangePasswordGate';
import './tenant-console-shell.css';
import { TenantConsoleHeaderSlotProvider } from '../../contexts/TenantConsoleHeaderSlotContext';
import { TenantConsoleSiderProvider, useTenantConsoleSider } from './TenantConsoleSiderContext';
import TenantConsoleHeader from './TenantConsoleHeader';
import TenantConsoleSider from './TenantConsoleSider';

const { Content } = Layout;

function TenantConsoleLayoutFrame() {
  const { user } = useAuth();
  const { model } = useTenantConsoleSider();
  const [collapsed, setCollapsed] = useState(false);
  const {
    token: { colorBgContainer, colorBgLayout, borderRadiusLG },
  } = theme.useToken();

  const {
    changePasswordForm,
    changePasswordOpen,
    setChangePasswordOpen,
    changePasswordSaving,
    adminPwdPolicy,
    forcePasswordChange,
    openChangePassword,
    submitChangePassword,
  } = useChangePasswordGate('tenant');

  const showSider = !!model;

  return (
    <Layout className="tenant-console-root" style={{ minHeight: '100vh' }}>
      {showSider && <TenantConsoleSider collapsed={collapsed} />}
      <Layout
        className="tenant-console-main"
        style={{ flex: 1, minWidth: 0, minHeight: 0, background: colorBgLayout }}
      >
        <TenantConsoleHeader
          openChangePassword={openChangePassword}
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed((v) => !v)}
          showCollapseToggle={showSider}
        />
        <ChangePasswordModal
          open={changePasswordOpen}
          forcePasswordChange={forcePasswordChange}
          saving={changePasswordSaving}
          form={changePasswordForm}
          policy={adminPwdPolicy}
          username={user?.username}
          onOk={submitChangePassword}
          onClose={() => setChangePasswordOpen(false)}
        />
        <Content
          className="tenant-console-content"
          style={{
            margin: '24px 16px',
            padding: 0,
            minHeight: 280,
            flex: 1,
            minWidth: 0,
            overflow: 'auto',
            background: colorBgContainer,
            borderRadius: borderRadiusLG,
          }}
        >
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}

const TenantConsoleLayout: React.FC = () => (
  <TenantConsoleHeaderSlotProvider>
    <TenantConsoleSiderProvider>
      <TenantConsoleLayoutFrame />
    </TenantConsoleSiderProvider>
  </TenantConsoleHeaderSlotProvider>
);

export default TenantConsoleLayout;
