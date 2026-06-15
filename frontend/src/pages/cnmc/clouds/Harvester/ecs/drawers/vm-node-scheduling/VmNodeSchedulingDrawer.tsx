/**
 * 虚拟机 · 节点选择器调度（nodeSelector）：从详情「节点调度」打开；原在资源变配弹窗。
 */
import React, { useCallback, useEffect, useState } from "react";
import { Button, Drawer, Flex, Form, message } from "antd";
import {
  fetchHarvesterNodes,
  fetchHarvesterPciDevices,
} from "../../../../../../../services/harvesterApi";
import ChangeNodeScheduling from "./ChangeNodeScheduling";
import { buildVmReconfigureSubmitCtx } from "../../lib/vmMutation/vmReconfigureSubmitContext";
import { VmReconfigureSubmitSkipFinalize } from "../../lib/vmMutation/vmReconfigureSubmitTypes";
import { submitVmReconfigureChangeNodeScheduling } from "./lib/submitNodeScheduling";
import { useVmManageDrawerCssVars } from "../shared/lib/useVmManageDrawerCssVars";
import "../shared/styles/vmManageDrawer.css";
import { useVmSpecPostSubmit } from "../vm-spec-config/lib/useVmSpecPostSubmit";

export type VmNodeSchedulingDrawerProps = {
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

const VmNodeSchedulingDrawer: React.FC<VmNodeSchedulingDrawerProps> = ({
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
  const [nodes, setNodes] = useState<any[]>([]);
  const [nodesLoading, setNodesLoading] = useState(false);
  const [pciDevices, setPciDevices] = useState<any[]>([]);
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

  const reloadNodes = useCallback(async () => {
    if (!cloudId) return [];
    setNodesLoading(true);
    try {
      const res = await fetchHarvesterNodes(cloudId);
      const items =
        res?.data?.items ||
        res?.items ||
        (Array.isArray(res?.data) ? res.data : []);
      const list = Array.isArray(items) ? items : [];
      setNodes(list);
      return list;
    } catch (e: any) {
      message.error(e?.message || "加载节点列表失败");
      return [];
    } finally {
      setNodesLoading(false);
    }
  }, [cloudId]);

  const reloadPciDevices = useCallback(async () => {
    if (!cloudId) return [];
    try {
      const json: any = await fetchHarvesterPciDevices(cloudId, true);
      const items: any[] = json?.data?.items || json?.items || [];
      const list = Array.isArray(items) ? items : [];
      setPciDevices(list);
      return list;
    } catch {
      setPciDevices([]);
      return [];
    }
  }, [cloudId]);

  useEffect(() => {
    if (!open || !cloudId) return;
    void Promise.all([reloadNodes(), reloadPciDevices()]);
  }, [open, cloudId, reloadNodes, reloadPciDevices]);

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
        selectedKey: "change_node_scheduling",
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
      await submitVmReconfigureChangeNodeScheduling(ctx, values, vmName, namespace, {
        pciDevices,
      });
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
        body: { width: "100%", maxWidth: "100%", boxSizing: "border-box" },
      }}
      footer={
        <Flex justify="flex-end" gap="small">
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
      <div
        className="vmManageDrawer"
        style={{ width: "100%", minWidth: 0, ...vmManageCssVars }}
      >
        <Form
          form={form}
          layout="vertical"
          style={{ width: "100%", maxWidth: "100%" }}
          wrapperCol={{ span: 24 }}
        >
          <ChangeNodeScheduling
            form={form}
            record={activeRecord}
            cloudId={cloudId}
            nodes={nodes}
            reloadNodes={reloadNodes}
            nodesLoading={nodesLoading}
            pciDevices={pciDevices}
          />
        </Form>
      </div>
    </Drawer>
  );
};

export default VmNodeSchedulingDrawer;
