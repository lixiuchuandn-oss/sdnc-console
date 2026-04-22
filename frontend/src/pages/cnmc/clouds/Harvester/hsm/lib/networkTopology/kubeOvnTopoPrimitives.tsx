/**
 * 物理网络拓扑 / 子网–虚拟机拓扑共用的节点卡片与边样式（React Flow）。
 * 归属 HSM；子网抽屉中 `SubnetVmTopologyGraph` 引用本文件以保持视觉一致。
 */
import React, { createContext, useContext } from 'react';
import { MarkerType } from 'react-flow-renderer';

export type TopoVisualTheme = 'light' | 'dark';

export const TopoVisualThemeContext = createContext<TopoVisualTheme>('light');

export function useTopoVisualTheme(): TopoVisualTheme {
  return useContext(TopoVisualThemeContext);
}

/** 拓扑节点卡片宽度（与 React Flow 节点 style.width 一致） */
export const CARD_WIDTH = 252;

/** 卡片内容区内边距（LabelBlock / 加载占位共用） */
export const TOPO_CARD_CONTENT_STYLE: React.CSSProperties = {
  padding: '12px 14px 14px',
  textAlign: 'left',
  boxSizing: 'border-box',
};

/** 加载中占位：与 LabelBlock 同高、对齐方式一致 */
export const TOPO_CARD_LOADING_LAYOUT: React.CSSProperties = {
  ...TOPO_CARD_CONTENT_STYLE,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 10,
  minHeight: 76,
  justifyContent: 'center',
};

export function topoLoadingCaptionStyle(theme: TopoVisualTheme): React.CSSProperties {
  return {
    fontSize: 12,
    fontWeight: 500,
    lineHeight: 1.5,
    color: theme === 'dark' ? 'rgba(255, 255, 255, 0.45)' : 'rgba(0, 0, 0, 0.45)',
  };
}

/** @deprecated 请使用 topoLoadingCaptionStyle(useTopoVisualTheme()) */
export const TOPO_LOADING_CAPTION_STYLE: React.CSSProperties = topoLoadingCaptionStyle('light');

const TOPO_TEXT_LIGHT = {
  secondary: 'rgba(0, 0, 0, 0.45)',
  primary: 'rgba(0, 0, 0, 0.88)',
  mutedTitle: 'rgba(0, 0, 0, 0.45)',
  detail: 'rgba(0, 0, 0, 0.55)',
} as const;

const TOPO_TEXT_DARK = {
  secondary: 'rgba(255, 255, 255, 0.45)',
  primary: 'rgba(255, 255, 255, 0.88)',
  mutedTitle: 'rgba(255, 255, 255, 0.42)',
  detail: 'rgba(255, 255, 255, 0.55)',
} as const;

