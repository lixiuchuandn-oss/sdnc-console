/**
 * 添加辅助网卡 · 直通（PCI 整卡 / SR-IOV VF + Multus SR-IOV/macvtap/macvlan，与创建向导 StepNetworks 直通一致）。
 * 网卡类型在抽屉内用分段控件切换，入口可传入初始选中项。
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Drawer,
  Flex,
  Form,
  Segmented,
  Select,
  message,
} from "antd";
import { LoadingOutlined } from "@ant-design/icons";
import {
  fetchHarvesterNodes,
  fetchHarvesterPciDevices,
} from "../../../../../../../services/harvesterApi";
import { useAggregatedVmForReconfigureDrawer } from "../shared/lib/useAggregatedVmForReconfigureDrawer";
import { useVmManageDrawerCssVars } from "../shared/lib/useVmManageDrawerCssVars";
import "../shared/styles/vmManageDrawer.css";
import {
  type VmAddNicDrawerBaseProps,
  useVmAddNicDrawerData,
} from "./lib/useVmAddNicDrawerData";
import { buildVmAddNicNadInfos } from "./lib/vmAddNicDrawerNadMeta";
import {
  buildSecondaryRowPassthroughMultus,
  buildSecondaryRowPassthroughPci,
} from "./lib/vmAddNicDrawerRowBuild";
import { submitAppendSecondaryNicRow } from "./lib/vmAddNicDrawerSubmit";
import {
  PT_PREFIX_MULTUS,
  PT_PREFIX_PCI,
  buildGroupedPassthroughSelectOptions,
  buildPciNicPassthroughSelectOptions,
  passthroughExclusionToFilterOpts,
  pciPassthroughSelectScopeFromWizardNetMode,
  resolveVmPassthroughSchedulingHost,
  validateAppendPassthroughPciNodeAffinity,
  wizardPassthroughPickFieldLabel,
  wizardPassthroughPickRequiredMessage,
  type PassthroughSelectionExclusion,
} from "../../lib/passthroughNicSelectOptions";

export type VmAddNicSriovPassthroughWizardMode = "passthrough" | "passthrough_sriov";

export type VmAddNicSriovDrawerProps = VmAddNicDrawerBaseProps & {
  /** 打开抽屉时的初始网卡类型（抽屉内可改） */
  initialPassthroughWizardNetMode?: VmAddNicSriovPassthroughWizardMode;
  /** 主抽屉已选直通项（含未保存），添加时从下拉中排除 */
  passthroughExclude?: PassthroughSelectionExclusion;
};

const PASSTHROUGH_TYPE_SEGMENTED_OPTIONS: {
  label: string;
  value: VmAddNicSriovPassthroughWizardMode;
}[] = [
  { label: "直通", value: "passthrough" },
  { label: "SR-IOV", value: "passthrough_sriov" },
];

