/**
 * 运维监控大盘 · 节点概览视图（对齐 Grafana 仪表盘 `Node Exporter / Nodes`）。
 *
 * 与 Grafana 的差异：
 * - 顶部 `Instance` 模板变量由后端 Prometheus `query_range` 取 `node_uname_info` 标签实现，
 *   不依赖 Grafana 的 label_values API；切换 instance 触发 usePromQueries 重拉。
 * - 共 4 个分组（CPU / Memory / Disk / Network），分别承载 timeseries / gauge / table 三种 panel 类型，
 *   表格使用最后一个样本值表示 instant 查询（与 Grafana `instant: true` 等价，避免新增后端 instant 接口）。
 * - Disk I/O 面板 PromQL 与 cattle-monitoring-system/node-disk-custom-rules 一致（块设备筛选、延迟与 I/O 利用率）；
 *   磁盘空间表格仍按挂载点聚合 node_filesystem_*。
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Col, Empty, Row, Select, Skeleton, Space, Typography } from 'antd';
import MetricPanelCard from '../components/MetricPanelCard';
import MetricPanelExpandButton from '../components/MetricPanelExpandButton';
import MetricPanelPreviewModal from '../components/MetricPanelPreviewModal';
import MetricTimeSeriesChart, { type MetricSeriesInput } from '../components/MetricTimeSeriesChart';
import MetricGauge from '../components/MetricGauge';
import MetricDiskSpaceTable from '../components/MetricDiskSpaceTable';
import OpsDashboardNodesCpuCard from '../components/OpsDashboardNodesCpuCard';
import OpsDashboardNodesHostsCard from '../components/OpsDashboardNodesHostsCard';
import OpsDashboardNodesMemoryCard from '../components/OpsDashboardNodesMemoryCard';
import { usePhysicalHostInstanceLabelMap } from '../hooks/usePhysicalHostInstanceLabelMap';
import { MonitoringOverviewLanesProvider } from '../MonitoringOverviewLanesContext';
import { usePromQueries, type PromQueryDef, type PromQueryResult, resolveChartTimeBoundsMs } from '../hooks/usePromQueries';
import { derivePanelLoadState } from '../lib/panelLoadState';
import type { UnitKind } from '../lib/unit';
import type { ResolvedTimeRange } from '../hooks/useDashboardTimeRange';
import { fetchMetricRange } from '../../../../../../services/monitoringApi';

export interface OpsDashboardNodesSectionProps {
  cloudId: string;
  resolved: ResolvedTimeRange;
  reloadToken: number;
}

const PANEL_HEIGHT = 320;
const CHART_HEIGHT = 240;
const PREVIEW_CHART_HEIGHT = 480;
const TABLE_PANEL_HEIGHT = 400;
const TABLE_SCROLL_Y = 300;
const PREVIEW_TABLE_SCROLL_Y = 560;
const PREVIEW_TABLE_MODAL_WIDTH = 1200;
const OVERVIEW_CARD_ROW_HEIGHT = 300;

const OVERVIEW_CARD_COL_FILL_STYLE: React.CSSProperties = {
  display: 'flex',
  minHeight: 0,
  minWidth: 0,
  width: '100%',
  height: OVERVIEW_CARD_ROW_HEIGHT,
};

const INSTANCE_QUERY = 'count by (instance) (node_uname_info{job="node-exporter", sysname!="Darwin"})';

interface PanelQueryDef {
  /** 与 Grafana panel 内 `refId` 一致 */
  key: string;
  expr: string;
  /** Grafana legendFormat（支持 `{{label}}` 模板） */
  legend: string;
  color?: string;
  /** 落在哪条 Y 轴（默认左）；用于 Grafana fieldConfig.overrides 中 `axisPlacement: right` 的复刻 */
  yAxisIndex?: 0 | 1;
}

