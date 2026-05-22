/**
 * 虚拟机 · 网卡管理抽屉：每块网卡可编辑项与创建向导「主网卡」一致。
 * 检索 UI：搜「主内容区」「顶栏」「网卡卡片」「扩展设定」「新增网卡子抽屉」。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Col,
  Divider,
  Drawer,
  Empty,
  Input,
  message,
  Popconfirm,
  Row,
  Space,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  FileSearchOutlined,
  MinusCircleOutlined,
} from "@ant-design/icons";
import { ReactComponent as NicIcon } from "../../../../../../../assets/clouds/nic.svg";
import { updateHarvesterVmSpec, fetchHarvesterPciDevices } from "../../../../../../../services/harvesterApi";
import { fetchCloudProviderEcs } from "../../../../../../../services/api";
import { getMissingNadsFromNetworks } from "../../lib/harvesterVmNetwork";
import {
  type VmNicEditorSlice,
  type VmNicNetMode,
  applySliceToIfaceNet,
  dumpNetworkDataYaml,
  initNicEditorSlice,
  isKubeOvnFlatSubnet,
  mergeNetworkDataForNics,
  nadOptionsWizardShape,
  buildKubeOvnCustomIpVmMetadataAnnotations,
} from "../../lib/vmNicManageLogic";
import {
  buildPciNicHostDevicesSpecPayload,
  collectVmNicManagePassthroughExclusions,
  isPciNicSrIovVirtualFunctionPciDevice,
  isWizardPciPassthroughNetMode,
  listVmPciNicHostBindings,
  pciNicHostBindingsSnapshot,
  type VmPciNicHostBinding,
} from "../../lib/passthroughNicSelectOptions";
import {
  validateVmReconfigureNicsAgainstPeerVms,
  validateVmReconfigureNicsMacIpAndSubnet,
  reconfigureIpFieldInlineError,
  reconfigureMacFieldInlineError,
} from "../../lib/vmNicMacIpValidation";
import { subnetKey } from "../../lib/kubeOvnSubnetNadSelect";
import SubnetDetailDrawer from "../../../kube-ovn/drawers/subnet-detail-drawer";
import { TOWER_ALIAS_ANNOTATION } from "../../../kube-ovn/lib/kubeOvnSubnetConstants";
import { useVmManageDrawerCssVars } from "../shared/lib/useVmManageDrawerCssVars";
import "../shared/styles/vmManageDrawer.css";
import VmAddNicFlatSubnetDrawer from "./VmAddNicFlatSubnetDrawer";
import VmAddNicNadDrawer from "./VmAddNicNadDrawer";
import VmAddNicSriovDrawer from "./VmAddNicSriovDrawer";
import VmAddNicVpcDrawer from "./VmAddNicVpcDrawer";
import { showVmNicChangeRestartConfirm } from "./lib/vmNicSaveRestartConfirm";

/* -------------------------------------------------------------------------- */
/*  静态配置（与渲染无关）                                                      */
/* -------------------------------------------------------------------------- */

const NIC_MODELS = [
  { label: "virtio", value: "virtio" },
  { label: "e1000", value: "e1000" },
  { label: "e1000e", value: "e1000e" },
  { label: "rtl8139", value: "rtl8139" },
];

function nicModelDisplayLabel(model: string | undefined): string {
  const v = String(model || "virtio").trim() || "virtio";
  return NIC_MODELS.find((x) => x.value === v)?.label ?? v;
}

const SUBNET_TYPE_ANNOTATION = "tower.io/subnet-type";

const VM_NET_INFO_SPLIT = (
  <Divider
    type="vertical"
    style={{
      margin: 0,
      borderColor: "var(--vm-manage-color-split, rgba(0,0,0,0.06))",
    }}
  />
);

/** 网络设定区：当前网络及派生信息仅展示；改绑请用顶栏快捷按钮或外层改配 */

/** 卡片标题 Tag：与 netMode 对应的中文（不可在行内改类型，仅展示） */
const NET_MODE_OPTIONS: ReadonlyArray<{ label: string; value: VmNicNetMode }> =
  [
    { label: "扁平子网", value: "flat_subnet" },
    { label: "VPC网络", value: "vpc" },
    { label: "直通网卡", value: "passthrough" },
    { label: "直通SR-IOV", value: "passthrough_sriov" },
    { label: "NAD网络", value: "flat" },
    { label: "管理网络（Pod）", value: "pod" },
  ];

/* -------------------------------------------------------------------------- */
/*  对外类型                                                                  */
/* -------------------------------------------------------------------------- */

/** 详情抽屉工具栏「添加网卡」直通子向导（打开主抽屉后立即弹出对应添加网卡抽屉）。 */
export type VmNicManageToolbarQuickAdd =
  | "flat_subnet"
  | "vpc"
  | "sriov"
  | "sriov_vf"
  | "nad";

export interface VmNicManageDrawerProps {
  open: boolean;
  onClose: () => void;
  vmData: any;
  cloudId: string;
  nads: any[];
  vpcs: any[];
  subnets: any[];
  displayRows?: any[];
  hasEcsWrite: boolean;
  onApplied: () => void | Promise<void>;
  toolbarQuickAdd?: VmNicManageToolbarQuickAdd | null;
  onToolbarQuickAddConsumed?: () => void;
}

/* -------------------------------------------------------------------------- */
/*  纯函数辅助（无 React 状态）                                                */
/* -------------------------------------------------------------------------- */

function deepClone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

function orderNetworksForInterfaces(interfaces: any[], networks: any[]): any[] {
  return interfaces.map((i) => {
    const n = networks.find((x: any) => x?.name === i?.name);
    return n ? deepClone(n) : { name: i.name, pod: {} };
  });
}

function snapshot(
  ifaces: any[],
  nets: any[],
  nicUi: VmNicEditorSlice[],
  pciBindings: VmPciNicHostBinding[],
) {
  return JSON.stringify({
    ifaces,
    nets,
    nicUi,
    pciBindings: pciNicHostBindingsSnapshot(pciBindings),
  });
}

function netModeLabel(mode: VmNicNetMode): string {
  return NET_MODE_OPTIONS.find((o) => o.value === mode)?.label ?? String(mode);
}

