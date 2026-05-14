/**
 * 虚拟机 · 规格配置抽屉：CPU/内存调整（结构与「更换系统镜像」抽屉对齐）。
 *
 * CPU/内存表单区与原 `ChangeSpec.tsx` 合并于此：`VmSpecCpuMemoryFields` 仅负责本抽屉内表单字段与联动。
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  DownOutlined,
  LoadingOutlined,
  UpOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Col,
  Drawer,
  Flex,
  Form,
  InputNumber,
  message,
  Radio,
  Row,
  Space,
  Typography,
} from "antd";
import type { FormInstance } from "antd/es/form";
import { getVmReconfigureCurrentSpec } from "../../lib/vmMutation/vmReconfigureCurrentSpec";
import { storageQuantityToGiB } from "../../lib/vmMutation/vmReconfigureQuantity";
import {
  VmReconfigureSubmitSkipFinalize,
} from "../../lib/vmMutation/vmReconfigureSubmitTypes";
import { useVmManageDrawerCssVars } from "../shared/lib/useVmManageDrawerCssVars";
import "../shared/styles/vmManageDrawer.css";
import { initVmSpecConfigForm } from "./lib/initVmSpecConfigForm";
import { useVmHotPlugUiState } from "./lib/useVmHotPlugUiState";
import { useVmSpecPostSubmit } from "./lib/useVmSpecPostSubmit";
import { useVmSpecSubmitButtonText } from "./lib/useVmSpecSubmitButtonText";
import { submitVmSpecChange } from "./lib/submitVmSpecChange";

const { Text } = Typography;

const HINT_WRAP_STYLE: React.CSSProperties = { marginTop: 8 };
const FIELD_SPACER_STYLE: React.CSSProperties = { marginBottom: 24 };
const LABEL_CELL_STYLE: React.CSSProperties = { lineHeight: "32px" };
const DISABLED_OVERLAY_STYLE: React.CSSProperties = {
  opacity: 0.6,
  pointerEvents: "none",
};

function isArmArchitecture(architecture?: string): boolean {
  return architecture === "arm64" || architecture === "aarch64";
}

function memPresetFromGiB(gi: number): string {
  if (gi === 4 || gi === 8 || gi === 16) return String(gi);
  return "custom";
}

type VmSpecCpuMemoryFieldsProps = {
  form: FormInstance<any>;
  currentCpu: number;
  currentMemory: number;
  /** VM 已配置热扩容注解（拓扑锁定与校验提示一致） */
  hotPlugConfiguredOnVm: boolean;
  maxSockets?: number;
  maxMemory?: number;
  architecture?: string;
  disabled?: boolean;
};

type CpuMemoryHotplugHintProps = {
  architecture?: string;
  field: "cpu" | "memory";
  baseline: number;
  newVal: number | undefined;
  hotPlugConfiguredOnVm: boolean;
  effectiveHotLimit: number;
};

/** CPU/内存输入下方的热扩/重启说明（仅展示；最终以 `submitVmSpecChange` 为准）。 */
function CpuMemoryHotplugHint({
  architecture,
  field,
  baseline,
  newVal,
  hotPlugConfiguredOnVm,
  effectiveHotLimit,
}: CpuMemoryHotplugHintProps) {
  if (
    field === "cpu" &&
    hotPlugConfiguredOnVm &&
    isArmArchitecture(architecture) &&
    newVal !== undefined &&
    newVal !== baseline
  ) {
    return (
      <div style={HINT_WRAP_STYLE}>
        <Text type="warning">ARM 架构不支持 CPU 热插拔，需要重启生效</Text>
      </div>
    );
  }

  if (!hotPlugConfiguredOnVm) {
    return (
      <div style={HINT_WRAP_STYLE}>
        <Text type="secondary">变更后需要重启生效</Text>
      </div>
    );
  }

  if (newVal === undefined || newVal === baseline) {
    return null;
  }

  if (newVal <= effectiveHotLimit) {
    return (
      <div style={HINT_WRAP_STYLE}>
        <Text type="secondary">当前修改支持热扩容（无需重启）</Text>
      </div>
    );
  }

  return (
    <div style={HINT_WRAP_STYLE}>
      <Text type="warning">超出热扩容范围，需要重启生效</Text>
    </div>
  );
}

