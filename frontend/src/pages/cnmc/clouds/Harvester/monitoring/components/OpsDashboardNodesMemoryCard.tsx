/**
 * 运维监控大盘 · 节点概览 · 物理主机内存利用率（全部节点，列表可纵向滚动）
 * PromQL 对齐 Grafana「内存利用率」：1 - MemAvailable / MemTotal by (instance)
 */
import React, { useEffect, useMemo, useRef } from 'react';
import { FundOutlined } from '@ant-design/icons';
import { Progress, Typography } from 'antd';
import { useMonitoringOverviewFastLane } from '../MonitoringOverviewLanesContext';
import { usePromQueries, type PromSeries } from '../hooks/usePromQueries';
import { derivePanelLoadState } from '../lib/panelLoadState';
import { parseMemoryToBytes } from '../lib/nodeResourceMetrics';
import type { ResolvedTimeRange } from '../hooks/useDashboardTimeRange';
import {
  collectPhysicalHostPromMatchKeys,
  countPhysicalHosts,
  isPhysicalHostPrometheusInstance,
} from '../lib/hostSegments';
import { usePhysicalHostInstanceLabelMap } from '../hooks/usePhysicalHostInstanceLabelMap';
import OpsDashboardOverviewCard from './OpsDashboardOverviewCard';
import {
  OPS_OVERVIEW_LIST_LABEL_FONT,
  OPS_OVERVIEW_LIST_VALUE_FONT,
  opsOverviewUsageColor,
} from '../lib/opsDashboardOverviewCardLayout';

/** 与 Grafana Node Exporter「内存利用率」面板一致（Harvester 为 Linux node-exporter） */
const NODE_MEMORY_UTIL_BY_INSTANCE_EXPR =
  '1 -\n  sum by (instance) (node_memory_MemAvailable_bytes{job="node-exporter"} or windows_os_physical_memory_free_bytes{job="node-exporter"})\n  /\n  sum by (instance) (node_memory_MemTotal_bytes{job="node-exporter"} or windows_cs_physical_memory_bytes{job="node-exporter"})';

const CARD_HEADER_OFFSET = 46;
const CARD_BODY_PADDING = 24;
const HEIGHT_SIZE = 280;
const BYTES_PER_GIB = 1024 ** 3;

