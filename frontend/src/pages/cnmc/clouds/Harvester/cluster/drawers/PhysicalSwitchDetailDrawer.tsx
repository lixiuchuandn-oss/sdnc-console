/**
 * 物理交换机（ASW-CTL 单实例）侧滑详情 — 归属 Harvester/cluster/drawers。
 * 样式与壳层：deployment/docs/specs/ui/物理交换机详情抽屉-壳层与实现规范.md
 * 端口前面板栅格（原 SwitchPanelVisualizationModal）内嵌于「端口面板」Tab。
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Drawer,
  Typography,
  Button,
  Tabs,
  Tag,
  Space,
  Descriptions,
  Alert,
  Collapse,
  Tooltip,
  Select,
} from 'antd';
import AswCliOutputCollapse from '../components/AswCliOutputCollapse';
import {
  classifyPortStatus,
  extractInterfacesStdoutFromRecord,
  parseInterfaceStatusStdout,
  type ParsedSwitchPort,
  type PortStatusKind,
} from '../lib/parseAswCtlInterfaceStdout';
import {
  switchRecordManagementHost,
  switchRecordDeviceProfile,
  parseSwitchDisplayNameFromInfoLines,
  isWinicssecSwitchRecord,
} from '../lib/physicalSwitchRecordUtils';
import {
  extractVlansStdoutFromRecord,
  parseVlanMembershipStdout,
} from '../lib/parseAswCtlVlanStdout';
import winicssecLogo from '../../../../../../assets/asw/winicssec.png';

export type PhysicalSwitchDetailDrawerProps = {
  open: boolean;
  record: any | null;
  onClose: () => void;
  /** 本次打开抽屉时默认选中的 Tab（仅在 open 由关→开时应用一次） */
  initialTab?: 'overview' | 'cli' | 'panel';
  /** 从集群重新拉取 ASW-CTL 列表/探测数据（由 Section 注入） */
  onRefreshFromCluster?: () => void;
  refreshLoading?: boolean;
};

const UI = {
  shell: '#0f1419',
  shellMuted: '#1a222d',
  text: '#e6edf3',
  textMuted: '#8b949e',
  bodyBg: '#f0f2f5',
  accent: '#58a6ff',
  border: 'rgba(230, 237, 243, 0.12)',
};

/** hero KPI 区：项之间的纵向分隔线 */
const HERO_KPI_DIVIDER: React.CSSProperties = {
  width: 1,
  alignSelf: 'stretch',
  minHeight: 40,
  background: UI.border,
  flexShrink: 0,
};

/** 与 ProviderNetworkDetailDrawer Tab 区一致：滚动外包左右 22px，面板仅上下留白 */
const DRAWER_TAB_SCROLL_BODY: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: 'auto',
  padding: '0 22px',
};
const TAB_PANEL_PADDING: React.CSSProperties = { padding: '4px 0 16px' };
const TAB_BAR_STYLE: React.CSSProperties = { marginBottom: 8, fontWeight: 500 };

const heroActionTextPrimary: React.CSSProperties = { fontSize: 12, color: UI.accent, height: 'auto', paddingInline: 0 };

/** 深色 hero 条上的 Tag（与 antd color预设区分，避免浅色底在 shell 上刺眼） */
const HERO_TAG_BASE: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  lineHeight: '20px',
  borderRadius: 6,
};
const heroTagSuccess: React.CSSProperties = {
  ...HERO_TAG_BASE,
  background: 'rgba(63, 185, 80, 0.14)',
  border: '1px solid rgba(63, 185, 80, 0.38)',
  color: '#7ee787',
};
const heroTagError: React.CSSProperties = {
  ...HERO_TAG_BASE,
  background: 'rgba(248, 81, 73, 0.12)',
  border: '1px solid rgba(248, 81, 73, 0.42)',
  color: '#ffb1a9',
};
const heroTagMuted: React.CSSProperties = {
  ...HERO_TAG_BASE,
  background: 'rgba(255, 255, 255, 0.07)',
  border: '1px solid rgba(230, 237, 243, 0.18)',
  color: UI.textMuted,
};

/** ASW-CTL 北向服务探测（与交换机 CLI 查询区分） */
function aswCtlServiceHealthTag(record: any): React.ReactNode {
  if (record.healthError) {
    return <Tag style={heroTagError}>服务健康 · 失败</Tag>;
  }
  if (record.healthNotApplicable) {
    return <Tag style={heroTagMuted}>服务健康 · 未提供</Tag>;
  }
  if (record.health != null) {
    return <Tag style={heroTagSuccess}>服务健康 · 正常</Tag>;
  }
  return <Tag style={heroTagMuted}>服务健康 · —</Tag>;
}

function aswCtlOpenapiTag(record: any): React.ReactNode {
  if (record.openapiYamlError) {
    return <Tag style={heroTagError}>OpenAPI · 失败</Tag>;
  }
  if (record.openapiNotApplicable) {
    return <Tag style={heroTagMuted}>OpenAPI · 未提供</Tag>;
  }
  if (record.openapiYaml) {
    return <Tag style={heroTagSuccess}>OpenAPI · 可达</Tag>;
  }
  return <Tag style={heroTagMuted}>OpenAPI · —</Tag>;
}

type KpiTone = 'ok' | 'warn' | 'err' | 'muted';

type PulseStatProps = {
  label: string;
  children: React.ReactNode;
  tone?: KpiTone;
};

const KPI_VALUE_COLOR: Record<KpiTone, string> = {
  ok: '#7ee787',
  err: '#ff7b72',
  warn: '#e3b341',
  muted: UI.text,
};

const PulseStat: React.FC<PulseStatProps> = ({ label, children, tone = 'muted' }) => (
  <div style={{ flex: '1 1 auto', minWidth: 88, maxWidth: '100%', padding: '2px 14px 0' }}>
    <Typography.Text style={{ fontSize: 12, color: UI.textMuted, display: 'block', marginBottom: 4 }}>
      {label}
    </Typography.Text>
    <div style={{ fontSize: 14, fontWeight: 600, color: KPI_VALUE_COLOR[tone], lineHeight: 1.35 }}>
      {children}
    </div>
  </div>
);

/** 深色机框上的端口状态色（略提高对比） */
const PORT_VISUAL: Record<
  PortStatusKind,
  { border: string; background: string; label: string }
