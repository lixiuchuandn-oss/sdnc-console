/**
 * =============================================================================
 * vmSafeRead — 从「这一条虚拟机数据」里读出界面上要显示的东西
 * =============================================================================
 *
 * 【先说清楚 r 是啥】
 * 参数 `r` = 这一条虚拟机的整包数据（JSON）。
 * - 在虚拟机列表里：r 就是表格「这一行」；
 * - 在详情抽屉里：r 就是当前打开的那台（代码里常叫 vmData）。
 *
 * 【这些函数是干啥用的】
 * 从 r 里按固定顺序取名字、状态、CPU……避免少写字段就报错，也避免列表和详情各写一套、改漏一边。
 *
 * 【为啥有的函数还要传 images】
 * r 里往往只有「镜像 ID」，界面要显示「Ubuntu 这种名字」就要在镜像列表里查一下。
 * images 就是当前页面已有的镜像表（列表传父组件的，详情传聚合接口里的），不是 NAD/VPC 那种一大套网络数据。
 *
 * 【为啥要分下面四块】
 * 1）readVm*：只看这一条 r（+ 偶尔 images）就能算出来 → 列表页不用为了算状态去拉 NAD/VPC。
 * 2）两个 Context 类型：给详情多出来的参数起个名字（网盘映射要啥、网卡映射要啥），方便读代码。
 * 3）createVmListSafeRead：给 VmSection 用，返回 SafeRead.name(r) 这种老写法，里面带上 namespaces/volumes/images。
 * 4）createVmDetailDrawerSafeRead：给详情抽屉用，额外带上 NAD/VPC/子网/聚合卷，网卡才能显示「VPC / 扁平子网」那种话。
 *
 * 【列表和详情的磁盘/网卡为啥长得不一样】
 * 列表要：系统盘/数据盘、磁盘有没有在扩容（Resizing）→ 给表格和提示用。
 * 详情要：启动顺序、总线、是不是光驱、网卡对应哪段 VPC 文案 → 给详情 Tab 用。
 *
 * 【性能】
 * 这里全是读内存，不发请求；列表有几行就会算几次，和把逻辑写在组件里差不多。
 */

import {
  KUBE_OVN_FLAT_VPC,
  KUBE_OVN_PUBLIC_VPC,
} from "../../kube-ovn/lib/kubeOvnSubnetConstants";
import { parseStorageSize } from "./storageSize";
import { isCloudInitVolume } from "./vmCloudInitSpec";
import {
  findPvcForClaim,
  getPvcCapacityStorageString,
  normalizePvcPhaseForDisplay,
  readPvcResizeFlags,
  resolveVmNamespace,
} from "./vmVolumePvc";
import {
  getPciDeviceInventoryLabel,
  isPciNicSrIovVirtualFunctionPciDevice,
  isVmHostDeviceGpuLike,
  isVmHostDeviceUsbLike,
  listVmPciNicHostBindings,
} from "./passthroughNicSelectOptions";

// =============================================================================
// 一、readVm* 开头的函数：只伺候「这一条 r」，列表和详情共用同一套规则
// =============================================================================
// 谁在用：下面的 createVmListSafeRead / createVmDetailDrawerSafeRead 里会写 name: readVmName 这种，
// 列表 VmSection、详情 VmDetailDrawer 最终都是 SafeRead.xxx(r)，真正干活的是这些函数。

/** 界面上显示的名字：有别名用别名，没有就依次试 InstanceName、name、metadata.name */
export function readVmName(r: any): string {
  return (
    r?.metadata?.annotations?.["tower.io/alias"] ||
    r?.InstanceName ||
    r?.name ||
    r?.metadata?.name ||
    ""
  );
}

/** 虚拟机资源名（metadata.name），和命名空间拼起来就是实例 id：namespace/name */
export function readVmVmId(r: any): string {
  return r?.metadata?.name || "";
}

/** 命名空间：一般在 metadata.namespace，列表数据有时只在 namespace 字段上 */
export function readVmNamespace(r: any): string {
  return r?.metadata?.namespace || r?.namespace || "";
}

/**
 * 状态那一列显示啥字：Running、Stopped、Migrating……
 * 先看是不是还在热迁移（没迁完就一律显示 Migrating，别明明在迁却显示 Running），
 * 再看平常的状态字段 printableStatus / phase。
 */
export function readVmStatus(r: any): string {
  const vmi = r?.vmi || r?.vmiRaw;
  const migrationState = vmi?.status?.migrationState;
  const migrationAnnotation =
    vmi?.metadata?.annotations?.["harvesterhci.io/migrationState"];

  if (migrationState) {
    const isCompleted =
      migrationState.completed === true || migrationState.Completed === true;
    if (!isCompleted) {
      return "Migrating";
    }
  } else if (migrationAnnotation) {
    return "Migrating";
  }

  if (typeof r?.status === "string") return r.status;
  return (
    r?.status?.printableStatus ||
    r?.status?.phase ||
    r?.Status ||
    "Unknown"
  );
}

/**
 * 镜像 ID（不是给人看的名字）。从注解里抠：模板上的最准，没有再试 VM 上的，再没有从 volumeClaimTemplates 里 JSON 抠。
 */
