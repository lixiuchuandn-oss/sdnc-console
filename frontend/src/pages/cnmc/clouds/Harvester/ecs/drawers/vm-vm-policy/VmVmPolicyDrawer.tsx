/**
 * 虚拟机 · 高可用设置（运行策略 / 驱逐策略）：从详情「其他选项」打开；与资源变配「高可用设置」同一套表单与提交。
 */
import React, { useEffect, useState } from "react";
import { Button, Drawer, Flex, Form, message } from "antd";
import { VmPolicyFormBody } from "./VmPolicyFormBody";
import { fillVmPolicyFormFromVm } from "./lib/initVmPolicyForm";
import { buildVmReconfigureSubmitCtx } from "../../lib/vmMutation/vmReconfigureSubmitContext";
import { VmReconfigureSubmitSkipFinalize } from "../../lib/vmMutation/vmReconfigureSubmitTypes";
import { submitVmReconfigureVmPolicy } from "./lib/submitVmPolicy";
import { useVmManageDrawerCssVars } from "../shared/lib/useVmManageDrawerCssVars";
import "../shared/styles/vmManageDrawer.css";
import { useVmSpecPostSubmit } from "../vm-spec-config/lib/useVmSpecPostSubmit";

export type VmVmPolicyDrawerProps = {
  open: boolean;
  onClose: () => void;
  vmData: any;
  cloudId: string;
  latestVm: any;
  setLatestVm: (v: any) => void;
  hasEcsWrite: boolean;
  onApplied: () => void | Promise<void>;
  /** 列表/控制台侧资源变配需真实 NAD 预检；详情「其他选项」入口可省略（默认空列表）。 */
  ensureNadsLoaded?: () => Promise<any[]>;
};

const noopEnsureNads = async () => [] as any[];
const noopMaybePromptRestart = async () => {};

const VmVmPolicyDrawer: React.FC<VmVmPolicyDrawerProps> = ({
  open,
  onClose,
  vmData,
  cloudId,
  latestVm,
  setLatestVm,
  hasEcsWrite,
  onApplied,
  ensureNadsLoaded: ensureNadsLoadedProp,
}) => {
  const ensureNadsLoaded = ensureNadsLoadedProp ?? noopEnsureNads;
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const vmManageCssVars = useVmManageDrawerCssVars();
  const activeRecord = latestVm || vmData;

  const { openRestartConfirm, fetchAggregatedVm } = useVmSpecPostSubmit({
    cloudId,
    record: vmData,
    latestVm,
    setLatestVm,
  });

  const vmIdentity =
    vmData?.metadata?.uid ||
    `${vmData?.metadata?.namespace || ""}/${vmData?.metadata?.name || ""}`;

  useEffect(() => {
    if (!open || !vmData) return;
    form.resetFields();
    fillVmPolicyFormFromVm(form, latestVm || vmData);
  }, [open, vmIdentity, latestVm, vmData, form]);

  const handleSubmit = async () => {
    if (!hasEcsWrite) return;
    const vmName = activeRecord?.metadata?.name;
    const namespace = activeRecord?.metadata?.namespace;
    if (!vmName || !namespace) {
      message.error("缺少虚拟机名称或命名空间");
      return;
    }

    try {
      const values = await form.validateFields();
      setSubmitting(true);
      const ctx = buildVmReconfigureSubmitCtx({
        form,
        cloudId,
        record: vmData,
        latestVm,
        activeRecord: latestVm || vmData,
        selectedKey: "vm_policy",
        gpuResources: [],
        usbResources: [],
        setLatestVm,
        ensureNadsLoaded,
        openRestartConfirm,
        maybePromptRestart: noopMaybePromptRestart,
        fetchAggregatedVm,
        onOk: onApplied,
        onClose,
      });
      await submitVmReconfigureVmPolicy(ctx, values, vmName, namespace);
      await onApplied?.();
      onClose?.();
    } catch (e: any) {
      if (
        e instanceof VmReconfigureSubmitSkipFinalize ||
        e?.name === "VmReconfigureSubmitSkipFinalize"
      ) {
        return;
      }
      if (e?.errorFields) return;
      message.error(e?.message || "提交失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Drawer
      placement="right"
      width={800}
      open={open}
      onClose={onClose}
      closable={false}
      destroyOnHidden
      zIndex={1150}
      push={{ distance: 180 }}
      styles={{
        header: { display: "none" },
        body: { padding: 24 },
      }}
      footer={
        <Flex justify="flex-end" gap="small" style={{ width: "100%" }}>
          <Button onClick={onClose}>取消</Button>
          <Button
            type="primary"
            loading={submitting}
            disabled={!hasEcsWrite}
            onClick={() => void handleSubmit()}
          >
            提交
          </Button>
        </Flex>
      }
    >
      <div className="vmManageDrawer" style={vmManageCssVars}>
        <Form form={form} layout="vertical" wrapperCol={{ span: 24 }}>
          <VmPolicyFormBody />
        </Form>
      </div>
    </Drawer>
  );
};

export default VmVmPolicyDrawer;
