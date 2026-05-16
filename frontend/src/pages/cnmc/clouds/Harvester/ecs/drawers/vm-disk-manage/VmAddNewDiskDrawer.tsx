/**
 * 功能：添加新磁盘（创建块盘并挂载到虚拟机）。
 * 本文件包含该入口的全部表单 UI；提交逻辑仍复用 useVmDiskAttachActions。
 * 与同目录挂载光盘/已有磁盘/更换系统镜像等抽屉共用 `drawers/shared/styles/vmManageDrawer.css`（vmManageDrawer-form* 等），无单独样式文件。
 */
import React, { useEffect } from "react";
import {
  Alert,
  Button,
  Drawer,
  Flex,
  Form,
  Input,
  InputNumber,
  Radio,
  Select,
  Segmented,
} from "antd";
import { LoadingOutlined } from "@ant-design/icons";
import { useVmDiskAttachActions } from "./lib/useVmDiskAttachActions";
import { useVmManageDrawerCssVars } from "../shared/lib/useVmManageDrawerCssVars";
import "../shared/styles/vmManageDrawer.css";
import {
  useVmAddDataDiskDrawerData,
  type VmDiskAddDrawerBaseProps,
} from "./lib/vmDiskAddDrawerShared";

const VmAddNewDiskDrawer: React.FC<VmDiskAddDrawerBaseProps> = ({
  open,
  onClose,
  vmData,
  cloudId,
  hasEcsWrite,
  onApplied,
}) => {
  const vmManageCssVars = useVmManageDrawerCssVars();
  const [form] = Form.useForm();
  const record = vmData;

  const {
    latestVm,
    setLatestVm,
    images,
    reloadScs,
    ensureNadsLoaded,
    scOptions,
    isHotPlugInProgress,
  } = useVmAddDataDiskDrawerData({
    open,
    vmData,
    cloudId,
    preset: "new_disk",
    form,
  });

  const activeRecord = latestVm || record;

  const {
    diskCreating,
    diskAttaching,
    handleCreateDisk,
    handleAttachDisk,
  } = useVmDiskAttachActions({
    cloudId,
    record,
    latestVm,
    setLatestVm,
    activeRecord,
    form,
    images,
    ensureNadsLoaded,
    onOk: async () => {
      await onApplied();
    },
    onClose,
  });

  const newDiskCreated = Form.useWatch("newDiskCreated", form);
  const diskSource = Form.useWatch("newDiskSource", form);
  const diskMode = Form.useWatch("newDiskMode", form) || "spec";

  useEffect(() => {
    if (diskSource === "iso") return;
    if (diskMode !== "spec") return;
    const cur = form.getFieldValue("newDiskBus");
    if (cur === "scsi" || cur == null || cur === "") {
      form.setFieldsValue({ newDiskBus: "virtio" });
    }
  }, [diskMode, diskSource, form]);

  const created = !!newDiskCreated;

  useEffect(() => {
    if (!open || created) return;
    const first = scOptions?.[0]?.value;
    if (first == null || first === "") return;
    const cur = form.getFieldValue("newDiskSc");
    if (cur != null && String(cur).trim() !== "") return;
    form.setFieldsValue({ newDiskSc: first });
  }, [open, created, scOptions, form]);

  const footerDisabled = !hasEcsWrite || isHotPlugInProgress;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      closable={false}
      width={800}
      placement="right"
      forceRender
      styles={{
        header: { display: "none" },
        body: { padding: 24 },
      }}
      footer={
        <Flex justify="flex-end" gap="small" wrap="wrap">
          <Button onClick={onClose}>取消</Button>
          <Button
            type="primary"
            onClick={() => void handleCreateDisk()}
            loading={diskCreating}
            disabled={
              footerDisabled ||
              diskAttaching ||
              !!newDiskCreated ||
              diskSource === "existing"
            }
          >
            创建磁盘
          </Button>
          <Button
            type="primary"
            onClick={() => void handleAttachDisk()}
            loading={diskAttaching}
            disabled={footerDisabled || diskCreating || !newDiskCreated}
          >
            挂载磁盘
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
            description="CPU 或内存热扩容完成前，请避免添加或挂载磁盘，以免并发失败。"
          />
        ) : null}

        <Form
          form={form}
          layout="horizontal"
          labelAlign="left"
          labelCol={{ span: 6 }}
          wrapperCol={{ span: 18 }}
        >
          <Form.Item name="newDiskCreated" initialValue={false} hidden>
            <Input />
          </Form.Item>
          <Form.Item name="newDiskPvcClaimName" hidden>
            <Input />
          </Form.Item>
          <Form.Item name="newDiskSource" initialValue="create" hidden>
            <Input />
          </Form.Item>
          {/* 创建 PVC 时访问模式固定为 RWX；与 useVmDiskAttachActions 中 fallback 一致，不在界面提供修改 */}
          <Form.Item
            name="newDiskAccessMode"
            initialValue="ReadWriteMany"
            rules={[{ required: true, message: "请选择访问类型" }]}
            hidden
          >
            <Input />
          </Form.Item>

          {created && diskSource === "create" ? (
            <Alert
              className="vmManageDrawer-stackGap"
              type="success"
              showIcon
              message="磁盘卷已创建，请点击挂载磁盘"
            />
          ) : null}

          <Form.Item
            label="磁盘别名"
            name="newDiskName"
            rules={[
              { max: 128, message: "别名过长（最多 128 字符）" },
            ]}
          >
            <Input
              placeholder="可填中文或展示名；技术卷名可能由系统自动生成"
              disabled={created}
            />
          </Form.Item>

          <Form.Item
            label="存储类"
            name="newDiskSc"
          >
            <Select
              options={scOptions}
              placeholder="请选择存储类"
              onOpenChange={(open) => {
                if (open) void reloadScs();
              }}
              disabled={created}
            />
          </Form.Item>

          <Form.Item
            label="磁盘容量"
            name="newDiskSize"
            initialValue={10}
            rules={[{ required: true, message: "请输入容量" }]}
          >
            <InputNumber
              className="vmManageDrawer-diskAddSizeInput"
              min={1}
              suffix="GiB"
              disabled={created}
            />
          </Form.Item>

          <Form.Item label="添加方式" name="newDiskMode" initialValue="spec">
            <Radio.Group
              onChange={(e) => {
                const v = String(e.target.value);
                if (v === "hotplug") {
                  form.setFieldsValue({ newDiskMode: v, newDiskBus: "scsi" });
                } else {
                  form.setFieldsValue({ newDiskMode: v });
                }
              }}
            >
              <Radio value="spec">重启生效</Radio>
              <Radio value="hotplug">热插拔(SCSI)</Radio>
            </Radio.Group>
          </Form.Item>

          {diskMode === "spec" || diskMode === "hotplug" ? (
            <Form.Item
              label="总线类型"
              name="newDiskBus"
              initialValue="virtio"
            >
              <Segmented
                disabled={diskMode === "hotplug"}
                options={
                  diskMode === "hotplug"
                    ? [{ label: "SCSI", value: "scsi" }]
                    : [
                        { label: "VirtIO", value: "virtio" },
                        { label: "SATA", value: "sata" },
                      ]
                }
              />
            </Form.Item>
          ) : null}
        </Form>
      </div>
    </Drawer>
  );
};

export default VmAddNewDiskDrawer;
