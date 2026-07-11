/**
 * 标准 / SASE 角色向导共用：由表单值拼装 VR2 配置（含 ipsec_preset + 接口 + 默认路由）。
 */
export type IpsecPresetWizardFormValues = {
  ipsecPublicIp?: string;
  wanInterface?: string;
  wanIpv4?: string;
  wanIpv6?: string;
  enableNat?: boolean;
  lanInterface?: string;
  lanIpv4?: string;
  lanIpv6?: string;
};

const IPV4_CIDR_PATTERN =
  /^(?:(?:[0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}(?:[0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\/([0-9]|[1-2]\d|3[0-2])$/;

function normalizeIPv4Cidr(value: unknown): string | undefined {
  const t = String(value ?? '').trim();
  return IPV4_CIDR_PATTERN.test(t) ? t : undefined;
}

function bucketInterfaceEntries(ifaceObjs: Record<string, unknown>[]): Record<string, unknown[]> {
  const buckets: Record<string, unknown[]> = {};
  ifaceObjs.forEach((item) => {
    const name = String(item?.name || '');
    if (!name) return;
    const isSub = name.includes('.');
    let bucketKey = 'interfaces_GigabitEthernet';
    if (name.startsWith('GigabitEthernet') || name.startsWith('GE')) {
      bucketKey = isSub ? 'subinterfaces_GigabitEthernet' : 'interfaces_GigabitEthernet';
    } else if (name.startsWith('lo') || name.startsWith('Loopback')) {
      bucketKey = 'interfaces_lo';
    } else if (name.startsWith('Tunnel')) {
      bucketKey = isSub ? 'subinterfaces_Tunnel' : 'interfaces_Tunnel';
    } else {
      bucketKey = isSub ? 'subinterfaces_GigabitEthernet' : 'interfaces_GigabitEthernet';
    }
    if (!buckets[bucketKey]) buckets[bucketKey] = [];
    buckets[bucketKey].push(item);
  });
  return buckets;
}

export function buildIpsecPresetVrConfigFromValues(
  v: IpsecPresetWizardFormValues,
): Record<string, unknown> {
  const wanGateway = String(v?.ipsecPublicIp || '').trim();
  const wanInterface = String(v?.wanInterface || '').trim();
  const wanIpv4 = String(v?.wanIpv4 || '').trim();
  const wanIpv6 = String(v?.wanIpv6 || '').trim();
  const enableNat = !!v?.enableNat;
  const lanInterface = String(v?.lanInterface || '').trim();
  const lanIpv4 = String(v?.lanIpv4 || '').trim();
  const lanIpv6 = String(v?.lanIpv6 || '').trim();

  const cfg: Record<string, unknown> = {};
  const wanIpOnly = wanIpv4 ? wanIpv4.split('/')[0] : undefined;

  cfg.ipsec_preset = {
    version: 2,
    wan_interface: wanInterface || undefined,
    wan_ipv4: wanIpv4 || undefined,
    wan_ipv6: wanIpv6 || undefined,
    gateway: wanGateway || undefined,
    public_ip: wanIpOnly,
    enable_nat: enableNat,
    lan_interface: lanInterface || undefined,
    lan_ipv4: lanIpv4 || undefined,
    lan_ipv6: lanIpv6 || undefined,
    local_subnet: lanIpv4 || undefined,
  };

  const ifaceObjs: Record<string, unknown>[] = [];

  if (wanInterface) {
    const item: Record<string, unknown> = { name: wanInterface, status: 'up' };
    const w4 = normalizeIPv4Cidr(wanIpv4);
    if (w4) item.ipv4_static = w4;
    if (wanIpv6) item.ipv6_static = wanIpv6;
    if (enableNat) item.nat = { type: 'outside' };
    ifaceObjs.push(item);
  }

  if (lanInterface) {
    const item: Record<string, unknown> = { name: lanInterface, status: 'up' };
    const l4 = normalizeIPv4Cidr(lanIpv4);
    if (l4) item.ipv4_static = l4;
    if (lanIpv6) item.ipv6_static = lanIpv6;
    if (enableNat) item.nat = { type: 'inside' };
    ifaceObjs.push(item);
  }

  if (ifaceObjs.length > 0) {
    const buckets = bucketInterfaceEntries(ifaceObjs);
    Object.keys(buckets).forEach((k) => {
      if (buckets[k]?.length) cfg[k] = buckets[k];
    });
  }

  if (wanInterface && wanGateway && IPV4_CIDR_PATTERN.test(`${wanGateway}/32`)) {
    cfg.ipv4_route = [{ destination: '0.0.0.0/0', via: wanGateway, priority: 100 }];
  }

  return cfg;
}

/** 下发设备前剔除平台角色元数据块（保留 ipsec_preset 供设备回读） */
export function stripIpsecPresetWizardPlatformBlocks(
  cfg: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...cfg };
  delete out.ce;
  delete out.pe;
  return out;
}
