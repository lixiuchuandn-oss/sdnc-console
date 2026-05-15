/**
 * 虚拟机 · 节点亲和性（nodeAffinity）：从详情「节点调度」打开；原在资源变配弹窗。
 */
import React, { useEffect, useState } from "react";
import { Button, Drawer, Flex, Form, message } from "antd";
import ChangeNodeAffinity from "./ChangeNodeAffinity";
import { buildVmReconfigureSubmitCtx } from "../../lib/vmMutation/vmReconfigureSubmitContext";
import { VmReconfigureSubmitSkipFinalize } from "../../lib/vmMutation/vmReconfigureSubmitTypes";
import { submitVmReconfigureChangeNodeAffinity } from "./lib/submitNodeAffinity";
import { useVmManageDrawerCssVars } from "../shared/lib/useVmManageDrawerCssVars";
import "../shared/styles/vmManageDrawer.css";
import { useVmSpecPostSubmit } from "../vm-spec-config/lib/useVmSpecPostSubmit";

export type VmNodeAffinityDrawerProps = {
  open: boolean;
  onClose: () => void;
  vmData: any;
  cloudId: string;
  latestVm: any;
  setLatestVm: (v: any) => void;
  hasEcsWrite: boolean;
  onApplied: () => void | Promise<void>;
};

const noopEnsureNads = async () => [] as any[];
const noopMaybePromptRestart = async () => {};

const VmNodeAffinityDrawer: React.FC<VmNodeAffinityDrawerProps> = ({
  open,
  onClose,
  vmData,
  cloudId,
  latestVm,
  setLatestVm,
  hasEcsWrite,
  onApplied,
}) => {
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
  }, [open, vmIdentity, vmData, form]);

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
        selectedKey: "change_node_affinity",
        gpuResources: [],
        usbResources: [],
        setLatestVm,
        ensureNadsLoaded: noopEnsureNads,
        openRestartConfirm,
        maybePromptRestart: noopMaybePromptRestart,
        fetchAggregatedVm,
        onOk: onApplied,
        onClose,
      });
      await submitVmReconfigureChangeNodeAffinity(ctx, values, vmName, namespace);
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
          <ChangeNodeAffinity
            form={form}
            cloudId={cloudId}
            record={activeRecord}
          />
        </Form>
      </div>
    </Drawer>
  );
};

export default VmNodeAffinityDrawer;
