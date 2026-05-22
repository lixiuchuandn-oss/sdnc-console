/**
 * 同机 Dify 控制台入口（路径仍对齐 Dify 1.14）。
 * 侧栏/页面标题命名与 Xinference 域一致。
 */
export const XINFERENCE_INFERENCE_TAB_KEYS = [
  'dashboard',
  'monitoring',
  'model_gallery',
  'model_register',
  'running_models',
] as const;

export const XINFERENCE_DIFY_TAB_KEYS = [
  'dify_apps',
  'dify_datasets',
  'dify_tools',
  'dify_plugins',
  'dify_settings',
  'dify_data_source',
] as const;

export type XinferenceInferenceTabKey = (typeof XINFERENCE_INFERENCE_TAB_KEYS)[number];
export type XinferenceDifyTabKey = (typeof XINFERENCE_DIFY_TAB_KEYS)[number];

export const XINFERENCE_POOL_TAB_KEYS = [
  ...XINFERENCE_INFERENCE_TAB_KEYS,
  ...XINFERENCE_DIFY_TAB_KEYS,
] as const;

export type XinferencePoolTabKey = (typeof XINFERENCE_POOL_TAB_KEYS)[number];

export type DifyConsoleNavEntry = {
  tab: XinferenceDifyTabKey;
  label: string;
  returnPath: string;
};

export const DIFY_CONSOLE_NAV_ENTRIES: DifyConsoleNavEntry[] = [
  { tab: 'dify_apps', label: '应用编排', returnPath: '/apps' },
  { tab: 'dify_datasets', label: '知识库', returnPath: '/datasets' },
  { tab: 'dify_tools', label: '工具中心', returnPath: '/tools' },
  { tab: 'dify_plugins', label: '插件中心', returnPath: '/plugins' },
  {
    tab: 'dify_settings',
    label: '大模型设置',
    returnPath: '/apps?action=showSettings&tab=provider',
  },
  {
    tab: 'dify_data_source',
    label: '数据源设置',
    returnPath: '/apps?action=showSettings&tab=data-source',
  },
];

export function isXinferenceDifyTab(tab: string | null | undefined): tab is XinferenceDifyTabKey {
  return (XINFERENCE_DIFY_TAB_KEYS as readonly string[]).includes(String(tab || '').trim());
}

export function getDifyTabLabel(tab: XinferenceDifyTabKey): string {
  return DIFY_CONSOLE_NAV_ENTRIES.find((e) => e.tab === tab)?.label ?? '应用编排';
}

export function getDifyReturnPathForTab(tab: XinferenceDifyTabKey): string {
  return DIFY_CONSOLE_NAV_ENTRIES.find((e) => e.tab === tab)?.returnPath ?? '/apps';
}
