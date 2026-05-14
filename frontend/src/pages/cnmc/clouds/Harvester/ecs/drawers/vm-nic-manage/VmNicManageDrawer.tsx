/**
 * 虚拟机 · 网卡管理抽屉：每块网卡可编辑项与创建向导「主网卡」一致。
 * 检索 UI：搜「主内容区」「顶栏」「网卡卡片」「扩展设定」「新增网卡子抽屉」。
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
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
} from "antd";
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  FileSearchOutlined,
  MinusCircleOutlined,
} from "@ant-design/icons";
import { ReactComponent as NicIcon } from "../../../../../../../assets/clouds/nic.svg";
import { updateHarvesterVmSpec } from "../../../../../../../services/harvesterApi";
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
} from "../../lib/vmNicManageLogic";
import { subnetKey } from "../../lib/kubeOvnSubnetNadSelect";
import SubnetDetailDrawer from "../../../kube-ovn/drawers/subnet-detail-drawer";
import { TOWER_ALIAS_ANNOTATION } from "../../../kube-ovn/lib/kubeOvnSubnetConstants";
import { useVmManageDrawerCssVars } from "../shared/lib/useVmManageDrawerCssVars";
import "../shared/styles/vmManageDrawer.css";
import VmAddNicFlatSubnetDrawer from "./VmAddNicFlatSubnetDrawer";
import VmAddNicNadDrawer from "./VmAddNicNadDrawer";
import VmAddNicSriovDrawer from "./VmAddNicSriovDrawer";
import VmAddNicVpcDrawer from "./VmAddNicVpcDrawer";

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

function snapshot(ifaces: any[], nets: any[], nicUi: VmNicEditorSlice[]) {
  return JSON.stringify({ ifaces, nets, nicUi });
}

function netModeLabel(mode: VmNicNetMode): string {
  return NET_MODE_OPTIONS.find((o) => o.value === mode)?.label ?? String(mode);
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
  const [addNicNadOpen, setAddNicNadOpen] = useState(false);

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
    (kind: "flat_subnet" | "vpc" | "sriov" | "nad") => {
      if (!hasEcsWrite) return;
      switch (kind) {
        case "flat_subnet":
          setAddNicFlatOpen(true);
          break;
        case "vpc":
          setAddNicVpcOpen(true);
          break;
        case "sriov":
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
    setInterfaces(ifaces);
    setNetworks(nets);
    setNicUi(ui);
    setBaseline(snapshot(ifaces, nets, ui));
  }, [vmData, kubeSubnets]);

  /* 打开且 vm 在：从 vm 同步本地编辑态 */
  useEffect(() => {
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
    () => snapshot(interfaces, networks, nicUi) !== baseline,
    [interfaces, networks, nicUi, baseline],
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

  const unbindAt = (idx: number) => {
    if (interfaces.length <= 1) {
      message.warning("至少保留一块网卡");
      return;
    }
    setInterfaces((prev) => prev.filter((_, i) => i !== idx));
    setNetworks((prev) => prev.filter((_, i) => i !== idx));
    setNicUi((prev) => prev.filter((_, i) => i !== idx));
  };

  const validateBeforeSave = (): boolean => {
    const macRe = /^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/;
    const ipRe =
      /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(?:\/(?:3[0-2]|[12]?[0-9]|[0-9]))?$/;
    for (let i = 0; i < nicUi.length; i++) {
      const u = nicUi[i];
      const m = String(u.macAddress || "").trim();
      if (m && !macRe.test(m)) {
        message.error(`网卡 #${i + 1}：MAC 格式须如 52:54:00:12:34:56`);
        return false;
      }
      const ip = String(u.ipAddress || "").trim();
      if (ip && !ipRe.test(ip)) {
        message.error(`网卡 #${i + 1}：静态 IP 格式无效`);
        return false;
      }
      if (u.netMode === "flat" && !String(u.multusName || "").trim()) {
        message.error(`网卡 #${i + 1}：请选择 NAD 网络`);
        return false;
      }
      if (u.netMode === "passthrough" && !String(u.multusName || "").trim()) {
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
  };

  const handleSave = async () => {
    if (!hasEcsWrite) {
      message.error("无云主机写权限");
      return;
    }
    if (!cloudId || !vmNs || !vmName) {
      message.error("无法解析虚拟机信息");
      return;
    }
    if (!validateBeforeSave()) return;

    const nameSet = new Set<string>();
    for (const x of interfaces) {
      const n = String(x?.name || "").trim();
      if (!n) {
        message.error("接口名不能为空");
        return;
      }
      if (nameSet.has(n)) {
        message.error(`接口名重复：${n}`);
        return;
      }
      nameSet.add(n);
    }

    let nextIfaces = deepClone(interfaces);
    let nextNets = orderNetworksForInterfaces(nextIfaces, networks);
    for (let i = 0; i < nextIfaces.length; i++) {
      const slice = nicUi[i];
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
      mergeNetworkDataForNics(vmData, ifaceNames, nicUi, nextIfaces);
    nextIfaces = withMac;

    const payload: any = {
      interfaces: nextIfaces,
      networks: nextNets,
    };
    if (hasNetworkDataChange) {
      payload.networkData = dumpNetworkDataYaml(networkDataObj);
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
      message.success("网卡配置已保存");
      await onApplied();
      setBaseline(snapshot(nextIfaces, nextNets, nicUi));
      onClose();
    } catch (e: any) {
      message.error(e?.message || "保存失败");
    } finally {
      setSaving(false);
    }
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
            disabled={!dirty || !hasEcsWrite}
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
              disabled={!hasEcsWrite}
              onClick={() => openAddNicDrawer("flat_subnet")}
            >
              + 扁平子网
            </Button>
            <Button
              type="link"
              disabled={!hasEcsWrite}
              onClick={() => openAddNicDrawer("vpc")}
            >
              + VPC 网络
            </Button>
            <Button
              type="link"
              disabled={!hasEcsWrite}
              onClick={() => openAddNicDrawer("sriov")}
            >
              + 直通网卡
            </Button>
            <Button
              type="link"
              disabled={!hasEcsWrite}
              onClick={() => openAddNicDrawer("nad")}
            >
              + NAD 网络
            </Button>
          </Space>
        </div>

        {interfaces.length === 0 ? (
          <div className="vmDeviceManageDrawer-emptyState">
            <Empty description="当前无网卡。请使用顶部「添加」入口进行配置；修改后需保存方可生效。" />
          </div>
        ) : null}

        {/* ===== 网卡卡片：每块一块 vmManageDrawer-panel ===== */}
        {interfaces.map((iface, idx) => {
          const slice = nicUi[idx];
          if (!slice) return null;
          const mode = slice.netMode;

          const runtimeIp = String(findIp(iface.name) || "").trim();

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
          if (mode === "flat" || mode === "passthrough") {
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
              key={`${iface?.name}-${idx}`}
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
                    <Tag color="blue">{nicModelDisplayLabel(slice.model)}</Tag>
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
                          disabled={!hasEcsWrite || idx === 0}
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
                            !hasEcsWrite || idx === interfaces.length - 1
                          }
                          onClick={() => move(idx, 1)}
                        />
                      </span>
                    </Tooltip>
                    <Tooltip title="从规格移除此网卡">
                      <span>
                        <Popconfirm
                          title="解绑该网卡？"
                          description="将从虚拟机规格中移除此网卡及其网络定义。"
                          okText="解绑"
                          okButtonProps={{ danger: true }}
                          disabled={!hasEcsWrite || interfaces.length <= 1}
                          onConfirm={() => unbindAt(idx)}
                        >
                          <Button
                            type="text"
                            icon={<MinusCircleOutlined />}
                            danger
                            disabled={!hasEcsWrite || interfaces.length <= 1}
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
                        onChange={(e) =>
                          applyIfaceNameAt(idx, e.target.value)
                        }
                      />
                    </Col>
                    <Col span={8}>
                      <Input
                        prefix="MAC"
                        placeholder="52:54:00:12:34:56"
                        value={slice.macAddress || ""}
                        disabled={!hasEcsWrite}
                        onChange={(e) =>
                          applySliceAt(idx, {
                            ...slice,
                            macAddress: e.target.value,
                          })
                        }
                      />
                    </Col>
                    <Col span={8}>
                      <Input
                        prefix="静态IP"
                        placeholder="192.168.1.10/24"
                        value={slice.ipAddress || ""}
                        disabled={!hasEcsWrite}
                        onChange={(e) =>
                          applySliceAt(idx, {
                            ...slice,
                            ipAddress: e.target.value,
                          })
                        }
                      />
                    </Col>
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
                  </Row>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {/* ===== 新增网卡向导（各类型独立抽屉）+ 子网只读详情 ===== */}
      <VmAddNicFlatSubnetDrawer
        open={addNicFlatOpen && !!cloudId}
        onClose={() => setAddNicFlatOpen(false)}
        vmData={vmData}
        cloudId={cloudId || ""}
        hasEcsWrite={hasEcsWrite}
        onApplied={async () => {
          await onApplied();
        }}
      />
      <VmAddNicVpcDrawer
        open={addNicVpcOpen && !!cloudId}
        onClose={() => setAddNicVpcOpen(false)}
        vmData={vmData}
        cloudId={cloudId || ""}
        hasEcsWrite={hasEcsWrite}
        onApplied={async () => {
          await onApplied();
        }}
      />
      <VmAddNicSriovDrawer
        open={addNicSriovOpen && !!cloudId}
        onClose={() => setAddNicSriovOpen(false)}
        vmData={vmData}
        cloudId={cloudId || ""}
        hasEcsWrite={hasEcsWrite}
        onApplied={async () => {
          await onApplied();
        }}
      />
      <VmAddNicNadDrawer
        open={addNicNadOpen && !!cloudId}
        onClose={() => setAddNicNadOpen(false)}
        vmData={vmData}
        cloudId={cloudId || ""}
        hasEcsWrite={hasEcsWrite}
        onApplied={async () => {
          await onApplied();
        }}
      />
      {cloudId ? (
        <SubnetDetailDrawer
          open={subnetDrawerOpen}
          onClose={() => {
            setSubnetDrawerOpen(false);
            setSubnetDrawerRecord(null);
          }}
          cloudId={cloudId}
          subnet={subnetDrawerRecord}
          kindLabel={subnetDrawerKindLabel}
        />
      ) : null}
    </Drawer>
  );
};

export default VmNicManageDrawer;
