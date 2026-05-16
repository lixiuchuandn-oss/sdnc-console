/**
 * 创建向导 / 网卡变配：多网卡 MAC、静态 IP 重复校验；静态 IP 须落在所选子网 CIDR；
 * 与集群内其它虚拟机 MAC / Kube-OVN custom-ip 冲突检测。
 */
import { kubeOvnCustomIpEntryName } from "../modals/VmCreateWizard/VmWizardUtils";
import { isIpv4AddressInCidr } from "../../kube-ovn/lib/flatSubnetExcludeIpValidation";
import { subnetCidrOf } from "../../kube-ovn/lib/subnetVmPicker";
import { subnetKey } from "./kubeOvnSubnetNadSelect";
import { parseHarvesterCustomIpList } from "./vmNicManageLogic";
import type { VmNicEditorSlice } from "./vmNicManageLogic";

/** 去分隔符后转大写再规范为 aa:bb:...，非法 MAC 返回空串（不参与冲突比较） */
export function normalizeMacForNicConflictCompare(raw: string): string {
  const hex = String(raw || "")
    .trim()
    .replace(/[:-]/g, "")
    .toUpperCase();
  if (!/^[0-9A-F]{12}$/.test(hex)) return "";
  return hex.match(/.{2}/g)!.join(":");
}

/** 取 IPv4 主机部分（去掉 /掩码） */
export function normalizeIpv4Host(raw: string): string {
  const s = String(raw ?? "")
    .trim()
    .split("/")[0]!
    .trim();
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) return "";
  return s;
}

function findKubeOvnSubnetRow(
  kubeSubnets: any[],
  subnetName: string,
  vpcId?: string,
): any | null {
  const sn = String(subnetName || "").trim();
  if (!sn || !Array.isArray(kubeSubnets)) return null;
  const wantVpc = vpcId != null ? String(vpcId).trim() : "";
  for (const s of kubeSubnets) {
    if (subnetKey(s) !== sn) continue;
    if (wantVpc) {
      const sv = String(s?.spec?.vpc || s?.vpc || "").trim();
      if (sv !== wantVpc) continue;
    }
    return s;
  }
  return null;
}

function vmRowIdentity(vm: any): { ns: string; name: string } {
  const ns = String(vm?.namespace || vm?.metadata?.namespace || "").trim();
  const name = String(vm?.name || vm?.metadata?.name || "").trim();
  return { ns, name };
}

/** ECS/VM 行展示名：优先 metadata.annotations['tower.io/alias'] */
export function harvesterVmDisplayLabel(vm: any): string {
  const alias = String(vm?.metadata?.annotations?.["tower.io/alias"] ?? "").trim();
  if (alias) return alias;
  const n = String(vm?.name || vm?.metadata?.name || "").trim();
  return n || "其它虚拟机";
}

/** VM 注解里 custom-ip 条目的 name 与向导计算的 entryName 对齐（支持 ns/name 与仅子网名） */
function customIpAnnotationNameMatches(vmEntryName: string, ourKey: string): boolean {
  const a = String(vmEntryName || "").trim();
  const b = String(ourKey || "").trim();
  if (!a || !b) return false;
  if (a === b) return true;
  const tailA = a.includes("/") ? String(a.split("/").pop() || "").trim() : a;
  const tailB = b.includes("/") ? String(b.split("/").pop() || "").trim() : b;
  if (tailA && tailB && tailA === tailB) return true;
  if (a.endsWith(`/${b}`) || b.endsWith(`/${a}`)) return true;
  return false;
}

/**
 * 在目标命名空间内查找与静态 IP 冲突的 custom-ip 记录。
 * 先按条目名（模糊）+ IP；若无命中再按同 IP 任意条目（避免创建向导 entryName 与存量写法不一致导致漏报）。
 */
function findPeerCustomIpStaticConflict(
  ipHost: string,
  peerVms: any[],
  targetNs: string,
  exclude: { ns: string; name: string } | undefined,
  preferEntryName: string,
): { vm: any; entryKey: string } | null {
  if (!ipHost || !String(targetNs || "").trim()) return null;
  const tryMatch = (namePredicate: (en: string) => boolean): { vm: any; entryKey: string } | null => {
    for (const vm of peerVms || []) {
      const id = vmRowIdentity(vm);
      if (exclude && id.ns === exclude.ns && id.name === exclude.name) continue;
      if (id.ns !== targetNs) continue;
      const custom = parseHarvesterCustomIpList(vm);
      for (const e of custom) {
        const ih = normalizeIpv4Host(String(e.ip || ""));
        if (ih !== ipHost) continue;
        const en = String(e.name || "").trim();
        if (namePredicate(en)) return { vm, entryKey: en };
      }
    }
    return null;
  };
  const pref = String(preferEntryName || "").trim();
  if (pref) {
    const named = tryMatch((en) => customIpAnnotationNameMatches(en, pref));
    if (named) return named;
  }
  return tryMatch(() => true);
}

