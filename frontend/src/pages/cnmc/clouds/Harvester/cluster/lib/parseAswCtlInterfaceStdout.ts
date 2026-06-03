/**
 * ASW-CTL 接口探测回显解析（纯函数，供 PhysicalSwitchesSection / 面板模态使用）。
 *
 * 输入：`GET /v1/switch/interfaces` 返回体中 `lines[].stdout` 的 CLI 表格文本。
 * 支持 Broadcom 系「DETECTED-VALUES / CONFIGURED-VALUES」多列表头 +分隔线样式，
 * 以及 WOS 风格 Interface / Status 表（见 deployment/docs/specs/api/ASW-CTL简明完整说明.md §5.4）。
 */

import type { AswCtlProbeLine } from 'services/harvester/types/aswProbe';
import { sanitizeAswCliStdout } from './sanitizeAswCliStdout';

export type ParsedSwitchPort = {
  name: string;
  status: string;
  speed?: string;
  /** Admin Status列，如 en / dis */
  adminStatus?: string;
  autoNegotiation?: string;
  detectedSpeedMbps?: string;
  detectedDuplex?: string;
  configuredSpeedMbps?: string;
  configuredDuplex?: string;
  rawLine: string;
};

export type PortStatusKind = 'up' | 'down' | 'admin' | 'unknown';

export function classifyPortStatus(status: string): PortStatusKind {
  const s = String(status || '')
    .toLowerCase()
    .trim();
  if (!s) return 'unknown';
  if (/\badmin\w*\s*down\b|\badmindown\b/i.test(s)) return 'admin';
  if (/\bup\b/.test(s) && !/\bdown\b/.test(s)) return 'up';
  if (/\bdown\b/.test(s)) return 'down';
  if (s === 'up') return 'up';
  if (s === 'down') return 'down';
  return 'unknown';
}