> = {
  up: {
    border: '#3fb950',
    background: 'rgba(63, 185, 80, 0.22)',
    label: 'Up',
  },
  down: {
    border: '#f85149',
    background: 'rgba(248, 81, 73, 0.18)',
    label: 'Down',
  },
  admin: {
    border: '#d29922',
    background: 'rgba(210, 153, 34, 0.2)',
    label: 'Admin',
  },
  unknown: {
    border: '#6e7681',
    background: 'rgba(110, 118, 129, 0.25)',
    label: '未知',
  },
};

const PANEL_UI = {
  modalContent: '#0d1117',
  text: '#e6edf3',
  textMuted: '#8b949e',
  chassis: '#161b22',
  chassisBorder: '#30363d',
};

const ASWCTL_SWITCH_NAME_STORAGE = 'aswctl.switchName.v1:';

type PerformanceMetricsParsed = {
  cpu?: string;
  memory?: string;
  temperature?: string;
  fan?: string;
  psu?: string;
};

/** 从一段 stdout 补全 CPU/内存（不限定命令名；兼容多空格、中英文冒号、Utilization 等）。 */
function mergeCpuMemoryFromStdout(text: string, out: PerformanceMetricsParsed) {
  const t = text;
  if (!t.trim()) return;

  if (!out.cpu) {
    const cpuRes =
      t.match(/(?:^|\n)\s*CPU\s*[:：]\s*([^\n\r]+)/i) ||
      t.match(/(?:^|\n)\s*CPU\s+Utilization\s*[:：]\s*([^\n\r]+)/i) ||
      t.match(/(?:^|\n)\s*Processor\s*[:：]\s*([^\n\r]+)/i) ||
      t.match(/(?:^|\n)\s*Cpu\s+usage\s*[:：]\s*([^\n\r]+)/i) ||
      t.match(/(?:^|\n)\s*CPU\s+usage\s*[:：]\s*([^\n\r]+)/i) ||
      t.match(/(?:^|\n)\s*CPU\s+(\d+\s*%)\s*(?:\n|$)/i);
    if (cpuRes?.[1]) {
      out.cpu = cpuRes[1].replace(/\s+/g, ' ').trim().slice(0, 80);
    }
  }
  if (!out.memory) {
    const memRes =
      t.match(/(?:^|\n)\s*Memory\s*[:：]\s*([^\n\r]+)/i) ||
      t.match(/(?:^|\n)\s*Mem(?:ory)?\s*[:：]\s*([^\n\r]+)/i) ||
      t.match(/(?:^|\n)\s*Memory\s+Usage\s*[:：]\s*([^\n\r]+)/i) ||
      t.match(/(?:^|\n)\s*Mem\s+Utilization\s*[:：]\s*([^\n\r]+)/i) ||
      t.match(/(?:^|\n)\s*MEM(?:ORY)?\s+UTIL\S*\s*[:：]\s*([^\n\r]+)/i) ||
      t.match(/(?:^|\n)\s*Memory\s+(\d+\s*%)\s*(?:\n|$)/i);
    if (memRes?.[1]) {
      out.memory = memRes[1].replace(/\s+/g, ' ').trim().slice(0, 80);
    }
  }

  /** CMM / Resources 表：「CPU    21」无冒号、无 %（见 ASW-CTL health dump 实机输出） */
  if (!out.cpu) {
    const tabCpu = t.match(/(?:^|\n)\s*CPU\s+(\d+)\b/);
    if (tabCpu?.[1]) out.cpu = `${tabCpu[1]}%`;
  }
  if (!out.memory) {
    const tabMem =
      t.match(/(?:^|\n)\s*Memory\s+(\d+)\b/im) || t.match(/(?:^|\n)\s*Mem\s+(\d+)\b/im);
    if (tabMem?.[1]) out.memory = `${tabMem[1]}%`;
  }
}

/** temperature get：表头含 Current / Range，数据行「1/CMMA  38  0 to 62 …」 */
function mergeTemperatureFromStdout(text: string, out: PerformanceMetricsParsed) {
  if (out.temperature) return;
  const t = text;
  const colon =
    t.match(/(?:^|\n)\s*Temp(?:erature)?:\s*([^\n\r]+)/i) ||
    t.match(/(?:^|\n)\s*Temp:\s*([^\n\r]+)/i);
  if (colon?.[1]) {
    out.temperature = colon[1].trim().slice(0, 80);
    return;
  }
  const lines = t.split(/\r?\n/);
  const headIdx = lines.findIndex((l) => /Current/i.test(l) && /Range/i.test(l));
  if (headIdx >= 0) {
    for (let i = headIdx + 1; i < lines.length; i++) {
      const row = lines[i];
      if (!row?.trim() || /^[\s|+:-]+$/.test(row)) continue;
      const m = row.match(/^\s*[\w/]+\s+(\d+)\s+\d+\s+to\s+\d+/i);
      if (m?.[1]) {
        out.temperature = `${m[1]}°C`;
        return;
      }
    }
  }
  const fallback = t.match(/(?:^|\n)\s*[\w/]+\s+(\d+)\s+\d+\s+to\s+\d+/i);
  if (fallback?.[1]) out.temperature = `${fallback[1]}°C`;
}

/** fan get：「1/1  1  YES  600」取转速 */
function mergeFanFromStdout(text: string, out: PerformanceMetricsParsed) {
  if (out.fan) return;
  const m = text.match(/(?:^|\n)\s*\d+\/\d+\s+\d+\s+(\w+)\s+(\d+)/m);
  if (m?.[2]) {
    out.fan = `${m[1]} · ${m[2]} RPM`.slice(0, 96);
    return;
  }
  const line = text.split(/\r?\n/).find((lineStr: string) => lineStr.trim());
  if (line) out.fan = line.trim().slice(0, 96);
}

/** powersupply get：数据行「1/1  550  AC  UP」 */
function mergePsuFromStdout(text: string, out: PerformanceMetricsParsed) {
  if (out.psu) return;
  const m = text.match(/(?:^|\n)\s*\d+\/\d+\s+(\d+)\s+(\w+)\s+(UP|DOWN)\b/im);
  if (m?.[1]) {
    out.psu = `${m[2]} ${m[1]}W ${m[3]}`.slice(0, 96);
    return;
  }
  const line = text.split(/\r?\n/).find((lineStr: string) => lineStr.trim());
  if (line) out.psu = line.trim().slice(0, 96);
}

