/**
 * 运维监控大盘 · 集群概览监控视图
 * 数据流：将各面板的 PromQL 合并成一组 query，统一经
 * `usePromQueries` → 后端 `/monitoring/metric-range` → Prometheus query_range 拉回，
 * 再按 panelId 分发给 `MetricTimeSeriesChart` 渲染。面板按算力 / 磁盘 / 网络分组展示（与节点视图一致）。
 */
import React, { useMemo, useState } from 'react';
import { Alert, Col, Row, Space, Typography } from 'antd';
import MetricPanelCard from '../components/MetricPanelCard';
import MetricPanelExpandButton from '../components/MetricPanelExpandButton';
import MetricPanelPreviewModal from '../components/MetricPanelPreviewModal';
import MetricTimeSeriesChart, { type MetricSeriesInput } from '../components/MetricTimeSeriesChart';
import OpsDashboardClusterCpuCard from '../components/OpsDashboardClusterCpuCard';
import OpsDashboardClusterDiskCard from '../components/OpsDashboardClusterDiskCard';
import OpsDashboardClusterMemoryCard from '../components/OpsDashboardClusterMemoryCard';
import { MonitoringOverviewLanesProvider } from '../MonitoringOverviewLanesContext';
import { usePromQueries, type PromQueryDef, resolveChartTimeBoundsMs } from '../hooks/usePromQueries';
import { derivePanelLoadState } from '../lib/panelLoadState';
import type { UnitKind } from '../lib/unit';
import type { ResolvedTimeRange } from '../hooks/useDashboardTimeRange';

export interface OpsDashboardClusterSectionProps {
  cloudId: string;
  resolved: ResolvedTimeRange;
  reloadToken: number;
}

interface PanelQueryDef {
  /** 与 Grafana panel 内 `refId` 一致 */
  key: string;
  expr: string;
  /** legend 展示文本（不含 `{{}}` 模板时按字面值显示） */
  legend: string;
  color?: string;
}

interface ClusterPanelDef {
  id: string;
  title: string;
  description?: string;
  unit: UnitKind;
  yMin?: number;
  yMax?: number;
  showLegend?: boolean;
  /** Grafana percentunit 默认 max=1，min=0；其它单位按数据自适应 */
  queries: PanelQueryDef[];
}

interface ClusterPanelGroup {
  id: string;
  title: string;
  panels: ClusterPanelDef[];
}

const PANEL_HEIGHT = 320;
const CHART_HEIGHT = 240;
const PREVIEW_CHART_HEIGHT = 480;
const OVERVIEW_CARD_ROW_HEIGHT = 220;

const OVERVIEW_CARD_COL_FILL_STYLE: React.CSSProperties = {
  display: 'flex',
  minHeight: 0,
  minWidth: 0,
  width: '100%',
  height: OVERVIEW_CARD_ROW_HEIGHT,
};
const NETWORK_TRAFFIC_COLORS = ['#ff4d4f', '#13c2c2', '#fa8c16', '#722ed1', '#eb2f96', '#1677ff'];

/** 与 cattle-monitoring-system/node-filesystem-custom-rules 告警规则一致的 filesystem 筛选 */
const NODE_FILESYSTEM_SELECTOR =
  'job="node-exporter",fstype!~"^(fuse.*|tmpfs|cifs|nfs)",mountpoint!=""';

/** 与 cattle-monitoring-system/node-disk-custom-rules 告警规则一致的块设备筛选 */
const NODE_DISK_DEVICE_SELECTOR =
  'job="node-exporter",device=~"(/dev/)?(mmcblk.p.+|nvme.+|rbd.+|sd.+|vd.+|xvd.+|md.+|dasd.+)"';

/** 与 cattle-monitoring-system/k8s-node-custom-rules 告警规则一致的物理网卡筛选 */
const NODE_NETWORK_DEVICE_SELECTOR =
  'job="node-exporter",device!~"lo|veth.*|docker.*|flannel.*|cali.*|cbr.*|virbr.*"';