/** KubeVirt 接口名须为合法 DNS 子域标签；不支持中文（CJK 统一汉字等） */
function nicIfaceNameContainsChinese(value: string): boolean {
  return /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/.test(String(value ?? ""));
}

/** 校验网卡编辑切片（保存 / 立即移除前共用） */
function validateNicUiSlices(slices: VmNicEditorSlice[]): boolean {
  const macRe = /^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/;
  const ipRe =
    /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(?:\/(?:3[0-2]|[12]?[0-9]|[0-9]))?$/;
  for (let i = 0; i < slices.length; i++) {
    const u = slices[i];
    const nm = u.netMode;
    const showMac = nm !== "flat" && !isWizardPciPassthroughNetMode(nm);
    const m = String(u.macAddress || "").trim();
    if (showMac && m && !macRe.test(m)) {
      message.error(`网卡 #${i + 1}：MAC 格式须如 52:54:00:12:34:56`);
      return false;
    }
    const ip = String(u.ipAddress || "").trim();
    if (
      (nm === "vpc" || nm === "flat_subnet" || nm === "pod") &&
      ip &&
      !ipRe.test(ip)
    ) {
      message.error(`网卡 #${i + 1}：静态 IP 格式无效`);
      return false;
    }
    if (u.netMode === "flat" && !String(u.multusName || "").trim()) {
      message.error(`网卡 #${i + 1}：请选择 NAD 网络`);
      return false;
    }
    if (isWizardPciPassthroughNetMode(u.netMode) && !String(u.multusName || "").trim()) {
      message.error(`网卡 #${i + 1}：请选择直通网络`);
      return false;
    }
    if (u.netMode === "vpc") {
      if (!String(u.vpc || "").trim()) {
        message.error(`网卡 #${i + 1}：请选择 VPC`);
        return false;
      }
      if (!String(u.subnet || "").trim()) {
        message.error(`网卡 #${i + 1}：请选择子网`);
        return false;
      }
    }
    if (u.netMode === "flat_subnet" && !String(u.subnet || "").trim()) {
      message.error(`网卡 #${i + 1}：请选择扁平子网`);
      return false;
    }
  }
  return true;
}

function nadOptionLabel(
  multusName: string,
  nadOpts: ReadonlyArray<{
    label?: unknown;
    labelShort?: unknown;
    value?: unknown;
  }>,
): string {
  const m = String(multusName || "").trim();
  if (!m) return "";
  const hit = nadOpts.find((x) => String(x?.value) === m);
  const short =
    hit?.labelShort != null ? String(hit.labelShort).trim() : "";
  if (short) return short;
  const lbl = hit?.label != null ? String(hit.label) : "";
  if (lbl) {
    const sep = " · ";
    const j = lbl.lastIndexOf(sep);
    if (j > 0) return lbl.slice(0, j).trim() || lbl;
    return lbl;
  }
  const tail = m.includes("/") ? (m.split("/").pop() || "").trim() : m;
  return tail || "";
}

function flatKubeSubnetDisplayName(sub: any): string {
  if (!sub) return "";
  const n = subnetKey(sub) || "";
  const alias = String(
    sub?.metadata?.annotations?.[TOWER_ALIAS_ANNOTATION] ?? "",
  ).trim();
  return alias || n || "";
}

/** 子网一行展示：别名优先，不拼 CR 名括号 */
function kubeSubnetLineLabel(sub: any | null | undefined): string {
  if (!sub) return "";
  const cr = String(sub?.metadata?.name || sub?.name || "").trim();
  const alias = String(
    sub?.metadata?.annotations?.[TOWER_ALIAS_ANNOTATION] ?? "",
  ).trim();
  return alias || cr || "";
}

/* -------------------------------------------------------------------------- */
/*  局部子组件                                                                */
/* -------------------------------------------------------------------------- */

/** 网络信息一行内：「标签：值」；无值则不渲染 */
const NetInfoPart: React.FC<{ label: string; children?: React.ReactNode }> = ({
  label,
  children,
}) => {
  const empty =
    children == null ||
    (typeof children === "string" && children.trim() === "");
  if (empty) return null;
  return (
    <span className="vmNicManageDrawer-netInfoPart">
      <span className="vmNicManageDrawer-netInfoPartLabel">{label}：</span>
      <span className="vmNicManageDrawer-netInfoPartValue">{children}</span>
    </span>
  );
};

