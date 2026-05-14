/**
 * 网卡管理抽屉：与创建向导主网卡字段对齐的初始化 / 应用 / cloud-init 合并。
 */
import yaml from "js-yaml";
import { KUBE_OVN_FLAT_VPC, isFlatKubeOvnSubnetVpc } from "../../kube-ovn/lib/kubeOvnSubnetConstants";
import { expectedMultusNadRefForSubnet } from "./kubeOvnMultusNadRef";
import {
  parseVmCloudInitNetworkData,
  generateMacAddressForStaticNic,
} from "./vmMutation/vmReconfigureCloudInit";

const SUBNET_TYPE_ANNOTATION = "tower.io/subnet-type";

export type VmNicNetMode =
  | "flat_subnet"
  | "vpc"
  | "passthrough"
  | "flat"
  | "pod";

export type VmNicEditorSlice = {
  netMode: VmNicNetMode;
  /** flat / passthrough：multus namespace/name */
  multusName: string;
  vpc: string | undefined;
  subnet: string | undefined;
  ifaceType: string;
  model: string;
  macAddress: string;
  ipAddress: string;
  gateway: string;
  dns: string;
};

function deepClone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

function isKubeOvnFlatSubnet(s: any): boolean {
  const t = String(s?.metadata?.annotations?.[SUBNET_TYPE_ANNOTATION] ?? "")
    .trim()
    .toLowerCase();
  return t === "flat";
}

function subnetNameFromNetworkName(networkName: string): string {
  if (!networkName) return "";
  return String(networkName).includes("/")
    ? String(networkName).split("/").pop() || ""
    : networkName;
}

function domainIfaceType(iface: any): string {
  if (iface?.sriov) return "sriov";
  if (iface?.macvtap) return "macvtap";
  if (iface?.masquerade) return "masquerade";
  if (iface?.bridge) return "bridge";
  if (String(iface?.binding?.name ?? "").toLowerCase() === "managedtap")
    return "managedtap";
  return "bridge";
}

export function nadOptionsWizardShape(nads: any[]) {
  return (Array.isArray(nads) ? nads : []).map((n: any) => {
    let type = "";
    let vlan: any;
    try {
      const cfg = JSON.parse(n?.spec?.config || "{}");
      type = cfg?.type || "";
      vlan = cfg?.vlan;
    } catch {
      /* ignore */
    }
    const id = n?.metadata?.name || "-";
    const alias = n?.metadata?.annotations?.["tower.io/alias"] || "";
    const labelBase = alias && alias !== id ? `${alias} (${id})` : id;
    const tag = type || "-";
    /** 网卡抽屉等只读一行：别名优先，不拼 CR 名 / 命名空间；可带 VLAN；不含 CNI 类型后缀 */
    const shortName = String(alias || "").trim() || id;
    const labelShort = vlan
      ? `${shortName} (VLAN ${vlan})`
      : shortName;
    const label = vlan
      ? `${labelBase} (VLAN ${vlan}) · ${tag}`
      : `${labelBase} · ${tag}`;
    return {
      label,
      labelShort,
      value: `${n.metadata.namespace}/${n.metadata.name}`,
      _type: String(type).toLowerCase(),
    };
  });
}

function nadOptionsFromList(nads: any[]): { value: string }[] {
  return (Array.isArray(nads) ? nads : [])
    .map((n: any) => ({
      value: `${n?.metadata?.namespace || "default"}/${n?.metadata?.name || ""}`,
    }))
    .filter((o) => o.value.length > 1 && !o.value.endsWith("/"));
}

export function buildKubevirtIface(
  type: string,
  ifaceName: string,
  model?: string,
  mac?: string,
): any {
  const iface: any = {
    name: ifaceName,
    model: model || "virtio",
  };
  const m = String(mac || "").trim();
  if (m) iface.macAddress = m;
  const t = String(type || "bridge").toLowerCase();
  if (t === "managedtap") iface.binding = { name: "managedtap" };
  else if (t === "bridge") iface.bridge = {};
  else if (t === "masquerade") iface.masquerade = {};
  else if (t === "sriov") iface.sriov = {};
  else if (t === "macvtap") iface.macvtap = {};
  else iface.bridge = {};
  return iface;
}

export function buildNetworkEntry(ifaceName: string, multusName: string | null): any {
  if (!multusName) {
    return { name: ifaceName, pod: {} };
  }
  return { name: ifaceName, multus: { networkName: multusName } };
}

