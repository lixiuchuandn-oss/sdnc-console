/**
 * 物理交换机表格行 / ASW-CTL 实例 record 的字段读取（Harvester · cluster · ASW-CTL）。
 */
import type { HmsSwitchCr } from 'services/harvester/types/cluster';
import type {
  AswCtlProbeLine,
  AswCtlSwitchProbeRecord,
} from 'services/harvester/types/aswProbe';

export function switchRecordManagementHost(r: AswCtlSwitchProbeRecord | null | undefined): string {
  const h =
    r?.info?.host ||
    r?.interfaces?.host ||
    r?.performance?.host ||
    r?.vlans?.host ||
    '';
  const s = h != null ? String(h).trim() : '';
  return s || '—';
}

/** Switch CR 声明的管理地址（primaryHost 优先） */
export function hmsSwitchCrManagementHost(cr: HmsSwitchCr | null | undefined): string {
  const spec = cr?.spec || {};
  return String(spec.primaryHost || spec.hosts?.[0] || '').trim();
}

/** 按管理地址在 ASW-CTL 探测列表中匹配单台交换机实例 */
export function matchAswProbeRecordByCr(
  items: AswCtlSwitchProbeRecord[] | undefined,
  cr: HmsSwitchCr | null | undefined,
): AswCtlSwitchProbeRecord | null {
  if (!Array.isArray(items) || !cr) return null;
  const host = hmsSwitchCrManagementHost(cr);
  if (!host) return null;
  for (const sw of items) {
    const probeHost = switchRecordManagementHost(sw);
    if (probeHost !== '—' && probeHost === host) return sw;
    const direct = String(sw?.info?.host || sw?.switchHost || sw?.host || '').trim();
    if (direct && direct === host) return sw;
  }
  return null;
}

export function switchRecordDeviceProfile(r: AswCtlSwitchProbeRecord | null | undefined): string {
  const p =
    r?.info?.device_profile ||
    r?.interfaces?.device_profile ||
    r?.performance?.device_profile ||
    r?.vlans?.device_profile ||
    '';
  return p ? String(p).trim() : '';
}

/** 从 /v1/switch/info 的 lines[].stdout 抽取交换机展示名（WOS Name、Host/System Name、华为 sysname 等；威努特不用整段 Description 作名称）。 */
export function parseSwitchDisplayNameFromInfoLines(lines: AswCtlProbeLine[] | undefined): string {
  if (!Array.isArray(lines)) return '';
  for (const ln of lines) {
    const out = typeof ln?.stdout === 'string' ? ln.stdout : '';
    if (!out.trim()) continue;

    // 威努特 WOS system dump：优先 Name:（如 DRAGON），避免把 Description 整段版本说明当作设备名
    if (/winicssec|WES\d+/i.test(out)) {
      const wosName = out.match(/Name:\s*([^\n,]+)/i);
      if (wosName?.[1]) {
        const s = wosName[1].replace(/\s+/g, ' ').trim();
        if (s && !/^Unknown$/i.test(s)) return s.slice(0, 160);
      }
    }

    const desc = out.match(/(?:^|\n)\s*Description:\s*([^\n\r]+)/i);
    if (desc?.[1]) {
      if (/winicssec|WES\d+/i.test(out)) {
        // 有 Name: 时已返回；无 Name: 时设备名交给上层 record.name，不在此用整段/型号冒充名称
        continue;
      }
      const s = desc[1].replace(/\s+/g, ' ').trim();
      if (s) return s.slice(0, 160);
    }
    const hostn = out.match(/(?:^|\n)\s*Host(?:name)?:\s*(\S+)/i);
    if (hostn?.[1]) {
      const s = hostn[1].trim();
      if (s) return s.slice(0, 160);
    }
    const sysName = out.match(/(?:^|\n)\s*System Name\s*:\s*([^\n\r]+)/i);
    if (sysName?.[1]) {
      const s = sysName[1].replace(/\s+/g, ' ').trim();
      if (s) return s.slice(0, 160);
    }
    /** 华为 / 华三类：`display current-configuration | include sysname` → 行首 `sysname <name>` */
    const cnSysname = out.match(/(?:^|\n)\s*sysname\s+(\S+)/i);
    if (cnSysname?.[1]) {
      const s = cnSysname[1].trim();
      if (s) return s.slice(0, 160);
    }
  }
  return '';
}

