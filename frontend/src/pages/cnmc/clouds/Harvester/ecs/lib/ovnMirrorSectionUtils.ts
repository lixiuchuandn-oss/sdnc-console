import type { OvnMirrorRulePayload, OvnMirrorSpecPayload } from '../../../../../../services/harvester/ovnMirrors';
import { readVmName } from './vmSafeRead';

export type OvnMirrorTableRow = {
  key: string;
  name: string;
  sourceNamespace: string;
  sourceVmName: string;
  sourceNetworkNad: string;
  destNamespace: string;
  destVmName: string;
  destNetworkNad: string;
  ruleCount: number;
  createdAt?: string;
  raw: unknown;
};

export type OvnMirrorDestinationFormValues = {
  /** namespace/name，与源虚拟机选择器一致 */
  destVmKey: string;
  networkNad: string;
};

export type OvnMirrorFilterRuleFormValues = {
  direct?: string;
  protocol?: string;
  port?: number | null;
  /** IPv4 文本；空表示 any */
  targetIp?: string;
  targetPort?: number | null;
};

function ipv4ToTargetIpInt(ip: string): number | null {
  const m = ip.trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const p = [m[1], m[2], m[3], m[4]].map((x) => Number(x));
  if (p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
}

function targetIpIntToIpv4(n: number): string {
  const u = n >>> 0;
  return [(u >>> 24) & 255, (u >>> 16) & 255, (u >>> 8) & 255, u & 255].join('.');
}

/** 端口等：表单空值 → API 0（any） */
export function ovnMirrorRuleIntToApi(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(65535, Math.floor(n));
}

/** API 0 → 表单空（展示 any） */
export function ovnMirrorRuleIntFromApi(v: unknown): number | undefined {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
}

export function ovnMirrorRuleIntDisplay(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 'any';
  return String(n);
}

/** 目的 IP：表单 → API string（空 = any） */
export function ovnMirrorTargetIpFormToApi(v: unknown): string {
  const s = String(v ?? '').trim();
  if (!s) return '';
  if (ipv4ToTargetIpInt(s) === null) throw new Error('目的 IP 格式无效');
  return s;
}

/** API string → 表单（空/0/legacy int 为空） */
export function ovnMirrorTargetIpApiToForm(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v <= 0) return undefined;
    return targetIpIntToIpv4(v);
  }
  const s = String(v).trim();
  if (!s || s === '0') return undefined;
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    if (n <= 0) return undefined;
    return targetIpIntToIpv4(n);
  }
  return s;
}

export function ovnMirrorTargetIpDisplay(v: unknown): string {
  const ip = ovnMirrorTargetIpApiToForm(v);
  return ip || 'any';
}

/** 可选端口：空=any；须为 0–65535 的整数 */
export function validateOvnMirrorOptionalPort(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const s = String(value).trim();
  if (!/^\d+$/.test(s)) return '端口须为数字';
  const n = Number(s);
  if (!Number.isInteger(n) || n < 0 || n > 65535) return '端口范围 0–65535';
  return null;
}

/** 可选 IPv4：空=any */
export function validateOvnMirrorOptionalIpv4(value: unknown): string | null {
  const s = String(value ?? '').trim();
  if (!s) return null;
  if (ipv4ToTargetIpInt(s) === null) return '请输入有效的 IPv4 地址';
  return null;
}

export type OvnMirrorCreatePayload = {
  name: string;
  spec: OvnMirrorSpecPayload;
};

export type OvnMirrorSourceNicEntryFormValues = {
  networkNad: string;
  filterRules: OvnMirrorFilterRuleFormValues[];
};

export type OvnMirrorSourceVmFormValues = {
  sourceVmKey: string;
  sourceNamespace: string;
  nicEntries: OvnMirrorSourceNicEntryFormValues[];
};

/** @deprecated 内部扁平化用；表单请使用 sourceVms */
export type OvnMirrorSourceEntryFormValues = {
  sourceVmKey: string;
  sourceNamespace: string;
  networkNad: string;
  filterRules: OvnMirrorFilterRuleFormValues[];
};

export type OvnMirrorFormValues = {
  mirrorDestination: OvnMirrorDestinationFormValues;
  sourceVms: OvnMirrorSourceVmFormValues[];
};

const DIRECT_LABELS: Record<string, string> = {
  inbound: '入方向',
  outbound: '出方向',
  all: '全部',
};