function resolveMultus(
  netMode: VmNicNetMode,
  pnic: {
    name?: string;
    subnet?: string;
    vpc?: string;
  },
  subnets: any[],
  nads: any[],
): string | null {
  const p = pnic || {};
  if (netMode === "pod") return null;
  if (netMode === "flat") {
    const n = String(p.name || "").trim();
    return n || null;
  }
  if (netMode === "passthrough") {
    return String(p.name || "").trim() || null;
  }
  const subnetName = String(p.subnet || "").trim();
  if (!subnetName) {
    return String(p.name || "").trim() || null;
  }
  const vpc = p.vpc;
  const subnetObj = (subnets || []).find((s: any) => {
    const nm = s?.metadata?.name || s?.name;
    if (nm !== subnetName) return false;
    if (netMode === "vpc" && vpc != null && vpc !== "") {
      return String(s?.spec?.vpc || s?.vpc) === String(vpc);
    }
    return true;
  });
  const ref = subnetObj
    ? expectedMultusNadRefForSubnet(subnetObj, vpc, nadOptionsFromList(nads))
    : undefined;
  if (ref) return ref;
  return String(p.name || "").trim() || null;
}

function readEthernetForIface(
  networkDataObj: any,
  ifaceName: string,
  mac?: string,
): { ip?: string; gateway?: string; dns?: string } {
  const ethAll = networkDataObj?.network?.ethernets || {};
  let eth = ethAll[ifaceName];
  if (!eth && mac) {
    eth = Object.values(ethAll).find(
      (e: any) =>
        String(e?.match?.macaddress || "").toLowerCase() ===
        String(mac).toLowerCase(),
    ) as any;
  }
  if (!eth) return {};
  const ip =
    eth.addresses && eth.addresses.length > 0 ? String(eth.addresses[0]) : "";
  const gateway = eth.gateway4 ? String(eth.gateway4) : "";
  const dns =
    eth.nameservers?.addresses && eth.nameservers.addresses.length > 0
      ? eth.nameservers.addresses.join(", ")
      : "";
  return { ip, gateway, dns };
}

/** 从当前 VM 与单块网卡解析编辑器切片（对齐变配 init / networkNics） */
export function initNicEditorSlice(
  vmData: any,
  iface: any,
  net: any,
  subnets: any[],
): VmNicEditorSlice {
  const nd = parseVmCloudInitNetworkData(vmData);
  const mac = iface?.macAddress ? String(iface.macAddress) : "";
  const eth = readEthernetForIface(nd, iface?.name || "", mac);

  if (net?.pod) {
    return {
      netMode: "pod",
      multusName: "",
      vpc: undefined,
      subnet: undefined,
      ifaceType: domainIfaceType(iface),
      model: iface?.model || "virtio",
      macAddress: mac,
      ipAddress: eth.ip || "",
      gateway: eth.gateway || "",
      dns: eth.dns || "",
    };
  }

  const networkName = net?.multus?.networkName || "";
  const subnetName = subnetNameFromNetworkName(networkName);
  const type = domainIfaceType(iface);
  const targetSubnet = (subnets || []).find(
    (s: any) => (s?.metadata?.name || s?.name) === subnetName,
  );
  const subnetType = String(
    targetSubnet?.metadata?.annotations?.[SUBNET_TYPE_ANNOTATION] || "",
  )
    .trim()
    .toLowerCase();
  const isVpcSubnet = subnetType === "vpc";
  const netMode: VmNicNetMode =
    type === "managedtap"
      ? isVpcSubnet
        ? "vpc"
        : "flat_subnet"
      : type === "sriov" || type === "macvtap"
        ? "passthrough"
        : isVpcSubnet
          ? "vpc"
          : "flat";

  const vpcVal =
    netMode === "vpc"
      ? targetSubnet?.spec?.vpc || targetSubnet?.vpc
      : netMode === "flat_subnet"
        ? String(
            targetSubnet?.spec?.vpc ||
              targetSubnet?.vpc ||
              KUBE_OVN_FLAT_VPC,
          ).trim() || KUBE_OVN_FLAT_VPC
        : undefined;

  return {
    netMode,
    multusName: networkName,
    vpc: vpcVal,
    subnet: subnetName || undefined,
    /** NAD（flat）固定 bridge，与创建向导 / 添加 NAD 网卡抽屉一致 */
    ifaceType: netMode === "flat" ? "bridge" : type,
    model: iface?.model || "virtio",
    macAddress: mac,
    ipAddress: eth.ip || "",
    gateway: eth.gateway || "",
    dns: eth.dns || "",
  };
}

export function applySliceToIfaceNet(
  slice: VmNicEditorSlice,
  ifaceName: string,
  subnets: any[],
  nads: any[],
): { iface: any; net: any } {
  if (slice.netMode === "pod") {
    const t = String(slice.ifaceType || "masquerade").toLowerCase();
    const virtType =
      t === "bridge" || t === "masquerade" ? t : "masquerade";
    return {
      iface: buildKubevirtIface(
        virtType,
        ifaceName,
        slice.model,
        slice.macAddress,
      ),
      net: { name: ifaceName, pod: {} },
    };
  }
  const pnic = {
    name: slice.multusName,
    subnet: slice.subnet,
    vpc: slice.vpc,
  };
  const multus = resolveMultus(slice.netMode, pnic, subnets, nads);
  const virtTypeForIface =
    slice.netMode === "flat"
      ? "bridge"
      : String(slice.ifaceType || "bridge").toLowerCase();
  const iface = buildKubevirtIface(
    virtTypeForIface,
    ifaceName,
    slice.model,
    slice.macAddress,
  );
  const net = buildNetworkEntry(ifaceName, multus);
  return { iface, net };
}

