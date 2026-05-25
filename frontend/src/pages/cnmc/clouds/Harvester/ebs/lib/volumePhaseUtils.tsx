import React from 'react';
import { Badge } from 'antd';
import { ExclamationCircleOutlined, SyncOutlined } from '@ant-design/icons';

export const VOLUME_LIST_POLL_MS = 3500;

export const TRANSITION_VOLUME_PHASES = new Set([
  'pending',
  'creating',
  'deleting',
  'resizing',
  'filesystemresizepending',
  'terminating',
  'attaching',
  'detaching',
]);

export function isVolumePhaseTransitional(phase: string): boolean {
  const p = String(phase || '').trim().toLowerCase();
  return TRANSITION_VOLUME_PHASES.has(p);
}

export function renderVolumeStatusBadge(phase: string): React.ReactNode {
  const p = (phase || '').toLowerCase();
  let status: 'success' | 'error' | 'processing' | 'warning' | 'default' = 'default';
  let text = phase;
  let icon: React.ReactNode = null;

  if (p === 'bound' || p === 'available') {
    status = 'success';
    text = '正常 (Bound)';
  } else if (p === 'lost') {
    status = 'error';
    text = '丢失 (Lost)';
  } else if (p === 'pending') {
    status = 'processing';
    text = '创建中 (Pending)';
  } else if (p === 'resizing') {
    status = 'processing';
    text = '扩容中 (Resizing)';
    icon = <SyncOutlined spin />;
  } else if (p === 'filesystemresizepending') {
    status = 'warning';
    text = '等待文件系统扩容';
    icon = <ExclamationCircleOutlined />;
  }

  return (
    <Badge
      status={status}
      text={
        icon ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {text}
            {icon}
          </span>
        ) : (
          text
        )
      }
    />
  );
}
