/**
 * Grafana `Disk Space Usage` 表格的直译：
 * - 输入 Size、Available 两组按 `mountpoint` 分组的 series（来自 usePromQueries）
 * - 按 `metric.mountpoint` join，取每个 series 的最后一个数据点作为当前值
 * - 计算 Used = Size - Available、Used% = Used / Size
 * - 按 Mounted on 排序；Used% 列用 Progress 渲染，阈值 80%/90%
 *
 * 与 Grafana 表格 transformations（groupBy + merge + calculateField + organize + sortBy）等价。
 */
import React, { useMemo } from 'react';
import { Progress, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { formatValue } from '../lib/unit';
import type { PromSeries } from '../hooks/usePromQueries';

export interface DiskSpaceRow {
  mountpoint: string;
  sizeBytes: number;
  availBytes: number;
  usedBytes: number;
  usedPct: number;
}

export interface MetricDiskSpaceTableProps {
  sizeSeries: PromSeries[];
  availSeries: PromSeries[];
  /** Table 最大高度（开启 `scroll.y`），默认 220 */
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

const MetricDiskSpaceTable: React.FC<MetricDiskSpaceTableProps> = ({ sizeSeries, availSeries, scrollY = 220 }) => {
  const rows = useMemo<DiskSpaceRow[]>(() => {
    const byMount = new Map<string, { sizeBytes?: number; availBytes?: number }>();
    sizeSeries.forEach((s) => {
      const mp = String(s.metric?.mountpoint ?? '').trim();
      if (!mp) return;
      const v = pickLast(s);
      if (v == null) return;
      const exist = byMount.get(mp) ?? {};
      exist.sizeBytes = v;
      byMount.set(mp, exist);
    });
    availSeries.forEach((s) => {
      const mp = String(s.metric?.mountpoint ?? '').trim();
      if (!mp) return;
      const v = pickLast(s);
      if (v == null) return;
      const exist = byMount.get(mp) ?? {};
      exist.availBytes = v;
      byMount.set(mp, exist);
    });
    const list: DiskSpaceRow[] = [];
    byMount.forEach((vals, mp) => {
      const size = Number(vals.sizeBytes ?? 0);
      const avail = Number(vals.availBytes ?? 0);
      const used = Math.max(size - avail, 0);
      const pct = size > 0 ? used / size : 0;
      list.push({ mountpoint: mp, sizeBytes: size, availBytes: avail, usedBytes: used, usedPct: pct });
    });
    list.sort((a, b) => a.mountpoint.localeCompare(b.mountpoint));
    return list;
  }, [sizeSeries, availSeries]);

  const columns = useMemo<ColumnsType<DiskSpaceRow>>(
    () => [
      {
        title: '挂载点',
        dataIndex: 'mountpoint',
        key: 'mountpoint',
        ellipsis: true,
        fixed: 'left',
      },
      {
        title: '总大小',
        dataIndex: 'sizeBytes',
        key: 'size',
        width: 110,
        align: 'right',
        render: (v: number) => formatValue(v, 'bytes').text,
      },
      {
        title: '已用',
        dataIndex: 'usedBytes',
        key: 'used',
        width: 110,
        align: 'right',
        render: (v: number) => formatValue(v, 'bytes').text,
      },
      {
        title: '可用',
        dataIndex: 'availBytes',
        key: 'avail',
        width: 110,
        align: 'right',
        render: (v: number) => formatValue(v, 'bytes').text,
      },
      {
        title: '已用占比',
        dataIndex: 'usedPct',
        key: 'usedPct',
        width: 160,
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
      rowKey="mountpoint"
      columns={columns}
      dataSource={rows}
      pagination={false}
      scroll={{ x: true, y: scrollY }}
    />
  );
};

export default MetricDiskSpaceTable;