function ensureNetworkDataShape(parsed: any): any {
  const base = deepClone(parsed || {});
  if (!base.network) base.network = {};
  if (base.network.version == null) base.network.version = 2;
  if (!base.network.ethernets || typeof base.network.ethernets !== "object") {
    base.network.ethernets = {};
  }
  return base;
}

function gatewayOrDns(nic: { gateway?: string; dns?: string }): boolean {
  return Boolean(
    String(nic?.gateway || "").trim() || String(nic?.dns || "").trim(),
  );
}

function applyOneNicEthernet(
  networkDataObj: any,
  etherKey: string,
  nic: { ipAddress?: string; gateway?: string; dns?: string },
  macOnIface: string | undefined,
  genMac: () => string,
): { next: any; macAssigned: string | undefined } {
  const nd = ensureNetworkDataShape(networkDataObj);
  const ethernets = nd.network.ethernets;
  let mac = String(macOnIface || "").trim();
  const ip = String(nic?.ipAddress || "").trim();
  const hasStatic = Boolean(ip);
  if (hasStatic && !mac) mac = genMac();

  if (!hasStatic && !gatewayOrDns(nic)) {
    delete ethernets[etherKey];
    return { next: nd, macAssigned: mac || undefined };
  }

  const eth: any = {
    match: { macaddress: (mac || macOnIface || "").toLowerCase() },
    dhcp4: !hasStatic,
  };
  if (hasStatic) {
    eth.addresses = [ip];
    if (nic.gateway) eth.gateway4 = String(nic.gateway).trim();
    if (nic.dns) {
      const dnsList = String(nic.dns)
        .split(/[,;\s]+/)
        .map((d: string) => d.trim())
        .filter(Boolean);
      if (dnsList.length) eth.nameservers = { addresses: dnsList };
    }
  }
  ethernets[etherKey] = eth;
  return { next: nd, macAssigned: mac || macOnIface };
}

function pickEthernetKey(
  networkDataObj: any,
  ifaceName: string,
  mac?: string,
): string {
  const eth = networkDataObj?.network?.ethernets || {};
  if (eth[ifaceName]) return ifaceName;
  if (mac) {
    const found = Object.keys(eth).find((k) => {
      const e = eth[k];
      return (
        String(e?.match?.macaddress || "").toLowerCase() ===
        String(mac).toLowerCase()
      );
    });
    if (found) return found;
  }
  return ifaceName;
}

/** 根据所有网卡切片合并 networkData，并回写需补发的 MAC 到 iface 列表 */
export function mergeNetworkDataForNics(
  vmData: any,
  ifaceNames: string[],
  slices: VmNicEditorSlice[],
  ifaces: any[],
): { networkDataObj: any; nextIfaces: any[]; hasNetworkDataChange: boolean } {
  const before = ensureNetworkDataShape(parseVmCloudInitNetworkData(vmData));
  const beforeCompare = deepClone(before);
  let nd = before;
  const nextIfaces = deepClone(ifaces);
  const genMac = () => generateMacAddressForStaticNic();

  ifaceNames.forEach((ifaceName, idx) => {
    const slice = slices[idx];
    if (!slice) return;
    const etherKey = pickEthernetKey(
      nd,
      ifaceName,
      String(nextIfaces[idx]?.macAddress || slice.macAddress || "").trim() ||
        undefined,
    );
    const r = applyOneNicEthernet(
      nd,
      etherKey,
      {
        ipAddress: slice.ipAddress,
        gateway: slice.gateway,
        dns: slice.dns,
      },
      String(nextIfaces[idx]?.macAddress || slice.macAddress || "").trim() ||
        undefined,
      genMac,
    );
    nd = r.next;
    if (r.macAssigned && !nextIfaces[idx]?.macAddress) {
      nextIfaces[idx] = { ...nextIfaces[idx], macAddress: r.macAssigned };
    }
  });

  const hasNetworkDataChange =
    JSON.stringify(beforeCompare) !== JSON.stringify(nd);
  return { networkDataObj: nd, nextIfaces, hasNetworkDataChange };
}

export function dumpNetworkDataYaml(networkDataObj: any): string {
  return yaml.dump(networkDataObj);
}

export { isKubeOvnFlatSubnet, isFlatKubeOvnSubnetVpc, subnetNameFromNetworkName };
