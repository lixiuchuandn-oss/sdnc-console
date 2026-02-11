/**
 * 磁盘卡片 - 按主机维度 健康/告警/其他
 */
import React, { useMemo } from 'react';
import { Card, Typography, Spin } from 'antd';
import { HddOutlined, CheckCircleOutlined, WarningOutlined, InfoCircleOutlined } from '@ant-design/icons';
import { useDashboardNodeDataContext, useDashboardSlowDataContext } from '../DashboardContext';
import { aggregateDiskSummaryByHost } from '../utils/diskSummary';
import type { DiskSummary } from '../utils/diskSummary';

const SEGMENTS: {
  label: string;
  key: keyof DiskSummary;
  icon: typeof CheckCircleOutlined;
  color: string;
}[] = [
  { label: '健康', key: 'healthy', icon: CheckCircleOutlined, color: '#52c41a' },
  { label: '告警', key: 'warning', icon: WarningOutlined, color: '#FF5C7C' },
  { label: '其他', key: 'other', icon: InfoCircleOutlined, color: '#999' },
];

export const DiskCard: React.FC = () => {
  const ctx = useDashboardNodeDataContext();
  const slowCtx = useDashboardSlowDataContext();
  const summary = useMemo(() => {
    if (ctx?.nodeResources == null || ctx?.storageNodes == null || slowCtx?.blockDevices == null) return null;
    return aggregateDiskSummaryByHost(ctx.nodeResources, ctx.storageNodes, slowCtx.blockDevices);
  }, [ctx?.nodeResources, ctx?.storageNodes, slowCtx?.blockDevices]);

  const loading = ctx?.loading || slowCtx?.loading;

  if (loading) {
    return (
      <Card
        size="small"
        title={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <HddOutlined style={{ color: '#1677ff', fontSize: 20 }} />
            <span style={{ fontSize: 16 }}>磁盘</span>
          </span>
        }
        styles={{
          header: { padding: '16px 20px', height: 60, minHeight: 60 },
          body: { display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 140 },
        }}
        style={{ height: '100%', display: 'flex', flexDirection: 'column', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
      >
        <Spin tip="加载中..." />
      </Card>
    );
  }

  const s: DiskSummary = summary ?? { healthy: 0, warning: 0, other: 0, total: 0 };
  const stats = SEGMENTS.map((seg) => ({ ...seg, value: s[seg.key] ?? 0 }));

  return (
    <Card
      size="small"
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <HddOutlined style={{ color: '#1677ff', fontSize: 20 }} />
          <span style={{ fontSize: 16 }}>磁盘</span>
        </span>
      }
      styles={{
        header: { padding: '16px 20px', height: 60, minHeight: 60 },
        body: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, paddingLeft: 20, paddingRight: 20 },
      }}
      style={{ height: '100%', display: 'flex', flexDirection: 'column', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
    >
      <div style={{ flex: 1, minHeight: 0 }}>
        {stats.map((item, i) => (
          <div
            key={item.key}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '10px 0',
              borderBottom: i < stats.length - 1 ? '1px solid #f0f0f0' : undefined,
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <item.icon style={{ color: item.color, fontSize: 14 }} />
              <Typography.Text style={{ fontSize: 14 }}>{item.label}</Typography.Text>
            </span>
            <span style={{ fontSize: 14 }}>{item.value}</span>
          </div>
        ))}
      </div>
      <div
        style={{
          borderTop: '1px solid #f0f0f0',
          paddingTop: 12,
          marginTop: 'auto',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'flex-start',
          gap: 6,
        }}
      >
        <InfoCircleOutlined style={{ color: '#1677ff', fontSize: 14, marginTop: 3 }} />
        <Typography.Text type="secondary" style={{ fontSize: 12, lineHeight: 1.5 }}>
          按主机维度统计，展示每台主机的磁盘状态
        </Typography.Text>
      </div>
    </Card>
  );
};