function splitTableRow(line: string): string[] {
  return line
    .split(/\s{2,}|\t+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** H3C Comware `display interface brief`：NULL、Vlan、环回、REG 等为逻辑口，前面板不展示 */
export function isH3cStyleLogicalInterfaceName(name: string): boolean {
  const n = String(name || '').trim();
  if (!n) return true;
  if (/^NULL\d*$/i.test(n)) return true;
  if (/^Vlan/i.test(n)) return true;
  if (/^Loop(?:Back)?\d*$/i.test(n)) return true;
  if (/^InLoop\d*$/i.test(n)) return true;
  if (/^REG\d*$/i.test(n)) return true;
  if (/^M-GE/i.test(n)) return true;
  if (/^Tunnel\d*$/i.test(n)) return true;
  if (/^Vsi-/i.test(n)) return true;
  if (/^(?:RAGG|BAGG|Bridge-Aggregation)\d/i.test(n)) return true;
  return false;
}

/** 华为 VRP `display interface brief` 等：NULL、Vlanif、环回等为逻辑口，前面板不展示 */
export function isHuaweiStyleLogicalInterfaceName(name: string): boolean {
  const n = String(name || '').trim();
  if (!n) return true;
  if (/^NULL\d*$/i.test(n)) return true;
  if (/^Vlanif\d+/i.test(n)) return true;
  if (/^LoopBack\d*$/i.test(n)) return true;
  if (/^InLoopBack/i.test(n)) return true;
  if (/^Virtual-Template/i.test(n)) return true;
  if (/^MTunnel/i.test(n)) return true;
  if (/^Tunnel\d*$/i.test(n)) return true;
  if (/^Nve\d*$/i.test(n)) return true;
  if (/^Register-Tunnel/i.test(n)) return true;
  return false;
}

function isHuaweiDisplayInterfaceBriefHeaderLine(trimmed: string): boolean {
  return /^\s*Interface\s+\S+\s+Protocol\b/i.test(trimmed) && /\bPHY\b/i.test(trimmed);
}

/**
 * 华为 `display interface brief`：表头含 Interface / PHY / Protocol，数据行首列为接口名。
 * @returns `null` 表示非该版式；`[]` 表示已识别表头但无物理口；非空为解析结果。
 */
function tryParseHuaweiDisplayInterfaceBriefTable(stdout: string): ParsedSwitchPort[] | null {
  if (!stdout || typeof stdout !== 'string') return null;
  const lines = stdout.replace(/\r\n/g, '\n').split('\n');
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (isHuaweiDisplayInterfaceBriefHeaderLine(t)) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) return null;

  const ports: ParsedSwitchPort[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    if (/^[-=─]+$/.test(trimmed)) continue;
    if (/^<[\w-]+>$/i.test(trimmed)) continue;

    const parts = splitTableRow(trimmed);
    if (parts.length < 3) continue;
    const name = parts[0]!;
    const phy = parts[1]!;
    const protocol = parts[2]!;
    if (/^interface$/i.test(name)) continue;
    if (/^(PHY|Protocol|InUti|OutUti|inErrors|outErrors)$/i.test(name)) continue;
    if (!name || !phy) continue;

    if (isHuaweiStyleLogicalInterfaceName(name)) continue;

    const rest = parts.slice(3);
    const speed = rest.length ? rest.join(' ') : undefined;
    const status = `${phy} / ${protocol}`.replace(/\s+/g, ' ').trim();

    ports.push({
      name,
      status,
      speed: speed || undefined,
      rawLine: trimmed,
    });
  }
  return ports;
}

function isH3cRouteModeBriefHeaderLine(trimmed: string): boolean {
  return /^\s*Interface\s+Link\b/i.test(trimmed) && /\bProtocol\b/i.test(trimmed);
}

function isH3cBridgeModeBriefHeaderLine(trimmed: string): boolean {
  return (
    /^\s*Interface\s+Link\b/i.test(trimmed) &&
    /\bSpeed\b/i.test(trimmed) &&
    /\bPVID\b/i.test(trimmed)
  );
}

function isLikelyH3cPhysicalInterfaceName(name: string): boolean {
  const n = String(name || '').trim();
  if (!n || isH3cStyleLogicalInterfaceName(n)) return false;
  if (/^(?:GE|XGE|FGE|HGE|WGE|TGE|TE|FE|Ethernet|GigabitEthernet|Ten-GigabitEthernet|FortyGigE|HundredGigE)/i.test(n)) {
    return true;
  }
  return /\d+\/\d+(?:\/\d+)?(?:\.\d+)?$/.test(n);
}

function parseH3cRouteModeDataRow(
  trimmed: string,
): { name: string; link: string; protocol: string; rest: string } | null {
  const m = trimmed.match(
    /^(\S+)\s+(UP|DOWN|ADM(?:\([^)]*\))?|Stby(?:\([^)]*\))?)\s+(UP(?:\(s\))?|DOWN(?:\([^)]*\))?|UP|DOWN|--)\s*(.*)$/i,
  );
  if (!m) return null;
  return {
    name: m[1]!,
    link: m[2]!,
    protocol: m[3]!,
    rest: (m[4] || '').trim(),
  };
}

/**
 * H3C Comware V7 `display interface brief`（路由模式 Interface/Link/Protocol，或桥模式 Interface/Link/Speed/PVID）。
 * @returns `null` 表示非该版式；`[]` 表示已识别表头但无物理口；非空为解析结果。
 */
function tryParseH3cDisplayInterfaceBriefTable(stdout: string): ParsedSwitchPort[] | null {
  if (!stdout || typeof stdout !== 'string') return null;
  const normalized = stdout.replace(/\r\n/g, '\n');
  if (!/Brief information on interfaces/i.test(normalized) && !/^\s*Interface\s+Link\b/im.test(normalized)) {
    return null;
  }

  const lines = normalized.split('\n');
  let headerIdx = -1;
  let bridgeMode = false;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (isH3cBridgeModeBriefHeaderLine(t)) {
      headerIdx = i;
      bridgeMode = true;
      break;
    }
    if (isH3cRouteModeBriefHeaderLine(t)) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) return null;

  const ports: ParsedSwitchPort[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    if (/^[-=─]+$/.test(trimmed)) continue;
    if (/^<[\w-]+>$/i.test(trimmed)) continue;
    if (/^Brief information on interfaces/i.test(trimmed)) continue;
    if (/^Link:\s*ADM/i.test(trimmed)) continue;
    if (/^Protocol:\s*\(s\)/i.test(trimmed)) continue;
    if (/^The brief information of interfaces in bridge mode/i.test(trimmed)) continue;

    if (bridgeMode) {
      const parts = splitTableRow(trimmed);
      if (parts.length < 2) continue;
      const name = parts[0]!;
      if (/^interface$/i.test(name)) continue;
      if (!isLikelyH3cPhysicalInterfaceName(name)) continue;

      const link = parts[1] || '';
      const speed = parts[2] || '';
      const duplex = parts[3] || '';
      const speedSummary = [speed, duplex].filter(Boolean).join(' ').trim();
      ports.push({
        name,
        status: link.replace(/\s+/g, ' ').trim(),
        speed: speedSummary || undefined,
        rawLine: trimmed,
      });
      continue;
    }

    const routeRow = parseH3cRouteModeDataRow(trimmed);
    if (!routeRow) continue;
    const { name, link, protocol, rest } = routeRow;
    if (!isLikelyH3cPhysicalInterfaceName(name)) continue;

    const status = `${link} / ${protocol}`.replace(/\s+/g, ' ').trim();
    ports.push({
      name,
      status,
      speed: rest || undefined,
      rawLine: trimmed,
    });
  }
  return ports;
}

