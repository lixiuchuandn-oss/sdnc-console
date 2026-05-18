/**
 * 创建向导 / 变配「直通网卡」共用的下拉选项：PCI（Claim 已直通）+ Multus NAD（SR-IOV/macvtap/macvlan）。
 */

export const PT_PREFIX_PCI = "pci:";
export const PT_PREFIX_MULTUS = "multus:";

/** 创建向导：整卡 PCI 直通（不含 SR-IOV 虚拟功能口） */
export const WIZARD_NET_MODE_PCI_PHYSICAL = "passthrough";
/** 创建向导：仅使用 SR-IOV 划分出的 VF 型 PCI 网卡 */
export const WIZARD_NET_MODE_PCI_SRIOV_VF = "passthrough_sriov";

export function isWizardPciPassthroughNetMode(m: string): boolean {
  const s = String(m || "");
  return s === WIZARD_NET_MODE_PCI_PHYSICAL || s === WIZARD_NET_MODE_PCI_SRIOV_VF;
}

/** 创建向导 / 网卡管理：PCI 直通模式下「选择设备」表单项标签 */
export function wizardPassthroughPickFieldLabel(mode: string | undefined | null): string {
  const s = String(mode || "").trim();
  if (s === WIZARD_NET_MODE_PCI_SRIOV_VF) return "直通SR-IOV";
  if (s === WIZARD_NET_MODE_PCI_PHYSICAL) return "直通网卡";
  return "直通网络";
}

export function wizardPassthroughPickRequiredMessage(mode: string | undefined | null): string {
  return `请选择${wizardPassthroughPickFieldLabel(mode)}`;
}

export type PassthroughSelectionExclusion = {
  pciCrNames: Set<string>;
  multusNadValues: Set<string>;
};

export type PassthroughSelectFilterOpts = {
  excludePciCrNames?: Iterable<string>;
  excludeMultusNadValues?: Iterable<string>;
  /** 当前编辑行已选 `passthroughPick`（`pci:` / `multus:`），仍保留在下拉中 */
  keepPassthroughPick?: string;
};

function passthroughPickToPciCrName(pick: string): string {
  const s = String(pick || "").trim();
  return s.startsWith(PT_PREFIX_PCI) ? s.slice(PT_PREFIX_PCI.length).trim() : "";
}

function passthroughPickToMultusValue(pick: string): string {
  const s = String(pick || "").trim();
  return s.startsWith(PT_PREFIX_MULTUS) ? s.slice(PT_PREFIX_MULTUS.length).trim() : "";
}

/** 从创建向导/变配表单的一行网卡提取已选直通 PCI / Multus */
export function addPassthroughNicSliceToExclusion(
  ex: PassthroughSelectionExclusion,
  nic: any,
): void {
  if (!nic || typeof nic !== "object") return;
  const pick = String(nic.passthroughPick || "").trim();
  const pciFromPick = passthroughPickToPciCrName(pick);
  if (pciFromPick) ex.pciCrNames.add(pciFromPick);
  const multusFromPick = passthroughPickToMultusValue(pick);
  if (multusFromPick) ex.multusNadValues.add(multusFromPick);

  if (String(nic.passthroughSource || "") === "pci-host") {
    const cr = String(nic.pciDeviceName || "").trim();
    if (cr) ex.pciCrNames.add(cr);
  }
  const multusName = String(nic.name || "").trim();
  if (
    multusName &&
    (String(nic.passthroughSource || "") === "multus" || !!multusFromPick)
  ) {
    ex.multusNadValues.add(multusName);
  }
}

/** 创建向导：汇总主网卡 + 辅网卡中已选直通项（可跳过当前编辑行） */
export function collectWizardPassthroughExclusions(opts: {
  netMode?: string;
  primaryNic?: any;
  netIfaces?: any[];
  skipPrimary?: boolean;
  skipSecondaryIndex?: number;
}): PassthroughSelectionExclusion {
  const ex: PassthroughSelectionExclusion = {
    pciCrNames: new Set(),
    multusNadValues: new Set(),
  };
  const nm = String(opts.netMode || "");
  if (isWizardPciPassthroughNetMode(nm) && !opts.skipPrimary && opts.primaryNic) {
    addPassthroughNicSliceToExclusion(ex, opts.primaryNic);
  }
  const ifaces = Array.isArray(opts.netIfaces) ? opts.netIfaces : [];
  ifaces.forEach((nic, idx) => {
    if (opts.skipSecondaryIndex === idx) return;
    if (!isWizardPciPassthroughNetMode(String(nic?.mode || ""))) return;
    addPassthroughNicSliceToExclusion(ex, nic);
  });
  return ex;
}

