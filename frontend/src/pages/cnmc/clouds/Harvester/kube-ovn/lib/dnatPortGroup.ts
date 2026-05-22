import { TOWER_IO_DNAT_PORT_GROUP_ANNOTATION } from './kubeOvnSubnetConstants';

export const DNAT_PORT_MIN = 1;
export const DNAT_PORT_MAX = 65535;
/** 与后端批量创建上限一致 */
export const DNAT_BATCH_PORT_MAX_COUNT = 100;

/** 创建表单：公网/内部端口范围说明（起止可不同，个数须相同） */
export const DNAT_PORT_RANGE_TOOLTIP =
  '范围端口个数须相同，按序号一对一映射；起止可不同，如公网 1-10 对应内部 2-11（1→2、2→3 … 10→11）。同一公网 IP、协议下公网端口（含范围）不可与已有规则重叠';

export const DNAT_PORT_COUNT_MISMATCH_MSG =
  '公网端口与内部端口的个数须一致（如公网 1-10 为 10 个，内部可为 2-11；不可为 1-5）';

/** 两端均已解析为合法端口/范围时，校验映射条数一致 */
export function dnatPortRangeCountsMatch(
  external: unknown,
  internal: unknown,
): { ok: true } | { ok: false; message: string } {
  const ext = parseDnatPortInput(external);
  const int = parseDnatPortInput(internal);
  if (!ext.ok || !int.ok) return { ok: true };
  if (ext.count !== int.count) {
    return { ok: false, message: DNAT_PORT_COUNT_MISMATCH_MSG };
  }
  return { ok: true };
}

export type ParsedDnatPorts =
  | { ok: true; start: number; end: number; count: number }
  | { ok: false; message: string };

/** 解析单端口或范围：80、1-10；可选第二字段作为范围结束端口 */
export function parseDnatPortInput(portInput: unknown, endInput?: unknown): ParsedDnatPorts {
  const parseOne = (v: unknown): number | null => {
    const s = String(v ?? '').trim();
    if (!s || !/^\d+$/.test(s)) return null;
    const n = parseInt(s, 10);
    if (!Number.isFinite(n) || n < DNAT_PORT_MIN || n > DNAT_PORT_MAX) return null;
    return n;
  };

  const main = String(portInput ?? '').trim();
  const rangeInField = /^(\d+)\s*-\s*(\d+)$/.exec(main);
  if (rangeInField) {
    const start = parseInt(rangeInField[1], 10);
    const end = parseInt(rangeInField[2], 10);
    if (start > end) {
      return { ok: false, message: '端口范围起始不能大于结束' };
    }
    const count = end - start + 1;
    if (count > DNAT_BATCH_PORT_MAX_COUNT) {
      return { ok: false, message: `端口映射数量不能超过 ${DNAT_BATCH_PORT_MAX_COUNT} 条` };
    }
    return { ok: true, start, end, count };
  }

  const start = parseOne(portInput);
  if (start == null) {
    return { ok: false, message: `端口须为 ${DNAT_PORT_MIN}-${DNAT_PORT_MAX} 的整数，或范围如 1-10` };
  }

  const endRaw =
    endInput != null && String(endInput).trim() !== '' ? parseOne(endInput) : null;
  if (endInput != null && String(endInput).trim() !== '' && endRaw == null) {
    return { ok: false, message: `结束端口须为 ${DNAT_PORT_MIN}-${DNAT_PORT_MAX} 的整数` };
  }
  const end = endRaw ?? start;
  if (start > end) {
    return { ok: false, message: '端口范围起始不能大于结束' };
  }
  const count = end - start + 1;
  if (count > DNAT_BATCH_PORT_MAX_COUNT) {
    return { ok: false, message: `端口映射数量不能超过 ${DNAT_BATCH_PORT_MAX_COUNT} 条` };
  }
  return { ok: true, start, end, count };
}

export function formatDnatPortRange(start: number, end: number): string {
  if (start === end) return String(start);
  return `${start}-${end}`;
}

