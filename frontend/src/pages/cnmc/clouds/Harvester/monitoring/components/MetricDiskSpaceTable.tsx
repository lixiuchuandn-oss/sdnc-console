/**
 * 节点磁盘（块设备）使用情况表格：
 * - 输入 Size、Available 两组 series（来自 usePromQueries），按 `metric.device` 聚合
 * - 同一块设备/分区可能被绑定挂载到多个挂载点（如 Elemental 不可变 OS 把根分区
 *   bind-mount 到 /etc/*、/var/lib/* 等几十处），node_exporter 会按挂载点各吐一条
 *   size/avail 完全相同的 series。这里按 `device` 折叠为一行，避免重复噪音；挂载点
 *   列展示代表路径 +「等 N 个挂载点」（Popover 气泡卡片可见全部）。
 * - 计算 Used = Size - Available、Used% = Used / Size
 * - 按 Used% 降序作为默认排序；Used% 列用 Progress 渲染，阈值 80%/90%
 */
import React, { useMemo } from 'react';
import { Progress, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { MonitoringPopover } from './MonitoringPopover';
import { formatValue } from '../lib/unit';
import type { PromSeries } from '../hooks/usePromQueries';

export interface DiskSpaceRow {
  device: string;
  /** 代表挂载点（同设备多挂载点时取最「根」的一个） */
  mountpoint: string;
  /** 该设备的全部挂载点 */
  mountpoints: string[];
  sizeBytes: number;
  availBytes: number;
  usedBytes: number;
  usedPct: number;
}

export interface MetricDiskSpaceTableProps {
  sizeSeries: PromSeries[];
  availSeries: PromSeries[];
  /** Table 最大高度（开启 `scroll.y`），默认 300 */
  scrollY?: number | string;
}

function pickLast(series: PromSeries | undefined): number | undefined {
  if (!series || !Array.isArray(series.values) || series.values.length === 0) return undefined;
  const last = series.values[series.values.length - 1];
  const v = Number(last?.[1]);
  return Number.isFinite(v) ? v : undefined;
}

function progressStatusByPct(pct: number): 'success' | 'normal' | 'exception' {
  if (pct >= 0.9) return 'exception';
  if (pct >= 0.8) return 'normal';
  return 'success';
}

/** 同一设备多挂载点时，挑「最根」的挂载点作为代表：层级最少 → 字符最短 → 字典序 */
function pickRepresentativeMount(mountpoints: string[]): string {
  if (mountpoints.length === 0) return '';
  return [...mountpoints].sort((a, b) => {
    const da = a.split('/').length;
    const db = b.split('/').length;
    if (da !== db) return da - db;
    if (a.length !== b.length) return a.length - b.length;
    return a.localeCompare(b);
  })[0];
}

interface DeviceAgg {
  device: string;
  mountpoints: Set<string>;
  sizeBytes?: number;
  availBytes?: number;
}

const MetricDiskSpaceTable: React.FC<MetricDiskSpaceTableProps> = ({ sizeSeries, availSeries, scrollY = 300 }) => {
  const rows = useMemo<DiskSpaceRow[]>(() => {
    const byDevice = new Map<string, DeviceAgg>();
    const ingest = (series: PromSeries[], field: 'sizeBytes' | 'availBytes') => {
      series.forEach((s) => {
        const v = pickLast(s);
        if (v == null) return;
        const device = String(s.metric?.device ?? '').trim();
        const mp = String(s.metric?.mountpoint ?? '').trim();
        // 优先按设备聚合；设备缺失时退回按挂载点，避免把不相关项合并
        const key = device || (mp ? `mp:${mp}` : '');
        if (!key) return;
        const exist = byDevice.get(key) ?? { device, mountpoints: new Set<string>() };
        if (device) exist.device = device;
        if (mp) exist.mountpoints.add(mp);
        // 同设备多挂载点的 size/avail 完全相同，取 max 以容忍偶发抖动
        exist[field] = Math.max(exist[field] ?? 0, v);
        byDevice.set(key, exist);
      });
    };
    ingest(sizeSeries, 'sizeBytes');
    ingest(availSeries, 'availBytes');

    const list: DiskSpaceRow[] = [];
    byDevice.forEach((vals) => {
      const size = Number(vals.sizeBytes ?? 0);
      const avail = Number(vals.availBytes ?? 0);
      const used = Math.max(size - avail, 0);
      const pct = size > 0 ? used / size : 0;
      const mountpoints = [...vals.mountpoints].sort((a, b) => a.localeCompare(b));
      list.push({
        device: vals.device || '',
        mountpoint: pickRepresentativeMount(mountpoints),
        mountpoints,
        sizeBytes: size,
        availBytes: avail,
        usedBytes: used,
        usedPct: pct,
      });
    });
    return list;
  }, [sizeSeries, availSeries]);

  const columns = useMemo<ColumnsType<DiskSpaceRow>>(
    () => [
      {
        title: '块设备',
        dataIndex: 'device',
        key: 'device',
        fixed: 'left',
        width: 200,
        ellipsis: true,
        render: (v: string) => (v ? <Tag color="blue">{v}</Tag> : '-'),
      },
      {
        title: '挂载点',
        dataIndex: 'mountpoint',
        key: 'mountpoint',
        ellipsis: true,
        width: 280,
        render: (_: string, row: DiskSpaceRow) => {
          const text = row.mountpoint || '-';
          const count = row.mountpoints.length;
          if (count <= 1) return text;
          return (
            <MonitoringPopover
              content={
                <div style={{ maxHeight: 240, overflowY: 'auto' }}>
                  {row.mountpoints.map((m) => (
                    <div key={m}>{m}</div>
                  ))}
                </div>
              }
              styles={{ body: { maxWidth: 480 } }}
            >
              <span style={{ cursor: 'help' }}>
                {text}
                <span style={{ color: 'rgba(0,0,0,.45)', marginLeft: 6 }}>等 {count} 个挂载点</span>
              </span>
            </MonitoringPopover>
          );
        },
      },
      {
        title: '总大小',
        dataIndex: 'sizeBytes',
        key: 'size',
        width: 110,
        align: 'right',
        sorter: (a, b) => a.sizeBytes - b.sizeBytes,
        render: (v: number) => formatValue(v, 'bytes').text,
      },
      {
        title: '已用',
        dataIndex: 'usedBytes',
        key: 'used',
        width: 110,
        align: 'right',
        sorter: (a, b) => a.usedBytes - b.usedBytes,
        render: (v: number) => formatValue(v, 'bytes').text,
      },
      {
        title: '可用',
        dataIndex: 'availBytes',
        key: 'avail',
        width: 110,
        align: 'right',
        sorter: (a, b) => a.availBytes - b.availBytes,
        render: (v: number) => formatValue(v, 'bytes').text,
      },
      {
        title: '已用占比',
        dataIndex: 'usedPct',
        key: 'usedPct',
        width: 220,
        sorter: (a, b) => a.usedPct - b.usedPct,
        defaultSortOrder: 'descend',
        render: (v: number) => (
          <Progress
            percent={Math.min(100, Math.max(0, Math.round(v * 1000) / 10))}
            size="small"
            status={progressStatusByPct(v)}
            format={(p) => `${(p ?? 0).toFixed(1)}%`}
          />
        ),
      },
    ],
    [],
  );

  return (
    <Table
      className="std-table"
      size="small"
      rowKey={(row) => row.device || row.mountpoint}
      columns={columns}
      dataSource={rows}
      pagination={false}
      scroll={{ x: true, y: scrollY }}
    />
  );
};

export default MetricDiskSpaceTable;