/** 从 /v1/switch/performance 的 lines[] 抽取常用指标（WOS health dump / temperature get 等）。 */
function parsePerformanceMetrics(lines: any[] | undefined): PerformanceMetricsParsed {
  const out: PerformanceMetricsParsed = {};
  if (!Array.isArray(lines)) return out;
  for (const ln of lines) {
    const cmd = String(ln?.command || '').toLowerCase();
    const stdout = typeof ln?.stdout === 'string' ? ln.stdout : '';
    if (!stdout.trim()) continue;

    mergeCpuMemoryFromStdout(stdout, out);

    if (/temperature/.test(cmd)) {
      mergeTemperatureFromStdout(stdout, out);
    }
    if (/fan/.test(cmd)) {
      mergeFanFromStdout(stdout, out);
    }
    if (/power/.test(cmd)) {
      mergePsuFromStdout(stdout, out);
    }
  }
  return out;
}

/** 合并 performance；若仍缺 CPU/内存，再从 info 各命令 stdout 里扫一遍（部分机型只在 system dump 里带负载）。 */
function buildPerformanceMetrics(record: any): PerformanceMetricsParsed {
  const out = parsePerformanceMetrics(record?.performance?.lines);
  if (record?.info?.lines && (!out.cpu || !out.memory)) {
    for (const ln of record.info.lines as any[]) {
      const stdout = typeof ln?.stdout === 'string' ? ln.stdout : '';
      if (!stdout.trim()) continue;
      mergeCpuMemoryFromStdout(stdout, out);
      if (out.cpu && out.memory) break;
    }
  }
  return out;
}

function PerformanceMetricsStrip({
  metrics,
  style,
}: {
  metrics: PerformanceMetricsParsed;
  style?: React.CSSProperties;
}) {
  const items: { label: string; value: string }[] = [];
  if (metrics.cpu) items.push({ label: 'CPU', value: metrics.cpu });
  if (metrics.memory) items.push({ label: '内存', value: metrics.memory });
  if (metrics.temperature) items.push({ label: '温度', value: metrics.temperature });
  if (metrics.fan) items.push({ label: '风扇', value: metrics.fan });
  if (metrics.psu) items.push({ label: '电源', value: metrics.psu });
  if (!items.length) return null;
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '10px 20px',
        padding: '10px 12px',
        marginBottom: 12,
        borderRadius: 8,
        background: 'rgba(255,255,255,0.04)',
        border: `1px solid ${PANEL_UI.chassisBorder}`,
        ...style,
      }}
    >
      {items.map((it) => (
        <div key={it.label} style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <Typography.Text style={{ fontSize: 12, color: PANEL_UI.textMuted }}>{it.label}</Typography.Text>
          <Typography.Text style={{ fontSize: 13, color: PANEL_UI.text, fontWeight: 500 }}>
            {it.value}
          </Typography.Text>
        </div>
      ))}
    </div>
  );
}

function portSortKey(name: string): [number, number, number] {
  const m = name.match(/^(\d+)\/(\d+)\/(\d+)$/);
  if (!m) return [9999, 9999, 9999];
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
}

/** 左块千兆（末段 1–24）、右块万兆（末段 ≥25）；无法解析末段时归入千兆。 */
function splitGigabitAndTenG(ports: ParsedSwitchPort[]): {
  gigabit: ParsedSwitchPort[];
  tenG: ParsedSwitchPort[];
} {
  const sorted = [...ports].sort((a, b) => {
    const ka = portSortKey(a.name);
    const kb = portSortKey(b.name);
    for (let i = 0; i < 3; i++) {
      if (ka[i] !== kb[i]) return ka[i] - kb[i];
    }
    return 0;
  });

  const gigabit: ParsedSwitchPort[] = [];
  const tenG: ParsedSwitchPort[] = [];
  for (const p of sorted) {
    const m = p.name.match(/^(\d+)\/(\d+)\/(\d+)$/);
    const n = m ? parseInt(m[3], 10) : 0;
    if (n >= 25) tenG.push(p);
    else gigabit.push(p);
  }
  return { gigabit, tenG };
}

/**
 * 前面板两排：与常见机框一致，上排为奇数口、下排为偶数口（按名称末段 `槽/槽/口` 的「口」判断）。
 * 例：1、3、5… 在上排，2、4、6… 在下排。无法解析 `d/d/d` 的接口按原顺序前后均分。
 */
function splitIntoTwoRows(ports: ParsedSwitchPort[]): [ParsedSwitchPort[], ParsedSwitchPort[]] {
  if (ports.length === 0) return [[], []];

  const sortByKey = (a: ParsedSwitchPort, b: ParsedSwitchPort) => {
    const ka = portSortKey(a.name);
    const kb = portSortKey(b.name);
    for (let j = 0; j < 3; j++) {
      if (ka[j] !== kb[j]) return ka[j] - kb[j];
    }
    return 0;
  };

  const top: ParsedSwitchPort[] = [];
  const bottom: ParsedSwitchPort[] = [];
  const noSlotPort: ParsedSwitchPort[] = [];

  for (const p of ports) {
    const m = p.name.match(/^(\d+)\/(\d+)\/(\d+)$/);
    if (!m) {
      noSlotPort.push(p);
      continue;
    }
    const n = parseInt(m[3], 10);
    if (n % 2 === 1) top.push(p);
    else bottom.push(p);
  }

  top.sort(sortByKey);
  bottom.sort(sortByKey);

  if (noSlotPort.length > 0) {
    const mid = Math.ceil(noSlotPort.length / 2);
    top.push(...noSlotPort.slice(0, mid));
    bottom.push(...noSlotPort.slice(mid));
  }

  return [top, bottom];
}

/** 与 portRowGridStyle 一致：列宽上限 64px、间距 8px — 用于端口面板抽屉宽度估算 */
const PORT_CELL_MAX_PX = 64;
const PORT_GRID_GAP_PX = 8;

function estimatePortRowWidthPx(colCount: number): number {
  if (colCount <= 0) return 0;
  return colCount * PORT_CELL_MAX_PX + Math.max(0, colCount - 1) * PORT_GRID_GAP_PX;
}

function estimateZoneBlockWidthPx(ports: ParsedSwitchPort[]): number {
  if (ports.length === 0) return 0;
  const [top, bottom] = splitIntoTwoRows(ports);
  return Math.max(estimatePortRowWidthPx(top.length), estimatePortRowWidthPx(bottom.length));
}

/**
 * 端口面板 Tab 下抽屉宽度：按千兆/万兆分区估算栅格宽，并计入 Tab 区左右 22px、机框内边距等。
 * 与已移除的 SwitchPanelVisualizationModal 宽度算法一致，额外加上抽屉 Tab 外包边。
 */
