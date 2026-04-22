/**
 * 物理主机卡片 - 活跃/维护中/隔离中/其他 圆环图
 */
import React, { useMemo, useEffect, useRef } from 'react';
import { Card, Typography, Spin } from 'antd';
import { CloudServerOutlined } from '@ant-design/icons';
import * as echarts from 'echarts';
import type { EChartsOption } from 'echarts';
import { useDashboardNodeDataContext } from '../DashboardContext';
import { parseNodesToHostSegments } from '../utils/hostSegments';

const CHART_HEIGHT = 186;

export const HostsCard: React.FC = () => {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<echarts.ECharts | null>(null);

  const ctx = useDashboardNodeDataContext();
  const summary = useMemo(
    () => parseNodesToHostSegments(ctx?.nodeResources ?? null),
    [ctx?.nodeResources]
  );
  const { total, segments } = summary;
  const chartData = useMemo(() => {
    const visible = segments.filter((s) => s.count > 0);
    if (visible.length === 0) return [];
    return visible.map((s) => ({
      value: s.count,
      name: s.name,
      itemStyle: { color: s.color },
    }));
  }, [segments]);

  // 切云/重新拉数时先走 loading，图表容器会换成 Spin，旧实例仍指向已卸载的 DOM；
  // 若不 dispose，loading 结束后因 ref 非空不会 init，饼图会一直空白。
  useEffect(() => {
    if (ctx?.loading) {
      chartInstanceRef.current?.dispose();
      chartInstanceRef.current = null;
    }
  }, [ctx?.loading]);

  useEffect(() => {
    if (!chartRef.current || ctx?.loading) return;

    if (!chartInstanceRef.current) {
      chartInstanceRef.current = echarts.init(chartRef.current);
    }

    const option: EChartsOption = {
      tooltip: { trigger: 'item', formatter: '{b}：{c}', confine: true },
      graphic: [
        {
          type: 'text',
          left: 'center',
          top: 'center',
          style: { text: String(total), fontSize: 24, fontWeight: 600, fill: '#1f2937' },
          z: 10,
        },
      ],
      series: [
        {
          type: 'pie',
          radius: ['60%', '88%'],
          center: ['50%', '50%'],
          avoidLabelOverlap: false,
          itemStyle: { borderColor: '#fff', borderWidth: 2 },
          label: { show: false },
          emphasis: { scale: false, itemStyle: { borderWidth: 2 } },
          data: chartData.length > 0 ? chartData : [{ value: 1, name: '', itemStyle: { color: '#f0f0f0' } }],
        },
      ],
    };

    chartInstanceRef.current.setOption(option, true);
  }, [chartData, total, ctx?.loading]);

  useEffect(() => {
    const chart = chartInstanceRef.current;
    const onResize = () => chart?.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart?.dispose();
      chartInstanceRef.current = null;
    };
  }, []);

  if (ctx?.loading) {
    return (
      <Card
        size="small"
        title={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <CloudServerOutlined style={{ color: '#1677ff', fontSize: 20 }} />
            <span style={{ fontSize: 16 }}>物理主机</span>
          </span>
        }
        styles={{
          header: { padding: '16px 20px', height: 60, minHeight: 60 },
          body: { display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 180 },
        }}
        style={{ height: '100%', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
      >
        <Spin />
      </Card>
    );
  }

  return (
    <Card
      size="small"
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <CloudServerOutlined style={{ color: '#1677ff', fontSize: 20 }} />
          <span style={{ fontSize: 16 }}>物理主机</span>
        </span>
      }
      styles={{
        header: { padding: '16px 20px', height: 60, minHeight: 60 },
        body: { display: 'flex', flexDirection: 'column', minHeight: 0, padding: '10px 14px' },
      }}
      extra={<span style={{ fontSize: 14, color: '#999' }}>共 {total} 台</span>}
      style={{ height: '100%', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          flex: 1,
          justifyContent: 'center',
          minHeight: 0,
        }}
      >
        <div ref={chartRef} style={{ width: '100%', height: CHART_HEIGHT, flexShrink: 0, marginBottom: 6 }} />
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center', fontSize: 14 }}>
          {segments.map((seg) => (
            <span key={seg.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 5, height: 10, borderRadius: 2, background: seg.color, flexShrink: 0 }} />
              <Typography.Text style={{ fontSize: 14 }}>{seg.name}</Typography.Text>
              <Typography.Text style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>{seg.count}</Typography.Text>
            </span>
          ))}
        </div>
      </div>
    </Card>
  );
};
