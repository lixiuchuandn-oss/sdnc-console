/**
 * 「添加 USB」子抽屉：单选资源后即时 PATCH（对齐添加 GPU / 网卡子抽屉）。
 */
import React, { useEffect, useMemo, useState } from "react";
import { Alert, Button, Descriptions, Drawer, Flex, Form, Select, message } from "antd";
import { LoadingOutlined } from "@ant-design/icons";
import type { VmUsbManageSubmitDeps } from "./runVmUsbManageSubmit";
import { submitVmUsbValuesWithNadGuard } from "./runVmUsbManageSubmit";
import { VmReconfigureSubmitSkipFinalize } from "../../lib/vmMutation/vmReconfigureSubmitTypes";
import { useVmManageDrawerCssVars } from "../shared/lib/useVmManageDrawerCssVars";
import "../shared/styles/vmManageDrawer.css";
import { useVmAddUsbDrawerData } from "./lib/useVmAddUsbDrawerData";
import { deriveVmUsbEditorState } from "./lib/deriveVmUsbEditorState";
import {
  buildUsbSelectOptionLabel,
  normalizeUsbResources,
  type NormalizedUsbRow,
} from "./lib/normalizeUsbResources";

export type VmAddUsbDrawerProps = {
  open: boolean;
  onClose: () => void;
  vmData: any;
  cloudId: string;
  hasEcsWrite: boolean;
  onApplied: () => void | Promise<void>;
  latestVm: any | null;
  usbResourcesProp?: any[];
  usbSubmitDeps: VmUsbManageSubmitDeps;
};

type UsbPickDetailRow = {
  displayName: string;
  node: string;
  vendor: string;
  vidPid: string;
  resourceName: string;
  crName: string;
  claimed: boolean;
};

function formatClaimed(claimed: boolean): string {
  return claimed ? "是（可能已被占用）" : "否";
}