function computeSwitchPanelDrawerWidthCss(ports: ParsedSwitchPort[]): string {
  if (ports.length === 0) {
    return 'min(720px, 96vw)';
  }
  const zones = splitGigabitAndTenG(ports);
  let inner = 32;
  if (zones.gigabit.length > 0) inner += estimateZoneBlockWidthPx(zones.gigabit);
  if (zones.tenG.length > 0) inner += estimateZoneBlockWidthPx(zones.tenG);
  if (zones.gigabit.length > 0 && zones.tenG.length > 0) {
    inner += 33;
  }
  const modalLikeChrome = 56;
  const tabScrollHorizontalPadding = 44;
  const raw = inner + modalLikeChrome + tabScrollHorizontalPadding;
  const minW = 520;
  const maxW = 1920;
  const clamped = Math.round(Math.min(maxW, Math.max(minW, raw)));
  return `min(${clamped}px, 98vw)`;
}

function PortTile({ p, muted }: { p: ParsedSwitchPort; muted?: boolean }) {
  const kind = classifyPortStatus(p.status);
  const vis = PORT_VISUAL[kind];
  const sub =
    p.detectedSpeedMbps != null ? `检测 ${p.detectedSpeedMbps} Mbps` : '无载波 / 未协商';
  return (
    <Tooltip
      title={
        <div>
          <div>
            <strong>{p.name}</strong>
          </div>
          {muted ? (
            <div style={{ marginTop: 6, opacity: 0.95 }}>
              未加入当前所选 VLAN（相对回显成员列表）
            </div>
          ) : null}
          {p.adminStatus ? <div>Admin：{p.adminStatus}</div> : null}
          {p.autoNegotiation ? <div>自协商：{p.autoNegotiation}</div> : null}
          <div>链路判定：{p.status}</div>
          <div>{sub}</div>
          {p.configuredSpeedMbps ? (
            <div>
              配置速率：{p.configuredSpeedMbps}
              {p.configuredDuplex ? ` ${p.configuredDuplex}` : ''}
            </div>
          ) : null}
          {p.speed ? <div>摘要：{p.speed}</div> : null}
          <div style={{ marginTop: 4, opacity: 0.85 }}>{p.rawLine}</div>
        </div>
      }
    >
      <div
        style={{
          border: muted
            ? `2px solid ${PANEL_UI.chassisBorder}`
            : `2px solid ${vis.border}`,
          background: muted ? 'rgba(110, 118, 129, 0.12)' : vis.background,
          borderRadius: 8,
          padding: '8px 4px',
          textAlign: 'center',
          cursor: 'default',
          minHeight: 56,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: 2,
          opacity: muted ? 0.5 : 1,
          filter: muted ? 'grayscale(40%)' : undefined,
        }}
      >
        <Typography.Text
          ellipsis
          style={{
            fontSize: 11,
            lineHeight: 1.2,
            display: 'block',
            color: muted ? PANEL_UI.textMuted : PANEL_UI.text,
          }}
        >
          {p.name.replace(/^(\d+\/\d+\/)(\d+)$/, '$2')}
        </Typography.Text>
        <Typography.Text
          style={{
            fontSize: 10,
            lineHeight: 1.1,
            color: PANEL_UI.textMuted,
            opacity: muted ? 0.85 : 1,
          }}
        >
          {vis.label}
        </Typography.Text>
      </div>
    </Tooltip>
  );
}

/** 每排固定列数 = 端口数，宽度随内容伸缩，避免父级均分半宽时 auto-fill 被迫换行 */
function portRowGridStyle(colCount: number): React.CSSProperties {
  if (colCount <= 0) return { display: 'none' };
  return {
    display: 'grid',
    gridTemplateColumns: `repeat(${colCount}, minmax(52px, 64px))`,
    gap: 8,
    width: 'max-content',
  };
}

