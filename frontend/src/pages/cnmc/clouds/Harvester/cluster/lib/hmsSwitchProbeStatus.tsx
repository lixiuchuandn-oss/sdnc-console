/** HSM/ASW-CTL 单维度探测状态（与 PhysicalSwitchProbeTabs 语义一致） */
import React from 'react';
import { Tag } from 'antd';
import {
  parseSwitchProductModelFromInfoLines,
  switchRecordManagementHost,
} from './physicalSwitchRecordUtils';

export type HmsProbeDimState = 'ok' | 'err' | 'warn' | 'none';

export function resolveHmsProbeDimState(
  record: any | null | undefined,
  opts: {
    errorKey: string;
    dataKey: string;
    naKey?: string;
  },
): HmsProbeDimState {
  if (!record) return 'none';
  if (record[opts.errorKey]) return 'err';
  const data = record[opts.dataKey];
  if (data && data.ok === false) return 'err';
  if (opts.naKey && record[opts.naKey]) return 'warn';
  if (data) return 'ok';
  return 'none';
}

const DIM_LABEL: Record<HmsProbeDimState, string> = {
  ok: '正常',
  err: '失败',
  warn: '未配置',
  none: '—',
};

export function HmsProbeDimTag({
  state,
  naLabel,
}: {
  state: HmsProbeDimState;
  naLabel?: string;
}) {
  const text = state === 'warn' && naLabel ? naLabel : DIM_LABEL[state];
  if (state === 'err') return <Tag color="error">{text}</Tag>;
  if (state === 'warn') return <Tag color="warning">{text}</Tag>;
  if (state === 'ok') return <Tag color="success">{text}</Tag>;
  return <Tag>{text}</Tag>;
}

export function hmsServiceHealthState(aggregate: any | null | undefined): HmsProbeDimState {
  if (!aggregate) return 'none';
  if (aggregate.healthError) return 'err';
  if (aggregate.healthNotApplicable) return 'warn';
  if (aggregate.health != null) return 'ok';
  return 'none';
}

export function switchProbeProductModel(probe: any | null | undefined): string {
  if (!probe) return '';
  return parseSwitchProductModelFromInfoLines(probe.info?.lines) || '';
}

export function switchProbeMatchedHost(probe: any | null | undefined): string {
  if (!probe) return '';
  const h = switchRecordManagementHost(probe);
  return h !== '—' ? h : '';
}