export function passthroughExclusionToFilterOpts(
  ex: PassthroughSelectionExclusion,
  keepPassthroughPick?: string,
): PassthroughSelectFilterOpts {
  return {
    excludePciCrNames: ex.pciCrNames,
    excludeMultusNadValues: ex.multusNadValues,
    keepPassthroughPick: keepPassthroughPick || undefined,
  };
}

/** 变配主抽屉：已绑定 PCI（含未保存）+ Multus 直通 interfaces */
export function collectVmNicManagePassthroughExclusions(opts: {
  pciBindings?: Array<{ pciCrName?: string }>;
  interfaces?: any[];
  networks?: any[];
}): PassthroughSelectionExclusion {
  const ex: PassthroughSelectionExclusion = {
    pciCrNames: new Set(),
    multusNadValues: new Set(),
  };
  for (const b of opts.pciBindings || []) {
    const cr = String(b?.pciCrName || "").trim();
    if (cr) ex.pciCrNames.add(cr);
  }
  const ifaces = Array.isArray(opts.interfaces) ? opts.interfaces : [];
  const nets = Array.isArray(opts.networks) ? opts.networks : [];
  for (const iface of ifaces) {
    if (!iface?.sriov && !iface?.macvtap) continue;
    const net = nets.find((n: any) => n?.name === iface?.name);
    const nn = String(net?.multus?.networkName || "").trim();
    if (nn) ex.multusNadValues.add(nn);
  }
  return ex;
}

function shouldExcludePciCr(
  cr: string,
  filter?: PassthroughSelectFilterOpts,
): boolean {
  if (!filter?.excludePciCrNames) return false;
  const keep = passthroughPickToPciCrName(String(filter.keepPassthroughPick || ""));
  if (keep && cr === keep) return false;
  for (const x of filter.excludePciCrNames) {
    if (String(x).trim() === cr) return true;
  }
  return false;
}

function shouldExcludeMultusNad(
  nadValue: string,
  filter?: PassthroughSelectFilterOpts,
): boolean {
  if (!filter?.excludeMultusNadValues) return false;
  const v = String(nadValue || "").trim();
  const keep = passthroughPickToMultusValue(String(filter.keepPassthroughPick || ""));
  if (keep && v === keep) return false;
  for (const x of filter.excludeMultusNadValues) {
    if (String(x).trim() === v) return true;
  }
  return false;
}


/** 与 `buildPciNicPassthroughSelectOptions` 第二参一致；`any` 表示不按 VF/整卡拆分（兼容旧调用） */
export type PciNicPassthroughSelectScope = "any" | "physical" | "sriov_vf";

export function pciPassthroughSelectScopeFromWizardNetMode(m: string): PciNicPassthroughSelectScope {
  const s = String(m || "");
  if (s === WIZARD_NET_MODE_PCI_SRIOV_VF) return "sriov_vf";
  if (s === WIZARD_NET_MODE_PCI_PHYSICAL) return "physical";
  return "any";
}

/**
 * 判断 PCIDevice 是否更像 SR-IOV 虚拟功能（VF）而非整卡物理口。
 * 依赖 Harvester/内核常见 description 与部分 CR 字段；若集群未标注 VF，列表可能为空或仍有误分，可再按真实 CR 增补规则。
 */
