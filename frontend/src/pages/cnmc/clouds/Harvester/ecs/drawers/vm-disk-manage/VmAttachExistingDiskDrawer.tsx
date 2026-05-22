/**
 * 功能：挂载已有磁盘（将已有 PVC 挂到虚拟机）。
 * 本文件包含该入口的全部表单 UI；提交逻辑复用 useVmDiskAttachActions。
 * 表单行/预览块样式见 `drawers/shared/styles/vmManageDrawer.css`（vmManageDrawer-form* / pvcPreview*），无单独样式文件。
 */
import React, { useEffect, useMemo } from "react";
import {
  Alert,
  Button,
  Descriptions,
  Drawer,
  Flex,
  Form,
  Input,
  Radio,
  Segmented,
  Select,
  Typography,
} from "antd";
import { LoadingOutlined } from "@ant-design/icons";
import { useVmDiskAttachActions } from "./lib/useVmDiskAttachActions";
import { useVmManageDrawerCssVars } from "../shared/lib/useVmManageDrawerCssVars";
import "../shared/styles/vmManageDrawer.css";
import {
  useVmAddDataDiskDrawerData,
  type VmDiskAddDrawerBaseProps,
} from "./lib/vmDiskAddDrawerShared";

const formatAccessMode = (m: string) => {
  if (m === "ReadWriteOnce") return "RWO (ReadWriteOnce)";
  if (m === "ReadWriteMany") return "RWX (ReadWriteMany)";
  if (m === "ReadOnlyMany") return "ROX (ReadOnlyMany)";
  return m || "-";
};

const formatAccessModes = (modes: any[]) => {
  const list = (Array.isArray(modes) ? modes : [])
    .map((x) => String(x || ""))
    .filter(Boolean);
  if (list.length === 0) return "-";
  return Array.from(new Set(list)).map(formatAccessMode).join(", ");
};

/** 下拉选项用：仅 RWO/RWX/ROX，不带括号内英文全称 */
const formatAccessModeShort = (m: string) => {
  if (m === "ReadWriteOnce") return "RWO";
  if (m === "ReadWriteMany") return "RWX";
  if (m === "ReadOnlyMany") return "ROX";
  return m || "";
};

const formatAccessModesShort = (modes: any[]) => {
  const list = (Array.isArray(modes) ? modes : [])
    .map((x) => String(x || ""))
    .filter(Boolean);
  if (list.length === 0) return "—";
  return Array.from(new Set(list))
    .map(formatAccessModeShort)
    .filter(Boolean)
    .join(", ");
};

const getPvcName = (p: any) =>
  p?.rawData?.metadata?.name ||
  p?.metadata?.name ||
  p?.pvcName ||
  p?.name ||
  "";

const getPvcAlias = (p: any) =>
  p?.alias ||
  p?.rawData?.metadata?.annotations?.["tower.io/alias"] ||
  p?.metadata?.annotations?.["tower.io/alias"] ||
  "";

const getPvcCap = (p: any) => {
  const raw = p?.rawData || p;
  return (
    raw?.status?.capacity?.storage ||
    raw?.spec?.resources?.requests?.storage ||
    p?.size ||
    ""
  );
};

const getPvcSc = (p: any) => {
  const raw = p?.rawData || p;
  return (
    raw?.spec?.storageClassName ||
    p?.storageClassName ||
    (typeof raw?.storageClassName === "string" ? raw.storageClassName : "") ||
    ""
  );
};

const getPvcAccessModes = (p: any) => {
  const raw = p?.rawData || p;
  const modes = raw?.spec?.accessModes;
  if (Array.isArray(modes) && modes.length > 0) return modes.filter(Boolean);
  const am = raw?.accessModes ?? p?.accessModes;
  if (typeof am === "string" && am.trim()) {
    return am
      .split(",")
      .map((s: string) => s.trim())
      .filter(Boolean);
  }
  return [];
};

