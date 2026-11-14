/**
 * 解析 clish `do show vrrp instances` / `do show vrrp groups` 输出
 *（keepalived 风格，与设备 Console 截图一致）。
 */

export type ParsedVrrpInstance = {
  instance: number | null;
  vrid: number | null;
  syncGroup: number | null;
  state: string;
  srcIp: string | null;
  priority: number | null;
  interface: string | null;
  virtualIps: string[];
  /** 该实例每一条 VIP 均为 scope global set（或行尾 set） */
  vipInstalled: boolean;
  /** 任一条 VIP 已挂载（用于备端脑裂） */
  anyVipInstalled: boolean;
};

export type ParsedVrrpScript = {
  name: string;
  command: string | null;
  status: string | null;
};

export type ParsedVrrpGroup = {
  groupId: number | null;
  state: string;
  memberInstances: number[];
  trackedScripts: string[];
  scriptName: string | null;
  scriptCommand: string | null;
  scriptStatus: string | null;
  /** 从 Script Command 末尾解析出的 track 目标（多为网关 IP） */
  trackGateway: string | null;
};

/** 从 keepalived Script Command 行提取 track 目标 IP（取最后一个 IPv4） */
export function extractTrackGatewayFromCommand(cmd: string | null | undefined): string | null {
  const ips = [...String(cmd || '').matchAll(/\b((?:\d{1,3}\.){3}\d{1,3})\b/g)].map((m) => m[1]!);
  return ips.length ? ips[ips.length - 1]! : null;
}

