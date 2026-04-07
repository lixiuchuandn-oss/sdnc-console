/**
 * 与 drawers/vlan-plan-drawer/ProviderNetworkTopologyGraph 共用的节点卡片与边样式（物理网络拓扑 / 子网-虚拟机拓扑）。
 */
import React from 'react';
import { MarkerType } from 'react-flow-renderer';

export const CARD_WIDTH = 236;

export const ACCENT = {
  nicDefault: '#52c41a',
  nicCustom: '#fa8c16',
  nicMuted: '#bfbfbf',
  hub: '#1677ff',
  vlan: '#2f54eb',
  subnetPublic: '#1677ff',
  subnetFlat: '#13c2c2',
  neutral: '#d9d9d9',
} as const;

export const edgeDefault = {
  style: { stroke: '#c5cad3', strokeWidth: 2 },
  type: 'smoothstep' as const,
  markerEnd: {
    type: MarkerType.ArrowClosed,
    color: '#c5cad3',
    width: 11,
    height: 11,
  },
};

/** 与物理网络拓扑共用 class，便于 React Flow 控件与节点去样式 */
export const flowChromeStyles = `
.pn-provider-topology-flow .react-flow__node {
  padding: 0 !important;
  border: none !important;
  background: transparent !important;
  box-shadow: none !important;
  font-family: inherit;
}
.pn-provider-topology-flow .react-flow__node-default {
  padding: 0 !important;
  border: none !important;
  background: transparent !important;
  box-shadow: none !important;
}
.pn-provider-topology-flow .react-flow__attribution {
  display: none;
}
.pn-provider-topology-flow .react-flow__controls {
  top: 10px !important;
  right: 10px !important;
  bottom: auto !important;
  left: auto !important;
  display: flex !important;
  flex-direction: row !important;
  flex-wrap: nowrap !important;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 1px 4px rgba(15, 23, 42, 0.08);
  border: 1px solid #f0f0f0;
}
.pn-provider-topology-flow .react-flow__controls-button {
  border-bottom: none !important;
  border-right: 1px solid #f0f0f0;
}
.pn-provider-topology-flow .react-flow__controls-button:last-child {
  border-right: none;
}
`;

export function safeNodeId(prefix: string, raw: string) {
  const s = String(raw || '').replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${prefix}_${s || 'x'}`;
}

export function TopoNodeCard(props: {
  accent: string;
  muted?: boolean;
  dashed?: boolean;
  children: React.ReactNode;
}) {
  const { accent, muted, dashed, children } = props;
  return (
    <div
      style={{
        display: 'flex',
        width: CARD_WIDTH,
        borderRadius: 10,
        overflow: 'hidden',
        border: dashed ? `1px dashed ${muted ? '#d9d9d9' : '#adc6ff'}` : '1px solid rgba(22, 119, 255, 0.08)',
        boxShadow: muted
          ? '0 1px 2px rgba(15, 23, 42, 0.04)'
          : '0 1px 3px rgba(15, 23, 42, 0.06), 0 4px 14px rgba(15, 23, 42, 0.05)',
      }}
    >
      <div style={{ width: 3, flexShrink: 0, background: accent }} aria-hidden />
      <div
        style={{
          flex: 1,
          minWidth: 0,
          background: muted ? '#fafafa' : '#fff',
        }}
      >
        {children}
      </div>
    </div>
  );
}

export function LabelBlock(props: {
  kicker?: string;
  title: string;
  detail?: string;
  tone?: 'default' | 'muted';
  accent?: string;
  dashed?: boolean;
}) {
  const { kicker, title, detail, tone = 'default', accent = ACCENT.neutral, dashed } = props;
  const muted = tone === 'muted';
  return (
    <TopoNodeCard accent={muted ? ACCENT.nicMuted : accent} muted={muted} dashed={!!dashed && muted}>
      <div style={{ padding: '11px 14px', minHeight: 78, lineHeight: 1.5, textAlign: 'left' }}>
        {kicker ? (
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.06em',
              color: '#8c8c8c',
              textTransform: 'uppercase',
              marginBottom: 8,
            }}
          >
            {kicker}
          </div>
        ) : null}
        <div
          style={{
            fontWeight: 600,
            fontSize: 13,
            color: muted ? '#8c8c8c' : '#1f1f1f',
            wordBreak: 'break-word',
          }}
        >
          {title}
        </div>
        {detail ? (
          <div
            style={{
              fontSize: 11,
              color: '#8c8c8c',
              marginTop: 6,
              wordBreak: 'break-word',
              lineHeight: 1.45,
              background: muted ? 'transparent' : 'rgba(0,0,0,0.03)',
              padding: '4px 6px',
              borderRadius: 4,
            }}
          >
            {detail}
          </div>
        ) : null}
      </div>
    </TopoNodeCard>
  );
}
