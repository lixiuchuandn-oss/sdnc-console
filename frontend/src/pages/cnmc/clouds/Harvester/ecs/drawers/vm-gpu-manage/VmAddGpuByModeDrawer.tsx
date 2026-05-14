/**
 * 按类型添加 GPU（直通 / SR-IOV / vGPU）：单选资源后即时 PATCH（对齐「添加网卡」子抽屉）。
 */
import React, { useEffect, useMemo, useState } from "react";
import { Alert, Button, Descriptions, Drawer, Flex, Form, Select, message } from "antd";
import { LoadingOutlined } from "@ant-design/icons";
import type { VmGpuManageSubmitDeps } from "./runVmGpuManageSubmit";
import { submitVmGpuValuesWithNadGuard } from "./runVmGpuManageSubmit";
import { VmReconfigureSubmitSkipFinalize } from "../../lib/vmMutation/vmReconfigureSubmitTypes";
import { useVmManageDrawerCssVars } from "../shared/lib/useVmManageDrawerCssVars";
import "../shared/styles/vmManageDrawer.css";
import {
  useVmAddGpuDrawerData,
} from "./lib/useVmAddGpuDrawerData";
import { deriveVmGpuEditorState } from "./lib/deriveVmGpuEditorState";
import { gpuKeysToSubmitValues } from "./lib/gpuKeysToSubmitValues";
import { getGpuResourceUiLabel } from "./lib/gpuDisplayText";

export type VmGpuAddMode = "passthrough" | "sriov" | "vgpu";

export type VmAddGpuByModeDrawerProps = {
  open: boolean;
  onClose: () => void;
  vmData: any;
  cloudId: string;
  hasEcsWrite: boolean;
  onApplied: () => void | Promise<void>;
  gpuMode: VmGpuAddMode;
  latestVm: any | null;
  gpuResourcesProp?: any[];
  gpuSubmitDeps: VmGpuManageSubmitDeps;
};

type GpuPickDetailRow = {
  displayName: string;
  node: string;
  bus: string;
  resourceName: string;
  crName: string;
  claimed: boolean;
};

function formatClaimed(claimed: boolean): string {
  return claimed ? "是（可能已被占用）" : "否";
}

/** 下拉文案：同名卡用「节点」「PCI」区分；可与搜索框关键字匹配这些片段 */
function buildGpuSelectOptionLabel(r: any): string {
  const display = String(r?.name || "-").trim() || "-";
  const raw = r?.raw;
  const nodeRaw = String(r?.node ?? "").trim();
  const node = nodeRaw && nodeRaw !== "-" ? nodeRaw : "";
  const pciRaw =
    String(raw?.pciAddress || raw?.address || raw?.pci || "").trim() ||
    String(r?.key || "")
      .split("|")[2]
      ?.trim() ||
    "";
  const pci = pciRaw && pciRaw !== "-" ? pciRaw : "";
  const bits: string[] = [display];
  if (node) bits.push(node);
  if (pci) bits.push(pci);
  return bits.join(" · ");
}

