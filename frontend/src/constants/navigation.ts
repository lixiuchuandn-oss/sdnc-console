/**
 * SDNC 导航：平台与侧栏分组排序（与 RouteSpec.platform / group 对齐）。
 */

export type Platform = 'SDNCC' | 'SETTINGS' | '全部';

export type Group =
  | '权限管控'
  | 'IBR管理'
  | '通用设置'
  | '操作审计'
  | '高级集成'
  | '版本升级'
  | '全部';

export const PLATFORMS: Platform[] = ['全部', 'SDNCC', 'SETTINGS'];

export const PLATFORM_LABELS: Record<Platform, string> = {
  SDNCC: 'IBR 控制台',
  SETTINGS: '系统设置',
  全部: '全部',
};

export const GROUPS: Group[] = [
  '全部',
  '权限管控',
  'IBR管理',
  '通用设置',
  '操作审计',
  '高级集成',
  '版本升级',
];
