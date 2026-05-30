/**
 * 租户云资源控制台 — 独立 Layout（深色顶栏 + 全宽内容区），与 AdminLayout 分离。
 * 样式：`tenant-console-shell.css`。侧栏状态见 `TenantConsoleSiderContext.tsx`。
 */
import React, { useState } from 'react';
import { Layout, Menu } from 'antd';
import { Outlet } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import ChangePasswordModal from '../shared/ChangePasswordModal';
import { useChangePasswordGate } from '../shared/hooks/useChangePasswordGate';
import './tenant-console-shell.css';
import { TenantConsoleHeaderSlotProvider } from '../../contexts/TenantConsoleHeaderSlotContext';
import { TenantConsoleSiderProvider, useTenantConsoleSider } from './TenantConsoleSiderContext';
import TenantConsoleHeader from './TenantConsoleHeader';

const { Content, Sider } = Layout;

const TENANT_SIDER_COLLAPSED_WIDTH = 64;

const TenantConsoleProductSider: React.FC = () => {
  const { model } = useTenantConsoleSider();
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
  const { user } = useAuth();
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

  return (
    <TenantConsoleHeaderSlotProvider>
      <TenantConsoleSiderProvider>
        <Layout style={{ height: '100vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <TenantConsoleHeader openChangePassword={openChangePassword} />
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
          <Layout style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
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