const VmAddGpuByModeDrawer: React.FC<VmAddGpuByModeDrawerProps> = ({
  open,
  onClose,
  vmData,
  cloudId,
  hasEcsWrite,
  onApplied,
  gpuMode,
  latestVm,
  gpuResourcesProp,
  gpuSubmitDeps,
}) => {
  const vmManageCssVars = useVmManageDrawerCssVars();
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const { localGpus, reloadGpuResources, ensureGpusLoaded, isHotPlugInProgress } =
    useVmAddGpuDrawerData({ vmData, cloudId });
  const [gpuLoading, setGpuLoading] = useState(false);

  const vmNs = String(vmData?.metadata?.namespace || "").trim();
  const vmName = String(
    vmData?.metadata?.name || vmData?.spec?.template?.metadata?.name || "",
  ).trim();

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    const load = async () => {
      if (Array.isArray(gpuResourcesProp) && gpuResourcesProp.length > 0) {
        setGpuLoading(false);
        return;
      }
      setGpuLoading(true);
      try {
        await reloadGpuResources();
      } finally {
        setGpuLoading(false);
      }
    };
    void load();
  }, [open, form, gpuResourcesProp, reloadGpuResources]);

  const mergedResources = useMemo(() => {
    if (Array.isArray(gpuResourcesProp) && gpuResourcesProp.length > 0)
      return gpuResourcesProp;
    return localGpus;
  }, [gpuResourcesProp, localGpus]);

  const modeTitle =
    gpuMode === "passthrough"
      ? "直通 GPU"
      : gpuMode === "sriov"
        ? "SR-IOV GPU"
        : "vGPU";

  const optionsAndMaps = useMemo(() => {
    const list = Array.isArray(mergedResources) ? mergedResources : [];
    const byMode = list.filter((x: any) => String(x?.type) === gpuMode);
    const onlyNode = byMode.filter((x: any) => !!(x?.node || x?.nodeName));
    const src = onlyNode.length ? onlyNode : byMode;

    const data = src.map((x: any) => ({
      key: `${(x?.raw?.metadata?.name || x?.name || x?.resourceName) || "-"}|${x?.node || x?.nodeName}|${x?.pciAddress || x?.address || x?.pci}`,
      node: x?.node || x?.nodeName || "-",
      name: getGpuResourceUiLabel(x),
      resourceName:
        x?.resourceName || x?.raw?.status?.resourceName || x?.raw?.spec?.resourceName,
      claimed: x?.claimed,
      raw: x,
    }));

    const keyToResName = new Map<string, string>();
    data.forEach((r: any) => {
      if (r.key) keyToResName.set(String(r.key), String(r.resourceName || ""));
    });
    const keyToNode = new Map<string, string>();
    data.forEach((r: any) => {
      if (r.key) keyToNode.set(String(r.key), String(r.node || ""));
    });

    const activeVmForDerive = latestVm || vmData;
    const existing = deriveVmGpuEditorState(activeVmForDerive, mergedResources);
    const usedKeys = new Set(existing.keys.filter(Boolean));

    let lockedNode = "";
    for (const k of existing.keys) {
      const n = String(keyToNode.get(String(k)) || "").trim();
      if (n && n !== "-") {
        lockedNode = n;
        break;
      }
    }

    const currentVmGpuResourceNames = new Set<string>();
    if (existing.gpuMode !== "none") {
      const domain = activeVmForDerive?.spec?.template?.spec?.domain;
      const hostDevices = domain?.devices?.hostDevices || [];
      const gpus = domain?.devices?.gpus || [];
      const vmAssigned = existing.gpuMode === "vgpu" ? gpus : hostDevices;
      (Array.isArray(vmAssigned) ? vmAssigned : []).forEach((d: any) => {
        const n = String(d?.deviceName || "").trim();
        if (n) currentVmGpuResourceNames.add(n);
      });
    }

    const filtered = data.filter((r: any) => {
      const k = String(r?.key || "");
      if (!k) return false;
      if (usedKeys.has(k)) return false;
      if (
        lockedNode &&
        String(r?.node || "") &&
        String(r?.node || "") !== "-" &&
        String(r?.node || "") !== lockedNode
      )
        return false;
      const resourceName = String(r?.resourceName || "").trim();
      if (resourceName && r?.claimed === true) {
        if (!currentVmGpuResourceNames.has(resourceName)) return false;
      }
      return true;
    });

    const keyToDetail = new Map<string, GpuPickDetailRow>();
    filtered.forEach((r: any) => {
      const k = String(r?.key || "");
      if (!k) return;
      const raw = r.raw;
      const bus =
        raw?.pciAddress ||
        raw?.address ||
        raw?.pci ||
        String(k).split("|")[2] ||
        "-";
      keyToDetail.set(k, {
        displayName: String(r?.name || "-"),
        node: String(r?.node || "-"),
        bus: String(bus || "-"),
        resourceName: String(r?.resourceName || "").trim() || "—",
        crName: String(raw?.metadata?.name || raw?.name || String(k).split("|")[0] || "—"),
        claimed: r?.claimed === true,
      });
    });

    const selectOpts = filtered.map((r: any) => ({
      label: buildGpuSelectOptionLabel(r),
      value: String(r?.key || ""),
    }));

    return { selectOpts, keyToResName, keyToDetail };
  }, [mergedResources, gpuMode, latestVm, vmData]);

  const gpuPick = Form.useWatch("gpuPick", form);
  const pickedDetail =
    gpuPick && typeof gpuPick === "string"
      ? optionsAndMaps.keyToDetail.get(String(gpuPick))
      : undefined;

  const footerDisabled = !hasEcsWrite || isHotPlugInProgress;

  const handleSubmit = async () => {
    if (!hasEcsWrite || !cloudId || !vmNs || !vmName) return;
    try {
      const v = await form.validateFields();
      const picked = String(v.gpuPick || "").trim();
      if (!picked) {
        message.error("请选择 GPU");
        return;
      }
      const activeVm = latestVm || vmData;
      const resList =
        mergedResources.length > 0 ? mergedResources : (await ensureGpusLoaded());

      const st = deriveVmGpuEditorState(activeVm, resList);
      if (st.gpuMode !== "none" && st.gpuMode !== gpuMode) {
        message.warning("请先解绑已绑定 GPU，再切换为其他 GPU 类型");
        return;
      }

      const keyToRes = optionsAndMaps.keyToResName;
      const rn = keyToRes.get(picked);
      if (!rn) {
        message.error("所选 GPU 已不可用，请刷新列表后重试");
        return;
      }

      const nextKeys =
        st.gpuMode === "none" ? [picked] : [...st.keys.filter(Boolean), picked];
      const nextVals = gpuKeysToSubmitValues(gpuMode, nextKeys, resList);

      if (nextVals.gpuResourceNames.length !== nextKeys.length) {
        message.error("无法解析 GPU 资源名，请刷新后重试");
        return;
      }

      setSubmitting(true);
      const ok = await submitVmGpuValuesWithNadGuard(gpuSubmitDeps, nextVals);
      if (!ok) return;
      await onApplied?.();
      onClose();
      form.resetFields();
    } catch (e: any) {
      if (
        e instanceof VmReconfigureSubmitSkipFinalize ||
        e?.name === "VmReconfigureSubmitSkipFinalize"
      ) {
        return;
      }
      if (e?.errorFields) return;
      let errorMsg = e?.message || "保存失败";
      if (typeof errorMsg === "string") {
        const nadNotFound = errorMsg.match(
          /network-attachment-definitions\.k8s\.cni\.cncf\.io\s+"([^"]+)"\s+not\s+found/i,
        );
        if (nadNotFound?.[1]) {
          errorMsg = `更新失败：引用的网络附件（NAD）不存在：${nadNotFound[1]}。`;
        }
      }
      message.error(errorMsg);
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
            disabled={footerDisabled}
            onClick={() => void handleSubmit()}
          >
            保存
          </Button>
        </Flex>
      }
    >
      <div className="vmManageDrawer vmNicManageDrawer vmGpuManageDrawer" style={vmManageCssVars}>
        {isHotPlugInProgress ? (
          <Alert
            type="warning"
            showIcon
            icon={<LoadingOutlined />}
            message="热扩容进行中"
            description="CPU 或内存热扩容完成前，请避免变更 GPU。"
            style={{ marginBottom: 16 }}
          />
        ) : null}
        <Form
          form={form}
          layout="horizontal"
          labelAlign="left"
          labelCol={{ span: 6 }}
          wrapperCol={{ span: 18 }}
        >
          <Form.Item
            label={modeTitle}
            name="gpuPick"
            rules={[{ required: true, message: `请选择 ${modeTitle}` }]}
          >
            <Select
              showSearch
              allowClear
              placeholder={`选择 ${modeTitle}`}
              options={optionsAndMaps.selectOpts}
              optionFilterProp="label"
              loading={gpuLoading}
              notFoundContent={gpuLoading ? "加载中..." : "暂无可选 GPU"}
              onDropdownVisibleChange={(o) => {
                if (o) void reloadGpuResources();
              }}
            />
          </Form.Item>
          {gpuMode === "passthrough" && pickedDetail ? (
            <Form.Item label=" " colon={false} style={{ marginBottom: 0 }}>
              <Descriptions
                bordered
                size="small"
                column={1}
                style={{ maxWidth: "100%" }}
                items={[
                  { key: "d1", label: "设备", children: pickedDetail.displayName },
                  { key: "d2", label: "节点", children: pickedDetail.node },
                  { key: "d3", label: "PCI 地址", children: pickedDetail.bus },
                  { key: "d4", label: "资源名", children: pickedDetail.resourceName },
                  { key: "d5", label: "设备 CR", children: pickedDetail.crName },
                  { key: "d6", label: "已声明占用", children: formatClaimed(pickedDetail.claimed) },
                ]}
              />
            </Form.Item>
          ) : null}
        </Form>
      </div>
    </Drawer>
  );
};

export default VmAddGpuByModeDrawer;