/**
 * H3C 桥模式数据行（无表头），常见于 `display interface brief | include XGE`。
 * 列：Interface Link Speed Duplex Type PVID Description
 */
function parseH3cBridgeModeBriefDataRow(trimmed: string): {
  name: string;
  link: string;
  speed: string;
  duplex: string;
  description: string;
} | null {
  const m = trimmed.match(
    /^((?:GE|XGE|FGE|HGE|WGE|TGE|TE|FE|Ethernet|GigabitEthernet|Ten-GigabitEthernet|FortyGigE|HundredGigE)\S*)\s+(UP|DOWN|ADM)\s+(\S+)\s+(\S+)\s+([AT])\s+(\d+)\s*(.*)$/i,
  );
  if (!m) return null;
  const type = m[5]!;
  const pvid = m[6]!;
  const tail = String(m[7] || '').trim();
  const description = [type, pvid, tail].filter(Boolean).join(' ').trim();
  return {
    name: m[1]!,
    link: m[2]!,
    speed: m[3]!,
    duplex: m[4]!,
    description,
  };
}

/**
 * 解析无表头的 H3C 过滤 brief 行（`| include GE/XGE` 等）。
 * @returns `null` 表示未识别到任何物理口行；非空为解析结果。
 */
function tryParseH3cFilteredBriefLines(stdout: string): ParsedSwitchPort[] | null {
  if (!stdout || typeof stdout !== 'string') return null;
  const lines = stdout.replace(/\r\n/g, '\n').split('\n');
  const ports: ParsedSwitchPort[] = [];

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    if (/^<[\w-]+>$/i.test(trimmed)) continue;
    if (/^display interface/i.test(trimmed)) continue;
    if (/^screen-length/i.test(trimmed)) continue;
    if (/^Copyright/i.test(trimmed) || /^\*/.test(trimmed)) continue;
    if (/^[-=─]+$/.test(trimmed)) continue;

    const row = parseH3cBridgeModeBriefDataRow(trimmed);
    if (!row) continue;
    if (!isLikelyH3cPhysicalInterfaceName(row.name)) continue;

    const speedSummary = [row.speed, row.duplex].filter(Boolean).join(' ').trim();
    ports.push({
      name: row.name,
      status: row.link.replace(/\s+/g, ' ').trim(),
      speed: speedSummary || undefined,
      rawLine: trimmed,
    });
  }

  return ports.length > 0 ? ports : null;
}

/** CLI 输出是否可能被分页截断（H3C 等设备不支持 `screen-length 0 temporary` 时常见） */
export function isSwitchInterfaceStdoutLikelyTruncated(stdout: string): boolean {
  const hint = getSwitchInterfaceStdoutParseHint(stdout);
  return (
    hint === 'h3c-screen-length' ||
    hint === 'pipe-include-failed' ||
    hint === 'pipe-cmd-split' ||
    hint === 'paged-more' ||
    hint === 'truncated-table' ||
    hint === 'empty-after-cmd'
  );
}

