/**
 * 虚拟机「性能设置」抽屉：CPU 高级 / QoS 表单与变配提交逻辑。
 * 由详情 Tab「规格配置」旁入口打开（详情抽屉 UI 挂载于 `VmDetailDrawerShell`。）
 *
 * 表单区与原 `CpuAdvanced.tsx` 合并于此。
 */
import React, { useEffect, useRef, useState } from "react";
import {
  Button,
  Checkbox,
  Col,
  Drawer,
  Flex,
  Form,
  Input,
  InputNumber,
  message,
  Row,
  Select,
  Space,
  Typography,
} from "antd";
import { fillCpuAdvancedFormFromVm } from "./lib/fillCpuAdvancedFormFromVm";
import { buildVmReconfigureSubmitCtx } from "../../lib/vmMutation/vmReconfigureSubmitContext";
import { VmReconfigureSubmitSkipFinalize } from "../../lib/vmMutation/vmReconfigureSubmitTypes";
import { submitVmReconfigureCpuAdvanced } from "./lib/submitCpuAdvanced";
import { useVmManageDrawerCssVars } from "../shared/lib/useVmManageDrawerCssVars";
import "../shared/styles/vmManageDrawer.css";
import { useVmSpecPostSubmit } from "./lib/useVmSpecPostSubmit";
import { fetchHarvesterNodes } from "../../../../../../../services/harvesterApi";

type VmSpecPerformanceCpuFieldsProps = {
  form: any;
  cloudId?: string;
  vmCpuState?: {
    cpu?: any;
    resources?: any;
  };
};