const VmAttachExistingDiskDrawer: React.FC<VmDiskAddDrawerBaseProps> = ({
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
    availableDiskPvcs,
    loadAvailablePvcs,
    ensureNadsLoaded,
    isHotPlugInProgress,
  } = useVmAddDataDiskDrawerData({
    open,
    vmData,
    cloudId,
    preset: "attach_existing",
    form,
  });

  const activeRecord = latestVm || record;

  const { diskAttaching, handleAttachDisk } = useVmDiskAttachActions({
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
  const existingPvc = Form.useWatch("existingPvcName", form);
  const diskName = Form.useWatch("newDiskName", form);
  const diskMode = Form.useWatch("newDiskMode", form) || "spec";

  useEffect(() => {
    if (diskMode !== "spec") return;
    const cur = form.getFieldValue("newDiskBus");
    if (cur === "scsi" || cur == null || cur === "") {
      form.setFieldsValue({ newDiskBus: "virtio" });
    }
  }, [diskMode, form]);

  const selectedExistingPvcObj = useMemo(() => {
    return (availableDiskPvcs || []).find(
      (p: any) => getPvcName(p) === (existingPvc || diskName),
    );
  }, [availableDiskPvcs, existingPvc, diskName]);

  const pvcListMissingSelection =
    !!(existingPvc || diskName) && !selectedExistingPvcObj;

  const pvcSelectOptions = useMemo(
    () =>
      (availableDiskPvcs || [])
        .map((p: any) => {
          const name = getPvcName(p);
          const alias = getPvcAlias(p);
          const cap = getPvcCap(p);
          if (!name) return null;
          const accessShort = formatAccessModesShort(getPvcAccessModes(p));
          const head = alias ? `${alias} (${name})` : name;
          const label = cap
            ? `${head} (${cap}) · ${accessShort}`
            : `${head} · ${accessShort}`;
          return {
            label,
            value: name,
            labelString: `${alias || ""} ${name} ${cap || ""} ${accessShort}`.trim(),
          };
        })
        .filter(Boolean) as {
        label: React.ReactNode;
        value: string;
        labelString: string;
      }[],
    [availableDiskPvcs],
  );

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
            onClick={() => void handleAttachDisk()}
            loading={diskAttaching}
            disabled={footerDisabled || !newDiskCreated}
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
          <Form.Item name="newDiskSource" initialValue="existing" hidden>
            <Input />
          </Form.Item>

          <Form.Item
            label="选择已有磁盘"
            name="existingPvcName"
            rules={[{ required: true, message: "请选择已有磁盘" }]}
          >
            <Select
              showSearch
              placeholder="选择一个已有 PVC"
              options={pvcSelectOptions}
              optionFilterProp="labelString"
              onOpenChange={(open) => {
                if (open) void loadAvailablePvcs();
              }}
              onChange={(name) => {
                form.setFieldsValue({
                  newDiskName: name,
                  newDiskCreated: true,
                });
              }}
            />
          </Form.Item>

          <Form.Item label="磁盘预览">
            <div className="vmManageDrawer-pvcPreviewBox">
              {selectedExistingPvcObj ? (
                <Descriptions
                  size="small"
                  column={1}
                  styles={{ label: { width: 96 } }}
                >
                  <Descriptions.Item label="磁盘名称">
                    {getPvcAlias(selectedExistingPvcObj) ||
                      getPvcName(selectedExistingPvcObj) ||
                      "—"}
                  </Descriptions.Item>
                  <Descriptions.Item label="磁盘容量">
                    {getPvcCap(selectedExistingPvcObj) || "—"}
                  </Descriptions.Item>
                  <Descriptions.Item label="存储类">
                    {getPvcSc(selectedExistingPvcObj) || "—"}
                  </Descriptions.Item>
                  <Descriptions.Item label="访问类型">
                    {formatAccessModes(
                      getPvcAccessModes(selectedExistingPvcObj),
                    )}
                  </Descriptions.Item>
                </Descriptions>
              ) : pvcListMissingSelection ? (
                <Typography.Text type="warning">
                  未在当前列表中匹配到该卷，请重新选择或关闭抽屉后重试。
                </Typography.Text>
              ) : (
                <Typography.Text
                  type="secondary"
                  className="vmManageDrawer-pvcPreviewEmpty"
                >
                  请选择现有磁盘
                </Typography.Text>
              )}
            </div>
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

export default VmAttachExistingDiskDrawer;