/** 时间序列面板（含 stack / 双轴） */
interface TimeSeriesPanelDef {
  kind: 'timeseries';
  id: string;
  title: string;
  description?: string;
  unit: UnitKind;
  yMin?: number;
  yMax?: number;
  showLegend?: boolean;
  stack?: boolean;
  secondaryUnit?: UnitKind;
  secondaryYMin?: number;
  secondaryYMax?: number;
  /** AntD Col span（24-base），对应 Grafana gridPos.w / 24 */
  col: { xs: number; lg: number };
  queries: PanelQueryDef[];
}

/** Memory gauge 类型，单个数值 + 阈值染色 */
interface GaugePanelDef {
  kind: 'gauge';
  id: string;
  title: string
  description?: string;
  unit: string;
  min: number;
  max: number;
  thresholds: Array<{ value: number; color: string }>;
  col: { xs: number; lg: number };
  query: PanelQueryDef;
}

/** Disk Space Usage 表格类型，Size + Avail 两条 series 组装行 */
interface DiskSpaceTablePanelDef {
  kind: 'diskSpaceTable';
  id: string;
  title: string;
  description?: string;
  col: { xs: number; lg: number };
  sizeQuery: PanelQueryDef;
  availQuery: PanelQueryDef;
}

type NodesPanelDef = TimeSeriesPanelDef | GaugePanelDef | DiskSpaceTablePanelDef;

interface NodesPanelGroup {
  id: string;
  title: string;
  panels: NodesPanelDef[];
}

/** 通用磁盘设备 regex（与 Grafana 仪表盘一致） */
/** 与 cattle-monitoring-system/node-disk-custom-rules 告警规则一致的块设备筛选 */
const NODE_DISK_DEVICE_SELECTOR =
  'job="node-exporter",' +
  'device=~"^(sd[a-z]|nvme[0-9]+n[0-9]+)$",' +
  'device!~"^(loop|dm-|md|ram|sr|nbd|zram|rbd)"';


const NODE_DISK_INSTANCE_SELECTOR = `${NODE_DISK_DEVICE_SELECTOR}, instance="$instance"`;
const NODE_NETWORK_DEVICE_SELECTOR =
  'job="node-exporter",device=~"^(eno|enp|eth|ens|em)[0-9]+(s[0-9]+f[0-9]+)?$"';
const NODE_NETWORK_INSTANCE_SELECTOR = `${NODE_NETWORK_DEVICE_SELECTOR}, instance="$instance"`;