const VmSpecPerformanceCpuFields: React.FC<VmSpecPerformanceCpuFieldsProps> = ({
  form,
  cloudId,
  vmCpuState,
}) => {
  const [dedicatedChecked, setDedicatedChecked] = useState<boolean>(
    !!vmCpuState?.cpu?.dedicatedCpuPlacement,
  );
  const [isolateChecked, setIsolateChecked] = useState<boolean>(
    !!vmCpuState?.cpu?.isolateEmulatorThread,
  );

  useEffect(() => {
    const quantityToGi = (q: any): number | undefined => {
      if (q === undefined || q === null || q === "") return undefined;
      if (typeof q === "number") {
        const v = Math.ceil(q / 1024 ** 3);
        return Number.isFinite(v) && v > 0 ? v : undefined;
      }
      const s = String(q).trim();
      if (!s) return undefined;
      const units: Record<string, number> = {
        Ki: 1024,
        Mi: 1024 ** 2,
        Gi: 1024 ** 3,
        Ti: 1024 ** 4,
        Pi: 1024 ** 5,
      };
      for (const [u, m] of Object.entries(units)) {
        if (s.endsWith(u)) {
          const n = parseFloat(s.slice(0, -u.length));
          if (!Number.isFinite(n) || n <= 0) return undefined;
          return Math.ceil((n * m) / 1024 ** 3);
        }
      }
      const n = parseFloat(s);
      if (!Number.isFinite(n) || n <= 0) return undefined;
      if (n <= 4096) return Math.ceil(n);
      return Math.ceil(n / 1024 ** 3);
    };

    const nextDedicated = !!vmCpuState?.cpu?.dedicatedCpuPlacement;
    const nextIsolate = !!vmCpuState?.cpu?.isolateEmulatorThread;
    const nextMemReq = quantityToGi(vmCpuState?.resources?.requests?.memory);
    const nextMemLim = quantityToGi(vmCpuState?.resources?.limits?.memory);
    setDedicatedChecked(nextDedicated);
    setIsolateChecked(nextIsolate);
    form?.setFieldsValue?.({
      dedicatedCPUPlacement: nextDedicated,
      isolateEmulatorThread: nextIsolate,
      memoryRequestGi: nextMemReq,
      memoryLimitGi: nextMemLim,
    });
  }, [vmCpuState, form]);

  return (
    <div>
      <Row gutter={12} style={{ marginBottom: 0 }}>
        <Col span={6}>
          <div style={{ lineHeight: "32px" }}>CPU 模式</div>
        </Col>
        <Col span={18}>
          <Form.Item name="cpuModel" initialValue="host-passthrough" noStyle>
            <Select
              options={[
                { label: "Host-Passthrough", value: "host-passthrough" },
                { label: "Host-Model", value: "host-model" },
                { label: "自定义", value: "custom" },
              ]}
              style={{ width: 220 }}
            />
          </Form.Item>
          <div style={{ marginBottom: 24 }} />
        </Col>
      </Row>

      <Form.Item noStyle shouldUpdate={(prev, curr) => prev.cpuModel !== curr.cpuModel}>
        {({ getFieldValue }) =>
          getFieldValue("cpuModel") === "custom" ? (
            <Row gutter={12} style={{ marginBottom: 0 }}>
              <Col span={6}>
                <div style={{ lineHeight: "32px" }}>自定义模型</div>
              </Col>
              <Col span={18}>
                <Form.Item name="cpuModelCustom" noStyle>
                  <Input placeholder="如：Skylake-Client-IBRS" style={{ width: 320 }} />
                </Form.Item>
                <div style={{ marginTop: 6 }}>
                  <Typography.Text type="secondary">
                    指定 CPU 型号名称，例如 Skylake-Client-IBRS
                  </Typography.Text>
                </div>
                <div style={{ marginBottom: 24 }} />
              </Col>
            </Row>
          ) : null
        }
      </Form.Item>

      <Row gutter={12} style={{ marginBottom: 0 }}>
        <Col span={6}>
          <div style={{ lineHeight: "32px" }}>CPU 绑定</div>
        </Col>
        <Col span={18}>
          <Form.Item name="dedicatedCPUPlacement" valuePropName="checked" noStyle>
            <Space style={{ minHeight: 32, alignItems: "center" }}>
              <Checkbox
                style={{
                  height: 32,
                  lineHeight: "32px",
                  display: "inline-flex",
                  alignItems: "center",
                }}
                checked={dedicatedChecked}
                onChange={async (e) => {
                  const v = e.target.checked;
                  if (!v) {
                    setDedicatedChecked(false);
                    form?.setFieldsValue?.({ dedicatedCPUPlacement: false });
                    return;
                  }

                  const checkCpuManager = (node: any) => {
                    const anns = node?.metadata?.annotations || node?.annotations || {};
                    const raw = anns["harvesterhci.io/cpu-manager-update-status"];
                    if (!raw) return false;
                    try {
                      const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
                      const p = String(obj?.policy || "").toLowerCase();
                      const s = String(obj?.status || "").toLowerCase();
                      return p === "static" && s === "success";
                    } catch {
                      return false;
                    }
                  };

                  try {
                    if (!cloudId) throw new Error("missing cloudId");
                    const res: any = await fetchHarvesterNodes(cloudId);
                    const items: any[] = res?.data?.items || res?.items || [];
                    const ok = (items || []).some((node: any) => checkCpuManager(node));
                    if (!ok) {
                      message.error("当前物理节点未开启CPU管理");
                      setDedicatedChecked(false);
                      form?.setFieldsValue?.({ dedicatedCPUPlacement: false });
                      return;
                    }
                    message.warning("CPU 绑定为资源独占模式，无法使用CPU QoS");
                    form?.setFieldsValue?.({
                      cpuRequest: undefined,
                      cpuLimit: undefined,
                    });
                    setDedicatedChecked(true);
                    form?.setFieldsValue?.({ dedicatedCPUPlacement: true });
                  } catch {
                    message.error("CPU管理状态校验失败");
                    setDedicatedChecked(false);
                    form?.setFieldsValue?.({ dedicatedCPUPlacement: false });
                  }
                }}
              >
                启用
              </Checkbox>
              <Typography.Text type="secondary">
                启用后独占指定的物理 CPU 核心，无法使用CPU QoS
              </Typography.Text>
            </Space>
          </Form.Item>
          <div style={{ marginBottom: 24 }} />
        </Col>
      </Row>

      <Row gutter={12} style={{ marginBottom: 0 }}>
        <Col span={6}>
          <div style={{ lineHeight: "32px" }}>CPU 隔离</div>
        </Col>
        <Col span={18}>
          <Form.Item name="isolateEmulatorThread" valuePropName="checked" noStyle>
            <Space style={{ minHeight: 32, alignItems: "center" }}>
              <Checkbox
                style={{
                  height: 32,
                  lineHeight: "32px",
                  display: "inline-flex",
                  alignItems: "center",
                }}
                checked={isolateChecked}
                onChange={(e) => {
                  const v = e.target.checked;
                  setIsolateChecked(v);
                  form?.setFieldsValue?.({ isolateEmulatorThread: v });
                }}
              >
                启用
              </Checkbox>
              <Typography.Text type="secondary">
                启用后与其他虚拟机的 QEMU 线程隔离，降低干扰
              </Typography.Text>
            </Space>
          </Form.Item>
          <div style={{ marginBottom: 24 }} />
        </Col>
      </Row>

      <Row gutter={12} style={{ marginBottom: 0 }}>
        <Col span={6}>
          <div style={{ lineHeight: "32px" }}>CPU QoS</div>
        </Col>
        <Col span={18}>
          <Space>
            <Typography.Text>平时至少需要</Typography.Text>
            <Form.Item noStyle name="cpuRequest">
              <InputNumber min={0} max={512} precision={0} style={{ width: 100 }} suffix="核" />
            </Form.Item>
            <Typography.Text>最多使用</Typography.Text>
            <Form.Item noStyle name="cpuLimit">
              <InputNumber min={0} max={512} precision={0} style={{ width: 100 }} suffix="核" />
            </Form.Item>
          </Space>
          <div style={{ marginBottom: 24 }} />
        </Col>
      </Row>

      <Row gutter={12} style={{ marginBottom: 0 }}>
        <Col span={6}>
          <div style={{ lineHeight: "32px" }}>内存 QoS</div>
        </Col>
        <Col span={18}>
          <Space>
            <Typography.Text>平时至少需要</Typography.Text>
            <Form.Item noStyle name="memoryRequestGi">
              <InputNumber min={0} max={2048} precision={0} style={{ width: 100 }} suffix="GiB" />
            </Form.Item>
            <Typography.Text>最多使用</Typography.Text>
            <Form.Item noStyle name="memoryLimitGi">
              <InputNumber min={0} max={4096} precision={0} style={{ width: 100 }} suffix="GiB" />
            </Form.Item>
          </Space>
          <div style={{ marginBottom: 24 }} />
        </Col>
      </Row>
    </div>
  );
};