const PROTOCOL_LABELS: Record<string, string> = {
  tcp: 'TCP',
  udp: 'UDP',
  all: '全部',
};

export function ovnMirrorDirectLabel(v: string | undefined): string {
  return DIRECT_LABELS[String(v || 'all')] || String(v || 'all');
}

export function ovnMirrorProtocolLabel(v: string | undefined): string {
  return PROTOCOL_LABELS[String(v || 'all')] || String(v || 'all');
}

export function vmKubernetesNamespace(vm: unknown): string {
  const r = vm as { metadata?: { namespace?: string }; namespace?: string };
  return String(r?.metadata?.namespace ?? r?.namespace ?? '').trim() || 'default';
}

export function vmKubernetesName(vm: unknown): string {
  const r = vm as { metadata?: { name?: string }; name?: string };
  return String(r?.metadata?.name ?? r?.name ?? '').trim();
}

export function vmRowKey(vm: unknown): string {
  const nm = vmKubernetesName(vm);
  if (!nm) return '';
  return `${vmKubernetesNamespace(vm)}/${nm}`;
}

/** 界面展示用虚拟机名称：优先 tower.io/alias（与 VmSection 一致） */
export function vmDisplayAlias(vm: unknown): string {
  const label = String(readVmName(vm as object) || '').trim();
  if (label) return label;
  const key = vmRowKey(vm);
  return key.includes('/') ? key.split('/')[1] || key : key;
}

export function vmNicIpDisplay(ip: string): string {
  const v = String(ip || '').trim();
  return v || '无 IP';
}

export function vmNicOptionsFromVm(vm: unknown): Array<{ value: string; label: string; ip: string }> {
  const r = vm as {
    metadata?: { namespace?: string };
    spec?: {
      template?: {
        spec?: {
          networks?: Array<{ name?: string; multus?: { networkName?: string } }>;
          domain?: { devices?: { interfaces?: Array<{ name?: string }> } };
        };
      };
    };
    vmi?: { status?: { interfaces?: Array<{ name?: string; ipAddress?: string; ipAddresses?: string[] }> } };
    status?: { interfaces?: Array<{ name?: string; ipAddress?: string; ipAddresses?: string[] }> };
  };
  const ns = vmKubernetesNamespace(vm);
  const networks = r?.spec?.template?.spec?.networks || [];
  const ifaces = r?.spec?.template?.spec?.domain?.devices?.interfaces || [];

  return ifaces.map((iface) => {
    const net = networks.find((n) => n?.name === iface?.name);
    const multusName = String(net?.multus?.networkName || '').trim();
    const networkNad = multusName || 'Management Network';
    const value =
      networkNad === 'Management Network'
        ? 'Management Network'
        : networkNad.includes('/')
          ? networkNad
          : `${ns}/${networkNad}`;

    let ip = '';
    const pickIp = (si: { ipAddress?: string; ipAddresses?: string[] } | undefined) => {
      if (!si) return '';
      if (si.ipAddress) return si.ipAddress;
      if (Array.isArray(si.ipAddresses) && si.ipAddresses.length > 0) {
        return si.ipAddresses.join(', ');
      }
      return '';
    };
    const vmiIface = r?.vmi?.status?.interfaces?.find((si) => si?.name === iface?.name);
    ip = pickIp(vmiIface);
    if (!ip) {
      const statusIface = r?.status?.interfaces?.find((si) => si?.name === iface?.name);
      ip = pickIp(statusIface);
    }

    const label = vmNicIpDisplay(ip);
    return { value, label, ip };
  });
}

export function defaultOvnMirrorFilterRule(): OvnMirrorFilterRuleFormValues {
  return { direct: 'all', protocol: 'all' };
}

function sanitizeDnsLabel(input: string): string {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^[^a-z0-9]+/, '');
}

