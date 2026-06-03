/** 统一存储配置页 — 向导步骤、选项与文案常量 */

import type { AlertProps } from 'antd';
import type { CSSProperties } from 'react';

/** 「扩容存储 / 配置详情」Tab 顶栏说明 Alert 统一样式 */
export const OPERATE_TAB_INFO_ALERT_PROPS: Pick<AlertProps, 'type' | 'showIcon' | 'style'> = {
  type: 'info',
  showIcon: true,
  style: { marginBottom: 16 },
};

/** Alert 下方内容区：避免额外 margin-top 导致两 Tab 视觉间距不一致 */
export const OPERATE_TAB_BODY_STYLE: CSSProperties = { marginTop: 0 };

/** Operate Tab 表单根 class（列内控件宽度见 global-new.css `.harvester-addon-operate-form`） */
export const OPERATE_TAB_FORM_CLASS = 'harvester-addon-operate-form';

/** Operate Tab · 单列表单控件最大宽度（px）；窄屏仍随列宽收缩 */
export const OPERATE_TAB_FIELD_MAX_WIDTH = 320;

/** Operate Tab · 双列表单行 gutter */
export const OPERATE_TAB_FIELD_ROW_GUTTER: [number, number] = [24, 0];

/** Operate Tab · 双列字段 Col（lg 起一行两字段） */
export const OPERATE_TAB_FIELD_COL_PROPS = { xs: 24, lg: 12 } as const;

/** Operate Tab · 三列字段 Col（sm 起一行三字段，如存储网 VLAN/集群网络/CIDR） */
export const OPERATE_TAB_FIELD_COL_THIRD_PROPS = { xs: 24, sm: 8 } as const;

/** Operate Tab · 附加 Alert（warning/error）与说明 Alert 间距 */
export const OPERATE_TAB_EXTRA_ALERT_STYLE: CSSProperties = { marginBottom: 16 };

/** 配置详情 Tab · 分区 Card */
export const ADDON_CONFIG_DETAIL_CARD_STYLES = {
  header: {
    borderBottom: '1px solid #e5e6eb',
    minHeight: 46,
  },
  body: {
    padding: '16px 20px',
  },
} as const;

/** 配置详情 Tab · 节点拓扑栅格（大屏一行 4 个） */
export const ADDON_CONFIG_DETAIL_NODE_COL_PROPS = {
  xs: 24,
  sm: 12,
  lg: 6,
} as const;

/** 配置详情 Tab · 节点拓扑子卡 */
export const ADDON_CONFIG_DETAIL_NODE_CARD_STYLE: CSSProperties = {
  borderRadius: 10,
  border: '1px solid #e5e6eb',
  background: '#fff',
  overflow: 'hidden',
};

/** 配置详情 Tab · 参数区统一两列栅格（固定两行区域高度） */
export const ADDON_CONFIG_DETAIL_FIELD_GRID_STYLE: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  columnGap: 32,
  rowGap: 16,
  alignContent: 'start',
  minHeight: 88,
};

/** 配置详情 Tab · 下半区 Card 等高（Col 内 flex 拉伸） */
export const ADDON_CONFIG_DETAIL_METRIC_COL_STYLE: CSSProperties = {
  display: 'flex',
};

export const ADDON_CONFIG_DETAIL_METRIC_CARD_STYLE: CSSProperties = {
  width: '100%',
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
};

export const ADDON_CONFIG_DETAIL_METRIC_CARD_BODY_STYLE: CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
};

/** 扩容/向导节点卡片列表：不用 ant Space，避免首项顶部幽灵间距 */
export const NODE_DISK_LIST_LAYOUT_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 24,
  width: '100%',
  margin: 0,
  padding: 0,
};

/** 单张节点配置卡：与页面白底拉开层次，便于区分相邻节点 */
export const NODE_DISK_NODE_CARD_STYLE: CSSProperties = {
  background: '#fafafa',
  border: '1px solid #e5e6eb',
  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04)',
};

