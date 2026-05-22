import React from 'react';
import { Progress, Spin } from 'antd';

import type { NodeDetailAlloc, NodeMetricUsage, NodeRequests, NodeRow } from '../lib/nodesSectionUtils';
import { parseCpuToCores, parseMemoryToBytes } from '../lib/nodesSectionUtils';

export type NodesResourceMaps = {
  resourceLoading: boolean;
  metricsMap: Record<string, NodeMetricUsage>;
  requestsMap: Record<string, NodeRequests>;
  nodesDetailMap: Record<string, NodeDetailAlloc>;
};

function rowName(row: unknown): string {
  const r = row as NodeRow;
  return String(r?.name || r?.metadata?.name || '');
}

function spinWrap() {
  return (
    <div style={{ minWidth: 260, padding: '10px 0' }}>
      <Spin size="small" />
    </div>
  );
}

/** CPU：已分配进度（绿）、已使用进度（蓝） */
export function NodeCpuResourceCell({ row, maps }: { row: unknown; maps: NodesResourceMaps }) {
  const { resourceLoading, metricsMap, requestsMap, nodesDetailMap } = maps;
  if (resourceLoading) return spinWrap();

  const name = rowName(row);
  const used = metricsMap[name]?.cpuUsedCores ?? 0;
  const requested = requestsMap[name]?.cpuRequestCores ?? 0;
  const r = row as NodeRow;
  const nodeDetail = nodesDetailMap[name];
  const allocatable = parseCpuToCores(nodeDetail?.allocatableCpu ?? r?.cpu);
  const capacity = parseCpuToCores(nodeDetail?.capacityCpu ?? r?.cpu);
  const usedPct = capacity > 0 ? Math.round((used / capacity) * 1000) / 10 : undefined;
  const requestedPct = allocatable > 0 ? Math.round((requested / allocatable) * 1000) / 10 : undefined;
  const requestedRemaining = allocatable - requested;
  const usedRemaining = capacity - used;

  return (
    <div style={{ minWidth: 260 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, lineHeight: '18px', marginBottom: 3 }}>
        <Progress
          percent={typeof requestedPct === 'number' ? Math.max(0, Math.min(100, requestedPct)) : 0}
          size="small"
          showInfo={false}
          strokeColor="#52c41a"
        />
        <span style={{ fontSize: 12 }}>
          {typeof requestedPct === 'number' ? `${requestedPct.toFixed(1)}%` : '-'}
        </span>
      </div>
      <div style={{ color: 'rgba(0,0,0,0.45)', fontSize: 11, lineHeight: '12px', marginBottom: 4 }}>
        可分配总量: {allocatable.toFixed(1)} / 已分配: {requested.toFixed(1)} / 未分配:{' '}
        {requestedRemaining.toFixed(1)} core
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, lineHeight: '18px', marginBottom: 3 }}>
        <Progress
          percent={typeof usedPct === 'number' ? Math.max(0, Math.min(100, usedPct)) : 0}
          size="small"
          showInfo={false}
          strokeColor="#1890ff"
        />
        <span style={{ fontSize: 12 }}>
          {typeof usedPct === 'number' ? `${usedPct.toFixed(1)}%` : '-'}
        </span>
      </div>
      <div style={{ color: 'rgba(0,0,0,0.45)', fontSize: 11, lineHeight: '12px' }}>
        物理总量: {capacity.toFixed(1)} / 已使用: {used.toFixed(1)} / 未使用: {usedRemaining.toFixed(1)} core
      </div>
    </div>
  );
}

/** 内存：同上，百分比按 GiB 口径折算 */
export function NodeMemResourceCell({ row, maps }: { row: unknown; maps: NodesResourceMaps }) {
  const { resourceLoading, metricsMap, requestsMap, nodesDetailMap } = maps;
  if (resourceLoading) return spinWrap();

  const name = rowName(row);
  const used = metricsMap[name]?.memUsedBytes ?? 0;
  const requested = requestsMap[name]?.memRequestBytes ?? 0;
  const r = row as NodeRow;
  const nodeDetail = nodesDetailMap[name];
  const allocatable = parseMemoryToBytes(nodeDetail?.allocatableMemory ?? r?.memory);
  const capacity = parseMemoryToBytes(nodeDetail?.capacityMemory ?? r?.memory);

  const toGiBNum = (bytes: number) => (bytes > 0 ? bytes / (1024 * 1024 * 1024) : 0);
  const requestedGiB = toGiBNum(requested);
  const usedGiB = toGiBNum(used);
  const allocatableGiB = toGiBNum(allocatable);
  const capacityGiB = toGiBNum(capacity);

  const usedPct = capacityGiB > 0 ? Math.round((usedGiB / capacityGiB) * 1000) / 10 : undefined;
  const requestedPct =
    allocatableGiB > 0 ? Math.round((requestedGiB / allocatableGiB) * 1000) / 10 : undefined;
  const requestedRemaining = allocatableGiB - requestedGiB;
  const usedRemaining = capacityGiB - usedGiB;

  return (
    <div style={{ minWidth: 260 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, lineHeight: '18px', marginBottom: 3 }}>
        <Progress
          percent={typeof requestedPct === 'number' ? Math.max(0, Math.min(100, requestedPct)) : 0}
          size="small"
          showInfo={false}
          strokeColor="#52c41a"
        />
        <span style={{ fontSize: 12 }}>
          {typeof requestedPct === 'number' ? `${requestedPct.toFixed(1)}%` : '-'}
        </span>
      </div>
      <div style={{ color: 'rgba(0,0,0,0.45)', fontSize: 11, lineHeight: '12px', marginBottom: 4 }}>
        可分配总量: {allocatableGiB.toFixed(1)} / 已分配: {requestedGiB.toFixed(1)} / 未分配:{' '}
        {requestedRemaining.toFixed(1)} GiB
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, lineHeight: '18px', marginBottom: 3 }}>
        <Progress
          percent={typeof usedPct === 'number' ? Math.max(0, Math.min(100, usedPct)) : 0}
          size="small"
          showInfo={false}
          strokeColor="#1890ff"
        />
        <span style={{ fontSize: 12 }}>
          {typeof usedPct === 'number' ? `${usedPct.toFixed(1)}%` : '-'}
        </span>
      </div>
      <div style={{ color: 'rgba(0,0,0,0.45)', fontSize: 11, lineHeight: '12px' }}>
        物理总量: {capacityGiB.toFixed(1)} / 已使用: {usedGiB.toFixed(1)} / 未使用: {usedRemaining.toFixed(1)} GiB
      </div>
    </div>
  );
}

export const NODE_CPU_USAGE_TOOLTIP = (
  <div style={{ fontSize: 12, whiteSpace: 'pre-line' }}>
    <strong>物理总量</strong>
    ：物理节点的实际CPU核数
    <br />
    <strong>可分配总量</strong>
    ：物理总量减去系统预留后的可用资源
    <br />
    <strong>已分配</strong>
    ：所有Pod的CPU资源请求(requests)之和
    <br />
    <strong>已使用</strong>
    ：节点实时CPU使用量
  </div>
);

export const NODE_MEM_USAGE_TOOLTIP = (
  <div style={{ fontSize: 12, whiteSpace: 'pre-line' }}>
    <strong>物理总量</strong>
    ：物理节点的实际内存总容量
    <br />
    <strong>可分配总量</strong>
    ：物理总量减去系统预留后的可用资源
    <br />
    <strong>已分配</strong>
    ：所有Pod的内存资源请求(requests)之和
    <br />
    <strong>已使用</strong>
    ：节点实时内存使用量
  </div>
);