/** 向导 MAC 完整格式（与 StepNetworks 一致） */
export const WIZARD_MAC_FIELD_PATTERN =
  /^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/;

/** 向导静态 IP 完整格式（与 StepNetworks 一致） */
export const WIZARD_STATIC_IP_FIELD_PATTERN =
  /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(?:\/(?:3[0-2]|[12]?[0-9]|[0-9]))?$/;

function peerMacConflictMessage(
  macNorm: string,
  peerVms: any[],
  targetNs: string,
  exclude?: { ns: string; name: string },
): string | undefined {
  if (!macNorm || !String(targetNs || "").trim()) return undefined;
  const exNs = exclude?.ns?.trim();
  const exName = exclude?.name?.trim();
  for (const vm of peerVms || []) {
    const id = vmRowIdentity(vm);
    if (exNs && exName && id.ns === exNs && id.name === exName) continue;
    if (id.ns !== targetNs) continue;
    const macs = Array.isArray(vm?.macAddresses) ? vm.macAddresses : [];
    for (const ex of macs) {
      if (normalizeMacForNicConflictCompare(String(ex)) === macNorm) {
        const vn = harvesterVmDisplayLabel(vm);
        return `该 MAC 已被虚拟机「${vn}」使用`;
      }
    }
  }
  return undefined;
}

function peerCustomIpConflictMessage(
  entryName: string,
  ipHost: string,
  peerVms: any[],
  targetNs: string,
  exclude?: { ns: string; name: string },
): string | undefined {
  if (!ipHost || !String(targetNs || "").trim()) return undefined;
  const hit = findPeerCustomIpStaticConflict(
    ipHost,
    peerVms,
    targetNs,
    exclude,
    String(entryName || "").trim(),
  );
  if (!hit) return undefined;
  const lbl = harvesterVmDisplayLabel(hit.vm);
  const ek = String(hit.entryKey || "").trim() || String(entryName || "").trim() || "-";
  return `该静态 IP 已被虚拟机「${lbl}」占用（子网条目「${ek}」）`;
}

/** 创建向导 · 主网卡或辅网卡 MAC：与其它卡重复 / 与其它 VM 冲突（value 须为完整 MAC 才检高级项） */
export function wizardMacFieldInlineError(
  v: any,
  scope: "primary" | number,
  macInput: string | undefined,
  peerVms: any[],
  targetNamespace: string,
): string | undefined {
  const raw = String(macInput ?? "").trim();
  if (!raw) return undefined;
  if (!WIZARD_MAC_FIELD_PATTERN.test(raw)) return undefined;
  const me = normalizeMacForNicConflictCompare(raw);
  if (!me) return undefined;

  const slots: { key: string; mac: string }[] = [];
  const nm = String(v?.netMode || "");
  if (nm === "vpc" || nm === "flat_subnet") {
    const m = normalizeMacForNicConflictCompare(String(v?.primaryNic?.macAddress || ""));
    if (m) slots.push({ key: "primary", mac: m });
  }
  const list = Array.isArray(v?.netIfaces) ? v.netIfaces : [];
  list.forEach((nic: any, i: number) => {
    const m = String(nic?.mode || "");
    if (m !== "vpc" && m !== "flat_subnet") return;
    const mac = normalizeMacForNicConflictCompare(String(nic?.macAddress || ""));
    if (mac) slots.push({ key: `sec-${i}`, mac });
  });
  if (slots.filter((s) => s.mac === me).length > 1) {
    return "与其它网卡填写的 MAC 重复";
  }

  const ns = String(targetNamespace || "").trim();
  if (!ns) return undefined;
  return peerMacConflictMessage(me, peerVms, ns, undefined);
}

