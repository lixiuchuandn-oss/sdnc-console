import type React from 'react';
import type { TableProps } from 'antd';

/** PageContainer 组件的属性接口 */
export interface PageContainerProps<T = any> {
  className?: string;
  style?: React.CSSProperties;

  title?: React.ReactNode;
  icon?: React.ReactNode;
  breadcrumb?: Array<{ label: React.ReactNode; href?: string }>;
  extra?: React.ReactNode;
  headerTrailing?: React.ReactNode;
  subtitle?: React.ReactNode;
  titleLevel?: 1 | 2 | 3 | 4 | 5;
  hideHeader?: boolean;
  onBack?: () => void;

  children?: React.ReactNode;
  collapsibleChildren?: React.ReactNode;
  asCard?: boolean;
  pagePadding?: number | string;
  contentPadding?: number | string;
  bordered?: boolean;
  elevated?: boolean;

  toolbarLeft?: React.ReactNode;
  toolbarRight?: React.ReactNode;
  toolbarGapLeft?: number;
  toolbarGapRight?: number;
  toolbarStyle?: React.CSSProperties;
  toolbarSticky?: boolean;

  primaryAction?: {
    text: string;
    onClick: () => void;
    disabled?: boolean;
    type?: 'primary' | 'default';
    icon?: React.ReactNode;
  };
  secondaryActions?: React.ReactNode;
  moreMenuItems?: Array<{
    key: string;
    label: React.ReactNode;
    danger?: boolean;
    disabled?: boolean;
    onClick?: () => void;
  }>;
  actionsSize?: 'small' | 'middle' | 'large';
  onRefresh?: (force?: boolean) => void;

  tableProps?: TableProps<T>;
  defaultHiddenColumns?: string[];
  externalColumnControl?: boolean;

  tabList?: Array<{ key: string; tab: React.ReactNode }>;
  tabActiveKey?: string;
  onTabChange?: (key: string) => void;
  tabBarExtraContent?: React.ReactNode;

  hideDivider?: boolean;
}
