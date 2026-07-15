import type { ReactNode } from 'react';
import type { AdminSidebarCenter } from '../AdminSidebar';
import type { PageSearchEntry } from './adminLayoutNav';

/** 从已过滤的平台菜单生成 Ctrl+K / 顶栏搜索的数据源 */
export function buildPageSearchEntries(visibleCenters: AdminSidebarCenter[]): PageSearchEntry[] {
  const opts: PageSearchEntry[] = [];

  const push = (
    path: string,
    label: string,
    icon: ReactNode,
    group: string,
    title: string,
  ) => {
    if (path && path.startsWith('/')) {
      opts.push({ path, title, icon, label, group });
    }
  };

  visibleCenters.forEach((c) => {
    if (c.key === '/admin/cen_settings') {
      (c.items || []).forEach((it) => {
        push(
          String(it.key || ''),
          String(it.label || ''),
          it.icon,
          String(c.label || ''),
          `${String(it.label || '')} ${String(c.label || '')}`,
        );
      });
      return;
    }

    (c.items || []).forEach((p) => {
      push(
        String(p.key || ''),
        String(p.label || ''),
        p.icon,
        String(c.label || ''),
        `${String(p.label || '')} ${String(c.label || '')}`,
      );
    });
  });

  return opts;
}
