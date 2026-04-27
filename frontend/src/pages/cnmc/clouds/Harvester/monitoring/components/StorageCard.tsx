/**
 * 存储空间卡片 - Longhorn 节点数据
 */
import React, { useMemo } from 'react';
import { Card, Typography, Spin } from 'antd';
import { CloudServerOutlined } from '@ant-design/icons';
import { useDashboardNodeDataContext } from '../DashboardContext';
import { parseLonghornStorage, formatBytesWithUnit } from '../utils/longhornStorage';

export const StorageCard: React.FC = () => {
  const ctx = useDashboardNodeDataContext();
  const summary = useMemo(() => parseLonghornStorage(ctx?.storageNodes ?? null), [ctx?.storageNodes]);
  const loading = ctx?.loading ?? false;

  const usedPercent =
    summary.storageMaximum > 0 ? Math.round((summary.storageUsed / summary.storageMaximum) * 1000) / 10 : 0;
  const totalFormatted = formatBytesWithUnit(summary.storageMaximum);
  const usedFormatted = formatBytesWithUnit(summary.storageUsed);
  const remainingFormatted = formatBytesWithUnit(summary.storageAvailable);
  const replica = summary.defaultReplicaCount >= 1 ? summary.defaultReplicaCount : 3;
  const distributedFormatted = formatBytesWithUnit(summary.storageAvailable / replica);

  if (loading) {
    return (
      <Card
        size="small"
        title={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <CloudServerOutlined style={{ color: '#1677ff', fontSize: 20 }} />
            <span style={{ fontSize: 16 }}>储存空间</span>
          </span>
        }
        style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
      >
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 120 }}>
          <Spin />
        </div>
      </Card>
    );
  }

  return (
    <Card
      size="small"
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <CloudServerOutlined style={{ color: '#1677ff', fontSize: 20 }} />
          <span style={{ fontSize: 16 }}>储存空间</span>
        </span>
      }
      styles={{
        header: { padding: '16px 20px', height: 60, minHeight: 60 },
        body: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' },
      }}
      extra={
        <span style={{ fontSize: 14, color: '#999' }}>
          总容量 {totalFormatted.value.toFixed(2)} {totalFormatted.unit}
          {summary.nodeCount > 0 && ` · ${summary.nodeCount} 节点`}
        </span>
      }
      style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
    >
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ marginTop: 12, marginBottom: 16 }}>
          <div
            style={{
              height: 18,
              borderRadius: 9999,
              background: '#f0f0f0',
              overflow: 'hidden',
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: `${Math.min(100, usedPercent)}%`,
                background: 'linear-gradient(90deg, #1677ff 0%, #69b1ff 100%)',
                borderRadius: 9999,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {usedPercent > 15 && (
                <span style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>{usedPercent}%</span>
              )}
            </div>
            {usedPercent > 0 && usedPercent <= 15 && (
              <span
                style={{
                  position: 'absolute',
                  left: `calc(${usedPercent}% + 6px)`,
                  fontSize: 14,
                  fontWeight: 600,
                  color: '#1677ff',
                  whiteSpace: 'nowrap',
                }}
              >
                {usedPercent}%
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 24, marginBottom: 16 }}>
          <div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: 2, background: '#1677ff' }} />
              <Typography.Text type="secondary" style={{ fontSize: 14 }}>已使用</Typography.Text>
            </div>
            <div style={{ fontSize: 14, fontWeight: 500 }}>
              {usedFormatted.value.toFixed(2)} {usedFormatted.unit}
            </div>
          </div>
          <div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: 2, background: '#d9d9d9' }} />
              <Typography.Text type="secondary" style={{ fontSize: 14 }}>剩余</Typography.Text>
            </div>
            <div style={{ fontSize: 14, fontWeight: 500 }}>
              {remainingFormatted.value.toFixed(2)} {remainingFormatted.unit}
            </div>
          </div>
        </div>
        <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 16, marginTop: 'auto', flexShrink: 0 }}>
          <Typography.Text type="secondary" style={{ fontSize: 14 }}>分布式储存可分配空间</Typography.Text>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
            <span style={{ fontSize: 16, fontWeight: 600 }}>
              {distributedFormatted.value.toFixed(2)}{' '}
              <Typography.Text type="secondary" style={{ fontSize: 14 }}>{distributedFormatted.unit}</Typography.Text>
            </span>
            <span style={{ fontSize: 14, color: '#fff', background: '#1677ff', padding: '6px 14px', borderRadius: 6 }}>
              {replica} 副本
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
};
