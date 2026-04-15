/**
 * ASW-CTL VLAN 探测回显解析：`GET /v1/switch/vlans` 的 `lines[].stdout`。
 * 兼容常见「VLAN / Name / Status / Ports」表及含 `槽/槽/口` 成员端口的行。
 */

export type ParsedVlanMembership = {
  vlanId: string;
  /** 展示名；未知时为 VLAN {id} */
  name: string;
  /** 成员接口名（原始片段，可能含范围如 1/1/1-1/1/8） */
  ports: string[];
  rawLine?: string;
};

/** 交换机全局下 VLAN ID 唯一：多行回显可能解析出重复 id，合并为一条后再展示（一块 VLAN = 一个 id）。 */
function isGenericVlanName(name: string, idKey: string): boolean {
  const m = name.trim().match(/^VLAN\s+(\d{1,4})$/i);
  if (m) return String(Number(m[1])) === idKey;
  return !name.trim();
}

export function mergeParsedVlansByVlanId(rows: ParsedVlanMembership[]): ParsedVlanMembership[] {
  const map = new Map<string, ParsedVlanMembership>();

  for (const row of rows) {
    if (!validVlanId(row.vlanId)) continue;
    const idKey = String(Number(row.vlanId));
    const nextPorts = row.ports.filter(Boolean);
    const existing = map.get(idKey);

    if (!existing) {
      map.set(idKey, {
        vlanId: idKey,
        name: (row.name || `VLAN ${idKey}`).trim() || `VLAN ${idKey}`,
        ports: [...new Set(nextPorts)],
        rawLine: row.rawLine,
      });
      continue;
    }

    const seen = new Set(existing.ports);
    for (const p of nextPorts) {
      if (!seen.has(p)) {
        existing.ports.push(p);
        seen.add(p);
      }
    }
    if (isGenericVlanName(existing.name, idKey) && !isGenericVlanName(row.name || '', idKey)) {
      existing.name = (row.name || '').trim();
    }
  }

  return Array.from(map.values()).sort((a, b) => Number(a.vlanId) - Number(b.vlanId));
}

function splitInterfaceTokens(s: string): string[] {
  if (!s?.trim()) return [];
  const normalized = s.replace(/，/g, ',').replace(/；/g, ';');
  const chunks = normalized.split(/[,;]/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  for (const chunk of chunks) {
    for (const t of chunk.split(/\s+/).map((x) => x.trim()).filter(Boolean)) {
      if (
        /\d+\/\d+\/\d+/.test(t) ||
        /^\d+\/\d+\/\d+\s*-\s*\d+\/\d+\/\d+$/.test(t) ||
        /^Eth[\d/]+$/i.test(t) ||
        /^Te[\d/]+$/i.test(t) ||
        /^Gi[\d/]+$/i.test(t) ||
        /^Fa[\d/]+$/i.test(t) ||
        /^Po\d+$/i.test(t)
      ) {
        out.push(t);
      }
    }
  }
  return [...new Set(out)];
}

/** 第二列若是「槽/槽/口」形，多为接口而非 VLAN 名称，应从端口列解析。 */
function tokenLooksLikeInterfacePort(t: string): boolean {
  const s = t.trim();
  if (!s) return false;
  return (
    /^\d+\/\d+\/\d+/.test(s) ||
    /^\d+\/\d+\/\d+\s*-\s*\d+\/\d+\/\d+$/.test(s.replace(/\s/g, '')) ||
    /^Eth[\d/]+$/i.test(s) ||
    /^Te[\d/]+$/i.test(s) ||
    /^Gi[\d/]+$/i.test(s) ||
    /^Fa[\d/]+$/i.test(s) ||
    /^Po\d+$/i.test(s)
  );
}

function validVlanId(id: string): boolean {
  const n = Number(id);
  return Number.isInteger(n) && n >= 1 && n <= 4094;
}

/**
 * 「vlan | port | type | status」类逐行表（常见于双表输出：上表 VLAN 属性，下表 VLAN-端口成员）。
 * 成员关系以第二列 port 为准，同一 VLAN 多行合并为一条。
 */
function parseVlanPortMemberTable(lines: string[]): ParsedVlanMembership[] {
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (/^vlan\b/i.test(l) && /\bport\b/i.test(l)) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) return [];

  let sepIdx = -1;
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();
    if (t.length >= 8 && /^[\-+]+$/.test(t) && /\+/.test(raw)) {
      sepIdx = i;
      break;
    }
  }
  if (sepIdx < 0) return [];

  const portByVlan = new Map<string, string[]>();

  for (let i = sepIdx + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    if (/^[\-+]+$/.test(trimmed)) break;

    const parts = trimmed.split(/\s+/);
    if (parts.length < 2 || !validVlanId(parts[0]!)) continue;

    const portTok = parts[1]!;
    const looksPort =
      tokenLooksLikeInterfacePort(portTok) || /^\d+\/\d+\/\d+/.test(portTok);
    if (!looksPort) continue;

    const vid = String(Number(parts[0]!));
    const list = portByVlan.get(vid) ?? [];
    if (!list.includes(portTok)) list.push(portTok);
    portByVlan.set(vid, list);
  }

  if (portByVlan.size === 0) return [];

  return Array.from(portByVlan.entries())
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([vlanId, ports]) => ({
      vlanId,
      name: `VLAN ${vlanId}`,
      ports,
    }));
}

