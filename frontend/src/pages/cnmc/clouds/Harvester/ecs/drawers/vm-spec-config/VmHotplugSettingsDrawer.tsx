/**
 * CPU/内存热扩容设置抽屉（规格域；列表/控制台「热扩容设置」入口）。
 *
 * 表单区与原 `HotPlugSettings.tsx` 合并于此。
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Drawer,
  Flex,
  Form,
  InputNumber,
  Space,
  Switch,
  Tag,
  Tooltip,
  Typography,
  Row,
  Col,
} from "antd";
import { LoadingOutlined, QuestionCircleOutlined, InfoCircleOutlined } from "@ant-design/icons";
import { getVmReconfigureCurrentSpec } from "../../lib/vmMutation/vmReconfigureCurrentSpec";
import { storageQuantityToGiB } from "../../lib/vmMutation/vmReconfigureQuantity";
import { initHotplugSettingsMenu } from "./lib/initHotplugSettingsMenu";
import type { VmReconfigureMenuInitCtx } from "../../lib/vmMutation/vmReconfigureMenuInitContext";
import { runHotplugSettingsSubmit } from "./lib/runHotplugSettingsSubmit";
import { useVmReconfigureVmDiskActions } from "../vm-disk-manage/lib/useVmDiskAttachActions";
import { useVmManageDrawerCssVars } from "../shared/lib/useVmManageDrawerCssVars";
import "../shared/styles/vmManageDrawer.css";

const { Text } = Typography;

const noopReloadNodes = async (): Promise<void> => {};

type VmHotplugSettingsFormFieldsProps = {
  form: any;
  currentCpu: number;
  currentMemory: number;
  isHotPlugEnabledOnVm: boolean;
  maxSockets?: number;
  maxMemory?: number;
  architecture?: string;
  disabled?: boolean;
};

const VmHotplugSettingsFormFields: React.FC<VmHotplugSettingsFormFieldsProps> = ({
  form,
  currentCpu,
  currentMemory,
  isHotPlugEnabledOnVm,
  maxSockets,
  maxMemory,
  architecture,
  disabled,
}) => {
  const enableHotPlug = Form.useWatch("enableHotPlug", form);
  const isArm = architecture === "arm64" || architecture === "aarch64";

  return (
    <>
      <div style={{ opacity: disabled ? 0.6 : 1, pointerEvents: disabled ? "none" : "auto" }}>
        <Row gutter={12}>
          <Col span={6}>
            <div style={{ lineHeight: "32px" }}>
              热扩容
              <Tooltip
                title={
                  <div>
                    <div>1. 变更热扩容状态，需要重启生效</div>
                    <div>2. 启用后，强制使用单核模式（cores=1, threads=1），仅允许调整sockets</div>
                    <div>3. 开启热扩容后，可以在不重启的情况下增加CPU/内存</div>
                  </div>
                }
              >
                <QuestionCircleOutlined style={{ color: "#999", marginLeft: 4 }} />
              </Tooltip>
            </div>
          </Col>
          <Col span={18}>
            <Form.Item style={{ marginBottom: 0 }}>
              <div style={{ display: "flex", alignItems: "center", height: 32 }}>
                <Form.Item name="enableHotPlug" valuePropName="checked" noStyle>
                  <Switch disabled={isArm} checkedChildren="已启用" unCheckedChildren="未启用" />
                </Form.Item>
                <div style={{ marginLeft: 8 }}>
                  {isArm ? (
                    <Text type="secondary">ARM 架构不支持热扩容</Text>
                  ) : (
                    <Text type="secondary">变更后需要重启生效</Text>
                  )}
                </div>
              </div>

              {enableHotPlug && (
                <div
                  style={{
                    background: "#EDF0F7",
                    padding: "12px",
                    marginTop: 12,
                    border: "1px solid #e5e5e5",
                    borderRadius: 8,
                  }}
                >
                  <Space size="large" align="start">
                    <div>
                      <Space>
                        <span>CPU上限</span>
                        <Form.Item
                          name="maxSockets"
                          initialValue={maxSockets || currentCpu * 4}
                          noStyle
                          rules={[{ required: true, message: "必填" }]}
                        >
                          <InputNumber
                            min={currentCpu}
                            max={currentCpu * 4}
                            suffix="核"
                            style={{ width: 100 }}
                            disabled={isHotPlugEnabledOnVm}
                          />
                        </Form.Item>
                        <Tooltip title="设置虚拟机所能支持的最大 CPU 核数。将来热扩容时，CPU总数不能超过此值。">
                          <InfoCircleOutlined style={{ color: "#999" }} />
                        </Tooltip>
                      </Space>
                    </div>
                    <div>
                      <Space>
                        <span>内存上限</span>
                        <Form.Item
                          name="maxMemory"
                          initialValue={maxMemory || currentMemory * 4}
                          noStyle
                          rules={[{ required: true, message: "必填" }]}
                        >
                          <InputNumber
                            min={currentMemory}
                            max={currentMemory * 4}
                            suffix="GiB"
                            style={{ width: 100 }}
                            disabled={isHotPlugEnabledOnVm}
                          />
                        </Form.Item>
                        <Tooltip title="设置虚拟机所能支持的最大内存。将来热扩容时，内存总数不能超过此值。">
                          <InfoCircleOutlined style={{ color: "#999" }} />
                        </Tooltip>
                      </Space>
                    </div>
                  </Space>
                  <div style={{ marginTop: 8, color: "#999", fontSize: 12 }}>
                    热扩容上限设置（默认为当前规格的 4 倍）
                    {isHotPlugEnabledOnVm && (
                      <span style={{ marginLeft: 8, color: "#ff9800" }}>已开启热扩容，上限不可修改</span>
                    )}
                  </div>
                </div>
              )}

              {enableHotPlug && !isHotPlugEnabledOnVm && (
                <Alert
                  type="info"
                  message="首次开启热扩容需要重启生效，开启后 CPU 拓扑将自动调整为 cores=1、threads=1、sockets=当前 CPU 数量。"
                  style={{ marginTop: 12 }}
                />
              )}
            </Form.Item>
          </Col>
        </Row>
      </div>
    </>
  );
};

export type VmHotplugSettingsDrawerProps = {
  open: boolean;
  onClose: () => void;
  cloudId: string;
  record: any;
  latestVm: any | null;
  setLatestVm: (v: any) => void;
  ensureNadsLoaded: () => Promise<any[]>;
  images?: any[];
  onApplied: () => void | Promise<void>;
};

const VmHotplugSettingsDrawer: React.FC<VmHotplugSettingsDrawerProps> = ({
  open,
  onClose,
  cloudId,
  record,
  latestVm,
  setLatestVm,
  ensureNadsLoaded,
  images = [],
  onApplied,
}) => {
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const vmManageCssVars = useVmManageDrawerCssVars();
  const activeRecord = latestVm || record;

  const getCurrentSpec = useCallback(
    () => getVmReconfigureCurrentSpec(record, activeRecord),
    [record, activeRecord],
  );
  const getMemoryInGi = storageQuantityToGiB;

  const {
    cpu: currentCpuRaw,
    memory: currentMemoryRaw,
    maxSockets,
    maxMemory: maxMemoryRaw,
  } = useMemo(() => {
    if (!getCurrentSpec) return { cpu: 0, memory: 0, maxSockets: undefined, maxMemory: undefined };
    return getCurrentSpec();
  }, [getCurrentSpec]);

  const currentCpu = Number(currentCpuRaw || 0);
  const currentMemory = getMemoryInGi(currentMemoryRaw);
  const maxMemory = maxMemoryRaw ? getMemoryInGi(maxMemoryRaw) : undefined;
  const architecture = record?.spec?.template?.spec?.architecture || record?.spec?.architecture;

  const isHotPlugConfiguredOnVm = useMemo(() => {
    const annotations = activeRecord?.metadata?.annotations || {};
    return annotations["harvesterhci.io/enableCPUAndMemoryHotplug"]?.toLowerCase() === "true";
  }, [activeRecord]);

  const isHotPlugInProgress = useMemo(() => {
    const conditions = activeRecord?.status?.conditions || [];
    return conditions.some(
      (c: any) =>
        (c.type === "HotVCPUChange" || c.type === "HotMemoryChange") && c.status === "True",
    );
  }, [activeRecord]);

  const isRestartRequired = useMemo(() => {
    const conditions = activeRecord?.status?.conditions || [];
    return conditions.some((c: any) => c.type === "RestartRequired" && c.status === "True");
  }, [activeRecord]);

  const { openRestartConfirm, fetchAggregatedVm, maybePromptRestart } = useVmReconfigureVmDiskActions({
    cloudId,
    record,
    latestVm,
    setLatestVm,
    activeRecord,
    form,
    images: Array.isArray(images) ? images : [],
    ensureNadsLoaded,
    onOk: onApplied,
    onClose,
  });

  useEffect(() => {
    if (!open || !record) return;
    form.resetFields();
    initHotplugSettingsMenu({
      form,
      record,
      latestVm,
      activeRecord,
      cloudId,
      open,
      gpuResources: [],
      usbResources: [],
      nodes: [],
      getCurrentSpec,
      getMemoryInGi,
      reloadGpuResources: async () => {},
      reloadUsbResources: async () => {},
      reloadNodes: noopReloadNodes,
      setSelectedUsbKeys: () => {},
    } as VmReconfigureMenuInitCtx);
  }, [open, record, latestVm, activeRecord, cloudId, form, getCurrentSpec, getMemoryInGi]);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await runHotplugSettingsSubmit({
        form,
        cloudId,
        record,
        latestVm,
        activeRecord,
        selectedKey: "hotplug_settings",
        gpuResources: [],
        usbResources: [],
        setLatestVm,
        ensureNadsLoaded,
        openRestartConfirm,
        maybePromptRestart,
        fetchAggregatedVm,
        onOk: onApplied,
        onClose,
      });
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
            disabled={isHotPlugInProgress}
            onClick={() => void handleSubmit()}
          >
            提交
          </Button>
        </Flex>
      }
    >
      <div className="vmManageDrawer" style={vmManageCssVars}>
        {isRestartRequired || isHotPlugInProgress ? (
          <Space size={8} align="center" style={{ marginBottom: 16 }}>
            {isRestartRequired ? <Tag color="warning">需重启</Tag> : null}
            {isHotPlugInProgress ? <Tag color="processing">热扩容中</Tag> : null}
          </Space>
        ) : null}
        {isHotPlugInProgress ? (
          <Alert
            type="warning"
            showIcon
            icon={<LoadingOutlined />}
            message="热扩容进行中"
            description="暂不可提交新的规格变更"
            style={{ marginBottom: 12 }}
            action={
              <Tooltip
                title={
                  <div>
                    <div>1. 当前虚拟机正在执行 CPU 或内存热扩容。</div>
                    <div>2. 操作完成前禁止再次变配，避免后端并发失败。</div>
                    <div>3. 可在详情页事件/状态中确认进度，必要时点击刷新。</div>
                  </div>
                }
              >
                <QuestionCircleOutlined style={{ color: "rgba(0,0,0,0.45)" }} />
              </Tooltip>
            }
          />
        ) : null}
        <Form form={form} layout="vertical" wrapperCol={{ span: 24 }}>
          <VmHotplugSettingsFormFields
            form={form}
            currentCpu={currentCpu}
            currentMemory={currentMemory}
            isHotPlugEnabledOnVm={!!isHotPlugConfiguredOnVm}
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

export default VmHotplugSettingsDrawer;