/** IP 转为 DNS 标签段，如 192.168.1.10 → 192-168-1-10 */
function sanitizeIpForDnsLabel(ip: string): string {
  const first = String(ip || '')
    .split(',')[0]
    ?.trim();
  if (!first) return '';
  return first
    .toLowerCase()
    .replace(/[^a-z0-9.:]+/g, '')
    .replace(/[.:]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function composeMirrorCrDnsName(vmPart: string, ipPart: string, maxLen = 63): string {
  const vmSeg = vmPart || 'vm';
  const ipSeg = ipPart || 'nic';
  const full = `mirror-${vmSeg}-${ipSeg}`;
  if (full.length <= maxLen) {
    const normalized = sanitizeDnsLabel(full);
    return (normalized || full).slice(0, maxLen);
  }
  const tail = `-${ipSeg}`;
  const headBudget = maxLen - tail.length;
  const head = sanitizeDnsLabel(`mirror-${vmSeg}`).slice(0, Math.max('mirror'.length + 1, headBudget));
  let name = `${head.replace(/-+$/, '')}${tail}`;
  if (!/^[a-z0-9]/.test(name)) {
    name = sanitizeDnsLabel(`mirror-vm-${ipSeg}`).slice(0, maxLen);
  }
  return name.slice(0, maxLen);
}

/** 按源虚拟机名称 + 网卡 IP 自动生成 OvnMirror CR 名称 */
export function buildOvnMirrorCrName(
  vm: unknown,
  networkNad: string,
  reserved: Set<string>,
): string {
  const alias = vmDisplayAlias(vm);
  let vmPart = sanitizeDnsLabel(alias);
  if (!vmPart) {
    vmPart = sanitizeDnsLabel(vmRowKey(vm).replace('/', '-'));
  }

  const ip = resolveVmNicIpByNetworkNad(vm, networkNad);
  let ipPart = sanitizeIpForDnsLabel(ip);
  if (!ipPart) {
    ipPart = sanitizeDnsLabel(
      networkNad === 'Management Network' ? 'mgmt' : networkNad.split('/').pop() || 'noip',
    );
  }

  let name = composeMirrorCrDnsName(vmPart, ipPart);
  let candidate = name;
  let n = 2;
  while (reserved.has(candidate)) {
    const suffix = `-${n}`;
    candidate = `${name.slice(0, Math.max(1, 63 - suffix.length))}${suffix}`;
    n += 1;
  }
  reserved.add(candidate);
  return candidate;
}

function buildMirrorEndpoint(
  dest: OvnMirrorDestinationFormValues,
): { namespace: string; vmName: string; networkNad: string } {
  const destKey = String(dest.destVmKey || '').trim();
  const [destNs, destVm] = destKey.split('/').map((s) => s.trim());
  const destNad = String(dest.networkNad || '').trim();
  if (!destNs || !destVm || !destNad) {
    throw new Error('请配置镜像流量接收端');
  }
  return { namespace: destNs, vmName: destVm, networkNad: destNad };
}

function buildRulesForEntry(
  entry: OvnMirrorSourceEntryFormValues,
  endpoint: { namespace: string; vmName: string; networkNad: string },
  entryLabel: string,
): { namespace: string; vmName: string; rules: OvnMirrorRulePayload[] } {
  const [nsFromKey, vmFromKey] = String(entry.sourceVmKey || '')
    .split('/')
    .map((s) => s.trim());
  const namespace = String(entry.sourceNamespace || nsFromKey || '').trim();
  const vmName = String(vmFromKey || '').trim();
  const networkNad = String(entry.networkNad || '').trim();

  if (!namespace || !vmName) throw new Error(`${entryLabel}：请选择虚拟机`);
  if (!networkNad) throw new Error(`${entryLabel}：请选择网卡`);

  const filterRules = entry.filterRules || [];
  if (filterRules.length === 0) {
    throw new Error(`${entryLabel}：高级配置中至少添加一条镜像规则`);
  }

  const rules = filterRules.map((rule, ruleIdx) => {
    let targetIp: string;
    try {
      targetIp = ovnMirrorTargetIpFormToApi(rule.targetIp);
    } catch {
      throw new Error(`${entryLabel} · 规则 ${ruleIdx + 1}：目的 IP 格式无效`);
    }
    return {
      networkNad,
      targetIp,
      endpoints: [endpoint],
      port: ovnMirrorRuleIntToApi(rule.port),
      direct: (rule.direct || 'all') as OvnMirrorRulePayload['direct'],
      protocol: (rule.protocol || 'all') as OvnMirrorRulePayload['protocol'],
      targetPort: ovnMirrorRuleIntToApi(rule.targetPort),
    };
  });

  return { namespace, vmName, rules };
}

export function defaultOvnMirrorSourceNicEntry(): OvnMirrorSourceNicEntryFormValues {
  return { networkNad: '', filterRules: [defaultOvnMirrorFilterRule()] };
}

export function defaultOvnMirrorSourceVm(): OvnMirrorSourceVmFormValues {
  return {
    sourceVmKey: '',
    sourceNamespace: '',
    nicEntries: [defaultOvnMirrorSourceNicEntry()],
  };
}

/** 将表单中所有源虚拟机网卡扁平化（注解、唯一性校验等） */
export function flattenOvnMirrorFormNicEntries(
  values: OvnMirrorFormValues,
): OvnMirrorSourceEntryFormValues[] {
  const out: OvnMirrorSourceEntryFormValues[] = [];
  for (const vmEntry of values.sourceVms || []) {
    const vmKey = String(vmEntry.sourceVmKey || '').trim();
    const ns = String(vmEntry.sourceNamespace || '').trim();
    for (const nic of vmEntry.nicEntries || []) {
      out.push({
        sourceVmKey: vmKey,
        sourceNamespace: ns,
        networkNad: String(nic.networkNad || '').trim(),
        filterRules: nic.filterRules || [],
      });
    }
  }
  return out;
}

export function listOvnMirrorSourceNadsFromRaw(raw: unknown): string[] {
  const r = raw as { spec?: { rules?: OvnMirrorRulePayload[] } };
  const rules = Array.isArray(r?.spec?.rules) ? r.spec!.rules! : [];
  return [
    ...new Set(
      rules.map((rule) => String(rule?.networkNad || '').trim()).filter(Boolean),
    ),
  ];
}

export function listOvnMirrorNicKeysFromRow(row: OvnMirrorTableRow): string[] {
  const vmKey = `${String(row.sourceNamespace || '').trim()}/${String(row.sourceVmName || '').trim()}`;
  const nads = listOvnMirrorSourceNadsFromRaw(row.raw);
  if (nads.length === 0 && row.sourceNetworkNad) {
    return [ovnMirrorSourceNicKey(vmKey, row.sourceNetworkNad)].filter(Boolean);
  }
  return nads.map((nad) => ovnMirrorSourceNicKey(vmKey, nad)).filter(Boolean);
}

export function formatOvnMirrorVmMultiNicDisplay(
  vm: unknown | undefined,
  vmName: string,
  networkNads: string[],
): string {
  const nads = networkNads.filter(Boolean);
  if (nads.length === 0) {
    return vm ? vmDisplayAlias(vm) : String(vmName || '').trim() || '-';
  }
  return nads
    .map((nad) => formatOvnMirrorVmNicDisplay(vm, vmName, nad))
    .join('；');
}

export function resolveVmNicIpByNetworkNad(vm: unknown, networkNad: string): string {
  const nad = String(networkNad || '').trim();
  if (!vm || !nad) return '';
  const hit = vmNicOptionsFromVm(vm).find((o) => o.value === nad);
  return hit?.ip ? String(hit.ip).trim() : '';
}

/** 列表展示：虚拟机名称/网卡 IP */
export function formatOvnMirrorVmNicDisplay(
  vm: unknown | undefined,
  vmName: string,
  networkNad: string,
): string {
  const name = vm ? vmDisplayAlias(vm) : String(vmName || '').trim() || '-';
  const nad = String(networkNad || '').trim();
  if (!nad) return name;
  const ip = vm ? resolveVmNicIpByNetworkNad(vm, nad) : '';
  return `${name}/${vmNicIpDisplay(ip)}`;
}

function firstMirrorEndpoint(
  rules: OvnMirrorRulePayload[],
): { namespace: string; vmName: string; networkNad: string } {
  for (const rule of rules) {
    const ep = rule?.endpoints?.[0];
    if (!ep) continue;
    const namespace = String(ep.namespace || '').trim();
    const vmName = String(ep.vmName || '').trim();
    const networkNad = String(ep.networkNad || '').trim();
    if (namespace && vmName && networkNad) {
      return { namespace, vmName, networkNad };
    }
  }
  return { namespace: '', vmName: '', networkNad: '' };
}

export function mapOvnMirrorsToTableRows(items: unknown[]): OvnMirrorTableRow[] {
  return (Array.isArray(items) ? items : []).map((raw) => {
    const r = raw as {
      metadata?: { name?: string; creationTimestamp?: string };
      spec?: OvnMirrorSpecPayload;
    };
    const name = String(r?.metadata?.name || '').trim();
    const spec = r?.spec || { vmName: '', namespace: '', rules: [] };
    const rules = Array.isArray(spec.rules) ? spec.rules : [];
    const dest = firstMirrorEndpoint(rules);
    const sourceNetworkNad = String(rules[0]?.networkNad || '').trim();
    return {
      key: name,
      name,
      sourceNamespace: String(spec.namespace || ''),
      sourceVmName: String(spec.vmName || ''),
      sourceNetworkNad,
      destNamespace: dest.namespace,
      destVmName: dest.vmName,
      destNetworkNad: dest.networkNad,
      ruleCount: rules.length,
      createdAt: r?.metadata?.creationTimestamp,
      raw,
    };
  });
}

export type OvnMirrorDisplayRow = OvnMirrorTableRow & {
  sourceVmAlias?: string;
  sourceDisplay: string;
  destinationDisplay: string;
};

export function enrichOvnMirrorTableRows(rows: OvnMirrorTableRow[], vms: unknown[]): OvnMirrorDisplayRow[] {
  const vmList = Array.isArray(vms) ? vms : [];
  return rows.map((row) => {
    const sourceVm = vmList.find(
      (vm) => vmRowKey(vm) === `${row.sourceNamespace}/${row.sourceVmName}`,
    );
    const destVm = vmList.find(
      (vm) => vmRowKey(vm) === `${row.destNamespace}/${row.destVmName}`,
    );
    const sourceNads = listOvnMirrorSourceNadsFromRaw(row.raw);
    const primaryNad = sourceNads[0] || row.sourceNetworkNad;
    return {
      ...row,
      sourceVmAlias: sourceVm ? vmDisplayAlias(sourceVm) : row.sourceVmName,
      sourceDisplay: formatOvnMirrorVmMultiNicDisplay(
        sourceVm,
        row.sourceVmName,
        sourceNads.length > 0 ? sourceNads : [row.sourceNetworkNad].filter(Boolean),
      ),
      destinationDisplay:
        row.destVmName && row.destNetworkNad
          ? formatOvnMirrorVmNicDisplay(destVm, row.destVmName, row.destNetworkNad)
          : '-',
      sourceNetworkNad: primaryNad,
    };
  });
}

export function filterOvnMirrorRows(
  rows: OvnMirrorDisplayRow[],
  opts: { keyword?: string; sourceVmKey?: string },
): OvnMirrorDisplayRow[] {
  const kw = String(opts.keyword || '')
    .trim()
    .toLowerCase();
  const vmKey = String(opts.sourceVmKey || '').trim();
  return rows.filter((row) => {
    if (vmKey && `${row.sourceNamespace}/${row.sourceVmName}` !== vmKey) return false;
    if (!kw) return true;
    const hay = [
      row.name,
      row.sourceVmAlias,
      row.sourceNamespace,
      row.sourceVmName,
      row.sourceDisplay,
      row.destinationDisplay,
      row.destNamespace,
      row.destVmName,
    ]
      .join(' ')
      .toLowerCase();
    return hay.includes(kw);
  });
}

function endpointFromRules(rules: OvnMirrorRulePayload[]): OvnMirrorDestinationFormValues {
  const first = rules[0];
  const ep = first?.endpoints?.[0];
  const ns = String(ep?.namespace || '').trim();
  const vmName = String(ep?.vmName || '').trim();
  return {
    destVmKey: ns && vmName ? `${ns}/${vmName}` : '',
    networkNad: String(ep?.networkNad || ''),
  };
}

function sourceVmsFromSpec(spec: OvnMirrorSpecPayload): OvnMirrorSourceVmFormValues[] {
  const ns = String(spec.namespace || '').trim();
  const vmName = String(spec.vmName || '').trim();
  const vmKey = vmName ? `${ns}/${vmName}` : '';
  const rules = Array.isArray(spec.rules) ? spec.rules : [];

  const byNic = new Map<string, OvnMirrorFilterRuleFormValues[]>();
  for (const rule of rules) {
    const nic = String(rule.networkNad || '').trim();
    if (!nic) continue;
    const list = byNic.get(nic) || [];
    list.push({
      direct: rule.direct || 'all',
      protocol: rule.protocol || 'all',
      port: ovnMirrorRuleIntFromApi(rule.port),
      targetIp: ovnMirrorTargetIpApiToForm(rule.targetIp),
      targetPort: ovnMirrorRuleIntFromApi(rule.targetPort),
    });
    byNic.set(nic, list);
  }

  const nicEntries =
    byNic.size > 0
      ? Array.from(byNic.entries()).map(([networkNad, filterRules]) => ({
          networkNad,
          filterRules: filterRules.length > 0 ? filterRules : [defaultOvnMirrorFilterRule()],
        }))
      : [defaultOvnMirrorSourceNicEntry()];

  return [
    {
      sourceVmKey: vmKey,
      sourceNamespace: ns,
      nicEntries,
    },
  ];
}

export function ovnMirrorCrToFormValues(raw: unknown): OvnMirrorFormValues {
  const r = raw as {
    metadata?: { name?: string };
    spec?: OvnMirrorSpecPayload;
  };
  const spec = r?.spec || { vmName: '', namespace: '', rules: [] };
  const rules = Array.isArray(spec.rules) ? spec.rules : [];

  return {
    mirrorDestination: endpointFromRules(rules),
    sourceVms: sourceVmsFromSpec(spec),
  };
}

/** 源虚拟机 + 网卡（networkNad）唯一键 */
export function ovnMirrorSourceNicKey(sourceVmKey: string, networkNad: string): string {
  const vm = String(sourceVmKey || '').trim();
  const nad = String(networkNad || '').trim();
  if (!vm || !nad) return '';
  return `${vm}::${nad}`;
}

export function listOvnMirrorOccupiedSourceNicKeys(rows: OvnMirrorTableRow[]): string[] {
  return [...new Set(rows.flatMap((r) => listOvnMirrorNicKeysFromRow(r)))];
}

/** 已有规则中作为源出现过的虚拟机（任意网卡） */
export function listOvnMirrorOccupiedSourceVmKeys(rows: OvnMirrorTableRow[]): string[] {
  return [
    ...new Set(
      rows
        .map((r) => `${String(r.sourceNamespace || '').trim()}/${String(r.sourceVmName || '').trim()}`)
        .filter((k) => k !== '/'),
    ),
  ];
}

/** 同一表单内每个源虚拟机网卡只能出现一次；每台虚拟机只能出现一次 */
export function assertUniqueOvnMirrorSourceNicKeys(
  entries: OvnMirrorSourceEntryFormValues[],
): void {
  const seenNic = new Set<string>();
  entries.forEach((entry, idx) => {
    const key = ovnMirrorSourceNicKey(
      String(entry?.sourceVmKey || ''),
      String(entry?.networkNad || ''),
    );
    if (!key) return;
    if (seenNic.has(key)) {
      throw new Error(`源网卡 ${idx + 1}：该虚拟机网卡已被占用`);
    }
    seenNic.add(key);
  });
}

function buildRulesForSourceVm(
  vmEntry: OvnMirrorSourceVmFormValues,
  endpoint: { namespace: string; vmName: string; networkNad: string },
  entryLabel: string,
): { namespace: string; vmName: string; rules: OvnMirrorRulePayload[] } {
  const nicEntries = vmEntry.nicEntries || [];
  if (nicEntries.length === 0) {
    throw new Error(`${entryLabel}：请至少添加一个网卡`);
  }

  let namespace = '';
  let vmName = '';
  const crRules: OvnMirrorRulePayload[] = [];

  nicEntries.forEach((nic, nicIdx) => {
    const flat: OvnMirrorSourceEntryFormValues = {
      sourceVmKey: vmEntry.sourceVmKey,
      sourceNamespace: vmEntry.sourceNamespace,
      networkNad: nic.networkNad,
      filterRules: nic.filterRules,
    };
    const label = `${entryLabel} · 网卡 ${nicIdx + 1}`;
    const built = buildRulesForEntry(flat, endpoint, label);
    if (!namespace && !vmName) {
      namespace = built.namespace;
      vmName = built.vmName;
    } else if (namespace !== built.namespace || vmName !== built.vmName) {
      throw new Error(`${entryLabel}：网卡条目须属于同一虚拟机`);
    }
    crRules.push(...built.rules);
  });

  return { namespace, vmName, rules: crRules };
}

/** 创建：每个源虚拟机对应一个 OvnMirror CR（CR 内可含多网卡 rules） */
export function ovnMirrorFormValuesToCreatePayloads(
  values: OvnMirrorFormValues,
  vms: unknown[],
  existingCrNames: string[] = [],
  occupiedSourceNicKeys: string[] = [],
  occupiedSourceVmKeys: string[] = [],
): OvnMirrorCreatePayload[] {
  const sourceVms = values.sourceVms || [];
  if (sourceVms.length === 0) throw new Error('请至少添加一个源虚拟机');

  const seenVm = new Set<string>();
  sourceVms.forEach((vmEntry, idx) => {
    const vmKey = String(vmEntry.sourceVmKey || '').trim();
    if (!vmKey) return;
    if (seenVm.has(vmKey)) {
      throw new Error(`源虚拟机 ${idx + 1}：不能重复添加同一虚拟机`);
    }
    seenVm.add(vmKey);
  });

  const flatEntries = flattenOvnMirrorFormNicEntries(values);
  assertUniqueOvnMirrorSourceNicKeys(flatEntries);

  const occupiedNic = new Set(
    occupiedSourceNicKeys.map((k) => String(k || '').trim()).filter(Boolean),
  );
  flatEntries.forEach((entry, entryIdx) => {
    const key = ovnMirrorSourceNicKey(
      String(entry.sourceVmKey || ''),
      String(entry.networkNad || ''),
    );
    if (key && occupiedNic.has(key)) {
      throw new Error(`源网卡 ${entryIdx + 1}：该虚拟机网卡已存在流量镜像规则`);
    }
  });

  const occupiedVm = new Set(
    occupiedSourceVmKeys.map((k) => String(k || '').trim()).filter(Boolean),
  );
  sourceVms.forEach((vmEntry, entryIdx) => {
    const vmKey = String(vmEntry.sourceVmKey || '').trim();
    if (vmKey && occupiedVm.has(vmKey)) {
      throw new Error(`源虚拟机 ${entryIdx + 1}：该虚拟机已存在流量镜像规则`);
    }
  });

  const endpoint = buildMirrorEndpoint(values.mirrorDestination || {});
  const reserved = new Set(
    existingCrNames.map((n) => String(n || '').trim()).filter(Boolean),
  );

  return sourceVms.map((vmEntry, entryIdx) => {
    const entryLabel = `源虚拟机 ${entryIdx + 1}`;
    const vmKey = String(vmEntry.sourceVmKey || '').trim();
    const vm = (Array.isArray(vms) ? vms : []).find((item) => vmRowKey(item) === vmKey);
    if (!vm) throw new Error(`${entryLabel}：未找到虚拟机`);

    const built = buildRulesForSourceVm(vmEntry, endpoint, entryLabel);
    const firstNic = String(vmEntry.nicEntries?.[0]?.networkNad || '').trim();
    const name = buildOvnMirrorCrName(vm, firstNic, reserved);
    return {
      name,
      spec: {
        vmName: built.vmName,
        namespace: built.namespace,
        rules: built.rules,
      },
    };
  });
}

/** 编辑：更新单个已有 CR */
export function ovnMirrorFormValuesToUpdateSpec(values: OvnMirrorFormValues): OvnMirrorSpecPayload {
  const sourceVms = values.sourceVms || [];
  if (sourceVms.length === 0) throw new Error('请至少添加一个源虚拟机');
  if (sourceVms.length > 1) {
    throw new Error('编辑单个流量镜像时，仅支持一个源虚拟机');
  }

  const endpoint = buildMirrorEndpoint(values.mirrorDestination || {});
  const built = buildRulesForSourceVm(sourceVms[0], endpoint, '源虚拟机');
  return { vmName: built.vmName, namespace: built.namespace, rules: built.rules };
}

export function defaultOvnMirrorFormValues(): OvnMirrorFormValues {
  return {
    mirrorDestination: { destVmKey: '', networkNad: '' },
    sourceVms: [defaultOvnMirrorSourceVm()],
  };
}

export function resolveOvnMirrorSourceVmAlias(
  sourceNamespace: string,
  sourceVmName: string,
  vms: unknown[],
): string {
  const key = `${sourceNamespace}/${sourceVmName}`;
  const vm = (Array.isArray(vms) ? vms : []).find((item) => vmRowKey(item) === key);
  return vm ? vmDisplayAlias(vm) : sourceVmName;
}