/** Switch CR 厂商是否为 H3C（与表单枚举一致，大小写不敏感） */
export function isH3cSwitchVendor(vendor?: string | null): boolean {
  return /^H3C$/i.test(String(vendor ?? '').trim());
}

function parseH3cBoardTypeFromInfoLines(lines: AswCtlProbeLine[] | undefined): string {
  if (!Array.isArray(lines)) return '';
  for (const ln of lines) {
    const out = typeof ln?.stdout === 'string' ? ln.stdout : '';
    if (!out.trim()) continue;
    const h3cBoardType = out.match(/(?:^|\n)\s*BOARD\s+TYPE\s*[:：]\s*(\S+)/i);
    if (h3cBoardType?.[1]) return h3cBoardType[1].trim().slice(0, 120);
  }
  return '';
}

function parseH3cSwitchLineModelFromInfoLines(lines: AswCtlProbeLine[] | undefined): string {
  if (!Array.isArray(lines)) return '';
  for (const ln of lines) {
    const out = typeof ln?.stdout === 'string' ? ln.stdout : '';
    if (!out.trim()) continue;
    const h3c = out.match(/(?:^|[\r\n])\s*H3C\s+(\S+)\s+(?:Switch|Router|Routing Switch)\b/i);
    if (h3c?.[1]) return h3c[1].trim().slice(0, 120);
  }
  return '';
}

export type ParseSwitchProductModelOptions = {
  /** Switch CR spec.vendor；为 H3C 时优先用基本信息 stdout 中的 BOARD TYPE */
  vendor?: string | null;
};

/**
 * 从 info 各命令 stdout 抽取硬件型号（如华为 `display version` 中的 `HUAWEI S5720S-28P-LI-AC`；
 * H3C 且厂商为 H3C 时用 `BOARD TYPE`；威努特 WOS 的 `WES6300 V2R01C02`）。
 */
export function parseSwitchProductModelFromInfoLines(
  lines: AswCtlProbeLine[] | undefined,
  options?: ParseSwitchProductModelOptions,
): string {
  const vendor = options?.vendor;

  if (isH3cSwitchVendor(vendor)) {
    return (
      parseH3cBoardTypeFromInfoLines(lines) ||
      parseH3cSwitchLineModelFromInfoLines(lines) ||
      ''
    );
  }

  if (!Array.isArray(lines)) return '';
  const vendorNorm = String(vendor ?? '').trim();
  for (const ln of lines) {
    const out = typeof ln?.stdout === 'string' ? ln.stdout : '';
    if (!out.trim()) continue;

    if (/winicssec|WES\d+/i.test(out)) {
      const d = out.match(/(?:^|\n)\s*Description:\s*([^\n\r]+)/i);
      if (d?.[1]) {
        const m = d[1].match(/(WES[0-9A-Za-z-]+)(?:\s+([A-Z0-9.]+))?(?=::)/i);
        if (m?.[1]) {
          return m[2] ? `${m[1]} ${m[2]}`.slice(0, 120) : m[1].slice(0, 120);
        }
        const m2 = d[1].match(/(WES[0-9A-Za-z-]+)/i);
        if (m2?.[1]) return m2[1].slice(0, 120);
      }
    }

    const huaweiRouting = out.match(
      /(?:^|[\r\n])\s*HUAWEI\s+(\S+)\s+Routing Switch\b/i,
    );
    if (huaweiRouting?.[1]) {
      const m = huaweiRouting[1].trim();
      if (m && !/^VRP$/i.test(m)) return m.slice(0, 120);
    }

    if (!vendorNorm) {
      const h3cLine = parseH3cSwitchLineModelFromInfoLines([ln]);
      if (h3cLine) return h3cLine;
    }

    const ciscoModel = out.match(/(?:^|[\r\n])\s*Model\s+Number\s*:\s*(\S+)/i);
    if (ciscoModel?.[1]) return ciscoModel[1].trim().slice(0, 120);
  }
  return '';
}

export function isWinicssecSwitchRecord(r: AswCtlSwitchProbeRecord | null | undefined): boolean {
  return /winicssec|winics|wos/i.test(switchRecordDeviceProfile(r));
}

/**
 * H3C Comware 交换机：`device_profile` 或 info/performance 回显特征。
 * 与 Winicssec / 华为互斥判定（调用方按需组合）。
 */
