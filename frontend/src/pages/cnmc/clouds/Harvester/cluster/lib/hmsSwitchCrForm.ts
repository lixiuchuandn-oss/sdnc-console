/** 表单字段 ↔ HMS Switch CR spec 转换（与集群 hms.rivercloud.com/v1 Switch 一致） */
import type { HmsSwitchCr, HmsSwitchCrSpec } from 'services/harvester/types/cluster';

export const HMS_SWITCH_VENDOR_OPTIONS = [
  { label: '华为', value: '华为' },
  { label: '威努特', value: '威努特' },
  { label: 'H3C', value: 'H3C' },
  { label: '其他', value: '' },
];

/** HSM 内置四类设备 CLI 模板（与厂商枚举一致；留空表示走厂商默认） */
export const HMS_SWITCH_DEVICE_PROFILE_OPTIONS = HMS_SWITCH_VENDOR_OPTIONS;

export const HMS_SWITCH_DEFAULT_DIAL_TIMEOUT = 15;
export const HMS_SWITCH_DEFAULT_EXEC_TIMEOUT = 15;

export type HmsSwitchFormValues = {
  name: string;
  primaryHost: string;
  hostsText?: string;
  user?: string;
  port?: number;
  password?: string;
  vendor?: string;
  deviceProfile?: string;
  dialTimeout?: number;
  execTimeout?: number;
  infoCommandsText?: string;
  interfaceCommandsText?: string;
  performanceCommandsText?: string;
  vlanCommandsText?: string;
  corsAllowedOriginsText?: string;
};

function linesToCommands(text?: string): string[] {
  if (!text) return [];
  return String(text)
    .split(/\r?\n/)
    .map((s) => s.trim());
}

function commandsToLines(list?: string[]): string {
  if (!Array.isArray(list) || list.length === 0) return '';
  return list.join('\n');
}

function positiveIntOrDefault(raw: unknown, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function hmsSwitchCrToFormValues(cr: HmsSwitchCr | null | undefined): HmsSwitchFormValues {
  const spec = cr?.spec || {};
  const hosts = Array.isArray(spec.hosts) ? spec.hosts.map(String) : [];
  const primaryHost = String(spec.primaryHost || hosts[0] || '').trim();
  const extraHosts = hosts.filter((h: string) => h && h !== primaryHost);

  return {
    name: String(cr?.metadata?.name || '').trim(),
    primaryHost,
    hostsText: extraHosts.join('\n'),
    user: spec.user != null ? String(spec.user) : 'root',
    port: spec.port != null ? Number(spec.port) : 22,
    password: '',
    vendor: spec.vendor != null ? String(spec.vendor) : '',
    deviceProfile: spec.deviceProfile != null ? String(spec.deviceProfile) : '',
    dialTimeout: positiveIntOrDefault(spec.dialTimeout, HMS_SWITCH_DEFAULT_DIAL_TIMEOUT),
    execTimeout: positiveIntOrDefault(spec.execTimeout, HMS_SWITCH_DEFAULT_EXEC_TIMEOUT),
    infoCommandsText: commandsToLines(spec.infoCommands),
    interfaceCommandsText: commandsToLines(spec.interfaceCommands),
    performanceCommandsText: commandsToLines(spec.performanceCommands),
    vlanCommandsText: commandsToLines(spec.vlanCommands),
    corsAllowedOriginsText: Array.isArray(spec.corsAllowedOrigins)
      ? spec.corsAllowedOrigins.join('\n')
      : '*',
  };
}

export function hmsSwitchFormValuesToSpec(values: HmsSwitchFormValues, isEdit: boolean): HmsSwitchCrSpec {
  const primaryHost = String(values.primaryHost || '').trim();
  const extraHosts = linesToCommands(values.hostsText).filter(Boolean);
  const hosts = primaryHost
    ? [primaryHost, ...extraHosts.filter((h) => h !== primaryHost)]
    : extraHosts;

  const spec: HmsSwitchCrSpec = {
    hosts,
    primaryHost,
    user: String(values.user || 'root').trim() || 'root',
    port: Number(values.port) > 0 ? Number(values.port) : 22,
    vendor: String(values.vendor || '').trim(),
    deviceProfile: String(values.deviceProfile || '').trim(),
    dialTimeout: positiveIntOrDefault(values.dialTimeout, HMS_SWITCH_DEFAULT_DIAL_TIMEOUT),
    execTimeout: positiveIntOrDefault(values.execTimeout, HMS_SWITCH_DEFAULT_EXEC_TIMEOUT),
    infoCommands: linesToCommands(values.infoCommandsText),
    interfaceCommands: linesToCommands(values.interfaceCommandsText),
    performanceCommands: linesToCommands(values.performanceCommandsText),
    vlanCommands: linesToCommands(values.vlanCommandsText),
    corsAllowedOrigins: linesToCommands(values.corsAllowedOriginsText).filter(Boolean),
  };

  const pwd = values.password != null ? String(values.password) : '';
  if (pwd || !isEdit) {
    spec.password = pwd;
  }

  if (!spec.corsAllowedOrigins?.length) {
    spec.corsAllowedOrigins = ['*'];
  }

  return spec;
}
