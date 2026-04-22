/**
 * 从 ASW-CTL 交换机「接口表」+ 物理机 `hardware` HMS LLDP 行，联合得到「口 ↔ 对端机 / 本端网口」连接列表。
 * 与 `lldpSwitchLinkUtils.findNodeLldpForSwitchPortRecord` 同一套对端管理地址 + 端口名匹配规则。
 */
import {
  extractInterfacesStdoutFromRecord,
  isHuaweiStyleLogicalInterfaceName,
  parseInterfaceStatusStdout,
} from '../../cluster/lib/parseAswCtlInterfaceStdout';
import { parseSwitchDisplayNameFromInfoLines, switchRecordManagementHost } from '../../cluster/lib/physicalSwitchRecordUtils';
import { findNodeLldpForSwitchPortRecord } from './lldpSwitchLinkUtils';

export type HsmLldpPhysicalLink = {
  id: string;
  switchHost: string;
  switchTitle: string;
  port: string;
  nodeName: string;
  localIf: string;
};

export function buildHsmLldpPhysicalLinks(
  clusterNodes: any[] | null | undefined,
  switchItems: any[] | null | undefined,
): HsmLldpPhysicalLink[] {
  const nodes = Array.isArray(clusterNodes) ? clusterNodes : [];
  const swList = Array.isArray(switchItems) ? switchItems : [];
  const out: HsmLldpPhysicalLink[] = [];
  let seq = 0;
  for (const sw of swList) {
    const host = switchRecordManagementHost(sw);
    if (!host || host === '—') continue;
    const ifBlob = extractInterfacesStdoutFromRecord(sw);
    if (!ifBlob?.stdout) continue;
    const ports = parseInterfaceStatusStdout(ifBlob.stdout);
    const swTitle = String(parseSwitchDisplayNameFromInfoLines(sw?.info?.lines) || '').trim() || host;
    for (const p of ports) {
      if (!p?.name || isHuaweiStyleLogicalInterfaceName(p.name)) continue;
      const hit = findNodeLldpForSwitchPortRecord(nodes, sw, p);
      if (!hit) continue;
      seq += 1;
      out.push({
        id: `lldp-${host.replace(/[^a-zA-Z0-9.-]/g, '_')}-${String(p.name).replace(/[^a-zA-Z0-9/._-]/g, '_')}-${hit.nodeName}-${seq}`,
        switchHost: host,
        switchTitle: swTitle,
        port: p.name,
        nodeName: hit.nodeName,
        localIf: hit.localInterface,
      });
    }
  }
  return out;
}