export function isH3cSwitchRecord(r: AswCtlSwitchProbeRecord | null | undefined): boolean {
  if (!r) return false;
  if (isWinicssecSwitchRecord(r)) return false;
  const p = switchRecordDeviceProfile(r);
  if (p && /h3c/i.test(p)) return true;
  const blob = switchRecordStdoutsBlob(r);
  if (!blob.trim()) return false;
  if (/H3C Comware/i.test(blob)) return true;
  if (/New H3C Technologies/i.test(blob)) return true;
  if (/(?:^|\n)\s*BOARD\s+TYPE\s*[:：]/im.test(blob)) return true;
  if (/^<H3C[\w-]*>/im.test(blob)) return true;
  return false;
}

/** 从 record 各探测块 stdout 拼成一段文本，供厂商指纹判断（不持久化）。 */
function switchRecordStdoutsBlob(r: AswCtlSwitchProbeRecord): string {
  if (!r || typeof r !== 'object') return '';
  const parts: string[] = [];
  for (const key of ['info', 'interfaces', 'performance', 'vlans'] as const) {
    const lines = r[key]?.lines;
    if (!Array.isArray(lines)) continue;
    for (const ln of lines) {
      const out = typeof ln?.stdout === 'string' ? ln.stdout : '';
      if (out.trim()) parts.push(out);
    }
  }
  return parts.join('\n');
}

/**
 * 华为交换机（VRP）：`device_profile` 或各命令回显中含 HUAWEI / VRP 等特征。
 * 与 Winicssec 互斥：已判为 Winicssec 则不再视为华为。
 */
export function isHuaweiSwitchRecord(r: AswCtlSwitchProbeRecord | null | undefined): boolean {
  if (!r) return false;
  if (isWinicssecSwitchRecord(r)) return false;
  const p = switchRecordDeviceProfile(r);
  if (p && /huawei|\bvrp\b/i.test(p)) return true;
  const blob = switchRecordStdoutsBlob(r);
  if (!blob.trim()) return false;
  if (/<HUAWEI>/i.test(blob)) return true;
  if (/\bHUAWEI\s+\S+\s+Routing Switch\b/i.test(blob)) return true;
  if (/\bHuawei Versatile Routing Platform\b/i.test(blob)) return true;
  if (/\bCopyright\s+.*\bHuawei\b/i.test(blob)) return true;
  return false;
}

/** 与物理交换机详情抽屉 / 交换机端口面板（HSM）中 performance 解析一致，供机房拓扑等复用 */
export type PerformanceMetricsParsed = {
  cpu?: string;
  memory?: string;
  temperature?: string;
  fan?: string;
  psu?: string;
};

