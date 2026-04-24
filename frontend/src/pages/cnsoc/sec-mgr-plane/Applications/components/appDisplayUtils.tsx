import React from 'react';
import { Tag } from 'antd';
import type { AppItem } from '../types/app';

export const statusTag = (s: AppItem['status']) => {
  const map: Record<string, string> = { running: 'green', stopped: 'default', degraded: 'orange' };
  const txt: Record<string, string> = { running: '运行中', stopped: '已停止', degraded: '告警' };
  return <Tag color={map[s]}>{txt[s]}</Tag>;
};

export const typeTag = (t: unknown) => {
  const key = String(t || '').toLowerCase();
  const map: Record<string, string> = { vm: 'blue', container: 'cyan', mixed: 'purple', service_address: 'geekblue' };
  const txt: Record<string, string> = { vm: '虚机', container: '容器', mixed: '混合', service_address: '服务地址' };
  const color = map[key] || 'default';
  const label = txt[key] || '未知';
  return <Tag color={color}>{label}</Tag>;
};