function TwoRowPortBlock({
  title,
  subtitle,
  ports,
  keyPrefix,
  portMuted,
}: {
  title: string;
  subtitle?: string;
  ports: ParsedSwitchPort[];
  keyPrefix: string;
  /** 选中 VLAN 时：返回 true 表示该端口不在此 VLAN 成员中，需置灰 */
  portMuted?: (p: ParsedSwitchPort) => boolean;
}) {
  const [top, bottom] = splitIntoTwoRows(ports);
  return (
    <div
      style={{
        flex: '0 0 auto',
        width: 'max-content',
        maxWidth: '100%',
        overflowX: 'auto',
        padding: 0,
      }}
    >
      <Typography.Text
        strong
        style={{ display: 'block', marginBottom: subtitle ? 2 : 10, color: PANEL_UI.text }}
      >
        {title}
      </Typography.Text>
      {subtitle ? (
        <Typography.Text style={{ display: 'block', marginBottom: 10, fontSize: 12, color: PANEL_UI.textMuted }}>
          {subtitle}
        </Typography.Text>
      ) : null}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: 'max-content' }}>
        <div style={portRowGridStyle(top.length)}>
          {top.map((p, idx) => (
            <PortTile
              key={`${keyPrefix}-t-${idx}-${p.name}`}
              p={p}
              muted={portMuted ? portMuted(p) : false}
            />
          ))}
        </div>
        {bottom.length > 0 ? (
          <div style={portRowGridStyle(bottom.length)}>
            {bottom.map((p, idx) => (
              <PortTile
                key={`${keyPrefix}-b-${idx}-${p.name}`}
                p={p}
                muted={portMuted ? portMuted(p) : false}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}


/** 端口面板 Tab（原 SwitchPanelVisualizationModal 正文，无 Modal 壳） */
const SwitchPortPanelTabContent: React.FC<{ record: any; drawerOpen: boolean }> = ({
  record,
  drawerOpen,
}) => {
  const [vlanFilter, setVlanFilter] = useState<string>('');

  const extracted = useMemo(
    () => (record ? extractInterfacesStdoutFromRecord(record) : null),
    [record],
  );

  const ports: ParsedSwitchPort[] = useMemo(() => {
    if (!extracted?.stdout) return [];
    return parseInterfaceStatusStdout(extracted.stdout);
  }, [extracted]);

  const vlanMembership = useMemo(() => {
    if (!record || record.vlansError || record.vlansNotApplicable) return [];
    const ve = extractVlansStdoutFromRecord(record);
    if (!ve?.stdout?.trim()) return [];
    return parseVlanMembershipStdout(ve.stdout);
  }, [record]);

  const recordPanelKey = useMemo(() => {
    if (!record) return '';
    const h = switchRecordManagementHost(record);
    const n = record.name != null ? String(record.name) : '';
    return `${h}\0${n}`;
  }, [record]);

  useEffect(() => {
    setVlanFilter('');
  }, [recordPanelKey]);

  /** 选中 VLAN 时：成员端口名集合；未选时为 null（不限定，不置灰） */
  const vlanMemberPortSet = useMemo(() => {
    if (!vlanFilter) return null;
    const row = vlanMembership.find((v) => v.vlanId === vlanFilter);
    if (!row) return new Set<string>();
    return new Set(row.ports.map((x) => x.trim()).filter(Boolean));
  }, [vlanFilter, vlanMembership]);

  const portMuted = useMemo(() => {
    if (vlanMemberPortSet === null) return undefined;
    return (p: ParsedSwitchPort) => !vlanMemberPortSet.has(p.name.trim());
  }, [vlanMemberPortSet]);

  const panelZones = useMemo(() => splitGigabitAndTenG(ports), [ports]);

  const vlanSelectOptions = useMemo(
    () =>
      vlanMembership.map((v) => ({
        value: v.vlanId,
        label:
          v.name && v.name !== `VLAN ${v.vlanId}`
            ? `VLAN ${v.vlanId} · ${v.name}`
            : `VLAN ${v.vlanId}`,
      })),
    [vlanMembership],
  );

  const vlanFilterHint = useMemo(() => {
    if (!vlanFilter || !ports.length) return null;
    const row = vlanMembership.find((v) => v.vlanId === vlanFilter);
    if (!row) return null;
    if (row.ports.length === 0) {
      return '该 VLAN 未解析到成员端口，前面板端口已全部置灰。';
    }
    const memberOnPanel = ports.filter((p) =>
      row.ports.some((x) => x.trim() === p.name.trim()),
    ).length;
    if (memberOnPanel === 0) {
      return '该 VLAN 的成员端口均不在当前前面板列表中，端口已全部置灰。';
    }
    return null;
  }, [vlanFilter, ports, vlanMembership]);

  const nameFromInfo = useMemo(
    () => (record ? parseSwitchDisplayNameFromInfoLines(record.info?.lines) : ''),
    [record],
  );

  useEffect(() => {
    if (!drawerOpen || !record) return;
    const h = switchRecordManagementHost(record);
    if (!h || h === '—' || !nameFromInfo) return;
    try {
      sessionStorage.setItem(`${ASWCTL_SWITCH_NAME_STORAGE}${h}`, nameFromInfo);
    } catch {
      /* ignore */
    }
  }, [drawerOpen, record, nameFromInfo]);

  const switchDisplayName = useMemo(() => {
    if (nameFromInfo) return nameFromInfo;
    if (!record) return '';
    const h = switchRecordManagementHost(record);
    if (!h || h === '—') return '';
    try {
      return sessionStorage.getItem(`${ASWCTL_SWITCH_NAME_STORAGE}${h}`) || '';
    } catch {
      return '';
    }
  }, [nameFromInfo, record]);

  const perfMetrics = useMemo(() => (record ? buildPerformanceMetrics(record) : {}), [record]);
  const hasPerfMetrics = !!(
    perfMetrics.cpu ||
    perfMetrics.memory ||
    perfMetrics.temperature ||
    perfMetrics.fan ||
    perfMetrics.psu
  );

  if (!record) return null;

  const interfacesFailed = !!record?.interfacesError;
  const showWinicssecBrand = isWinicssecSwitchRecord(record);

  return (
    <div style={{ ...TAB_PANEL_PADDING, width: '100%' }}>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        {hasPerfMetrics && ports.length === 0 ? (
          <PerformanceMetricsStrip metrics={perfMetrics} />
        ) : null}

        {interfacesFailed ? (
          <Alert
            type="error"
            showIcon
            message="无法绘制端口：接口探测未成功"
            description={record.interfacesError}
          />
        ) : null}

        {!interfacesFailed && ports.length === 0 && extracted?.stdout ? (
          <Alert
            type="info"
            showIcon
            message="未能从 CLI 输出解析端口表"
            description="当前输出格式可能非已知表格样式。"
          />
        ) : null}

        {!interfacesFailed && ports.length === 0 && !extracted?.stdout ? (
          <Alert type="warning" showIcon message="无接口探测 stdout，暂无端口可展示" />
        ) : null}

        {ports.length > 0 ? (
          <div
            className="physical-switch-chassis"
            style={{
              border: `1px solid ${PANEL_UI.chassisBorder}`,
              borderRadius: 12,
              padding: 16,
              background: PANEL_UI.chassis,
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
            }}
          >
            <style>{`
              .physical-switch-chassis .physical-switch-panel-vlan-select.ant-select-outlined .ant-select-selector,
              .physical-switch-chassis .physical-switch-panel-vlan-select .ant-select-selector {
                background: transparent !important;
                border: none !important;
                border-bottom: 1px solid ${PANEL_UI.chassisBorder} !important;
                border-radius: 0 !important;
                color: ${PANEL_UI.text} !important;
                box-shadow: none !important;
              }
              .physical-switch-chassis .physical-switch-panel-vlan-select.ant-select:hover .ant-select-selector {
                border-bottom-color: rgba(230, 237, 243, 0.35) !important;
              }
              .physical-switch-chassis .physical-switch-panel-vlan-select.ant-select-focused .ant-select-selector,
              .physical-switch-chassis .physical-switch-panel-vlan-select.ant-select-open .ant-select-selector {
                border-bottom-color: ${UI.accent} !important;
              }
              .physical-switch-chassis .physical-switch-panel-vlan-select .ant-select-selection-placeholder {
                color: ${PANEL_UI.textMuted} !important;
              }
              .physical-switch-chassis .physical-switch-panel-vlan-select .ant-select-selection-item {
                color: ${PANEL_UI.text} !important;
                overflow: hidden;
                text-overflow: ellipsis;
              }
              .physical-switch-chassis .physical-switch-panel-vlan-select .ant-select-arrow {
                color: ${PANEL_UI.textMuted};
              }
              .physical-switch-chassis .physical-switch-panel-vlan-select .ant-select-clear {
                color: ${PANEL_UI.textMuted};
                background: transparent;
              }
              .physical-switch-panel-vlan-select-dropdown.ant-select-dropdown {
                background: #1c2128 !important;
                border: 1px solid ${PANEL_UI.chassisBorder};
                padding: 4px;
                min-width: 200px !important;
              }
              .physical-switch-panel-vlan-select-dropdown .rc-virtual-list-holder-inner {
                gap: 2px;
              }
              .physical-switch-panel-vlan-select-dropdown .ant-select-item {
                color: ${PANEL_UI.text};
                border-radius: 6px;
              }
              .physical-switch-panel-vlan-select-dropdown .ant-select-item-option-active {
                background: rgba(255, 255, 255, 0.06) !important;
              }
              .physical-switch-panel-vlan-select-dropdown .ant-select-item-option-selected:not(.ant-select-item-option-disabled) {
                background: rgba(88, 166, 255, 0.14) !important;
                font-weight: 500;
              }
            `}</style>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                marginBottom: 12,
                flexWrap: 'wrap',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 10,
                  flex: 1,
                  minWidth: 0,
                }}
              >
                <Typography.Text strong style={{ color: PANEL_UI.text }}>
                  {switchDisplayName || '前面板'}
                </Typography.Text>
                {vlanSelectOptions.length > 0 ? (
                  <span title="按 VLAN 筛选端口" style={{ flex: '0 0 auto' }}>
                    <Select
                      className="physical-switch-panel-vlan-select"
                      size="small"
                      allowClear
                      placeholder="VLAN"
                      value={vlanFilter || undefined}
                      onChange={(v) => setVlanFilter(v ?? '')}
                      options={vlanSelectOptions}
                      popupMatchSelectWidth={false}
                      popupClassName="physical-switch-panel-vlan-select-dropdown"
                      style={{ width: 112 }}
                    />
                  </span>
                ) : null}
              </div>
              {showWinicssecBrand ? (
                <div
                  title="Winicssec 威努特"
                  style={{
                    flexShrink: 0,
                    lineHeight: 0,
                    background: 'rgba(255,255,255,0.94)',
                    borderRadius: 6,
                    padding: '5px 10px',
                    border: `1px solid ${PANEL_UI.chassisBorder}`,
                  }}
                >
                  <img
                    src={winicssecLogo}
                    alt="Winicssec"
                    style={{
                      height: 22,
                      width: 'auto',
                      maxWidth: 'min(180px, 32vw)',
                      objectFit: 'contain',
                      display: 'block',
                    }}
                  />
                </div>
              ) : null}
            </div>
            {vlanFilterHint ? (
              <Typography.Text
                type="secondary"
                style={{ display: 'block', marginBottom: 10, fontSize: 12 }}
              >
                {vlanFilterHint}
              </Typography.Text>
            ) : null}
            {hasPerfMetrics ? <PerformanceMetricsStrip metrics={perfMetrics} /> : null}
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                flexWrap: 'wrap',
                gap: 0,
                width: '100%',
                overflowX: 'auto',
              }}
            >
              {panelZones.gigabit.length > 0 ? (
                <div style={{ flex: '0 0 auto', alignSelf: 'flex-start' }}>
                  <TwoRowPortBlock
                    title="千兆"
                    ports={panelZones.gigabit}
                    keyPrefix="gb"
                    portMuted={portMuted}
                  />
                </div>
              ) : null}
              {panelZones.gigabit.length > 0 && panelZones.tenG.length > 0 ? (
                <div
                  aria-hidden
                  style={{
                    width: 1,
                    flexShrink: 0,
                    alignSelf: 'stretch',
                    margin: '4px 16px',
                    background: PANEL_UI.chassisBorder,
                    minHeight: 48,
                  }}
                />
              ) : null}
              {panelZones.tenG.length > 0 ? (
                <div style={{ flex: '0 0 auto', alignSelf: 'flex-start' }}>
                  <TwoRowPortBlock
                    title="万兆"
                    ports={panelZones.tenG}
                    keyPrefix="10g"
                    portMuted={portMuted}
                  />
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </Space>
    </div>
  );
};

const PhysicalSwitchDetailDrawer: React.FC<PhysicalSwitchDetailDrawerProps> = ({
  open,
  record,
  onClose,
  initialTab = 'overview',
  onRefreshFromCluster,
  refreshLoading = false,
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'cli' | 'panel'>('overview');
  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      setActiveTab(initialTab ?? 'overview');
    }
    prevOpenRef.current = open;
  }, [open, initialTab]);

  const drawerWidthCss = useMemo(() => {
    if (!record || activeTab !== 'panel') {
      return 'min(1000px, 96vw)';
    }
    const extracted = extractInterfacesStdoutFromRecord(record);
    const ports = extracted?.stdout ? parseInterfaceStatusStdout(extracted.stdout) : [];
    return computeSwitchPanelDrawerWidthCss(ports);
  }, [record, activeTab]);

  const host = record ? switchRecordManagementHost(record) : '—';
  const displayName = useMemo(
    () => (record ? parseSwitchDisplayNameFromInfoLines(record.info?.lines) : ''),
    [record],
  );
  const profile = record ? switchRecordDeviceProfile(record) : '';
  const showBrand = record ? isWinicssecSwitchRecord(record) : false;

  const kpiInfoTone: KpiTone = !record
    ? 'muted'
    : record.infoError || (record.info && record.info.ok === false)
      ? 'err'
      : record.info
        ? 'ok'
        : 'muted';
  const kpiIfTone: KpiTone = !record
    ? 'muted'
    : record.interfacesError || (record.interfaces && record.interfaces.ok === false)
      ? 'err'
      : record.interfaces
        ? 'ok'
        : 'muted';
  const kpiPerfTone: KpiTone = !record
    ? 'muted'
    : record.performanceError
      ? 'err'
      : record.performanceNotApplicable
        ? 'warn'
        : record.performance && record.performance.ok === false
          ? 'err'
          : record.performance
            ? 'ok'
            : 'muted';
  const kpiProfileTone: KpiTone = !record
    ? 'muted'
    : record.deviceProfilesError
      ? 'err'
      : record.deviceProfiles
        ? 'ok'
        : 'muted';
  const kpiVlanTone: KpiTone = !record
    ? 'muted'
    : record.vlansError
      ? 'err'
      : record.vlansNotApplicable
        ? 'warn'
        : record.vlans && record.vlans.ok === false
          ? 'err'
          : record.vlans
            ? 'ok'
            : 'muted';

  const tabItems = useMemo(() => {
    if (!record) return [];
    return [
      {
        key: 'overview',
        label: '概览',
        children: (
          <div style={TAB_PANEL_PADDING}>
            <Descriptions
              bordered
              size="small"
              column={1}
              labelStyle={{ width: 120, background: 'rgba(0,0,0,0.02)' }}
            >
              <Descriptions.Item label="ASW-CTL 名称">
                {record.name != null && String(record.name).trim() ? record.name : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="服务地址">
                {record.baseUrl ? (
                  <Typography.Text copyable={{ text: record.baseUrl }} code>
                    {record.baseUrl}
                  </Typography.Text>
                ) : (
                  '—'
                )}
              </Descriptions.Item>
              <Descriptions.Item label="设备模板">{profile || '—'}</Descriptions.Item>
              <Descriptions.Item label="管理地址">
                {host !== '—' ? (
                  <Typography.Text copyable={{ text: host }} code>
                    {host}
                  </Typography.Text>
                ) : (
                  '—'
                )}
              </Descriptions.Item>
            </Descriptions>
          </div>
        ),
      },
      {
        key: 'cli',
        label: '系统信息',
        children: (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, ...TAB_PANEL_PADDING }}>
            {record.healthError ? (
              <Alert
                type="error"
                showIcon
                message={`服务健康探测失败${record.healthHttpStatus ? `（HTTP ${record.healthHttpStatus}）` : ''}`}
                description={`${record.healthPath ? `${record.healthPath}：` : ''}${record.healthError}`}
              />
            ) : null}
            {record.openapiYamlError ? (
              <Alert
                type="error"
                showIcon
                message={`OpenAPI 探测失败${record.openapiYamlHttpStatus ? `（HTTP ${record.openapiYamlHttpStatus}）` : ''}`}
                description={record.openapiYamlError}
              />
            ) : null}
            {record.infoError ? (
              <Alert
                type="error"
                showIcon
                message={`基本信息探测失败${record.infoHttpStatus ? `（HTTP ${record.infoHttpStatus}）` : ''}`}
                description={record.infoError}
              />
            ) : null}
            {record.interfacesError ? (
              <Alert
                type="error"
                showIcon
                message={`接口探测失败${record.interfacesHttpStatus ? `（HTTP ${record.interfacesHttpStatus}）` : ''}`}
                description={record.interfacesError}
              />
            ) : null}
            {record.performanceError ? (
              <Alert
                type="error"
                showIcon
                message={`性能探测失败${record.performanceHttpStatus ? `（HTTP ${record.performanceHttpStatus}）` : ''}`}
                description={record.performanceError}
              />
            ) : null}
            {record.deviceProfilesError ? (
              <Alert
                type="error"
                showIcon
                message={`设备 Profile 失败${record.deviceProfilesHttpStatus ? `（HTTP ${record.deviceProfilesHttpStatus}）` : ''}`}
                description={record.deviceProfilesError}
              />
            ) : null}
            {record.vlansError ? (
              <Alert
                type="error"
                showIcon
                message={`VLAN 查询失败${record.vlansHttpStatus ? `（HTTP ${record.vlansHttpStatus}）` : ''}`}
                description={record.vlansError}
              />
            ) : null}

            {record.healthNotApplicable ? (
              <Alert type="info" showIcon message={record.healthNaMessage || '未提供标准健康路径'} />
            ) : record.health != null ? (
              <Collapse
                size="small"
                items={[
                  {
                    key: 'health',
                    label: `服务健康（${record.healthPath || 'ok'}）`,
                    children: (
                      <pre
                        style={{
                          margin: 0,
                          fontSize: 12,
                          maxHeight: 280,
                          overflow: 'auto',
                        }}
                      >
                        {typeof record.health === 'string'
                          ? record.health
                          : JSON.stringify(record.health, null, 2)}
                      </pre>
                    ),
                  },
                ]}
              />
            ) : null}

            {record.openapiNotApplicable ? (
              <Alert type="info" showIcon message={record.openapiNaMessage || '未提供 OpenAPI 文档'} />
            ) : null}

            {record.infoError ? null : (
              <AswCliOutputCollapse title="基本信息" lines={record.info?.lines || []} />
            )}
            {record.interfacesError ? null : (
              <AswCliOutputCollapse title="接口状态" lines={record.interfaces?.lines || []} />
            )}
            {record.performanceError ? null : record.performanceNotApplicable ? (
              <Alert
                type="info"
                showIcon
                message={record.performanceNaMessage || '性能探测未配置（HTTP 503）'}
              />
            ) : (
              <AswCliOutputCollapse title="性能/健康" lines={record.performance?.lines || []} />
            )}

            {record.deviceProfilesError ? null : record.deviceProfiles != null ? (
              <Collapse
                size="small"
                items={[
                  {
                    key: 'profiles',
                    label: 'GET /v1/device/profiles 响应',
                    children: (
                      <pre
                        style={{
                          margin: 0,
                          fontSize: 12,
                          maxHeight: 360,
                          overflow: 'auto',
                        }}
                      >
                        {JSON.stringify(record.deviceProfiles, null, 2)}
                      </pre>
                    ),
                  },
                ]}
              />
            ) : null}

            {record.vlansError ? null : record.vlansNotApplicable ? (
              <Alert
                type="info"
                showIcon
                message={
                  record.vlansNaMessage ||
                  'HTTP 404：当前服务上无 GET /v1/switch/vlans路由（多为未升级、路径或地址指错）。'
                }
              />
            ) : null}
            {record.vlansError || record.vlansNotApplicable ? null : (
              <AswCliOutputCollapse title="VLAN CLI 回显" lines={record.vlans?.lines || []} />
            )}
          </div>
        ),
      },
      {
        key: 'panel',
        label: '端口面板',
        children: <SwitchPortPanelTabContent record={record} drawerOpen={open} />,
      },
    ];
  }, [record, open]);

  return (
    <>
      <style>{`
        .physical-switch-detail-drawer-scroll::-webkit-scrollbar { width: 6px; height: 6px; }
        .physical-switch-detail-drawer-scroll::-webkit-scrollbar-track { background: transparent; }
        .physical-switch-detail-drawer-scroll::-webkit-scrollbar-thumb { background: #e0e0e0; border-radius: 3px; }
        .physical-switch-detail-drawer-scroll::-webkit-scrollbar-thumb:hover { background: #ccc; }
        .physical-switch-detail-drawer-scroll .ant-tabs-content-holder { padding: 0; }
        .physical-switch-detail-drawer-scroll[data-active-tab="panel"] {
          display: flex;
          flex-direction: column;
        }
        .physical-switch-detail-drawer-scroll[data-active-tab="panel"] > .ant-tabs {
          flex: 1;
          min-height: 0;
          display: flex;
          flex-direction: column;
        }
        .physical-switch-detail-drawer-scroll[data-active-tab="panel"] .ant-tabs-content-holder {
          flex: 1;
          min-height: 0;
          display: flex;
          flex-direction: column;
        }
        .physical-switch-detail-drawer-scroll[data-active-tab="panel"] .ant-tabs-content {
          flex: 1;
          min-height: 0;
        }
        .physical-switch-detail-drawer-scroll[data-active-tab="panel"] .ant-tabs-tabpane-active {
          height: 100%;
          display: flex !important;
          flex-direction: column;
          justify-content: center;
          overflow: auto;
        }
        /* 相对几何居中略上移（居中偏上） */
        .physical-switch-detail-drawer-scroll[data-active-tab="panel"] .ant-tabs-tabpane-active > div {
          transform: translateY(calc(-1 * min(4vh, 40px)));
        }
      `}</style>
      <Drawer
        title={null}
        placement="right"
        width={drawerWidthCss}
        open={open && !!record}
        onClose={onClose}
        closable={false}
        destroyOnHidden
        styles={{
          body: {
            padding: 0,
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            maxHeight: '100vh',
            overflow: 'hidden',
            background: UI.bodyBg,
          },
        }}
      >
        {record ? (
          <>
          <div
            style={{
              flexShrink: 0,
              background: `linear-gradient(145deg, ${UI.shell} 0%, ${UI.shellMuted} 100%)`,
              color: UI.text,
              padding: '20px 22px 18px',
              borderBottom: `1px solid ${UI.border}`,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <Typography.Text
                style={{
                  fontSize: 12,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  color: UI.textMuted,
                  flexShrink: 0,
                }}
              >
                ASW-CTL 物理交换机
              </Typography.Text>
              <div
                style={{
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  flexWrap: 'wrap',
                  gap: 8,
                  marginLeft: 'auto',
                }}
              >
                {onRefreshFromCluster ? (
                  <Button
                    type="text"
                    size="small"
                    onClick={() => onRefreshFromCluster()}
                    loading={refreshLoading}
                    style={heroActionTextPrimary}
                  >
                    刷新
                  </Button>
                ) : null}
                <Button
                  type="text"
                  size="small"
                  aria-label="关闭"
                  onClick={onClose}
                  style={{ color: UI.textMuted, fontSize: 12, paddingInline: 0, height: 'auto' }}
                >
                  关闭
                </Button>
              </div>
            </div>
            <Typography.Title
              level={4}
              style={{
                color: UI.text,
                margin: '6px 0 0',
                fontWeight: 600,
                lineHeight: 1.35,
                wordBreak: 'break-word',
              }}
            >
              {displayName || host}
            </Typography.Title>

            <div
              style={{
                marginTop: 14,
                paddingTop: 14,
                borderTop: `1px solid ${UI.border}`,
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: '10px 14px',
              }}
            >
              {showBrand ? (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '8px 14px',
                    borderRadius: 10,
                    background: '#e8edf5',
                    border: '1px solid rgba(255, 255, 255, 0.55)',
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.65)',
                  }}
                >
                  <img src={winicssecLogo} alt="" style={{ height: 22, display: 'block' }} />
                </span>
              ) : null}
              <Typography.Text style={{ color: UI.textMuted, fontSize: 13, marginRight: 4 }}>
                管理地址
                {host !== '—' ? (
                  <>
                    {' '}
                    <Typography.Text
                      copyable={{ text: host }}
                      style={{ color: UI.accent, fontSize: 13 }}
                    >
                      {host}
                    </Typography.Text>
                  </>
                ) : (
                  ' —'
                )}
              </Typography.Text>
              <Space size={[8, 8]} wrap style={{ flex: '1 1 200px', minWidth: 0 }}>
                {aswCtlServiceHealthTag(record)}
                {aswCtlOpenapiTag(record)}
              </Space>
            </div>

            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'stretch',
                marginTop: 14,
                paddingTop: 14,
                borderTop: `1px solid ${UI.border}`,
              }}
            >
              <PulseStat label="基本信息" tone={kpiInfoTone}>
                {record.infoError
                  ? '失败'
                  : record.info && record.info.ok === false
                    ? '失败'
                    : record.info
                      ? '成功'
                      : '—'}
              </PulseStat>
              <div aria-hidden style={HERO_KPI_DIVIDER} />
              <PulseStat label="接口状态" tone={kpiIfTone}>
                {record.interfacesError
                  ? '失败'
                  : record.interfaces && record.interfaces.ok === false
                    ? '失败'
                    : record.interfaces
                      ? '成功'
                      : '—'}
              </PulseStat>
              <div aria-hidden style={HERO_KPI_DIVIDER} />
              <PulseStat label="性能探测" tone={kpiPerfTone}>
                {record.performanceError
                  ? '失败'
                  : record.performanceNotApplicable
                    ? '未配置'
                    : record.performance && record.performance.ok === false
                      ? '失败'
                      : record.performance
                        ? '成功'
                        : '—'}
              </PulseStat>
              <div aria-hidden style={HERO_KPI_DIVIDER} />
              <PulseStat label="设备 Profile" tone={kpiProfileTone}>
                {record.deviceProfilesError ? '失败' : record.deviceProfiles ? '成功' : '—'}
              </PulseStat>
              <div aria-hidden style={HERO_KPI_DIVIDER} />
              <PulseStat label="VLAN 查询" tone={kpiVlanTone}>
                {record.vlansError
                  ? '失败'
                  : record.vlansNotApplicable
                    ? '未提供'
                    : record.vlans && record.vlans.ok === false
                      ? '失败'
                      : record.vlans
                        ? '成功'
                        : '—'}
              </PulseStat>
            </div>
          </div>

          <div
            className="physical-switch-detail-drawer-scroll"
            data-active-tab={activeTab}
            style={DRAWER_TAB_SCROLL_BODY}
          >
            <Tabs activeKey={activeTab} onChange={(k) => setActiveTab(k as typeof activeTab)} items={tabItems} tabBarStyle={TAB_BAR_STYLE} />
          </div>
        </>
      ) : null}
      </Drawer>
    </>
  );
};

export default PhysicalSwitchDetailDrawer;
