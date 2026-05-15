/** Ceph 存储集群仪表盘：Rook bundle + 节点列表为主；可选合并 mgr Dashboard `api/health/minimal`（客户端性能等）。 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Card, Col, Flex, Progress, Row, Skeleton, Space, Statistic, Tooltip, Typography } from 'antd';
import {
  ApiTwoTone,
  AppstoreTwoTone,
  CheckCircleOutlined,
  CloseCircleOutlined,
  CloudTwoTone,
  ContainerTwoTone,
  DashboardTwoTone,
  EyeTwoTone,
  FundTwoTone,
  HddTwoTone,
  InfoCircleOutlined,
  ProjectTwoTone,
  SecurityScanTwoTone,
  WarningOutlined,
} from '@ant-design/icons';
import type { EChartsOption, LineSeriesOption } from 'echarts';
import ReactECharts from 'echarts-for-react';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import { fetchCephRookBundle } from '../../../../../../services/cephApi';
import { fetchCephDashboardSummary, fetchNodeResources } from '../../../../../../services/monitoringApi';
import { buildCephLandingModel, formatBps, formatIops } from '../lib/cephDashboardLanding';
import {
  buildRookCephOverviewLandingInputs,
  countSteveListItems,
  mergeCephDashboardMinimalIntoRookMinimal,
  cephBlockPoolRowToTableRow,
  cephBlockPoolToRow,
  fmtBytesFromUnknown,
  formatCephPoolCardSummaryLineZh,
  normalizeCephBundle,
  type CephPoolTableRow,
} from '../lib/cephStorage';

type CephOverviewSummaryEnvelope = {
  data: unknown | null;
  _tower?: { source?: string; cephDashboardError?: boolean | string; unreachable?: boolean; message?: string };
};

/** 本节卡片栅格 gutter 与卡片行纵向间距共用，保证横纵相等 */
const CARD_GAP = 16;
/** 与资源总览 `OverviewDashboard` 的 `DASH_CARD_SHADOW` 一致 */
const CEPH_DASH_CARD_SHADOW = '0 4px 12px rgba(0, 0, 0, 0.08)';
/** MetricCard / 裸容量 body：最小高度，内容在 body 内垂直居中（超出时仍向下撑开） */
const CEPH_CARD_BODY_MIN_HEIGHT_PX = 96;
const CEPH_CARD_BODY_LAYOUT: React.CSSProperties = {
  minHeight: CEPH_CARD_BODY_MIN_HEIGHT_PX,
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
};
/** 本节 MetricCard 与裸容量等 Card 的标题字号统一 */
const CEPH_SECTION_CARD_TITLE_FONT_PX = 14;
/** 标题双色 icon：主路径 + 辅块（对齐 Ant Primary / Primary-bg hover 阶） */
const CEPH_CARD_TITLE_TWO_TONE: [string, string] = [
  'var(--ant-color-primary, #1677ff)',
  'var(--ant-color-primary-bg-hover, #bae0ff)',
];
/** Card 标题 TwoTone icon 字号 */
const CEPH_CARD_TITLE_ICON_STYLE: React.CSSProperties = {
  fontSize: CEPH_SECTION_CARD_TITLE_FONT_PX + 2,
};
type CephDashboardTitleIconCmp = React.ComponentType<{
  style?: React.CSSProperties;
  className?: string;
  twoToneColor?: string | [string, string];
}>;

function cephDashboardCardTitle(Icon: CephDashboardTitleIconCmp, children: React.ReactNode): React.ReactNode {
  return (
    <Space align="center" size={8} wrap>
      <Icon style={CEPH_CARD_TITLE_ICON_STYLE} twoToneColor={CEPH_CARD_TITLE_TWO_TONE} aria-hidden />
      {children}
    </Space>
  );
}
/** 同类 MetricCard：主指标与辅文统一字号，避免同排卡片视觉不一致 */
const CEPH_CARD_PRIMARY = { fontSize: 20, lineHeight: 1.35 } as const;
const CEPH_CARD_SECONDARY = { fontSize: 12, lineHeight: 1.45 } as const;
/** 单一大数字指标卡（存储池、每 OSD 的 PG 等） */
const CEPH_CAP_STAT_LARGE = { fontSize: 28 } as const;
/** 裸容量 Card：标题与内容区内边距与栅格内间距一致，避免「挤、散」不一 */
const CEPH_CAPACITY_ROW_CARD_STYLES = {
  header: { padding: '10px 14px', minHeight: 38 },
  body: { padding: '12px 14px', ...CEPH_CARD_BODY_LAYOUT },
  title: { fontSize: CEPH_SECTION_CARD_TITLE_FONT_PX, lineHeight: 1.4 },
} as const;
/** 裸容量：正文字号下限（含小标题、明细、条内百分比） */
const CEPH_CAP_TRIO_MIN_FONT_PX = 12;
/** 该行的 Statistic / 裸容量条内主数字略小于默认容量区 */
const CEPH_CAP_STAT_COMPACT = { fontSize: 16, lineHeight: 1.25 } as const;
/** 裸容量卡：左「总容量」按内容宽度、左对齐；右列占剩余宽度，两侧与 card padding 留白一致 */
const CEPH_CAP_RAW_GRID: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'max-content minmax(0, 1fr)',
  columnGap: 0,
  rowGap: 0,
  alignItems: 'center',
  justifyItems: 'stretch',
  width: '100%',
};
/** 列间竖线颜色（与 Ant Card 边框阶次接近）；用首列边框画线，`columnGap` 置 0，左右 `padding-inline` 对称留白 */
const CEPH_CAP_GRID_COL_DIVIDER_COLOR = 'rgba(0, 0, 0, 0.06)';
/** 裸容量栅格中线左右留白（等大，避免出现「单侧 columnGap」导致不对称） */
const CEPH_CAP_DIVIDER_INLINE_PAD_PX = 18;
/** 第 1 列小标题（与裸容量条说明同阶） */
const CEPH_CAP_LEAD_LABEL: React.CSSProperties = {
  fontSize: CEPH_CAP_TRIO_MIN_FONT_PX,
  lineHeight: 1.35,
  display: 'block',
  marginBottom: 6,
};
/** 第 1 列主数字 */
const CEPH_CAP_LEAD_VALUE: React.CSSProperties = {
  ...CEPH_CAP_STAT_COMPACT,
  display: 'block',
  wordBreak: 'break-word',
};
/** 裸容量 Card 外壳（阴影与全宽拉伸） */
const CEPH_CAP_TRIO_CARD_STYLE: React.CSSProperties = {
  flex: 1,
  width: '100%',
  boxShadow: CEPH_DASH_CARD_SHADOW,
};
/** 明细行（裸容量已用/可用；与条上文案同字号） */
const CEPH_CAP_DETAIL_LINE: React.CSSProperties = {
  fontSize: CEPH_CAP_TRIO_MIN_FONT_PX,
  lineHeight: 1.45,
  display: 'block',
};
const CEPH_DASHBOARD_FAIL_HINT = '请检查云实例连接与凭据后重试，或联系管理员。';

