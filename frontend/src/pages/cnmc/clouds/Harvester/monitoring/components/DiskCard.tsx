/**
 * 磁盘卡片：总览存储健康与风险（展示随环境自动适配）。
 */
import React, { useMemo } from 'react';
import { Card, Typography, Spin } from 'antd';
import { CloudServerOutlined, CheckCircleOutlined, WarningOutlined, InfoCircleOutlined } from '@ant-design/icons';
import { useMonitoringOverviewFastLane, useMonitoringOverviewSlowLane } from '../MonitoringOverviewLanesContext';
import { resolveMonitoringDiskSummary } from '../lib/diskSummary';
import type { DiskCardAggregateMode, DiskSummary } from '../lib/diskSummary';

const SEGMENTS: {
  label: string;
  key: 'healthy' | 'warning' | 'other';
  icon: typeof CheckCircleOutlined;
  color: string;
}[] = [
  { label: '已就绪', key: 'healthy', icon: CheckCircleOutlined, color: '#52c41a' },
  { label: '异常', key: 'warning', icon: WarningOutlined, color: '#FF5C7C' },
  { label: '其他', key: 'other', icon: InfoCircleOutlined, color: '#999' },
];

const FOOTER_BY_MODE: Record<DiskCardAggregateMode, string> = {
  ceph_osd:
    '存储服务实例（OSD）的健康与可用程度',
  block_device:
    '存储服务硬盘（BlockDevice）的健康与可用程度',
};

export const DiskCard: React.FC = () => {
  const fast = useMonitoringOverviewFastLane();
  const slow = useMonitoringOverviewSlowLane();
  const loading = fast.extrasLoading || slow.loading;

  const resolved = useMemo(
    () =>
      resolveMonitoringDiskSummary(
        fast.cephHealthMinimal ?? null,
        fast.cephResourcesRaw ?? null,
        slow.blockDevices ?? null,
      ),
    [fast.cephHealthMinimal, fast.cephResourcesRaw, slow.blockDevices],
  );

  const mode: DiskCardAggregateMode = resolved?.mode ?? 'block_device';
  const s: DiskSummary = resolved?.summary ?? { healthy: 0, warning: 0, other: 0, total: 0 };
  const stats = SEGMENTS.map((seg) => ({ ...seg, value: s[seg.key] ?? 0 }));
  const extraText = mode === 'ceph_osd' ? `共 ${s.total} 个 OSD` : `共 ${s.total} 块`;

  return (
    <Card
      size="small"
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <CloudServerOutlined style={{ color: '#1677ff', fontSize: 20 }} />
          <span style={{ fontSize: 16 }}>存储设备</span>
        </span>
      }
      styles={{
        header: { padding: '16px 20px', height: 60, minHeight: 60 },
        body: {
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          minHeight: 0,
          paddingLeft: 20,
          paddingRight: 20,
        },
      }}
      extra={<span style={{ fontSize: 14, color: '#999' }}>{extraText}</span>}
      style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
    >
      <Spin spinning={loading}>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          width: '100%',
        }}
      >
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
          flexShrink: 0,
          borderTop: '1px solid #f0f0f0',
          paddingTop: 12,
          display: 'flex',
          alignItems: 'flex-start',
          gap: 6,
        }}
      >
        <InfoCircleOutlined style={{ color: '#1677ff', fontSize: 14, marginTop: 3 }} />
        <Typography.Text type="secondary" style={{ fontSize: 12, lineHeight: 1.5 }}>
          {FOOTER_BY_MODE[mode]}
        </Typography.Text>
      </div>
      </Spin>
    </Card>
  );
};
