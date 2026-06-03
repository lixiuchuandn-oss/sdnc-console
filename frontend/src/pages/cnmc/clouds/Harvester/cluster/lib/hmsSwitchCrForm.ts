/** 表单字段 ↔ HMS Switch CR spec 转换（与集群 hms.rivercloud.com/v1 Switch 一致） */
import type { HmsSwitchCr, HmsSwitchCrSpec } from 'services/harvester/types/cluster';

export const HMS_SWITCH_VENDOR_OPTIONS = [
  { label: '华为', value: '华为' },
  { label: '威努特', value: '威努特' },
  { label: 'H3C', value: 'H3C' },
  { label: '其他', value: '' },
];

/** 无法匹配厂商或模板列表时的兜底 profile（HMS 侧与 default/generit 等等价，界面仅展示「通用」） */
export const HMS_SWITCH_DEVICE_PROFILE_GENERIC = 'generic';

/** HMS 不可用时表单仍可选的常用模板（不含 default，已与 generic 合并） */
export const HMS_SWITCH_DEVICE_PROFILE_FALLBACK_OPTIONS: { label: string; value: string }[] = [
  { value: HMS_SWITCH_DEVICE_PROFILE_GENERIC, label: '通用' },
  { value: 'h3c-huawei-like', label: 'H3C/华为' },
  { value: 'winicssec-wos', label: '威努特' },
  { value: 'cisco-like', label: '思科' },
];

const DEVICE_PROFILE_CANONICAL_GENERIC = new Set(['generic', 'generit', 'default', '']);

/** HSM deviceProfile value → 界面展示中文 */
const HMS_DEVICE_PROFILE_LABELS: Record<string, string> = {
  'h3c-huawei-like': 'H3C/华为',
  'cisco-like': '思科',
  cisco: '思科',
  'winicssec-wos': '威努特',
  generic: '通用',
  generit: '通用',
  default: '通用',
};

/** 将 CR/表单中的 profile 规范为 HMS 可识别的 value（default/generit/空 → generic） */
export function normalizeHmsDeviceProfileValue(value?: string | null): string {
  const raw = String(value ?? '').trim();
  if (!raw) return HMS_SWITCH_DEVICE_PROFILE_GENERIC;
  const lower = raw.toLowerCase();
  if (DEVICE_PROFILE_CANONICAL_GENERIC.has(lower)) return HMS_SWITCH_DEVICE_PROFILE_GENERIC;
  return raw;
}

/** 按厂商推断设备模板；候选列表非空时须在列表中存在，否则回退 generic */
export function inferHmsDeviceProfileFromVendor(
  vendor?: string | null,
  availableValues?: string[],
): string {
  const v = String(vendor ?? '').trim();
  const available = (availableValues || []).map((x) => normalizeHmsDeviceProfileValue(x));
  const availableSet = new Set(available);

  const pick = (preferred: string): string => {
    const norm = normalizeHmsDeviceProfileValue(preferred);
    if (availableSet.size === 0) return norm;
    return availableSet.has(norm) ? norm : HMS_SWITCH_DEVICE_PROFILE_GENERIC;
  };

  if (/^H3C$/i.test(v)) return pick('h3c-huawei-like');
  if (v === '华为') {
    if (availableSet.has('huawei')) return 'huawei';
    return pick('h3c-huawei-like');
  }
  if (v === '威努特') return pick('winicssec-wos');
  return HMS_SWITCH_DEVICE_PROFILE_GENERIC;
}

/** 合并远程模板：default/generit 归入 generic，保证下拉含「通用」 */
export function dedupeHmsDeviceProfileOptions(
  options: { label: string; value: string }[],
): { label: string; value: string }[] {
  const seen = new Set<string>();
  const out: { label: string; value: string }[] = [];

  for (const o of options) {
    const norm = normalizeHmsDeviceProfileValue(o.value);
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push({
      value: norm,
      label: formatHmsDeviceProfileLabel(norm, o.label),
    });
  }

  if (!seen.has(HMS_SWITCH_DEVICE_PROFILE_GENERIC)) {
    out.unshift({
      value: HMS_SWITCH_DEVICE_PROFILE_GENERIC,
      label: formatHmsDeviceProfileLabel(HMS_SWITCH_DEVICE_PROFILE_GENERIC),
    });
  }

  return out;
}

export function shouldAutoPickHmsDeviceProfile(current?: string | null): boolean {
  const raw = String(current ?? '').trim();
  if (!raw) return true;
  return normalizeHmsDeviceProfileValue(raw) === HMS_SWITCH_DEVICE_PROFILE_GENERIC;
}

export function resolveHmsSwitchDeviceProfile(params: {
  vendor?: string | null;
  currentProfile?: string | null;
  remoteOptions: { label: string; value: string }[];
}): string {
  const available = dedupeHmsDeviceProfileOptions(params.remoteOptions);
  const availableValues = available.map((o) => o.value);
  const normalized = normalizeHmsDeviceProfileValue(params.currentProfile);

  if (
    normalized !== HMS_SWITCH_DEVICE_PROFILE_GENERIC &&
    (availableValues.length === 0 || availableValues.includes(normalized))
  ) {
    return normalized;
  }

  return inferHmsDeviceProfileFromVendor(params.vendor, availableValues);
}

