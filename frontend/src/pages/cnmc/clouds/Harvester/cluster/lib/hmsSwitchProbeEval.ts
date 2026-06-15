/**
 * HSM 探测维度状态：在 HTTP/ok 失败时，若 CLI 回显已可解析则视为可用（与 SSH 手工结果对齐）。
 */
import type { AswCtlProbeLine, AswCtlSwitchProbeRecord } from 'services/harvester/types/aswProbe';
import {
  extractInterfacesStdoutFromRecord,
  parseInterfaceStatusStdout,
} from './parseAswCtlInterfaceStdout';
import {
  parseSwitchDisplayNameFromInfoLines,
  parseSwitchProductModelFromInfoLines,
} from './physicalSwitchRecordUtils';

function probeLines(
  section: { lines?: AswCtlProbeLine[] } | null | undefined,
): AswCtlProbeLine[] {
  const lines = section?.lines;
  return Array.isArray(lines) ? lines : [];
}

function hasSubstantiveStdout(lines: AswCtlProbeLine[]): boolean {
  return lines.some((ln) => {
    const out = typeof ln?.stdout === 'string' ? ln.stdout : '';
    return out.replace(/\s/g, '').length >= 40;
  });
}

/** 基本信息：能解析型号/名称，或回显含典型设备标识 */
export function isInfoProbeContentSufficient(
  record: AswCtlSwitchProbeRecord | null | undefined,
  vendor?: string | null,
): boolean {
  const lines = probeLines(record?.info);
  if (!lines.length) return false;
  if (parseSwitchProductModelFromInfoLines(lines, { vendor })) return true;
  if (parseSwitchDisplayNameFromInfoLines(lines)) return true;
  if (!hasSubstantiveStdout(lines)) return false;
  const blob = lines.map((ln) => (typeof ln?.stdout === 'string' ? ln.stdout : '')).join('\n');
  return /H3C|Comware|HUAWEI|Cisco|BOARD\s+TYPE|Version|Copyright/i.test(blob);
}

/** 接口状态：能从 stdout 解析出至少一个物理口 */
export function isInterfacesProbeContentSufficient(
  record: AswCtlSwitchProbeRecord | null | undefined,
): boolean {
  if (!record) return false;
  const extracted = extractInterfacesStdoutFromRecord(record);
  if (extracted?.stdout?.trim()) {
    return parseInterfaceStatusStdout(extracted.stdout).length > 0;
  }
  for (const ln of probeLines(record.interfaces)) {
    const out = typeof ln?.stdout === 'string' ? ln.stdout : '';
    if (out.trim() && parseInterfaceStatusStdout(out).length > 0) return true;
  }
  return false;
}

export type HmsProbeDimEvalOpts = {
  errorKey: keyof AswCtlSwitchProbeRecord;
  dataKey: 'info' | 'interfaces' | 'performance' | 'vlans';
  naKey?: keyof AswCtlSwitchProbeRecord;
  vendor?: string | null;
};

export type HmsProbeDimEvalState = 'ok' | 'err' | 'warn' | 'none';

/** 列表 Tag / 详情 KPI 共用 */
export function evaluateHmsProbeDimState(
  record: AswCtlSwitchProbeRecord | null | undefined,
  opts: HmsProbeDimEvalOpts,
): HmsProbeDimEvalState {
  if (!record) return 'none';
  if (opts.naKey && record[opts.naKey]) return 'warn';

  if (opts.dataKey === 'info' && isInfoProbeContentSufficient(record, opts.vendor)) {
    return 'ok';
  }
  if (opts.dataKey === 'interfaces' && isInterfacesProbeContentSufficient(record)) {
    return 'ok';
  }

  if (record[opts.errorKey]) return 'err';
  const data = record[opts.dataKey];
  if (data && typeof data === 'object' && 'ok' in data && (data as { ok?: boolean }).ok === false) {
    return 'err';
  }
  if (data) return 'ok';
  return 'none';
}

export function hmsProbeDimStateLabel(
  state: HmsProbeDimEvalState,
  naLabel?: string,
): string {
  if (state === 'warn' && naLabel) return naLabel;
  if (state === 'ok') return '正常';
  if (state === 'err') return '失败';
  if (state === 'warn') return '未配置';
  return '—';
}

/** 详情里：HSM 报错但回显已可用 */
export function isHmsProbeDimDegraded(
  record: AswCtlSwitchProbeRecord,
  opts: HmsProbeDimEvalOpts,
): boolean {
  const state = evaluateHmsProbeDimState(record, opts);
  if (state !== 'ok') return false;
  if (record[opts.errorKey]) return true;
  const data = record[opts.dataKey];
  return !!(data && typeof data === 'object' && 'ok' in data && (data as { ok?: boolean }).ok === false);
}