const VmSpecCpuMemoryFields: React.FC<VmSpecCpuMemoryFieldsProps> = ({
  form,
  currentCpu,
  currentMemory,
  hotPlugConfiguredOnVm,
  maxSockets,
  maxMemory,
  architecture,
  disabled,
}) => {
  const cpu = Form.useWatch("cpu", form);
  const memory = Form.useWatch("memory", form);
  const cpuSockets = Form.useWatch("cpuSockets", form);
  const cpuCores = Form.useWatch("cpuCores", form);
  const cpuThreads = Form.useWatch("cpuThreads", form);

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [memPreset, setMemPreset] = useState<string>(() =>
    memPresetFromGiB(Number(currentMemory || 0)),
  );
  const [memGi, setMemGi] = useState<number>(currentMemory || 0);

  const cpuHintEffective =
    hotPlugConfiguredOnVm && maxSockets ? maxSockets : currentCpu;
  const memHintEffective =
    hotPlugConfiguredOnVm && maxMemory ? maxMemory : currentMemory;

  const toggleAdvanced = useCallback(() => {
    setShowAdvanced((v) => !v);
  }, []);

  useEffect(() => {
    const v = Number(memory || 0);
    if (v <= 0) return;
    setMemGi(v);
    setMemPreset(memPresetFromGiB(v));
  }, [memory]);

  useEffect(() => {
    if (hotPlugConfiguredOnVm) {
      const s = Number(cpuSockets) || 0;
      const currentCpuVal = form.getFieldValue("cpu");
      if (
        s > 0 &&
        (currentCpuVal === undefined ||
          currentCpuVal === null ||
          currentCpuVal === 0 ||
          currentCpuVal !== s)
      ) {
        form.setFieldsValue({ cpu: s });
      }
      return;
    }
    const s = Number(cpuSockets) || 0;
    const c = Number(cpuCores) || 0;
    const t = Number(cpuThreads) || 0;
    if (s > 0 && c > 0 && t > 0) {
      const total = s * c * t;
      const currentCpuVal = form.getFieldValue("cpu");
      if (currentCpuVal !== total) {
        form.setFieldsValue({ cpu: total });
      }
    }
  }, [cpuSockets, cpuCores, cpuThreads, form, cpu, hotPlugConfiguredOnVm]);

  useEffect(() => {
    if (!hotPlugConfiguredOnVm) return;
    const s = Number(cpuSockets) || 0;
    const c = Number(cpuCores) || 0;
    const t = Number(cpuThreads) || 0;

    if (c !== 1 || t !== 1) {
      form.setFieldsValue({
        cpuCores: 1,
        cpuThreads: 1,
        cpu: s > 0 ? s : cpu,
      });
    }
    if (s > 0 && cpu !== s) {
      form.setFieldsValue({ cpu: s });
    }
  }, [hotPlugConfiguredOnVm, cpuSockets, cpuCores, cpuThreads, form, cpu]);

  useEffect(() => {
    const s = form.getFieldValue("cpuSockets");
    const cpuVal = form.getFieldValue("cpu");

    if (s === undefined && currentCpu) {
      form.setFieldsValue({
        cpu: currentCpu,
        cpuSockets: currentCpu,
        cpuCores: 1,
        cpuThreads: 1,
      });
    }

    if (
      hotPlugConfiguredOnVm &&
      s !== undefined &&
      s > 0 &&
      (cpuVal === undefined ||
        cpuVal === null ||
        cpuVal === 0 ||
        cpuVal !== s)
    ) {
      form.setFieldsValue({ cpu: s });
    }
  }, [currentCpu, form, hotPlugConfiguredOnVm]);

  const overlayStyle = disabled ? DISABLED_OVERLAY_STYLE : undefined;

  return (
    <>
      <div style={overlayStyle}>
        <Row gutter={12} style={{ marginBottom: 0 }}>
          <Col span={6}>
            <div style={LABEL_CELL_STYLE}>vCPU分配</div>
          </Col>
          <Col span={18}>
            {hotPlugConfiguredOnVm ? (
              <Form.Item style={{ marginBottom: 0 }}>
                <div style={{ display: "flex", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center" }}>
                    <Form.Item
                      name="cpu"
                      noStyle
                      initialValue={cpuSockets || currentCpu}
                    >
                      <InputNumber
                        style={{ width: 100 }}
                        suffix="核"
                        min={currentCpu}
                        max={maxSockets || currentCpu * 4}
                        onChange={(val) => {
                          const v = Number(val) || 0;
                          if (v <= 0) return;
                          form.setFieldsValue({
                            cpu: v,
                            cpuSockets: v,
                            cpuCores: 1,
                            cpuThreads: 1,
                          });
                        }}
                      />
                    </Form.Item>
                  </div>
                  <a
                    role="button"
                    tabIndex={0}
                    onClick={toggleAdvanced}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggleAdvanced();
                      }
                    }}
                    style={{ fontSize: 14, marginLeft: 10 }}
                  >
                    拓扑 {showAdvanced ? <UpOutlined /> : <DownOutlined />}
                  </a>
                </div>

                <div
                  style={{
                    background: "#EDF0F7",
                    padding: "12px",
                    marginTop: 12,
                    border: "1px solid #e5e5e5",
                    borderRadius: 8,
                    display: showAdvanced ? "block" : "none",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center" }}>
                    <Form.Item noStyle name="cpuSockets">
                      <InputNumber
                        min={1}
                        max={64}
                        style={{ width: 150 }}
                        suffix="插槽"
                      />
                    </Form.Item>
                    <span style={{ margin: "0 12px", color: "#666" }}>x</span>
                    <Form.Item noStyle name="cpuCores">
                      <InputNumber
                        min={1}
                        max={64}
                        style={{ width: 150 }}
                        suffix="核/插槽"
                        disabled
                      />
                    </Form.Item>
                    <span style={{ margin: "0 12px", color: "#666" }}>x</span>
                    <Form.Item noStyle name="cpuThreads">
                      <InputNumber
                        min={1}
                        max={64}
                        style={{ width: 150 }}
                        suffix="线程"
                        disabled
                      />
                    </Form.Item>
                  </div>
                  <div style={{ marginTop: 8, color: "#999", fontSize: 12 }}>
                    当前热扩容上限为 {maxSockets}{" "}
                    核。超过热扩容范围需重启后才能生效
                  </div>
                </div>
              </Form.Item>
            ) : (
              <Form.Item style={{ marginBottom: 0 }}>
                <Space>
                  <Form.Item noStyle name="cpuSockets">
                    <InputNumber
                      suffix="插槽"
                      min={1}
                      max={64}
                      style={{ width: 100 }}
                      placeholder="Socket"
                    />
                  </Form.Item>
                  <Text>，每插槽</Text>
                  <Form.Item noStyle name="cpuCores">
                    <InputNumber
                      suffix="核"
                      min={1}
                      max={64}
                      style={{ width: 100 }}
                      placeholder="Core"
                    />
                  </Form.Item>
                  <span style={{ color: "#666" }}>，总计</span>
                  <Form.Item
                    noStyle
                    shouldUpdate={(prev, curr) =>
                      prev.cpuSockets !== curr.cpuSockets ||
                      prev.cpuCores !== curr.cpuCores
                    }
                  >
                    {() => {
                      const s = form.getFieldValue("cpuSockets") || 0;
                      const c = form.getFieldValue("cpuCores") || 0;
                      return (
                        <span style={{ fontWeight: 500 }}>{s * c} 核</span>
                      );
                    }}
                  </Form.Item>
                </Space>
                <Form.Item noStyle name="cpuThreads" hidden>
                  <InputNumber />
                </Form.Item>
                <Form.Item noStyle name="cpu" hidden>
                  <InputNumber />
                </Form.Item>
              </Form.Item>
            )}
            <CpuMemoryHotplugHint
              architecture={architecture}
              field="cpu"
              baseline={currentCpu}
              newVal={cpu as number | undefined}
              hotPlugConfiguredOnVm={hotPlugConfiguredOnVm}
              effectiveHotLimit={cpuHintEffective}
            />
            <div style={FIELD_SPACER_STYLE} />
          </Col>
        </Row>

        <Row gutter={12} style={{ marginBottom: 0 }}>
          <Col span={6}>
            <div style={LABEL_CELL_STYLE}>内存分配</div>
          </Col>
          <Col span={18}>
            <Form.Item style={{ marginBottom: 0 }}>
              <Space>
                <Radio.Group
                  value={memPreset}
                  buttonStyle="solid"
                  onChange={(e) => {
                    const v = String(e.target.value);
                    setMemPreset(v);
                    if (v === "custom") return;
                    const gi = Number(v);
                    if (hotPlugConfiguredOnVm && gi < currentMemory) {
                      message.warning("热扩容模式下不允许减少内存");
                      return;
                    }
                    setMemGi(gi);
                    form.setFieldsValue({ memory: gi });
                  }}
                >
                  <Radio.Button value="4">4 GiB</Radio.Button>
                  <Radio.Button value="8">8 GiB</Radio.Button>
                  <Radio.Button value="16">16 GiB</Radio.Button>
                  <Radio.Button value="custom">自定义</Radio.Button>
                </Radio.Group>
                <InputNumber
                  min={hotPlugConfiguredOnVm ? currentMemory : 1}
                  max={
                    hotPlugConfiguredOnVm
                      ? maxMemory || currentMemory * 4
                      : 1024
                  }
                  value={memGi}
                  suffix="GiB"
                  style={{ width: 100 }}
                  onChange={(val) => {
                    const gi = Number(val || 1);
                    setMemGi(gi);
                    form.setFieldsValue({ memory: gi });
                    setMemPreset("custom");
                  }}
                />
              </Space>
            </Form.Item>

            <Form.Item
              name="memory"
              hidden
              rules={[
                { required: true, message: "请选择或输入内存大小" },
                () => ({
                  validator(_, value) {
                    if (value > 0) return Promise.resolve();
                    return Promise.reject(new Error("内存大小必须大于 0"));
                  },
                }),
              ]}
            >
              <InputNumber />
            </Form.Item>
            <CpuMemoryHotplugHint
              architecture={architecture}
              field="memory"
              baseline={currentMemory}
              newVal={memory as number | undefined}
              hotPlugConfiguredOnVm={hotPlugConfiguredOnVm}
              effectiveHotLimit={memHintEffective}
            />
            <div style={FIELD_SPACER_STYLE} />
          </Col>
        </Row>
      </div>
    </>
  );
};

export interface VmSpecConfigDrawerProps {
  open: boolean;
  onClose: () => void;
  vmData: any;
  cloudId: string;
  hasEcsWrite: boolean;
  onApplied: () => void | Promise<void>;
}

const VmSpecConfigDrawer: React.FC<VmSpecConfigDrawerProps> = ({
  open,
  onClose,
  vmData,
  cloudId,
  hasEcsWrite,
  onApplied,
}) => {
  const [form] = Form.useForm();
  const [latestVm, setLatestVm] = useState<any>(null);
  const [submitting, setSubmitting] = useState(false);
  const vmManageCssVars = useVmManageDrawerCssVars();

  const activeRecord = latestVm || vmData;

  const { openRestartConfirm, fetchAggregatedVm } = useVmSpecPostSubmit({
    cloudId,
    record: vmData,
    latestVm,
    setLatestVm,
  });

  useEffect(() => {
    if (open) {
      setLatestVm(vmData);
    }
  }, [open, vmData]);

  const getCurrentSpec = useCallback(
    () => getVmReconfigureCurrentSpec(vmData, activeRecord),
    [vmData, activeRecord],
  );

  const vmIdentity =
    vmData?.metadata?.uid ||
    `${vmData?.metadata?.namespace || ""}/${vmData?.metadata?.name || ""}`;

  useEffect(() => {
    if (!open || !vmData) return;
    form.resetFields();
    initVmSpecConfigForm({
      form,
      record: vmData,
      getCurrentSpec: () => getVmReconfigureCurrentSpec(vmData, vmData),
      getMemoryInGi: storageQuantityToGiB,
    });
    // 仅打开抽屉或切换目标 VM 时回填，避免详情 SSE 更新 vmData 时清空用户编辑
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 有意只依赖 open + 实例标识
  }, [open, vmIdentity, cloudId]);

  const {
    configured: hotPlugConfiguredOnVm,
    inProgress: isHotPlugInProgress,
    readyForHotScale: hotPlugReady,
  } = useVmHotPlugUiState(activeRecord);

  const cpuWatch = Form.useWatch("cpu", form);
  const memoryWatch = Form.useWatch("memory", form);

  const {
    cpu: currentCpuRaw,
    memory: currentMemoryRaw,
    maxSockets,
    maxMemory: maxMemoryRaw,
  } = useMemo(() => {
    const spec = getCurrentSpec();
    return {
      cpu: spec.cpu,
      memory: spec.memory,
      maxSockets: spec.maxSockets,
      maxMemory: spec.maxMemory,
    };
  }, [getCurrentSpec, activeRecord]);

  const currentCpu = Number(currentCpuRaw || 0);
  const currentMemory = storageQuantityToGiB(currentMemoryRaw);
  const maxMemory = maxMemoryRaw
    ? storageQuantityToGiB(maxMemoryRaw)
    : undefined;
  const architecture =
    vmData?.spec?.template?.spec?.architecture || vmData?.spec?.architecture;

  const submitButtonText = useVmSpecSubmitButtonText({
    hotPlugReady,
    maxSockets,
    currentCpu,
    maxMemory,
    currentMemory,
    cpuWatch,
    memoryWatch,
  });

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
      await submitVmSpecChange(
        {
          cloudId,
          activeRecord: latestVm || vmData,
          setLatestVm,
          fetchAggregatedVm,
          openRestartConfirm,
          getCurrentSpec: () =>
            getVmReconfigureCurrentSpec(vmData, latestVm || vmData),
          getMemoryInGi: storageQuantityToGiB,
        },
        values,
        vmName,
        namespace,
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
      closable={false}
      width={800}
      placement="right"
      open={open}
      onClose={onClose}
      forceRender
      zIndex={1100}
      push={{ distance: 180 }}
      styles={{
        header: { display: "none" },
        body: { padding: 24 },
      }}
      footer={
        <Flex
          wrap="wrap"
          gap="small"
          justify="flex-end"
          align="center"
          style={{ width: "100%" }}
        >
          <Button onClick={onClose}>取消</Button>
          <Button
            type="primary"
            loading={submitting}
            disabled={!hasEcsWrite || isHotPlugInProgress}
            onClick={() => void handleSubmit()}
          >
            {submitButtonText}
          </Button>
        </Flex>
      }
    >
      <div className="vmManageDrawer" style={vmManageCssVars}>
        {isHotPlugInProgress ? (
          <Alert
            className="vmManageDrawer-stackGap"
            type="warning"
            showIcon
            icon={<LoadingOutlined />}
            message="热扩容进行中"
            description="暂不可提交新的规格变更；可在详情页事件/状态中确认进度。"
          />
        ) : null}

        <Form
          form={form}
          layout="horizontal"
          labelAlign="left"
          labelCol={{ span: 6 }}
          wrapperCol={{ span: 18 }}
        >
          <VmSpecCpuMemoryFields
            form={form}
            currentCpu={currentCpu}
            currentMemory={currentMemory}
            hotPlugConfiguredOnVm={hotPlugConfiguredOnVm}
            maxSockets={maxSockets}
            maxMemory={maxMemory}
            architecture={architecture}
            disabled={isHotPlugInProgress}
          />
        </Form>
      </div>
    </Drawer>
  );
};

export default VmSpecConfigDrawer;