/** hostDevices 直通 PCI（含 VF）网卡卡片，仅本抽屉使用 */
function PciPassthroughNicCards({
  bindings,
  pciDevices,
  kubevirtInterfaceCount,
  hasEcsWrite,
  actionLocked,
  removeDisabled,
  onMove,
  onRemove,
}: {
  bindings: VmPciNicHostBinding[];
  pciDevices: any[];
  kubevirtInterfaceCount: number;
  hasEcsWrite: boolean;
  actionLocked: boolean;
  /** 虚拟机仅剩一块网卡（任意类型合计）时禁止解绑 */
  removeDisabled: boolean;
  onMove: (idx: number, dir: -1 | 1) => void;
  onRemove: (pciCrName: string) => void | Promise<void>;
}) {
  if (!bindings.length) return null;
  const lock = actionLocked || false;
  const removeLock = actionLocked || removeDisabled;
  const showMove = hasEcsWrite;
  const showRemove = hasEcsWrite;
  return (
    <div className="vmManageDrawer-stackGap">
      {bindings.map((b, pidx) => {
        const ordinal = kubevirtInterfaceCount + pidx + 1;
        const pciRaw = (pciDevices || []).find(
          (p: any) =>
            String(p?.metadata?.name || "").trim() === String(b.pciCrName || "").trim(),
        );
        const isSrIov = pciRaw
          ? isPciNicSrIovVirtualFunctionPciDevice(pciRaw)
          : /\bvirtfn|virtualfunction|vf\s*\d/i.test(
              String(b.pciCrName || "").toLowerCase(),
            );
        return (
          <div
            key={`pci-passthrough-${b.pciCrName}`}
            className="vmManageDrawer-panel"
          >
            <div className="vmManageDrawer-deviceCardHead">
              <div className="vmManageDrawer-deviceCardHead-main">
                <Space size={8}>
                  <NicIcon
                    className="vmManageDrawer-panelHeadDeviceIcon"
                    aria-hidden
                  />
                  <span className="vmManageDrawer-deviceCardHead-title">
                    {`网卡 ${ordinal}`}
                  </span>
                  <Tag color="blue">{isSrIov ? "SR-IOV" : "直通"}</Tag>
                </Space>
              </div>
              <div
                className="vmManageDrawer-deviceCardHead-actions"
                onClick={(e) => e.stopPropagation()}
              >
                {showMove || showRemove ? (
                  <Space size={2} className="vmManageDrawer-cardActions">
                    {showMove ? (
                      <>
                        <Tooltip title="上移">
                          <span>
                            <Button
                              type="text"
                              size="small"
                              icon={<ArrowUpOutlined />}
                              disabled={pidx === 0 || lock}
                              onClick={() => onMove(pidx, -1)}
                            />
                          </span>
                        </Tooltip>
                        <Tooltip title="下移">
                          <span>
                            <Button
                              type="text"
                              size="small"
                              icon={<ArrowDownOutlined />}
                              disabled={pidx === bindings.length - 1 || lock}
                              onClick={() => onMove(pidx, 1)}
                            />
                          </span>
                        </Tooltip>
                      </>
                    ) : null}
                    {showRemove ? (
                      <Tooltip title="解绑该直通网卡">
                        <span>
                          <Popconfirm
                            title="解绑该直通网卡？"
                            description="将立即从虚拟机规格中移除此 PCI 直通设备（无需再点保存）。"
                            okText="解绑"
                            okButtonProps={{ danger: true }}
                            disabled={removeLock}
                            onConfirm={() => onRemove(b.pciCrName)}
                          >
                            <Button
                              type="text"
                              icon={<MinusCircleOutlined />}
                              danger
                              disabled={removeLock}
                            />
                          </Popconfirm>
                        </span>
                      </Tooltip>
                    ) : null}
                  </Space>
                ) : null}
              </div>
            </div>
            <div className="vmManageDrawer-panel-body">
              <div className="vmNicManageDrawer-nicSection">
                <div className="vmNicManageDrawer-netInfoLine">
                  <Space size={10} split={VM_NET_INFO_SPLIT} wrap={false}>
                    <NetInfoPart label="设备名">{b.pciCrName}</NetInfoPart>
                    <NetInfoPart label="资源名">
                      {b.deviceResourceName}
                    </NetInfoPart>
                  </Space>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  VmNicManageDrawer：网卡列表编辑 + 保存 + 子抽屉挂载                        */
/* -------------------------------------------------------------------------- */

const VmNicManageDrawer: React.FC<VmNicManageDrawerProps> = ({
  open,
  onClose,
  vmData,
  cloudId,
  nads,
  vpcs,
  subnets,
  displayRows,
  hasEcsWrite,
  onApplied,
  toolbarQuickAdd,
  onToolbarQuickAddConsumed,
}) => {
  /* ········································································ */
  /*  样式变量                                                                  */
  /* ········································································ */
  const vmManageCssVars = useVmManageDrawerCssVars();

  /* ········································································ */
  /*  本地状态：规格 interfaces/networks、编辑切片 nicUi、基线、子抽屉开关等     */
  /* ········································································ */
  const [interfaces, setInterfaces] = useState<any[]>([]);
  const [networks, setNetworks] = useState<any[]>([]);
  const [nicUi, setNicUi] = useState<VmNicEditorSlice[]>([]);
  const [baseline, setBaseline] = useState("");
  const [saving, setSaving] = useState(false);
  const [subnetDrawerOpen, setSubnetDrawerOpen] = useState(false);
  const [subnetDrawerRecord, setSubnetDrawerRecord] = useState<any | null>(null);
  const [subnetDrawerKindLabel, setSubnetDrawerKindLabel] = useState("子网");
  const [addNicFlatOpen, setAddNicFlatOpen] = useState(false);
  const [addNicVpcOpen, setAddNicVpcOpen] = useState(false);
  const [addNicSriovOpen, setAddNicSriovOpen] = useState(false);
  const [passthroughDrawerInitialMode, setPassthroughDrawerInitialMode] = useState<
    "passthrough" | "passthrough_sriov"
  >("passthrough");
  const [addNicNadOpen, setAddNicNadOpen] = useState(false);
  const [pciDevices, setPciDevices] = useState<any[]>([]);
  const [pciBindings, setPciBindings] = useState<VmPciNicHostBinding[]>([]);
  const [peerVmsForHints, setPeerVmsForHints] = useState<any[]>([]);

  const nicHintFingerprint = useMemo(
    () =>
      JSON.stringify(
        (nicUi || []).map((u) => ({
          m: u?.macAddress,
          i: u?.ipAddress,
          mod: u?.netMode,
        })),
      ),
    [nicUi],
  );

  const peerHintsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!open || !cloudId) {
      setPeerVmsForHints([]);
      return;
    }
    if (peerHintsTimerRef.current) clearTimeout(peerHintsTimerRef.current);
    peerHintsTimerRef.current = setTimeout(() => {
      peerHintsTimerRef.current = null;
      void fetchCloudProviderEcs(cloudId, true)
        .then((json: any) => {
          const extracted: any[] = Array.isArray(json?.data)
            ? json.data
            : Array.isArray(json?.data?.items)
              ? json.data.items
              : Array.isArray(json?.items)
                ? json.items
                : [];
          if (extracted.length > 0) setPeerVmsForHints(extracted);
        })
        .catch(() => {});
    }, 500);
    return () => {
      if (peerHintsTimerRef.current) clearTimeout(peerHintsTimerRef.current);
    };
  }, [open, cloudId, nicHintFingerprint]);

  const reloadPciDevices = useCallback(async () => {
    if (!cloudId) return;
    try {
      const json: any = await fetchHarvesterPciDevices(cloudId, true);
      const items: any[] = json?.data?.items || json?.items || [];
      setPciDevices(items);
    } catch {
      setPciDevices([]);
    }
  }, [cloudId]);

  const pciHostBindingCount = pciBindings.length;
  /** KubeVirt interfaces + hostDevices PCI 网卡；删除置灰仅依据合计是否为最后一块 */
  const totalNicCount = interfaces.length + pciBindings.length;

  /* ········································································ */
  /*  虚拟机标识（保存 API 用）                                                 */
  /* ········································································ */
  const vmNs = String(vmData?.metadata?.namespace || "").trim();
  const vmName = String(
    vmData?.metadata?.name || vmData?.spec?.template?.metadata?.name || "",
  ).trim();

  const kubeSubnets = subnets || [];

  /* ········································································ */
  /*  下拉选项缓存（NAD / VPC）                                                 */
  /* ········································································ */
  const nadWizardOptions = useMemo(() => nadOptionsWizardShape(nads), [nads]);

  const kubeVpcOptions = useMemo(
    () =>
      (vpcs || []).map((v: any) => {
        const name = v?.metadata?.name || "-";
        const alias = String(
          v?.metadata?.annotations?.[TOWER_ALIAS_ANNOTATION] ?? "",
        ).trim();
        const label = alias || name;
        return { label, value: name };
      }),
    [vpcs],
  );

  const openAddNicDrawer = useCallback(
    (kind: "flat_subnet" | "vpc" | "sriov" | "sriov_vf" | "nad") => {
      if (!hasEcsWrite) return;
      switch (kind) {
        case "flat_subnet":
          setAddNicFlatOpen(true);
          break;
        case "vpc":
          setAddNicVpcOpen(true);
          break;
        case "sriov":
          setPassthroughDrawerInitialMode("passthrough");
          setAddNicSriovOpen(true);
          break;
        case "sriov_vf":
          setPassthroughDrawerInitialMode("passthrough_sriov");
          setAddNicSriovOpen(true);
          break;
        case "nad":
          setAddNicNadOpen(true);
          break;
        default:
          break;
      }
    },
    [hasEcsWrite],
  );

  const vmResourceVersion = String(vmData?.metadata?.resourceVersion ?? "").trim();

  useEffect(() => {
    if (!open || !cloudId) return;
    void reloadPciDevices();
  }, [open, cloudId, vmResourceVersion, reloadPciDevices]);

  useEffect(() => {
    if (!open || !toolbarQuickAdd || !hasEcsWrite) return;
    const kind = toolbarQuickAdd;
    queueMicrotask(() => {
      openAddNicDrawer(kind);
      onToolbarQuickAddConsumed?.();
    });
  }, [open, toolbarQuickAdd, hasEcsWrite, onToolbarQuickAddConsumed, openAddNicDrawer]);

  /* ········································································ */
  /*  从 vmData 拉规格 → 本地 interfaces / networks / nicUi                   */
  /* ········································································ */
  const syncFromVm = useCallback(() => {
    const ifaces = deepClone(
      vmData?.spec?.template?.spec?.domain?.devices?.interfaces || [],
    );
    const netsRaw = deepClone(vmData?.spec?.template?.spec?.networks || []);
    const nets = orderNetworksForInterfaces(ifaces, netsRaw);
    const ui = ifaces.map((iface: any, i: number) =>
      initNicEditorSlice(vmData, iface, nets[i] || { name: iface.name }, kubeSubnets),
    );
    const pci = listVmPciNicHostBindings(vmData);
    setInterfaces(ifaces);
    setNetworks(nets);
    setNicUi(ui);
    setPciBindings(pci);
    setBaseline(snapshot(ifaces, nets, ui, pci));
  }, [vmData, kubeSubnets]);

  const syncFromVmRef = useRef(syncFromVm);
  syncFromVmRef.current = syncFromVm;

  /** 子抽屉保存后父级会立刻刷新 vmData；跳过紧随其后的那一次 effect 同步（常为仍陈旧的列表/聚合快照），改由 runAfterNicChild* 在下一帧用最新 props 再 sync */
  const suppressNextVmSyncFromEffectRef = useRef(false);

  /** 子抽屉在 await onApplied（聚合拉取）刚返回时，父级 vmData 可能尚未提交到本轮渲染；延后一帧再 sync，避免用仍停留在闭包里的旧 vmData 把列表闪回上一状态 */
  const runAfterNicChildAggregatedRefresh = useCallback(async () => {
    suppressNextVmSyncFromEffectRef.current = true;
    await onApplied();
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
    syncFromVmRef.current();
  }, [onApplied]);

  const runAfterNicSriovChildAggregatedRefresh = useCallback(async () => {
    suppressNextVmSyncFromEffectRef.current = true;
    await onApplied();
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
    syncFromVmRef.current();
    void reloadPciDevices();
  }, [onApplied, reloadPciDevices]);

  /* 打开且 vm 在：从 vm 同步本地编辑态 */
  useEffect(() => {
    if (suppressNextVmSyncFromEffectRef.current) {
      suppressNextVmSyncFromEffectRef.current = false;
      return;
    }
    if (open && vmData) syncFromVm();
  }, [open, vmData, syncFromVm]);

  /* 关闭主抽屉时顺带关掉各「新增网卡」子抽屉，避免下次打开残留 */
  useEffect(() => {
    if (!open) {
      setAddNicFlatOpen(false);
      setAddNicVpcOpen(false);
      setAddNicSriovOpen(false);
      setAddNicNadOpen(false);
    }
  }, [open]);

  /* ········································································ */
  /*  与上次同步基线比较，控制「保存」可用                                     */
  /* ········································································ */
  const dirty = useMemo(
    () => snapshot(interfaces, networks, nicUi, pciBindings) !== baseline,
    [interfaces, networks, nicUi, pciBindings, baseline],
  );

  const hasIfaceNameChinese = useMemo(
    () =>
      interfaces.some((x) =>
        nicIfaceNameContainsChinese(String(x?.name ?? "")),
      ),
    [interfaces],
  );

  const passthroughExclude = useMemo(
    () =>
      collectVmNicManagePassthroughExclusions({
        pciBindings,
        interfaces,
        networks,
      }),
    [pciBindings, interfaces, networks],
  );

  /* ········································································ */
  /*  卡片标题区：运行态 IP（来自 displayRows）                                 */
  /* ········································································ */
  const findIp = useCallback(
    (ifaceName: string) => {
      const row = displayRows?.find((x: any) => x?.name === ifaceName);
      return row?.ip ? String(row.ip) : "";
    },
    [displayRows],
  );

  /* ········································································ */
  /*  写 nicUi 并同步回 interfaces[n] / networks[n]                           */
  /* ········································································ */
  const applySliceAt = useCallback(
    (idx: number, newSlice: VmNicEditorSlice) => {
      const ifaceName = interfaces[idx]?.name;
      if (!ifaceName) return;
      setNicUi((prev) => {
        const n = [...prev];
        n[idx] = newSlice;
        return n;
      });
      try {
        const { iface, net } = applySliceToIfaceNet(
          newSlice,
          ifaceName,
          kubeSubnets,
          nads,
        );
        setInterfaces((prev) => prev.map((x, i) => (i === idx ? iface : x)));
        setNetworks((prev) => prev.map((x, i) => (i === idx ? net : x)));
      } catch (e) {
        console.warn(e);
      }
    },
    [interfaces, kubeSubnets, nads],
  );

  /** 同步改接口名：domain.interfaces[].name 与 networks[].name 须一致 */
  const applyIfaceNameAt = useCallback((idx: number, rawName: string) => {
    const name = rawName;
    setInterfaces((prev) =>
      prev.map((x, i) => (i === idx && x ? { ...x, name } : x)),
    );
    setNetworks((prev) =>
      prev.map((x, i) => (i === idx && x ? { ...x, name } : x)),
    );
  }, []);

  /* ········································································ */
  /*  列表操作：排序、改名、解绑、校验、提交                                   */
  /* ········································································ */
  const openSubnetDrawer = (record: any, kindLabel: string) => {
    if (!record || !cloudId) return;
    setSubnetDrawerRecord(record);
    setSubnetDrawerKindLabel(kindLabel);
    setSubnetDrawerOpen(true);
  };

  const move = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    setInterfaces((prevIf) => {
      if (j < 0 || j >= prevIf.length) return prevIf;
      const nextIf = [...prevIf];
      const [r] = nextIf.splice(idx, 1);
      nextIf.splice(j, 0, r);
      setNetworks((prevNet) => orderNetworksForInterfaces(nextIf, prevNet));
      setNicUi((prevUi) => {
        const u = [...prevUi];
        const [x] = u.splice(idx, 1);
        u.splice(j, 0, x);
        return u;
      });
      return nextIf;
    });
  };

  const submitNicManageSpec = useCallback(
    async (
      draftIfaces: any[],
      draftNetsInput: any[],
      draftNicUi: VmNicEditorSlice[],
      draftPci: VmPciNicHostBinding[],
      opts: { closeOnSuccess: boolean; successMessage: string },
    ) => {
      if (!hasEcsWrite) {
        message.error("无云主机写权限");
        return;
      }
      if (!cloudId || !vmNs || !vmName) {
        message.error("无法解析虚拟机信息");
        return;
      }
      if (!validateNicUiSlices(draftNicUi)) return;

      const localNicErr = validateVmReconfigureNicsMacIpAndSubnet(
        draftNicUi,
        kubeSubnets,
      );
      if (localNicErr) {
        message.error(localNicErr);
        return;
      }
      let peerVms: any[] = [];
      try {
        const json: any = await fetchCloudProviderEcs(cloudId, true);
        peerVms = Array.isArray(json?.data)
          ? json.data
          : Array.isArray(json?.data?.items)
            ? json.data.items
            : Array.isArray(json?.items)
              ? json.items
              : [];
      } catch {
        peerVms = [];
      }
      const peerNicErr = validateVmReconfigureNicsAgainstPeerVms(
        draftNicUi,
        draftNetsInput,
        peerVms,
        vmNs,
        vmName,
      );
      if (peerNicErr) {
        message.error(peerNicErr);
        return;
      }

      const nameSet = new Set<string>();
      for (let ni = 0; ni < draftIfaces.length; ni++) {
        const x = draftIfaces[ni];
        const n = String(x?.name || "").trim();
        if (!n) {
          message.error("接口名不能为空");
          return;
        }
        if (nicIfaceNameContainsChinese(n)) {
          message.error(
            `网卡 #${ni + 1}：名称不支持中文字符，请使用字母、数字或连字符（如 eth1、nic-1）`,
          );
          return;
        }
        if (nameSet.has(n)) {
          message.error(`接口名重复：${n}`);
          return;
        }
        nameSet.add(n);
      }

      let nextIfaces = deepClone(draftIfaces);
      let nextNets = orderNetworksForInterfaces(nextIfaces, draftNetsInput);
      for (let i = 0; i < nextIfaces.length; i++) {
        const slice = draftNicUi[i];
        if (!slice) continue;
        const { iface, net } = applySliceToIfaceNet(
          slice,
          nextIfaces[i].name,
          kubeSubnets,
          nads,
        );
        nextIfaces[i] = iface;
        nextNets[i] = net;
      }

      const ifaceNames = nextIfaces.map((x: any) => x.name);
      const { networkDataObj, nextIfaces: withMac, hasNetworkDataChange } =
        mergeNetworkDataForNics(vmData, ifaceNames, draftNicUi, nextIfaces);
      nextIfaces = withMac;

      const payload: any = {
        interfaces: nextIfaces,
        networks: nextNets,
        vmMetadataAnnotations: buildKubeOvnCustomIpVmMetadataAnnotations(
          draftNicUi,
          kubeSubnets,
          nads,
        ),
      };
      if (hasNetworkDataChange) {
        payload.networkData = dumpNetworkDataYaml(networkDataObj);
      }

      const baselinePci = listVmPciNicHostBindings(vmData);
      if (
        pciNicHostBindingsSnapshot(draftPci) !==
        pciNicHostBindingsSnapshot(baselinePci)
      ) {
        payload.pciNicHostDevices = buildPciNicHostDevicesSpecPayload(draftPci);
      }

      const missing = getMissingNadsFromNetworks(
        nextNets,
        vmNs || "default",
        nads,
      );
      if (missing.length > 0) {
        message.error(
          `更新失败：引用的 NAD 不存在：${missing.join(", ")}。请更换为存在的网络后再提交。`,
        );
        return;
      }

      setSaving(true);
      try {
        await updateHarvesterVmSpec(cloudId, vmNs, vmName, payload);
        message.success(opts.successMessage);
        if (opts.closeOnSuccess) {
          onClose();
          await onApplied();
        } else {
          await runAfterNicChildAggregatedRefresh();
        }
        setBaseline(snapshot(nextIfaces, nextNets, draftNicUi, draftPci));
        showVmNicChangeRestartConfirm({ cloudId, vmNs, vmName, vmData });
      } catch (e: any) {
        message.error(e?.message || "保存失败");
      } finally {
        setSaving(false);
      }
    },
    [
      hasEcsWrite,
      cloudId,
      vmNs,
      vmName,
      kubeSubnets,
      nads,
      vmData,
      onClose,
      onApplied,
      runAfterNicChildAggregatedRefresh,
    ],
  );

  const confirmUnbindNicAt = useCallback(
    async (idx: number) => {
      if (!hasEcsWrite) return;
      if (interfaces.length + pciBindings.length <= 1) {
        message.warning("至少保留一块网卡");
        return;
      }
      await submitNicManageSpec(
        interfaces.filter((_, i) => i !== idx),
        networks.filter((_, i) => i !== idx),
        nicUi.filter((_, i) => i !== idx),
        pciBindings,
        { closeOnSuccess: false, successMessage: "已移除网卡" },
      );
    },
    [hasEcsWrite, interfaces, networks, nicUi, pciBindings, submitNicManageSpec],
  );

  const confirmUnbindPci = useCallback(
    async (pciCrName: string) => {
      if (!hasEcsWrite) return;
      if (interfaces.length + pciBindings.length <= 1) {
        message.warning("至少保留一块网卡");
        return;
      }
      const cr = String(pciCrName || "").trim();
      if (!cr) return;
      await submitNicManageSpec(
        interfaces,
        networks,
        nicUi,
        pciBindings.filter((b) => b.pciCrName !== cr),
        { closeOnSuccess: false, successMessage: "已移除直通网卡" },
      );
    },
    [hasEcsWrite, interfaces, networks, nicUi, pciBindings, submitNicManageSpec],
  );

  const movePciAt = useCallback((idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    setPciBindings((prev) => {
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      const [row] = next.splice(idx, 1);
      next.splice(j, 0, row);
      return next;
    });
  }, []);

  const handleSave = async () => {
    await submitNicManageSpec(interfaces, networks, nicUi, pciBindings, {
      closeOnSuccess: true,
      successMessage: "网卡配置已保存",
    });
  };

  /* ········································································ */
  /*  渲染：Drawer 主体 + 底部按钮 + 挂载在 Drawer 下的子抽屉                   */
  /* ········································································ */
  return (
    <Drawer
      closable={false}
      width={800}
      placement="right"
      open={open}
      onClose={onClose}
      forceRender
      push={{ distance: 180 }}
      footer={
        <Space style={{ width: "100%", justifyContent: "flex-end" }}>
          <Button onClick={onClose}>关闭</Button>
          <Button
            type="primary"
            loading={saving}
            disabled={!dirty || !hasEcsWrite || hasIfaceNameChinese}
            onClick={() => void handleSave()}
          >
            保存
          </Button>
        </Space>
      }
    >
      {/* ===== 主内容区：顶栏快捷新增 + 网卡卡片列表 ===== */}
      <div className="vmManageDrawer vmNicManageDrawer" style={vmManageCssVars}>
        <div className="vmNicManageDrawer-toolbar vmNicManageDrawer-toolbar--end">
          <Space size={4} wrap align="center">
            <Button
              type="link"
              disabled={!hasEcsWrite || saving}
              onClick={() => openAddNicDrawer("flat_subnet")}
            >
              + 扁平子网
            </Button>
            <Button
              type="link"
              disabled={!hasEcsWrite || saving}
              onClick={() => openAddNicDrawer("vpc")}
            >
              + VPC 网络
            </Button>
            <Button
              type="link"
              disabled={!hasEcsWrite || saving}
              onClick={() => openAddNicDrawer("sriov")}
            >
              + 直通 / SR-IOV
            </Button>
            <Button
              type="link"
              disabled={!hasEcsWrite || saving}
              onClick={() => openAddNicDrawer("nad")}
            >
              + NAD 网络
            </Button>
          </Space>
        </div>

        {interfaces.length === 0 && pciHostBindingCount === 0 ? (
          <div className="vmDeviceManageDrawer-emptyState">
            <Empty description="当前无网卡。请使用顶部「添加」入口进行配置；编辑后需点保存，移除网卡可点卡片上解绑立即生效。" />
          </div>
        ) : null}

        {/* ===== 网卡卡片：每块一块 vmManageDrawer-panel ===== */}
        {interfaces.map((iface, idx) => {
          const slice = nicUi[idx];
          if (!slice) return null;
          const mode = slice.netMode;
          const nameChineseErr = nicIfaceNameContainsChinese(
            String(iface?.name ?? ""),
          );

          const runtimeIp = String(findIp(iface.name) || "").trim();

          const showMac = mode !== "flat" && !isWizardPciPassthroughNetMode(mode);
          const showKubeStaticIp = mode === "vpc" || mode === "flat_subnet";
          const showPodAddrExtras = mode === "pod";

          const macInlineHint = showMac
            ? reconfigureMacFieldInlineError(
                nicUi,
                idx,
                slice.macAddress,
                peerVmsForHints,
                vmNs,
                vmName,
              )
            : undefined;
          const ipInlineHint = showKubeStaticIp
            ? reconfigureIpFieldInlineError(
                nicUi,
                networks,
                idx,
                slice.ipAddress,
                kubeSubnets,
                peerVmsForHints,
                vmNs,
                vmName,
              )
            : undefined;

          const flatSubnetRec =
            mode === "flat_subnet"
              ? kubeSubnets.find(
                  (x: any) =>
                    subnetKey(x) === slice.subnet && isKubeOvnFlatSubnet(x),
                )
              : null;
          const vpcSubnetRec =
            mode === "vpc"
              ? kubeSubnets.find(
                  (x: any) =>
                    subnetKey(x) === slice.subnet &&
                    String(x?.spec?.vpc || x?.vpc) === String(slice.vpc),
                )
              : null;
          const vpcRowLabel =
            kubeVpcOptions.find((o) => o.value === slice.vpc)?.label ||
            String(slice.vpc || "").trim();
          const flatSubnetCidr =
            flatSubnetRec?.spec?.cidrBlock || flatSubnetRec?.cidr || "";
          const vpcSubnetCidr =
            vpcSubnetRec?.spec?.cidrBlock || vpcSubnetRec?.cidr || "";
          const vpcSubnetNameLabel = kubeSubnetLineLabel(vpcSubnetRec);

          let netLineNet = "";
          let netLineSub = "";
          let netLineCidr = "";
          if (mode === "flat" || isWizardPciPassthroughNetMode(mode)) {
            netLineNet = nadOptionLabel(slice.multusName, nadWizardOptions);
          } else if (mode === "flat_subnet") {
            netLineSub = flatKubeSubnetDisplayName(flatSubnetRec);
            netLineCidr = flatSubnetCidr;
          } else if (mode === "vpc") {
            netLineNet = vpcRowLabel;
            netLineSub = vpcSubnetNameLabel;
            netLineCidr = vpcSubnetCidr;
          } else if (mode === "pod") {
            netLineNet = "集群默认 Pod 网络（masquerade）";
          }

          const netInfoParts: React.ReactNode[] = [];
          if (String(netLineNet || "").trim()) {
            netInfoParts.push(
              <NetInfoPart key="net" label="网络">
                {netLineNet}
              </NetInfoPart>,
            );
          }
          if (String(netLineSub || "").trim()) {
            netInfoParts.push(
              <NetInfoPart key="sub" label="子网">
                {netLineSub}
              </NetInfoPart>,
            );
          }
          if (String(netLineCidr || "").trim()) {
            netInfoParts.push(
              <NetInfoPart key="cidr" label="网段">
                {netLineCidr}
              </NetInfoPart>,
            );
          }
          const showSubnetDetailBtn =
            mode === "flat_subnet" || mode === "vpc";
          const showNetInfoBlock =
            netInfoParts.length > 0 || showSubnetDetailBtn;

          return (
            <div
              key={`kubevirt-nic-${idx}`}
              className="vmManageDrawer-panel"
            >
              {/* —— 卡片标题：图标、序号+接口名、网络类型 Tag、运行态 IP；右侧排序/解绑 —— */}
              <div className="vmManageDrawer-deviceCardHead">
                <div className="vmManageDrawer-deviceCardHead-main">
                  <Space size={8}>
                    <NicIcon
                      className="vmManageDrawer-panelHeadDeviceIcon"
                      aria-hidden
                    />
                    <span className="vmManageDrawer-deviceCardHead-title">
                      {`网卡 ${idx + 1}${
                        iface.name != null &&
                        String(iface.name).trim() !== ""
                          ? ` ${String(iface.name).trim()}`
                          : ""
                      }`}
                    </span>
                    <Tag color="blue">{netModeLabel(mode)}</Tag>
                    {isWizardPciPassthroughNetMode(mode) ? null : (
                      <Tag color="blue">{nicModelDisplayLabel(slice.model)}</Tag>
                    )}
                    {runtimeIp ? (
                      <span>{`运行态 IP ${runtimeIp}`}</span>
                    ) : null}
                  </Space>
                </div>
                <div
                  className="vmManageDrawer-deviceCardHead-actions"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Space
                    size={2}
                    className="vmManageDrawer-cardActions"
                  >
                    <Tooltip title="上移">
                      <span>
                        <Button
                          type="text"
                          size="small"
                          icon={<ArrowUpOutlined />}
                          disabled={!hasEcsWrite || saving || idx === 0}
                          onClick={() => move(idx, -1)}
                        />
                      </span>
                    </Tooltip>
                    <Tooltip title="下移">
                      <span>
                        <Button
                          type="text"
                          size="small"
                          icon={<ArrowDownOutlined />}
                          disabled={
                            !hasEcsWrite ||
                            saving ||
                            idx === interfaces.length - 1
                          }
                          onClick={() => move(idx, 1)}
                        />
                      </span>
                    </Tooltip>
                    <Tooltip title="从规格移除此网卡">
                      <span>
                        <Popconfirm
                          title="解绑该网卡？"
                          description="将立即从虚拟机规格中移除此网卡及其网络定义（无需再点保存）。"
                          okText="解绑"
                          okButtonProps={{ danger: true }}
                          disabled={
                            !hasEcsWrite || saving || totalNicCount <= 1
                          }
                          onConfirm={() => confirmUnbindNicAt(idx)}
                        >
                          <Button
                            type="text"
                            icon={<MinusCircleOutlined />}
                            danger
                            disabled={
                              !hasEcsWrite || saving || totalNicCount <= 1
                            }
                          />
                        </Popconfirm>
                      </span>
                    </Tooltip>
                  </Space>
                </div>
              </div>

              {/* —— 卡片正文：网络信息 / 扩展设定 —— */}
              <div className="vmManageDrawer-panel-body">
                {showNetInfoBlock ? (
                  <div className="vmNicManageDrawer-nicSection">
                    <div className="vmNicManageDrawer-netInfoLine">
                      <Space size={10} split={VM_NET_INFO_SPLIT} wrap={false}>
                        {netInfoParts}
                        {showSubnetDetailBtn ? (
                          <Button
                            type="link"
                            size="small"
                            icon={<FileSearchOutlined />}
                            title="查看子网"
                            disabled={!cloudId}
                            onClick={() => {
                              if (mode === "flat_subnet" && flatSubnetRec) {
                                openSubnetDrawer(flatSubnetRec, "扁平子网");
                                return;
                              }
                              if (mode === "vpc" && vpcSubnetRec) {
                                const t = String(
                                  vpcSubnetRec?.metadata?.annotations?.[
                                    SUBNET_TYPE_ANNOTATION
                                  ] ?? "",
                                )
                                  .trim()
                                  .toLowerCase();
                                const kind =
                                  t === "vpc"
                                    ? "VPC 子网"
                                    : t === "public"
                                      ? "公共子网"
                                      : "子网";
                                openSubnetDrawer(vpcSubnetRec, kind);
                              }
                            }}
                          />
                        ) : null}
                      </Space>
                    </div>
                    <Divider className="vmNicManageDrawer-netInfoDivider" />
                  </div>
                ) : null}

                {/* 扩展设定：接口名 / MAC / 静态 IP 等 */}
                <div className="vmNicManageDrawer-nicSection vmNicManageDrawer-nicSection--addr">
                  <Row gutter={[12, 12]}>
                    <Col span={8}>
                      <Input
                        prefix="名称"
                        placeholder="如 eth1、nic-1"
                        value={iface.name || ""}
                        disabled={!hasEcsWrite}
                        status={nameChineseErr ? "error" : undefined}
                        onChange={(e) =>
                          applyIfaceNameAt(idx, e.target.value)
                        }
                      />
                      {nameChineseErr ? (
                        <Typography.Text
                          type="danger"
                          style={{ display: "block", marginTop: 4, fontSize: 12 }}
                        >
                          网卡名称不支持中文字符，请改用字母、数字或连字符（如 eth1、nic-1）。
                        </Typography.Text>
                      ) : null}
                    </Col>
                    {showMac ? (
                      <Col span={8}>
                        <Input
                          prefix="MAC"
                          placeholder="52:54:00:12:34:56"
                          value={slice.macAddress || ""}
                          disabled={!hasEcsWrite}
                          status={macInlineHint ? "error" : undefined}
                          onChange={(e) =>
                            applySliceAt(idx, {
                              ...slice,
                              macAddress: e.target.value,
                            })
                          }
                        />
                        {macInlineHint ? (
                          <Typography.Text
                            type="danger"
                            style={{ display: "block", marginTop: 4, fontSize: 12 }}
                          >
                            {macInlineHint}
                          </Typography.Text>
                        ) : null}
                      </Col>
                    ) : null}
                    {showKubeStaticIp || showPodAddrExtras ? (
                      <Col span={8}>
                        <Input
                          prefix="静态IP"
                          placeholder="192.168.1.23"
                          value={slice.ipAddress || ""}
                          disabled={!hasEcsWrite}
                          status={ipInlineHint ? "error" : undefined}
                          onChange={(e) =>
                            applySliceAt(idx, {
                              ...slice,
                              ipAddress: e.target.value,
                            })
                          }
                        />
                        {ipInlineHint ? (
                          <Typography.Text
                            type="danger"
                            style={{ display: "block", marginTop: 4, fontSize: 12 }}
                          >
                            {ipInlineHint}
                          </Typography.Text>
                        ) : null}
                      </Col>
                    ) : null}
                    {showPodAddrExtras ? (
                      <Col span={8}>
                        <Input
                          prefix="网关"
                          placeholder="192.168.1.1"
                          value={slice.gateway || ""}
                          disabled={!hasEcsWrite}
                          onChange={(e) =>
                            applySliceAt(idx, {
                              ...slice,
                              gateway: e.target.value,
                            })
                          }
                        />
                      </Col>
                    ) : null}
                    {showPodAddrExtras ? (
                      <Col span={8}>
                        <Input
                          prefix="DNS"
                          placeholder="8.8.8.8"
                          value={slice.dns || ""}
                          disabled={!hasEcsWrite}
                          onChange={(e) =>
                            applySliceAt(idx, {
                              ...slice,
                              dns: e.target.value,
                            })
                          }
                        />
                      </Col>
                    ) : null}
                  </Row>
                </div>
              </div>
            </div>
          );
        })}

        <PciPassthroughNicCards
          bindings={pciBindings}
          pciDevices={pciDevices}
          kubevirtInterfaceCount={interfaces.length}
          hasEcsWrite={hasEcsWrite}
          actionLocked={saving}
          removeDisabled={totalNicCount <= 1}
          onMove={movePciAt}
          onRemove={confirmUnbindPci}
        />
      </div>
      {/* ===== 新增网卡向导（各类型独立抽屉）+ 子网只读详情 ===== */}
      <VmAddNicFlatSubnetDrawer
        open={addNicFlatOpen && !!cloudId}
        onClose={() => setAddNicFlatOpen(false)}
        vmData={vmData}
        cloudId={cloudId || ""}
        hasEcsWrite={hasEcsWrite}
        onApplied={runAfterNicChildAggregatedRefresh}
      />
      <VmAddNicVpcDrawer
        open={addNicVpcOpen && !!cloudId}
        onClose={() => setAddNicVpcOpen(false)}
        vmData={vmData}
        cloudId={cloudId || ""}
        hasEcsWrite={hasEcsWrite}
        onApplied={runAfterNicChildAggregatedRefresh}
      />
      <VmAddNicSriovDrawer
        open={addNicSriovOpen && !!cloudId}
        onClose={() => setAddNicSriovOpen(false)}
        vmData={vmData}
        cloudId={cloudId || ""}
        hasEcsWrite={hasEcsWrite}
        initialPassthroughWizardNetMode={passthroughDrawerInitialMode}
        passthroughExclude={passthroughExclude}
        onApplied={runAfterNicSriovChildAggregatedRefresh}
      />
      <VmAddNicNadDrawer
        open={addNicNadOpen && !!cloudId}
        onClose={() => setAddNicNadOpen(false)}
        vmData={vmData}
        cloudId={cloudId || ""}
        hasEcsWrite={hasEcsWrite}
        onApplied={runAfterNicChildAggregatedRefresh}
      />
      {cloudId ? (
        <SubnetDetailDrawer
          open={subnetDrawerOpen}
          onClose={() => {
            setSubnetDrawerOpen(false);
            setSubnetDrawerRecord(null);
          }}
          subnet={subnetDrawerRecord}
          kindLabel={subnetDrawerKindLabel}
        />
      ) : null}
    </Drawer>
  );
};

export default VmNicManageDrawer;
