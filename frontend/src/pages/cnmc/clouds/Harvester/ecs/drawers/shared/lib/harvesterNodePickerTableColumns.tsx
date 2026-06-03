import React from 'react';
import { Progress, Spin, Tag, Tooltip } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import {
  bytesToGiB,
  parseCpuToCores,
  parseMemoryToBytes,
} from './harvesterNodeResourceUtils';
import type {
  HarvesterNodeMetricsMap,
  HarvesterNodeRequestsMap,
  HarvesterNodesDetailMap,
} from './useHarvesterNodeResourceMaps';

const CPU_TOOLTIP = (
  <div style={{ fontSize: 12, whiteSpace: 'pre-line' }}>
    <b>物理总量</b>：物理节点的实际CPU核数
    <br />
    <b>可分配总量</b>：物理总量减去系统预留后的可用资源
    <br />
    <b>已分配</b>：所有Pod的CPU资源请求(requests)之和
    <br />
    <b>已使用</b>：节点实时CPU使用量
  </div>
);

const MEM_TOOLTIP = (
  <div style={{ fontSize: 12, whiteSpace: 'pre-line' }}>
    <b>物理总量</b>：物理节点的实际内存总容量
    <br />
    <b>可分配总量</b>：物理总量减去系统预留后的可用资源
    <br />
    <b>已分配</b>：所有Pod的内存资源请求(requests)之和
    <br />
    <b>已使用</b>：节点实时内存使用量
  </div>
);

function isNodeReadyRow(r: any): boolean {
  if (typeof r?.ready === 'boolean') return r.ready;
  const conds: any[] = Array.isArray(r?.status?.conditions)
    ? r.status.conditions
    : [];
  return conds.some(
    (c: any) =>
      String(c?.type || '') === 'Ready' &&
      String(c?.status || '').toLowerCase() === 'true',
  );
}

export type HarvesterNodePickerColumnCtx = {
  metricsMap: HarvesterNodeMetricsMap;
  requestsMap: HarvesterNodeRequestsMap;
  nodesDetailMap: HarvesterNodesDetailMap;
  resourceLoading: boolean;
};

export type HarvesterNodePickerColumnOptions = {
  /** 创建向导等窄容器：取消资源列 minWidth，文案可换行，避免横向滚动条 */
  compact?: boolean;
};

function resourceCellWrapStyle(compact?: boolean): React.CSSProperties | undefined {
  return compact ? { minWidth: 0, width: '100%' } : { minWidth: 180 };
}

function resourceStatLineStyle(compact?: boolean): React.CSSProperties {
  return {
    color: 'rgba(0,0,0,0.45)',
    fontSize: 10,
    lineHeight: '12px',
    marginBottom: 3,
    ...(compact ? { wordBreak: 'break-word' as const } : null),
  };
}

