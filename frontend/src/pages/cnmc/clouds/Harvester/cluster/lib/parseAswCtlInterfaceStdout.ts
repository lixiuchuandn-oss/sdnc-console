/**
 * ASW-CTL 接口探测回显解析（纯函数，供 PhysicalSwitchesSection / 面板模态使用）。
 *
 * 输入：`GET /v1/switch/interfaces` 返回体中 `lines[].stdout` 的 CLI 表格文本。
 * 支持 Broadcom 系「DETECTED-VALUES / CONFIGURED-VALUES」多列表头 +分隔线样式，
 * 以及 WOS 风格 Interface / Status 表（见 deployment/docs/specs/api/ASW-CTL简明完整说明.md §5.4）。
 */

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

  const broadcom = parseBroadcomStylePortTable(stdout);
  if (broadcom.length > 0) return broadcom;

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
      if (!name || !status) continue;
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
    if (/^[\w./:-]+$/.test(a) && a.length <= 64 && b.length <= 32) {
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
  interfaces?: { lines?: any[] } | null;
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