export type VmSpecPerformanceDrawerProps = {
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

const VmSpecPerformanceDrawer: React.FC<VmSpecPerformanceDrawerProps> = ({
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
  const cpuAdvancedBaselineRef = useRef<Record<string, unknown> | null>(null);
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
    if (!open || !vmData) {
      cpuAdvancedBaselineRef.current = null;
      return;
    }
    form.resetFields();
    fillCpuAdvancedFormFromVm(form, latestVm || vmData);
    queueMicrotask(() => {
      cpuAdvancedBaselineRef.current = form.getFieldsValue(true);
    });
  }, [open, vmIdentity, cloudId, latestVm, vmData, form]);

  const domain = activeRecord?.spec?.template?.spec?.domain;
  const cpuSpec = domain?.cpu;
  const resources = domain?.resources;
  const vmCpuState = {
    cpu: cpuSpec || null,
    resources: resources || null,
  };

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
        selectedKey: "cpu_advanced",
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
      await submitVmReconfigureCpuAdvanced(
        ctx,
        values,
        vmName,
        namespace,
        cpuAdvancedBaselineRef.current,
      );
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
      width={720}
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
        <Form
          form={form}
          layout="horizontal"
          labelAlign="left"
          labelCol={{ span: 6 }}
          wrapperCol={{ span: 18 }}
        >
          <VmSpecPerformanceCpuFields form={form} cloudId={cloudId} vmCpuState={vmCpuState} />
        </Form>
      </div>
    </Drawer>
  );
};

export default VmSpecPerformanceDrawer;