/**
 * 上表「vlan | type | admin | … | mtu | name」：无 port 列时提取 VLAN 展示名（如 VLAN 1、VCM IPC）。
 */
function parseVlanSummaryNameTable(lines: string[]): Map<string, string> {
  const out = new Map<string, string>();
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (/^vlan\b/i.test(l) && /\bname\b/i.test(l) && !/\bport\b/i.test(l)) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) return out;

  let sepIdx = -1;
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();
    if (t.length >= 8 && /^[\-+]+$/.test(t) && /\+/.test(raw)) {
      sepIdx = i;
      break;
    }
  }
  if (sepIdx < 0) return out;

  for (let i = sepIdx + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    if (/^[\-+]+$/.test(trimmed)) break;

    const parts = trimmed.split(/\s+/);
    if (parts.length < 7 || !validVlanId(parts[0]!)) continue;
    if (!/^\d+$/.test(parts[5]!)) continue;

    const name = parts.slice(6).join(' ').trim() || `VLAN ${parts[0]}`;
    out.set(String(Number(parts[0]!)), name);
  }

  return out;
}

/** Broadcom 系：表头含 VLAN，分隔线 + 数据行首列为 VLAN 号 */
function parseVlanBroadcomStyle(lines: string[]): ParsedVlanMembership[] {
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (/^vlan\b/i.test(l) && (/ports?|member|interface/i.test(l) || /name/i.test(l))) {
      headerIdx = i;
      break;
    }
  }
  let sepIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.length >= 12 && /^[\-+]+$/.test(t) && /\+/.test(lines[i])) {
      sepIdx = i;
      break;
    }
  }
  if (sepIdx < 0 && headerIdx < 0) return [];

  const start = sepIdx >= 0 ? sepIdx + 1 : headerIdx >= 0 ? headerIdx + 1 : 0;
  const rows: ParsedVlanMembership[] = [];

  for (let i = start; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();
    if (!trimmed || /^[\-+]+$/.test(trimmed)) continue;

    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) continue;
    if (!validVlanId(parts[0]!)) continue;

    const vlanId = parts[0]!;
    let name = '';
    let portSliceStart = 1;

    if (/^(active|inactive|sus\w*)$/i.test(parts[1]!)) {
      name = `VLAN ${vlanId}`;
      portSliceStart = 2;
    } else if (tokenLooksLikeInterfacePort(parts[1]!)) {
      name = `VLAN ${vlanId}`;
      portSliceStart = 1;
    } else {
      name = parts[1]!;
      portSliceStart = 2;
      if (parts.length > 2 && /^(active|inactive|sus\w*)$/i.test(parts[2]!)) {
        portSliceStart = 3;
      }
    }

    const rest = parts.slice(portSliceStart).join(' ');
    const ports = splitInterfaceTokens(rest);

    rows.push({
      vlanId,
      name: name || `VLAN ${vlanId}`,
      ports,
      rawLine: trimmed,
    });
  }
  return rows;
}