export function readVmImage(r: any): string {
  const specImg =
    r?.spec?.template?.metadata?.annotations?.["harvesterhci.io/imageId"];
  if (specImg) return specImg;

  const metaImg = r?.metadata?.annotations?.["harvesterhci.io/imageId"];
  if (metaImg) return metaImg;

  try {
    const annot =
      r?.metadata?.annotations?.["harvesterhci.io/volumeClaimTemplates"];
    if (annot) {
      const arr = JSON.parse(annot);
      for (const item of arr) {
        const img = item?.metadata?.annotations?.["harvesterhci.io/imageId"];
        if (img) return img;
      }
    }
  } catch {
    /* ignore */
  }
  return "";
}

/**
 * 把镜像 ID 换成人能看懂的名字：用上面的 readVmImage 拿到 ID，再到 images 这张表里查。
 * 列表传父组件给的镜像列表；详情传聚合接口里带的镜像列表（代码里变量名常叫 vmImages）。
 */
export function readVmImageDisplayName(r: any, images: any[]): string {
  const imgId = readVmImage(r);
  if (!imgId) return "";

  const found = (images || []).find((i: any) => {
    const id = i?.metadata?.name;
    const ns = i?.metadata?.namespace;
    const fullId = `${ns}/${id}`;
    return fullId === imgId || id === imgId || i.id === imgId;
  });
  if (found) {
    const labels = found.metadata?.labels || {};
    const ann = found.metadata?.annotations || {};
    const labelName = labels["harvesterhci.io/imageDisplayName"];
    if (labelName) return labelName;
    const imageName = ann["harvesterhci.io/image-name"];
    if (imageName) return imageName;
    const displayName = ann["field.cattle.io/displayName"];
    if (displayName) return displayName;
    if (found.spec?.displayName) return found.spec.displayName;
    if (found.displayName) return found.displayName;
  }
  return "";
}

/** 客户机里装的操作系统名字（Guest Agent 报的；没装 Agent 就是空） */
export function readVmOs(r: any): string {
  return (
    r?.vmi?.status?.guestOSInfo?.name ||
    r?.vmi?.status?.guestOSInfo?.prettyName ||
    ""
  );
}

/**
 * 详情顶栏那种「系统」展示：优先 Guest Agent 里的系统名，没有就用镜像显示名，再没有就拼别名+资源名凑合。
 */
export function readVmOsName(r: any, images: any[]): string {
  const guestOs = readVmOs(r);
  if (guestOs) return guestOs;

  const imgName = readVmImageDisplayName(r, images);
  if (imgName) return imgName;

  return `${r?.metadata?.annotations?.["tower.io/alias"] || r?.InstanceName || r?.name || r?.metadata?.name || ""} ${r?.metadata?.name || ""}`;
}

/**
 * CPU 几核：按插槽×核心×线程乘起来（缺哪个就当 1）；再不行用接口给的 r.cpu 或 VMI 上的 cores。
 * 热扩容后模板 spec 往往比 VMI 先更新，所以优先读模板上的。
 */
export function readVmCpu(r: any): number {
  const cpu = r?.spec?.template?.spec?.domain?.cpu;

  if (
    cpu?.sockets !== undefined &&
    cpu?.cores !== undefined &&
    cpu?.threads !== undefined
  ) {
    return Number(cpu.sockets) * Number(cpu.cores) * Number(cpu.threads);
  }

  if (cpu?.sockets !== undefined && cpu?.cores !== undefined) {
    return Number(cpu.sockets) * Number(cpu.cores) * (cpu?.threads || 1);
  }
  if (cpu?.sockets !== undefined && cpu?.threads !== undefined) {
    return Number(cpu.sockets) * (cpu?.cores || 1) * Number(cpu.threads);
  }
  if (cpu?.cores !== undefined && cpu?.threads !== undefined) {
    return (cpu?.sockets || 1) * Number(cpu.cores) * Number(cpu.threads);
  }

  if (r?.cpu !== undefined && r?.cpu !== null) {
    return Number(r.cpu);
  }

  return (
    cpu?.cores || cpu?.sockets || r?.vmi?.spec?.domain?.cpu?.cores || 0
  );
}

/**
 * 内存显示用字符串（比如 4Gi 这种）。先看 guest 内存，再看 limit，再没有 memoryGb / VMI。
 * 啥都没有就返回空字符串 ""；详情 Tab 里会用 formatMemoryParts 再变成 "-" 给人看。
 */
export function readVmMemory(r: any): string {
  const guest = r?.spec?.template?.spec?.domain?.memory?.guest;
  if (guest) return guest;

  const lim = r?.spec?.template?.spec?.domain?.resources?.limits?.memory;
  if (lim) return lim;

  return r?.memoryGb || r?.vmi?.spec?.domain?.memory?.guest || "";
}

/**
 * IP 一行显示（多块网卡就逗号拼）。先试 r.ips，再试注解里的 JSON，再试 VMI 里接口上报的 IP。
 */