export function formatHmsDeviceProfileLabel(
  value?: string | null,
  remoteLabel?: string | null,
): string {
  const v = String(value ?? '').trim();
  if (!v) return '—';
  const mapped = HMS_DEVICE_PROFILE_LABELS[v.toLowerCase()];
  if (mapped) return mapped;
  const remote = String(remoteLabel ?? '').trim();
  if (remote && remote.toLowerCase() !== v.toLowerCase()) return remote;
  return v;
}

export const HMS_SWITCH_DEFAULT_DIAL_TIMEOUT = 15;
export const HMS_SWITCH_DEFAULT_EXEC_TIMEOUT = 15;

/** 连接超时（秒）下拉预设 */
export const HMS_SWITCH_DIAL_TIMEOUT_PRESETS = [5, 10, 15, 20, 30, 45, 60] as const;

/** 命令超时（秒）下拉预设 */
export const HMS_SWITCH_EXEC_TIMEOUT_PRESETS = [15, 30, 45, 60, 90, 120, 180, 300] as const;

export function buildHmsSwitchDialTimeoutSelectOptions(
  current?: number | null,
): { label: string; value: number }[] {
  const preset = new Set<number>([...HMS_SWITCH_DIAL_TIMEOUT_PRESETS]);
  const n = Number(current);
  if (Number.isFinite(n) && n > 0 && !preset.has(n)) {
    preset.add(n);
  }
  return Array.from(preset)
    .sort((a, b) => a - b)
    .map((v) => ({ label: `${v} 秒`, value: v }));
}

export function buildHmsSwitchExecTimeoutSelectOptions(
  current?: number | null,
): { label: string; value: number }[] {
  const preset = new Set<number>([...HMS_SWITCH_EXEC_TIMEOUT_PRESETS]);
  const n = Number(current);
  if (Number.isFinite(n) && n > 0 && !preset.has(n)) {
    preset.add(n);
  }
  return Array.from(preset)
    .sort((a, b) => a - b)
    .map((v) => ({ label: `${v} 秒`, value: v }));
}

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
  /** 关分页 CLI；留空表示使用设备模板默认 */
  screenLengthCmd?: string;
};

function linesToCommands(text?: string): string[] {
  if (!text) return [];
  return normalizeCliCommandLines(text);
}

/**
 * 合并误换行/误拆条的管道命令（如 `display interface brief` + `| include XGE`）。
 * HSM 按 interfaceCommands[] 逐条执行时，拆成多条会导致第二条失败。
 */
export function normalizeCliCommandLines(text?: string): string[] {
  const raw = String(text || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const line of raw) {
    const prev = out.length > 0 ? out[out.length - 1]! : '';
    const continuesPipe =
      out.length > 0 &&
      (/^\|/.test(line) || /^include\b/i.test(line) || /\|\s*$/.test(prev));
    if (continuesPipe) {
      const joined = `${prev} ${line}`.replace(/\|\s+/g, '| ').replace(/\s+/g, ' ').trim();
      out[out.length - 1] = joined;
      continue;
    }
    out.push(line);
  }
  return out;
}

export function normalizeCliCommandLinesFromList(list?: string[]): string[] {
  if (!Array.isArray(list) || list.length === 0) return [];
  return normalizeCliCommandLines(list.join('\n'));
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
    deviceProfile: resolveHmsSwitchDeviceProfile({
      vendor: spec.vendor,
      currentProfile: spec.deviceProfile,
      remoteOptions: [],
    }),
    dialTimeout: positiveIntOrDefault(spec.dialTimeout, HMS_SWITCH_DEFAULT_DIAL_TIMEOUT),
    execTimeout: positiveIntOrDefault(spec.execTimeout, HMS_SWITCH_DEFAULT_EXEC_TIMEOUT),
    infoCommandsText: commandsToLines(spec.infoCommands),
    interfaceCommandsText: commandsToLines(normalizeCliCommandLinesFromList(spec.interfaceCommands)),
    performanceCommandsText: commandsToLines(spec.performanceCommands),
    vlanCommandsText: commandsToLines(spec.vlanCommands),
    corsAllowedOriginsText: Array.isArray(spec.corsAllowedOrigins)
      ? spec.corsAllowedOrigins.join('\n')
      : '*',
    screenLengthCmd: spec.screenLengthCmd != null ? String(spec.screenLengthCmd) : '',
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
    deviceProfile:
      normalizeHmsDeviceProfileValue(values.deviceProfile) ||
      inferHmsDeviceProfileFromVendor(values.vendor),
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

  spec.screenLengthCmd = String(values.screenLengthCmd ?? '').trim();

  return spec;
}