const NODES_PANEL_GROUPS: NodesPanelGroup[] = [
  {
    id: 'cpu',
    title: 'CPU',
    panels: [
      {
        kind: 'gauge',
        id: 'node-cpu-gauge',
        title: '节点CPU使用率(%)',
        description:
          '展示该节点当前已用CPU占物理CPU总量的比例。数值越高表示CPU越紧张；超过 80% 显示黄色、超过 90% 显示红色，提示需要关注或扩容。',
        unit: '%',
        min: 0,
        max: 100,
        thresholds: [
          { value: 0, color: 'rgba(50, 172, 45, 0.97)' },
          { value: 80, color: 'rgba(237, 129, 40, 0.89)' },
          { value: 90, color: 'rgba(245, 54, 54, 0.9)' },
        ],
        col: { xs: 24, lg: 6 },
        query: {
          key: 'A',
          expr:
            '100 * (1 - avg(irate(node_cpu_seconds_total{job="node-exporter", mode="idle", instance="$instance"}[$__rate_interval])))',
          legend: '',
        },
      },
      {
        kind: 'timeseries',
        id: 'node-load-average',
        title: '系统负载',
        description:
          '展示 1/5/15 分钟负载和逻辑核心数参考线；负载长期高于核心数时，通常表示任务排队、节点压力较大。',
        unit: 'short',
        yMin: 0,
        showLegend: true,
        col: { xs: 24, lg: 18 },
        queries: [
          {
            key: 'A',
            expr: 'node_load1{job="node-exporter", instance="$instance"}',
            legend: '1 分钟负载',
            color: '#1677ff',
          },
          {
            key: 'B',
            expr: 'node_load5{job="node-exporter", instance="$instance"}',
            legend: '5 分钟负载',
            color: '#fa8c16',
          },
          {
            key: 'C',
            expr: 'node_load15{job="node-exporter", instance="$instance"}',
            legend: '15 分钟负载',
            color: '#eb2f96',
          },
          {
            key: 'D',
            expr: 'count(node_cpu_seconds_total{job="node-exporter", instance="$instance", mode="idle"})',
            legend: '逻辑核心数',
            color: '#8c8c8c',
          },
        ],
      }
    ],
  },
  {
    id: 'memory',
    title: '内存',
    panels: [
      {
        kind: 'gauge',
        id: 'node-memory-gauge',
        title: '内存使用率(%)',
        description:
          '展示该节点当前已用内存占物理内存总量的比例。数值越高表示内存越紧张；超过 80% 显示黄色、超过 90% 显示红色，提示需要关注或扩容。',
        unit: '%',
        min: 0,
        max: 100,
        thresholds: [
          { value: 0, color: 'rgba(50, 172, 45, 0.97)' },
          { value: 80, color: 'rgba(237, 129, 40, 0.89)' },
          { value: 90, color: 'rgba(245, 54, 54, 0.9)' },
        ],
        col: { xs: 24, lg: 6 },
        query: {
          key: 'A',
          expr:
            '100 -\n(\n  avg(node_memory_MemAvailable_bytes{job="node-exporter", instance="$instance"}) /\n  avg(node_memory_MemTotal_bytes{job="node-exporter", instance="$instance"})\n* 100\n)',
          legend: '',
        },
      },
      {
        kind: 'timeseries',
        id: 'node-memory-usage',
        title: '内存使用',
        description:
          '把内存分为已使用、缓存、缓冲和空闲四部分，方便查看内存主要被谁占用；总高度代表节点内存总量。',
        unit: 'bytes',
        yMin: 0,
        stack: true,
        showLegend: true,
        col: { xs: 24, lg: 18 },
        queries: [
          {
            key: 'A',
            expr:
              '(\n  node_memory_MemTotal_bytes{job="node-exporter", instance="$instance"}\n-\n  node_memory_MemFree_bytes{job="node-exporter", instance="$instance"}\n-\n  node_memory_Buffers_bytes{job="node-exporter", instance="$instance"}\n-\n  node_memory_Cached_bytes{job="node-exporter", instance="$instance"}\n)',
            legend: '已使用',
            color: '#eb2f96',
          },
          {
            key: 'B',
            expr: 'node_memory_Buffers_bytes{job="node-exporter", instance="$instance"}',
            legend: '缓冲区',
            color: '#faad14',
          },
          {
            key: 'C',
            expr: 'node_memory_Cached_bytes{job="node-exporter", instance="$instance"}',
            legend: '缓存',
            color: '#13c2c2',
          },
          {
            key: 'D',
            expr: 'node_memory_MemFree_bytes{job="node-exporter", instance="$instance"}',
            legend: '空闲',
            color: '#52c41a',
          },
        ],
      },
    ],
  },
  {
    id: 'disk',
    title: '磁盘',
    panels: [
      {
        kind: 'timeseries',
        id: 'node-disk-read-io',
        title: '物理磁盘读IO速率',
        description:
          '展示各物理磁盘每秒读取数据量；数值越高表示该磁盘读取带宽占用越高。',
        unit: 'bytesRate',
        yMin: 0,
        showLegend: true,
        col: { xs: 24, lg: 12 },
        queries: [
          {
            key: 'A',
            expr: `rate(node_disk_read_bytes_total{${NODE_DISK_INSTANCE_SELECTOR}}[$__rate_interval])`,
            legend: '{{device}} 读速率',
          },
        ],
      },
      {
        kind: 'timeseries',
        id: 'node-disk-write-io',
        title: '物理磁盘写IO速率',
        description:
          '展示各物理磁盘每秒写入数据量；数值越高表示该磁盘写入带宽占用越高。',
        unit: 'bytesRate',
        yMin: 0,
        showLegend: true,
        col: { xs: 24, lg: 12 },
        queries: [
          {
            key: 'A',
            expr: `rate(node_disk_written_bytes_total{${NODE_DISK_INSTANCE_SELECTOR}}[$__rate_interval])`,
            legend: '{{device}} 写速率',
          },
        ],
      },
      {
        kind: 'diskSpaceTable',
        id: 'node-disk-space-usage',
        title: '磁盘使用情况',
        description:
          '按块设备（分区）展示磁盘总量、可用量、已用量和已用占比；同一设备被绑定挂载到多个路径时会折叠为一行，便于快速识别空间紧张的设备。',
        col: { xs: 24, lg: 24 },
        sizeQuery: {
          key: 'A',
          expr:
            'max by (mountpoint, device) (node_filesystem_size_bytes{job="node-exporter", instance="$instance", fstype!="", mountpoint!="", device=~"^/dev/(sd[a-z][0-9]*|vd[a-z][0-9]*|xvd[a-z][0-9]*|nvme[0-9]+n[0-9]+p?[0-9]*)$"})',
          legend: '{{mountpoint}}',
        },
        availQuery: {
          key: 'B',
          expr:
            'max by (mountpoint, device) (node_filesystem_avail_bytes{job="node-exporter", instance="$instance", fstype!="", mountpoint!="", device=~"^/dev/(sd[a-z][0-9]*|vd[a-z][0-9]*|xvd[a-z][0-9]*|nvme[0-9]+n[0-9]+p?[0-9]*)$"})',
          legend: '{{mountpoint}}',
        },
      },
    ],
  },
  
  {
    id: 'network',
    title: '网络',
    panels: [
      {
        kind: 'timeseries',
        id: 'node-network-received',
        title: '物理网卡入站流量',
        description:
          '展示各物理网卡每秒接收的数据量，可用于观察节点入站流量压力。',
        unit: 'bitsRate',
        yMin: 0,
        showLegend: true,
        col: { xs: 24, lg: 12 },
        queries: [
          {
            key: 'A',
            expr:
              `rate(node_network_receive_bytes_total{${NODE_NETWORK_INSTANCE_SELECTOR}}[$__rate_interval]) * 8`,
            legend: '{{device}} 入流量',
          },
        ],
      },
      {
        kind: 'timeseries',
        id: 'node-network-transmitted',
        title: '物理网卡出站流量',
        description:
          '展示各物理网卡每秒发送到外部网络的数据量（已排除 lo、容器虚拟网卡等内部流量），用于观察节点出站带宽压力。',
        unit: 'bitsRate',
        yMin: 0,
        showLegend: true,
        col: { xs: 24, lg: 12 },
        queries: [
          {
            key: 'A',
            expr:
              `rate(node_network_transmit_bytes_total{${NODE_NETWORK_INSTANCE_SELECTOR}}[$__rate_interval]) * 8`,
            legend: '{{device}} 出流量',
          },
        ],
      },
    ],
  },
];