function mergeCpuMemoryFromStdout(text: string, out: PerformanceMetricsParsed) {
  const t = text;
  if (!t.trim()) return;

  if (!out.cpu) {
    const cpuRes =
      t.match(/(?:^|\n)\s*CPU\s*[:：]\s*([^\n\r]+)/i) ||
      t.match(/(?:^|\n)\s*CPU\s+Utilization\s*[:：]\s*([^\n\r]+)/i) ||
      t.match(/(?:^|\n)\s*Processor\s*[:：]\s*([^\n\r]+)/i) ||
      t.match(/(?:^|\n)\s*Cpu\s+usage\s*[:：]\s*([^\n\r]+)/i) ||
      t.match(/(?:^|\n)\s*CPU\s+usage\s*[:：]\s*([^\n\r]+)/i) ||
      t.match(/(?:^|\n)\s*CPU\s+(\d+\s*%)\s*(?:\n|$)/i);
    if (cpuRes?.[1]) {
      out.cpu = cpuRes[1].replace(/\s+/g, ' ').trim().slice(0, 80);
    }
  }
  if (!out.memory) {
    const memRes =
      t.match(/(?:^|\n)\s*Memory\s*[:：]\s*([^\n\r]+)/i) ||
      t.match(/(?:^|\n)\s*Mem(?:ory)?\s*[:：]\s*([^\n\r]+)/i) ||
      t.match(/(?:^|\n)\s*Memory\s+Usage\s*[:：]\s*([^\n\r]+)/i) ||
      t.match(/(?:^|\n)\s*Mem\s+Utilization\s*[:：]\s*([^\n\r]+)/i) ||
      t.match(/(?:^|\n)\s*MEM(?:ORY)?\s+UTIL\S*\s*[:：]\s*([^\n\r]+)/i) ||
      t.match(/(?:^|\n)\s*Memory\s+(\d+\s*%)\s*(?:\n|$)/i);
    if (memRes?.[1]) {
      out.memory = memRes[1].replace(/\s+/g, ' ').trim().slice(0, 80);
    }
  }

  /** 华为 VRP 常见：`display cpu-usage` / `display memory` */
  if (!out.cpu) {
    const hwCpu =
      t.match(/(?:^|\n)\s*System CPU Using Percentage\s*[:：]\s*(\d+)\s*%/i) ||
      t.match(/(?:^|\n)\s*CPU utilization for five seconds\s*[:：]\s*(\d+)\s*%/i) ||
      t.match(/(?:^|\n)\s*CPU utilization for 5 seconds\s*[:：]\s*(\d+)\s*%/i);
    if (hwCpu?.[1]) out.cpu = `${hwCpu[1].trim()}%`;
  }
  if (!out.memory) {
    const hwMem =
      t.match(/(?:^|\n)\s*Memory Using Percentage Is\s*[:：]\s*([\d.]+)\s*%/i) ||
      t.match(/(?:^|\n)\s*Memory utilization\s*[:：]\s*([\d.]+)\s*%/i) ||
      t.match(/(?:^|\n)\s*Memory Used Percentage\s*[:：]\s*([\d.]+)\s*%/i);
    if (hwMem?.[1]) out.memory = `${hwMem[1].trim()}%`;
  }

  if (!out.cpu) {
    const tabCpu = t.match(/(?:^|\n)\s*CPU\s+(\d+)\b/);
    if (tabCpu?.[1]) out.cpu = `${tabCpu[1]}%`;
  }
  if (!out.memory) {
    const tabMem =
      t.match(/(?:^|\n)\s*Memory\s+(\d+)\b/im) || t.match(/(?:^|\n)\s*Mem\s+(\d+)\b/im);
    if (tabMem?.[1]) out.memory = `${tabMem[1]}%`;
  }
}

/** H3C Comware：`display cpu-usage` / `display memory`（仅 H3C 分支调用，避免影响华为等） */
function mergeH3cPerformanceFromStdout(text: string, out: PerformanceMetricsParsed) {
  const t = text;
  if (!t.trim()) return;

  if (!out.cpu) {
    const h3cCpu5s = t.match(/(?:^|\n)\s*(\d+(?:\.\d+)?)%\s+in\s+last\s+5\s+seconds/i);
    if (h3cCpu5s?.[1]) {
      out.cpu = `${h3cCpu5s[1].trim()}%`;
    }
  }

  if (!out.memory) {
    const h3cMem = t.match(/(?:^|\n)\s*Mem:\s+(\d+)\s+(\d+)\s+(\d+)/i);
    if (h3cMem?.[1] && h3cMem?.[2]) {
      const total = parseInt(h3cMem[1], 10);
      const used = parseInt(h3cMem[2], 10);
      if (total > 0 && Number.isFinite(used)) {
        out.memory = `${((used / total) * 100).toFixed(1)}%`;
      }
    }
  }
}

function mergeTemperatureFromStdout(text: string, out: PerformanceMetricsParsed) {
  if (out.temperature) return;
  const t = text;
  const colon =
    t.match(/(?:^|\n)\s*Temp(?:erature)?:\s*([^\n\r]+)/i) ||
    t.match(/(?:^|\n)\s*Temp:\s*([^\n\r]+)/i) ||
    t.match(/(?:^|\n)\s*Current temperature\s*[:：]\s*(\d+)/i);
  if (colon?.[1]) {
    const v = colon[1].trim();
    out.temperature = /^\d+$/.test(v) ? `${v}°C` : v.slice(0, 80);
    return;
  }
  const lines = t.split(/\r?\n/);
  const headIdx = lines.findIndex((l) => /Current/i.test(l) && /Range/i.test(l));
  if (headIdx >= 0) {
    for (let i = headIdx + 1; i < lines.length; i++) {
      const row = lines[i];
      if (!row?.trim() || /^[\s|+:-]+$/.test(row)) continue;
      const m = row.match(/^\s*[\w/]+\s+(\d+)\s+\d+\s+to\s+\d+/i);
      if (m?.[1]) {
        out.temperature = `${m[1]}°C`;
        return;
      }
    }
  }
  const fallback = t.match(/(?:^|\n)\s*[\w/]+\s+(\d+)\s+\d+\s+to\s+\d+/i);
  if (fallback?.[1]) out.temperature = `${fallback[1]}°C`;
}

