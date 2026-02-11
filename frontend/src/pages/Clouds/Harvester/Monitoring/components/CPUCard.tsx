/**
 * CPU 卡片 - 圆环已分配比例 + 已分配/可用
 */
import React, { useMemo } from 'react';
import { Card, Typography, Spin } from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';
import { useDashboardNodeDataContext } from '../DashboardContext';
import { aggregateNodeResources, aggregateNodeMetrics } from '../utils/nodeResourceMetrics';

const getRiskColor = (percent: number) => {
  if (percent >= 90) return '#ef4444';
  if (percent >= 70) return '#f59e0b';
  return '#22C55E';
};

const size = 96;
const strokeWidth = 8;
const radius = (size - strokeWidth) / 2;
const circumference = 2 * Math.PI * radius;

function formatCores(cores: number): string {
  if (cores >= 1) return `${Math.round(cores * 100) / 100} 核`;
  if (cores > 0) return `${(cores * 1000).toFixed(0)} m核`;
  return '0 核';
}

export const CPUCard: React.FC = () => {
  const nodeData = useDashboardNodeDataContext();
  const loading = nodeData?.loading ?? false;

  const { totalCpuCores, usedCpuCores, availableCpuCores, percent } = useMemo(() => {
    const resources = aggregateNodeResources(nodeData?.nodeResources ?? null);
    const metrics = aggregateNodeMetrics(nodeData?.nodeMetrics ?? null);
    const total = resources.totalCpuCores;
    const used = metrics.usedCpuCores;
    const available = Math.max(0, total - used);
    const pct = total > 0 ? Math.round((used / total) * 1000) / 10 : 0;
    return { totalCpuCores: total, usedCpuCores: used, availableCpuCores: available, percent: pct };
  }, [nodeData?.nodeResources, nodeData?.nodeMetrics]);

  const riskColor = getRiskColor(percent);
  const offset = circumference - (percent / 100) * circumference;

  return (
    <Card
      size="small"
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <ThunderboltOutlined style={{ color: '#1677ff', fontSize: 20, marginTop: 3 }} />
          <span style={{ fontSize: 16 }}>CPU</span>
        </span>
      }
      styles={{
        header: { padding: '16px 20px', height: 60, minHeight: 60 },
        body: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '10px 16px' },
      }}
      extra={<span style={{ fontSize: 14, color: '#999' }}>共 {formatCores(totalCpuCores)}</span>}
      style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
    >
      <Spin spinning={loading} style={{ minHeight: 100 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
          <div style={{ position: 'relative', flexShrink: 0, width: size, height: size }}>
            <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
              <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#e5e7eb" strokeWidth={strokeWidth} />
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={riskColor}
                strokeWidth={strokeWidth}
                strokeDasharray={circumference}
                strokeDashoffset={offset}
                strokeLinecap="round"
                style={{ transition: 'stroke-dashoffset 0.3s' }}
              />
            </svg>
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <span style={{ fontSize: 16, fontWeight: 600, lineHeight: 1 }}>{percent}%</span>
              <span style={{ fontSize: 14, color: '#999' }}>已分配</span>
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0, paddingRight: 8 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '6px 0',
                borderBottom: '1px solid #f0f0f0',
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: riskColor, flexShrink: 0 }} />
                <Typography.Text style={{ fontSize: 14 }}>已分配</Typography.Text>
              </span>
              <span style={{ fontSize: 14 }}>{formatCores(usedCpuCores)}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#d9d9d9', flexShrink: 0 }} />
                <Typography.Text style={{ fontSize: 14 }}>可用</Typography.Text>
              </span>
              <span style={{ fontSize: 14 }}>{formatCores(availableCpuCores)}</span>
            </div>
          </div>
        </div>
      </Spin>
    </Card>
  );
};
