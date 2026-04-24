/**
 * 物理网络拓扑 / 子网–虚拟机拓扑共用的节点卡片与边样式（React Flow）。
 * 归属 HSM；子网抽屉中 `SubnetVmTopologyGraph` 引用本文件以保持视觉一致。
 */
import React, { createContext, useContext } from 'react';

export type TopoVisualTheme = 'light' | 'dark';

export const TopoVisualThemeContext = createContext<TopoVisualTheme>('light');

export function useTopoVisualTheme(): TopoVisualTheme {
  return useContext(TopoVisualThemeContext);
}

/** 拓扑节点卡片统一宽度（与 React Flow 节点 style.width 一致） */
export const CARD_WIDTH = 200;
/** 网口等 PortNode 小卡，与主列同宽 */
export const PORT_NODE_WIDTH = CARD_WIDTH;
/** 主机 Uplink / 网口信息卡（LabelBlock），与主列同宽 */
export const NICO_UPLINK_CARD_WIDTH = CARD_WIDTH;

/** 列与列之间节点中心点 x 等距（px），与物理网络/集群主链一致 */
export const TOPO_COL_CENTER_PITCH = 340;

/**
 * 第 colIndex 列节点左缘 x；列中心线等距，RF 为左上角，故 中心x = firstColCenterX + colIndex * pitch，左缘 = 中心 − width/2。
 */
export function topoNodeLeftX(
  colIndex: number,
  firstColCenterX: number,
  width: number = CARD_WIDTH,
  pitch: number = TOPO_COL_CENTER_PITCH,
): number {
  return firstColCenterX + colIndex * pitch - width / 2;
}

/** 行与行之间**垂直中心**等距；RF 用顶边 y，相邻行须 `y[i+1]-y[i]=本值`（与 Card 高无关，中心点间距恒等）。 */
export const TOPO_ROW_CENTER_PITCH = 128;

/**
 * 若干行（顶 y 在 `step` 网格上）聚成一组时，取行下标中位数，回到顶边 y，供交换机体等与整行垂直对齐、不用像素偏移（如 midY-32）。
 */
export function topoGridTopYForRowGroup(blockStartY: number, yTops: number[], step: number = TOPO_ROW_CENTER_PITCH): number {
  if (yTops.length === 0) return blockStartY;
  const rowIdxs = yTops
    .map((y) => Math.round((y - blockStartY) / step))
    .filter((i) => Number.isFinite(i))
    .sort((a, b) => a - b);
  if (rowIdxs.length === 0) return blockStartY;
  const midR = rowIdxs[Math.floor((rowIdxs.length - 1) / 2)] ?? 0;
  return blockStartY + midR * step;
}

/** 卡片内容区内边距（LabelBlock / 加载占位共用） */
export const TOPO_CARD_CONTENT_STYLE: React.CSSProperties = {
  padding: '12px 14px 14px',
  textAlign: 'left',
  boxSizing: 'border-box',
};

