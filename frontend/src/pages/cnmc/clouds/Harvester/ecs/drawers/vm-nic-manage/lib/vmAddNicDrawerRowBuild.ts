/**
 * 将「添加网卡」各抽屉的表单值，整理为 computeSecondaryNicsPayload 所需的一行 secondaryNics 项。
 */
import { KUBE_OVN_FLAT_VPC } from "../../../../kube-ovn/lib/kubeOvnSubnetConstants";
import type { VmAddNicNadInfo } from "./vmAddNicDrawerNadMeta";

const SUBNET_TYPE_ANNOTATION = "tower.io/subnet-type";

export function isKubeOvnFlatSubnet(s: any): boolean {
  const t = String(s?.metadata?.annotations?.[SUBNET_TYPE_ANNOTATION] ?? "")
    .trim()
    .toLowerCase();
  return t === "flat";
}

function flatSubnetCandidates(subnets: any[]) {
  return (subnets || []).filter((x: any) => isKubeOvnFlatSubnet(x));
}

export function findFlatSubnetRecordByName(
  subnets: any[],
  name: string,
): any | undefined {
  if (!name) return undefined;
  return flatSubnetCandidates(subnets).find(
    (x: any) => (x?.metadata?.name || x?.name) === name,
  );
}

/** 扁平子网下拉项（排除已占用，保留当前选中） */
export function flatSubnetSelectOptions(
  subnets: any[],
  used: Set<string>,
  currentSelected?: string,
) {
  return flatSubnetCandidates(subnets)
    .filter((x: any) => {
      const n = x?.metadata?.name || x?.name;
      if (!n) return false;
      if (currentSelected && String(currentSelected) === String(n)) return true;
      return !used.has(String(n));
    })
    .map((x: any) => {
      const n = x?.metadata?.name || x?.name || "-";
      const alias = String(x?.metadata?.annotations?.["tower.io/alias"] ?? "").trim();
      const vpcDisp =
        String(x?.spec?.vpc || x?.vpc || KUBE_OVN_FLAT_VPC).trim() ||
        KUBE_OVN_FLAT_VPC;
      return {
        label: alias ? `${alias} (${n})` : `${n} (${vpcDisp})`,
        value: n,
      };
    });
}

function resolveNetNameFromSubnet(
  subnetVal: string,
  subnet: any,
  nadInfos: VmAddNicNadInfo[],
): string {
  let netName = subnetVal;
  let subnetNs = subnet?.metadata?.namespace || subnet?.namespace;
  if (!subnetNs && subnet?.spec?.provider) {
    const parts = String(subnet.spec.provider).split(".");
    if (parts.length >= 2) subnetNs = parts[parts.length - 2];
  }
  if (subnetNs) {
    netName = `${subnetNs}/${subnetVal}`;
  } else {
    try {
      const found = nadInfos.find((x: any) => {
        const vv = String(x?.value || "");
        const parts = vv.split("/");
        const nm = parts.length > 1 ? parts[1] : parts[0];
        return nm === subnetVal;
      });
      if (found) netName = found.value;
    } catch {
      /* ignore */
    }
  }
  return netName;
}

export function buildSecondaryRowFlatSubnet(
  subnetVal: string,
  subnets: any[],
  nadInfos: VmAddNicNadInfo[],
  extras: {
    model?: string;
    macAddress?: string;
    ipAddress?: string;
    gateway?: string;
    dns?: string;
  },
): Record<string, unknown> | null {
  const flatList = flatSubnetCandidates(subnets);
  const subnet = flatList.find(
    (x: any) => (x?.metadata?.name || x?.name) === subnetVal,
  );
  if (!subnet) return null;
  const flatVpc =
    String(subnet?.spec?.vpc || subnet?.vpc || KUBE_OVN_FLAT_VPC).trim() ||
    KUBE_OVN_FLAT_VPC;
  const netName = resolveNetNameFromSubnet(subnetVal, subnet, nadInfos);
  return {
    mode: "flat_subnet",
    vpc: flatVpc,
    subnet: subnetVal,
    name: netName,
    type: "managedtap",
    model: extras.model || "virtio",
    macAddress: extras.macAddress,
    ipAddress: extras.ipAddress,
    gateway: extras.gateway,
    dns: extras.dns,
  };
}