const ALL_NODES_PANELS = NODES_PANEL_GROUPS.flatMap((g) => g.panels);

function composeKey(panelId: string, queryKey: string): string {
  return `${panelId}__${queryKey}`;
}

/** 抽取一个 panel 在 results 中的全部 query 结果（保持顺序与 panel.queries 一致） */
function collectPanelResults(
  panel: NodesPanelDef,
  results: Record<string, PromQueryResult>,
): PromQueryResult[] {
  switch (panel.kind) {
    case 'timeseries':
      return panel.queries.map((q) => results[composeKey(panel.id, q.key)]).filter(Boolean) as PromQueryResult[];
    case 'gauge':
      return [results[composeKey(panel.id, panel.query.key)]].filter(Boolean) as PromQueryResult[];
    case 'diskSpaceTable':
      return [
        results[composeKey(panel.id, panel.sizeQuery.key)],
        results[composeKey(panel.id, panel.availQuery.key)],
      ].filter(Boolean) as PromQueryResult[];
  }
}

function getPanelLoadState(panel: NodesPanelDef, results: Record<string, PromQueryResult>) {
  return derivePanelLoadState(collectPanelResults(panel, results));
}

function panelErrorMsg(panel: NodesPanelDef, results: Record<string, PromQueryResult>): string | undefined {
  const list = collectPanelResults(panel, results);
  if (list.length === 0) return undefined;
  const errs = list.map((r) => r?.error).filter((m): m is string => Boolean(m));
  return errs.length > 0 && errs.length === list.length ? errs.join('\n') : undefined;
}

