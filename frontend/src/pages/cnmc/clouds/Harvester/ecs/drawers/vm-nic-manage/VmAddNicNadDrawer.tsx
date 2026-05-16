/**
 * 添加辅助网卡 · NAD 网络（非 OVN 类 Multus）（单文件含本抽屉全部 UI）。
 * 表单字段与创建向导 StepNetworks NAD（flat）一致：网络、接口类型、模型。
 */
import React, { useEffect, useMemo, useState } from "react";
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
import { useVmManageDrawerCssVars } from "../shared/lib/useVmManageDrawerCssVars";
import "../shared/styles/vmManageDrawer.css";
import {
  type VmAddNicDrawerBaseProps,
  useVmAddNicDrawerData,
} from "./lib/useVmAddNicDrawerData";
import {
  buildVmAddNicNadInfos,
  nadOptionsFlatFromInfos,
} from "./lib/vmAddNicDrawerNadMeta";
import { NAD_MULTUS_INTERFACE_TYPES } from "../../modals/VmCreateWizard/harvesterVmIfaceTypeOptions";
import { buildSecondaryRowFlatNad } from "./lib/vmAddNicDrawerRowBuild";
import { submitAppendSecondaryNicRow } from "./lib/vmAddNicDrawerSubmit";
import { VM_ADD_NIC_MODEL_OPTIONS } from "./lib/vmAddNicDrawerUiConstants";

const VmAddNicNadDrawer: React.FC<VmAddNicDrawerBaseProps> = ({
  open,
  onClose,
  vmData,
  cloudId,
  hasEcsWrite,
  onApplied,
}) => {
  const vmManageCssVars = useVmManageDrawerCssVars();
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const {
    localNads,
    localSubnets,
    reloadNads,
    reloadVpcs,
    reloadSubnets,
    ensureNadsLoaded,
    isHotPlugInProgress,
  } = useVmAddNicDrawerData({ vmData, cloudId });

  const vmNs = String(vmData?.metadata?.namespace || "").trim();
  const vmName = String(
    vmData?.metadata?.name || vmData?.spec?.template?.metadata?.name || "",
  ).trim();

  const nadInfos = useMemo(
    () => buildVmAddNicNadInfos(localNads),
    [localNads],
  );
  const flatNadOptions = useMemo(
    () => nadOptionsFlatFromInfos(nadInfos),
    [nadInfos],
  );
  const ifaceTypeWatch = Form.useWatch("type", form);

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    form.setFieldsValue({ model: "virtio", type: "bridge" });
    void Promise.all([reloadNads(), reloadVpcs(), reloadSubnets()]);
  }, [open, form, reloadNads, reloadVpcs, reloadSubnets]);

  const footerDisabled = !hasEcsWrite || isHotPlugInProgress;

  const handleSubmit = async () => {
    if (!hasEcsWrite || !cloudId || !vmNs || !vmName) return;
    try {
      const v = await form.validateFields();
      const nad = String(v.nad || "").trim();
      if (!nad) {
        message.error("请选择 NAD 网络");
        return;
      }
      const row = buildSecondaryRowFlatNad(nad, {
        model: v.model,
        type: v.type,
      });
      const nadList = await ensureNadsLoaded();
      setSubmitting(true);
      await submitAppendSecondaryNicRow({
        cloudId,
        vmData,
        newRow: row,
        subnets: localSubnets,
        nads: nadList,
        vmNs,
        vmName,
      });
      onClose();
      await onApplied();
    } catch (e: any) {
      if (e?.errorFields) return;
      if (
        e?.message === "compute_secondary_nic_failed" ||
        e?.message === "missing_nad"
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
            disabled={footerDisabled}
            onClick={() => void handleSubmit()}
          >
            保存
          </Button>
        </Flex>
      }
    >
      <div className="vmManageDrawer vmNicManageDrawer" style={vmManageCssVars}>
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
          form={form}
          layout="horizontal"
          labelAlign="left"
          labelCol={{ span: 6 }}
          wrapperCol={{ span: 18 }}
        >
          <Form.Item
            label="NAD网络"
            name="nad"
            rules={[{ required: true, message: "请选择网络" }]}
          >
            <Select
              showSearch
              allowClear={false}
              placeholder="选择网络"
              options={flatNadOptions}
              optionFilterProp="label"
              onOpenChange={(o) => {
                if (o) void reloadNads();
              }}
              onChange={() => {
                form.setFieldsValue({ type: "bridge" });
              }}
            />
          </Form.Item>
          <Form.Item
            label="接口类型"
            name="type"
            initialValue="bridge"
            rules={[{ required: true, message: "请选择接口类型" }]}
          >
            <Select options={NAD_MULTUS_INTERFACE_TYPES} />
          </Form.Item>
          <Form.Item
            label="模型"
            name="model"
            initialValue="virtio"
            rules={[{ required: true, message: "请选择模型" }]}
          >
            <Segmented
              options={VM_ADD_NIC_MODEL_OPTIONS}
              disabled={ifaceTypeWatch === "sriov"}
            />
          </Form.Item>
        </Form>
      </div>
    </Drawer>
  );
};

export default VmAddNicNadDrawer;