/** 创建向导 · 静态 IP：重复、网段、与其它 VM custom-ip 冲突 */
export function wizardIpFieldInlineError(
  v: any,
  scope: "primary" | number,
  ipInput: string | undefined,
  kubeSubnets: any[],
  peerVms: any[],
  targetNamespace: string,
): string | undefined {
  const raw = String(ipInput ?? "").trim();
  if (!raw) return undefined;
  if (!WIZARD_STATIC_IP_FIELD_PATTERN.test(raw)) return undefined;
  const host = normalizeIpv4Host(raw);
  if (!host) return undefined;

  const ipSlots: { key: string; ip: string }[] = [];
  const nm = String(v?.netMode || "");
  if (nm === "vpc" || nm === "flat_subnet") {
    const h = normalizeIpv4Host(String(v?.primaryNic?.ipAddress || "").trim());
    if (h) ipSlots.push({ key: "primary", ip: h });
  }
  const list = Array.isArray(v?.netIfaces) ? v.netIfaces : [];
  list.forEach((nic: any, i: number) => {
    const m = String(nic?.mode || "");
    if (m !== "vpc" && m !== "flat_subnet") return;
    const h = normalizeIpv4Host(String(nic?.ipAddress || "").trim());
    if (h) ipSlots.push({ key: `sec-${i}`, ip: h });
  });
  if (ipSlots.filter((s) => s.ip === host).length > 1) {
    return "与其它网卡填写的静态 IP 重复";
  }

  let subnet = "";
  let vpc: string | undefined;
  let multus = "";
  if (scope === "primary") {
    const pn = v?.primaryNic || {};
    subnet = String(pn.subnet || "").trim();
    vpc = String(pn.vpc || "").trim() || undefined;
    multus = String(pn.name || "").trim();
  } else {
    const nic = list[scope] || {};
    subnet = String(nic.subnet || "").trim();
    vpc = String(nic.vpc || "").trim() || undefined;
    multus = String(nic.name || "").trim();
  }
  if (subnet) {
    const subRow = findKubeOvnSubnetRow(kubeSubnets, subnet, vpc);
    const cidr = subRow ? String(subnetCidrOf(subRow) || "").trim() : "";
    if (!cidr || !cidr.includes("/")) {
      return "未找到所选子网的网段信息，请确认子网或刷新后再试";
    }
    if (!isIpv4AddressInCidr(host, cidr)) {
      return `不在子网网段「${cidr}」内`;
    }
  }

  const entryName = kubeOvnCustomIpEntryName(subnet, multus);
  const ns = String(targetNamespace || "").trim();
  if (!ns) return undefined;
  return peerCustomIpConflictMessage(entryName, host, peerVms, ns, undefined);
}

/** 网卡变配 · 单卡 MAC 行下提示 */
export function reconfigureMacFieldInlineError(
  nicUi: VmNicEditorSlice[],
  idx: number,
  macInput: string | undefined,
  peerVms: any[],
  vmNs: string,
  vmName: string,
): string | undefined {
  const slice = nicUi[idx];
  if (!slice || (slice.netMode !== "vpc" && slice.netMode !== "flat_subnet")) {
    return undefined;
  }
  const raw = String(macInput ?? "").trim();
  if (!raw) return undefined;
  if (!WIZARD_MAC_FIELD_PATTERN.test(raw)) return undefined;
  const me = normalizeMacForNicConflictCompare(raw);
  if (!me) return undefined;

  const slots: string[] = [];
  for (let i = 0; i < nicUi.length; i++) {
    const s = nicUi[i];
    if (!s || (s.netMode !== "vpc" && s.netMode !== "flat_subnet")) continue;
    const m = normalizeMacForNicConflictCompare(String(s.macAddress || ""));
    if (m) slots.push(m);
  }
  if (slots.filter((x) => x === me).length > 1) {
    return "与其它网卡填写的 MAC 重复";
  }
  const ns = String(vmNs || "").trim();
  const ex = { ns, name: String(vmName || "").trim() };
  if (!ns) return undefined;
  return peerMacConflictMessage(me, peerVms, ns, ex);
}