export function isPciNicSrIovVirtualFunctionPciDevice(raw: any): boolean {
  const desc = String(
    raw?.status?.description ?? raw?.spec?.description ?? raw?.description ?? "",
  ).toLowerCase();
  if (desc.includes("virtual function") || desc.includes("virtfn")) return true;
  if (/\bvf\s*\d+\b/.test(desc)) return true;
  const name = String(raw?.metadata?.name ?? "").toLowerCase();
  if (name.includes("virtualfunction") || name.includes("virtfn")) return true;

  const vf =
    raw?.status?.virtualFunction ??
    raw?.spec?.virtualFunction ??
    raw?.status?.vf ??
    raw?.spec?.vf;
  if (vf === true) return true;
  if (typeof vf === "number" && vf > 0) return true;

  const labels = raw?.metadata?.labels || {};
  for (const k of Object.keys(labels)) {
    const kl = String(k).toLowerCase();
    if (kl.includes("virtfn") || kl.includes("virtual-function")) return true;
  }
  return false;
}

export type PciNicPassthroughSelectOption = {
  label: string;
  value: string;
  _pciRaw?: any;
  _pciNodeName?: string;
  _pciResourceName?: string;
  _pciCrName?: string;
};

export function isVmHostDeviceUsbLike(d: any): boolean {
  const dn = String(d?.deviceName || "").toLowerCase();
  const n = String(d?.name || "").toLowerCase();
  return n.startsWith("usb") || dn.includes("usb");
}

export function isVmHostDeviceGpuLike(d: any): boolean {
  if (isVmHostDeviceUsbLike(d)) return false;
  const dn = String(d?.deviceName || "").toLowerCase();
  const n = String(d?.name || "").toLowerCase();
  if (n.startsWith("gpu")) return true;
  if (dn.startsWith("nvidia.com/")) return true;
  return false;
}

/**
 * 当前 VM 已绑定的 PCIDevice CR 名（hostDevices 中非 GPU/USB + deviceAllocationDetails.hostdevices）。
 * 与后端 pciVmAllocation 收集规则一致，用于变配抽屉展示「已直通」列表。
 */
export function collectVmPassthroughPciCrNames(vm: any): Set<string> {
  const into = new Set<string>();
  const push = (s: unknown) => {
    const t = String(s ?? "").trim();
    if (t) into.add(t);
  };
  try {
    const raw = vm?.metadata?.annotations?.["harvesterhci.io/deviceAllocationDetails"];
    if (raw) {
      const p = typeof raw === "string" ? JSON.parse(raw) : raw;
      const hd = p?.hostdevices;
      if (hd && typeof hd === "object") {
        for (const v of Object.values(hd)) {
          if (Array.isArray(v)) (v as unknown[]).forEach((x) => push(x));
        }
      }
    }
  } catch {
    /* ignore */
  }
  const hostDevices = vm?.spec?.template?.spec?.domain?.devices?.hostDevices;
  if (Array.isArray(hostDevices)) {
    for (const h of hostDevices) {
      if (isVmHostDeviceGpuLike(h) || isVmHostDeviceUsbLike(h)) continue;
      push(h?.name);
    }
  }
  return into;
}

/** 解析 PCIDevice 行的 PCI 总线地址（BDF），供下拉与摘要展示 */
function pciRowPciAddress(raw: any): string {
  return String(
    raw?.status?.pciAddress ??
      raw?.status?.address ??
      raw?.spec?.pciAddress ??
      raw?.spec?.address ??
      "",
  ).trim();
}

/**
 * @param compact 为 true 时用于下拉：资源名（与 hostDevices.deviceName 一致）+ PCI 号；缺省时退回 CR 名
 */
function pciRowLabel(raw: any, crFallback: string, compact?: boolean): string {
  const cr = String(raw?.metadata?.name ?? crFallback ?? "").trim() || crFallback;
  const addr = pciRowPciAddress(raw);
  if (compact) {
    const rn = String(raw?.status?.resourceName ?? raw?.spec?.resourceName ?? "").trim();
    const base = rn || cr;
    return addr ? `${base} · PCI ${addr}` : base;
  }
  const node = String(raw?.status?.nodeName ?? raw?.spec?.nodeName ?? "").trim();
  const desc = String(raw?.status?.description ?? raw?.spec?.description ?? "").trim();
  const labelBits = [
    desc || cr,
    node ? `节点 ${node}` : "",
    addr ? `PCI ${addr}` : "",
  ].filter(Boolean);
  return labelBits.join(" · ");
}

