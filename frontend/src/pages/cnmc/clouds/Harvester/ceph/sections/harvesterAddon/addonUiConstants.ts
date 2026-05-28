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

/** 扩容/向导节点卡片列表：不用 ant Space，避免首项顶部幽灵间距 */
export const NODE_DISK_LIST_LAYOUT_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  width: '100%',
  margin: 0,
  padding: 0,
};

export const WIZARD_STEPS = [
  { title: '存储节点', description: '选择参与存储的节点与数据盘' },
  { title: '集群服务', description: '管理节点与调度服务' },
  { title: '容量与策略', description: '副本、压缩与云硬盘行为' },
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
  '所选数据盘将用于 Ceph OSD，盘内原有数据会被清除且不可恢复。',
  '节点、磁盘或副本等配置错误可能导致部署失败，或导致集群/业务长时间不可用。',
  '对已运行的统一存储修改配置，可能触发 OSD 迁移、重建或服务中断。',
  '提交后部署或应用通常需要数分钟，请勿重复提交；进度以页面状态为准。',
  '若使用专家模式手动 YAML，将绕过向导校验，错误配置需自行承担后果。',
];

export const EXPANSION_SUBMIT_RISK_ITEMS = [
  '本次仅允许扩容：新增数据盘或新存储节点；已有 OSD 不可移除或改配。',
  '仅新勾选的数据盘会被初始化并加入集群，已有 OSD 上的业务数据不会被此向导清除。',
  '新盘仍会被格式化为 OSD，盘内原有数据不可恢复，请勿误选系统盘或业务盘。',
  '副本数、管理节点、镜像等集群级配置已锁定；如需调整请联系运维在维护窗口处理。',
  '提交后 Rook 创建新 OSD 通常需要数分钟，请勿重复提交；进度以页面状态为准。',
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