/** 网卡变配 · 单卡静态 IP 行下提示 */
export function reconfigureIpFieldInlineError(
  nicUi: VmNicEditorSlice[],
  networks: any[],
  idx: number,
  ipInput: string | undefined,
  kubeSubnets: any[],
  peerVms: any[],
  vmNs: string,
  vmName: string,
): string | undefined {
  const slice = nicUi[idx];
  if (!slice || (slice.netMode !== "vpc" && slice.netMode !== "flat_subnet")) {
    return undefined;
  }
  const raw = String(ipInput ?? "").trim();
  if (!raw) return undefined;
  if (!WIZARD_STATIC_IP_FIELD_PATTERN.test(raw)) return undefined;
  const host = normalizeIpv4Host(raw);
  if (!host) return undefined;

  const hosts: string[] = [];
  for (let i = 0; i < nicUi.length; i++) {
    const s = nicUi[i];
    if (!s || (s.netMode !== "vpc" && s.netMode !== "flat_subnet")) continue;
    const h = normalizeIpv4Host(String(s.ipAddress || "").trim());
    if (h) hosts.push(h);
  }
  if (hosts.filter((x) => x === host).length > 1) {
    return "与其它网卡填写的静态 IP 重复";
  }

  const subnet = String(slice.subnet || "").trim();
  const vpc = String(slice.vpc || "").trim() || undefined;
  if (subnet) {
    const subRow = findKubeOvnSubnetRow(kubeSubnets, subnet, vpc);
    const cidr = subRow ? String(subnetCidrOf(subRow) || "").trim() : "";
    if (!cidr || !cidr.includes("/")) {
      return "未找到所选子网的网段信息，请确认子网或刷新后再试";
    }
    if (!isIpv4AddressInCidr(host, cidr)) {
      return `不在子网网段「${cidr}」内`;
    }
  }

  const multus = String(networks[idx]?.multus?.networkName || "").trim();
  const entryName = kubeOvnCustomIpEntryName(subnet, multus);
  const ns = String(vmNs || "").trim();
  const ex = { ns, name: String(vmName || "").trim() };
  if (!ns) return undefined;
  return peerCustomIpConflictMessage(entryName, host, peerVms, ns, ex);
}

/** 创建向导：多网卡 MAC/IP 重复 + 静态 IP 落在子网 CIDR */
export function validateVmCreateWizardNicsMacIpAndSubnet(
  v: any,
  kubeSubnets: any[],
): string | null {
  type Row = {
    label: string;
    mac: string;
    ip: string;
    subnet: string;
    vpc?: string;
  };
  const rows: Row[] = [];
  const nm = String(v?.netMode || "");
  if (nm === "vpc" || nm === "flat_subnet") {
    const pn = v?.primaryNic || {};
    const mac = normalizeMacForNicConflictCompare(String(pn.macAddress || ""));
    const ip = normalizeIpv4Host(String(pn.ipAddress || "").trim());
    const subnet = String(pn.subnet || "").trim();
    const vpc = String(pn.vpc || "").trim() || undefined;
    rows.push({ label: "主网卡", mac, ip, subnet, vpc });
  }
  const list = Array.isArray(v?.netIfaces) ? v.netIfaces : [];
  list.forEach((nic: any, i: number) => {
    const m = String(nic?.mode || "");
    if (m !== "vpc" && m !== "flat_subnet") return;
    const mac = normalizeMacForNicConflictCompare(String(nic.macAddress || ""));
    const ip = normalizeIpv4Host(String(nic.ipAddress || "").trim());
    const subnet = String(nic.subnet || "").trim();
    const vpc = String(nic.vpc || "").trim() || undefined;
    rows.push({ label: `辅助网卡 ${i + 2}`, mac, ip, subnet, vpc });
  });

  const macLabels = new Map<string, string[]>();
  const ipLabels = new Map<string, string[]>();
  for (const r of rows) {
    if (r.mac) {
      const arr = macLabels.get(r.mac) || [];
      arr.push(r.label);
      macLabels.set(r.mac, arr);
    }
    if (r.ip) {
      const arr = ipLabels.get(r.ip) || [];
      arr.push(r.label);
      ipLabels.set(r.ip, arr);
    }
  }
  for (const [mk, labels] of macLabels) {
    if (labels.length > 1) {
      return `MAC 地址「${mk}」在 ${labels.join("、")} 重复填写，请改为互不重复后再提交`;
    }
  }
  for (const [ip, labels] of ipLabels) {
    if (labels.length > 1) {
      return `静态 IP「${ip}」在 ${labels.join("、")} 重复填写，请改为互不重复后再提交`;
    }
  }

  for (const r of rows) {
    if (!r.ip) continue;
    const subRow = findKubeOvnSubnetRow(kubeSubnets, r.subnet, r.vpc);
    const cidr = subRow ? String(subnetCidrOf(subRow) || "").trim() : "";
    if (!cidr || !cidr.includes("/")) {
      return `「${r.label}」填写了静态 IP「${r.ip}」，但未找到子网「${r.subnet}」的有效网段信息，请核对子网或刷新后再试`;
    }
    if (!isIpv4AddressInCidr(r.ip, cidr)) {
      return `「${r.label}」的静态 IP「${r.ip}」不在子网「${r.subnet}」的网段「${cidr}」内`;
    }
  }
  return null;
}

