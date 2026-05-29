import React, { useCallback, useEffect, useState } from "react";
import { PlusOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  createMaasBootSourceSelection,
  deleteMaasBootSourceSelection,
  fetchMaasBootSources,
  type MaasBootSource,
  type MaasBootSourceSelection,
} from "../../../../../services/maasApi";

type Props = {
  poolId: string;
  open: boolean;
  onClose: () => void;
  /** 关闭抽屉时若有变更，提示用户可触发同步 */
  onChanged?: () => void;
};

const OS_OPTIONS = ["ubuntu", "centos", "rhel"].map((v) => ({
  value: v,
  label: v,
}));

const MaasBootSourcesDrawer: React.FC<Props> = ({
  poolId,
  open,
  onClose,
  onChanged,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sources, setSources] = useState<MaasBootSource[]>([]);
  const [addSourceId, setAddSourceId] = useState<string | number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    if (!poolId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchMaasBootSources(poolId, { skipCache: true });
      if (!res?.ok) {
        setError(res?.message || "拉取镜像源失败");
        return;
      }
      setSources(Array.isArray(res.items) ? res.items : []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "拉取镜像源失败");
    } finally {
      setLoading(false);
    }
  }, [poolId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const handleDelete = useCallback(
    (sourceId: string | number, sel: MaasBootSourceSelection) => {
      Modal.confirm({
        title: "删除镜像源选择",
        content: `删除 ${sel.os}/${sel.release}（${sel.arches.join(", ") || "*"}）？同步时将不再下载该项。`,
        okText: "删除",
        okButtonProps: { danger: true },
        onOk: async () => {
          try {
            const res = await deleteMaasBootSourceSelection(
              poolId,
              sourceId,
              sel.id,
            );
            if (!res?.ok) {
              message.error(res?.message || "删除失败");
              return;
            }
            message.success(res.message || "已删除");
            onChanged?.();
            await load();
          } catch (e: unknown) {
            message.error(e instanceof Error ? e.message : "删除失败");
          }
        },
      });
    },
    [poolId, load, onChanged],
  );

  const handleAdd = async () => {
    if (addSourceId == null) return;
    try {
      const v = await form.validateFields();
      setSubmitting(true);
      const res = await createMaasBootSourceSelection(poolId, addSourceId, {
        os: v.os,
        release: v.release,
        arches: v.arches,
        subarches: v.subarches,
        labels: v.labels,
      });
      if (!res?.ok) {
        message.error(res?.message || "新增失败");
        return;
      }
      message.success(res.message || "已新增");
      setAddSourceId(null);
      form.resetFields();
      onChanged?.();
      await load();
    } catch (e) {
      if (e && typeof e === "object" && "errorFields" in e) return;
      message.error(e instanceof Error ? e.message : "新增失败");
    } finally {
      setSubmitting(false);
    }
  };

  const buildColumns = (
    sourceId: string | number,
  ): ColumnsType<MaasBootSourceSelection> => [
    { title: "操作系统", dataIndex: "os", key: "os", fixed: "left" },
    { title: "版本", dataIndex: "release", key: "release" },
    {
      title: "架构",
      key: "arches",
      render: (_, r) =>
        r.arches.length ? (
          r.arches.map((a) => <Tag key={a}>{a}</Tag>)
        ) : (
          <Tag>*</Tag>
        ),
    },
    {
      title: "子架构",
      key: "subarches",
      render: (_, r) => r.subarches.join(", ") || "*",
    },
    {
      title: "标签",
      key: "labels",
      render: (_, r) => r.labels.join(", ") || "*",
    },
    {
      title: "操作",
      key: "actions",
      fixed: "right",
      render: (_, r) => (
        <Button
          type="link"
          size="small"
          danger
          onClick={() => handleDelete(sourceId, r)}
        >
          删除
        </Button>
      ),
    },
  ];

  return (
    <Drawer
      title="镜像源与同步项"
      width={760}
      open={open}
      onClose={onClose}
      destroyOnClose
    >
      <Alert
        type="info"
        showIcon
        message="镜像源选择决定 MAAS 从官方源同步哪些操作系统版本与架构。新增/删除后，请在镜像页点击「同步镜像」使其生效。"
        style={{ marginBottom: 16 }}
      />
      {error ? (
        <Alert
          type="error"
          showIcon
          message={error}
          style={{ marginBottom: 16 }}
        />
      ) : null}
      <Spin spinning={loading}>
        {sources.length === 0 && !loading ? (
          <Empty description="暂无镜像源" />
        ) : (
          sources.map((s) => (
            <div key={String(s.id)} style={{ marginBottom: 24 }}>
              <Space
                style={{
                  width: "100%",
                  justifyContent: "space-between",
                  marginBottom: 8,
                }}
                align="start"
              >
                <div>
                  <Typography.Text strong>
                    镜像源 #{String(s.id)}
                  </Typography.Text>
                  <div>
                    <Typography.Text
                      type="secondary"
                      copyable
                      style={{ fontSize: 12 }}
                    >
                      {s.url || "—"}
                    </Typography.Text>
                  </div>
                </div>
                <Button
                  icon={<PlusOutlined />}
                  size="small"
                  onClick={() => {
                    setAddSourceId(s.id);
                    form.setFieldsValue({
                      os: "ubuntu",
                      release: undefined,
                      arches: ["amd64"],
                      subarches: undefined,
                      labels: undefined,
                    });
                  }}
                >
                  新增同步项
                </Button>
              </Space>
              <Table<MaasBootSourceSelection>
                className="std-table"
                bordered={false}
                rowKey={(r) => String(r.id)}
                columns={buildColumns(s.id)}
                dataSource={s.selections}
                pagination={false}
                scroll={{ x: true }}
                locale={{ emptyText: "该源暂无同步项" }}
              />
            </div>
          ))
        )}
      </Spin>

      <Modal
        title="新增镜像源同步项"
        open={addSourceId != null}
        onCancel={() => setAddSourceId(null)}
        onOk={() => void handleAdd()}
        confirmLoading={submitting}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="os"
            label="操作系统"
            rules={[{ required: true, message: "请填写操作系统" }]}
          >
            <Select
              showSearch
              options={OS_OPTIONS}
              placeholder="如 ubuntu / centos"
              optionFilterProp="label"
            />
          </Form.Item>
          <Form.Item
            name="release"
            label="版本（release）"
            rules={[{ required: true, message: "请填写版本" }]}
          >
            <Input placeholder="如 jammy、focal、22.04" />
          </Form.Item>
          <Form.Item name="arches" label="架构（留空表示全部）">
            <Select
              mode="tags"
              tokenSeparators={[",", " "]}
              placeholder="如 amd64，回车确认"
              open={false}
            />
          </Form.Item>
          <Form.Item name="subarches" label="子架构（可选）">
            <Select
              mode="tags"
              tokenSeparators={[",", " "]}
              placeholder="留空表示全部（*）"
              open={false}
            />
          </Form.Item>
          <Form.Item name="labels" label="标签（可选）">
            <Select
              mode="tags"
              tokenSeparators={[",", " "]}
              placeholder="如 release、daily，留空表示全部"
              open={false}
            />
          </Form.Item>
        </Form>
      </Modal>
    </Drawer>
  );
};

export default MaasBootSourcesDrawer;