/** Multus 直通项：去掉「· 类型」尾缀与括号内 VLAN 说明，便于下拉单行展示 */
function stripPassthroughNadOptionVerboseLabel(lbl: string): string {
  let s = String(lbl || "").trim();
  if (!s) return s;
  const dot = s.indexOf(" · ");
  if (dot >= 0) s = s.slice(0, dot).trim();
  s = s.replace(/\s*\([^)]*VLAN\s+\d+[^)]*\)\s*/gi, " ").replace(/\s+/g, " ").trim();
  return s || String(lbl || "").trim();
}

function resolvePciResourceNameFromVmAllocation(vm: any, pciCrName: string): string {
  const cr = String(pciCrName || "").trim();
  if (!cr) return "";
  try {
    const raw = vm?.metadata?.annotations?.["harvesterhci.io/deviceAllocationDetails"];
    if (!raw) return "";
    const p = typeof raw === "string" ? JSON.parse(raw) : raw;
    const hd = p?.hostdevices;
    if (!hd || typeof hd !== "object") return "";
    for (const [rn, arr] of Object.entries(hd)) {
      if (!Array.isArray(arr)) continue;
      if (arr.some((x) => String(x).trim() === cr)) return String(rn).trim();
    }
  } catch {
    /* ignore */
  }
  return "";
}

/** 本机 PCI 直通辅卡（以 hostDevices 为准；与 KubeVirt 规格一致） */
export type VmPciNicHostBinding = { pciCrName: string; deviceResourceName: string };

/** 变配保存：PCI 直通网卡 hostDevices 列表（与后端 pciNicHostDevices 约定一致） */
export function buildPciNicHostDevicesSpecPayload(
  bindings: VmPciNicHostBinding[],
): { name: string; deviceName: string }[] {
  return (Array.isArray(bindings) ? bindings : [])
    .map((b) => ({
      name: String(b?.pciCrName || "").trim(),
      deviceName: String(b?.deviceResourceName || "").trim(),
    }))
    .filter((x) => x.name && x.deviceName);
}

export function pciNicHostBindingsSnapshot(bindings: VmPciNicHostBinding[]): string {
  return JSON.stringify(
    (Array.isArray(bindings) ? bindings : []).map((b) => ({
      pciCrName: String(b?.pciCrName || "").trim(),
      deviceResourceName: String(b?.deviceResourceName || "").trim(),
    })),
  );
}

/**
 * VM 模板 nodeSelector 中的 kubernetes.io/hostname。
 * 来源含：创建向导「指定主机」、资源变配「节点调度」固定节点、或添加直通设备后自动写入。
 */
export function getVmTemplateFixedHostname(vm: any): string {
  return String(
    vm?.spec?.template?.spec?.nodeSelector?.["kubernetes.io/hostname"] || "",
  ).trim();
}

/**
 * 添加/校验直通网卡时应用的调度节点（聚合接口已合并 VMI status）。
 * 模板 nodeSelector 与运行节点不一致时，以 status.nodeName 为准（变配改固定节点后未重启、
 * 或列表缓存仍带创建时 node2 而实例已在 node1 等场景）。
 */
export function resolveVmPassthroughSchedulingHost(vm: any): string {
  const running = String(vm?.status?.nodeName || "").trim();
  const selector = getVmTemplateFixedHostname(vm);
  if (selector && running && selector !== running) {
    return running;
  }
  if (selector) return selector;
  return running;
}

/** 与节点调度变配、创建向导一致：模板已固定 hostname 时，PCI 须落在该节点。 */
export const PASSTHROUGH_PCI_FIXED_HOST_MISMATCH_MSG = (
  fixedHost: string,
  pciNode: string,
) =>
  `所选直通网卡位于节点 ${pciNode}，与虚拟机已固定节点 ${fixedHost} 不一致。请选择该节点上的网卡。`;

/**
 * 添加 PCI 直通/SR-IOV 辅卡：校验与有效调度节点、已有直通网卡所在节点一致。
 * @returns 错误文案；通过时返回 null
 */