const VmAddNicSriovDrawer: React.FC<VmAddNicSriovDrawerProps> = ({
  open,
  onClose,
  vmData,
  cloudId,
  hasEcsWrite,
  onApplied,
  initialPassthroughWizardNetMode = "passthrough",
  passthroughExclude,
}) => {
  const vmManageCssVars = useVmManageDrawerCssVars();
  const [form] = Form.useForm();
  const [wizardNetMode, setWizardNetMode] =
    useState<VmAddNicSriovPassthroughWizardMode>("passthrough");
  const [submitting, setSubmitting] = useState(false);
  const [pciDevices, setPciDevices] = useState<any[]>([]);
  const [nodes, setNodes] = useState<any[]>([]);
  const [nodesLoading, setNodesLoading] = useState(false);

  const {
    latestVm,
    loading: vmSpecLoading,
    fetchFailed: vmSpecFetchFailed,
  } = useAggregatedVmForReconfigureDrawer(open, cloudId, vmData);
  /** 拉取完成前不用父级 vmData，避免仍显示创建时 nodeSelector（如 node2） */
  const activeVm = latestVm ?? (vmSpecFetchFailed ? vmData : null);

  const {
    localNads,
    localSubnets,
    reloadNads,
    reloadVpcs,
    reloadSubnets,
    ensureNadsLoaded,
    isHotPlugInProgress,
  } = useVmAddNicDrawerData({ vmData: activeVm, cloudId });

  const vmNs = String(vmData?.metadata?.namespace || "").trim();
  const vmName = String(
    vmData?.metadata?.name || vmData?.spec?.template?.metadata?.name || "",
  ).trim();

  const schedulingHost = useMemo(
    () => (activeVm ? resolveVmPassthroughSchedulingHost(activeVm) : ""),
    [activeVm],
  );

  const nadInfos = useMemo(() => buildVmAddNicNadInfos(localNads), [localNads]);

  const passthroughBindNode = Form.useWatch("passthroughBindNode", form);
  const passthroughPickWatch = Form.useWatch("passthroughPick", form);

  const passthroughSelectFilter = useMemo(
    () =>
      passthroughExclusionToFilterOpts(
        passthroughExclude ?? {
          pciCrNames: new Set(),
          multusNadValues: new Set(),
        },
        String(passthroughPickWatch || ""),
      ),
    [passthroughExclude, passthroughPickWatch],
  );

  const pciPassthroughOptsForBindNode = useMemo(() => {
    const bn = String(passthroughBindNode || "").trim();
    const list = Array.isArray(pciDevices) ? pciDevices : [];
    const filtered = bn
      ? list.filter((raw: any) => {
          const n = String(raw?.status?.nodeName ?? raw?.spec?.nodeName ?? "").trim();
          return n === bn;
        })
      : [];
    const pciScope = pciPassthroughSelectScopeFromWizardNetMode(wizardNetMode);
    return buildPciNicPassthroughSelectOptions(filtered, pciScope, passthroughSelectFilter);
  }, [pciDevices, passthroughBindNode, wizardNetMode, passthroughSelectFilter]);

  const groupedPassthrough = useMemo(() => {
    return buildGroupedPassthroughSelectOptions(
      pciPassthroughOptsForBindNode,
      nadInfos as any,
      {
        compactPassthroughLabels: true,
        ...passthroughSelectFilter,
      },
    );
  }, [pciPassthroughOptsForBindNode, nadInfos, passthroughSelectFilter]);

  /** 不使用分组：避免下拉中出现非可选的分组标题行 */
  const flatPassthroughSelectOptions = useMemo(
    () =>
      groupedPassthrough.flatMap((g) =>
        (Array.isArray(g.options) ? g.options : []) as { label?: unknown; value: string }[],
      ),
    [groupedPassthrough],
  );

  const nodeOpts = useMemo(
    () =>
      (Array.isArray(nodes) ? nodes : [])
        .map((node: any) => {
          const nm = String(node?.metadata?.name || node?.name || "").trim();
          if (!nm) return null;
          return { label: nm, value: nm };
        })
        .filter(Boolean) as { label: string; value: string }[],
    [nodes],
  );

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

  const reloadNodes = useCallback(async () => {
    if (!cloudId) return;
    try {
      setNodesLoading(true);
      const nd: any = await fetchHarvesterNodes(cloudId, true);
      const items: any[] = nd?.data?.items || nd?.items || [];
      setNodes(items);
    } catch {
      setNodes([]);
    } finally {
      setNodesLoading(false);
    }
  }, [cloudId]);

  useEffect(() => {
    if (!open) return;
    setWizardNetMode(initialPassthroughWizardNetMode ?? "passthrough");
    form.resetFields();
    void Promise.all([
      reloadNads(),
      reloadVpcs(),
      reloadSubnets(),
      reloadPciDevices(),
      reloadNodes(),
    ]);
  }, [
    open,
    initialPassthroughWizardNetMode,
    form,
    reloadNads,
    reloadVpcs,
    reloadSubnets,
    reloadPciDevices,
    reloadNodes,
  ]);

  /** 聚合 VM 就绪后，按最新调度/运行节点预填 */
  useEffect(() => {
    if (!open || !activeVm) return;
    const pre = resolveVmPassthroughSchedulingHost(activeVm);
    if (!pre) return;
    const cur = String(form.getFieldValue("passthroughBindNode") || "").trim();
    if (cur === pre) return;
    form.setFieldsValue({
      passthroughBindNode: pre,
      ...(cur && cur !== pre ? { passthroughPick: undefined } : {}),
    });
  }, [open, activeVm, latestVm, schedulingHost, form]);

  const footerDisabled = !hasEcsWrite || isHotPlugInProgress;

  const handleSubmit = async () => {
    if (!hasEcsWrite || !cloudId || !vmNs || !vmName) return;
    try {
      const v = await form.validateFields();
      const pick = String(v.passthroughPick || "").trim();
      let row: Record<string, unknown> | null = null;
      if (pick.startsWith(PT_PREFIX_PCI)) {
        const cr = pick.slice(PT_PREFIX_PCI.length);
        const hit = pciPassthroughOptsForBindNode.find((x) => String(x?.value) === pick);
        const rn = String(hit?._pciResourceName || "").trim();
        if (!rn) {
          message.error("未解析到 PCI 设备资源名，请重新选择或刷新 PCI 列表");
          return;
        }
        row = buildSecondaryRowPassthroughPci({
          pciDeviceName: cr,
          pciResourceName: String(hit?._pciResourceName || "").trim(),
          pciNodeName: String(hit?._pciNodeName || "").trim(),
          passthroughPick: pick,
          nicWizardMode: wizardNetMode,
          passthroughBindNode: String(v.passthroughBindNode || "").trim() || undefined,
        });
      } else if (pick.startsWith(PT_PREFIX_MULTUS)) {
        const multusVal = pick.slice(PT_PREFIX_MULTUS.length);
        row = buildSecondaryRowPassthroughMultus(multusVal);
      }
      if (!row || Object.keys(row).length === 0) {
        message.error("请选择直通网络（PCI 或 Multus）");
        return;
      }
      if (pick.startsWith(PT_PREFIX_PCI)) {
        const affinityErr = validateAppendPassthroughPciNodeAffinity({
          vm: activeVm || vmData,
          pciNodeName: String(row.pciNodeName || "").trim(),
          bindNode: String(v.passthroughBindNode || "").trim(),
          pciDevices,
        });
        if (affinityErr) {
          message.error(affinityErr);
          return;
        }
      }
      const nadList = await ensureNadsLoaded();
      setSubmitting(true);
      await submitAppendSecondaryNicRow({
        cloudId,
        vmData: activeVm || vmData,
        newRow: row,
        subnets: localSubnets,
        nads: nadList,
        vmNs,
        vmName,
        pciDevices,
      });
      onClose();
      await onApplied();
    } catch (e: any) {
      if (e?.errorFields) return;
      if (
        e?.message === "compute_secondary_nic_failed" ||
        e?.message === "missing_nad" ||
        e?.message === "passthrough_pci_node_mismatch"
      )
        return;
      message.error(e?.message || "保存失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Drawer
      closable={false}
      width={800}
      placement="right"
      open={open}
      onClose={onClose}
      forceRender
      push={{ distance: 180 }}
      styles={{
        header: { display: "none" },
        body: { padding: 24 },
      }}
      footer={
        <Flex justify="flex-end" gap="small" wrap="wrap">
          <Button onClick={onClose}>取消</Button>
          <Button
            type="primary"
            loading={submitting}
            disabled={footerDisabled || vmSpecLoading}
            onClick={() => void handleSubmit()}
          >
            保存
          </Button>
        </Flex>
      }
    >
      <div
        className="vmManageDrawer vmNicManageDrawer vmAddNicSriovDrawer"
        style={vmManageCssVars}
      >
        {isHotPlugInProgress ? (
          <Alert
            type="warning"
            showIcon
            icon={<LoadingOutlined />}
            message="热扩容进行中"
            description="CPU 或内存热扩容完成前，请避免变更网卡。"
            className="vmManageDrawer-stackGap"
          />
        ) : null}
        <Form
          className="vmAddNicSriovDrawer-form"
          form={form}
          layout="horizontal"
          labelAlign="left"
          labelCol={{ span: 6 }}
          wrapperCol={{ span: 18 }}
        >
          <Form.Item label="网卡类型">
            <Segmented
              options={PASSTHROUGH_TYPE_SEGMENTED_OPTIONS}
              value={wizardNetMode}
              onChange={(v) => {
                setWizardNetMode(v as VmAddNicSriovPassthroughWizardMode);
                try {
                  form.setFieldsValue({ passthroughPick: undefined });
                } catch {
                  /* ignore */
                }
              }}
            />
          </Form.Item>
          <Form.Item
            label="节点"
            name="passthroughBindNode"
            rules={[{ required: true, message: "请选择节点" }]}
            extra={
              schedulingHost
                ? `当前调度/运行节点为 ${schedulingHost}，请在该节点上选择 PCI 直通网卡`
                : undefined
            }
          >
            <Select
              showSearch
              optionFilterProp="label"
              placeholder={
                vmSpecLoading ? "正在同步虚拟机最新调度…" : "选择宿主机节点"
              }
              loading={nodesLoading || vmSpecLoading}
              allowClear
              options={nodeOpts}
              onOpenChange={(o) => {
                if (o) void reloadNodes();
              }}
              onChange={() => {
                try {
                  form.setFieldsValue({ passthroughPick: undefined });
                } catch {
                  /* ignore */
                }
              }}
            />
          </Form.Item>
          <Form.Item
            label={wizardPassthroughPickFieldLabel(wizardNetMode)}
            name="passthroughPick"
            rules={[
              {
                required: true,
                message: wizardPassthroughPickRequiredMessage(wizardNetMode),
              },
            ]}
          >
            <Select
              showSearch
              placeholder={
                String(passthroughBindNode || "").trim() ? "请选择" : "请先选择节点"
              }
              options={flatPassthroughSelectOptions}
              optionFilterProp="label"
              onOpenChange={(o) => {
                if (o) {
                  void reloadNads();
                  void reloadPciDevices();
                  void reloadNodes();
                }
              }}
            />
          </Form.Item>
        </Form>
      </div>
    </Drawer>
  );
};

export default VmAddNicSriovDrawer;
