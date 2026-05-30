import React from 'react';
import { DesktopOutlined } from '@ant-design/icons';
import { Layout, Menu } from 'antd';
import { useSettings } from '../../contexts/SettingsContext';
import { renderMarkdownBold } from '../../utils/markdown';
import { useTenantConsoleSider } from './TenantConsoleSiderContext';

const { Sider } = Layout;

export const TENANT_SIDER_WIDTH_PX = 200;
export const TENANT_SIDER_COLLAPSED_WIDTH_PX = 64;

type TenantConsoleSiderProps = {
  collapsed: boolean;
};

export function TenantConsoleSiderBrand({ collapsed }: { collapsed: boolean }) {
  const { settings, loading: settingsLoading } = useSettings();
  const headerTitle = settingsLoading ? '' : String(settings.headerTitle ?? '');

  return (
    <div className={`tenant-console-sider-brand${collapsed ? ' tenant-console-sider-brand--collapsed' : ''}`}>
      {settings.headerIcon ? (
        <img src={settings.headerIcon} alt="Logo" className="tenant-console-sider-brand__logo" />
      ) : (
        <DesktopOutlined className="tenant-console-sider-brand__icon" />
      )}
      {!collapsed && (
        <span className="tenant-console-sider-brand__title">{renderMarkdownBold(headerTitle)}</span>
      )}
    </div>
  );
}

const TenantConsoleSider: React.FC<TenantConsoleSiderProps> = ({ collapsed }) => {
  const { model } = useTenantConsoleSider();

  if (!model) return null;

  return (
    <Sider
      className="tenant-console-sider"
      theme="dark"
      width={model.width ?? TENANT_SIDER_WIDTH_PX}
      collapsedWidth={TENANT_SIDER_COLLAPSED_WIDTH_PX}
      collapsible
      trigger={null}
      collapsed={collapsed}
      style={{ flexShrink: 0 }}
    >
      <TenantConsoleSiderBrand collapsed={collapsed} />
      <Menu
        theme="dark"
        mode="inline"
        selectedKeys={model.selectedKeys}
        items={model.items}
        onClick={model.onClick}
        inlineCollapsed={collapsed}
        className="tenant-console-sider-menu"
      />
    </Sider>
  );
};

export default TenantConsoleSider;
