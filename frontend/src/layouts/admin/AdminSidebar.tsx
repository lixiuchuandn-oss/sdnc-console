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
  /** 无 query 的路径，用于非资源池页等 */
  selectedPathname: string;
  /** 资源池详情等：带 `?tab=` 的完整 key，与 Menu item.key 一致 */
  selectedMenuKey?: string;
  navigate: (path: string) => void;
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
  selectedMenuKey,
  navigate,
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
        background: '#F9F9FA',
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
          background: '#F9F9FA',
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
          selectedKeys={[selectedMenuKey ?? selectedPathname]}
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
