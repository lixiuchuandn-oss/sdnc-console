/**
 * 添加辅助网卡 · 直通（SR-IOV / macvtap / macvlan Multus NAD，与创建向导 StepNetworks 直通一致）。
 */
import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Drawer,
  Flex,
  Form,
  Input,
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
  nadOptionsPassthroughFromInfos,
  passthroughKubevirtIfaceTypeFromNad,
} from "./lib/vmAddNicDrawerNadMeta";
import { buildSecondaryRowPassthrough } from "./lib/vmAddNicDrawerRowBuild";
import { submitAppendSecondaryNicRow } from "./lib/vmAddNicDrawerSubmit";
import {
  VM_ADD_NIC_MAC_RULE,
  VM_ADD_NIC_MODEL_OPTIONS,
  VM_ADD_NIC_STATIC_IP_RULE,
} from "./lib/vmAddNicDrawerUiConstants";

const VmAddNicSriovDrawer: React.FC<VmAddNicDrawerBaseProps> = ({
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
  const passthroughOptions = useMemo(
    () => nadOptionsPassthroughFromInfos(nadInfos),
    [nadInfos],
  );

  const nadWatch = Form.useWatch("nad", form);
  const ifaceTypeFromNad = useMemo(() => {
    const hit = nadInfos.find((x) => String(x.value) === String(nadWatch));
    return passthroughKubevirtIfaceTypeFromNad(hit);
  }, [nadInfos, nadWatch]);

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    form.setFieldsValue({ model: "virtio" });
    void Promise.all([reloadNads(), reloadVpcs(), reloadSubnets()]);
  }, [open, form, reloadNads, reloadVpcs, reloadSubnets]);

  const footerDisabled = !hasEcsWrite || isHotPlugInProgress;

  const handleSubmit = async () => {
    if (!hasEcsWrite || !cloudId || !vmNs || !vmName) return;
    try {
      const v = await form.validateFields();
      const row = buildSecondaryRowPassthrough(String(v.nad || "").trim(), nadInfos, {
        model: v.model,
        macAddress: v.macAddress,
        ipAddress: v.ipAddress,
        gateway: v.gateway,
        dns: v.dns,
      });
      if (!row) {
        message.error("请选择直通网络（SR-IOV / macvtap / macvlan）");
        return;
      }
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
      await onApplied();
      onClose();
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
            label="直通网络"
            name="nad"
            rules={[{ required: true, message: "请选择直通网络" }]}
          >
            <Select
              showSearch
              placeholder="选择直通网络（SR-IOV / macvtap / macvlan）"
              options={passthroughOptions}
              optionFilterProp="label"
              onOpenChange={(o) => {
                if (o) void reloadNads();
              }}
            />
          </Form.Item>
          <Form.Item
            label="模型"
            name="model"
            initialValue="virtio"
            rules={[{ required: true, message: "请选择模型" }]}
          >
            <Segmented
              options={VM_ADD_NIC_MODEL_OPTIONS}
              disabled={ifaceTypeFromNad === "sriov"}
            />
          </Form.Item>
          <Form.Item
            label="MAC 地址"
            name="macAddress"
            rules={[VM_ADD_NIC_MAC_RULE]}
          >
            <Input placeholder="留空则按 cloud-init 规则处理" />
          </Form.Item>
          <Form.Item
            label="静态 IP"
            name="ipAddress"
            rules={[VM_ADD_NIC_STATIC_IP_RULE]}
          >
            <Input placeholder="192.168.1.10/24" />
          </Form.Item>
          <Form.Item label="网关" name="gateway">
            <Input placeholder="192.168.1.1" />
          </Form.Item>
          <Form.Item label="DNS" name="dns">
            <Input placeholder="8.8.8.8" />
          </Form.Item>
        </Form>
      </div>
    </Drawer>
  );
};

export default VmAddNicSriovDrawer;