const MGR_ACTIVE_TOOLTIP =
  'ceph-mgr 同一时间只有 1 个 Active，其余为 Standby；卡片主数字为实例总数，辅文为 Active / 备用个数。' +
  '（不经 Dashboard 时 names 可能未知，故总览不展示长实例名。）';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** mgr_id 偶发为整段 `ceph version …` 文案，不适合在卡片里展示 */
function isLikelyCephVersionOrLongMgrLabel(s: string): boolean {
  return /ceph\s+version/i.test(s) || s.length > 36;
}

/** 与存储池表格 usagePct 一致：百分数轴上保留两位小数（0.98 表示 0.98%） */
function roundUsagePctTwoDecimals(pct: number): number {
  if (!Number.isFinite(pct)) return 0;
  const c = Math.min(100, Math.max(0, pct));
  return Math.round(c * 100) / 100;
}

function poolStatLatest(stats: any, key: string): number | null {
  const o = stats?.[key];
  if (o != null && typeof o === 'object' && typeof o.latest === 'number' && Number.isFinite(o.latest)) {
    return o.latest;
  }
  if (typeof o === 'number' && Number.isFinite(o)) return o;
  return null;
}

/** Dashboard `stats.xxx.rates` → [时间 ms, 采样值] */
function cephStatRatesMs(statsField: any): [number, number][] {
  const rates = statsField?.rates;
  if (!Array.isArray(rates)) return [];
  const out: [number, number][] = [];
  for (const pt of rates) {
    if (!Array.isArray(pt) || pt.length < 2) continue;
    const tSec = Number(pt[0]);
    const v = Number(pt[1]);
    if (!Number.isFinite(tSec) || !Number.isFinite(v)) continue;
    out.push([Math.round(tSec * 1000), v]);
  }
  return out;
}

/** 将两条 rates 按时间戳合并；避免按索引 zip 时把不同时间的 used/max_avail 配在一起 */
function mergePoolStatRatesByTimeMs(
  a: [number, number][],
  b: [number, number][],
): Map<number, { u?: number; m?: number }> {
  const map = new Map<number, { u?: number; m?: number }>();
  for (const [t, v] of a) {
    if (!Number.isFinite(t)) continue;
    const cur = map.get(t) ?? {};
    cur.u = v;
    map.set(t, cur);
  }
  for (const [t, v] of b) {
    if (!Number.isFinite(t)) continue;
    const cur = map.get(t) ?? {};
    cur.m = v;
    map.set(t, cur);
  }
  return map;
}

/** 与存储池表格 usagePct 一致（单点展示）；Dashboard 池与 Rook 行在 poolTableUsagePctDisplay 中共用公式 */
function poolTableUsagePctDisplay(pool: any): number | null {
  const stats = pool?.stats;
  if (!stats || typeof stats !== 'object') return null;
  const pctRaw = poolStatLatest(stats, 'percent_used');
  const used = poolStatLatest(stats, 'bytes_used');
  const maxAvail = poolStatLatest(stats, 'max_avail');
  if (pctRaw != null && Number.isFinite(pctRaw) && pctRaw >= 0) {
    const ratio = pctRaw > 1 ? pctRaw / 100 : pctRaw;
    return Math.round(ratio * 10000) / 100;
  }
  if (used != null && maxAvail != null && used + maxAvail > 0) {
    return Math.round((used / (used + maxAvail)) * 10000) / 100;
  }
  return null;
}

/**
 * 存储池使用率趋势：与表格同公式 **`bytes_used / (bytes_used + max_avail)`**（优先），
 * 否则 `percent_used`（仅单点路径在 poolTableUsagePctDisplay）。
 *
 * Ceph 常见：`rates` 里占位 0、缺一侧、或与 `latest` 量纲不一致；若只对一侧回填 `latest`、另一侧保留很小的正数，
 * 会得到虚假的 ~100%。因此：**任一侧需要用快照回填时，该时间点改为同时用 `buLatest` + `maLatest` 算占比**；
 * 且按 **时间戳合并** 两条序列，避免按索引错配不同采样时刻。
 */
