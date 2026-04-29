import { isIpv4AddressInCidr } from './flatSubnetExcludeIpValidation';
import {
  KUBE_OVN_FLAT_VPC,
  KUBE_OVN_PUBLIC_VPC,
  SUBNET_TYPE_ANNOTATION_KEY,
  isBuiltInKubeOvnVpc,
} from './kubeOvnSubnetConstants';

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

const IPV4_HOST = /^\d{1,3}(\.\d{1,3}){3}$/;

function normalizeIpv4(raw: unknown): string | null {
  const s = String(raw ?? '').trim().split('/')[0]!;
  if (!s || !IPV4_HOST.test(s)) return null;
  return s;
}

/** 从 kube-ovn / KubeVirt status.interfaces 单行收集 IPv4（含 ipAddresses[]）。 */
export function collectIpv4FromKubeInterfaceRow(i: any): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  const push = (v: string | null) => {
    if (!v || seen.has(v)) return;
    seen.add(v);
    ordered.push(v);
  };
  push(normalizeIpv4(i?.ipAddress));
  push(normalizeIpv4(i?.ip));
  if (Array.isArray(i?.ipAddresses)) {
    for (const x of i.ipAddresses) {
      push(normalizeIpv4(x));
    }
  }
  return ordered;
}

/**
 * 下拉 value 为 JSON：{ ipName, v4Ip }（FIP 用 ipName；DNAT 等仅需 v4Ip 时只读 v4Ip）
 * Kube-OVN IP CR 名常见为 namespace.vmName.接口名
 *
 * 合并 VMI 与 VM 的 status.interfaces；支持 ipAddresses；VMI 接口为空时仍使用 VM 侧接口；
 * 仍无数据时回退 vm.ips 全量。若传入 subnet，优先展示落在该子网 CIDR 内的地址。
 */
export function buildVmNicIpOptions(
  vm: any,
  subnet?: any,
): { label: string; value: string }[] {
  const ns = String(vm?.namespace || vm?.metadata?.namespace || 'default').trim() || 'default';
  const vmName = String(vm?.name || vm?.metadata?.name || '').trim();
  if (!vmName) return [];

  const vmi = vm?.vmi || vm?.vmiRaw;
  const vmiIfaces: any[] = Array.isArray(vmi?.status?.interfaces) ? vmi.status.interfaces : [];
  const vmIfaces: any[] = Array.isArray(vm?.status?.interfaces) ? vm.status.interfaces : [];
  const mergedIfaces = [...vmiIfaces, ...vmIfaces];

  const out: { label: string; value: string }[] = [];
  const pairSeen = new Set<string>();
  const ifaceIpSet = new Set<string>();

  const pushOption = (iname: string, ip: string) => {
    const key = `${iname}|${ip}`;
    if (pairSeen.has(key)) return;
    pairSeen.add(key);
    const ipName = `${ns}.${vmName}.${iname}`;
    out.push({
      label: `${iname} — ${ip}`,
      value: JSON.stringify({ ipName, v4Ip: ip }),
    });
  };

  mergedIfaces.forEach((i, idx) => {
    const ips = collectIpv4FromKubeInterfaceRow(i);
    const iname = String(i?.name || '').trim() || `iface-${idx}`;
    for (const ip of ips) {
      ifaceIpSet.add(ip);
      pushOption(iname, ip);
    }
  });

  if (Array.isArray(vm?.ips) && vm.ips.length > 0) {
    let supplementalIdx = 0;
    for (const raw of vm.ips) {
      const ip = normalizeIpv4(raw);
      if (!ip || ifaceIpSet.has(ip)) continue;
      const iname = supplementalIdx === 0 ? 'default' : `ips${supplementalIdx}`;
      supplementalIdx += 1;
      pushOption(iname, ip);
    }
  }

  const cidr = subnet ? subnetCidrOf(subnet) : '';
  if (cidr) {
    const filtered = out.filter((o) => {
      try {
        const v4 = String(JSON.parse(String(o.value)).v4Ip || '').trim();
        return v4 && isIpv4AddressInCidr(v4, cidr);
      } catch {
        return false;
      }
    });
    if (filtered.length > 0) return filtered;
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
