/**
 * 功能：挂载光盘（创建 ISO 光盘卷并挂到虚拟机）。
 * 本文件包含该入口的表单 UI（横向 Form.Item）；光盘存储类在创建请求中由所选 ISO 镜像解析，不在此展示。
 * 样式见 `drawers/shared/styles/vmManageDrawer.css` + `useVmManageDrawerCssVars`。
 */
import React, { useMemo } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Drawer,
  Flex,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
} from "antd";
import { LoadingOutlined } from "@ant-design/icons";
import { OsIcon } from "../../../../../../../components/OsIcon";
import {
  isHarvesterVmImageReady,
  resolveVmImageKind,
} from "../../../../../../../utils/harvesterUtils";
import { useVmDiskAttachActions } from "./lib/useVmDiskAttachActions";
import { useVmManageDrawerCssVars } from "../shared/lib/useVmManageDrawerCssVars";
import "../shared/styles/vmManageDrawer.css";
import {
  useVmAddDataDiskDrawerData,
  type VmDiskAddDrawerBaseProps,
} from "./lib/vmDiskAddDrawerShared";

const VmAttachCdromDrawer: React.FC<VmDiskAddDrawerBaseProps> = ({
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
    reloadImages,
    ensureNadsLoaded,
    isHotPlugInProgress,
  } = useVmAddDataDiskDrawerData({
    open,
    vmData,
    cloudId,
    preset: "attach_cdrom",
    form,
  });

  const activeRecord = latestVm || record;

  const {
    cdromCreating,
    cdromAttaching,
    handleCreateCdrom,
    handleAttachCdrom,
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

  const newCdromCreated = Form.useWatch("newCdromCreated", form);
  const cdromCreated = !!newCdromCreated;
  const footerDisabled = !hasEcsWrite || isHotPlugInProgress;

  const isoOptions = useMemo(
    () =>
      (images || [])
        .filter(
          (x: any) =>
            resolveVmImageKind(x) === "iso" && isHarvesterVmImageReady(x),
        )
        .map((x: any) => {
          const name = x?.metadata?.name || x?.name;
          const ns = x?.metadata?.namespace || x?.namespace;
          const annotations = x?.metadata?.annotations || x?.annotations || {};
          const disp =
            annotations["field.cattle.io/displayName"] ||
            annotations["harvesterhci.io/image-name"] ||
            annotations["harvesterhci.io/imageDisplayName"] ||
            x?.spec?.displayName ||
            x?.displayName ||
            name;
          const value = ns && name ? `${ns}/${name}` : name;
          return {
            label: (
              <Space>
                <OsIcon osName={disp || name} />
                <span>{disp || "-"}</span>
              </Space>
            ),
            value,
            labelString: `${disp || ""} ${name || ""} ${value || ""}`,
          };
        }),
    [images],
  );

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
            onClick={() => void handleCreateCdrom()}
            loading={cdromCreating}
            disabled={footerDisabled || cdromAttaching || !!newCdromCreated}
          >
            创建光盘卷
          </Button>
          <Button
            type="primary"
            onClick={() => void handleAttachCdrom()}
            loading={cdromAttaching}
            disabled={footerDisabled || cdromCreating || !newCdromCreated}
          >
            挂载光盘
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
          <Form.Item name="newCdromCreated" initialValue={false} hidden>
            <Input />
          </Form.Item>
          <Form.Item
            name="newCdromAccessMode"
            initialValue="ReadWriteMany"
            hidden
            noStyle
          >
            <Input />
          </Form.Item>

          {cdromCreated ? (
            <Alert
              className="vmManageDrawer-stackGap"
              type="success"
              showIcon
              message="光盘卷已创建"
            />
          ) : null}

          <Form.Item
            label="ISO 镜像"
            name="newCdromImage"
            rules={[{ required: true, message: "请选择 ISO 镜像" }]}
          >
            <Select
              showSearch
              disabled={cdromCreated}
              placeholder="请选择 ISO 镜像"
              optionFilterProp="labelString"
              onOpenChange={(o) => {
                if (o) reloadImages?.();
              }}
              options={isoOptions}
            />
          </Form.Item>

          <Form.Item
            label="磁盘别名"
            name="newCdromName"
            rules={[
              {
                max: 128,
                message: "名称过长（最多 128 字符）",
              },
            ]}
          >
            <Input
              placeholder="选填，不填则使用默认展示别名"
              disabled={cdromCreated}
            />
          </Form.Item>

          <Form.Item
            label="容量 (GiB)"
            name="newCdromSize"
            initialValue={10}
            rules={[{ required: true, message: "请输入容量" }]}
          >
            <InputNumber
              className="vmManageDrawer-diskAddSizeInput"
              min={1}
              suffix="GiB"
              disabled={cdromCreated}
            />
          </Form.Item>

          <Form.Item
            label="启动顺序"
            name="newCdromBootFromCdrom"
            valuePropName="checked"
            initialValue={false}
          >
            <Checkbox disabled={cdromCreated}>优先从该光驱启动</Checkbox>
          </Form.Item>

          <Form.Item label="访问类型">
            <Select disabled value="ReadWriteMany">
              <Select.Option value="ReadWriteMany">
                RWX (ReadWriteMany)
              </Select.Option>
            </Select>
          </Form.Item>
        </Form>
      </div>
    </Drawer>
  );
};

export default VmAttachCdromDrawer;