/** 创建向导：与同命名空间下已有虚拟机 MAC / custom-ip 静态 IP 冲突 */
export function validateVmCreateWizardNicsAgainstPeerVms(
  v: any,
  existingVms: any[],
  targetNamespace: string,
): string | null {
  const ns = String(targetNamespace || "").trim();
  if (!ns) return null;

  type Row = {
    label: string;
    mac: string;
    ipHost: string;
    entryName: string;
  };
  const rows: Row[] = [];
  const nm = String(v?.netMode || "");
  if (nm === "vpc" || nm === "flat_subnet") {
    const pn = v?.primaryNic || {};
    const mac = normalizeMacForNicConflictCompare(String(pn.macAddress || ""));
    const ipRaw = String(pn.ipAddress || "").trim();
    const ipHost = normalizeIpv4Host(ipRaw);
    const sub = String(pn.subnet || "").trim();
    const multus = String(pn.name || "").trim();
    const entryName = kubeOvnCustomIpEntryName(sub, multus);
    rows.push({ label: "主网卡", mac, ipHost, entryName });
  }
  const list = Array.isArray(v?.netIfaces) ? v.netIfaces : [];
  list.forEach((nic: any, i: number) => {
    const m = String(nic?.mode || "");
    if (m !== "vpc" && m !== "flat_subnet") return;
    const mac = normalizeMacForNicConflictCompare(String(nic.macAddress || ""));
    const ipHost = normalizeIpv4Host(String(nic.ipAddress || "").trim());
    const sub = String(nic.subnet || "").trim();
    const multus = String(nic.name || "").trim();
    const entryName = kubeOvnCustomIpEntryName(sub, multus);
    rows.push({ label: `辅助网卡 ${i + 2}`, mac, ipHost, entryName });
  });

  const peers = (existingVms || []).filter((vm) => {
    const id = vmRowIdentity(vm);
    return id.ns === ns;
  });

  for (const r of rows) {
    if (!r.mac) continue;
    for (const vm of peers) {
      const macs = Array.isArray(vm?.macAddresses) ? vm.macAddresses : [];
      for (const ex of macs) {
        if (normalizeMacForNicConflictCompare(String(ex)) === r.mac) {
          const vn = harvesterVmDisplayLabel(vm);
          return `MAC 地址「${r.mac}」已被虚拟机「${vn}」使用，请更换后再提交`;
        }
      }
    }
  }

  for (const r of rows) {
    if (!r.ipHost) continue;
    const hit = findPeerCustomIpStaticConflict(
      r.ipHost,
      peers,
      ns,
      undefined,
      String(r.entryName || "").trim(),
    );
    if (hit) {
      const vn = harvesterVmDisplayLabel(hit.vm);
      const ek = String(hit.entryKey || "").trim() || String(r.entryName || "").trim() || "-";
      return `静态 IP「${r.ipHost}」（子网条目「${ek}」）已被虚拟机「${vn}」占用，请更换后再提交`;
    }
  }
  return null;
}

