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

export function normalizeNodeArchitecture(raw: unknown): { label: string } {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (!s) return { label: '—' };

  if (s === 'amd64' || s === 'x86_64' || s === 'x86-64' || s === 'x64') {
    return { label: 'x86_64' };
  }
  if (s === 'arm64' || s === 'aarch64') {
    return { label: 'arm64' };
  }
  if (s === 'arm' || s.startsWith('arm/v')) {
    return { label: 'arm' };
  }
  if (s === 'ppc64le' || s === 'ppc64') {
    return { label: 'ppc64le' };
  }
  if (s === 's390x') {
    return { label: 's390x' };
  }
  if (s === 'riscv64' || s === 'riscv') {
    return { label: 'riscv64' };
  }
  return { label: s.replace(/\s+/g, '_') };
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

const serverSuffixStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: '#1f2937',
  lineHeight: 1,
};

const labelServerRowStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 3,
};

/** 无架构数据时不渲染 */
export const NodeArchBadge: React.FC<NodeArchBadgeProps> = ({ architecture }) => {
  const { label } = normalizeNodeArchitecture(architecture);
  if (!label || label === '—') return null;

  return (
    <span style={NODE_ARCH_CHIP_WRAP} title={`CPU 架构：${label} 服务器`}>
      <DatabaseTwoTone twoToneColor={['#243547', '#c5d4e8']} style={{ fontSize: 20, flexShrink: 0 }} aria-hidden />
      <span style={labelServerRowStyle}>
        <span style={labelStyle}>{label}</span>
        <span style={serverSuffixStyle}>服务器</span>
      </span>
    </span>
  );
};