/** 机房拓扑端口解析失败时的可读原因（供 Alert description） */
export function getSwitchInterfaceStdoutParseHint(stdout: string): string {
  if (!stdout || typeof stdout !== 'string' || !stdout.trim()) {
    return 'empty';
  }

  const normalized = stdout.replace(/\r\n/g, '\n');

  if (/screen-length/i.test(normalized) && /Unrecognized command found/i.test(normalized)) {
    return 'h3c-screen-length';
  }
  if (
    /\| include\b/i.test(normalized) &&
    /Unrecognized command found/i.test(normalized) &&
    !/^\s*(?:GE|XGE|FGE)\d+\/\d+\/\d+\s+(?:UP|DOWN|ADM)\s+/im.test(normalized)
  ) {
    return 'pipe-include-failed';
  }
  if (
    /display interface brief/i.test(normalized) &&
    /^\s*<[\w-]+>\s*include\b/im.test(normalized) &&
    !/^\s*(?:GE|XGE|FGE)\d+\/\d+\/\d+\s+(?:UP|DOWN|ADM)\s+/im.test(normalized)
  ) {
    return 'pipe-cmd-split';
  }
  if (/----\s*More\s*----/i.test(normalized)) {
    return 'paged-more';
  }

  const parsed = parseInterfaceStatusStdout(stdout);
  if (parsed.length > 0) return 'ok';

  const hasInterfaceBriefCmd = /display interface brief/i.test(normalized);
  const hasH3cBrief = /Brief information on interfaces/i.test(normalized);
  const hasTableHeader =
    hasH3cBrief ||
    /^\s*Interface\s+Link\b/im.test(normalized) ||
    normalized.split('\n').some((l) => isHuaweiDisplayInterfaceBriefHeaderLine(l.trim()));

  if (hasTableHeader) {
    return 'truncated-table';
  }

  if (hasInterfaceBriefCmd) {
    const tail = normalized.split(/display interface brief/i).pop() || '';
    if (tail.replace(/\s+/g, '').length < 40) {
      return 'empty-after-cmd';
    }
  }

  return 'unknown-format';
}

export function formatSwitchInterfaceStdoutParseHint(hint: ReturnType<typeof getSwitchInterfaceStdoutParseHint>): string {
  switch (hint) {
    case 'h3c-screen-length':
      return 'H3C 设备不支持当前关分页命令（常见为 screen-length 0 temporary），分页未关闭，display interface brief 未返回完整端口表。请在 Tower「集群 → 物理交换机」编辑该交换机，于「高级（可选）」填写关分页命令（如 screen-length disable），留空则使用设备模板默认；保存后重新同步。';
    case 'pipe-cmd-split':
      return '接口命令被拆成多条执行（常见：interfaceCommands 里 `| include` 单独一行，或集群 HSM 按 `|` 截断）。请把整条命令写在同一行，例如 display interface brief | include XGE，保存后重新探测同步。';
    case 'pipe-include-failed':
      return '设备不识别带 | include 的接口命令，或关分页未关闭导致过滤失败。请确认已配置 screen-length disable，命令超时 ≥60 秒；若仍失败可暂用 display interface brief（全表，较慢）并提高命令超时。';
    case 'paged-more':
    case 'truncated-table':
      return '接口探测输出被分页截断（输出中含 ---- More ---- 或仅有表头无数据行）。请在 HSM/ASW-CTL 中关闭 CLI 分页后重新同步。';
    case 'empty-after-cmd':
      return 'display interface brief 已执行但未返回端口表（可能 SSH 超时或分页未关闭）。请检查 HSM/ASW-CTL 设备模板与 SSH 超时设置后重新同步。';
    case 'empty':
      return '无接口探测 stdout，请先在物理交换机页执行同步。';
    default:
      return '当前输出格式可能非已知表格样式。若设备为 H3C，请确认 HSM 已关闭分页且 display interface brief 能返回完整 Interface/Link/Protocol 表。';
  }
}

/**
 * 从端口名解析 `槽/子槽/端口` 三元组，供前面板排序与奇偶排布。
 * 支持纯 `1/0/5`（Broadcom）与 `GigabitEthernet0/0/12`（华为）等后缀形式。
 */
export function parseSwitchPortSlotTriplet(name: string): [number, number, number] | null {
  const s = String(name || '').trim();
  if (!s) return null;
  const direct = s.match(/^(\d+)\/(\d+)\/(\d+)$/);
  if (direct) {
    return [parseInt(direct[1]!, 10), parseInt(direct[2]!, 10), parseInt(direct[3]!, 10)];
  }
  const tail = s.match(/(\d+)\/(\d+)\/(\d+)\s*$/);
  if (tail) {
    return [parseInt(tail[1]!, 10), parseInt(tail[2]!, 10), parseInt(tail[3]!, 10)];
  }
  return null;
}