export const ACCENT = {
  nicDefault: '#52c41a',
  nicCustom: '#fa8c16',
  nicMuted: '#bfbfbf',
  /** 交换机口 ↔ 物理机（HMS/LLDP）对端 */
  phyLldp: '#722ed1',
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

/** 物理侧 LLDP：对端到对应物理节点卡，若无同名就绪节点再落到 Provider 中枢 */
export const edgeLldp = {
  style: { stroke: '#b37feb', strokeWidth: 1.5, strokeDasharray: '5 4' },
  type: 'smoothstep' as const,
  markerEnd: {
    type: MarkerType.ArrowClosed,
    color: '#b37feb',
    width: 10,
    height: 10,
  },
};

/** 深色画板上的边与箭头 */
export const edgeDefaultDark = {
  style: { stroke: '#7c8498', strokeWidth: 2 },
  type: 'smoothstep' as const,
  markerEnd: {
    type: MarkerType.ArrowClosed,
    color: '#7c8498',
    width: 11,
    height: 11,
  },
};

export const edgeLldpDark = {
  style: { stroke: '#c4a5f8', strokeWidth: 1.5, strokeDasharray: '5 4' },
  type: 'smoothstep' as const,
  markerEnd: {
    type: MarkerType.ArrowClosed,
    color: '#c4a5f8',
    width: 10,
    height: 10,
  },
};

export function getEdgePalette(theme: TopoVisualTheme) {
  return theme === 'dark'
    ? { edgeDefault: edgeDefaultDark, edgeLldp: edgeLldpDark }
    : { edgeDefault, edgeLldp };
}

const FLOW_CHROME_BASE = `
.pn-provider-topology-flow .react-flow__node {
  padding: 0 !important;
  border: none !important;
  background: transparent !important;
  box-shadow: none !important;
  font-family: inherit;
  animation: none !important;
}
.pn-provider-topology-flow .react-flow__edge {
  animation: none !important;
}
.pn-provider-topology-flow .react-flow__handle {
  opacity: 0 !important;
  width: 1px !important;
  height: 1px !important;
  min-width: 0 !important;
  min-height: 0 !important;
  border: none !important;
  background: transparent !important;
  pointer-events: none !important;
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
`;

const FLOW_CHROME_CONTROLS_LIGHT = `
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
  background: rgba(255, 255, 255, 0.95) !important;
}
.pn-provider-topology-flow .react-flow__controls-button {
  border-bottom: none !important;
  border-right: 1px solid #f0f0f0;
  background: #fff !important;
  fill: #434343 !important;
}
.pn-provider-topology-flow .react-flow__controls-button:hover {
  background: #f5f5f5 !important;
}
.pn-provider-topology-flow .react-flow__controls-button:last-child {
  border-right: none;
}
`;

const FLOW_CHROME_CONTROLS_DARK = `
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
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: #2a2c33 !important;
}
.pn-provider-topology-flow .react-flow__controls-button {
  border-bottom: none !important;
  border-right: 1px solid rgba(255, 255, 255, 0.1);
  background: #2a2c33 !important;
  fill: rgba(255, 255, 255, 0.75) !important;
}
.pn-provider-topology-flow .react-flow__controls-button:hover {
  background: #363945 !important;
}
.pn-provider-topology-flow .react-flow__controls-button:last-child {
  border-right: none;
}
`;

/** 与物理网络拓扑共用 class，便于 React Flow 控件与节点去样式 */
export function getFlowChromeStyles(theme: TopoVisualTheme): string {
  return FLOW_CHROME_BASE + (theme === 'dark' ? FLOW_CHROME_CONTROLS_DARK : FLOW_CHROME_CONTROLS_LIGHT);
}

/** 浅色（子网–虚拟机等未包 ThemeProvider 时） */
export const flowChromeStyles = getFlowChromeStyles('light');

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
  const theme = useTopoVisualTheme();
  const isDark = theme === 'dark';

  const border = dashed
    ? `1px dashed ${
        muted
          ? isDark
            ? 'rgba(255, 255, 255, 0.22)'
            : '#d9d9d9'
          : isDark
            ? 'rgba(121, 168, 255, 0.55)'
            : '#91caff'
      }`
    : `1px solid ${isDark ? 'rgba(255, 255, 255, 0.12)' : '#f0f0f0'}`;

  const boxShadow = isDark
    ? muted
      ? '0 1px 3px rgba(0, 0, 0, 0.35)'
      : '0 1px 3px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.04) inset'
    : muted
      ? '0 1px 2px rgba(15, 23, 42, 0.04)'
      : '0 1px 2px rgba(15, 23, 42, 0.06), 0 4px 12px rgba(15, 23, 42, 0.04)';

  const bodyBg = isDark ? (muted ? '#1a1d24' : '#252830') : muted ? '#fafafa' : '#fff';

  return (
    <div
      style={{
        display: 'flex',
        width: CARD_WIDTH,
        borderRadius: 8,
        overflow: 'hidden',
        border,
        boxShadow,
      }}
    >
      <div style={{ width: 4, flexShrink: 0, background: accent }} aria-hidden />
      <div
        style={{
          flex: 1,
          minWidth: 0,
          background: bodyBg,
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
  const theme = useTopoVisualTheme();
  const txt = theme === 'dark' ? TOPO_TEXT_DARK : TOPO_TEXT_LIGHT;
  const detailBg =
    theme === 'dark'
      ? muted
        ? 'transparent'
        : 'rgba(255, 255, 255, 0.08)'
      : muted
        ? 'transparent'
        : 'rgba(0, 0, 0, 0.04)';

  return (
    <TopoNodeCard accent={muted ? ACCENT.nicMuted : accent} muted={muted} dashed={!!dashed && muted}>
      <div
        style={{
          ...TOPO_CARD_CONTENT_STYLE,
          display: 'flex',
          flexDirection: 'column',
          gap: 0,
          minHeight: 76,
          lineHeight: 1.5,
          fontFamily: 'inherit',
        }}
      >
        {kicker ? (
          <div
            style={{
              fontSize: 11,
              fontWeight: 500,
              lineHeight: 1.36,
              letterSpacing: '0.02em',
              color: txt.secondary,
              marginBottom: 6,
            }}
          >
            {kicker}
          </div>
        ) : null}
        <div
          style={{
            fontWeight: 600,
            fontSize: 14,
            lineHeight: 1.4,
            color: muted ? txt.mutedTitle : txt.primary,
            wordBreak: 'break-word',
          }}
        >
          {title}
        </div>
        {detail ? (
          <div
            style={{
              fontSize: 12,
              fontWeight: 400,
              lineHeight: 1.5,
              color: txt.detail,
              marginTop: 8,
              wordBreak: 'break-word',
              whiteSpace: 'pre-line',
              background: detailBg,
              padding: '8px 10px',
              borderRadius: 6,
            }}
          >
            {detail}
          </div>
        ) : null}
      </div>
    </TopoNodeCard>
  );
}