/** 网口节点内边距（与 PortNodeLabel 配合） */
export const TOPO_PORT_CARD_CONTENT_STYLE: React.CSSProperties = {
  padding: '7px 10px 8px',
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

/** 逻辑/机内/模型关系（交换机体↔网口、网口↔算力节点、Provider↔VLAN 等）— 虚线 */
export const edgeDefault = {
  style: { stroke: '#c5cad3', strokeWidth: 2, strokeDasharray: '5 4' },
  type: 'smoothstep' as const,
};

/** 交换机网口与物理机网口之间 = 对端物理链路（“网线”）— 实线、紫色，与上项区分 */
export const edgeLldp = {
  style: { stroke: '#b37feb', strokeWidth: 1.5 },
  type: 'smoothstep' as const,
};

/** 深色画板 */
export const edgeDefaultDark = {
  style: { stroke: '#7c8498', strokeWidth: 2, strokeDasharray: '5 4' },
  type: 'smoothstep' as const,
};

export const edgeLldpDark = {
  style: { stroke: '#c4a5f8', strokeWidth: 1.5 },
  type: 'smoothstep' as const,
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

/** 灰条（LabelBlock detail）内展示的物理机网口状态：来自 `nics[]` 的 `state`；拓扑内不展示「已占用」 */
export function formatNicUplinkStatusInGrayBar(node: any | null | undefined, ifName: string): string {
  const dev = String(ifName || '').trim();
  if (!dev) return '状态：—';
  if (!node) return '状态：无节点数据';
  const arr = Array.isArray((node as { nics?: any[] })?.nics) ? (node as { nics: any[] }).nics : [];
  const row = arr.find((n: any) => String(n?.device || '').trim() === dev);
  if (!row) return '状态：本节点 nics 中无此设备名';
  const st = String(row.state || '').trim() || '—';
  return `状态：${st}`;
}

/**
 * 物理机可管理地址（与 `PhysicalNodeDetailDrawer` / 节点表「内网IP」来源一致），供拓扑与交换机 `detail=管理面地址` 并列展示。
 * 无数据时返回 `未上报`。
 */
export function harvesterNodeManagementAddressText(node: any | null | undefined): string {
  if (!node) return '未上报';
  const fromRoot = String(node?.internalIP ?? '').trim();
  const addrs = node?.status?.addresses;
  const fromStatus = String(
    Array.isArray(addrs) ? addrs.find((a: any) => a?.type === 'InternalIP')?.address ?? '' : '',
  ).trim();
  return fromRoot || fromStatus || '未上报';
}

/**
 * 交换机网口：灰条内仅作状态。`switchPortStatus` 来自 ASW-CLI 解析（`HsmLldpPhysicalLink.switchPortStatus`）。
 * `matched: false` 表示无 LLDP 匹配，不读交换机行。
 */
export function formatSwitchUplinkStatusInGrayBar(
  switchPortStatus: string | null | undefined,
  matched: boolean,
): string {
  if (!matched) return '状态：无 LLDP 匹配';
  const s = String(switchPortStatus || '').trim();
  if (s) return `状态：${s}`;
  return '状态：未采集';
}

export function TopoNodeCard(props: {
  accent: string;
  muted?: boolean;
  dashed?: boolean;
  /** 默认 `CARD_WIDTH`；网口用 `PORT_NODE_WIDTH` */
  width?: number;
  children: React.ReactNode;
}) {
  const { accent, muted, dashed, children, width = CARD_WIDTH } = props;
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
        width,
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
  /** 与 React Flow 节点 `style.width` 一致；网口等可单独传 `width`，默认 `CARD_WIDTH` */
  width?: number;
}) {
  const { kicker, title, detail, tone = 'default', accent = ACCENT.neutral, dashed, width } = props;
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
    <TopoNodeCard
      accent={muted ? ACCENT.nicMuted : accent}
      muted={muted}
      dashed={!!dashed && muted}
      width={width ?? CARD_WIDTH}
    >
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

/** 网口节点：与主列同宽的专用内边距/角标；宽度默认 `PORT_NODE_WIDTH`（= `CARD_WIDTH`）。 */
export function PortNodeLabel(props: {
  kicker: string;
  title: string;
  detail?: string;
  tone?: 'default' | 'muted';
  accent?: string;
  dashed?: boolean;
  /** 为 true 时角标略缩窄（交换机侧/主机侧可区分） */
  portKind?: 'switch' | 'host';
  /** 内容区 minHeight；不传则 50，与现网物理网络拓扑网口卡一致 */
  contentMinHeight?: number;
}) {
  const { kicker, title, detail, tone = 'default', accent = ACCENT.phyLldp, dashed, portKind, contentMinHeight = 50 } =
    props;
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

  const kickerW = portKind === 'switch' ? 52 : 44;
  return (
    <TopoNodeCard
      accent={muted ? ACCENT.nicMuted : accent}
      muted={muted}
      dashed={!!dashed && muted}
      width={PORT_NODE_WIDTH}
    >
      <div
        style={{
          ...TOPO_PORT_CARD_CONTENT_STYLE,
          display: 'flex',
          flexDirection: 'column',
          gap: 0,
          minHeight: contentMinHeight,
          lineHeight: 1.4,
          fontFamily: 'inherit',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            marginBottom: 3,
            minWidth: 0,
          }}
        >
          <span
            style={{
              flex: `0 0 ${kickerW}px`,
              fontSize: 10,
              fontWeight: 500,
              lineHeight: 1.2,
              letterSpacing: '0.02em',
              color: txt.secondary,
            }}
          >
            {kicker}
          </span>
          <span
            style={{
              flex: 1,
              minWidth: 0,
              fontWeight: 600,
              fontSize: 12,
              lineHeight: 1.3,
              color: muted ? txt.mutedTitle : txt.primary,
              wordBreak: 'break-word',
            }}
          >
            {title}
          </span>
        </div>
        {detail ? (
          <div
            style={{
              fontSize: 10,
              fontWeight: 400,
              lineHeight: 1.4,
              color: txt.detail,
              wordBreak: 'break-word',
              whiteSpace: 'pre-line',
              background: detailBg,
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
