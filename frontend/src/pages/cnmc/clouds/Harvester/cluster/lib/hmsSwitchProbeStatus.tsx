/** HSM/ASW-CTL 单维度探测状态（与 PhysicalSwitchProbeTabs 语义一致） */
import React from 'react';
import { Tag } from 'antd';
import type { AswCtlSwitchProbeRecord } from 'services/harvester/types/aswProbe';
import {
  evaluateHmsProbeDimState,
  type HmsProbeDimEvalState,
} from './hmsSwitchProbeEval';
import {
  parseSwitchProductModelFromInfoLines,
  switchRecordManagementHost,
} from './physicalSwitchRecordUtils';

export type HmsProbeDimState = HmsProbeDimEvalState;

export function resolveHmsProbeDimState(
  record: AswCtlSwitchProbeRecord | null | undefined,
  opts: {
    errorKey: keyof AswCtlSwitchProbeRecord;
    dataKey: 'info' | 'interfaces' | 'performance' | 'vlans';
    naKey?: keyof AswCtlSwitchProbeRecord;
    vendor?: string | null;
  },
): HmsProbeDimState {
  return evaluateHmsProbeDimState(record, opts);
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