/** 集群概览监控面板定义（按域分组） */
const CLUSTER_PANEL_GROUPS: ClusterPanelGroup[] = [
  {
    id: 'cluster-compute',
    title: '计算',
    panels: [
  {
    id: 'cluster-cpu-utilization',
    title: '集群CPU利用率(%)',
    description:
      '汇总集群内各物理节点的 CPU 繁忙程度。数值越高表示算力占用越多；若长期接近 100%，说明集群整体算力偏紧，可能影响虚拟机与容器运行。',
    unit: 'percent01',
    yMin: 0,
    yMax: 1,
    showLegend: false,
    queries: [
      {
        key: 'A',
        expr: '1 - avg(irate(node_cpu_seconds_total{mode="idle"}[$__rate_interval]))',
        legend: '合计',
        color: '#1677ff',
      },
    ],
  },
  {
    id: 'cluster-memory-utilization',
    title: '集群内存使用率(%)',
    description:
      '汇总集群内各节点已用内存占物理内存总量的比例。数值越高表示内存越紧张；持续偏高时，可能出现内存不足、触发换页或影响业务稳定性。',
    unit: 'percent01',
    yMin: 0,
    yMax: 1,
    showLegend: false,
    queries: [
      {
        key: 'A',
        expr: '1 - sum(node_memory_MemAvailable_bytes) / sum(node_memory_MemTotal_bytes)',
        legend: '合计',
        color: '#52c41a',
      },
    ],
  },
  {
    id: 'cluster-load-average',
    title: '集群系统负载(count)',
    description:
      '各节点会统计一段时间内「正在跑 + 在等资源」的任务拥挤程度（系统负载），本图把全部节点的该数值按 1 / 5 / 15 分钟分别相加。以 1 分钟线为例：若读数约为 4，可理解为最近一段时间内，集群层面平均约有 4 个任务处在运行，或排队等 CPU、或排队等磁盘 I/O。持续偏高或短期尖峰时，说明整体算力排队偏严重，可能出现响应变慢。',
    unit: 'count',
    showLegend: true,
    queries: [
      {
        key: 'A',
        expr: 'sum(node_load1)',
        legend: '1 分钟负载',
        color: '#1677ff',
      },
      {
        key: 'B',
        expr: 'sum(node_load5)',
        legend: '5 分钟负载',
        color: '#fa8c16',
      },
      {
        key: 'C',
        expr: 'sum(node_load15)',
        legend: '15 分钟负载',
        color: '#eb2f96',
      },
    ],
  },
    ],
  },
  {
    id: 'cluster-disk',
    title: '磁盘',
    panels: [
  {
    id: 'cluster-disk-utilization',
    title: '集群磁盘使用率(%)',
    description:
      '汇总各节点真实挂载文件系统的已用空间占比（排除 tmpfs、fuse、cifs、nfs 等虚拟或网络文件系统；数值越高表示磁盘越满；接近上限前需扩容或清理，否则可能影响写入与快照。',
    unit: 'percent01',
    yMin: 0,
    yMax: 1,
    showLegend: false,
    queries: [
      {
        key: 'A',
        expr:
          `1 - sum(node_filesystem_avail_bytes{${NODE_FILESYSTEM_SELECTOR}}) / sum(node_filesystem_size_bytes{${NODE_FILESYSTEM_SELECTOR}})`,
        legend: '合计',
        color: '#fa8c16',
      },
    ],
  },
  {
    id: 'cluster-disk-io',
    title: '集群磁盘吞吐',
    description:
      '集群内各节点真实块设备（sd/nvme/mmc 等）每秒读、写数据量之和。「读高」常见于备份恢复、镜像拉取；「写高」常见于虚拟机落盘、日志与存储同步；突增可结合业务操作排查。',
    unit: 'bytesRate',
    showLegend: true,
    queries: [
      {
        key: 'A',
        expr: `sum(rate(node_disk_read_bytes_total{${NODE_DISK_DEVICE_SELECTOR}}[$__rate_interval]))`,
        legend: '读取',
        color: '#1677ff',
      },
      {
        key: 'B',
        expr: `sum(rate(node_disk_written_bytes_total{${NODE_DISK_DEVICE_SELECTOR}}[$__rate_interval]))`,
        legend: '写入',
        color: '#eb2f96',
      },
    ],
  },
  {
    id: 'cluster-inode-utilization',
    title: '集群inode使用率(%)',
    description:
      '汇总各节点真实挂载文件系统已用 inode 占比（排除 tmpfs、fuse、cifs、nfs 等）；inode 限制可创建的文件/目录总数，与磁盘容量无关；数值越高表示 inode 越紧张，即使磁盘仍有空间也可能无法新建文件。',
    unit: 'percent01',
    yMin: 0,
    yMax: 1,
    showLegend: false,
    queries: [
      {
        key: 'A',
        expr:
          `1 - sum(node_filesystem_files_free{${NODE_FILESYSTEM_SELECTOR}}) / sum(node_filesystem_files{${NODE_FILESYSTEM_SELECTOR}})`,
        legend: '合计',
        color: '#722ed1',
      },
    ],
  },
    ],
  },
  {
    id: 'network',
    title: '网络',
    panels: [
  {
    id: 'cluster-network-traffic',
    title: '集群网络包速率',
    description:
      '物理网卡每秒收发包数量，以及错包、丢包情况（已排除 lo、容器虚拟网卡、virbr 等内部流量）；错包或丢包持续增多时，可能存在链路质量、网卡或驱动问题。',
    unit: 'pps',
    showLegend: true,
    queries: [
      {
        key: 'A',
        expr: `sum(rate(node_network_receive_errs_total{${NODE_NETWORK_DEVICE_SELECTOR}}[$__rate_interval]))`,
        legend: '接收错包',
        color: NETWORK_TRAFFIC_COLORS[0],
      },
      {
        key: 'B',
        expr: `sum(rate(node_network_receive_packets_total{${NODE_NETWORK_DEVICE_SELECTOR}}[$__rate_interval]))`,
        legend: '接收包数',
        color: NETWORK_TRAFFIC_COLORS[1],
      },
      {
        key: 'C',
        expr: `sum(rate(node_network_transmit_errs_total{${NODE_NETWORK_DEVICE_SELECTOR}}[$__rate_interval]))`,
        legend: '发送错包',
        color: NETWORK_TRAFFIC_COLORS[2],
      },
      {
        key: 'D',
        expr: `sum(rate(node_network_receive_drop_total{${NODE_NETWORK_DEVICE_SELECTOR}}[$__rate_interval]))`,
        legend: '接收丢包',
        color: NETWORK_TRAFFIC_COLORS[3],
      },
      {
        key: 'E',
        expr: `sum(rate(node_network_transmit_drop_total{${NODE_NETWORK_DEVICE_SELECTOR}}[$__rate_interval]))`,
        legend: '发送丢包',
        color: NETWORK_TRAFFIC_COLORS[4],
      },
      {
        key: 'F',
        expr: `sum(rate(node_network_transmit_packets_total{${NODE_NETWORK_DEVICE_SELECTOR}}[$__rate_interval]))`,
        legend: '发送包数',
        color: NETWORK_TRAFFIC_COLORS[5],
      },
    ],
  },
  {
    id: 'cluster-network-io',
    title: '集群网络吞吐',
    description:
      '物理网卡每秒上传、下载的数据量之和（已排除 lo、容器虚拟网卡、virbr 等内部流量）；可用来观察集群对外带宽是否打满；流量突增时可对照业务高峰或迁移任务。',
    unit: 'bytesRate',
    showLegend: true,
    queries: [
      {
        key: 'A',
        expr: `sum(rate(node_network_transmit_bytes_total{${NODE_NETWORK_DEVICE_SELECTOR}}[$__rate_interval]))`,
        legend: '发送流量',
        color: '#13c2c2',
      },
      {
        key: 'B',
        expr: `sum(rate(node_network_receive_bytes_total{${NODE_NETWORK_DEVICE_SELECTOR}}[$__rate_interval]))`,
        legend: '接收流量',
        color: '#fa8c16',
      },
    ],
  },
    ],
  },
];

