import React from 'react';
import { Layout, Menu } from 'antd';

const { Sider } = Layout;
const SIDEBAR_COLLAPSED_WIDTH = 64;

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
  dividerColor: string;
  /** 与顶栏高度一致，用于 sticky top 与侧栏可视高度 */
  headerOffsetPx?: number;
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
  dividerColor,
  headerOffsetPx = 64,
}) => {
  const center = visibleCenters.find((c) => c.key === activeSidebarKey) || visibleCenters[0];
  if (!center) return null;

  return (
    <Sider
      theme="light"
      collapsible
      collapsed={collapsed}
      collapsedWidth={SIDEBAR_COLLAPSED_WIDTH}
      onCollapse={(nextCollapsed) => {
        onCollapse(nextCollapsed);
        if (nextCollapsed) setOpenKeys([]);
      }}
      className="admin-sidebar"
      style={{
        background: 'transparent',
        borderRight: '1px solid ' + dividerColor,
        position: 'sticky',
        top: headerOffsetPx,
        height: `calc(100vh - ${headerOffsetPx}px)`,
      }}
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
          mode="inline"
          theme="light"
          style={{
            flex: 1,
            minHeight: 0,
            minWidth: 0,
            height: '100%',
            borderRight: 0,
            overflowX: 'hidden',
            overflowY: collapsed ? 'visible' : 'auto',
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
      </div>
    </Sider>
  );
};

export default AdminSidebar;
