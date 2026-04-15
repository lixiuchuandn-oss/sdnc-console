/**
 * 物理交换机表格行 / ASW-CTL 实例 record 的字段读取（Harvester · cluster · ASW-CTL）。
 */

export function switchRecordManagementHost(r: any): string {
  const h =
    r?.info?.host ||
    r?.interfaces?.host ||
    r?.performance?.host ||
    r?.vlans?.host ||
    '';
  const s = h != null ? String(h).trim() : '';
  return s || '—';
}

export function switchRecordDeviceProfile(r: any): string {
  const p =
    r?.info?.device_profile ||
    r?.interfaces?.device_profile ||
    r?.performance?.device_profile ||
    r?.vlans?.device_profile ||
    '';
  return p ? String(p).trim() : '';
}

/** 从 /v1/switch/info 的 lines[].stdout 抽取交换机展示名（如 WOS system dump 的 Description）。 */
export function parseSwitchDisplayNameFromInfoLines(lines: any[] | undefined): string {
  if (!Array.isArray(lines)) return '';
  for (const ln of lines) {
    const out = typeof ln?.stdout === 'string' ? ln.stdout : '';
    if (!out.trim()) continue;
    const desc = out.match(/(?:^|\n)\s*Description:\s*([^\n\r]+)/i);
    if (desc?.[1]) {
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
  }
  return '';
}

export function isWinicssecSwitchRecord(r: any): boolean {
  return /winicssec|winics|wos/i.test(switchRecordDeviceProfile(r));
}
