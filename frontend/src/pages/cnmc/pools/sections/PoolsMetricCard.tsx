import React from 'react';
import { Card } from 'antd';

export type PoolsMetricCardProps = {
  title: string;
  total: number;
  unit?: string;
  used: number;
  midLabel: string;
  midValue: number;
  mainColor: string;
  usedLabel?: string;
};

/** 资源池列表 · 顶部指标卡 */
export function PoolsMetricCard({
  title,
  total,
  unit = '',
  used,
  midLabel,
  midValue,
  mainColor,
  usedLabel,
}: PoolsMetricCardProps) {
  const remain = Math.max(total - used - midValue, 0);
  const percent = total ? (used / total) * 100 : 0;
  const trail = '#d8dee8';
  const metrics = [
    { label: usedLabel || '已用', value: used, color: mainColor },
    { label: midLabel, value: midValue, color: '#8c8c8c' },
    ...(remain > 0 ? [{ label: '剩余', value: remain, color: '#8c8c8c' }] : []),
  ];
  return (
    <Card styles={{ body: { padding: 12 } }} style={{ borderRadius: 6, border: '1px solid #1677ff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 13 }}>{title}</span>
        <span style={{ color: '#8c8c8c', fontSize: 12 }}>
          总共 {total}
          {unit}
        </span>
      </div>
      <div style={{ height: 8, background: trail, borderRadius: 4, overflow: 'hidden', marginBottom: 8 }}>
        <div style={{ width: `${percent}%`, height: '100%', background: mainColor }} />
      </div>
      <div style={{ display: 'flex' }}>
        {metrics.map((m, i, arr) => (
          <div
            key={`${m.label}-${i}`}
            style={{
              flex: 1,
              padding: '8px 12px',
              background: '#fff',
              borderRight: i < arr.length - 1 ? '1px solid #f0f0f0' : 'none',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 12, marginBottom: 2 }}>
              <span style={{ width: 8, height: 8, background: m.color, borderRadius: 2 }} /> {m.label}
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, color: '#1f1f1f', lineHeight: 1 }}>
              {m.value}
              {unit ? (
                <span style={{ fontSize: 12, color: '#8c8c8c', marginLeft: 3 }}>{unit}</span>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