function parsePoolUsageTrendPoints(pool: any): [number, number][] {
  const stats = pool?.stats;
  if (!stats || typeof stats !== 'object') return [];

  const buRates = cephStatRatesMs(stats.bytes_used);
  const maRates = cephStatRatesMs(stats.max_avail);
  const buLatest = poolStatLatest(stats, 'bytes_used');
  const maLatest = poolStatLatest(stats, 'max_avail');

  const merged = mergePoolStatRatesByTimeMs(buRates, maRates);
  const times = [...merged.keys()].sort((x, y) => x - y);
  const out: [number, number][] = [];
  const resolvePairAtTime = (uRaw: number | undefined, mRaw: number | undefined): { used: number; maxa: number } | null => {
    let usedFromSnapshot = false;
    let maxaFromSnapshot = false;

    let used: number;
    if (uRaw === undefined || !Number.isFinite(uRaw)) {
      if (buLatest == null) return null;
      used = buLatest;
      usedFromSnapshot = true;
    } else if (uRaw <= 0 && buLatest != null && buLatest > 0) {
      used = buLatest;
      usedFromSnapshot = true;
    } else {
      used = uRaw;
    }

    let maxa: number;
    if (mRaw === undefined || !Number.isFinite(mRaw)) {
      if (maLatest == null) return null;
      maxa = maLatest;
      maxaFromSnapshot = true;
    } else if (mRaw <= 0 && maLatest != null && maLatest > 0) {
      maxa = maLatest;
      maxaFromSnapshot = true;
    } else {
      maxa = mRaw;
    }

    if (usedFromSnapshot || maxaFromSnapshot) {
      if (buLatest == null || maLatest == null) return null;
      return { used: buLatest, maxa: maLatest };
    }

    return { used, maxa };
  };

  for (const tMs of times) {
    const { u, m } = merged.get(tMs) ?? {};
    const pair = resolvePairAtTime(u, m);
    if (pair == null) continue;
    const { used, maxa } = pair;

    let pct: number | null = null;
    if (used + maxa > 0) {
      pct = roundUsagePctTwoDecimals((used / (used + maxa)) * 100);
    } else {
      pct = poolTableUsagePctDisplay(pool);
    }
    if (pct != null) out.push([tMs, pct]);
  }

  if (out.length === 0) {
    const single = poolTableUsagePctDisplay(pool);
    if (single != null) return [[Date.now(), single]];
  }
  return out;
}

