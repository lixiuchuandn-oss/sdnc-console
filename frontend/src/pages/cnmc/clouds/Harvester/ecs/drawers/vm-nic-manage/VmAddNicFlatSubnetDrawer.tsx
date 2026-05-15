/**
 * 添加辅助网卡 · 扁平子网（单文件含本抽屉全部 UI）。
 * 数据/行拼装/提交见 lib：useVmAddNicDrawerData、vmAddNicDrawerRowBuild、vmAddNicDrawerSubmit。
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
import { buildVmAddNicNadInfos } from "./lib/vmAddNicDrawerNadMeta";
import { usedFlatSubnetNamesForPicker } from "./lib/vmAddNicDrawerUsedSubnets";
import {
  buildSecondaryRowFlatSubnet,
  findFlatSubnetRecordByName,
  flatSubnetSelectOptions,
} from "./lib/vmAddNicDrawerRowBuild";
import { submitAppendSecondaryNicRow } from "./lib/vmAddNicDrawerSubmit";
import {
  VM_ADD_NIC_MODEL_OPTIONS,
  VM_ADD_NIC_STATIC_IP_RULE,
  VM_ADD_NIC_SUBNET_CIDR_PLACEHOLDER,
} from "./lib/vmAddNicDrawerUiConstants";

const VmAddNicFlatSubnetDrawer: React.FC<VmAddNicDrawerBaseProps> = ({
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
  const usedFlat = useMemo(
    () => usedFlatSubnetNamesForPicker(vmData, localSubnets),
    [vmData, localSubnets],
  );
  const subnetWatch = Form.useWatch("subnet", form);
  const subnetOptions = useMemo(
    () =>
      flatSubnetSelectOptions(
        localSubnets,
        usedFlat,
        subnetWatch ? String(subnetWatch) : undefined,
      ),
    [localSubnets, usedFlat, subnetWatch],
  );

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
      const row = buildSecondaryRowFlatSubnet(
        String(v.subnet || "").trim(),
        localSubnets,
        nadInfos,
        {
          model: v.model,
          ipAddress: v.ipAddress,
        },
      );
      if (!row) {
        message.error("请选择有效的扁平子网");
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
      if (e?.message === "compute_secondary_nic_failed" || e?.message === "missing_nad")
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
            label="扁平子网"
            name="subnet"
            rules={[{ required: true, message: "请选择扁平子网" }]}
          >
            <Select
              showSearch
              placeholder="选择扁平子网"
              options={subnetOptions}
              optionFilterProp="label"
              onOpenChange={(o) => {
                if (o) void reloadSubnets();
              }}
            />
          </Form.Item>
          <Form.Item label="子网网段">
            <Form.Item noStyle shouldUpdate={(p, c) => p.subnet !== c.subnet}>
              {() => {
                const sn = form.getFieldValue("subnet");
                const hit = findFlatSubnetRecordByName(localSubnets, sn);
                return (
                  <Input
                    value={
                      String(
                        hit?.spec?.cidrBlock || hit?.cidr || "",
                      ).trim() || ""
                    }
                    disabled
                    placeholder={VM_ADD_NIC_SUBNET_CIDR_PLACEHOLDER}
                  />
                );
              }}
            </Form.Item>
          </Form.Item>
          <Form.Item
            label="模型"
            name="model"
            initialValue="virtio"
            rules={[{ required: true, message: "请选择模型" }]}
          >
            <Segmented options={VM_ADD_NIC_MODEL_OPTIONS} />
          </Form.Item>
          <Form.Item
            label="静态 IP"
            name="ipAddress"
            rules={[
              {
                validator: async (_: unknown, val: unknown) => {
                  const s = String(val ?? "").trim();
                  if (!s) return;
                  const re = VM_ADD_NIC_STATIC_IP_RULE.pattern;
                  if (!re.test(s)) {
                    throw new Error(VM_ADD_NIC_STATIC_IP_RULE.message);
                  }
                },
              },
            ]}
          >
            <Input placeholder="192.168.1.23" />
          </Form.Item>
        </Form>
      </div>
    </Drawer>
  );
};

export default VmAddNicFlatSubnetDrawer;