/** 网卡变配：多网卡 MAC/IP 重复 + 静态 IP 落在子网 CIDR */
export function validateVmReconfigureNicsMacIpAndSubnet(
  nicUi: VmNicEditorSlice[],
  kubeSubnets: any[],
): string | null {
  type Row = { label: string; mac: string; ip: string; subnet: string; vpc?: string };
  const rows: Row[] = [];
  for (let i = 0; i < nicUi.length; i++) {
    const slice = nicUi[i];
    if (!slice) continue;
    const mode = slice.netMode;
    if (mode !== "vpc" && mode !== "flat_subnet") continue;
    const mac = normalizeMacForNicConflictCompare(String(slice.macAddress || ""));
    const ip = normalizeIpv4Host(String(slice.ipAddress || "").trim());
    const subnet = String(slice.subnet || "").trim();
    const vpc = String(slice.vpc || "").trim() || undefined;
    rows.push({
      label: `网卡 ${i + 1}`,
      mac,
      ip,
      subnet,
      vpc,
    });
  }

  const macLabels = new Map<string, string[]>();
  const ipLabels = new Map<string, string[]>();
  for (const r of rows) {
    if (r.mac) {
      const arr = macLabels.get(r.mac) || [];
      arr.push(r.label);
      macLabels.set(r.mac, arr);
    }
    if (r.ip) {
      const arr = ipLabels.get(r.ip) || [];
      arr.push(r.label);
      ipLabels.set(r.ip, arr);
    }
  }
  for (const [mk, labels] of macLabels) {
    if (labels.length > 1) {
      return `MAC 地址「${mk}」在 ${labels.join("、")} 重复填写，请改为互不重复后再提交`;
    }
  }
  for (const [ip, labels] of ipLabels) {
    if (labels.length > 1) {
      return `静态 IP「${ip}」在 ${labels.join("、")} 重复填写，请改为互不重复后再提交`;
    }
  }

  for (let i = 0; i < nicUi.length; i++) {
    const slice = nicUi[i];
    if (!slice) continue;
    if (slice.netMode !== "vpc" && slice.netMode !== "flat_subnet") continue;
    const ip = normalizeIpv4Host(String(slice.ipAddress || "").trim());
    if (!ip) continue;
    const subnet = String(slice.subnet || "").trim();
    const vpc = String(slice.vpc || "").trim() || undefined;
    const subRow = findKubeOvnSubnetRow(kubeSubnets, subnet, vpc);
    const cidr = subRow ? String(subnetCidrOf(subRow) || "").trim() : "";
    const label = `网卡 ${i + 1}`;
    if (!cidr || !cidr.includes("/")) {
      return `「${label}」填写了静态 IP「${ip}」，但未找到子网「${subnet}」的有效网段信息，请核对子网或刷新后再试`;
    }
    if (!isIpv4AddressInCidr(ip, cidr)) {
      return `「${label}」的静态 IP「${ip}」不在子网「${subnet}」的网段「${cidr}」内`;
    }
  }

  return null;
}

/** 网卡变配：与同命名空间其它虚拟机冲突（排除当前 VM） */
export function validateVmReconfigureNicsAgainstPeerVms(
  nicUi: VmNicEditorSlice[],
  networks: any[],
  peerVms: any[],
  excludeNamespace: string,
  excludeVmName: string,
): string | null {
  const exNs = String(excludeNamespace || "").trim();
  const exName = String(excludeVmName || "").trim();

  type Row = { label: string; mac: string; ipHost: string; entryName: string };
  const rows: Row[] = [];
  for (let i = 0; i < nicUi.length; i++) {
    const slice = nicUi[i];
    if (!slice) continue;
    if (slice.netMode !== "vpc" && slice.netMode !== "flat_subnet") continue;
    const mac = normalizeMacForNicConflictCompare(String(slice.macAddress || ""));
    const ipHost = normalizeIpv4Host(String(slice.ipAddress || "").trim());
    const sub = String(slice.subnet || "").trim();
    const multus = String(networks[i]?.multus?.networkName || "").trim();
    const entryName = kubeOvnCustomIpEntryName(sub, multus);
    rows.push({
      label: `网卡 ${i + 1}`,
      mac,
      ipHost,
      entryName,
    });
  }

  const peers = (peerVms || []).filter((vm) => {
    const id = vmRowIdentity(vm);
    if (id.ns === exNs && id.name === exName) return false;
    return id.ns === exNs;
  });

  for (const r of rows) {
    if (!r.mac) continue;
    for (const vm of peers) {
      const macs = Array.isArray(vm?.macAddresses) ? vm.macAddresses : [];
      for (const ex of macs) {
        if (normalizeMacForNicConflictCompare(String(ex)) === r.mac) {
          const vn = harvesterVmDisplayLabel(vm);
          return `MAC 地址「${r.mac}」已被虚拟机「${vn}」使用，请更换后再提交`;
        }
      }
    }
  }

  for (const r of rows) {
    if (!r.ipHost) continue;
    const hit = findPeerCustomIpStaticConflict(
      r.ipHost,
      peers,
      exNs,
      { ns: exNs, name: exName },
      String(r.entryName || "").trim(),
    );
    if (hit) {
      const vn = harvesterVmDisplayLabel(hit.vm);
      const ek = String(hit.entryKey || "").trim() || String(r.entryName || "").trim() || "-";
      return `静态 IP「${r.ipHost}」（子网条目「${ek}」）已被虚拟机「${vn}」占用，请更换后再提交`;
    }
  }
  return null;
}
