/**
 * 运维监控大盘 · 集群资源视图（对齐 Grafana 仪表盘 `Rancher / Cluster`，uid=rancher-cluster-1）。
 *
 * 数据流：将各面板的 PromQL 合并成一组 query，统一经
 * `usePromQueries` → 后端 `/monitoring/metric-range` → Prometheus query_range 拉回，
 * 再按 panelId 分发给 `MetricTimeSeriesChart` 渲染。布局对齐 Grafana 24 列网格中的 3 × 7 划分。
 */
import React, { useMemo } from 'react';
import { Alert, Col, Row, Space } from 'antd';
import MetricPanelCard from '../components/MetricPanelCard';
import MetricTimeSeriesChart, { type MetricSeriesInput } from '../components/MetricTimeSeriesChart';
import { usePromQueries, type PromQueryDef } from '../hooks/usePromQueries';
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

const PANEL_HEIGHT = 320;
const CHART_HEIGHT = 240;
const NETWORK_TRAFFIC_COLORS = ['#ff4d4f', '#13c2c2', '#fa8c16', '#722ed1', '#eb2f96', '#1677ff'];

const CLUSTER_PANELS: ClusterPanelDef[] = [
  {
    id: 'cpu-utilization',
    title: 'CPU 使用率',
    description: '集群整体 CPU 利用率 = 1 - 平均 CPU 空闲率（Linux node_cpu_seconds_total）',
    unit: 'percent01',
    yMin: 0,
    yMax: 1,
    showLegend: false,
    queries: [
      {
        key: 'A',
        expr: '1 - avg(irate({__name__=~"node_cpu_seconds_total|windows_cpu_time_total",mode="idle"}[$__rate_interval]))',
        legend: 'Total',
        color: '#1677ff',
      },
    ],
  },
  {
    id: 'load-average',
    title: '系统负载',
    description: '集群所有节点 node_load1 / load5 / load15 求和',
    unit: 'short',
    showLegend: true,
    queries: [
      {
        key: 'A',
        expr: 'sum(node_load1 OR avg_over_time(windows_system_processor_queue_length[1m]))',
        legend: 'Load[1m]',
        color: '#1677ff',
      },
      {
        key: 'B',
        expr: 'sum(node_load5 OR avg_over_time(windows_system_processor_queue_length[5m]))',
        legend: 'Load[5m]',
        color: '#fa8c16',
      },
      {
        key: 'C',
        expr: 'sum(node_load15 OR avg_over_time(windows_system_processor_queue_length[15m]))',
        legend: 'Load[15m]',
        color: '#eb2f96',
      },
    ],
  },
  {
    id: 'memory-utilization',
    title: '内存使用率',
    description: '集群整体内存利用率 = 1 - 可用内存 / 总内存（Linux node_memory_MemAvailable_bytes）',
    unit: 'percent01',
    yMin: 0,
    yMax: 1,
    showLegend: false,
    queries: [
      {
        key: 'A',
        expr: '1 - sum(node_memory_MemAvailable_bytes OR windows_os_physical_memory_free_bytes) / sum(node_memory_MemTotal_bytes OR windows_cs_physical_memory_bytes)',
        legend: 'Total',
        color: '#52c41a',
      },
    ],
  },
  {
    id: 'disk-utilization',
    title: '磁盘使用率',
    description: '集群整体磁盘利用率 = 1 - 可用磁盘 / 总磁盘（排除 rootfs / HarddiskVolume.* / 系统盘符）',
    unit: 'percent01',
    yMin: 0,
    yMax: 1,
    showLegend: false,
    queries: [
      {
        key: 'A',
        expr:
          '1 - (sum(node_filesystem_free_bytes{device!~"rootfs|HarddiskVolume.+"} OR windows_logical_disk_free_bytes{volume!~"(HarddiskVolume.+|[A-Z]:.+)"}) / sum(node_filesystem_size_bytes{device!~"rootfs|HarddiskVolume.+"} OR windows_logical_disk_size_bytes{volume!~"(HarddiskVolume.+|[A-Z]:.+)"}))',
        legend: 'Total',
        color: '#fa8c16',
      },
    ],
  },
  {
    id: 'disk-io',
    title: '磁盘吞吐',
    description: '集群所有磁盘读 / 写字节速率（node_disk_*_bytes_total）',
    unit: 'bytesRate',
    showLegend: true,
    queries: [
      {
        key: 'A',
        expr: 'sum(rate(node_disk_read_bytes_total[$__rate_interval]) OR rate(windows_logical_disk_read_bytes_total[$__rate_interval]))',
        legend: 'Read',
        color: '#1677ff',
      },
      {
        key: 'B',
        expr: 'sum(rate(node_disk_written_bytes_total[$__rate_interval]) OR rate(windows_logical_disk_write_bytes_total[$__rate_interval]))',
        legend: 'Write',
        color: '#eb2f96',
      },
    ],
  },
  {
    id: 'network-traffic',
    title: '网络包速率',
    description: '集群网卡收 / 发包速率及错误 / 丢弃数（排除 lo / veth / docker / flannel / cali / cbr 等虚拟接口）',
    unit: 'pps',
    showLegend: true,
    queries: [
      {
        key: 'A',
        expr:
          '(sum(rate(node_network_receive_errs_total{device!~"lo|veth.*|docker.*|flannel.*|cali.*|cbr.*"}[$__rate_interval])) OR on() vector(0)) + (sum(rate(windows_net_packets_received_errors_total{nic!~\'.*isatap.*|.*VPN.*|.*Pseudo.*|.*tunneling.*\'}[$__rate_interval])) OR on() vector(0))',
        legend: 'Receive Errors',
        color: NETWORK_TRAFFIC_COLORS[0],
      },
      {
        key: 'B',
        expr:
          '(sum(rate(node_network_receive_packets_total{device!~"lo|veth.*|docker.*|flannel.*|cali.*|cbr.*"}[$__rate_interval])) OR on() vector(0)) + (sum(rate(windows_net_packets_received_total_total{nic!~\'.*isatap.*|.*VPN.*|.*Pseudo.*|.*tunneling.*\'}[$__rate_interval])) OR on() vector(0))',
        legend: 'Receive Total',
        color: NETWORK_TRAFFIC_COLORS[1],
      },
      {
        key: 'C',
        expr:
          '(sum(rate(node_network_transmit_errs_total{device!~"lo|veth.*|docker.*|flannel.*|cali.*|cbr.*"}[$__rate_interval])) OR on() vector(0)) + (sum(rate(windows_net_packets_outbound_errors_total{nic!~\'.*isatap.*|.*VPN.*|.*Pseudo.*|.*tunneling.*\'}[$__rate_interval])) OR on() vector(0))',
        legend: 'Transmit Errors',
        color: NETWORK_TRAFFIC_COLORS[2],
      },
      {
        key: 'D',
        expr:
          '(sum(rate(node_network_receive_drop_total{device!~"lo|veth.*|docker.*|flannel.*|cali.*|cbr.*"}[$__rate_interval])) OR on() vector(0)) + (sum(rate(windows_net_packets_received_discarded_total{nic!~\'.*isatap.*|.*VPN.*|.*Pseudo.*|.*tunneling.*\'}[$__rate_interval])) OR on() vector(0))',
        legend: 'Receive Dropped',
        color: NETWORK_TRAFFIC_COLORS[3],
      },
      {
        key: 'E',
        expr:
          '(sum(rate(node_network_transmit_drop_total{device!~"lo|veth.*|docker.*|flannel.*|cali.*|cbr.*"}[$__rate_interval])) OR on() vector(0)) + (sum(rate(windows_net_packets_outbound_discarded{nic!~\'.*isatap.*|.*VPN.*|.*Pseudo.*|.*tunneling.*\'}[$__rate_interval])) OR on() vector(0))',
        legend: 'Transmit Dropped',
        color: NETWORK_TRAFFIC_COLORS[4],
      },
      {
        key: 'F',
        expr:
          '(sum(rate(node_network_transmit_packets_total{device!~"lo|veth.*|docker.*|flannel.*|cali.*|cbr.*"}[$__rate_interval])) OR on() vector(0)) + (sum(rate(windows_net_packets_sent_total{nic!~\'.*isatap.*|.*VPN.*|.*Pseudo.*|.*tunneling.*\'}[$__rate_interval])) OR on() vector(0))',
        legend: 'Transmit Total',
        color: NETWORK_TRAFFIC_COLORS[5],
      },
    ],
  },
  {
    id: 'network-io',
    title: '网络吞吐',
    description: '集群网卡收 / 发字节速率（排除 lo / veth / docker / flannel / cali / cbr 等虚拟接口）',
    unit: 'bytesRate',
    showLegend: true,
    queries: [
      {
        key: 'A',
        expr: 'sum(rate(node_network_transmit_bytes_total{device!~"lo|veth.*|docker.*|flannel.*|cali.*|cbr.*"}[$__rate_interval]) OR rate(windows_net_packets_sent_total{nic!~\'.*isatap.*|.*VPN.*|.*Pseudo.*|.*tunneling.*\'}[$__rate_interval]))',
        legend: 'Transmit Total',
        color: '#13c2c2',
      },
      {
        key: 'B',
        expr: 'sum(rate(node_network_receive_bytes_total{device!~"lo|veth.*|docker.*|flannel.*|cali.*|cbr.*"}[$__rate_interval]) OR rate(windows_net_packets_received_total_total{nic!~\'.*isatap.*|.*VPN.*|.*Pseudo.*|.*tunneling.*\'}[$__rate_interval]))',
        legend: 'Receive Total',
        color: '#fa8c16',
      },
    ],
  },
];