const VmAddUsbDrawer: React.FC<VmAddUsbDrawerProps> = ({
  open,
  onClose,
  vmData,
  cloudId,
  hasEcsWrite,
  onApplied,
  latestVm,
  usbResourcesProp,
  usbSubmitDeps,
}) => {
  const vmManageCssVars = useVmManageDrawerCssVars();
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const { localUsbs, reloadUsbResources, ensureUsbsLoaded, isHotPlugInProgress } =
    useVmAddUsbDrawerData({ vmData, cloudId });
  const [usbLoading, setUsbLoading] = useState(false);

  const vmNs = String(vmData?.metadata?.namespace || "").trim();
  const vmName = String(
    vmData?.metadata?.name || vmData?.spec?.template?.metadata?.name || "",
  ).trim();

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    const load = async () => {
      if (Array.isArray(usbResourcesProp) && usbResourcesProp.length > 0) {
        setUsbLoading(false);
        return;
      }
      setUsbLoading(true);
      try {
        await reloadUsbResources();
      } finally {
        setUsbLoading(false);
      }
    };
    void load();
  }, [open, form, usbResourcesProp, reloadUsbResources]);

  const mergedResources = useMemo(() => {
    if (Array.isArray(usbResourcesProp) && usbResourcesProp.length > 0) return usbResourcesProp;
    return localUsbs;
  }, [usbResourcesProp, localUsbs]);

  const optionsAndMaps = useMemo(() => {
    const data = normalizeUsbResources(mergedResources);
    const activeVmForDerive = latestVm || vmData;
    const existing = deriveVmUsbEditorState(activeVmForDerive);
    const used = new Set(
      (existing.resourceNames || []).map((x) => String(x || "").trim()).filter(Boolean),
    );

    let lockedNode = "";
    for (const rn of existing.resourceNames) {
      const row = data.find((r) => r.resourceName === String(rn || "").trim());
      const n = String(row?.nodeName || "").trim();
      if (n) {
        lockedNode = n;
        break;
      }
    }

    const currentVmUsbResourceNames = new Set(
      (existing.resourceNames || []).map((n) => String(n || "").trim()).filter(Boolean),
    );

    const filtered = data.filter((r: NormalizedUsbRow) => {
      const rn = String(r.resourceName || "").trim();
      if (!rn) return false;
      if (used.has(rn)) return false;
      if (r.enabled !== true) return false;
      const node = String(r.nodeName || "").trim();
      if (lockedNode && node && node !== lockedNode) return false;
      if (r.claimed === true && !currentVmUsbResourceNames.has(rn)) return false;
      return true;
    });

    const rnToDetail = new Map<string, UsbPickDetailRow>();
    filtered.forEach((r) => {
      const rn = String(r.resourceName || "").trim();
      if (!rn) return;
      const code =
        r.vendorId && r.productId ? `${String(r.vendorId)}:${String(r.productId)}` : "—";
      rnToDetail.set(rn, {
        displayName: String(r.description || r.name || "-"),
        node: String(r.nodeName || "-"),
        vendor: String(r.vendor || "-"),
        vidPid: code,
        resourceName: rn,
        crName: String(r.name || r.raw?.metadata?.name || "—"),
        claimed: r.claimed === true,
      });
    });

    const selectOpts = filtered.map((r) => ({
      label: buildUsbSelectOptionLabel(r),
      value: String(r.resourceName),
    }));

    return { selectOpts, rnToDetail };
  }, [mergedResources, latestVm, vmData]);

  const usbPick = Form.useWatch("usbPick", form);
  const pickedDetail =
    usbPick && typeof usbPick === "string" ? optionsAndMaps.rnToDetail.get(String(usbPick)) : undefined;

  const footerDisabled = !hasEcsWrite || isHotPlugInProgress;

  const handleSubmit = async () => {
    if (!hasEcsWrite || !cloudId || !vmNs || !vmName) return;
    try {
      const v = await form.validateFields();
      const pickedRn = String(v.usbPick || "").trim();
      if (!pickedRn) {
        message.error("请选择 USB 设备");
        return;
      }
      const activeVm = latestVm || vmData;
      if (mergedResources.length === 0) await ensureUsbsLoaded();

      const st = deriveVmUsbEditorState(activeVm);
      const base = [...(st.resourceNames || []).map((x) => String(x || "").trim()).filter(Boolean)];
      const nextNames = base.includes(pickedRn) ? base : [...base, pickedRn];

      setSubmitting(true);
      const ok = await submitVmUsbValuesWithNadGuard(usbSubmitDeps, { usbResourceNames: nextNames });
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
      <div className="vmManageDrawer vmNicManageDrawer vmUsbManageDrawer" style={vmManageCssVars}>
        {isHotPlugInProgress ? (
          <Alert
            type="warning"
            showIcon
            icon={<LoadingOutlined />}
            message="热扩容进行中"
            description="CPU 或内存热扩容完成前，请避免变更 USB 设备。"
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
          <Form.Item label="USB" name="usbPick" rules={[{ required: true, message: "请选择 USB 设备" }]}>
            <Select
              showSearch
              allowClear
              placeholder="选择 USB 设备"
              options={optionsAndMaps.selectOpts}
              optionFilterProp="label"
              loading={usbLoading}
              notFoundContent={usbLoading ? "加载中..." : "暂无可选 USB"}
              onDropdownVisibleChange={(o) => {
                if (o) void reloadUsbResources();
              }}
            />
          </Form.Item>
          {pickedDetail ? (
            <Form.Item label=" " colon={false} style={{ marginBottom: 0 }}>
              <Descriptions
                bordered
                size="small"
                column={1}
                style={{ maxWidth: "100%" }}
                items={[
                  { key: "d1", label: "设备", children: pickedDetail.displayName },
                  { key: "d2", label: "节点", children: pickedDetail.node },
                  { key: "d3", label: "厂商", children: pickedDetail.vendor },
                  { key: "d4", label: "VID:PID", children: pickedDetail.vidPid },
                  { key: "d5", label: "资源名", children: pickedDetail.resourceName },
                  { key: "d6", label: "设备 CR", children: pickedDetail.crName },
                  { key: "d7", label: "已声明占用", children: formatClaimed(pickedDetail.claimed) },
                ]}
              />
            </Form.Item>
          ) : null}
        </Form>
      </div>
    </Drawer>
  );
};

export default VmAddUsbDrawer;
