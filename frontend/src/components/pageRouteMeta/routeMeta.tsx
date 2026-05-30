import React, { useMemo } from 'react';
import { HomeOutlined } from '@ant-design/icons';
import { theme } from 'antd';
import type { TableProps } from 'antd';
import { routeSpecs } from '../../routes/RouteSpec';
import { isSdnccPagePath } from '../../routes/adminRouteMatch';
import { iconOf } from '../../utils/iconOf';

export type PageRouteCrumb = { label: React.ReactNode; href?: string };

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

export function buildAutoCrumbs(
  pathname: string,
  breadcrumb?: PageRouteCrumb[],
): PageRouteCrumb[] {
  if (breadcrumb) return breadcrumb;

  const currentSpec = findRouteSpec(pathname);
  if (!currentSpec) return [{ label: <HomeOutlined />, href: '/' }];

  const lbl = currentSpec.breadcrumbLabel || currentSpec.title || currentSpec.id;
  const parent = currentSpec.parentId
    ? routeSpecs.find((s) => s.id === currentSpec.parentId)
    : undefined;

  const items: PageRouteCrumb[] = [{ label: <HomeOutlined />, href: '/' }];

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
}

export function usePageRouteMeta(
  pathname: string,
  options: {
    title?: React.ReactNode;
    icon?: React.ReactNode;
    subtitle?: React.ReactNode;
    breadcrumb?: PageRouteCrumb[];
    tableProps?: TableProps<any>;
  } = {},
) {
  const { token } = theme.useToken();
  const { title, icon, subtitle, breadcrumb, tableProps } = options;

  const currentSpec = useMemo(() => findRouteSpec(pathname), [pathname]);

  const resolvedTableBordered = useMemo(() => {
    if (!tableProps) return undefined as boolean | undefined;
    if (tableProps.bordered !== undefined) return tableProps.bordered;
    return !isSdnccPagePath(pathname);
  }, [tableProps, pathname]);

  const autoCrumbs = useMemo(
    () => buildAutoCrumbs(pathname, breadcrumb),
    [pathname, breadcrumb],
  );

  const displayTitle = title ?? currentSpec?.title ?? currentSpec?.breadcrumbLabel ?? '';
  const displaySubtitle = subtitle ?? currentSpec?.subtitle;
  const displayIcon = styledIcon(icon ?? iconOf(currentSpec?.icon), 22, token.colorPrimary);

  return {
    currentSpec,
    autoCrumbs,
    displayTitle,
    displaySubtitle,
    displayIcon,
    resolvedTableBordered,
  };
}