export function validateAppendPassthroughPciNodeAffinity(opts: {
  vm: any;
  pciNodeName: string;
  bindNode?: string;
  pciDevices?: any[];
}): string | null {
  const pciNode = String(opts.pciNodeName || "").trim();
  const bindNode = String(opts.bindNode || "").trim();
  const schedulingHost = resolveVmPassthroughSchedulingHost(opts.vm);

  if (schedulingHost && bindNode && bindNode !== schedulingHost) {
    return `虚拟机调度/运行节点为 ${schedulingHost}，所选宿主机节点 ${bindNode} 不一致。请选择该节点上的直通网卡。`;
  }
  if (schedulingHost && pciNode && pciNode !== schedulingHost) {
    return PASSTHROUGH_PCI_FIXED_HOST_MISMATCH_MSG(schedulingHost, pciNode);
  }

  const existingNodes = collectVmPciPassthroughNicNodeNames(
    opts.vm,
    opts.pciDevices,
  );
  if (existingNodes.length > 1) {
    return "虚拟机已绑定多块位于不同节点的 PCI 直通/SR-IOV 网卡，无法继续添加直通网卡。";
  }
  if (existingNodes.length === 1 && pciNode) {
    const only = existingNodes[0];
    if (only && pciNode !== only) {
      return `所选直通网卡位于节点 ${pciNode}，与虚拟机已有直通网卡所在节点 ${only} 不一致。请选择同一节点上的网卡。`;
    }
  }
  if (existingNodes.length === 1 && !pciNode) {
    return "无法校验直通网卡所在节点：请刷新 PCI 设备列表后重试。";
  }

  return null;
}

/** 从 VM 已绑定的 PCI 直通/SR-IOV（hostDevices）解析所在节点（依赖 PCI 库存列表）。 */
export function collectVmPciPassthroughNicNodeNames(
  vm: any,
  pciDevices?: any[],
): string[] {
  const nodes = new Set<string>();
  const pciList = Array.isArray(pciDevices) ? pciDevices : [];
  for (const b of listVmPciNicHostBindings(vm)) {
    const cr = String(b.pciCrName || "").trim();
    if (!cr) continue;
    const raw = pciList.find(
      (p) => String(p?.metadata?.name || "").trim() === cr,
    );
    const node = String(
      raw?.status?.nodeName ?? raw?.spec?.nodeName ?? "",
    ).trim();
    if (node) nodes.add(node);
  }
  return [...nodes];
}

export function listVmPciNicHostBindings(vm: any): VmPciNicHostBinding[] {
  const ordered: VmPciNicHostBinding[] = [];
  const seen = new Set<string>();
  const hostDevices = vm?.spec?.template?.spec?.domain?.devices?.hostDevices;
  if (Array.isArray(hostDevices)) {
    for (const h of hostDevices) {
      if (isVmHostDeviceGpuLike(h) || isVmHostDeviceUsbLike(h)) continue;
      const pciCrName = String(h?.name || "").trim();
      if (!pciCrName || seen.has(pciCrName)) continue;
      seen.add(pciCrName);
      let deviceResourceName = String(h?.deviceName || "").trim();
      if (!deviceResourceName) {
        deviceResourceName = resolvePciResourceNameFromVmAllocation(vm, pciCrName);
      }
      ordered.push({ pciCrName, deviceResourceName });
    }
  }
  return ordered;
}

/** 用 PCI 库存行补全展示文案；无匹配时退回 CR 名 */
export function getPciDeviceInventoryLabel(pciDevices: any[], pciCrName: string): string {
  const cr = String(pciCrName || "").trim();
  if (!cr) return "";
  const raw = (Array.isArray(pciDevices) ? pciDevices : []).find(
    (p) => String(p?.metadata?.name || "").trim() === cr,
  );
  if (raw) return pciRowLabel(raw, cr);
  return cr;
}