/**
 * 嵌入前面板：按 `槽/子槽/口` 排序，**不做** 千兆/万兆分区；口性能以单槽行内数据（`speed`、检测/配置 Mbps 等）展示。
 */
export function sortParsedSwitchPortsBySlot(ports: ParsedSwitchPort[]): ParsedSwitchPort[] {
  return [...ports].sort((a, b) => {
    const ka = parseSwitchPortSlotTriplet(a.name) ?? [9999, 9999, 9999];
    const kb = parseSwitchPortSlotTriplet(b.name) ?? [9999, 9999, 9999];
    for (let i = 0; i < 3; i++) {
      if (ka[i] !== kb[i]) return ka[i] - kb[i];
    }
    return 0;
  });
}

/**
 * Broadcom 等：含 `--------+------+` 分隔线，数据行以 `槽/槽/口` 开头，检测速率列为数字或 `-`。
 */
function parseBroadcomStylePortTable(stdout: string): ParsedSwitchPort[] {
  if (!stdout || typeof stdout !== 'string') return [];
  const lines = stdout.replace(/\r\n/g, '\n').split('\n');
  let sepIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.length >= 12 && /^[\-+]+$/.test(t)) {
      sepIdx = i;
      break;
    }
  }
  if (sepIdx < 0) return [];

  const ports: ParsedSwitchPort[] = [];
  for (let i = sepIdx + 1; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    if (/^[\-+]+$/.test(trimmed)) continue;

    const parts = trimmed.split(/\s+/);
    if (parts.length < 4) continue;
    if (!/^\d+\/\d+\/\d+$/.test(parts[0]!)) continue;

    const port = parts[0]!;
    const admin = parts[1] || '';
    const autoNego = parts[2] || '';
    const detSpeed = parts[3] || '';
    const detDuplex = parts[4] || '';
    const cfgSpeed = parts.length > 7 ? parts[7]! : '';
    const cfgDuplex = parts.length > 8 ? parts[8]! : '';

    const adminDown = /^dis(able)?$/i.test(admin) || String(admin).toLowerCase() === 'dis';
    const detNumeric =
      detSpeed !== '-' &&
      detSpeed !== '' &&
      Number.isFinite(Number(detSpeed));

    let status: string;
    if (adminDown) status = 'admin down';
    else if (detNumeric) status = 'up';
    else status = 'down';

    const speedParts: string[] = [];
    if (detSpeed && detSpeed !== '-') {
      speedParts.push(`检测 ${detSpeed} Mbps${detDuplex && detDuplex !== '-' ? ` ${detDuplex}` : ''}`);
    }
    if (cfgSpeed && cfgSpeed !== '-') {
      speedParts.push(
        `配置 ${cfgSpeed}${cfgDuplex && cfgDuplex !== '-' ? ` ${cfgDuplex}` : ''}`,
      );
    }

    ports.push({
      name: port,
      status,
      speed: speedParts.length ? speedParts.join(' · ') : undefined,
      adminStatus: admin,
      autoNegotiation: autoNego,
      detectedSpeedMbps: detSpeed !== '-' ? detSpeed : undefined,
      detectedDuplex: detDuplex !== '-' ? detDuplex : undefined,
      configuredSpeedMbps: cfgSpeed !== '-' ? cfgSpeed : undefined,
      configuredDuplex: cfgDuplex !== '-' ? cfgDuplex : undefined,
      rawLine: trimmed,
    });
  }
  return ports;
}

