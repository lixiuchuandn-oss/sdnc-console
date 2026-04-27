/**
 * 扁平子网「排除 IP」编辑前校验：重复、IPv4、是否落在 CIDR 内、是否与已汇总虚拟机 IP 冲突。
 */

function ipv4ToLong(ip: string): number {
  return ip.split('.').reduce((acc, oct) => (acc << 8) + parseInt(oct, 10), 0) >>> 0;
}

function parseCidrRange(cidr: string): { start: number; end: number } | null {
  const m = String(cidr)
    .trim()
    .match(/^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/);
  if (!m) return null;
  const mask = parseInt(m[2], 10);
  if (Number.isNaN(mask) || mask < 0 || mask > 32) return null;
  const ipNum = ipv4ToLong(m[1]);
  const hostBits = 32 - mask;
  const start = (ipNum >>> hostBits) << hostBits;
  const end = start + 2 ** hostBits - 1;
  return { start: start >>> 0, end: end >>> 0 };
}

const IPV4_HOST = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * 网关是否落在 IPv4 CIDR 内（与排除 IP 校验同一套解析）。
 * @returns `true`/`false` 可判定；`null` 表示 CIDR/网关格式无法解析，交由集群或其它校验。
 */
export function isIpv4GatewayInCidr(gateway: string, cidr: string): boolean | null {
  const g = String(gateway ?? '').trim();
  const c = String(cidr ?? '').trim();
  if (!g || !c) return null;
  if (!IPV4_HOST.test(g)) return null;
  const range = parseCidrRange(c);
  if (!range) return null;
  const n = ipv4ToLong(g);
  if (Number.isNaN(n)) return null;
  return n >= range.start && n <= range.end;
}

/** 从 API 错误对象中拼接可搜索文本（含嵌套 details） */
export function collectKubeOvnSubnetErrorText(error: unknown): string {
  const e = error as Record<string, unknown> | null | undefined;
  if (!e) return '';
  const parts: string[] = [];
  const push = (v: unknown) => {
    if (v == null) return;
    if (typeof v === 'string') parts.push(v);
    else {
      try {
        parts.push(JSON.stringify(v));
      } catch {
        parts.push(String(v));
      }
    }
  };
  push(e.message);
  const rd = e.responseData as Record<string, unknown> | undefined;
  if (rd) {
    push(rd.message);
    push(rd.error);
    push(rd.details);
  }
  return parts.join(' ');
}

/**
 * Kube-OVN admission：`gateway x.x.x.x is not in cidr y.y.y.y/p`
 * 前端避免误报「权限不足」；与提交前 isIpv4GatewayInCidr 双保险。
 */
export function friendlyMessageIfKubeOvnGatewayNotInCidr(
  error: unknown,
  kind: 'flat' | 'public',
): string | null {
  const raw = collectKubeOvnSubnetErrorText(error);
  if (!raw) return null;
  if (/gateway\s+[\d.]+\s+is\s+not\s+in\s+cidr/i.test(raw)) {
    return kind === 'flat' ? '创建扁平子网失败：网关不在CIDR 范围内' : '创建公共子网失败：网关不在CIDR 范围内';
  }
  return null;
}

function vmInSubnetAggregated(vm: any, subnetName: string): boolean {
  if (!subnetName) return false;
  const networks: string[] = Array.isArray(vm?.networks) ? vm.networks : [];
  const target = subnetName.toLowerCase();
  return networks.some((n) => {
    const s = String(n || '').toLowerCase();
    const base = s.includes('@') ? s.split('@')[0] : s;
    return base === `default/${target}` || base.endsWith(`/${target}`);
  });
}

function vmDisplay(vm: any): string {
  const alias = String(vm?.metadata?.annotations?.['tower.io/alias'] ?? '').trim();
  const n = String(vm?.metadata?.name ?? vm?.name ?? '').trim();
  return alias || n || '—';
}

function vmIpsAggregated(vm: any): string[] {
  if (Array.isArray(vm?.ips)) {
    return vm.ips.map((x: unknown) => String(x || '').trim().split('/')[0]).filter(Boolean);
  }
  return [];
}

export type FlatExcludeValidationResult = { ok: true } | { ok: false; message: string };

/** 单行 IPv4 与 CIDR；含 `..` 的区间写法仅做重复项检查，交后端 / 集群 */
export function validateFlatSubnetExcludeIpsLocal(
  cidr: string,
  excludeIps: string[],
): FlatExcludeValidationResult {
  const cidrTrim = String(cidr ?? '').trim();
  if (excludeIps.length === 0) return { ok: true };

  const seen = new Set<string>();
  for (const raw of excludeIps) {
    const k = raw.toLowerCase();
    if (seen.has(k)) {
      return { ok: false, message: `排除 IP 存在重复：${raw}` };
    }
    seen.add(k);
  }

  if (!cidrTrim) {
    return { ok: false, message: '无法校验排除 IP：子网 CIDR 为空' };
  }
  const range = parseCidrRange(cidrTrim);
  if (!range) {
    return { ok: false, message: `无法校验排除 IP：子网 CIDR「${cidrTrim}」无效` };
  }

  for (const item of excludeIps) {
    if (item.includes('..')) continue;
    if (!IPV4_HOST.test(item)) {
      return {
        ok: false,
        message: `排除 IP「${item}」不是合法的 IPv4 地址（区间写法请使用 ..）`,
      };
    }
    const n = ipv4ToLong(item);
    if (n < range.start || n > range.end) {
      return {
        ok: false,
        message: `排除 IP「${item}」不在子网 CIDR「${cidrTrim}」范围内`,
      };
    }
  }
  return { ok: true };
}

/** 与 ECS 聚合列表比对：排除列表中的 IP 是否已被挂该子网的虚拟机使用 */
export function findFlatExcludeIpConflictWithVms(
  subnetName: string,
  excludeIps: string[],
  vms: any[],
): { ip: string; vmLabel: string } | null {
  if (!subnetName || excludeIps.length === 0) return null;
  const excludeLower = new Set(excludeIps.map((x) => x.toLowerCase()));
  for (const vm of vms || []) {
    if (!vmInSubnetAggregated(vm, subnetName)) continue;
    const label = vmDisplay(vm);
    for (const ip of vmIpsAggregated(vm)) {
      if (excludeLower.has(ip.toLowerCase())) {
        return { ip, vmLabel: label };
      }
    }
  }
  return null;
}
