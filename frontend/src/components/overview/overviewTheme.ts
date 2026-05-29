/**
 * 概览类页面统一设计 token（阿里云 / 华为云 / MAAS / Xinference 等总览复用）
 *
 * 目的：四个云总览页面（及其它概览页）共用同一套配色、风险色与标题图标样式，
 * 避免各页内联 tailwind 色板 / TwoTone / 裸 #1677ff 造成的视觉割裂。
 * 卡片外壳、KPI 排版、状态条样式仍以 components/overview/overview.css 为准。
 */
import React from 'react';

/** 概览页统一调色板（主色采用 antd 主题蓝，语义色采用 antd 语义色） */
export const OVERVIEW_COLORS = {
  /** 主色：标题图标、主要数值、强调进度 */
  primary: '#1677ff',
  /** 成功 / 健康 / 可用 */
  success: '#52c41a',
  /** 警告 / 进行中 */
  warning: '#faad14',
  /** 异常 / 危险 */
  error: '#ff4d4f',
  /** 中性灰（次要分隔、占位） */
  neutral: '#8c8c8c',
  /** 次要文字（卡片 extra、脚注） */
  textSecondary: 'rgba(0, 0, 0, 0.45)',
  /** 内嵌指标小块背景 */
  tileBg: '#f7f9fc',
  /** 内嵌指标小块边框 */
  tileBorder: '#eef2f7',
  /** 进度条 / 状态条轨道背景 */
  trackBg: '#f0f0f0',
  /** 行内分隔线 */
  splitLine: '#f0f0f0',
} as const;

/** 概览标题区图标统一字号（与 overview.css `.overview-card-title-icon` 对齐） */
export const OVERVIEW_TITLE_ICON_SIZE = 20;

/**
 * 利用率风险色：≥90% 红、≥70% 橙、否则绿。
 * 统一采用 antd 语义色，替代各页自定义 tailwind 色值，保证全站一致。
 */
export function overviewRiskColor(percent: number): string {
  if (percent >= 90) return OVERVIEW_COLORS.error;
  if (percent >= 70) return OVERVIEW_COLORS.warning;
  return OVERVIEW_COLORS.success;
}

/**
 * 统一概览卡片标题图标：补充主题色与字号。
 * 调用方传入裸图标元素（如 `<ClusterOutlined />`）即可获得一致着色。
 * @param node  图标元素
 * @param color 覆盖颜色（默认主题蓝；如未连接态可传中性灰）
 */
export function overviewTitleIcon(
  node: React.ReactNode,
  color: string = OVERVIEW_COLORS.primary,
): React.ReactNode {
  if (!React.isValidElement(node)) return node;
  const prev = (node.props as { style?: React.CSSProperties })?.style || {};
  return React.cloneElement(node as React.ReactElement, {
    style: { fontSize: OVERVIEW_TITLE_ICON_SIZE, color, ...prev },
  });
}