function pickLastUtil01(series: PromSeries): number {
  const values = series.values;
  if (!values?.length) return 0;
  const v = Number(values[values.length - 1]?.[1]);
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

function pickNodeName(node: any): string {
  return String(node?.metadata?.name ?? node?.name ?? node?.nodeName ?? '').trim();
}

function formatMemorySize(bytes: number): string {
  const gib = bytes / BYTES_PER_GIB;
  return `${(Math.round(gib * 10) / 10).toFixed(1)} GiB`;
}

export interface OpsDashboardNodesMemoryCardProps {
  cloudId: string;
  resolved: ResolvedTimeRange;
  reloadToken: number;
  height?: number;
}

const OpsDashboardNodesMemoryCard: React.FC<OpsDashboardNodesMemoryCardProps> = ({
  cloudId,
  resolved,
  reloadToken,
  height = HEIGHT_SIZE,
}) => {
  const fast = useMonitoringOverviewFastLane();
  const { resolveLabel } = usePhysicalHostInstanceLabelMap(cloudId);
  const hasDataRef = useRef(false);

  const globalVars = useMemo(
    () => ({ __rate_interval: resolved.rateInterval, __interval: resolved.intervalStr }),
    [resolved.rateInterval, resolved.intervalStr],
  );

  const memoryQueries = useMemo(
    () => [{ key: 'memByInstance', expr: NODE_MEMORY_UTIL_BY_INSTANCE_EXPR, legend: '{{instance}}' }],
    [],
  );

  const { results } = usePromQueries({
    cloudId,
    queries: memoryQueries,
    start: resolved.start,
    end: resolved.end,
    step: resolved.step,
    globalVars,
    reloadToken,
  });

  const { initialLoading: promInitialLoading } = derivePanelLoadState([results.memByInstance]);

  const { allHosts, avgUtil01, physicalHostCount } = useMemo(() => {
    const matchKeys = collectPhysicalHostPromMatchKeys(fast.nodeResources ?? null);
    const seriesList = results.memByInstance?.series ?? [];
    const nodeResourcesData = fast.nodeResources?.data;
    const nodeMetricsData = fast.nodeMetrics?.data;
    const resourcesList = Array.isArray(nodeResourcesData) ? nodeResourcesData : [];
    const metricsList = Array.isArray(nodeMetricsData) ? nodeMetricsData : [];
    const totalMemoryByHost = new Map<string, number>();
    const usedMemoryByHost = new Map<string, number>();

    resourcesList.forEach((node: any) => {
      const nodeName = pickNodeName(node).toLowerCase();
      if (!nodeName) return;
      totalMemoryByHost.set(nodeName, parseMemoryToBytes(String(node?.status?.allocatable?.memory ?? '')));
    });

    metricsList.forEach((node: any) => {
      const nodeName = pickNodeName(node).toLowerCase();
      if (!nodeName) return;
      usedMemoryByHost.set(nodeName, parseMemoryToBytes(String(node?.usage?.memory ?? '')));
    });

    const rows = seriesList
      .map((s) => ({
        instance: String(s.metric?.instance ?? '').trim(),
        label: resolveLabel(String(s.metric?.instance ?? '')),
        util01: pickLastUtil01(s),
        totalMemory: 0,
        usedMemory: 0,
      }))
      .filter((r) => r.instance && isPhysicalHostPrometheusInstance(r.instance, matchKeys))
      .map((r) => {
        const hostKey = r.label.trim().toLowerCase();
        return {
          ...r,
          totalMemory: totalMemoryByHost.get(hostKey) ?? 0,
          usedMemory: usedMemoryByHost.get(hostKey) ?? 0,
        };
      })
      .sort((a, b) => b.util01 - a.util01 || a.label.localeCompare(b.label));

    const avg =
      rows.length > 0 ? rows.reduce((sum, r) => sum + r.util01, 0) / rows.length : 0;
    return {
      allHosts: rows,
      avgUtil01: avg,
      physicalHostCount: countPhysicalHosts(fast.nodeResources ?? null),
    };
  }, [results.memByInstance?.series, fast.nodeResources, fast.nodeMetrics, resolveLabel]);

  useEffect(() => {
    if (allHosts.length > 0 || avgUtil01 > 0) {
      hasDataRef.current = true;
    }
  }, [allHosts.length, avgUtil01]);

  useEffect(() => {
    if (!promInitialLoading && !fast.coreLoading) {
      hasDataRef.current = true;
    }
  }, [promInitialLoading, fast.coreLoading]);

  const initialLoading = (promInitialLoading || fast.coreLoading) && !hasDataRef.current;
  const avgPercent = Math.round(avgUtil01 * 1000) / 10;
  const listMaxHeight = Math.max(80, height - CARD_HEADER_OFFSET - CARD_BODY_PADDING);
  const extraText =
    physicalHostCount > 0 ? `共 ${physicalHostCount} 台 · 平均 ${avgPercent}%` : `平均 ${avgPercent}%`;

  return (
    <OpsDashboardOverviewCard
      title="节点内存"
      icon={<FundOutlined style={{ color: '#1677ff', fontSize: 18 }} />}
      extra={extraText}
      loading={initialLoading}
      height={height}
    >
      {allHosts.length > 0 ? (
        <div
          style={{
            maxHeight: listMaxHeight,
            overflowY: 'auto',
            overflowX: 'hidden',
            paddingRight: 4,
          }}
        >
          {allHosts.map((row) => {
            const pct = Math.round(row.util01 * 1000) / 10;
            const color = opsOverviewUsageColor(pct);
            return (
              <div
                key={row.instance}
                style={{
                  minWidth: 0,
                  padding: '5px 0',
                  borderBottom: '1px solid #f0f0f0',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 8,
                    marginBottom: 2,
                  }}
                >
                  <Typography.Text
                    ellipsis={{ tooltip: row.instance }}
                    style={{ fontSize: OPS_OVERVIEW_LIST_LABEL_FONT, flex: 1, minWidth: 0 }}
                  >
                    {row.label}
                  </Typography.Text>
                  <Typography.Text
                    strong
                    style={{ fontSize: OPS_OVERVIEW_LIST_VALUE_FONT, flexShrink: 0, color }}
                  >
                    {pct}%
                  </Typography.Text>
                </div>
                <Progress percent={pct} showInfo={false} strokeColor={color} trailColor="#f0f0f0" size="small" />
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  总内存 {formatMemorySize(row.totalMemory)} / 已使用 {formatMemorySize(row.usedMemory)} / 使用率 {pct}%
                </Typography.Text>
              </div>
            );
          })}
        </div>
      ) : (
        <Typography.Text type="secondary" style={{ fontSize: OPS_OVERVIEW_LIST_LABEL_FONT }}>
          {initialLoading ? '加载中…' : '暂无物理主机内存数据'}
        </Typography.Text>
      )}
    </OpsDashboardOverviewCard>
  );
};

export default OpsDashboardNodesMemoryCard;
