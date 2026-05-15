/**
 * 物理主机卡片 - 圆心总台数（同旧版饼图）；圆环进度为活跃占比
 */
import React, { useMemo } from 'react';
import { Card, Typography, Progress } from 'antd';
import { CloudServerOutlined } from '@ant-design/icons';
import { useDashboardNodeDataContext } from '../DashboardContext';
import { parseNodesToHostSegments } from '../utils/hostSegments';

const CIRCLE_SIZE = 150;
const STROKE_WIDTH = 8;

export const HostsCard: React.FC = () => {
  const ctx = useDashboardNodeDataContext();

  const summary = useMemo(() => parseNodesToHostSegments(ctx?.nodeResources ?? null), [ctx?.nodeResources]);
  const { total, segments } = summary;

  const activeSeg = segments.find((s) => s.key === 'active');
  const activePct =
    total > 0 && activeSeg ? Math.round((activeSeg.count / total) * 1000) / 10 : 0;

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
        body: {
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          minHeight: 0,
          padding: '10px 14px',
          flex: 1,
        },
      }}
      extra={<span style={{ fontSize: 14, color: '#999' }}>共 {total} 台</span>}
      style={{
        flex: 1,
        minHeight: 0,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
      }}
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
          <Progress
            type="circle"
            percent={activePct}
            size={CIRCLE_SIZE}
            strokeWidth={STROKE_WIDTH}
            strokeColor="#22C55E"
            trailColor="#f0f0f0"
            format={() => (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  lineHeight: 1.15,
                }}
              >
                <span style={{ fontSize: 24, fontWeight: 600, color: '#1f2937' }}>{total}</span>
                <Typography.Text type="secondary" style={{ fontSize: 12, marginTop: 2 }}>
                  物理主机
                </Typography.Text>
              </div>
            )}
          />
          <div
            style={{
              display: 'flex',
              gap: 10,
              flexWrap: 'wrap',
              justifyContent: 'center',
              fontSize: 14,
              marginTop: 10,
            }}
          >
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
