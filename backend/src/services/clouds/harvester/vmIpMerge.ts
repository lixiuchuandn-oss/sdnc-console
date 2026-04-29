/**
 * 合并 Harvester / KubeVirt 虚拟机在列表中展示的 IP（与 Harvester UI 口径对齐）。
 * 包含：Harvester 注解 network.harvesterhci.io/ips、status.vmIp、
 * status.interfaces 的 ipAddress/ip/ipAddresses（Guest Agent 常写在 ipAddresses）。
 */

export const HARVESTER_NETWORK_IPS_ANNOTATION = 'network.harvesterhci.io/ips';

/** 解析 VM/VMI 上 Harvester 写入的 IP 注解（JSON 数组字符串或其它可解析形式） */
export function parseHarvesterNetworkIpsAnnotation(raw: unknown): string[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw.map((x) => String(x || '').trim()).filter(Boolean);
  }
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return [];
    try {
      const j = JSON.parse(s);
      if (Array.isArray(j)) {
        return j.map((x) => String(x || '').trim()).filter(Boolean);
      }
    } catch {
      if (s.includes(',')) {
        return s
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean);
      }
      return [s];
    }
  }
  return [];
}

/** 从 KubeVirt VM/VMI status.interfaces 收集单卡上的所有地址 */
export function collectIpsFromKubeVirtInterfaces(interfaces: any[] | undefined): string[] {
  if (!Array.isArray(interfaces)) return [];
  const out: string[] = [];
  for (const i of interfaces) {
    if (!i) continue;
    const single = i.ipAddress || i.ip;
    if (single) {
      const v = String(single).trim();
      if (v) out.push(v);
    }
    if (Array.isArray(i.ipAddresses)) {
      for (const a of i.ipAddresses) {
        const v = String(a || '').trim();
        if (v) out.push(v);
      }
    }
  }
  return out;
}

/**
 * 按 Tower 列表展示顺序去重合并 VM + VMI 上的 IP 来源。
 */
export function buildHarvesterVmRowIps(vm: any, vmi: any | undefined | null): string[] {
  const ips: string[] = [];
  const add = (s: any) => {
    const v = String(s || '').trim();
    if (v && !ips.includes(v)) ips.push(v);
  };

  if (vm?.status?.vmIp) add(vm.status.vmIp);

  const vmAnnot = vm?.metadata?.annotations?.[HARVESTER_NETWORK_IPS_ANNOTATION];
  const vmiAnnot = vmi?.metadata?.annotations?.[HARVESTER_NETWORK_IPS_ANNOTATION];
  parseHarvesterNetworkIpsAnnotation(vmAnnot).forEach(add);
  parseHarvesterNetworkIpsAnnotation(vmiAnnot).forEach(add);

  collectIpsFromKubeVirtInterfaces(vm?.status?.interfaces).forEach(add);
  if (vmi) {
    collectIpsFromKubeVirtInterfaces(vmi?.status?.interfaces).forEach(add);
  }

  return ips;
}
