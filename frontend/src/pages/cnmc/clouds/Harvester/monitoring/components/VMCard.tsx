/**
 * 云主机卡片 - 总数 + 运行中/已暂停/已关机/其他
 */
import React, { useMemo } from 'react';
import { Card, Typography, Spin } from 'antd';
import {
  DesktopOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
  PoweroffOutlined,
  EllipsisOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons';
import { useMonitoringOverviewSlowLane } from '../MonitoringOverviewLanesContext';
import { parseVMInstancesToStatusCounts } from '../lib/vmInstances';

const SEGMENT_ICONS: Record<string, typeof PlayCircleOutlined> = {
  running: PlayCircleOutlined,
  paused: PauseCircleOutlined,
  stopped: PoweroffOutlined,
  other: EllipsisOutlined,
};
const SEGMENT_COLORS: Record<string, string> = {
  running: '#10B981',
  paused: '#FAAD14',
  stopped: '#64748B',
  other: '#FF5C7C',
};

export const VMCard: React.FC = () => {
  const slow = useMonitoringOverviewSlowLane();
  const loading = slow.loading;

  const summary = useMemo(
    () => parseVMInstancesToStatusCounts(slow.virtualMachines ?? null, slow.vmInstances ?? null),
    [slow.virtualMachines, slow.vmInstances],
  );

  const total = summary?.total ?? 0;
  const statusList = summary?.segments ?? [];

  return (
    <Card
      size="small"
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <DesktopOutlined style={{ color: '#1677ff', fontSize: 20 }} />
          <span style={{ fontSize: 16 }}>云主机</span>
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
      extra={<span style={{ fontSize: 14, color: '#999' }}>共 {total} 台</span>}
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
        <div style={{ display: 'flex', gap: 24, alignItems: 'center', minHeight: 0 }}>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: 80,
              flexShrink: 0,
            }}
          >
            <DesktopOutlined style={{ color: '#1677ff', fontSize: 32, marginBottom: 8 }} />
            <span style={{ fontSize: 16, fontWeight: 600 }}>{total}</span>
            <Typography.Text type="secondary" style={{ fontSize: 14 }}>
              共 {total} 台
            </Typography.Text>
          </div>
          <div style={{ flex: 1, paddingRight: 12 }}>
            {statusList.map((s, i) => {
              const Icon = SEGMENT_ICONS[s.key] || EllipsisOutlined;
              const color = SEGMENT_COLORS[s.key] ?? '#999';
              return (
                <div
                  key={s.key}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px 0',
                    borderBottom: i < statusList.length - 1 ? '1px solid #f0f0f0' : undefined,
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <span
                      style={{
                        width: 16,
                        height: 16,
                        borderRadius: '50%',
                        border: `1px solid ${color}`,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Icon style={{ color, fontSize: 10 }} />
                    </span>
                    <Typography.Text style={{ fontSize: 14 }}>{s.label}</Typography.Text>
                  </span>
                  <span style={{ fontSize: 14 }}>{s.value}</span>
                </div>
              );
            })}
          </div>
        </div>
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
          按运行状态统计，展示虚拟机总数及运行中/暂停/关机等分布
        </Typography.Text>
      </div>
      </Spin>
    </Card>
  );
};