/** 创建向导 / 资源变配「指定主机」共用的主机表列（名称、状态、CPU、内存）。 */
export function buildHarvesterNodePickerTableColumns(
  ctx: HarvesterNodePickerColumnCtx,
  options?: HarvesterNodePickerColumnOptions,
): ColumnsType<any> {
  const { metricsMap, requestsMap, nodesDetailMap, resourceLoading } = ctx;
  const compact = options?.compact;
  const cellWrapStyle = resourceCellWrapStyle(compact);
  const statLineStyle = resourceStatLineStyle(compact);

  return [
    {
      title: '主机名称',
      key: 'name',
      render: (_: unknown, r: any) => {
        const name = r?.name || r?.metadata?.name || '-';
        const ip =
          r?.internalIP ||
          r?.status?.addresses?.find((a: any) => a.type === 'InternalIP')
            ?.address ||
          '-';
        return (
          <div>
            <div>{name}</div>
            <div style={{ color: '#999' }}>{ip}</div>
          </div>
        );
      },
    },
    {
      title: '状态',
      key: 'ready',
      width: 96,
      render: (_: unknown, r: any) =>
        isNodeReadyRow(r) ? (
          <Tag color="green">Ready</Tag>
        ) : (
          <Tag color="red">NotReady</Tag>
        ),
    },
    {
      title: (
        <span>
          CPU
          <Tooltip title={CPU_TOOLTIP} placement="top">
            <QuestionCircleOutlined
              style={{ marginLeft: 4, color: '#999', fontSize: 12, cursor: 'help' }}
            />
          </Tooltip>
        </span>
      ),
      key: 'cpu_usage',
      render: (_: unknown, r: any) => {
        if (resourceLoading) {
          return (
            <div style={{ ...(cellWrapStyle || {}), padding: '10px 0' }}>
              <Spin size="small" />
            </div>
          );
        }
        const nodeName = String(r?.name || r?.metadata?.name || '').trim();
        const nodeDetail = nodesDetailMap[nodeName];
        const allocatable = parseCpuToCores(
          nodeDetail?.allocatableCpu ?? r?.cpu,
        );
        const capacity = parseCpuToCores(nodeDetail?.capacityCpu ?? r?.cpu);
        const requested = requestsMap[nodeName]?.cpuRequestCores || 0;
        const used = metricsMap[nodeName]?.cpuUsedCores || 0;
        const requestedPct =
          allocatable > 0
            ? Math.round((requested / allocatable) * 1000) / 10
            : undefined;
        const usedPct =
          capacity > 0 ? Math.round((used / capacity) * 1000) / 10 : undefined;
        const requestedRemaining = allocatable - requested;
        const usedRemaining = capacity - used;
        return (
          <div style={cellWrapStyle}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                lineHeight: '16px',
                marginBottom: 3,
                minWidth: compact ? 0 : undefined,
              }}
            >
              <Progress
                percent={
                  typeof requestedPct === 'number'
                    ? Math.max(0, Math.min(100, requestedPct))
                    : 0
                }
                size="small"
                showInfo={false}
                strokeColor="#52c41a"
                style={compact ? { flex: 1, minWidth: 0, marginRight: 0 } : undefined}
              />
              <span style={{ fontSize: 11 }}>
                {typeof requestedPct === 'number'
                  ? requestedPct.toFixed(0) + '%'
                  : '-'}
              </span>
            </div>
            <div style={statLineStyle}>
              {'可分配总量: ' +
                allocatable.toFixed(1) +
                ' / 已分配: ' +
                requested.toFixed(1) +
                ' / 未分配: ' +
                requestedRemaining.toFixed(1) +
                ' core'}
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                lineHeight: '16px',
                marginBottom: 2,
                minWidth: compact ? 0 : undefined,
              }}
            >
              <Progress
                percent={
                  typeof usedPct === 'number'
                    ? Math.max(0, Math.min(100, usedPct))
                    : 0
                }
                size="small"
                showInfo={false}
                strokeColor="#1890ff"
                style={compact ? { flex: 1, minWidth: 0, marginRight: 0 } : undefined}
              />
              <span style={{ fontSize: 11 }}>
                {typeof usedPct === 'number' ? usedPct.toFixed(0) + '%' : '-'}
              </span>
            </div>
            <div style={{ ...statLineStyle, marginBottom: 0 }}>
              {'物理总量: ' +
                capacity.toFixed(1) +
                ' / 已使用: ' +
                used.toFixed(1) +
                ' / 未使用: ' +
                usedRemaining.toFixed(1) +
                ' core'}
            </div>
          </div>
        );
      },
    },
    {
      title: (
        <span>
          内存
          <Tooltip title={MEM_TOOLTIP} placement="top">
            <QuestionCircleOutlined
              style={{ marginLeft: 4, color: '#999', fontSize: 12, cursor: 'help' }}
            />
          </Tooltip>
        </span>
      ),
      key: 'mem_usage',
      render: (_: unknown, r: any) => {
        if (resourceLoading) {
          return (
            <div style={{ ...(cellWrapStyle || {}), padding: '10px 0' }}>
              <Spin size="small" />
            </div>
          );
        }
        const nodeName = String(r?.name || r?.metadata?.name || '').trim();
        const nodeDetail = nodesDetailMap[nodeName];
        const allocatable = bytesToGiB(
          parseMemoryToBytes(nodeDetail?.allocatableMemory),
        );
        const capacity = bytesToGiB(
          parseMemoryToBytes(nodeDetail?.capacityMemory),
        );
        const requested = bytesToGiB(
          requestsMap[nodeName]?.memRequestBytes || 0,
        );
        const used = bytesToGiB(metricsMap[nodeName]?.memUsedBytes || 0);
        const requestedPct =
          allocatable > 0
            ? Math.round((requested / allocatable) * 1000) / 10
            : undefined;
        const usedPct =
          capacity > 0 ? Math.round((used / capacity) * 1000) / 10 : undefined;
        const requestedRemaining = allocatable - requested;
        const usedRemaining = capacity - used;
        return (
          <div style={cellWrapStyle}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                lineHeight: '16px',
                marginBottom: 3,
                minWidth: compact ? 0 : undefined,
              }}
            >
              <Progress
                percent={
                  typeof requestedPct === 'number'
                    ? Math.max(0, Math.min(100, requestedPct))
                    : 0
                }
                size="small"
                showInfo={false}
                strokeColor="#52c41a"
                style={compact ? { flex: 1, minWidth: 0, marginRight: 0 } : undefined}
              />
              <span style={{ fontSize: 11 }}>
                {typeof requestedPct === 'number'
                  ? requestedPct.toFixed(0) + '%'
                  : '-'}
              </span>
            </div>
            <div style={statLineStyle}>
              {'可分配总量: ' +
                allocatable.toFixed(1) +
                ' / 已分配: ' +
                requested.toFixed(1) +
                ' / 未分配: ' +
                requestedRemaining.toFixed(1) +
                ' GiB'}
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                lineHeight: '16px',
                marginBottom: 2,
                minWidth: compact ? 0 : undefined,
              }}
            >
              <Progress
                percent={
                  typeof usedPct === 'number'
                    ? Math.max(0, Math.min(100, usedPct))
                    : 0
                }
                size="small"
                showInfo={false}
                strokeColor="#1890ff"
                style={compact ? { flex: 1, minWidth: 0, marginRight: 0 } : undefined}
              />
              <span style={{ fontSize: 11 }}>
                {typeof usedPct === 'number' ? usedPct.toFixed(0) + '%' : '-'}
              </span>
            </div>
            <div style={{ ...statLineStyle, marginBottom: 0 }}>
              {'物理总量: ' +
                capacity.toFixed(1) +
                ' / 已使用: ' +
                used.toFixed(1) +
                ' / 未使用: ' +
                usedRemaining.toFixed(1) +
                ' GiB'}
            </div>
          </div>
        );
      },
    },
  ];
}
