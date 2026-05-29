import React, { useEffect, useState } from "react";
import {
  Alert,
  Collapse,
  Form,
  Input,
  Modal,
  Select,
  Switch,
  message,
} from "antd";
import { maasCreateMachine } from "../../../../../services/maasApi";

type Props = {
  poolId: string;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initial?: { macAddresses?: string[]; hostname?: string };
};

const ARCH_OPTIONS = [
  { value: "amd64/generic", label: "amd64/generic（x86_64）" },
  { value: "arm64/generic", label: "arm64/generic（aarch64）" },
  { value: "ppc64el/generic", label: "ppc64el/generic" },
  { value: "s390x/generic", label: "s390x/generic" },
];

/** 电源类型 → 需要的参数字段（MAAS power_parameters_*） */
const POWER_TYPES: {
  value: string;
  label: string;
  fields: {
    name: string;
    label: string;
    required?: boolean;
    password?: boolean;
  }[];
}[] = [
  { value: "manual", label: "manual（手动）", fields: [] },
  {
    value: "ipmi",
    label: "IPMI",
    fields: [
      { name: "power_address", label: "BMC 地址", required: true },
      { name: "power_user", label: "用户名" },
      { name: "power_pass", label: "密码", password: true },
      { name: "power_driver", label: "驱动（如 LAN_2_0）" },
    ],
  },
  {
    value: "redfish",
    label: "Redfish",
    fields: [
      { name: "power_address", label: "Redfish 地址", required: true },
      { name: "power_user", label: "用户名" },
      { name: "power_pass", label: "密码", password: true },
    ],
  },
  {
    value: "amt",
    label: "Intel AMT",
    fields: [
      { name: "power_address", label: "AMT 地址", required: true },
      { name: "power_pass", label: "密码", password: true },
    ],
  },
];

const MAC_RE = /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i;

const MaasMachineCreateModal: React.FC<Props> = ({
  poolId,
  open,
  onClose,
  onSuccess,
  initial,
}) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const powerType =
    (Form.useWatch("powerType", form) as string | undefined) || "manual";

  useEffect(() => {
    if (open) {
      form.setFieldsValue({
        architecture: "amd64/generic",
        powerType: "manual",
        commission: true,
        macAddresses: initial?.macAddresses ?? [],
        hostname: initial?.hostname,
      });
    }
  }, [open, initial, form]);

  const activeType =
    POWER_TYPES.find((t) => t.value === powerType) || POWER_TYPES[0];

  const handleOk = async () => {
    try {
      const v = await form.validateFields();
      const powerParameters: Record<string, string> = {};
      for (const f of activeType.fields) {
        const val = v[f.name];
        if (val != null && String(val).trim() !== "") {
          powerParameters[f.name] = String(val).trim();
        }
      }
      setLoading(true);
      const res = await maasCreateMachine(poolId, {
        architecture: v.architecture,
        macAddresses: (v.macAddresses as string[]) || [],
        powerType: v.powerType,
        powerParameters,
        hostname: v.hostname,
        domain: v.domain,
        zone: v.zone,
        pool: v.pool,
        commission: v.commission,
      });
      if (!res?.ok) {
        message.error(res?.message || "添加机器失败");
        return;
      }
      message.success(res.message || "机器已添加");
      onSuccess();
      onClose();
      form.resetFields();
    } catch (e) {
      if (e && typeof e === "object" && "errorFields" in e) return;
      message.error(e instanceof Error ? e.message : "添加机器失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title="添加机器"
      open={open}
      onCancel={onClose}
      onOk={() => void handleOk()}
      confirmLoading={loading}
      destroyOnClose
      width={560}
    >
      <Alert
        type="info"
        showIcon
        message="将机器登记到 MAAS。提交后 MAAS 将根据电源配置开机并自动纳管（Commission）。"
        style={{ marginBottom: 16 }}
      />
      <Form form={form} layout="vertical">
        <Form.Item name="hostname" label="主机名（可选）">
          <Input placeholder="留空则由 MAAS 自动生成" />
        </Form.Item>
        <Form.Item
          name="architecture"
          label="架构"
          rules={[{ required: true, message: "请选择架构" }]}
        >
          <Select options={ARCH_OPTIONS} showSearch optionFilterProp="label" />
        </Form.Item>
        <Form.Item
          name="macAddresses"
          label="MAC 地址（PXE 网卡，可多个）"
          rules={[
            { required: true, message: "请至少填写一个 MAC 地址" },
            {
              validator: (_, value: string[]) => {
                const bad = (value || []).filter(
                  (m) => !MAC_RE.test(String(m).trim()),
                );
                return bad.length
                  ? Promise.reject(new Error(`MAC 格式无效：${bad.join("、")}`))
                  : Promise.resolve();
              },
            },
          ]}
        >
          <Select
            mode="tags"
            tokenSeparators={[",", " "]}
            placeholder="如 52:54:00:12:34:56，回车确认"
            open={false}
          />
        </Form.Item>
        <Form.Item
          name="powerType"
          label="电源类型"
          rules={[{ required: true, message: "请选择电源类型" }]}
        >
          <Select
            options={POWER_TYPES.map((t) => ({
              value: t.value,
              label: t.label,
            }))}
          />
        </Form.Item>
        {activeType.fields.map((f) => (
          <Form.Item
            key={f.name}
            name={f.name}
            label={f.label}
            rules={
              f.required
                ? [{ required: true, message: `请填写${f.label}` }]
                : undefined
            }
          >
            {f.password ? (
              <Input.Password autoComplete="new-password" />
            ) : (
              <Input />
            )}
          </Form.Item>
        ))}
        <Form.Item
          name="commission"
          label="添加后自动纳管（Commission）"
          valuePropName="checked"
        >
          <Switch />
        </Form.Item>
        <Collapse
          ghost
          items={[
            {
              key: "placement",
              label: "高级：归属（可选）",
              children: (
                <>
                  <Form.Item
                    name="domain"
                    label="DNS 域（domain）"
                    style={{ marginBottom: 12 }}
                  >
                    <Input placeholder="如 maas" />
                  </Form.Item>
                  <Form.Item
                    name="zone"
                    label="可用区（zone）"
                    style={{ marginBottom: 12 }}
                  >
                    <Input placeholder="如 default" />
                  </Form.Item>
                  <Form.Item
                    name="pool"
                    label="资源池（pool）"
                    style={{ marginBottom: 0 }}
                  >
                    <Input placeholder="如 default" />
                  </Form.Item>
                </>
              ),
            },
          ]}
        />
      </Form>
    </Modal>
  );
};

export default MaasMachineCreateModal;