function isPanelEmpty(panel: NodesPanelDef, results: Record<string, PromQueryResult>): boolean {
  const list = collectPanelResults(panel, results);
  if (list.length === 0) return true;
  return list.every((r) => !r || r.series.length === 0 || r.series.every((s) => s.values.length === 0));
}

function renderTimeSeriesPanel(
  panel: TimeSeriesPanelDef,
  results: Record<string, PromQueryResult>,
  chartMin: number,
  chartMax: number,
  height: number = CHART_HEIGHT,
  loading = false,
): React.ReactNode {
  const groups: MetricSeriesInput[] = panel.queries.map((q) => ({
    name: q.legend,
    color: q.color,
    yAxisIndex: q.yAxisIndex === 1 ? 1 : 0,
    data: results[composeKey(panel.id, q.key)]?.series ?? [],
  }));
  return (
    <MetricTimeSeriesChart
      groups={groups}
      unit={panel.unit}
      height={height}
      chartMin={chartMin}
      chartMax={chartMax}
      yMin={panel.yMin}
      yMax={panel.yMax}
      showLegend={panel.showLegend}
      stack={panel.stack}
      secondaryUnit={panel.secondaryUnit}
      secondaryYMin={panel.secondaryYMin}
      secondaryYMax={panel.secondaryYMax}
      loading={loading}
    />
  );
}

function renderGaugePanel(
  panel: GaugePanelDef,
  results: Record<string, PromQueryResult>,
  height: number = CHART_HEIGHT,
  loading = false,
): React.ReactNode {
  const series = results[composeKey(panel.id, panel.query.key)]?.series ?? [];
  return (
    <MetricGauge
      series={series}
      min={panel.min}
      max={panel.max}
      unit={panel.unit}
      thresholds={panel.thresholds}
      height={height}
      loading={loading}
    />
  );
}

function renderDiskSpaceTablePanel(
  panel: DiskSpaceTablePanelDef,
  results: Record<string, PromQueryResult>,
  scrollY: number | string = TABLE_SCROLL_Y,
): React.ReactNode {
  const sizeSeries = results[composeKey(panel.id, panel.sizeQuery.key)]?.series ?? [];
  const availSeries = results[composeKey(panel.id, panel.availQuery.key)]?.series ?? [];
  return <MetricDiskSpaceTable sizeSeries={sizeSeries} availSeries={availSeries} scrollY={scrollY} />;
}

function renderNodesPanelBody(
  panel: NodesPanelDef,
  results: Record<string, PromQueryResult>,
  chartMin: number,
  chartMax: number,
  options?: { chartHeight?: number; tableScrollY?: number | string; loading?: boolean },
): React.ReactNode {
  const chartHeight = options?.chartHeight ?? CHART_HEIGHT;
  const loading = options?.loading ?? false;
  switch (panel.kind) {
    case 'timeseries':
      return renderTimeSeriesPanel(panel, results, chartMin, chartMax, chartHeight, loading);
    case 'gauge':
      return renderGaugePanel(panel, results, chartHeight, loading);
    case 'diskSpaceTable':
      return renderDiskSpaceTablePanel(panel, results, options?.tableScrollY);
  }
}

/** 收集本 Section 全部 panel 的 query 列表，喂给 usePromQueries 统一拉取 */
function collectAllQueries(): PromQueryDef[] {
  const list: PromQueryDef[] = [];
  for (const group of NODES_PANEL_GROUPS) {
    for (const panel of group.panels) {
      const push = (panelId: string, q: PanelQueryDef) => {
        list.push({ key: composeKey(panelId, q.key), expr: q.expr, legend: q.legend });
      };
      switch (panel.kind) {
        case 'timeseries':
          panel.queries.forEach((q) => push(panel.id, q));
          break;
        case 'gauge':
          push(panel.id, panel.query);
          break;
        case 'diskSpaceTable':
          push(panel.id, panel.sizeQuery);
          push(panel.id, panel.availQuery);
          break;
      }
    }
  }
  return list;
}