export const NODE_DISK_NODE_CARD_STYLES = {
  header: {
    background: '#f2f3f5',
    borderBottom: '1px solid #e5e6eb',
    minHeight: 48,
  },
  body: {
    padding: '16px 20px',
    background: '#fff',
  },
} as const;

export const WIZARD_STEPS = [
  { title: '存储网', description: '设定存储网络' },
  { title: '存储节点', description: '选择参与的节点与硬盘' },
  { title: '集群服务', description: '管理节点与调度服务' },
  { title: '容量与策略', description: '设定副本、压缩参数' },
  { title: '确认提交', description: '核对配置并提交' },
] as const;

export const COMPRESSION_OPTIONS = [
  { value: 'none', label: '关闭' },
  { value: 'passive', label: '被动（空闲时压缩）' },
  { value: 'aggressive', label: '积极' },
  { value: 'force', label: '强制' },
];

export const RECLAIM_POLICY_OPTIONS = [
  { value: 'Delete', label: '随云硬盘删除' },
  { value: 'Retain', label: '保留数据' },
];

export const VOLUME_BINDING_OPTIONS = [
  { value: 'Immediate', label: '创建时分配' },
  { value: 'WaitForFirstConsumer', label: '首次使用时分配' },
];

export const OSD_STORE_OPTIONS = [
  { value: 'bluestore', label: 'BlueStore（推荐）' },
  { value: 'filestore', label: 'FileStore（旧版）' },
];

export const SUBMIT_RISK_ITEMS = [
  '所选数据盘将用于统一存储，盘内原有数据会被清除且不可恢复。',
  '节点、磁盘或副本等配置错误可能导致部署失败，或导致集群/业务长时间不可用。',
  '对已运行的统一存储修改配置，可能触发数据迁移、重建或服务中断。',
  '提交后部署或应用通常需要数分钟，请勿重复提交；进度以页面状态为准。',
  '若使用专家模式手动 YAML，将绕过向导校验，错误配置需自行承担后果。',
];

export const EXPANSION_SUBMIT_RISK_ITEMS = [
  '本次仅允许扩容：新增数据盘或新存储节点；已有数据盘不可移除或改配。',
  '仅新勾选的数据盘会被初始化并加入集群，已有盘上的业务数据不会被此向导清除。',
  '新盘仍会被格式化用于存储，盘内原有数据不可恢复，请勿误选系统盘或业务盘。',
  '副本数、管理节点、镜像等集群级配置已锁定；如需调整请联系运维在维护窗口处理。',
  '提交后扩容通常需要数分钟，请勿重复提交；进度以页面状态为准。',
];

export function formatCompressionLabel(value?: string): string {
  return COMPRESSION_OPTIONS.find((o) => o.value === value)?.label ?? value ?? '—';
}

export function formatReclaimLabel(value?: string): string {
  return RECLAIM_POLICY_OPTIONS.find((o) => o.value === value)?.label ?? value ?? '—';
}

export function formatBindingLabel(value?: string): string {
  return VOLUME_BINDING_OPTIONS.find((o) => o.value === value)?.label ?? value ?? '—';
}

export function formatOsdStoreLabel(value?: string): string {
  return OSD_STORE_OPTIONS.find((o) => o.value === value)?.label ?? value ?? '—';
}

/** 已部署集群 · 统一存储配置页内 Tab（默认「配置详情」） */
export type HarvesterAddonOperateTabKey =
  | 'config'
  | 'storage_pools'
  | 'expand'
  | 'storage_network'
  | 'sdrs_policy'
  | 'sdrs_tasks';

const OPERATE_TAB_KEYS = new Set<string>([
  'config',
  'storage_pools',
  'expand',
  'storage_network',
  'sdrs_policy',
  'sdrs_tasks',
]);

export function parseHarvesterAddonOperateTabKey(raw: string | null | undefined): HarvesterAddonOperateTabKey | null {
  const k = String(raw || '').trim();
  if (!k || !OPERATE_TAB_KEYS.has(k)) return null;
  return k as HarvesterAddonOperateTabKey;
}
