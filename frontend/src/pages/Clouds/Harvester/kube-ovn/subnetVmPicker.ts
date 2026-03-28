import {
  KUBE_OVN_FLAT_VPC,
  KUBE_OVN_PUBLIC_VPC,
  SUBNET_TYPE_ANNOTATION_KEY,
  isBuiltInKubeOvnVpc,
} from './underlay-subnet/constants';

export function subnetCidrOf(s: any): string {
  return String(s?.spec?.cidrBlock ?? s?.spec?.cidr ?? s?.cidr ?? '').trim();
}

/** VM networks 是否挂到该子网对应的 NAD（与 SNAT/子网占用校验一致） */
export function vmUsesSubnet(vm: any, subnet: any): boolean {
  const sn = String(subnet?.metadata?.name || subnet?.name || '').trim();
  if (!sn) return false;
  const nets: string[] = Array.isArray(vm?.networks) ? vm.networks : [];
  if (nets.length === 0) return false;
  const snL = sn.toLowerCase();
  return nets.some((raw) => {
    const s = String(raw || '').trim().toLowerCase();
    if (!s) return false;
    const base = s.includes('@') ? s.split('@')[0]! : s;
    return base === `default/${snL}` || base.endsWith(`/${snL}`) || base === snL;
  });
}

/**
 * 下拉 value 为 JSON：{ ipName, v4Ip }（FIP 用 ipName；DNAT 等仅需 v4Ip 时只读 v4Ip）
 * Kube-OVN IP CR 名常见为 namespace.vmName.接口名
 */
export function buildVmNicIpOptions(vm: any): { label: string; value: string }[] {
  const ns = String(vm?.namespace || vm?.metadata?.namespace || 'default').trim() || 'default';
  const vmName = String(vm?.name || vm?.metadata?.name || '').trim();
  if (!vmName) return [];
  const vmi = vm?.vmi || vm?.vmiRaw;
  const ifaces: any[] = Array.isArray(vmi?.status?.interfaces)
    ? vmi.status.interfaces
    : Array.isArray(vm?.status?.interfaces)
      ? vm.status.interfaces
      : [];
  const out: { label: string; value: string }[] = [];
  for (const i of ifaces) {
    const ip = String(i?.ipAddress || i?.ip || '').trim();
    const iname = String(i?.name || 'default').trim() || 'default';
    if (!ip) continue;
    const ipName = `${ns}.${vmName}.${iname}`;
    out.push({
      label: `${iname} — ${ip}`,
      value: JSON.stringify({ ipName, v4Ip: ip }),
    });
  }
  if (out.length === 0 && Array.isArray(vm?.ips) && vm.ips.length > 0) {
    const ipStr = String(vm.ips[0] || '').trim();
    if (ipStr) {
      const ipName = `${ns}.${vmName}.default`;
      out.push({
        label: `${ipStr}（接口名按 default 推断，请以集群实际 IP CR 为准）`,
        value: JSON.stringify({ ipName, v4Ip: ipStr }),
      });
    }
  }
  return out;
}

/** FIP / DNAT 等：按网络域筛选可挂 VM 的扁平或 VPC 子网（不含 public） */
export function subnetChoicesForOvnAttach(
  subnets: any[],
  networkScope: 'flat' | 'vpc' | undefined,
): any[] {
  const items = Array.isArray(subnets) ? subnets : [];
  return items.filter((s: any) => {
    const t = String(s?.metadata?.annotations?.[SUBNET_TYPE_ANNOTATION_KEY] ?? '')
      .trim()
      .toLowerCase();
    if (t === 'public') return false;
    const vpc = String(s?.spec?.vpc || s?.vpc || '').trim() || KUBE_OVN_PUBLIC_VPC;
    if (networkScope === 'flat')
      return t === 'flat' && (vpc === KUBE_OVN_FLAT_VPC || vpc === KUBE_OVN_PUBLIC_VPC);
    if (networkScope === 'vpc') return t === 'vpc' && !isBuiltInKubeOvnVpc(vpc);
    return t === 'vpc' || t === 'flat';
  });
}