const ALL_QUERIES = collectAllQueries();

const OpsDashboardNodesSectionBody: React.FC<OpsDashboardNodesSectionProps> = ({
  cloudId,
  resolved,
  reloadToken,
}) => {
  const { resolveLabel } = usePhysicalHostInstanceLabelMap(cloudId);
  const [instance, setInstance] = useState<string>('');
  const [instances, setInstances] = useState<string[]>([]);
  const [instancesLoading, setInstancesLoading] = useState<boolean>(false);
  const [instancesError, setInstancesError] = useState<string | undefined>();
  const [previewPanelId, setPreviewPanelId] = useState<string | null>(null);
  const instanceCtrlRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!cloudId) return undefined;
    if (instanceCtrlRef.current) instanceCtrlRef.current.abort();
    const ctrl = new AbortController();
    instanceCtrlRef.current = ctrl;
    setInstancesLoading(true);
    setInstancesError(undefined);
    const now = Math.floor(Date.now() / 1000);
    void fetchMetricRange(
      cloudId,
      { query: INSTANCE_QUERY, start: now - 5 * 60, end: now, step: 60 },
      { signal: ctrl.signal },
    ).then((res) => {
      if (ctrl.signal.aborted) return;
      if (res.ok) {
        const result = res.data?.data?.result ?? [];
        const set = new Set<string>();
        result.forEach((r) => {
          const inst = String(r?.metric?.instance ?? '').trim();
          if (inst) set.add(inst);
        });
        const list = Array.from(set).sort();
        setInstances(list);
        setInstance((prev) => (prev && list.includes(prev) ? prev : list[0] ?? ''));
      } else {
        setInstances([]);
        setInstancesError(res.error ?? '加载节点列表失败');
      }
      setInstancesLoading(false);
    });
    return () => ctrl.abort();
  }, [cloudId, reloadToken]);

  const globalVars = useMemo(
    () => ({
      __rate_interval: resolved.rateInterval,
      __interval: resolved.intervalStr,
      instance,
    }),
    [resolved.rateInterval, resolved.intervalStr, instance],
  );

  /** 没选定 instance 时不发出业务查询，避免 PromQL 含字面 `$instance` 失败 */
  const effectiveQueries = useMemo(() => (instance ? ALL_QUERIES : []), [instance]);

  const { results, fetchedWindow, error: aggregateError } = usePromQueries({
    cloudId,
    queries: effectiveQueries,
    start: resolved.start,
    end: resolved.end,
    step: resolved.step,
    globalVars,
    reloadToken,
  });

  const { chartMin, chartMax } = resolveChartTimeBoundsMs(resolved, fetchedWindow);

  const instanceOptions = useMemo(
    () =>
      instances.map((inst) => {
        const nodeName = resolveLabel(inst);
        return {
          value: inst,
          label: nodeName && nodeName !== inst ? `${nodeName} (${inst})` : inst,
        };
      }),
    [instances, resolveLabel],
  );

  const previewPanel = useMemo(
    () => (previewPanelId ? ALL_NODES_PANELS.find((p) => p.id === previewPanelId) ?? null : null),
    [previewPanelId],
  );

  const previewLoadState = previewPanel ? getPanelLoadState(previewPanel, results) : null;
  const previewPanelInitialLoading = previewLoadState?.initialLoading ?? false;
  const previewPanelError = previewPanel ? panelErrorMsg(previewPanel, results) : undefined;
  const previewPanelEmpty =
    previewPanel != null && !previewPanelInitialLoading && isPanelEmpty(previewPanel, results);

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={8} style={OVERVIEW_CARD_COL_FILL_STYLE}>
          <OpsDashboardNodesHostsCard height={OVERVIEW_CARD_ROW_HEIGHT} />
        </Col>
        <Col xs={24} lg={8} style={OVERVIEW_CARD_COL_FILL_STYLE}>
          <OpsDashboardNodesCpuCard
            cloudId={cloudId}
            resolved={resolved}
            reloadToken={reloadToken}
            height={OVERVIEW_CARD_ROW_HEIGHT}
          />
        </Col>
        <Col xs={24} lg={8} style={OVERVIEW_CARD_COL_FILL_STYLE}>
          <OpsDashboardNodesMemoryCard
            cloudId={cloudId}
            resolved={resolved}
            reloadToken={reloadToken}
            height={OVERVIEW_CARD_ROW_HEIGHT}
          />
        </Col>
      </Row>

      <Space size={12} wrap>
        <Typography.Text strong>节点</Typography.Text>
        <Select
          size="middle"
          showSearch
          style={{ minWidth: 280 }}
          placeholder={instancesLoading ? '加载节点列表中…' : '选择节点'}
          value={instance || undefined}
          options={instanceOptions}
          onChange={(v) => setInstance(String(v ?? ''))}
          loading={instancesLoading}
          disabled={instancesLoading}
          notFoundContent={instancesLoading ? '加载中…' : '没有匹配 node-exporter 的节点'}
          optionFilterProp="label"
        />
      </Space>

      {instancesError ? (
        <Alert
          type="warning"
          showIcon
          message="节点列表加载失败"
          description={instancesError}
          style={{ whiteSpace: 'pre-wrap' }}
        />
      ) : null}

      {aggregateError ? (
        <Alert
          type="warning"
          showIcon
          message="部分面板加载失败"
          description={aggregateError}
          style={{ whiteSpace: 'pre-wrap' }}
        />
      ) : null}

      {!instance && !instancesLoading ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选择一个节点查看 Node Exporter 指标" />
      ) : null}

      {instancesLoading && !instance ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : (
        instance &&
        NODES_PANEL_GROUPS.map((group) => (
          <div key={group.id}>
            <Typography.Title level={5} style={{ margin: '0 0 8px' }}>
              {group.title}
            </Typography.Title>
            <Row gutter={[16, 16]}>
              {group.panels.map((panel) => {
                const { initialLoading } = getPanelLoadState(panel, results);
                const error = panelErrorMsg(panel, results);
                const empty = !initialLoading && isPanelEmpty(panel, results);
                const height = panel.kind === 'diskSpaceTable' ? TABLE_PANEL_HEIGHT : PANEL_HEIGHT;
                return (
                  <Col key={panel.id} xs={panel.col.xs} lg={panel.col.lg}>
                    <MetricPanelCard
                      title={panel.title}
                      description={panel.description}
                      extra={<MetricPanelExpandButton onClick={() => setPreviewPanelId(panel.id)} />}
                      loading={initialLoading}
                      error={error}
                      isEmpty={empty}
                      height={height}
                      bodyPadding={12}
                    >
                      {renderNodesPanelBody(panel, results, chartMin, chartMax, {
                        loading: initialLoading,
                      })}
                    </MetricPanelCard>
                  </Col>
                );
              })}
            </Row>
          </div>
        ))
      )}
      <MetricPanelPreviewModal
        open={previewPanel != null}
        onClose={() => setPreviewPanelId(null)}
        title={previewPanel?.title}
        description={previewPanel?.description}
        loading={previewPanelInitialLoading}
        error={previewPanelError}
        isEmpty={previewPanelEmpty}
        width={previewPanel?.kind === 'diskSpaceTable' ? PREVIEW_TABLE_MODAL_WIDTH : undefined}
      >
        {previewPanel
          ? renderNodesPanelBody(previewPanel, results, chartMin, chartMax, {
              chartHeight: PREVIEW_CHART_HEIGHT,
              tableScrollY: PREVIEW_TABLE_SCROLL_Y,
              loading: previewPanelInitialLoading,
            })
          : null}
      </MetricPanelPreviewModal>
    </Space>
  );
};

const OpsDashboardNodesSection: React.FC<OpsDashboardNodesSectionProps> = (props) => (
  <MonitoringOverviewLanesProvider cloudId={props.cloudId}>
    <OpsDashboardNodesSectionBody {...props} />
  </MonitoringOverviewLanesProvider>
);

export default OpsDashboardNodesSection;
