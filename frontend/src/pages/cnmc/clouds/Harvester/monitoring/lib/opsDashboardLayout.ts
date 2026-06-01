import type { CSSProperties } from 'react';

/** 首行工具栏与下方卡片/图表区之间的纵向间距（运维监控、运维告警一致） */
export const OPS_DASHBOARD_PAGE_STACK_GAP = 16;

/** 首行：左侧视图 Tag + 右侧操作按钮 */
export const OPS_DASHBOARD_TOOLBAR_ROW_STYLE: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 12,
  flexWrap: 'wrap',
};

/** 首行内 Tag 组、DashboardToolbar 内按钮组间距 */
export const OPS_DASHBOARD_TOOLBAR_SPACE_SIZE = 8;

export const opsDashboardTagStyle = (active: boolean): CSSProperties => ({
  padding: '4px 12px',
  fontSize: 14,
  borderRadius: 16,
  border: active ? undefined : '1px solid #d9d9d9',
  cursor: 'pointer',
  userSelect: 'none',
});

/**
 * 云监控页根节点：不在 `.cloudmap-detail-main` 的 24px padding 内再嵌纵向滚动。
 * 纵向滚动由 `PoolDetailPage` → `PageDetailContainer` 的 `contentWrapper` 统一承载（滚动条贴主内容区右缘）。
 */
export const OPS_DASHBOARD_PAGE_ROOT_STYLE: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
};

/** @deprecated 使用 OPS_DASHBOARD_PAGE_ROOT_STYLE；勿在池内页再设 overflowY:auto + maxHeight */
export const OPS_DASHBOARD_PAGE_SCROLL_STYLE = OPS_DASHBOARD_PAGE_ROOT_STYLE;
