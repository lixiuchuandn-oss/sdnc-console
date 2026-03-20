import React from 'react';
import { Layout, Menu, Button, Typography } from 'antd';
import { MenuUnfoldOutlined, MenuFoldOutlined } from '@ant-design/icons';

const { Sider } = Layout;

type MenuItem = any;

export type AdminSidebarCenter = {
  key: string;
  label: string;
  items: MenuItem[];
};

type Props = {
  collapsed: boolean;
  onCollapse: (nextCollapsed: boolean) => void;
  openKeys: string[];
  setOpenKeys: React.Dispatch<React.SetStateAction<string[]>>;
  activeSidebarKey: string;
  visibleCenters: AdminSidebarCenter[];
  selectedPathname: string; // location.pathname (不要带 query)
  navigate: (path: string) => void;
  isProConsole: boolean;
  dividerColor: string;
};

const AdminSidebar: React.FC<Props> = ({
  collapsed,
  onCollapse,
  openKeys,
  setOpenKeys,
  activeSidebarKey,
  visibleCenters,
  selectedPathname,
  navigate,
  isProConsole,
  dividerColor,
}) => {
  const center = visibleCenters.find(c => c.key === activeSidebarKey) || visibleCenters[0];
  if (!center) return null;

  return (
    <Sider
      collapsible
      collapsed={collapsed}
      trigger={null}
      onCollapse={(nextCollapsed) => {
        onCollapse(nextCollapsed);
        if (nextCollapsed) setOpenKeys([]);
      }}
      className="admin-sidebar"
      style={{
        background: 'transparent',
        borderRight: '1px solid ' + dividerColor,
        position: 'sticky',
        top: isProConsole ? 50 : 64,
        height: `calc(100vh - ${isProConsole ? 50 : 64}px)`,
        transition: 'all 200ms ease',
      }}
    >
      <div
        className="admin-sidebar-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'space-between',
          padding: '12px',
          borderBottom: '1px solid ' + dividerColor,
          background: '#F9F9FA',
        }}
      >
        {!collapsed && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Typography.Text style={{ fontSize: 14, fontWeight: 500 }}>{center.label}</Typography.Text>
          </div>
        )}
        <Button
          type="text"
          icon={collapsed ? <MenuUnfoldOutlined style={{ fontSize: 16 }} /> : <MenuFoldOutlined style={{ fontSize: 16 }} />}
          onClick={() => {
            const nextCollapsed = !collapsed;
            onCollapse(nextCollapsed);
            if (nextCollapsed) setOpenKeys([]);
          }}
          style={{
            height: 28,
            width: 28,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        />
      </div>

      <Menu
        mode="inline"
        theme="light"
        className="admin-sidebar-menu"
        style={{
          height: 'calc(100% - 56px)',
          borderRight: '0',
          overflow: collapsed ? 'visible' : 'auto',
          background: '#ffffff',
        }}
        items={center.items || []}
        selectedKeys={[selectedPathname]}
        openKeys={collapsed ? undefined : openKeys}
        inlineCollapsed={collapsed}
        onClick={({ key }) => {
          if (typeof key === 'string' && key.startsWith('/')) navigate(key);
        }}
        onOpenChange={(keys) => {
          if (!collapsed) setOpenKeys(keys as string[]);
        }}
      />
    </Sider>
  );
};

export default AdminSidebar;