const ALL_CLUSTER_PANELS = CLUSTER_PANEL_GROUPS.flatMap((g) => g.panels);

/** 把 panelId + queryKey 拼成 hook 用的全局唯一 key，避免不同面板间冲突 */
function composeKey(panelId: string, queryKey: string): string {
  return `${panelId}__${queryKey}`;
}

function buildPanelSeriesGroups(
  panel: ClusterPanelDef,
  results: ReturnType<typeof usePromQueries>['results'],
): {
  groups: MetricSeriesInput[];
  initialLoading: boolean;
  error?: string;
  isEmpty: boolean;
} {
  const panelResults = panel.queries.map((q) => results[composeKey(panel.id, q.key)]);
  const { initialLoading } = derivePanelLoadState(panelResults);
  const panelErrors = panelResults.map((r) => r?.error).filter((m): m is string => Boolean(m));
  const error = panelErrors.length === panel.queries.length ? panelErrors.join('\n') : undefined;
  const isEmpty = panelResults.every(
    (r) => !r || r.series.length === 0 || r.series.every((s) => s.values.length === 0),
  );
  const groups: MetricSeriesInput[] = panel.queries.map((q, idx) => ({
    name: q.legend,
    color: q.color,
    data: panelResults[idx]?.series ?? [],
  }));
  return { groups, initialLoading, error, isEmpty };
}

function renderClusterTimeSeriesChart(
  panel: ClusterPanelDef,
  groups: MetricSeriesInput[],
  chartMin: number,
  chartMax: number,
  height: number,
  loading = false,
): React.ReactNode {
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
      loading={loading}
    />
  );
}