/** 解析含 Interface / Status 表头的表格块 */
export function parseInterfaceStatusStdout(stdout: string): ParsedSwitchPort[] {
  if (!stdout || typeof stdout !== 'string') return [];
  stdout = sanitizeAswCliStdout(stdout);

  const broadcom = parseBroadcomStylePortTable(stdout);
  if (broadcom.length > 0) return broadcom;

  const huaweiBrief = tryParseHuaweiDisplayInterfaceBriefTable(stdout);
  if (huaweiBrief !== null) return huaweiBrief;

  const h3cBrief = tryParseH3cDisplayInterfaceBriefTable(stdout);
  if (h3cBrief !== null && h3cBrief.length > 0) return h3cBrief;

  const h3cFiltered = tryParseH3cFilteredBriefLines(stdout);
  if (h3cFiltered !== null && h3cFiltered.length > 0) return h3cFiltered;

  if (h3cBrief !== null) return h3cBrief;

  const lines = stdout.replace(/\r\n/g, '\n').split('\n');
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (/interface/i.test(l) && /status/i.test(l)) {
      headerIdx = i;
      break;
    }
  }
  const ports: ParsedSwitchPort[] = [];
  if (headerIdx >= 0) {
    for (let i = headerIdx + 1; i < lines.length; i++) {
      const rawLine = lines[i];
      const trimmed = rawLine.trim();
      if (!trimmed || /^[-=─]+$/.test(trimmed)) continue;
      const parts = splitTableRow(trimmed);
      if (parts.length < 2) continue;
      const [name, status, ...rest] = parts;
      if (/^interface$|^status$|^speed$/i.test(name)) continue;
      if (/^interface$/i.test(String(name)) && /^PHY$/i.test(String(status))) continue;
      if (!name || !status) continue;
      if (isHuaweiStyleLogicalInterfaceName(String(name))) continue;
      const speed = rest.length ? rest.join(' ') : undefined;
      ports.push({
        name,
        status,
        speed: speed || undefined,
        rawLine: trimmed,
      });
    }
    return ports;
  }

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || /^[-=─]+$/.test(trimmed)) continue;
    const parts = splitTableRow(trimmed);
    if (parts.length < 2) continue;
    const [a, b, c] = parts;
    if (/^interface$/i.test(a) && /^status$/i.test(b)) continue;
    if (/^interface$/i.test(a) && /^PHY$/i.test(b)) continue;
    if (/^interface$/i.test(a)) continue;
    if (/^(PHY|Protocol|InUti|OutUti|inErrors|outErrors)$/i.test(a)) continue;
    if (/^[\w./:-]+$/.test(a) && a.length <= 64 && b.length <= 32) {
      if (isHuaweiStyleLogicalInterfaceName(a)) continue;
      ports.push({
        name: a,
        status: b,
        speed: c,
        rawLine: trimmed,
      });
    }
  }
  return ports;
}

/** 从探测行 record 中取接口探测 stdout（优先匹配含端口表特征的块） */
export function extractInterfacesStdoutFromRecord(record: {
  interfaces?: { lines?: AswCtlProbeLine[] } | null;
}): { stdout: string; command?: string } | null {
  const lines = record?.interfaces?.lines;
  if (!Array.isArray(lines) || lines.length === 0) return null;

  type Scored = { stdout: string; command?: string; score: number };
  let best: Scored | null = null;

  for (const line of lines) {
    const cmd = String(line?.command || '');
    const out = line?.stdout;
    if (typeof out !== 'string' || !out.trim()) continue;

    let score = 0;
    if (/DETECTED-VALUES/i.test(out) && /CONFIGURED-VALUES/i.test(out)) score += 4;
    if (/^\s*Interface\s+\S+\s+Protocol\b/im.test(out) && /\bPHY\b/.test(out)) score += 5;
    if (/Brief information on interfaces/i.test(out) && /^\s*Interface\s+Link\b/im.test(out)) score += 5;
    if (/^\s*(?:GE|XGE|FGE|HGE|WGE|TGE)\d+\/\d+\/\d+\s+(?:UP|DOWN|ADM)\s+/im.test(out)) score += 5;
    if (/^\s*(?:GE|XGE|FGE|HGE|WGE|TGE)\d+\/\d+\/\d+\s+/im.test(out)) score += 4;
    if (/^\s*\d+\/\d+\/\d+\s+/m.test(out)) score += 3;
    if (/[\-+]{12,}/.test(out) && /\+/.test(out)) score += 2;
    if (/Chas\//i.test(out) && /Port/i.test(out)) score += 2;
    if (/interface/i.test(cmd)) score += 1;

    if (!best || score > best.score) {
      best = { stdout: out, command: cmd || undefined, score };
    }
  }

  if (best && best.score > 0) {
    return { stdout: best.stdout, command: best.command };
  }

  for (const line of lines) {
    const cmd = String(line?.command || '');
    const out = line?.stdout;
    if (typeof out === 'string' && out.trim() && /interface/i.test(cmd)) {
      return { stdout: out, command: cmd };
    }
  }
  const first = lines[0];
  if (first && typeof first.stdout === 'string' && first.stdout.trim()) {
    return {
      stdout: first.stdout,
      command: first.command ? String(first.command) : undefined,
    };
  }
  return null;
}
