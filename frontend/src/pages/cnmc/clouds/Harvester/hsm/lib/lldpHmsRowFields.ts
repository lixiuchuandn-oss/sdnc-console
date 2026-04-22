/**
 * HMS `hardware.switch` 单行 LLDP 的字段提取（与 embeddedPhysicalNodePanel / 交换机关联 共用，避免规则分叉）。
 */
export function extractHmsLldpRows(hardware: any): Record<string, string>[] {
  const sw = hardware?.switch;
  if (!Array.isArray(sw)) return [];
  return sw.filter((r) => r && typeof r === 'object') as Record<string, string>[];
}

export function lldpKeyLower(k: string): string {
  return k.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** 对端系统名（LLDP System Name） */
export function pickLldpSystemName(row: Record<string, string>): string {
  for (const [k, v] of Object.entries(row)) {
    if (v == null || !String(v).trim()) continue;
    const kl = lldpKeyLower(k);
    if (kl === 'system name' || kl === 'sysname' || (kl.startsWith('system name') && !kl.includes('description')))
      return String(v).trim();
  }
  return '';
}

/** 对端物理/逻辑端口名（Port Description 或 Port ID + Ifname，避开 VLAN/聚合等） */
export function pickLldpPeerPort(row: Record<string, string>): string {
  for (const [k, v] of Object.entries(row)) {
    if (v == null || !String(v).trim()) continue;
    const kl = lldpKeyLower(k);
    if (kl === 'port description' || (kl.includes('port') && kl.includes('description') && !kl.includes('vlan') && !kl.includes('protocol')))
      return String(v).trim();
  }
  for (const [k, v] of Object.entries(row)) {
    if (v == null || !String(v).trim()) continue;
    const kl = lldpKeyLower(k);
    if (kl.includes('port id') && kl.includes('ifname')) return String(v).trim();
  }
  for (const [k, v] of Object.entries(row)) {
    if (v == null || !String(v).trim()) continue;
    const kl = lldpKeyLower(k);
    if (kl === 'port id' && !kl.includes('aggregat')) return String(v).trim();
  }
  return '';
}

export function pickLldpLocalInterface(row: Record<string, string>): string {
  for (const [k, v] of Object.entries(row)) {
    if (v == null || !String(v).trim()) continue;
    if (lldpKeyLower(k) === 'interface') return String(v).trim();
  }
  return '';
}

export function pickLldpSystemDescription(row: Record<string, string>): string {
  for (const [k, v] of Object.entries(row)) {
    if (v == null || !String(v).trim()) continue;
    const kl = lldpKeyLower(k);
    if (kl === 'system description' || (kl.includes('system') && kl.includes('description') && !kl.includes('vlan')))
      return String(v).trim();
  }
  return '';
}

export function pickLldpManagementIpv4(row: Record<string, string>): string {
  for (const [k, v] of Object.entries(row)) {
    if (v == null || !String(v).trim()) continue;
    const kl = lldpKeyLower(k);
    if (kl.includes('management') && (kl.includes('ipv4') || kl.includes('ip4') || /address.*v4|v4.*address/i.test(kl)))
      return String(v).trim();
  }
  return '';
}

export function pickLldpChassisId(row: Record<string, string>): string {
  for (const [k, v] of Object.entries(row)) {
    if (v == null || !String(v).trim()) continue;
    const kl = lldpKeyLower(k);
    if (kl.includes('chassis id') || kl === 'chassisid') return String(v).trim();
  }
  return '';
}

/** 运维向精简 LLDP 行；忽略 TLV 细项。 */
export function buildLldpSimpleLines(row: Record<string, string>): { label: string; value: string }[] {
  const lines: { label: string; value: string }[] = [];
  const seen = new Set<string>();
  const push = (label: string, value: string) => {
    const t = value.trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    lines.push({ label, value: t });
  };

  const local = pickLldpLocalInterface(row);
  if (local) push('本机接口', local);

  const name = pickLldpSystemName(row);
  if (name) push('对端名称', name);

  const desc = pickLldpSystemDescription(row);
  if (desc) push('设备型号', desc);

  const peer = pickLldpPeerPort(row);
  if (peer) push('对端端口', peer);

  const mgmt = pickLldpManagementIpv4(row);
  if (mgmt) push('对端管理 IP', mgmt);

  const chassis = pickLldpChassisId(row);
  if (chassis) push('邻居 Chassis', chassis);

  return lines;
}

/** 槽位底部一行：对端名称 · 对端端口 */
export function formatLldpBriefForPort(row: Record<string, string>): string {
  const sys = pickLldpSystemName(row);
  const port = pickLldpPeerPort(row);
  let line = '';
  if (sys && port) line = `${sys} · ${port}`;
  else if (sys) line = sys;
  else if (port) line = port;
  else {
    const desc = pickLldpSystemDescription(row);
    if (desc) line = desc;
  }
  return line;
}