export function buildSecondaryRowVpc(
  vpc: string,
  subnetVal: string,
  subnets: any[],
  nadInfos: VmAddNicNadInfo[],
  extras: {
    model?: string;
    macAddress?: string;
    ipAddress?: string;
    gateway?: string;
    dns?: string;
  },
): Record<string, unknown> | null {
  const subnet = (subnets || []).find(
    (x: any) =>
      (x?.metadata?.name || x?.name) === subnetVal &&
      String(x?.spec?.vpc || x?.vpc || "").trim() === String(vpc || "").trim(),
  );
  if (!subnet) return null;
  let netName = subnetVal;
  let subnetNs = subnet?.metadata?.namespace || subnet?.namespace;
  if (!subnetNs && subnet?.spec?.provider) {
    const parts = String(subnet.spec.provider).split(".");
    if (parts.length >= 2) subnetNs = parts[parts.length - 2];
  }
  if (subnetNs) {
    netName = `${subnetNs}/${subnetVal}`;
  } else {
    try {
      const found = nadInfos.find((x: any) => {
        const vv = String(x?.value || "");
        const parts = vv.split("/");
        const nm = parts.length > 1 ? parts[1] : parts[0];
        return nm === subnetVal;
      });
      if (found) netName = found.value;
    } catch {
      /* ignore */
    }
  }
  return {
    mode: "vpc",
    vpc,
    subnet: subnetVal,
    name: netName,
    type: "managedtap",
    model: extras.model || "virtio",
    macAddress: extras.macAddress,
    ipAddress: extras.ipAddress,
    gateway: extras.gateway,
    dns: extras.dns,
  };
}

/** Multus 直通辅卡（与创建向导一致：不写 type/model，由 computeSecondaryNicsPayload 按 NAD 推断） */
export function buildSecondaryRowPassthroughMultus(nadValue: string): Record<string, unknown> {
  const v = String(nadValue || "").trim();
  if (!v) return {};
  return {
    mode: "passthrough",
    passthroughSource: "multus",
    name: v,
    type: undefined,
    model: undefined,
  };
}

/** PCI 直通辅卡（仅 hostDevices + allocation；无 Multus interface） */
export function buildSecondaryRowPassthroughPci(opts: {
  pciDeviceName: string;
  pciResourceName: string;
  pciNodeName?: string;
  passthroughPick?: string;
  /** 与创建向导一致：整卡 PCI vs SR-IOV VF PCI */
  nicWizardMode?: "passthrough" | "passthrough_sriov";
}): Record<string, unknown> {
  const cr = String(opts.pciDeviceName || "").trim();
  const rn = String(opts.pciResourceName || "").trim();
  if (!cr || !rn) return {};
  const mode =
    String(opts.nicWizardMode || "passthrough").trim() === "passthrough_sriov"
      ? "passthrough_sriov"
      : "passthrough";
  return {
    mode,
    passthroughSource: "pci-host",
    pciDeviceName: cr,
    pciResourceName: rn,
    pciNodeName: String(opts.pciNodeName || "").trim() || undefined,
    passthroughPick: String(opts.passthroughPick || "").trim() || `pci:${cr}`,
    name: undefined,
    type: undefined,
    model: undefined,
  };
}

export function buildSecondaryRowFlatNad(
  nadValue: string,
  extras: {
    model?: string;
    macAddress?: string;
    ipAddress?: string;
    gateway?: string;
    dns?: string;
  },
): Record<string, unknown> {
  // 与 StepNetworks DEFAULT_PRIMARY_NIC_TYPE_BY_NET_MODE.flat / VmNicManageDrawer NAD onChange 一致
  return {
    mode: "flat",
    name: nadValue,
    type: "bridge",
    model: extras.model || "virtio",
    macAddress: extras.macAddress,
    ipAddress: extras.ipAddress,
    gateway: extras.gateway,
    dns: extras.dns,
  };
}
