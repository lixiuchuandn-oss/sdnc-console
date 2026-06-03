import React from 'react';
import { Layout, Menu } from 'antd';
import type { MenuProps } from 'antd';

const { Sider } = Layout;
const SIDEBAR_COLLAPSED_WIDTH = 64;

/**
 * 侧栏菜单项（antd Menu 项的结构化子集）：仅声明本组件读写的字段，
 * 其余 antd 透传字段以索引签名兜底，避免回退到 `any`。
 */
export type AdminMenuItem = {
  key?: React.Key;
  label?: React.ReactNode;
  icon?: React.ReactNode;
  children?: AdminMenuItem[];
  [extra: string]: unknown;
};

/** 保留一级菜单 icon；子级（二级及以下）去掉 icon，避免与分组标题重复堆叠。 */
function menuItemsForSidebar(items: AdminMenuItem[] | undefined): AdminMenuItem[] {
  if (!items?.length) return [];
  const stripChildIcons = (nodes: AdminMenuItem[]): AdminMenuItem[] =>
    nodes.map((node) => {
      if (node.type === 'divider') return node;
      const { icon: _omitIcon, ...rest } = node;
      if (rest.children?.length) {
        return { ...rest, children: stripChildIcons(rest.children) };
      }
      return rest;
    });
  return items.map((item) => {
    if (!item?.children?.length) return item;
    return {
      ...item,
      children: stripChildIcons(item.children),
    };
  });
}

export type AdminSidebarCenter = {
  key: string;
  label: string;
  items: AdminMenuItem[];
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
  /** antd Menu `mode`；默认 `inline`（侧栏内展开子菜单） */
  menuMode?: 'inline' | 'vertical';
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
  menuMode = 'inline',
}) => {
  const center = visibleCenters.find((c) => c.key === activeSidebarKey) || visibleCenters[0];
  if (!center) return null;
  const isVerticalMenu = menuMode === 'vertical';

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
          mode={menuMode}
          theme="light"
          style={{
            flex: 1,
            minHeight: 0,
            minWidth: 0,
            height: '100%',
            borderRight: 0,
            overflowX: isVerticalMenu ? 'visible' : 'hidden',
            overflowY: isVerticalMenu || collapsed ? 'visible' : 'auto',
          }}
          items={menuItemsForSidebar(center.items) as MenuProps['items']}
          selectedKeys={[selectedMenuKey ?? selectedPathname]}
          openKeys={collapsed ? undefined : openKeys}
          inlineCollapsed={!isVerticalMenu && collapsed}
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
