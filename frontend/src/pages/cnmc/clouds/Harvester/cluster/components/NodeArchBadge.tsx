/**
 * 物理节点 CPU 架构徽章 — 尺寸与 PhysicalSwitchDetailDrawer 厂商徽标容器一致。
 */
import React from 'react';
import { DatabaseTwoTone } from '@ant-design/icons';

/** 与交换机 Winicssec 外层 span 一致 */
export const NODE_ARCH_CHIP_WRAP: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 4,
  padding: '8px 14px',
  borderRadius: 10,
  background: '#e8edf5',
  border: '1px solid rgba(255, 255, 255, 0.55)',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.65)',
};

/** 原样展示节点 architecture（如 K8s nodeInfo 的 amd64 / arm64），不做别名映射 */
export function normalizeNodeArchitecture(raw: unknown): { label: string } {
  const s = String(raw ?? '').trim();
  if (!s) return { label: '—' };
  return { label: s };
}

export type NodeArchBadgeProps = {
  architecture: unknown;
};

const labelStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  fontSize: 13,
  fontWeight: 600,
  color: '#1f2937',
  letterSpacing: '0.02em',
  lineHeight: 1,
};

/** 无架构数据时不渲染 */
export const NodeArchBadge: React.FC<NodeArchBadgeProps> = ({ architecture }) => {
  const { label } = normalizeNodeArchitecture(architecture);
  if (!label || label === '—') return null;

  return (
    <span style={NODE_ARCH_CHIP_WRAP} title={`CPU 架构：${label}`}>
      <DatabaseTwoTone twoToneColor={['#243547', '#c5d4e8']} style={{ fontSize: 20, flexShrink: 0 }} aria-hidden />
      <span style={labelStyle}>{label}</span>
    </span>
  );
};
