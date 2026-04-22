/**
 * 交换机（ASW-CTL 单口）与物理机 HMS LLDP 行的关联。
 *
 * **联合键**（与 LLDP 标准一致、且与 Tower 现有一致）：
 * 1. **对端管理地址**（如 `Management Address_IPv4`）= 机柜/物理交换机表里的 `switchRecordManagementHost(ref)`，即 refKey 常用管理 IP。
 * 2. **对端端口名**（`Port Description` / `Port ID_Ifname`）= `ParsedSwitchPort.name`（`display interface` 等拉到的接口名）。
 *
 * 二者同时命中即认定「本 ASW 口 = 对端此 LLDP 邻接」。无管理地址 TLV 时仅端口名会误判，可后续用 System Name + Chassis 作弱补全（本模块不自动猜）。
 */
import { switchRecordManagementHost } from '../../cluster/lib/physicalSwitchRecordUtils';
import type { ParsedSwitchPort } from '../../cluster/lib/parseAswCtlInterfaceStdout';
import {
  extractHmsLldpRows,
  pickLldpLocalInterface,
  pickLldpManagementIpv4,
  pickLldpPeerPort,
} from './lldpHmsRowFields';

const IPV4_CIDR = /\b((?:\d{1,3}\.){3}\d{1,3})(?:\/\d+)?\b/;

/**
 * 与机柜/交换机行比对前：去 zone id；若串中含 IPv4（可带 /掩码 或前后缀）则只取四段点分地址再比。
 */
export function normalizeManagementAddressForLink(s: string): string {
  const raw = String(s || '')
    .trim()
    .split('%')[0]
    .trim();
  const m = raw.match(IPV4_CIDR);
  if (m) return m[1]!.toLowerCase();
  return raw.toLowerCase();
}

const SLOT_RE = /(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)/;

function normPortName(t: string): string {
  return t
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/^gi(\d)/i, 'gigabitethernet$1')
    .replace(/^ge(\d)/i, 'gigabitethernet$1');
}

/** 取串中**最后一个**槽位三元组（接口长描述里首个三元组常非本口，如 Chas 前缀） */
function rightmostSlotTriplet(s: string): string | null {
  const re = new RegExp(SLOT_RE.source, 'g');
  let last: string | null = null;
  for (;;) {
    const m = re.exec(s);
    if (!m) break;
    last = m[0]!.replace(/\s/g, '');
  }
  return last;
}

/**
 * ASW 接口名 与 LLDP 端口描述是否同一口（如 GE0/0/1 vs GigabitEthernet0/0/1）。
 * 仅：全名规范化相等，或**槽位三元组**一致；**不再用 includes**，否则
 * `GigabitEthernet0/0/10` 会错误包含与 `0/0/1` 可比的子串、或与 `GigabitEthernet0/0/1` 发生子串真包含误判。
 */
export function portNamesLogicallyEqual(lldpPortName: string, aswPortName: string): boolean {
  const a = normPortName(lldpPortName);
  const b = normPortName(aswPortName);
  if (!a || !b) return false;
  if (a === b) return true;

  const sa = rightmostSlotTriplet(a) ?? a.match(SLOT_RE)?.[0]?.replace(/\s/g, '') ?? null;
  const sb = rightmostSlotTriplet(b) ?? b.match(SLOT_RE)?.[0]?.replace(/\s/g, '') ?? null;
  if (sa && sb && sa === sb) return true;
  return false;
}

/**
 * 判断一条 LLDP 行是否描述「连接在指定管理地址交换机的、指定 ifName 的端口」。
 */
export function lldpRowMatchesAswSwitchPort(
  lldpRow: Record<string, string>,
  switchManagementHost: string,
  aswIfName: string,
): boolean {
  const wantIp = normalizeManagementAddressForLink(switchManagementHost);
  if (!wantIp) return false;
  const lldpIp = pickLldpManagementIpv4(lldpRow);
  if (!lldpIp || normalizeManagementAddressForLink(lldpIp) !== wantIp) return false;

  const lldpPort = pickLldpPeerPort(lldpRow);
  if (!lldpPort || !aswIfName) return false;
  return portNamesLogicallyEqual(lldpPort, aswIfName);
}

/**
 * 在节点列表中查找：哪台机、哪条 `hardware.switch` 行 对应「该交换机、该口」。
 */
export function findNodeLldpForAswPort(
  clusterNodes: any[] | null | undefined,
  switchManagementHost: string,
  aswPortName: string,
):
  | {
      node: any;
      nodeName: string;
      lldpRow: Record<string, string>;
      localInterface: string;
    }
  | null {
  const list = Array.isArray(clusterNodes) ? clusterNodes : [];
  for (const node of list) {
    const rows = extractHmsLldpRows(node?.hardware);
    for (const row of rows) {
      if (lldpRowMatchesAswSwitchPort(row, switchManagementHost, aswPortName)) {
        const nodeName = String(node?.metadata?.name || node?.name || '').trim();
        return {
          node,
          nodeName,
          lldpRow: row,
          localInterface: pickLldpLocalInterface(row).trim() || '—',
        };
      }
    }
  }
  return null;
}

/**
 * 从交换机 record 取管理地址 + 从端口对象取 ifName，一次调用 `findNodeLldpForAswPort`。
 * 供 `EmbeddedSwitchPortPanelBody` 单槽 或 机柜下挂联动 使用。
 */
export function findNodeLldpForSwitchPortRecord(
  clusterNodes: any[] | null | undefined,
  switchRecord: any | null | undefined,
  port: Pick<ParsedSwitchPort, 'name'>,
) {
  if (!switchRecord || !port?.name) return null;
  const host = switchRecordManagementHost(switchRecord);
  if (!host || host === '—') return null;
  return findNodeLldpForAswPort(clusterNodes, host, String(port.name).trim());
}