function mergeFanFromStdout(text: string, out: PerformanceMetricsParsed) {
  if (out.fan) return;
  const m = text.match(/(?:^|\n)\s*\d+\/\d+\s+\d+\s+(\w+)\s+(\d+)/m);
  if (m?.[2]) {
    out.fan = `${m[1]} · ${m[2]} RPM`.slice(0, 96);
    return;
  }
  const line = text.split(/\r?\n/).find((lineStr: string) => lineStr.trim());
  if (line) out.fan = line.trim().slice(0, 96);
}

function mergePsuFromStdout(text: string, out: PerformanceMetricsParsed) {
  if (out.psu) return;
  const m = text.match(/(?:^|\n)\s*\d+\/\d+\s+(\d+)\s+(\w+)\s+(UP|DOWN)\b/im);
  if (m?.[1]) {
    out.psu = `${m[2]} ${m[1]}W ${m[3]}`.slice(0, 96);
    return;
  }
  const line = text.split(/\r?\n/).find((lineStr: string) => lineStr.trim());
  if (line) out.psu = line.trim().slice(0, 96);
}

function parsePerformanceMetrics(
  lines: AswCtlProbeLine[] | undefined,
  options?: { h3c?: boolean },
): PerformanceMetricsParsed {
  const out: PerformanceMetricsParsed = {};
  if (!Array.isArray(lines)) return out;
  for (const ln of lines) {
    const cmd = String(ln?.command || '').toLowerCase();
    const stdout = typeof ln?.stdout === 'string' ? ln.stdout : '';
    if (!stdout.trim()) continue;

    if (options?.h3c) mergeH3cPerformanceFromStdout(stdout, out);
    else mergeCpuMemoryFromStdout(stdout, out);
    /* 不限定 command 名：health dump 等输出里也可能含 Current/Range 温度表 */
    mergeTemperatureFromStdout(stdout, out);

    if (/fan/.test(cmd)) {
      mergeFanFromStdout(stdout, out);
    }
    if (/power/.test(cmd)) {
      mergePsuFromStdout(stdout, out);
    }
  }
  return out;
}

/** 合并 performance；若仍缺 CPU/内存，再从 info 各命令 stdout 里扫一遍 */
export function buildPerformanceMetrics(record: AswCtlSwitchProbeRecord | null | undefined): PerformanceMetricsParsed {
  const h3c = isH3cSwitchRecord(record);
  const out = parsePerformanceMetrics(record?.performance?.lines, { h3c });

  if (h3c && record?.performance?.lines && (!out.cpu || !out.memory)) {
    for (const ln of record.performance.lines) {
      const stdout = typeof ln?.stdout === 'string' ? ln.stdout : '';
      if (!stdout.trim()) continue;
      mergeH3cPerformanceFromStdout(stdout, out);
      if (out.cpu && out.memory) break;
    }
  }

  if (record?.info?.lines && (!out.cpu || !out.memory)) {
    for (const ln of record.info.lines) {
      const stdout = typeof ln?.stdout === 'string' ? ln.stdout : '';
      if (!stdout.trim()) continue;
      if (h3c) mergeH3cPerformanceFromStdout(stdout, out);
      else mergeCpuMemoryFromStdout(stdout, out);
      if (out.cpu && out.memory) break;
    }
  }
  return out;
}

/**
 * 从 CLI 解析出的 CPU/内存展示串中提取 0–100 的利用率（如「21%」、表里裸数字「21」）。
 */
export function parseSwitchUtilizationPercent(value?: string): number {
  if (!value || !String(value).trim()) return 0;
  const s = String(value).trim();
  const withPct = s.match(/(\d+(?:\.\d+)?)\s*%/);
  if (withPct) {
    const n = parseFloat(withPct[1]);
    return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0;
  }
  const leadNum = s.match(/^(\d+(?:\.\d+)?)\b/);
  if (leadNum) {
    const n = parseFloat(leadNum[1]);
    if (Number.isFinite(n) && n >= 0 && n <= 100) return n;
  }
  return 0;
}
