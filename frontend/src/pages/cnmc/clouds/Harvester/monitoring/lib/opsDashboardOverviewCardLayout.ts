/** 运维监控大盘 · 概览卡片（集群资源 / 云主机分布）统一布局 token */
import type React from 'react';

export const OPS_OVERVIEW_RING_SIZE = 150;
export const OPS_OVERVIEW_BODY_GAP = 24;
export const OPS_OVERVIEW_BODY_MIN_HEIGHT = 120;

export const OPS_OVERVIEW_TITLE_FONT = 15;
export const OPS_OVERVIEW_EXTRA_FONT = 14;
export const OPS_OVERVIEW_LIST_LABEL_FONT = 14;
export const OPS_OVERVIEW_LIST_VALUE_FONT = 14;
export const OPS_OVERVIEW_LIST_SUB_FONT = 12;
export const OPS_OVERVIEW_CENTER_MAIN_FONT = 18;
export const OPS_OVERVIEW_CENTER_SUB_FONT = 12;
export const OPS_OVERVIEW_DOT_SIZE = 8;

export function opsOverviewUsageColor(percent: number): string {
  if (percent >= 90) return '#ef4444';
  if (percent >= 70) return '#f59e0b';
  return '#22C55E';
}

export const OPS_OVERVIEW_CARD_BODY_STYLE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minHeight: 0,
  padding: '12px 16px 16px',
};

export const OPS_OVERVIEW_CARD_STYLE: React.CSSProperties = {
  width: '100%',
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
};

export const OPS_OVERVIEW_CARD_HEADER_STYLE = {
  padding: '12px 16px',
  minHeight: 48,
};
