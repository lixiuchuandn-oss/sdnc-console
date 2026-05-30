import React, { useMemo } from 'react';
import { HomeOutlined } from '@ant-design/icons';
import { theme } from 'antd';
import { routeSpecs } from '../../routes/RouteSpec';
import { isSdnccPagePath } from '../../routes/adminRouteMatch';
import { iconOf } from '../../utils/iconOf';
import type { TableProps } from 'antd';

export function normalizePath(p: string): string {
  return String(p || '').replace(/\/+$/, '') || '/';
}

export function pathMatch(specPath: string, curPath: string): boolean {
  const a = normalizePath(specPath);
  const b = normalizePath(curPath);
  if (a === b) return true;
  const re = new RegExp('^' + a.replace(/:[^/]+/g, '[^/]+') + '$');
  return re.test(b);
}

export function findRouteSpec(p: string) {
  return routeSpecs.find((s) => pathMatch(s.path, p));
}

export function styledIcon(node: React.ReactNode, size: number, color: string) {
  return React.isValidElement(node)
    ? React.cloneElement(node as any, {
        style: {
          ...((node as any).props?.style || {}),
          fontSize: size,
          color,
          display: 'inline-block',
          verticalAlign: 'middle',
          lineHeight: 1,
        },
      })
    : node;
}

export function usePageRouteMeta(
  pathname: string,
  options: {
    title?: React.ReactNode;
    icon?: React.ReactNode;
    subtitle?: React.ReactNode;
    breadcrumb?: Array<{ label: React.ReactNode; href?: string }>;
    tableProps?: TableProps<any>;
  },
) {
  const { token } = theme.useToken();
  const { title, icon, subtitle, breadcrumb, tableProps } = options;

  const currentSpec = useMemo(() => findRouteSpec(pathname), [pathname]);

  const resolvedTableBordered = useMemo(() => {
    if (!tableProps) return undefined as boolean | undefined;
    if (tableProps.bordered !== undefined) return tableProps.bordered;
    return !isSdnccPagePath(pathname);
  }, [tableProps, pathname]);

  const autoCrumbs = useMemo(() => {
    if (breadcrumb) return breadcrumb;
    if (!currentSpec) return [{ label: <HomeOutlined />, href: '/' }];

    const lbl = currentSpec.breadcrumbLabel || currentSpec.title || currentSpec.id;
    const parent = currentSpec.parentId
      ? routeSpecs.find((s) => s.id === currentSpec.parentId)
      : undefined;

    const items: Array<{ label: React.ReactNode; href?: string }> = [
      { label: <HomeOutlined />, href: '/' },
    ];

    if (currentSpec.platform) items.push({ label: currentSpec.platform });
    if (currentSpec.group) items.push({ label: currentSpec.group });
    if (parent) {
      items.push({
        label: parent.breadcrumbLabel || parent.title || parent.id,
        href: parent.path,
      });
    }
    items.push({ label: lbl });

    return items;
  }, [currentSpec, breadcrumb]);

  const displayTitle = title || currentSpec?.title || currentSpec?.breadcrumbLabel || '';
  const displaySubtitle = subtitle || currentSpec?.subtitle || '';
  const displayIcon = icon || styledIcon(iconOf(currentSpec?.icon), 22, token.colorPrimary);

  return {
    autoCrumbs,
    displayTitle,
    displaySubtitle,
    displayIcon,
    resolvedTableBordered,
  };
}