/** Cisco 风格：VLAN Name Status Ports（Name 与 Status 间多空格） */
function parseVlanCiscoLoose(lines: string[]): ParsedVlanMembership[] {
  const rows: ParsedVlanMembership[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || /^[-=─]+$/.test(trimmed)) continue;

    const cisco = trimmed.match(
      /^(\d{1,4})\s+(.+?)\s+(active|inactive|suspended|act\/lshn)\s+(.+)$/i,
    );
    if (cisco) {
      rows.push({
        vlanId: cisco[1],
        name: cisco[2].trim() || `VLAN ${cisco[1]}`,
        ports: splitInterfaceTokens(cisco[4]),
        rawLine: trimmed,
      });
      continue;
    }

    const simple = trimmed.match(/^(\d{1,4})\s+(\S+)\s+(.+)$/);
    if (simple && /\d+\/\d+\/\d+|Eth\d+/i.test(simple[3])) {
      rows.push({
        vlanId: simple[1],
        name: simple[2],
        ports: splitInterfaceTokens(simple[3]),
        rawLine: trimmed,
      });
    }
  }
  return rows;
}

export function parseVlanMembershipStdout(stdout: string): ParsedVlanMembership[] {
  if (!stdout || typeof stdout !== 'string') return [];
  const lines = stdout.replace(/\r\n/g, '\n').split('\n');

  const portMember = parseVlanPortMemberTable(lines);
  if (portMember.length > 0) {
    const summaryNames = parseVlanSummaryNameTable(lines);
    const enriched = portMember.map((row) => {
      const n = summaryNames.get(row.vlanId);
      return n ? { ...row, name: n } : row;
    });
    return mergeParsedVlansByVlanId(enriched);
  }

  const broadcom = parseVlanBroadcomStyle(lines);
  if (broadcom.length > 0) return mergeParsedVlansByVlanId(broadcom);

  const loose = parseVlanCiscoLoose(lines);
  if (loose.length > 0) return mergeParsedVlansByVlanId(loose);

  return [];
}

export function extractVlansStdoutFromRecord(record: {
  vlans?: { lines?: any[] } | null;
}): { stdout: string; command?: string } | null {
  const lines = record?.vlans?.lines;
  if (!Array.isArray(lines) || lines.length === 0) return null;

  type Scored = { stdout: string; command?: string; score: number };
  let best: Scored | null = null;

  for (const line of lines) {
    const cmd = String(line?.command || '');
    const out = line?.stdout;
    if (typeof out !== 'string' || !out.trim()) continue;

    let score = 0;
    if (/vlan/i.test(out)) score += 2;
    if (/ports?|member|tagged|untagged|interface/i.test(out)) score += 2;
    if (/^\s*\d+\s+/m.test(out)) score += 1;
    if (/[\-+]{10,}/.test(out) && /\+/.test(out)) score += 2;
    if (/vlan/i.test(cmd)) score += 1;

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
    if (typeof out === 'string' && out.trim() && /vlan/i.test(cmd)) {
      return { stdout: out, command: cmd };
    }
  }

  const first = lines.find((l) => typeof l?.stdout === 'string' && l.stdout.trim());
  if (first && typeof first.stdout === 'string') {
    return { stdout: first.stdout, command: first.command ? String(first.command) : undefined };
  }
  return null;
}