/** 供变配直通抽屉：列出本机已直通 PCI 的可读行（优先用 PCI 清单补全描述） */
export function describeVmBoundPciNicLines(vmData: any, pciDevices: any[]): string[] {
  const crSet = collectVmPassthroughPciCrNames(vmData);
  const pciList = Array.isArray(pciDevices) ? pciDevices : [];
  const lines: string[] = [];
  for (const cr of crSet) {
    const raw = pciList.find((p) => String(p?.metadata?.name || "").trim() === cr);
    if (raw) lines.push(pciRowLabel(raw, cr));
    else lines.push(`${cr}（未在 PCI 清单中匹配到详情，可刷新 PCI 列表后重试）`);
  }
  return lines.sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

/** 与 useHarvesterData.pciNicPassthroughOptions 一致：仅 class 02* 且 Claim 已启用直通；已分配给任意 VM 的 PCI 网卡不下拉展示 */
export function buildPciNicPassthroughSelectOptions(
  pciDevices: any[],
  pciScope: PciNicPassthroughSelectScope = "any",
  filter?: PassthroughSelectFilterOpts,
): PciNicPassthroughSelectOption[] {
  const list = Array.isArray(pciDevices) ? pciDevices : [];
  const out: PciNicPassthroughSelectOption[] = [];
  for (const raw of list) {
    const classId = String(raw?.status?.classId ?? raw?.spec?.classId ?? "")
      .toLowerCase()
      .replace(/^0x/, "");
    const rn = String(raw?.status?.resourceName ?? raw?.spec?.resourceName ?? "").trim();
    if (!rn || !classId.startsWith("02")) continue;
    if (raw?._tower?.passthroughEnabled !== true) continue;
    if (raw?._tower?.pciAllocated === true) continue;

    if (pciScope === "physical" && isPciNicSrIovVirtualFunctionPciDevice(raw)) continue;
    if (pciScope === "sriov_vf" && !isPciNicSrIovVirtualFunctionPciDevice(raw)) continue;

    const cr = String(raw?.metadata?.name ?? "").trim();
    if (!cr) continue;
    if (shouldExcludePciCr(cr, filter)) continue;
    const node = String(raw?.status?.nodeName ?? raw?.spec?.nodeName ?? "").trim();
    out.push({
      label: pciRowLabel(raw, cr, true),
      value: `${PT_PREFIX_PCI}${cr}`,
      _pciRaw: raw,
      _pciNodeName: node,
      _pciResourceName: rn,
      _pciCrName: cr,
    });
  }
  return out;
}

/** NAD 项须含 label / value / _type（与 useHarvesterData.nadOptions、VmAddNicNadInfo 对齐） */
export function buildGroupedPassthroughSelectOptions(
  pciNicPassthroughOptions: PciNicPassthroughSelectOption[],
  nadOptions: ReadonlyArray<{ label?: unknown; value?: unknown; _type?: unknown }>,
  opts?: { pciGroupLabel?: string; compactPassthroughLabels?: boolean } & PassthroughSelectFilterOpts,
): { label: string; options: { label: unknown; value: string }[] }[] {
  const compactPassthroughLabels = opts?.compactPassthroughLabels === true;
  const nadPass = (nadOptions || []).filter((x: any) => {
    const t = String((x as any)?._type || "").toLowerCase();
    if (t) return t === "sriov" || t === "macvtap" || t === "macvlan";
    const lbl = String(x?.label || "").toLowerCase();
    return lbl.includes("sriov") || lbl.includes("macvtap") || lbl.includes("macvlan");
  });
  const nadPassFiltered = nadPass.filter((x: any) => {
    const v = String(x?.value || "").trim();
    return !shouldExcludeMultusNad(v, opts);
  });
  const multusGrouped = nadPassFiltered.map((x: any) => {
    const nadRes = String(x.value ?? "").trim();
    const full = String(x.label ?? "");
    /** compact：NAD 资源名 namespace/name（与库存 value 一致） */
    const label = compactPassthroughLabels
      ? nadRes || stripPassthroughNadOptionVerboseLabel(full)
      : full;
    return {
      ...x,
      label,
      value: `${PT_PREFIX_MULTUS}${nadRes}`,
    };
  });
  const pciFiltered = (pciNicPassthroughOptions || []).filter((x) => {
    const cr = String(x._pciCrName || passthroughPickToPciCrName(String(x.value || ""))).trim();
    return !shouldExcludePciCr(cr, opts);
  });
  const groups: { label: string; options: { label: unknown; value: string }[] }[] = [];
  const pciGroupLabel =
    String(opts?.pciGroupLabel || "").trim() || "PCI 网卡";
  if (pciFiltered.length > 0) {
    groups.push({
      label: pciGroupLabel,
      options: pciFiltered,
    });
  }
  if (multusGrouped.length > 0) {
    groups.push({
      label: "Multus 网络",
      options: multusGrouped,
    });
  }
  return groups;
}
