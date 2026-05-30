/**
 * 运维监控大盘 · 节点视图（对齐 Grafana 仪表盘 `Node Exporter / Nodes`）。
 *
 * 与 Grafana 的差异：
 * - 顶部 `Instance` 模板变量由后端 Prometheus `query_range` 取 `node_uname_info` 标签实现，
 *   不依赖 Grafana 的 label_values API；切换 instance 触发 usePromQueries 重拉。
 * - 共 4 个分组（CPU / Memory / Disk / Network），分别承载 timeseries / gauge / table 三种 panel 类型，
 *   表格使用最后一个样本值表示 instant 查询（与 Grafana `instant: true` 等价，避免新增后端 instant 接口）。
 * - Disk I/O 的 `io time` 在原仪表盘里走右轴 percentunit，本实现复用 `MetricTimeSeriesChart` 的
 *   `secondaryUnit` + group `yAxisIndex: 1` 同样实现双轴。
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Col, Empty, Row, Select, Skeleton, Space, Typography } from 'antd';
import MetricPanelCard from '../components/MetricPanelCard';
import MetricTimeSeriesChart, { type MetricSeriesInput } from '../components/MetricTimeSeriesChart';
import MetricGauge from '../components/MetricGauge';
import MetricDiskSpaceTable from '../components/MetricDiskSpaceTable';
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
const TABLE_PANEL_HEIGHT = 320;
const TABLE_SCROLL_Y = 220;

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
  title: string;
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
const DISK_DEV_REGEX = '(/dev/)?(mmcblk.p.+|nvme.+|rbd.+|sd.+|vd.+|xvd.+|dm-.+|md.+|dasd.+)';

const NODES_PANEL_GROUPS: NodesPanelGroup[] = [
  {
    id: 'cpu',
    title: 'CPU',
    panels: [
      {
        kind: 'timeseries',
        id: 'node-cpu-utilization',
        title: '节点CPU利用率(%)',
        description:
          '每个 CPU 核的非空闲占比，sum without (mode) 排除 idle/iowait/steal 后除以总核数；按 cpu 堆叠，总高度对应整机 CPU 利用率',
        unit: 'percent01',
        yMin: 0,
        yMax: 1,
        stack: true,
        showLegend: true,
        col: { xs: 24, lg: 12 },
        queries: [
          {
            key: 'A',
            expr:
              '(\n  (1 - sum without (mode) (rate(node_cpu_seconds_total{job="node-exporter", mode=~"idle|iowait|steal", instance="$instance"}[$__rate_interval])))\n/ ignoring(cpu) group_left\n  count without (cpu, mode) (node_cpu_seconds_total{job="node-exporter", mode="idle", instance="$instance"})\n)',
            legend: '{{cpu}}',
          },
        ],
      },
      {
        kind: 'timeseries',
        id: 'load-average',
        title: '系统负载',
        description: '1m / 5m / 15m 平均负载 + 逻辑核心数（参考线，便于判断 load 是否超核）',
        unit: 'short',
        yMin: 0,
        showLegend: true,
        col: { xs: 24, lg: 12 },
        queries: [
          {
            key: 'A',
            expr: 'node_load1{job="node-exporter", instance="$instance"}',
            legend: '1m load average',
            color: '#1677ff',
          },
          {
            key: 'B',
            expr: 'node_load5{job="node-exporter", instance="$instance"}',
            legend: '5m load average',
            color: '#fa8c16',
          },
          {
            key: 'C',
            expr: 'node_load15{job="node-exporter", instance="$instance"}',
            legend: '15m load average',
            color: '#eb2f96',
          },
          {
            key: 'D',
            expr: 'count(node_cpu_seconds_total{job="node-exporter", instance="$instance", mode="idle"})',
            legend: 'logical cores',
            color: '#8c8c8c',
          },
        ],
      },
    ],
  },
  {
    id: 'memory',
    title: 'Memory',
    panels: [
      {
        kind: 'timeseries',
        id: 'memory-usage',
        title: '内存使用',
        description: 'used / buffers / cached / free 四段堆叠（used = MemTotal - MemFree - Buffers - Cached），总高度即 MemTotal',
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
            legend: 'memory used',
            color: '#eb2f96',
          },
          {
            key: 'B',
            expr: 'node_memory_Buffers_bytes{job="node-exporter", instance="$instance"}',
            legend: 'memory buffers',
            color: '#faad14',
          },
          {
            key: 'C',
            expr: 'node_memory_Cached_bytes{job="node-exporter", instance="$instance"}',
            legend: 'memory cached',
            color: '#13c2c2',
          },
          {
            key: 'D',
            expr: 'node_memory_MemFree_bytes{job="node-exporter", instance="$instance"}',
            legend: 'memory free',
            color: '#52c41a',
          },
        ],
      },
      {
        kind: 'gauge',
        id: 'memory-gauge',
        title: '内存使用率',
        description: '当前已用内存占比 = 1 - MemAvailable / MemTotal（与左侧明细一致；超 80% 黄色、超 90% 红色）',
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
    ],
  },
  {
    id: 'disk',
    title: 'Disk',
    panels: [
      {
        kind: 'timeseries',
        id: 'disk-io',
        title: '磁盘 I/O',
        description: '物理磁盘读写吞吐（左轴 B/s）与设备 I/O 时间占比（右轴 0–100%）；io time 接近 100% 表示磁盘繁忙',
        unit: 'bytesRate',
        yMin: 0,
        secondaryUnit: 'percent01',
        secondaryYMin: 0,
        secondaryYMax: 1,
        showLegend: true,
        col: { xs: 24, lg: 12 },
        queries: [
          {
            key: 'A',
            expr: `rate(node_disk_read_bytes_total{job="node-exporter", instance="$instance", device=~"${DISK_DEV_REGEX}"}[$__rate_interval])`,
            legend: '{{device}} read',
          },
          {
            key: 'B',
            expr: `rate(node_disk_written_bytes_total{job="node-exporter", instance="$instance", device=~"${DISK_DEV_REGEX}"}[$__rate_interval])`,
            legend: '{{device}} written',
          },
          {
            key: 'C',
            expr: `rate(node_disk_io_time_seconds_total{job="node-exporter", instance="$instance", device=~"${DISK_DEV_REGEX}"}[$__rate_interval])`,
            legend: '{{device}} io time',
            yAxisIndex: 1,
          },
        ],
      },
      {
        kind: 'diskSpaceTable',
        id: 'disk-space-usage',
        title: '磁盘空间使用',
        description: '按挂载点聚合 node_filesystem_size_bytes 与 node_filesystem_avail_bytes，计算 Used 与 Used%（fstype 与 mountpoint 均非空）',
        col: { xs: 24, lg: 12 },
        sizeQuery: {
          key: 'A',
          expr:
            'max by (mountpoint) (node_filesystem_size_bytes{job="node-exporter", instance="$instance", fstype!="", mountpoint!=""})',
          legend: '',
        },
        availQuery: {
          key: 'B',
          expr:
            'max by (mountpoint) (node_filesystem_avail_bytes{job="node-exporter", instance="$instance", fstype!="", mountpoint!=""})',
          legend: '',
        },
      },
    ],
  },
  {
    id: 'network',
    title: 'Network',
    panels: [
      {
        kind: 'timeseries',
        id: 'network-received',
        title: '网卡入流量',
        description: '每个网卡 rate(node_network_receive_bytes_total) × 8（bit/s），排除 lo',
        unit: 'bitsRate',
        yMin: 0,
        showLegend: true,
        col: { xs: 24, lg: 12 },
        queries: [
          {
            key: 'A',
            expr:
              'rate(node_network_receive_bytes_total{job="node-exporter", instance="$instance", device!="lo"}[$__rate_interval]) * 8',
            legend: '{{device}}',
          },
        ],
      },
      {
        kind: 'timeseries',
        id: 'network-transmitted',
        title: '网卡出流量',
        description: '每个网卡 rate(node_network_transmit_bytes_total) × 8（bit/s），排除 lo',
        unit: 'bitsRate',
        yMin: 0,
        showLegend: true,
        col: { xs: 24, lg: 12 },
        queries: [
          {
            key: 'A',
            expr:
              'rate(node_network_transmit_bytes_total{job="node-exporter", instance="$instance", device!="lo"}[$__rate_interval]) * 8',
            legend: '{{device}}',
          },
        ],
      },
    ],
  },
];

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
      height={CHART_HEIGHT}
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
      height={CHART_HEIGHT}
      loading={loading}
    />
  );
}

function renderDiskSpaceTablePanel(
  panel: DiskSpaceTablePanelDef,
  results: Record<string, PromQueryResult>,
): React.ReactNode {
  const sizeSeries = results[composeKey(panel.id, panel.sizeQuery.key)]?.series ?? [];
  const availSeries = results[composeKey(panel.id, panel.availQuery.key)]?.series ?? [];
  return <MetricDiskSpaceTable sizeSeries={sizeSeries} availSeries={availSeries} scrollY={TABLE_SCROLL_Y} />;
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

const OpsDashboardNodesSection: React.FC<OpsDashboardNodesSectionProps> = ({
  cloudId,
  resolved,
  reloadToken,
}) => {
  const [instance, setInstance] = useState<string>('');
  const [instances, setInstances] = useState<string[]>([]);
  const [instancesLoading, setInstancesLoading] = useState<boolean>(false);
  const [instancesError, setInstancesError] = useState<string | undefined>();
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
    () => instances.map((inst) => ({ value: inst, label: inst })),
    [instances],
  );

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
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
                let body: React.ReactNode;
                switch (panel.kind) {
                  case 'timeseries':
                    body = renderTimeSeriesPanel(panel, results, chartMin, chartMax, initialLoading);
                    break;
                  case 'gauge':
                    body = renderGaugePanel(panel, results, initialLoading);
                    break;
                  case 'diskSpaceTable':
                    body = renderDiskSpaceTablePanel(panel, results);
                    break;
                }
                return (
                  <Col key={panel.id} xs={panel.col.xs} lg={panel.col.lg}>
                    <MetricPanelCard
                      title={panel.title}
                      description={panel.description}
                      loading={initialLoading}
                      error={error}
                      isEmpty={empty}
                      height={height}
                      bodyPadding={12}
                    >
                      {body}
                    </MetricPanelCard>
                  </Col>
                );
              })}
            </Row>
          </div>
        ))
      )}
    </Space>
  );
};

export default OpsDashboardNodesSection;