const OpsDashboardClusterSection: React.FC<OpsDashboardClusterSectionProps> = ({
  cloudId,
  resolved,
  reloadToken,
}) => {
  const [previewPanelId, setPreviewPanelId] = useState<string | null>(null);

  const queries = useMemo<PromQueryDef[]>(() => {
    return ALL_CLUSTER_PANELS.flatMap((panel) =>
      panel.queries.map<PromQueryDef>((q) => ({
        key: composeKey(panel.id, q.key),
        expr: q.expr,
        legend: q.legend,
      })),
    );
  }, []);

  const globalVars = useMemo(
    () => ({ __rate_interval: resolved.rateInterval, __interval: resolved.intervalStr }),
    [resolved.rateInterval, resolved.intervalStr],
  );

  const { results, fetchedWindow, error: aggregateError } = usePromQueries({
    cloudId,
    queries,
    start: resolved.start,
    end: resolved.end,
    step: resolved.step,
    globalVars,
    reloadToken,
  });

  const { chartMin, chartMax } = resolveChartTimeBoundsMs(resolved, fetchedWindow);

  const previewPanel = useMemo(
    () => (previewPanelId ? ALL_CLUSTER_PANELS.find((p) => p.id === previewPanelId) ?? null : null),
    [previewPanelId],
  );

  const previewPanelData = useMemo(() => {
    if (!previewPanel) return null;
    return buildPanelSeriesGroups(previewPanel, results);
  }, [previewPanel, results]);

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {aggregateError ? (
        <Alert
          type="warning"
          showIcon
          message="部分面板加载失败"
          description={aggregateError}
          style={{ whiteSpace: 'pre-wrap' }}
        />
      ) : null}

      <MonitoringOverviewLanesProvider cloudId={cloudId}>
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={8} style={OVERVIEW_CARD_COL_FILL_STYLE}>
            <OpsDashboardClusterCpuCard height={OVERVIEW_CARD_ROW_HEIGHT} />
          </Col>
          <Col xs={24} lg={8} style={OVERVIEW_CARD_COL_FILL_STYLE}>
            <OpsDashboardClusterMemoryCard height={OVERVIEW_CARD_ROW_HEIGHT} />
          </Col>
          <Col xs={24} lg={8} style={OVERVIEW_CARD_COL_FILL_STYLE}>
            <OpsDashboardClusterDiskCard
              height={OVERVIEW_CARD_ROW_HEIGHT}
              cloudId={cloudId}
              resolved={resolved}
              reloadToken={reloadToken}
            />
          </Col>
        </Row>
      </MonitoringOverviewLanesProvider>

      {CLUSTER_PANEL_GROUPS.map((group) => (
        <div key={group.id}>
          <Typography.Title level={5} style={{ margin: '0 0 8px' }}>
            {group.title}
          </Typography.Title>
          <Row gutter={[16, 16]}>
            {group.panels.map((panel) => {
              const { groups, initialLoading, error: panelError, isEmpty } = buildPanelSeriesGroups(
                panel,
                results,
              );

              return (
                <Col key={panel.id} xs={24} md={12} lg={8}>
                  <MetricPanelCard
                    title={panel.title}
                    description={panel.description}
                    extra={<MetricPanelExpandButton onClick={() => setPreviewPanelId(panel.id)} />}
                    loading={initialLoading}
                    error={panelError}
                    isEmpty={isEmpty}
                    height={PANEL_HEIGHT}
                    bodyPadding={12}
                  >
                    {renderClusterTimeSeriesChart(panel, groups, chartMin, chartMax, CHART_HEIGHT, initialLoading)}
                  </MetricPanelCard>
                </Col>
              );
            })}
          </Row>
        </div>
      ))}
      <MetricPanelPreviewModal
        open={previewPanel != null}
        onClose={() => setPreviewPanelId(null)}
        title={previewPanel?.title}
        description={previewPanel?.description}
        loading={previewPanelData?.initialLoading}
        error={previewPanelData?.error}
        isEmpty={previewPanelData != null && !previewPanelData.initialLoading && previewPanelData.isEmpty}
      >
        {previewPanel && previewPanelData
          ? renderClusterTimeSeriesChart(
              previewPanel,
              previewPanelData.groups,
              chartMin,
              chartMax,
              PREVIEW_CHART_HEIGHT,
              previewPanelData.initialLoading,
            )
          : null}
      </MetricPanelPreviewModal>
    </Space>
  );
};

export default OpsDashboardClusterSection;
