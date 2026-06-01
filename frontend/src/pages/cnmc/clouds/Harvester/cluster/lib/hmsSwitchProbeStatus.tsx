/** HSM/ASW-CTL 单维度探测状态（与 PhysicalSwitchProbeTabs 语义一致） */
import React from 'react';
import { Tag } from 'antd';
import type { AswCtlSwitchProbeRecord } from 'services/harvester/types/aswProbe';
import {
  parseSwitchProductModelFromInfoLines,
  switchRecordManagementHost,
} from './physicalSwitchRecordUtils';

export type HmsProbeDimState = 'ok' | 'err' | 'warn' | 'none';

export function resolveHmsProbeDimState(
  record: AswCtlSwitchProbeRecord | null | undefined,
  opts: {
    errorKey: string;
    dataKey: string;
    naKey?: string;
  },
): HmsProbeDimState {
  if (!record) return 'none';
  const row = record as Record<string, unknown>;
  if (row[opts.errorKey]) return 'err';
  const data = row[opts.dataKey] as { ok?: boolean } | undefined;
  if (data && data.ok === false) return 'err';
  if (opts.naKey && row[opts.naKey]) return 'warn';
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

export function hmsServiceHealthState(
  aggregate: AswCtlSwitchProbeRecord | null | undefined,
): HmsProbeDimState {
  if (!aggregate) return 'none';
  if (aggregate.healthError) return 'err';
  if (aggregate.healthNotApplicable) return 'warn';
  if (aggregate.health != null) return 'ok';
  return 'none';
}

export function switchProbeProductModel(
  probe: AswCtlSwitchProbeRecord | null | undefined,
  vendor?: string | null,
): string {
  if (!probe) return '';
  return parseSwitchProductModelFromInfoLines(probe.info?.lines, { vendor }) || '';
}

export function switchProbeMatchedHost(probe: AswCtlSwitchProbeRecord | null | undefined): string {
  if (!probe) return '';
  const h = switchRecordManagementHost(probe);
  return h !== '—' ? h : '';
}
