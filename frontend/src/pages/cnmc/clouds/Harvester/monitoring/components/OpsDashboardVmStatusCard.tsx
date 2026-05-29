/**
 * 运维监控大盘 · 云主机实例状态分布（与监控服务概览 VMCard 同源统计逻辑）
 */
import React from 'react';
import {
  DesktopOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
  PoweroffOutlined,
  EllipsisOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons';
import { Card, Spin, Typography } from 'antd';
import type { VMInstancesSummary, VMStatusKey } from '../lib/vmInstances';

const SEGMENT_ICONS: Record<VMStatusKey, typeof PlayCircleOutlined> = {
  running: PlayCircleOutlined,
  paused: PauseCircleOutlined,
  stopped: PoweroffOutlined,
  other: EllipsisOutlined,
};

const SEGMENT_COLORS: Record<VMStatusKey, string> = {
  running: '#10B981',
  paused: '#FAAD14',
  stopped: '#64748B',
  other: '#FF5C7C',
};

export interface OpsDashboardVmStatusCardProps {
  summary: VMInstancesSummary | null;
  loading?: boolean;
  height?: number;
}

const OpsDashboardVmStatusCard: React.FC<OpsDashboardVmStatusCardProps> = ({
  summary,
  loading = false,
  height = 320,
}) => {
  const total = summary?.total ?? 0;
  const statusList = summary?.segments ?? [];

  return (
    <Card
      size="small"
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <DesktopOutlined style={{ color: '#1677ff', fontSize: 18 }} />
          <span style={{ fontSize: 15 }}>云主机实例</span>
        </span>
      }
      extra={<span style={{ fontSize: 14, color: '#999' }}>共 {total} 台</span>}
      styles={{
        header: { padding: '12px 16px', minHeight: 48 },
        body: {
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          minHeight: 0,
          padding: '12px 16px 16px',
        },
      }}
      style={{
        height,
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
      }}
    >
      <Spin spinning={loading}>
        <div style={{ display: 'flex', gap: 20, alignItems: 'center', minHeight: 180 }}>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: 72,
              flexShrink: 0,
            }}
          >
            <DesktopOutlined style={{ color: '#1677ff', fontSize: 28, marginBottom: 6 }} />
            <span style={{ fontSize: 22, fontWeight: 600 }}>{total}</span>
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>
              总台数
            </Typography.Text>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            {statusList.map((s, i) => {
              const Icon = SEGMENT_ICONS[s.key] ?? EllipsisOutlined;
              const color = SEGMENT_COLORS[s.key] ?? '#999';
              return (
                <div
                  key={s.key}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '7px 0',
                    borderBottom: i < statusList.length - 1 ? '1px solid #f0f0f0' : undefined,
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <Icon style={{ color, fontSize: 14 }} />
                    <Typography.Text style={{ fontSize: 14 }}>{s.label}</Typography.Text>
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 500 }}>{s.value}</span>
                </div>
              );
            })}
          </div>
        </div>
        <div
          style={{
            marginTop: 12,
            paddingTop: 12,
            borderTop: '1px solid #f0f0f0',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 6,
          }}
        >
          <InfoCircleOutlined style={{ color: '#1677ff', fontSize: 14, marginTop: 2 }} />
          <Typography.Text type="secondary" style={{ fontSize: 12, lineHeight: 1.5 }}>
            按运行状态统计云主机总数；数据来自集群 VM / VMI 列表，与「云主机资源」Prometheus 指标相互独立刷新。
          </Typography.Text>
        </div>
      </Spin>
    </Card>
  );
};

export default OpsDashboardVmStatusCard;