/** 把 panelId + queryKey 拼成 hook 用的全局唯一 key，避免不同面板间冲突 */
function composeKey(panelId: string, queryKey: string): string {
  return `${panelId}__${queryKey}`;
}

const OpsDashboardClusterSection: React.FC<OpsDashboardClusterSectionProps> = ({
  cloudId,
  resolved,
  reloadToken,
}) => {
  const queries = useMemo<PromQueryDef[]>(() => {
    return CLUSTER_PANELS.flatMap((panel) =>
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

  const { results, error: aggregateError } = usePromQueries({
    cloudId,
    queries,
    start: resolved.start,
    end: resolved.end,
    step: resolved.step,
    globalVars,
    reloadToken,
  });

  const chartMin = resolved.start * 1000;
  const chartMax = resolved.end * 1000;

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
      <Row gutter={[16, 16]}>
        {CLUSTER_PANELS.map((panel) => {
          const panelResults = panel.queries.map((q) => results[composeKey(panel.id, q.key)]);
          const panelLoading = panelResults.some((r) => r?.loading === true);
          const panelErrors = panelResults
            .map((r) => r?.error)
            .filter((m): m is string => Boolean(m));
          const panelError = panelErrors.length === panel.queries.length ? panelErrors.join('\n') : undefined;
          const isEmpty = panelResults.every(
            (r) => !r || r.series.length === 0 || r.series.every((s) => s.values.length === 0),
          );
          const groups: MetricSeriesInput[] = panel.queries.map((q, idx) => ({
            name: q.legend,
            color: q.color,
            data: panelResults[idx]?.series ?? [],
          }));

          return (
            <Col key={panel.id} xs={24} md={12} lg={8}>
              <MetricPanelCard
                title={panel.title}
                description={panel.description}
                loading={panelLoading}
                error={panelError}
                isEmpty={!panelLoading && isEmpty}
                height={PANEL_HEIGHT}
                bodyPadding={12}
              >
                <MetricTimeSeriesChart
                  groups={groups}
                  unit={panel.unit}
                  height={CHART_HEIGHT}
                  chartMin={chartMin}
                  chartMax={chartMax}
                  yMin={panel.yMin}
                  yMax={panel.yMax}
                  showLegend={panel.showLegend}
                />
              </MetricPanelCard>
            </Col>
          );
        })}
      </Row>
    </Space>
  );
};

export default OpsDashboardClusterSection;