export function formatDnatPortsFromMembers(
  members: any[],
  field: 'externalPort' | 'internalPort',
): string {
  const ports = members
    .map((m) => Number(String(m?.spec?.[field] ?? m?.status?.[field] ?? '').trim()))
    .filter((p) => Number.isFinite(p))
    .sort((a, b) => a - b);
  if (!ports.length) return '-';
  if (ports.length === 1) return String(ports[0]);
  const min = ports[0];
  const max = ports[ports.length - 1];
  if (max - min + 1 === ports.length) return formatDnatPortRange(min, max);
  return ports.join(', ');
}

export type DnatDisplayRow = any & {
  _dnatGrouped?: boolean;
  _dnatPortGroup?: string;
  _dnatGroupMembers?: any[];
};

/** 列表：带 port-group 注解的多条合并为一条展示 */
export function groupDnatRulesForDisplay(rules: any[]): DnatDisplayRow[] {
  const items = Array.isArray(rules) ? rules : [];
  const singles: DnatDisplayRow[] = [];
  const groups = new Map<string, any[]>();

  for (const r of items) {
    const gid = String(r?.metadata?.annotations?.[TOWER_IO_DNAT_PORT_GROUP_ANNOTATION] ?? '').trim();
    if (!gid) {
      singles.push(r);
      continue;
    }
    if (!groups.has(gid)) groups.set(gid, []);
    groups.get(gid)!.push(r);
  }

  const grouped: DnatDisplayRow[] = [];
  for (const [gid, members] of groups) {
    const sorted = [...members].sort(
      (a, b) =>
        Number(String(a?.spec?.externalPort ?? '').trim()) -
        Number(String(b?.spec?.externalPort ?? '').trim()),
    );
    const primary = sorted[0];
    grouped.push({
      ...primary,
      _dnatGrouped: true,
      _dnatPortGroup: gid,
      _dnatGroupMembers: sorted,
    });
  }

  return [...singles, ...grouped];
}

export function dnatRuleEipAndProtocol(rule: any): { eip: string; proto: string } {
  return {
    eip: String(rule?.spec?.ovnEip ?? rule?.status?.ovnEip ?? '').trim(),
    proto: String(rule?.spec?.protocol ?? rule?.status?.protocol ?? '')
      .trim()
      .toLowerCase(),
  };
}

export function dnatRuleExternalPortNumber(rule: any): number | null {
  const n = Number(String(rule?.spec?.externalPort ?? rule?.status?.externalPort ?? '').trim());
  return Number.isFinite(n) ? n : null;
}

/**
 * 同一公网 IP + 协议下，新公网端口区间与已有 DNAT（含批量拆分的多条）是否冲突。
 * 返回所有重叠的公网端口号（已排序去重）。
 */
export function findDnatExternalPortConflicts(
  existingRules: any[],
  eipName: string,
  proto: string,
  newStart: number,
  newEnd: number,
): number[] {
  const eip = String(eipName ?? '').trim();
  const pr = String(proto ?? '')
    .trim()
    .toLowerCase();
  const occupied = new Set<number>();
  for (const r of Array.isArray(existingRules) ? existingRules : []) {
    const { eip: re, proto: rp } = dnatRuleEipAndProtocol(r);
    if (re !== eip || rp !== pr) continue;
    const p = dnatRuleExternalPortNumber(r);
    if (p != null) occupied.add(p);
  }
  const conflicts: number[] = [];
  for (let p = newStart; p <= newEnd; p++) {
    if (occupied.has(p)) conflicts.push(p);
  }
  return conflicts;
}

export function formatDnatExternalPortConflictMessage(
  conflicts: number[],
  newStart: number,
  newEnd: number,
): string {
  if (!conflicts.length) return '';
  const newRange = formatDnatPortRange(newStart, newEnd);
  const portText =
    conflicts.length <= 15
      ? conflicts.join('、')
      : `${conflicts.slice(0, 15).join('、')} 等 ${conflicts.length} 个`;
  return `公网 IP、协议下公网端口与已有 DNAT 规则存在重叠（新规则 ${newRange}，冲突端口：${portText}）`;
}