/** 链路本地 IPv6（fe80::/10），通常不是业务可访地址；支持 fe80::1%eth0 形式 */
function isIpv6LinkLocal(addr: string): boolean {
  const base = String(addr || "")
    .trim()
    .toLowerCase()
    .split("%")[0];
  return base.startsWith("fe80:");
}

/** 从逗号或空白分隔的 IP 展示串中剔除链路本地 IPv6，保留顺序 */
function filterLinkLocalIpv6FromIpDisplay(ipField: string): string {
  const raw = String(ipField || "").trim();
  if (!raw) return "";
  const parts = raw
    .split(/[,\s]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const kept = parts.filter((p) => !isIpv6LinkLocal(p));
  return kept.join(", ");
}

export function readVmIp(r: any): string {
  let joined = "";
  if (Array.isArray(r?.ips) && r.ips.length > 0) joined = r.ips.join(", ");
  else {
    try {
      const annot = r?.metadata?.annotations?.["network.harvesterhci.io/ips"];
      if (annot) {
        const arr = JSON.parse(annot);
        if (Array.isArray(arr) && arr.length > 0) joined = arr.join(", ");
      }
      if (!joined && r?.vmi?.status?.interfaces) {
        const ips = r.vmi.status.interfaces
          .flatMap((i: any) => i.ipAddress || i.ipAddresses || [])
          .filter(Boolean);
        if (ips.length > 0) joined = ips.join(", ");
      }
    } catch {
      /* ignore */
    }
  }
  return filterLinkLocalIpv6FromIpDisplay(joined);
}

// =============================================================================
// 二、详情才用得到的「额外数据」长什么样（TypeScript 类型，不是运行逻辑）
// =============================================================================
// 列表页一般不拉 NAD/VPC/子网这一大坨；详情抽屉打开后聚合接口会带上，用来把网卡翻译成「VPC / xxx」这种话。
// 下面两个类型就是给 readVmDetail* 函数的第二个参数 ctx 起的名字，读代码时知道袋子里装的是啥。

/** 网卡那一块：要把 multus 连的网翻译成「扁平子网 / VPC」需要 NAD 列表 + VPC + 子网 */
export type VmDetailNetworkContext = {
  nads: any[];
  vpcs: any[];
  subnets: any[];
};

/** 磁盘那一块：优先用聚合接口里的 PVC 列表 vmPvcs，没有再用页面上的 volumes；vmImages 用来给 PVC 上的镜像 ID 查显示名 */
export type VmDetailVolumeContext = {
  volumes: any[];
  vmPvcs: any[];
  vmImages: any[];
};

/**
 * 详情 Tab 里「虚拟磁盘」每一行怎么来：把 VM 里卷的声明和磁盘设备（启动顺序、总线、光驱）和 PVC 大小拼在一起，
 * 有的话再挂上 PVC 注解里的镜像名，最后按启动顺序排个序。
 * Cloud-Init 卷不纳入本列表（与磁盘管理域一致，单独在「Cloud-Init」入口展示）。
 */
export function readVmDetailVolumeDetails(
  r: any,
  ctx: VmDetailVolumeContext,
): any[] {
  const { volumes, vmPvcs, vmImages } = ctx;
  const vols = (r?.spec?.template?.spec?.volumes || []).filter(
    (v: any) => !isCloudInitVolume(v),
  );
  const vmNs =
    r?.metadata?.namespace ||
    r?.namespace ||
    (r?.id || "").split("/")[0] ||
    "";
  const disks = r?.spec?.template?.spec?.domain?.devices?.disks || [];

  const pvcSource =
    Array.isArray(vmPvcs) && vmPvcs.length > 0 ? vmPvcs : volumes;

  return vols
    .map((v: any) => {
      const claimName =
        v?.persistentVolumeClaim?.claimName ||
        v?.ephemeral?.persistentVolumeClaim?.claimName;
      const diskInfo = disks.find((d: any) => d.name === v.name);
      let capacityBytes = 0;
      let imageDisplayName = "";
      let pvcAlias = "";
      let pvcPhase = "";
      let pvcAccessModes = "";

      if (claimName && pvcSource && pvcSource.length > 0) {
        const pvc = pvcSource.find((p: any) => {
          const pName = p?.metadata?.name || p?.name;
          const pNs = p?.metadata?.namespace || p?.namespace;
          if (pName === claimName && pNs === vmNs) return true;
          return false;
        });
        if (pvc) {
          const actualPvc = pvc?.rawData || pvc;
          const capStr =
            actualPvc?.status?.capacity?.storage ||
            actualPvc?.spec?.resources?.requests?.storage ||
            pvc?.size ||
            "";
          if (capStr) capacityBytes = parseStorageSize(capStr);

          pvcAlias = String(
            actualPvc?.metadata?.annotations?.["tower.io/alias"] ?? "",
          );
          pvcPhase = String(actualPvc?.status?.phase ?? "").trim();
          const modes = actualPvc?.spec?.accessModes;
          pvcAccessModes = Array.isArray(modes)
            ? modes.map((m: any) => String(m ?? "").trim()).filter(Boolean).join("、")
            : "";

          const pvcImageId =
            actualPvc?.metadata?.annotations?.["harvesterhci.io/imageId"];
          if (pvcImageId) {
            const foundImg = (vmImages || []).find((i: any) => {
              const id = i?.metadata?.name;
              const ns = i?.metadata?.namespace;
              const fullId = `${ns}/${id}`;
              return (
                fullId === pvcImageId ||
                id === pvcImageId ||
                i.id === pvcImageId
              );
            });
            if (foundImg) {
              const labels = foundImg.metadata?.labels || {};
              const ann = foundImg.metadata?.annotations || {};
              imageDisplayName =
                labels["harvesterhci.io/imageDisplayName"] ||
                ann["harvesterhci.io/image-name"] ||
                ann["field.cattle.io/displayName"] ||
                foundImg.spec?.displayName ||
                foundImg.displayName ||
                "";
            }
          }
        }
      }

      return {
        name: v.name,
        claimName,
        alias: pvcAlias,
        pvcPhase,
        pvcAccessModes,
        capacityBytes,
        bootOrder: diskInfo?.bootOrder,
        bus: diskInfo?.disk?.bus || diskInfo?.cdrom?.bus || "-",
        type: v.persistentVolumeClaim
          ? "Disk"
          : v.cloudInitNoCloud || v.cloudInitConfigDrive
            ? "CloudInit"
            : v.containerDisk
              ? "Container"
              : "Unknown",
        isCdrom: !!diskInfo?.cdrom,
        imageDisplayName,
      };
    })
    .sort((a: any, b: any) => (a.bootOrder || 999) - (b.bootOrder || 999));
}

/** 详情 Tab「物理网卡」区块：PCI hostDevice + Multus SR-IOV/macvtap */
export type VmDetailPassthroughNicRow = {
  key: string;
  name: string;
  kindLabel: "直通网卡" | "直通SR-IOV";
  mountLabel: "hostDevice" | "Multus";
  deviceLabel: string;
  resourceName?: string;
};

export function readVmDetailPassthroughNicRows(
  r: any,
  ctx: VmDetailNetworkContext,
  pciDevices?: any[],
): VmDetailPassthroughNicRow[] {
  const rows: VmDetailPassthroughNicRow[] = [];
  const pciList = Array.isArray(pciDevices) ? pciDevices : [];

  for (const b of listVmPciNicHostBindings(r)) {
    const raw = pciList.find(
      (p) => String(p?.metadata?.name || "").trim() === b.pciCrName,
    );
    const rn = String(b.deviceResourceName || "").toUpperCase();
    const isVf =
      (raw && isPciNicSrIovVirtualFunctionPciDevice(raw)) ||
      rn.includes("VIRTUAL_FUNCTION") ||
      rn.includes("VIRT_FN");
    rows.push({
      key: `pci:${b.pciCrName}`,
      name: b.pciCrName,
      kindLabel: isVf ? "直通SR-IOV" : "直通网卡",
      mountLabel: "hostDevice",
      deviceLabel: getPciDeviceInventoryLabel(pciList, b.pciCrName) || b.pciCrName,
      resourceName: String(b.deviceResourceName || "").trim() || undefined,
    });
  }

  const ifaces = r?.spec?.template?.spec?.domain?.devices?.interfaces || [];
  const ifaceRows = readVmDetailInterfaceRows(r, ctx);
  for (const row of ifaceRows) {
    const iface = ifaces.find((i: any) => i?.name === row.name);
    if (!iface) continue;
    const isSriov = !!iface.sriov;
    const isMacvtap = !!iface.macvtap;
    if (!isSriov && !isMacvtap) continue;
    rows.push({
      key: `multus:${row.name}`,
      name: String(row.name || ""),
      kindLabel: isSriov ? "直通SR-IOV" : "直通网卡",
      mountLabel: "Multus",
      deviceLabel: String(row.networkName || row.name || "").trim() || String(row.name || ""),
    });
  }

  return rows;
}

/**
 * 详情 Tab 里「虚拟网卡」每一行：网卡名、型号、MAC、IP、以及「连的哪段网」那句话（networkName）。
 * IP：优先看 VMI 里跑起来的接口，没有再看 VM 状态里的接口，单网卡时还能从注解里抠。
 * networkName：管理网就写 Management Network；别的网要去 ctx 里的 NAD/VPC/子网对照，才能写出「VPC / …」「扁平子网 / …」这种产品上的话（kube-ovn 和 bridge 规则不一样）。
 */
export function readVmDetailInterfaceRows(
  r: any,
  ctx: VmDetailNetworkContext,
): any[] {
  const { nads, vpcs, subnets } = ctx;
  const ifaces = r?.spec?.template?.spec?.domain?.devices?.interfaces || [];
  const networks = r?.spec?.template?.spec?.networks || [];

  return ifaces.map((i: any) => {
    const net = networks.find((n: any) => n.name === i.name);
    let mac = i.macAddress;
    let ip = "";

    const extractIp = (statusIface: any) => {
      if (statusIface.ipAddress) return statusIface.ipAddress;
      if (
        Array.isArray(statusIface.ipAddresses) &&
        statusIface.ipAddresses.length > 0
      ) {
        return statusIface.ipAddresses.join(", ");
      }
      return "";
    };

    if (r?.vmi?.status?.interfaces) {
      const vmiIface = r.vmi.status.interfaces.find(
        (si: any) => si.name === i.name || (mac && si.mac === mac),
      );
      if (vmiIface) {
        mac = vmiIface.mac || mac;
        ip = extractIp(vmiIface);
      }
    }

    if (!ip && r?.status?.interfaces) {
      const statusIface = r.status.interfaces.find(
        (si: any) => si.name === i.name || (mac && si.mac === mac),
      );
      if (statusIface) {
        mac = statusIface.mac || mac;
        ip = extractIp(statusIface);
      }
    }

    if (!ip && ifaces.length === 1) {
      try {
        const annot =
          r?.metadata?.annotations?.["network.harvesterhci.io/ips"];
        if (annot) {
          const ips = JSON.parse(annot);
          if (Array.isArray(ips)) ip = ips.join(", ");
        }
      } catch {
        /* ignore */
      }
    }

    let displayName = net?.multus?.networkName || "Management Network";

    if (displayName !== "Management Network") {
      try {
        const parts = displayName.split("/");
        const targetNs =
          parts.length > 1
            ? parts[0]
            : r?.metadata?.namespace || "default";
        const targetName = parts.length > 1 ? parts[1] : parts[0];

        let nad = nads.find(
          (n: any) =>
            n.metadata?.name === targetName &&
            n.metadata?.namespace === targetNs,
        );

        if (!nad && targetNs !== "default") {
          nad = nads.find(
            (n: any) =>
              n.metadata?.name === targetName &&
              n.metadata?.namespace === "default",
          );
        }

        if (!nad) {
          nad = nads.find((n: any) => n.metadata?.name === targetName);
        }

        if (nad) {
          let config: any = {};
          try {
            const rawConfig = nad.spec?.config || "{}";
            config =
              typeof rawConfig === "object" ? rawConfig : JSON.parse(rawConfig);
          } catch {
            /* ignore */
          }

          const plugins = config.plugins || [config];
          const kubeOvnConfig = plugins.find(
            (p: any) => p?.type === "kube-ovn",
          );
          const bridgeConfig = plugins.find((p: any) => p?.type === "bridge");

          if (kubeOvnConfig) {
            const subnet =
              subnets.find((s: any) => {
                if (s.metadata?.name !== targetName) return false;
                const sns = s.metadata?.namespace || s.namespace;
                if (targetNs && sns) return sns === targetNs;
                return true;
              }) || subnets.find((s: any) => s.metadata?.name === targetName);
            if (subnet) {
              const vpcName =
                subnet.spec?.vpc || subnet.vpc || "Unknown VPC";
              const vpc = vpcs.find((v: any) => v.metadata?.name === vpcName);
              const vpcDisplay =
                vpc?.metadata?.annotations?.["tower.io/alias"] || vpcName;
              const subnetAlias = String(
                subnet?.metadata?.annotations?.["tower.io/alias"] ?? "",
              ).trim();
              const subnetDisplay =
                subnetAlias || subnet.metadata?.name || targetName;
              const subnetType = String(
                subnet?.metadata?.annotations?.["tower.io/subnet-type"] ?? "",
              )
                .trim()
                .toLowerCase();
              const vpcStr = String(vpcName);
              if (
                vpcStr === KUBE_OVN_PUBLIC_VPC ||
                vpcStr === KUBE_OVN_FLAT_VPC
              ) {
                displayName = `扁平子网/${subnetDisplay}`;
              } else if (subnetType === "public") {
                displayName = `公共子网/${subnetDisplay}`;
              } else if (subnetType === "flat") {
                displayName = `扁平子网/${subnetDisplay}`;
              } else {
                displayName = `VPC / ${vpcDisplay} / ${subnetDisplay}`;
              }
            } else {
              displayName = `VPC / ${targetName}`;
            }
          } else if (bridgeConfig) {
            const vlanId = bridgeConfig.vlan;
            displayName = `Flat / ${vlanId ? `VLAN ${vlanId} / ` : ""}${nad.metadata.name}`;
          } else {
            const type = config.type || "Unknown";
            displayName = `${type} / ${nad.metadata.name}`;
          }
        } else {
          displayName = `Flat / ${targetName}`;
        }
      } catch (e) {
        console.warn("[VmDetail] Error mapping network:", e);
        const parts = displayName.split("/");
        const targetName = parts.length > 1 ? parts[1] : parts[0];
        displayName = `Flat / ${targetName}`;
      }
    }

    return {
      name: i.name,
      model: i.model || "virtio",
      networkName: displayName,
      mac: mac,
      ip: filterLinkLocalIpv6FromIpDisplay(ip),
    };
  });
}

function shortPassthroughResourceLabel(s: unknown): string {
  const v = String(s || "").trim();
  if (!v) return "";
  const parts = v.split("/");
  return parts[parts.length - 1] || v;
}

function isPciNicResourceNameLikelyVf(rn: string): boolean {
  const u = String(rn || "").toUpperCase();
  return u.includes("VIRTUAL_FUNCTION") || u.includes("VIRT_FN");
}

/** 列表「GPU」列：仅 vGPU / GPU 类 hostDevices */
export function readVmListGpuSummary(r: any): string[] {
  let alloc: any = null;
  try {
    const raw =
      r?.metadata?.annotations?.["harvesterhci.io/deviceAllocationDetails"];
    if (raw) alloc = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    /* ignore */
  }
  const hostAlloc = alloc?.hostdevices && typeof alloc.hostdevices === "object"
    ? alloc.hostdevices
    : {};
  const devices = r?.spec?.template?.spec?.domain?.devices || {};
  const hostDevices = Array.isArray(devices?.hostDevices) ? devices.hostDevices : [];
  const gpuDevices = Array.isArray(devices?.gpus) ? devices.gpus : [];
  const list: string[] = [];
  hostDevices
    .filter((d: any) => isVmHostDeviceGpuLike(d))
    .forEach((d: any) => {
      const rn = String(d?.deviceName || "").trim();
      const localName = String(d?.name || "").trim();
      const mapped = Array.isArray(hostAlloc?.[rn]) ? hostAlloc[rn] : [];
      const suffix = mapped.length > 0 ? mapped.join(",") : localName || "";
      const label = shortPassthroughResourceLabel(rn);
      list.push(suffix ? `${label}:${suffix}` : label);
    });
  gpuDevices.forEach((g: any) => {
    const rn = String(g?.deviceName || "").trim();
    const localName = String(g?.name || "").trim();
    const label = shortPassthroughResourceLabel(rn);
    list.push(localName ? `${label}:${localName}` : label);
  });
  return list.filter(Boolean);
}

/** 列表「网卡直通」列：PCI hostDevice + Multus SR-IOV/macvtap */
export function readVmListPassthroughNicSummary(r: any): string[] {
  const rows: string[] = [];
  for (const b of listVmPciNicHostBindings(r)) {
    const isVf = isPciNicResourceNameLikelyVf(b.deviceResourceName);
    const kind = isVf ? "直通SR-IOV" : "直通网卡";
    rows.push(`${kind} ${b.pciCrName}`);
  }
  const ifaces = r?.spec?.template?.spec?.domain?.devices?.interfaces || [];
  const networks = r?.spec?.template?.spec?.networks || [];
  for (const i of ifaces) {
    const isSriov = !!i?.sriov;
    const isMacvtap = !!i?.macvtap;
    if (!isSriov && !isMacvtap) continue;
    const net = networks.find((n: any) => n?.name === i?.name);
    const nn = String(net?.multus?.networkName || i?.name || "").trim();
    const short = nn.includes("/") ? nn.split("/").pop() || nn : nn;
    const kind = isSriov ? "直通SR-IOV" : "直通网卡";
    rows.push(`${kind} ${short}`);
  }
  return rows;
}

/** 列表「USB直通」列 */
export function readVmListUsbPassthroughSummary(r: any): string[] {
  const hostDevices =
    r?.spec?.template?.spec?.domain?.devices?.hostDevices || [];
  return (Array.isArray(hostDevices) ? hostDevices : [])
    .filter((d: any) => isVmHostDeviceUsbLike(d))
    .map((d: any) => {
      const rn = String(d?.deviceName || "").trim();
      const localName = String(d?.name || "").trim();
      if (rn && localName) {
        return `${shortPassthroughResourceLabel(rn)}:${localName}`;
      }
      return rn || localName || "";
    })
    .filter(Boolean);
}

// =============================================================================
// 三、给「虚拟机列表」用的 SafeRead 一整包（VmSection.tsx 里用）
// =============================================================================
/**
 * 返回一个对象，用法还是老样子：SafeRead.name(这一行的 r)、SafeRead.status(r)……
 * 你要先把页面里已有的三张表传进来：
 * - namespaces：命名空间列表，用来从注解里读租户、组织；
 * - volumes：卷/PVC 列表，用来算列表里每块盘多大、有没有在扩容；
 * - images：镜像列表，用来把镜像 ID 换成显示名。
 * 故意不传 NAD/VPC/子网：列表不需要把网卡翻译成「VPC / xxx」，也就不强迫列表去拉那堆数据。
 */
export function createVmListSafeRead(
  namespaces: any[],
  volumes: any[],
  images: any[],
) {
  return {
    name: readVmName,
    vmId: readVmVmId,
    uid: (r: any) => r?.metadata?.uid || r?.InstanceId || r?.id || "",
    namespace: readVmNamespace,
    tenant: (r: any) => {
      const nsName = r?.metadata?.namespace || r?.namespace || "";
      const nsObj = namespaces.find((n: any) => n?.metadata?.name === nsName);
      if (nsObj?.metadata?.annotations?.["tower.io/tenant"]) {
        return nsObj.metadata.annotations["tower.io/tenant"];
      }
      return "";
    },
    organization: (r: any) => {
      const nsName = r?.metadata?.namespace || r?.namespace || "";
      const nsObj = namespaces.find((n: any) => n?.metadata?.name === nsName);
      if (nsObj?.metadata?.annotations?.["tower.io/organization"]) {
        return nsObj.metadata.annotations["tower.io/organization"];
      }
      return "";
    },
    creationTimestamp: (r: any) =>
      r?.createdAt || r?.metadata?.creationTimestamp,
    status: readVmStatus,
    node: (r: any) =>
      r?.nodeName || r?.vmi?.status?.nodeName || r?.status?.nodeName || "",
    runStrategy: (r: any) => r?.spec?.runStrategy || "",
    evictionStrategy: (r: any) =>
      r?.spec?.evictionStrategy ||
      r?.spec?.template?.spec?.evictionStrategy ||
      "",
    cpu: readVmCpu,
    cpuSpec: (r: any) => {
      const cpu = r?.spec?.template?.spec?.domain?.cpu;
      if (cpu)
        return `${cpu.cores} Cores, ${cpu.sockets} Sockets, ${cpu.threads} Threads`;
      return "";
    },
    memory: readVmMemory,
    memSpec: (r: any) => {
      const req = r?.spec?.template?.spec?.domain?.resources?.requests;
      const lim = r?.spec?.template?.spec?.domain?.resources?.limits;
      return `Request: ${req?.memory || "-"} / Limit: ${lim?.memory || "-"}`;
    },
    /** 列表上「算不算开了热扩容」：注解开了，且没有在等重启、也没有热变配正在进行中。 */
    isHotPlugEnabled: (r: any) => {
      const annotations = r?.metadata?.annotations || {};
      const isConfigured =
        annotations[
          "harvesterhci.io/enableCPUAndMemoryHotplug"
        ]?.toLowerCase() === "true";

      if (!isConfigured) return false;

      const conditions = r?.status?.conditions || [];
      const isRestartRequired = conditions.some(
        (c: any) => c.type === "RestartRequired" && c.status === "True",
      );
      const isHotPlugInProgress = conditions.some(
        (c: any) =>
          (c.type === "HotVCPUChange" || c.type === "HotMemoryChange") &&
          c.status === "True",
      );

      if (isRestartRequired || isHotPlugInProgress) return false;

      return true;
    },
    image: readVmImage,
    imageDisplayName: (r: any) => readVmImageDisplayName(r, images),
    imageSize: (r: any) => {
      try {
        const annot =
          r?.metadata?.annotations?.["harvesterhci.io/volumeClaimTemplates"];
        if (annot) {
          const arr = JSON.parse(annot);
          for (const item of arr) {
            const img =
              item?.metadata?.annotations?.["harvesterhci.io/imageId"];
            if (img) {
              return item?.spec?.resources?.requests?.storage || "";
            }
          }
        }
      } catch {
        /* ignore */
      }
      return "";
    },
    /**
     * 列表里每一行磁盘：容量、阶段、是不是正在 Resizing / 等文件系统扩容，
     * 再按启动顺序猜是系统盘还是数据盘（和详情 Tab 里那种字段不是同一套，详情要更细）。
     */
    volumeDetails: (r: any) => {
      const vols = r?.spec?.template?.spec?.volumes || [];
      const vmNs = resolveVmNamespace(r);

      const disks = r?.spec?.template?.spec?.domain?.devices?.disks || [];
      let bootVolumeName = "";
      let minOrder = Number.POSITIVE_INFINITY;
      for (const d of disks) {
        const order =
          typeof d?.bootOrder === "number"
            ? d.bootOrder
            : Number.POSITIVE_INFINITY;
        if (order < minOrder) {
          minOrder = order;
          bootVolumeName = d?.name || "";
        }
      }
      if (!bootVolumeName && disks.length > 0)
        bootVolumeName = disks[0]?.name || "";

      return vols.map((v: any) => {
        const claimName = v?.persistentVolumeClaim?.claimName;
        let capacity = "";
        let capacityBytes = 0;
        let status = "";
        let isResizing = false;
        let isFsPending = false;
        let phase = "";

        if (claimName && volumes && volumes.length > 0) {
          const pvc = findPvcForClaim(volumes, claimName, vmNs);
          if (pvc) {
            const actualPvc = pvc?.rawData || pvc;
            const capStr = getPvcCapacityStorageString(actualPvc, pvc);
            if (capStr) {
              capacityBytes = parseStorageSize(capStr);
              capacity = capStr;
            }
            phase = normalizePvcPhaseForDisplay(actualPvc, pvc);
            const resize = readPvcResizeFlags(actualPvc);
            if (resize.isFsPending) {
              status = "FileSystemResizePending";
              isFsPending = true;
            } else if (resize.isResizing) {
              status = "Resizing";
              isResizing = true;
            } else {
              status = phase;
            }
          }
        }
        const isCloudInit = v?.cloudInitNoCloud || v?.cloudInitConfigDrive;
        const kind = isCloudInit
          ? "cloudinit"
          : claimName
            ? v?.name === bootVolumeName
              ? "system"
              : "data"
            : "data";
        return {
          name: v.name,
          claimName,
          capacity,
          capacityBytes,
          status,
          phase,
          isResizing,
          isFsPending,
          kind,
        };
      });
    },
    ip: readVmIp,
    /** MAC 一行显示：先试 r 上的 macAddresses，再试 VM 状态里的接口，再试注解里的 JSON */
    macAddress: (r: any) => {
      if (Array.isArray(r?.macAddresses) && r.macAddresses.length > 0)
        return r.macAddresses.join(", ");
      try {
        if (r?.status?.interfaces && r.status.interfaces.length > 0) {
          const macs = r.status.interfaces
            .map((i: any) => i.mac)
            .filter(Boolean);
          if (macs.length > 0) return macs.join(", ");
        }
        const annot =
          r?.metadata?.annotations?.["harvesterhci.io/mac-address"];
        if (annot) {
          const json = JSON.parse(annot);
          return Object.values(json).join(", ");
        }
      } catch {
        /* ignore */
      }
      return "";
    },
    networks: (r: any) => {
      if (
        Array.isArray(r?.networks) &&
        r.networks.length > 0 &&
        typeof r.networks[0] === "string"
      )
        return r.networks;
      const nets =
        r?.spec?.template?.spec?.networks || r?.vmi?.spec?.networks || [];
      const list = nets.map(
        (n: any) => `${n.name} (${n.multus?.networkName || "default"})`,
      );
      if (list.length > 0) return list;
      return [];
    },
    /** 列表里网卡就拼成一句「名字 (型号), …」，不去查 NAD，所以不会出现 VPC 那种长文案 */
    interfaces: (r: any) => {
      const ifaces =
        r?.spec?.template?.spec?.domain?.devices?.interfaces || [];
      return ifaces
        .map((i: any) => `${i.name} (${i.model || "-"})`)
        .join(", ");
    },
    /** GPU 直通（列表列；不含网卡/USB hostDevices） */
    gpus: (r: any) => readVmListGpuSummary(r),
    /** 网卡直通：整卡 PCI + SR-IOV VF + Multus 直通 */
    passthroughNics: (r: any) => readVmListPassthroughNicSummary(r),
    /** USB 直通设备 */
    usbPassthrough: (r: any) => readVmListUsbPassthroughSummary(r),
    /** @deprecated 列表请用 usbPassthrough */
    usb: (r: any) => readVmListUsbPassthroughSummary(r),
    os: readVmOs,
    kernel: (r: any) => r?.vmi?.status?.guestOSInfo?.kernelRelease || "",
    arch: (r: any) =>
      r?.vmi?.status?.guestOSInfo?.architecture ||
      r?.spec?.template?.spec?.architecture ||
      "",
    hostname: (r: any) => r?.spec?.template?.spec?.hostname || "",
  };
}

export type VmListSafeRead = ReturnType<typeof createVmListSafeRead>;

/**
 * 回收站列表 SafeRead：与 `createVmListSafeRead` 相同，但 status 固定为 Stopped（产品设计）。
 */
export function createVmRecycleBinListSafeRead(
  namespaces: any[],
  volumes: any[],
  images: any[],
): VmListSafeRead {
  const base = createVmListSafeRead(namespaces, volumes, images);
  return {
    ...base,
    status: () => 'Stopped',
  };
}

// =============================================================================
// 四、给「详情抽屉」用的 SafeRead 一整包（drawers/vm-detail/VmDetailDrawer.tsx 里用）
// =============================================================================
/**
 * 和列表那一包类似，也是 SafeRead.xxx(r)，但列更少（没有租户/组织那一堆表格列），
 * 磁盘和网卡用的是上面的 readVmDetailVolumeDetails / readVmDetailInterfaceRows，所以要传：
 * volumes、vpcs、subnets、nads、vmImages、vmPvcs（详情聚合里一般有这些）。
 * 多出来的 osName 是给详情顶栏展示系统名用的。
 */
export function createVmDetailDrawerSafeRead(
  volumes: any[],
  vpcs: any[],
  subnets: any[],
  nads: any[],
  vmImages: any[],
  vmPvcs: any[],
) {
  const volCtx: VmDetailVolumeContext = {
    volumes,
    vmPvcs,
    vmImages,
  };
  const netCtx: VmDetailNetworkContext = { nads, vpcs, subnets };

  return {
    name: readVmName,
    vmId: readVmVmId,
    namespace: readVmNamespace,
    status: readVmStatus,
    image: readVmImage,
    imageDisplayName: (r: any) => readVmImageDisplayName(r, vmImages),
    os: readVmOs,
    osName: (r: any) => readVmOsName(r, vmImages),
    cpu: readVmCpu,
    memory: readVmMemory,
    ip: readVmIp,
    volumeDetails: (r: any) => readVmDetailVolumeDetails(r, volCtx),
    interfaces: (r: any) => readVmDetailInterfaceRows(r, netCtx),
    passthroughNics: (r: any, pciDevices?: any[]) =>
      readVmDetailPassthroughNicRows(r, netCtx, pciDevices),
  };
}

export type VmDetailDrawerSafeRead = ReturnType<
  typeof createVmDetailDrawerSafeRead
>;
