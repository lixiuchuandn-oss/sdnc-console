/** 物理交换机探测 Tabs · 纯函数与 KPI 模型 */

import type { AswCtlSwitchProbeRecord } from 'services/harvester/types/aswProbe';
import {
  evaluateHmsProbeDimState,
  hmsProbeDimStateLabel,
  isHmsProbeDimDegraded,
} from './hmsSwitchProbeEval';
import {
  parseSwitchProductModelFromInfoLines,
  switchRecordDeviceProfile,
  switchRecordManagementHost,
} from './physicalSwitchRecordUtils';

export type KpiTone = 'ok' | 'warn' | 'err' | 'muted';

export type SwitchProbeDrawerModel = {
  record: AswCtlSwitchProbeRecord;
  host: string;
  profile: string;
  productModel: string;
  kpiInfoTone: KpiTone;
  kpiIfTone: KpiTone;
  kpiPerfTone: KpiTone;
  kpiVlanTone: KpiTone;
  kpiInfoVal: string;
  kpiIfVal: string;
  kpiPerfVal: string;
  kpiVlanVal: string;
};

type ProbeStateOpts = {
  errorKey: keyof AswCtlSwitchProbeRecord;
  dataKey: 'info' | 'interfaces' | 'performance' | 'vlans';
  naKey?: keyof AswCtlSwitchProbeRecord;
  naLabel?: string;
};

export function probeStateText(
  record: AswCtlSwitchProbeRecord,
  opts: ProbeStateOpts & { vendor?: string | null },
): string {
  return hmsProbeDimStateLabel(
    evaluateHmsProbeDimState(record, {
      errorKey: opts.errorKey,
      dataKey: opts.dataKey,
      naKey: opts.naKey,
      vendor: opts.vendor,
    }),
    opts.naLabel,
  );
}

export function buildSwitchProbeDrawerModel(
  record: AswCtlSwitchProbeRecord,
  vendor?: string | null,
): SwitchProbeDrawerModel {
  const host = switchRecordManagementHost(record);
  const profile = switchRecordDeviceProfile(record);
  const productModel = parseSwitchProductModelFromInfoLines(record.info?.lines, { vendor });

  const kpiInfoTone: KpiTone = (() => {
    const s = evaluateHmsProbeDimState(record, {
      errorKey: 'infoError',
      dataKey: 'info',
      vendor,
    });
    if (s === 'ok' && isHmsProbeDimDegraded(record, { errorKey: 'infoError', dataKey: 'info', vendor })) {
      return 'warn';
    }
    return s === 'ok' ? 'ok' : s === 'err' ? 'err' : 'muted';
  })();
  const kpiIfTone: KpiTone = (() => {
    const s = evaluateHmsProbeDimState(record, {
      errorKey: 'interfacesError',
      dataKey: 'interfaces',
    });
    if (
      s === 'ok' &&
      isHmsProbeDimDegraded(record, { errorKey: 'interfacesError', dataKey: 'interfaces' })
    ) {
      return 'warn';
    }
    return s === 'ok' ? 'ok' : s === 'err' ? 'err' : 'muted';
  })();
  const kpiPerfTone: KpiTone = record.performanceError
    ? 'err'
    : record.performanceNotApplicable
      ? 'warn'
      : record.performance && record.performance.ok === false
        ? 'err'
        : record.performance
          ? 'ok'
          : 'muted';
  const kpiVlanTone: KpiTone = record.vlansError
    ? 'err'
    : record.vlansNotApplicable
      ? 'warn'
      : record.vlans && record.vlans.ok === false
        ? 'err'
        : record.vlans
          ? 'ok'
          : 'muted';

  return {
    record,
    host,
    profile,
    productModel,
    kpiInfoTone,
    kpiIfTone,
    kpiPerfTone,
    kpiVlanTone,
    kpiInfoVal: probeStateText(record, { errorKey: 'infoError', dataKey: 'info', vendor }),
    kpiIfVal: probeStateText(record, { errorKey: 'interfacesError', dataKey: 'interfaces' }),
    kpiPerfVal: probeStateText(record, {
      errorKey: 'performanceError',
      dataKey: 'performance',
      naKey: 'performanceNotApplicable',
      naLabel: '未配置',
    }),
    kpiVlanVal: probeStateText(record, {
      errorKey: 'vlansError',
      dataKey: 'vlans',
      naKey: 'vlansNotApplicable',
      naLabel: '未提供',
    }),
  };
}

export function aswCtlServiceHealthTone(record: AswCtlSwitchProbeRecord): KpiTone {
  if (record.healthError) return 'err';
  if (record.healthNotApplicable) return 'muted';
  if (record.health != null) return 'ok';
  return 'muted';
}

export function aswCtlServiceHealthLabel(record: AswCtlSwitchProbeRecord): string {
  if (record.healthError) return '失败';
  if (record.healthNotApplicable) return '未提供';
  if (record.health != null) return '正常';
  return '—';
}