const asNum = (v: string | undefined): number | null => {
  if (v == null || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function splitBlocks(raw: string, headerRe: RegExp): string[] {
  const text = String(raw || '').replace(/\r\n/g, '\n');
  const blocks: string[] = [];
  let current: string[] = [];
  for (const line of text.split('\n')) {
    if (headerRe.test(line) && current.length) {
      blocks.push(current.join('\n'));
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.some((l) => l.trim())) blocks.push(current.join('\n'));
  return blocks.filter((b) => headerRe.test(b));
}

const SCRIPTS_HEADER_RE = /-{3,}<\s*VRRP Scripts\s*>-{3,}/i;

function splitGroupsAndScripts(raw: string): { groupsPart: string; scriptsPart: string } {
  const text = String(raw || '').replace(/\r\n/g, '\n');
  const idx = text.search(SCRIPTS_HEADER_RE);
  if (idx < 0) return { groupsPart: text, scriptsPart: '' };
  return { groupsPart: text.slice(0, idx), scriptsPart: text.slice(idx) };
}

export function parseVrrpScriptBlocks(raw: string): ParsedVrrpScript[] {
  const blocks = splitBlocks(raw, /^\s*VRRP Script\s*=/i);
  return blocks
    .map((block) => {
      const name = String(/VRRP Script\s*=\s*(\S+)/i.exec(block)?.[1] || '').trim();
      const command = String(/Command\s*=\s*(.+)$/im.exec(block)?.[1] || '').trim() || null;
      const status = String(/^\s*Status\s*=\s*(\S+)/im.exec(block)?.[1] || '').trim() || null;
      return { name, command, status };
    })
    .filter((s) => s.name);
}

function parseTrackedScriptNames(block: string): string[] {
  const header = /Tracked scripts\s*=\s*\d+/i.exec(block);
  if (!header || header.index == null) return [];
  const after = block.slice(header.index + header[0].length);
  const section = after.split(SCRIPTS_HEADER_RE)[0] || '';
  const names: string[] = [];
  for (const line of section.split('\n')) {
    if (/^\s*(Using smtp|VRRP Script|VRRP Sync|VRRP instances|VRRP member|Command\s*=|Status\s*=|Interval\s*=)/i.test(line)) {
      break;
    }
    const m = /^\s*(\S+)(?:\s+weight\s+[-+]?\d+)?\s*$/i.exec(line);
    if (!m) continue;
    names.push(m[1]!);
  }
  return [...new Set(names)];
}

function vipLineInstalled(line: string): boolean {
  return /\bscope\s+global\s+set\b/i.test(line) || /\bset\s*$/i.test(line.trim());
}

export function parseVrrpInstancesShow(raw: string): ParsedVrrpInstance[] {
  const blocks = splitBlocks(raw, /^\s*VRRP Instance\s*=/i);
  return blocks.map((block) => {
    const instance = asNum(/VRRP Instance\s*=\s*(\d+)/i.exec(block)?.[1]);
    // Virtual Router ID 与 keepalived 实例序号不是同一字段，缺行时不得回退到 instance
    const vrid = asNum(/Virtual Router ID\s*=\s*(\d+)/i.exec(block)?.[1]);
    const syncGroup = asNum(/Sync group\s*=\s*(\d+)/i.exec(block)?.[1]);
    const state = String(/^\s*State\s*=\s*(\S+)/im.exec(block)?.[1] || '').trim();
    const srcIp = String(/Using src_ip\s*=\s*(\S+)/i.exec(block)?.[1] || '').trim() || null;
    const priority = asNum(/Priority\s*=\s*(\d+)/i.exec(block)?.[1]);
    const virtualIps: string[] = [];
    let vipSetCount = 0;
    let iface: string | null = null;
    for (const line of block.split('\n')) {
      const vip = /^\s*((?:\d{1,3}\.){3}\d{1,3}\/\d{1,2})\s*(?:dev\s+(\S+))?/i.exec(line);
      if (!vip) continue;
      virtualIps.push(vip[1]!);
      if (vip[2]) iface = vip[2];
      if (vipLineInstalled(line)) vipSetCount += 1;
    }
    const vipCount = virtualIps.length;
    return {
      instance,
      vrid,
      syncGroup,
      state,
      srcIp,
      priority,
      interface: iface,
      virtualIps,
      vipInstalled: vipCount > 0 && vipSetCount === vipCount,
      anyVipInstalled: vipSetCount > 0,
    };
  });
}

function rollupScriptStatuses(statuses: Array<string | null>): string | null {
  if (statuses.some((s) => !s)) return null;
  const present = statuses as string[];
  if (!present.length) return null;
  const bad = present.find((s) => !/^good$/i.test(s));
  return bad || present[0] || null;
}

export function parseVrrpGroupsShow(raw: string): ParsedVrrpGroup[] {
  const { groupsPart, scriptsPart } = splitGroupsAndScripts(raw);
  const catalog = parseVrrpScriptBlocks(scriptsPart);
  const blocks = splitBlocks(groupsPart, /^\s*VRRP Sync Group\s*=/i);
  return blocks.map((block) => {
    const head = /VRRP Sync Group\s*=\s*(\d+)\s*,\s*(\S+)/i.exec(block);
    const groupId = asNum(head?.[1]);
    const state = String(head?.[2] || '').trim();
    const memberInstances: number[] = [];
    // 只收「VRRP member instances = N」之后、独立成行的实例号，避免把计数 N 当成 vrid
    const memberHeader = /VRRP member instances\s*=\s*\d+/i.exec(block);
    const afterHeader =
      memberHeader && memberHeader.index != null
        ? block.slice(memberHeader.index + memberHeader[0].length)
        : '';
    const memberSection = afterHeader.split(/Using smtp/i)[0] || '';
    for (const line of memberSection.split('\n')) {
      const only = /^\s*(\d+)\s*$/.exec(line);
      if (!only) continue;
      const n = Number(only[1]);
      if (Number.isFinite(n) && n > 0 && n < 256) memberInstances.push(n);
    }
    const inlineScripts = parseVrrpScriptBlocks(block);
    const tracked = parseTrackedScriptNames(block);
    const names = tracked.length ? tracked : inlineScripts.map((s) => s.name).filter(Boolean);
    const inlineStatus = String(/^\s*Status\s*=\s*(\S+)/im.exec(block)?.[1] || '').trim() || null;
    const inlineCommand = String(/Command\s*=\s*(.+)$/im.exec(block)?.[1] || '').trim() || null;
    const lookup = (name: string): ParsedVrrpScript | undefined =>
      catalog.find((s) => s.name === name) || inlineScripts.find((s) => s.name === name);
    let scriptStatus: string | null = null;
    let scriptCommand: string | null = null;
    if (names.length) {
      const resolved = names.map((n) => lookup(n));
      const statuses = names.map((n, i) => {
        const found = resolved[i]?.status || null;
        if (found) return found;
        if (names.length === 1 && inlineStatus) return inlineStatus;
        return null;
      });
      scriptStatus = rollupScriptStatuses(statuses);
      const commands = resolved
        .map((s, i) => s?.command || (names.length === 1 && i === 0 ? inlineCommand : null))
        .filter((c): c is string => Boolean(c));
      scriptCommand = commands[0] || (names.length === 1 ? inlineCommand : null);
    } else if (inlineStatus) {
      scriptStatus = inlineStatus;
      scriptCommand = inlineCommand;
    }
    const scriptName = names[0] || inlineScripts[0]?.name || null;
    return {
      groupId,
      state,
      memberInstances: [...new Set(memberInstances)],
      trackedScripts: names,
      scriptName,
      scriptCommand,
      scriptStatus,
      trackGateway: extractTrackGatewayFromCommand(scriptCommand),
    };
  });
}

export function hasVrrpInstancesShow(raw: string | undefined | null): boolean {
  return /VRRP Instance\s*=/i.test(String(raw || ''));
}

export function hasVrrpGroupsShow(raw: string | undefined | null): boolean {
  return /VRRP Sync Group\s*=/i.test(String(raw || ''));
}

export function hasVrrpLiveShow(raw: string | undefined | null): boolean {
  return hasVrrpInstancesShow(raw) || hasVrrpGroupsShow(raw);
}
