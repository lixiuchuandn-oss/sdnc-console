import type React from 'react';
import type { ColumnOption } from '../SharedToolbar';

export type PageDetailSectionProps = {
  title?: React.ReactNode;
  icon?: React.ReactNode;
  extra?: React.ReactNode;
  actions?: Array<{
    key: string;
    icon?: React.ReactNode;
    text?: React.ReactNode;
    onClick?: () => void;
    loading?: boolean;
    disabled?: boolean;
    tooltip?: React.ReactNode;
  }>;
  moreMenuItems?: Array<{
    key: string;
    label: React.ReactNode;
    danger?: boolean;
    disabled?: boolean;
    onClick?: () => void;
  }>;
  onMoreMenuClick?: (info: { key: string }) => void;
  moreIcon?: React.ReactNode;
  toolbarLeft?: React.ReactNode;
  toolbarRight?: React.ReactNode;
  toolbarGapLeft?: number;
  toolbarGapRight?: number;
  toolbarStyle?: React.CSSProperties;
  children?: React.ReactNode;
  bordered?: boolean;
  elevated?: boolean;
  contentPadding?: number | string;
  titleLevel?: 1 | 2 | 3 | 4 | 5;
  asCard?: boolean;
  style?: React.CSSProperties;
  contentStyle?: React.CSSProperties;
  autoStyleInputs?: boolean;
  keywordWidth?: number;
  selectWidth?: number;
  inputSize?: 'small' | 'middle' | 'large';
  showHeaderTitle?: boolean;
  onRefresh?: (force?: boolean) => void;
  refreshLoading?: boolean;
  columnsConfig?: {
    value: string[];
    options: ColumnOption[];
    onChange: (values: string[]) => void;
    tooltip?: React.ReactNode;
  };
  primaryAction?: {
    label: React.ReactNode;
    onClick: () => void;
    disabled?: boolean;
    loading?: boolean;
    danger?: boolean;
    tooltip?: React.ReactNode;
  };
  batchActions?: {
    items: any[];
    onMenuClick?: (key: string) => void;
    disabled?: boolean;
    tooltip?: React.ReactNode;
  };
};