function dfNumericLatest(field: unknown): number | null {
  if (typeof field === 'number' && Number.isFinite(field)) return field;
  if (field && typeof field === 'object' && 'latest' in field) {
    const n = Number((field as { latest?: unknown }).latest);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** `api/health/minimal` → `df.stats.*` 上与 pool stats 同形的 `rates`：[unix 秒, 字节] */
function dfBytesRatePoints(field: unknown): [number, number][] {
  if (!field || typeof field !== 'object') return [];
  const rates = (field as { rates?: unknown }).rates;
  if (!Array.isArray(rates)) return [];
  const out: [number, number][] = [];
  for (const pt of rates) {
    if (!Array.isArray(pt) || pt.length < 2) continue;
    const tSec = Number(pt[0]);
    const bytes = Number(pt[1]);
    if (!Number.isFinite(tSec) || !Number.isFinite(bytes)) continue;
    out.push([Math.round(tSec * 1000), bytes]);
  }
  return out;
}

/** 集群裸容量使用率 %：`total_used_raw_bytes / total_bytes`（若仅有 used 的 rates，则用 total 的 latest 作分母） */
function parseClusterRawCapacityTrendFromMinimal(minimal: unknown): [number, number][] {
  if (!isRecord(minimal)) return [];
  const df = minimal.df;
  if (!isRecord(df)) return [];
  const s = df.stats;
  if (!isRecord(s)) return [];
  const totalF = s.total_bytes;
  const usedF = s.total_used_raw_bytes;
  const usedPts = dfBytesRatePoints(usedF);
  const totalPts = dfBytesRatePoints(totalF);
  const totalLatest = dfNumericLatest(totalF);
  const usedLatest = dfNumericLatest(usedF);
  if (usedPts.length > 0 && totalLatest != null && totalLatest > 0) {
    return usedPts
      .map(([tMs, usedR]) => {
        let used = usedR;
        if (!Number.isFinite(used) || (used <= 0 && usedLatest != null && usedLatest > 0)) {
          used = usedLatest ?? 0;
        }
        if (!Number.isFinite(used) || used < 0) return null;
        return [tMs, roundUsagePctTwoDecimals((used / totalLatest) * 100)] as [number, number];
      })
      .filter((x): x is [number, number] => x != null);
  }
  if (usedPts.length > 0 && totalPts.length === usedPts.length) {
    return usedPts
      .map(([tMs, usedR], i) => {
        let used = usedR;
        let tot = totalPts[i]?.[1];
        if (!Number.isFinite(used) || (used <= 0 && usedLatest != null && usedLatest > 0)) {
          used = usedLatest ?? usedR;
        }
        if (!Number.isFinite(tot) || (tot <= 0 && totalLatest != null && totalLatest > 0)) {
          tot = totalLatest ?? tot;
        }
        if (!Number.isFinite(tot) || tot <= 0) return null;
        return [tMs, roundUsagePctTwoDecimals((used / tot) * 100)] as [number, number];
      })
      .filter((x): x is [number, number] => x != null);
  }
  return [];
}

function timeExtentMsFromPools(pools: any[]): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  for (const p of pools) {
    for (const [t] of parsePoolUsageTrendPoints(p)) {
      min = Math.min(min, t);
      max = Math.max(max, t);
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return { min, max };
}

/** 无 df.rates 时，用当前裸容量占比在池时间轴上画水平参考线 */
function clusterRawFlatLine(pct: number, extent: { min: number; max: number } | null): [number, number][] {
  if (!Number.isFinite(pct)) return [];
  const p = roundUsagePctTwoDecimals(pct);
  if (extent && extent.max >= extent.min) {
    if (extent.max === extent.min) {
      return [
        [extent.min - 30_000, p],
        [extent.max + 30_000, p],
      ];
    }
    return [
      [extent.min, p],
      [extent.max, p],
    ];
  }
  const now = Date.now();
  return [
    [now - 120_000, p],
    [now, p],
  ];
}

/** 裸容量使用率（df.stats 或当前快照参考线）+ 各池 `bytes_used/(bytes_used+max_avail)` 趋势 */
function buildCephStorageUsageTrendOption(
  pools: any[],
  healthMinimal: unknown,
  rawCapacityPctFallback: number | null,
): EChartsOption | null {
  const series: LineSeriesOption[] = [];

  let clusterData = parseClusterRawCapacityTrendFromMinimal(healthMinimal);
  if (clusterData.length === 0 && rawCapacityPctFallback != null) {
    clusterData = clusterRawFlatLine(rawCapacityPctFallback, timeExtentMsFromPools(pools));
  }
  if (clusterData.length > 0) {
    series.push({
      name: '裸容量使用率',
      type: 'line',
      smooth: 0.35,
      lineStyle: { width: 3 },
      showSymbol: clusterData.length <= 14,
      symbolSize: 6,
      data: clusterData,
      z: 2,
    });
  }

  if (Array.isArray(pools) && pools.length > 0) {
    const sorted = [...pools].sort((a, b) => {
      const na = String(a?.pool_name ?? a?.name ?? '');
      const nb = String(b?.pool_name ?? b?.name ?? '');
      return na.localeCompare(nb, 'zh-CN');
    });
    for (const pool of sorted) {
      const name = String(pool?.pool_name ?? pool?.name ?? 'pool');
      const data = parsePoolUsageTrendPoints(pool);
      if (data.length === 0) continue;
      series.push({
        name: `${name}`,
        type: 'line',
        smooth: 0.35,
        showSymbol: data.length <= 14,
        symbolSize: 5,
        data,
        z: 1,
      });
    }
  }

  if (series.length === 0) return null;
  const multi = series.length > 1;
  return {
    tooltip: {
      trigger: 'axis',
      valueFormatter: (v) => (typeof v === 'number' ? `${v.toFixed(2)}%` : String(v)),
    },
    legend: {
      show: multi,
      type: 'scroll',
      bottom: 0,
      left: 'center',
      textStyle: { fontSize: 11 },
    },
    grid: { left: 52, right: 16, top: 16, bottom: multi ? 48 : 24 },
    xAxis: { type: 'time' },
    yAxis: {
      type: 'value',
      min: 0,
      max: 100,
      axisLabel: {
        formatter: (v: string | number) => {
          const n = typeof v === 'number' ? v : Number(v);
          return Number.isFinite(n) ? `${Math.round(n)}%` : `${v}%`;
        },
      },
    },
    series,
  };
}

function pickDashboardSummaryHighlights(data: unknown): {
  healthStatus?: string;
  mgrId?: string;
  mgrHost?: string;
} {
  if (!isRecord(data)) return {};
  const healthStatus = typeof data.health_status === 'string' ? data.health_status : undefined;
  const mgrId = typeof data.mgr_id === 'string' ? data.mgr_id : undefined;
  const mgrHost = typeof data.mgr_host === 'string' ? data.mgr_host : undefined;
  return { healthStatus, mgrId, mgrHost };
}

function dashboardHealthTagColor(status: string): string {
  const u = status.toUpperCase();
  if (u.includes('OK') && !u.includes('WARN') && !u.includes('ERR')) return 'success';
  if (u.includes('WARN')) return 'warning';
  if (u.includes('ERR') || u.includes('FAIL')) return 'error';
  return 'default';
}

/** Ceph `scrub_status` 展示：scrub 即数据完整性校验，常见英文用语替换为中文 */
function formatCephScrubStatusForDisplay(raw: string): string {
  const t = typeof raw === 'string' ? raw.trim() : '';
  if (!t || t === '—') return '—';

  const lower = t.toLowerCase();
  if (/^inactive$/i.test(t)) return '空闲';
  if (lower === 'idle' || lower === 'none') return '空闲';

  if (/^no\s+active\s+scrubs?$/i.test(t)) return '无进行中的校验';

  let x = t;
  x = x.replace(/\binactive\b/gi, '空闲');
  x = x.replace(/\bdeep\s*scrub(?:bing)?\b/gi, '深度校验');
  x = x.replace(/\bscrubbing\b/gi, '校验中');
  x = x.replace(/\bscrubs\b/gi, '校验');
  x = x.replace(/\bscrub\b/gi, '校验');
  x = x.replace(/\bscheduled\b/gi, '已计划');
  x = x.replace(/\bin\s+progress\b/gi, '进行中');
  x = x.replace(/\bactive\b/gi, '进行中');
  x = x.replace(/\bcompleted\b/gi, '已完成');
  x = x.replace(/\bnone\b/gi, '无');
  x = x.replace(/\bno\b/gi, '无');
  x = x.replace(/\s+/g, ' ').trim();
  return x || '—';
}

function cephCapGridCellStyle(index: number, count: number, extra?: React.CSSProperties): React.CSSProperties {
  const showDivider = index < count - 1;
  const inset = CEPH_CAP_DIVIDER_INLINE_PAD_PX;
  return {
    minWidth: 0,
    paddingLeft: index === 0 ? 0 : inset,
    paddingRight: showDivider ? inset : 0,
    borderInlineEnd: showDivider ? `1px solid ${CEPH_CAP_GRID_COL_DIVIDER_COLOR}` : undefined,
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'stretch',
    ...extra,
  };
}

function CephCapGridCell({
  index,
  count,
  gridColumn,
  children,
}: {
  index: number;
  count: number;
  gridColumn?: React.CSSProperties['gridColumn'];
  children: React.ReactNode;
}) {
  return (
    <div style={cephCapGridCellStyle(index, count, gridColumn != null ? { gridColumn } : undefined)}>
      {children}
    </div>
  );
}

function CephCapMetricLeadCol({
  title,
  value,
  extra,
}: {
  title: string;
  value: React.ReactNode;
  extra?: React.ReactNode;
}) {
  return (
    <div style={{ textAlign: 'left', minWidth: 0, width: '100%' }}>
      <Typography.Text type="secondary" style={CEPH_CAP_LEAD_LABEL}>
        {title}
      </Typography.Text>
      <Typography.Text strong style={CEPH_CAP_LEAD_VALUE}>
        {value}
      </Typography.Text>
      {extra != null ? (
        <Typography.Text type="secondary" style={{ ...CEPH_CAP_DETAIL_LINE, marginTop: 6 }}>
          {extra}
        </Typography.Text>
      ) : null}
    </div>
  );
}

function CephCapUsageBarCol({
  percent,
  strokeColor,
  percentDecimals = 1,
}: {
  percent: number;
  strokeColor: string;
  /** 0：整数%；1 / 2：条内百分比小数位 */
  percentDecimals?: 0 | 1 | 2;
}) {
  const raw = typeof percent === 'number' && Number.isFinite(percent) ? percent : 0;
  const p = Math.min(100, Math.max(0, raw));
  const format =
    percentDecimals === 2
      ? (pct: number | undefined) =>
          `${(typeof pct === 'number' && Number.isFinite(pct) ? pct : p).toFixed(2)}%`
      : percentDecimals === 1
        ? (pct: number | undefined) =>
            `${(typeof pct === 'number' && Number.isFinite(pct) ? pct : p).toFixed(1)}%`
        : (pct: number | undefined) => `${Math.round(pct ?? p)}%`;
  return (
    <div style={{ width: '100%', minWidth: 0 }}>
      <Progress
        percent={p}
        percentPosition={{ align: 'center', type: 'inner' }}
        size={['100%', 20]}
        strokeColor={strokeColor}
        format={format}
      />
    </div>
  );
}

/** 指标卡：antd Card */
function MetricCard(props: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card
      size="small"
      title={props.title}
      style={{ height: '100%', boxShadow: CEPH_DASH_CARD_SHADOW }}
      styles={{
        title: { fontSize: CEPH_SECTION_CARD_TITLE_FONT_PX, lineHeight: 1.4 },
        body: { ...CEPH_CARD_BODY_LAYOUT },
      }}
    >
      {props.children}
    </Card>
  );
}

export type CephStorageSectionProps = {
  cloudId: string;
  /** 首次 bundle/dashboard 链路透传完成后回调（供外层统一骨架屏结束时机） */
  onInitialLoadComplete?: () => void;
};

const CephStorageSection: React.FC<CephStorageSectionProps> = ({ cloudId, onInitialLoadComplete }) => {
  const onReadyRef = useRef(onInitialLoadComplete);
  useEffect(() => {
    onReadyRef.current = onInitialLoadComplete;
  }, [onInitialLoadComplete]);
  /** 首次 bundle/节点/Dashboard 链路透传完成前展示骨架，避免 Cloudmap 探测结束后的空白期 */
  const [initialDashboardBusy, setInitialDashboardBusy] = useState(true);
  const [cephDash, setCephDash] = useState<CephOverviewSummaryEnvelope | null>(null);
  const [cephDashHttpErr, setCephDashHttpErr] = useState<string | null>(null);
  const [healthMinimal, setHealthMinimal] = useState<unknown | null>(null);
  const [healthMinimalErr, setHealthMinimalErr] = useState<string | null>(null);
  /** Rook CephBlockPool CR 列表；无 Dashboard stats 时趋势图为空，费率卡片为 — */
  const [dashboardPools, setDashboardPools] = useState<CephPoolTableRow[]>([]);
  /** 与趋势计算同源；CR 无 rates 时为空数组 */
  const [dashboardPoolsRaw, setDashboardPoolsRaw] = useState<any[]>([]);

  const load = useCallback(
    async (force?: boolean) => {
      if (!cloudId) {
        setInitialDashboardBusy(false);
        return;
      }
      setCephDashHttpErr(null);
      setHealthMinimalErr(null);
      try {
        const [res, nodeRes, dashRes] = await Promise.all([
          fetchCephRookBundle(cloudId, { force: !!force }),
          fetchNodeResources(cloudId),
          fetchCephDashboardSummary(cloudId, { force: !!force, path: 'api/health/minimal' }),
        ]);
        if (!res.ok || res.data == null) {
          setCephDash(null);
          setHealthMinimal(null);
          setDashboardPoolsRaw([]);
          setDashboardPools([]);
          setCephDashHttpErr(res.error || '无法读取 Rook Ceph 聚合（/ceph/rook/bundle）');
          return;
        }
        const body = res.data as Record<string, unknown> & {
          _tower?: { unreachable?: boolean };
        };
        const unreachable = body._tower?.unreachable === true;
        const bundle = normalizeCephBundle(body);
        const hostCount = nodeRes.ok && nodeRes.data != null ? countSteveListItems(nodeRes.data) : null;
        const { minimal: rookMinimal, summary } = buildRookCephOverviewLandingInputs(bundle, {
          hostCount: hostCount != null && hostCount >= 0 ? hostCount : null,
        });
        const minimalMerged = mergeCephDashboardMinimalIntoRookMinimal(
          rookMinimal,
          dashRes.ok ? dashRes.data : null,
        );
        setHealthMinimal(minimalMerged);
        setHealthMinimalErr(
          unreachable ? 'Steve 控制面不可达或已降级，下列数据可能不完整。' : null,
        );
        setCephDash({
          data: summary,
          _tower: { source: 'rook-bundle', unreachable: unreachable || undefined },
        });
        const pools = bundle.blockPools.map((p, i) => {
          const row = cephBlockPoolToRow(p, i);
          return cephBlockPoolRowToTableRow(row, p);
        });
        setDashboardPools(pools);
        setDashboardPoolsRaw(bundle.blockPools);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setCephDash(null);
        setHealthMinimal(null);
        setDashboardPoolsRaw([]);
        setDashboardPools([]);
        setCephDashHttpErr(msg || '加载失败');
        setHealthMinimalErr(null);
      } finally {
        setInitialDashboardBusy(false);
        onReadyRef.current?.();
      }
    },
    [cloudId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const cephDashboardRestCard = useMemo(() => {
    const dashHighlights = cephDash?.data != null ? pickDashboardSummaryHighlights(cephDash.data) : {};
    const landing = buildCephLandingModel(healthMinimal, cephDash?.data ?? null);

    const healthLabel = landing.status.clusterHealth || dashHighlights.healthStatus;
    const healthErr = !!(healthLabel && /ERR|FAIL/i.test(healthLabel));
    const healthWarn =
      !!healthLabel && /WARN/i.test(healthLabel) && !healthErr;

    const rawCap = landing.capacity.raw;
    const perf = landing.perf;
    const poolUsageTrendOption = buildCephStorageUsageTrendOption(
      dashboardPoolsRaw,
      healthMinimal,
      rawCap?.pctOfTotal ?? null,
    );

    const mgrSt = landing.status.mgr;
    const mgrFromHealthOk =
      !!mgrSt && (mgrSt.active != null || mgrSt.standbyCount > 0);
    const mgrDaemonTotal =
      mgrFromHealthOk && mgrSt
        ? (mgrSt.active != null && mgrSt.active !== '' ? 1 : 0) + mgrSt.standbyCount
        : 0;

    let clusterStatusCardBody: React.ReactNode;
    if (!healthLabel) {
      clusterStatusCardBody = <Typography.Text type="secondary">—</Typography.Text>;
    } else {
      const sev = dashboardHealthTagColor(healthLabel);
      const palette =
        sev === 'error'
          ? { bg: '#fff2f0', fg: '#cf1322', Icon: CloseCircleOutlined }
          : sev === 'warning'
            ? { bg: '#fffbe6', fg: '#d48806', Icon: WarningOutlined }
            : sev === 'success'
              ? { bg: '#f6ffed', fg: '#389e0d', Icon: CheckCircleOutlined }
              : { bg: '#fafafa', fg: '#595959', Icon: InfoCircleOutlined };
      const { bg, fg, Icon } = palette;
      const hint = healthErr
        ? '请优先排查监视器、OSD 与网络，或在集群侧查看 Ceph 健康详情。'
        : healthWarn
          ? '集群亚健康，建议尽快处理健康检查中的告警项。'
          : null;
      clusterStatusCardBody = (
        <Flex align="flex-start" gap={12} style={{ width: '100%' }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 44,
              height: 44,
              borderRadius: 10,
              background: bg,
              color: fg,
              flexShrink: 0,
            }}
            aria-hidden
          >
            <Icon style={{ fontSize: 22 }} />
          </span>
          <Flex vertical gap={2} style={{ minWidth: 0, flex: 1 }}>
            <Typography.Text
              strong
              style={{
                ...CEPH_CARD_PRIMARY,
                display: 'block',
                wordBreak: 'break-word',
                color: fg,
              }}
            >
              {healthLabel}
            </Typography.Text>
            {hint ? (
              <Typography.Text type="secondary" style={CEPH_CARD_SECONDARY}>
                {hint}
              </Typography.Text>
            ) : null}
          </Flex>
        </Flex>
      );
    }

    return (
      <Card variant="borderless" styles={{ body: { padding: 0 } }}>
          {cephDashHttpErr ? (
            <Alert type="error" showIcon message={cephDashHttpErr} description={CEPH_DASHBOARD_FAIL_HINT} />
          ) : cephDash?._tower?.cephDashboardError ? (
            <Alert
              type="warning"
              showIcon
              message={cephDash._tower.message || '暂时无法加载集群数据'}
              description={CEPH_DASHBOARD_FAIL_HINT}
            />
          ) : cephDash?.data != null ? (
            <Space direction="vertical" size={CARD_GAP} style={{ width: '100%' }}>
              <Row gutter={[CARD_GAP, CARD_GAP]}>
                <Col xs={24}>
                  <MetricCard title={cephDashboardCardTitle(FundTwoTone, '存储容量趋势')}>
                    <div style={{ width: '100%', minHeight: poolUsageTrendOption ? 260 : undefined }}>
                      {poolUsageTrendOption ? (
                        <ReactECharts
                          option={poolUsageTrendOption}
                          notMerge
                          lazyUpdate
                          style={{ width: '100%', height: 260 }}
                        />
                      ) : dashboardPools.length > 0 ? (
                        <div
                          style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: 12,
                            alignItems: 'stretch',
                            width: '100%',
                            maxHeight: 360,
                            overflowY: 'auto',
                          }}
                        >
                          <Typography.Text
                            type="secondary"
                            style={{ ...CEPH_CARD_SECONDARY, width: '100%', marginBottom: 4 }}
                          >
                            暂无 percent_used 采样序列，以下为当前使用率：
                          </Typography.Text>
                          {[...dashboardPools]
                            .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
                            .map((r) => (
                              <div
                                key={r.key}
                                style={{
                                  flex: '1 1 168px',
                                  minWidth: 152,
                                  maxWidth: 260,
                                  padding: '10px 12px',
                                  borderRadius: 8,
                                  border: '1px solid rgba(0,0,0,.06)',
                                  background: 'rgba(0,0,0,.02)',
                                }}
                              >
                                <Typography.Text
                                  ellipsis={{ tooltip: r.name }}
                                  strong
                                  style={{ display: 'block', marginBottom: 8, fontSize: 13 }}
                                >
                                  {r.name}
                                </Typography.Text>
                                {r.usagePct != null && Number.isFinite(r.usagePct) ? (
                                  <Progress
                                    percent={Math.min(100, r.usagePct)}
                                    size="small"
                                    status={r.usagePct > 90 ? 'exception' : 'normal'}
                                    format={() => `${r.usagePct!.toFixed(2)}%`}
                                  />
                                ) : (
                                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                    使用率 —
                                  </Typography.Text>
                                )}
                              </div>
                            ))}
                        </div>
                      ) : landing.capacity.poolCount != null ? (
                        <Statistic value={landing.capacity.poolCount} valueStyle={CEPH_CAP_STAT_LARGE} />
                      ) : (
                        <Typography.Text type="secondary">—</Typography.Text>
                      )}
                    </div>
                  </MetricCard>
                </Col>
              </Row>

              {healthMinimalErr ? (
                <Alert
                  type="warning"
                  showIcon
                  message={healthMinimalErr}
                  description="部分指标可能显示不全，可稍后刷新重试。"
                />
              ) : null}

              {/* 第一行：集群状态 6、裸容量 6、存储池 12（横向列出各池名称与应用）；第二行：主机/监视器/OSD/管理器；第三行：客户端性能 */}
              <Row gutter={[CARD_GAP, CARD_GAP]} align="stretch" wrap>
                <Col xs={24} md={12} lg={6}>
                  <MetricCard title={cephDashboardCardTitle(DashboardTwoTone, '集群状态')}>
                    {clusterStatusCardBody}
                  </MetricCard>
                </Col>
                <Col xs={24} md={12} lg={6} style={{ display: 'flex' }}>
                  <Card
                    size="small"
                    title={cephDashboardCardTitle(HddTwoTone, '裸容量')}
                    styles={CEPH_CAPACITY_ROW_CARD_STYLES}
                    style={CEPH_CAP_TRIO_CARD_STYLE}
                  >
                    {rawCap ? (
                      <div style={CEPH_CAP_RAW_GRID}>
                        <CephCapGridCell index={0} count={2}>
                          <CephCapMetricLeadCol title="总容量" value={fmtBytesFromUnknown(rawCap.total)} />
                        </CephCapGridCell>
                        <CephCapGridCell index={1} count={2}>
                          <div
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 8,
                              minWidth: 0,
                              width: '100%',
                              justifyContent: 'center',
                            }}
                          >
                            <CephCapUsageBarCol
                              percent={rawCap.pctOfTotal}
                              strokeColor="#1677ff"
                            />
                            <div
                              style={{
                                display: 'flex',
                                flexWrap: 'wrap',
                                alignItems: 'baseline',
                                justifyContent: 'space-between',
                                gap: '6px 16px',
                                width: '100%',
                              }}
                            >
                              <Typography.Text type="secondary" style={CEPH_CAP_DETAIL_LINE}>
                                已使用 · {fmtBytesFromUnknown(rawCap.used)}
                              </Typography.Text>
                              <Typography.Text type="secondary" style={CEPH_CAP_DETAIL_LINE}>
                                可用 · {fmtBytesFromUnknown(rawCap.avail)}
                              </Typography.Text>
                            </div>
                          </div>
                        </CephCapGridCell>
                      </div>
                    ) : (
                      <Typography.Text type="secondary">—</Typography.Text>
                    )}
                  </Card>
                </Col>
                <Col xs={24} md={24} lg={12}>
                  <MetricCard
                    title={cephDashboardCardTitle(
                      AppstoreTwoTone,
                      <Space align="baseline" size={8} wrap>
                        <span>存储池</span>
                        {dashboardPools.length > 0 ? (
                          <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 'normal' }}>
                            （{dashboardPools.length}）
                          </Typography.Text>
                        ) : null}
                      </Space>,
                    )}
                  >
                    {dashboardPools.length > 0 ? (
                      <div
                        style={{
                          display: 'flex',
                          flexWrap: 'nowrap',
                          gap: 10,
                          width: '100%',
                          overflowX: 'auto',
                          paddingBottom: 2,
                        }}
                      >
                        {[...dashboardPools]
                          .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
                          .map((row) => {
                            const summaryLine = formatCephPoolCardSummaryLineZh(row);
                            return (
                            <div
                              key={row.key}
                              style={{
                                flex: '0 0 auto',
                                minWidth: 152,
                                maxWidth: 240,
                                padding: '10px 12px',
                                borderRadius: 8,
                                border: '1px solid rgba(0,0,0,.06)',
                                background: 'rgba(0,0,0,.02)',
                              }}
                            >
                              <Typography.Text
                                ellipsis={{ tooltip: row.name }}
                                strong
                                style={{ display: 'block', marginBottom: 8, fontSize: 13 }}
                              >
                                {row.name}
                              </Typography.Text>
                              <Typography.Text
                                type="secondary"
                                ellipsis={{ tooltip: `${summaryLine}${row.dataProtection && row.dataProtection !== '—' ? ` · ${row.dataProtection}` : ''}` }}
                                style={{ fontSize: 12, display: 'block', lineHeight: 1.45 }}
                              >
                                {summaryLine}
                              </Typography.Text>
                            </div>
                          );
                          })}
                      </div>
                    ) : landing.capacity.poolCount != null ? (
                      <Typography.Text type="secondary">
                        Rook BlockPool 列表暂无，概要池数量为 {landing.capacity.poolCount}
                      </Typography.Text>
                    ) : (
                      <Typography.Text type="secondary">暂无存储池数据</Typography.Text>
                    )}
                  </MetricCard>
                </Col>
              </Row>

              <Row gutter={[CARD_GAP, CARD_GAP]} align="stretch" wrap>
                <Col xs={24} sm={12} lg={6}>
                  <MetricCard title={cephDashboardCardTitle(CloudTwoTone, '主机')}>
                    {landing.status.hosts != null ? (
                      <Typography.Text strong style={CEPH_CARD_PRIMARY}>
                        {landing.status.hosts} 台
                      </Typography.Text>
                    ) : (
                      <Typography.Text type="secondary">—</Typography.Text>
                    )}
                  </MetricCard>
                </Col>
                <Col xs={24} sm={12} lg={6}>
                  <MetricCard title={cephDashboardCardTitle(EyeTwoTone, '监视器')}>
                    {landing.status.monitors ? (
                      <Space direction="vertical" size={2} style={{ width: '100%' }}>
                        <Typography.Text strong style={CEPH_CARD_PRIMARY}>
                          {landing.status.monitors.total} 实例
                        </Typography.Text>
                        <Typography.Text type="secondary" style={CEPH_CARD_SECONDARY}>
                          仲裁 {landing.status.monitors.quorum} 个
                        </Typography.Text>
                      </Space>
                    ) : (
                      <Typography.Text type="secondary">—</Typography.Text>
                    )}
                  </MetricCard>
                </Col>
                <Col xs={24} sm={12} lg={6}>
                  <MetricCard title={cephDashboardCardTitle(ContainerTwoTone, 'OSD')}>
                    {landing.status.osd ? (
                      <Space direction="vertical" size={2} style={{ width: '100%' }}>
                        <Typography.Text strong style={CEPH_CARD_PRIMARY}>
                          {landing.status.osd.total} 实例
                        </Typography.Text>
                        <Typography.Text type="secondary" style={CEPH_CARD_SECONDARY}>
                          {landing.status.osd.up} 启用，{landing.status.osd.in} 加入
                        </Typography.Text>
                      </Space>
                    ) : (
                      <Typography.Text type="secondary">—</Typography.Text>
                    )}
                  </MetricCard>
                </Col>
                <Col xs={24} sm={12} lg={6}>
                  <MetricCard title={cephDashboardCardTitle(ApiTwoTone, '管理器')}>
                    {mgrFromHealthOk && mgrSt ? (
                      <Space direction="vertical" size={2} style={{ width: '100%' }}>
                        <Typography.Text strong style={CEPH_CARD_PRIMARY}>
                          {mgrDaemonTotal} 实例
                        </Typography.Text>
                        <Tooltip title={MGR_ACTIVE_TOOLTIP}>
                          <Typography.Text
                            type="secondary"
                            style={{ ...CEPH_CARD_SECONDARY, cursor: 'help' }}
                          >
                            Active 1，备用 {mgrSt.standbyCount} 个
                          </Typography.Text>
                        </Tooltip>
                      </Space>
                    ) : dashHighlights.mgrId || dashHighlights.mgrHost ? (
                      <Space direction="vertical" size={2} style={{ width: '100%' }}>
                        <Typography.Text strong style={CEPH_CARD_PRIMARY}>
                          {dashHighlights.mgrId ? '1 实例' : '—'}
                        </Typography.Text>
                        {dashHighlights.mgrId ? (
                          <Tooltip title={MGR_ACTIVE_TOOLTIP}>
                            <Typography.Text
                              type="secondary"
                              style={{ ...CEPH_CARD_SECONDARY, cursor: 'help' }}
                            >
                              {isLikelyCephVersionOrLongMgrLabel(dashHighlights.mgrId) ? (
                                'Active 1'
                              ) : (
                                <>主 {dashHighlights.mgrId}</>
                              )}
                              {dashHighlights.mgrHost ? '，主机 ' : ''}
                              {dashHighlights.mgrHost ? (
                                <Typography.Text
                                  copyable={{ text: dashHighlights.mgrHost }}
                                  code
                                  style={{ fontSize: 12 }}
                                >
                                  {dashHighlights.mgrHost}
                                </Typography.Text>
                              ) : null}
                            </Typography.Text>
                          </Tooltip>
                        ) : dashHighlights.mgrHost ? (
                          <Typography.Text
                            copyable={{ text: dashHighlights.mgrHost }}
                            code
                            ellipsis={{ tooltip: dashHighlights.mgrHost }}
                            style={{ ...CEPH_CARD_SECONDARY, fontSize: 12, display: 'block' }}
                          >
                            {dashHighlights.mgrHost}
                          </Typography.Text>
                        ) : null}
                      </Space>
                    ) : (
                      <Typography.Text type="secondary">—</Typography.Text>
                    )}
                  </MetricCard>
                </Col>
              </Row>

              <Row gutter={[CARD_GAP, CARD_GAP]} align="stretch" wrap>
                <Col xs={24} sm={12} lg={6}>
                  <MetricCard title={cephDashboardCardTitle(ProjectTwoTone, '客户端读/写')}>
                    {perf ? (
                      <Flex justify="space-between" align="flex-start" gap={12}>
                        <Typography.Text strong style={CEPH_CARD_PRIMARY}>
                          {formatIops(perf.readIops + perf.writeIops)} IOPS
                        </Typography.Text>
                        <Space direction="vertical" size={0} style={{ textAlign: 'right' }}>
                          <Typography.Text type="secondary" style={CEPH_CARD_SECONDARY}>
                            读取次数: {formatIops(perf.readIops)} /s
                          </Typography.Text>
                          <Typography.Text type="secondary" style={CEPH_CARD_SECONDARY}>
                            写入次数: {formatIops(perf.writeIops)} /s
                          </Typography.Text>
                        </Space>
                      </Flex>
                    ) : (
                      <Typography.Text type="secondary">—</Typography.Text>
                    )}
                  </MetricCard>
                </Col>
                <Col xs={24} sm={12} lg={6}>
                  <MetricCard title={cephDashboardCardTitle(ProjectTwoTone, '客户端吞吐量')}>
                    {perf ? (
                      <Flex justify="space-between" align="flex-start" gap={12}>
                        <Typography.Text strong style={CEPH_CARD_PRIMARY}>
                          {formatBps(perf.readBps + perf.writeBps)}
                        </Typography.Text>
                        <Space direction="vertical" size={0} style={{ textAlign: 'right' }}>
                          <Typography.Text type="secondary" style={CEPH_CARD_SECONDARY}>
                            读取: {formatBps(perf.readBps)}
                          </Typography.Text>
                          <Typography.Text type="secondary" style={CEPH_CARD_SECONDARY}>
                            写入: {formatBps(perf.writeBps)}
                          </Typography.Text>
                        </Space>
                      </Flex>
                    ) : (
                      <Typography.Text type="secondary">—</Typography.Text>
                    )}
                  </MetricCard>
                </Col>
                <Col xs={24} sm={12} lg={6}>
                  <MetricCard title={cephDashboardCardTitle(ProjectTwoTone, '恢复吞吐量')}>
                    {perf ? (
                      <Typography.Text strong style={CEPH_CARD_PRIMARY}>
                        {formatBps(perf.recoverBps)}
                      </Typography.Text>
                    ) : (
                      <Typography.Text type="secondary">—</Typography.Text>
                    )}
                  </MetricCard>
                </Col>
                <Col xs={24} sm={12} lg={6}>
                  <MetricCard title={cephDashboardCardTitle(SecurityScanTwoTone, '数据校验')}>
                    {perf ? (
                      <Typography.Text strong style={CEPH_CARD_PRIMARY}>
                        {formatCephScrubStatusForDisplay(perf.scrubStatus)}
                      </Typography.Text>
                    ) : (
                      <Typography.Text type="secondary">—</Typography.Text>
                    )}
                  </MetricCard>
                </Col>
              </Row>
            </Space>
          ) : (
            <Typography.Text type="secondary">暂无数据。</Typography.Text>
          )}
      </Card>
    );
  }, [
    cephDash,
    cephDashHttpErr,
    healthMinimal,
    healthMinimalErr,
    dashboardPools,
    dashboardPoolsRaw,
  ]);

  return (
    <PageDetailSection asCard={false} showHeaderTitle={false}>
      {initialDashboardBusy ? (
        <div style={{ paddingTop: 8 }}>
          <Skeleton active paragraph={{ rows: 10 }} />
        </div>
      ) : (
        <Space direction="vertical" size={CARD_GAP} style={{ width: '100%' }}>
          {cephDashboardRestCard}
        </Space>
      )}
    </PageDetailSection>
  );
};

export default CephStorageSection;
