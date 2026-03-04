/**
 * 监控告警全局常量：告警等级颜色等，供告警列表、告警规则、概览告警卡片等统一使用。
 */
export const CRITICAL_COLOR = '#FF5C7C';
export const WARNING_COLOR = '#f59e0b';

/** 告警级别下拉选项（严重 / 警告） */
export const LEVEL_OPTIONS = [
  { label: '紧急告警', value: 'critical' },
  { label: '普通告警', value: 'warning' },
];

/** 告警列表级别筛选下拉选项（含「全部」） */
export const LEVEL_FILTER_OPTIONS = [
  { label: '全部', value: '' },
  ...LEVEL_OPTIONS,
];
