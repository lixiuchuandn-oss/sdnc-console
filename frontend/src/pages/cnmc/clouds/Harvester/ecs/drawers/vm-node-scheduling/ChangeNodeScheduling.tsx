/**
 * ChangeNodeScheduling.tsx
 *
 * 节点调度修改组件
 * 参考创建虚拟机时的节点选择设计
 */
import React, { useEffect, useMemo, useState } from "react";
import {
  Form,
  Segmented,
  Table,
  Tag,
  Input,
  Select,
  Button,
  Row,
  Col,
  Card,
  Space,
  Typography,
  Flex,
} from "antd";
import { ReloadOutlined, PlusOutlined, MinusCircleOutlined } from "@ant-design/icons";

const SCHEDULING_MODE_DESCRIPTION: Record<
  "auto" | "fixed" | "label",
  string
> = {
  auto:
    "由平台依据资源与策略自动选择运行主机，无需绑定具体物理服务器。虚拟机经迁移或重启后，运行位置可能发生变更。无单机绑定类业务诉求时，建议采用自动调度作为默认策略。",

  fixed:
    "将虚拟机固定在同一台物理主机上运行，适用于依赖本机硬件、与他机同机部署或需固定物理落点等场景。所选主机异常将直接影响可用性；无此类约束时建议使用自动调度。",

  label:
    "通过主机标签限定可运行范围，适用于按机房、线路或用途等维度为主机分组的场景。全部标签条件须同时满足且与集群侧一致；优先、避让等调度偏好请使用「节点亲和性」。",
};

type Props = {
  form: any;
  record: any;
  nodes?: any[];
  reloadNodes?: () => Promise<any>;
  nodesLoading?: boolean;
};

const ChangeNodeScheduling: React.FC<Props> = ({
  form,
  record,
  nodes = [],
  reloadNodes,
  nodesLoading = false,
}) => {
  const [nodeKeyword, setNodeKeyword] = useState("");
  const [nodeReadyFilter, setNodeReadyFilter] = useState<
    "all" | "running" | "notready"
  >("all");

  useEffect(() => {
    if (!record) return;

    const spec = record?.spec?.template?.spec;
    const nodeSelector = spec?.nodeSelector;

    let currentNode: string | null = null;

    if (
      nodeSelector &&
      nodeSelector !== null &&
      typeof nodeSelector === "object" &&
      Object.keys(nodeSelector).length > 0
    ) {
      currentNode = nodeSelector["kubernetes.io/hostname"] || null;
    }

    const labelPairs: Array<{ key: string; value: string }> = [];
    if (
      nodeSelector &&
      nodeSelector !== null &&
      typeof nodeSelector === "object" &&
      Object.keys(nodeSelector).length > 0
    ) {
      Object.entries(nodeSelector).forEach(([key, value]) => {
        if (key !== "kubernetes.io/hostname" && value) {
          labelPairs.push({ key, value: String(value) });
        }
      });
    }

    let mode: "auto" | "fixed" | "label" = "auto";
    if (currentNode) {
      mode = "fixed";
    } else if (labelPairs.length > 0) {
      mode = "label";
    }

    form.setFieldsValue({
      nodeSchedulingMode: mode,
      fixedNode: currentNode || undefined,
      nodeSelectorPairs: labelPairs.length > 0 ? labelPairs : undefined,
    });
  }, [record, form]);

  const nodeSchedulingMode = Form.useWatch("nodeSchedulingMode", form);
  useEffect(() => {
    if (nodeSchedulingMode === "auto") {
      form.setFieldsValue({
        fixedNode: undefined,
        nodeSelectorPairs: undefined,
      });
    } else if (nodeSchedulingMode === "fixed") {
      form.setFieldsValue({
        nodeSelectorPairs: undefined,
      });
    } else if (nodeSchedulingMode === "label") {
      form.setFieldsValue({
        fixedNode: undefined,
      });
    }
  }, [nodeSchedulingMode, form]);

  const isNodeReady = (r: any): boolean => {
    if (typeof r?.ready === "boolean") return r.ready;
    const conds: any[] = Array.isArray(r?.status?.conditions)
      ? r.status.conditions
      : [];
    return conds.some(
      (c: any) =>
        String(c?.type || "") === "Ready" &&
        String(c?.status || "").toLowerCase() === "true",
    );
  };

  const displayNodes = useMemo(() => {
    let arr: any[] = Array.isArray(nodes) ? nodes : [];

    if (nodeReadyFilter === "running") {
      arr = arr.filter(isNodeReady);
    } else if (nodeReadyFilter === "notready") {
      arr = arr.filter((n: any) => !isNodeReady(n));
    }

    if (nodeKeyword) {
      const kw = String(nodeKeyword).toLowerCase().trim();
      arr = arr.filter((n: any) => {
        const name = String(n?.name || "").toLowerCase();
        const ip = String(n?.internalIP || "").toLowerCase();
        return name.includes(kw) || ip.includes(kw);
      });
    }

    return arr;
  }, [nodes, nodeReadyFilter, nodeKeyword]);

  const selectedNodeName = Form.useWatch("fixedNode", form);

  const nodeRowKey = (r: any) => String(r?.name || r?.metadata?.name || "");

  const schedulingModeForHelp: keyof typeof SCHEDULING_MODE_DESCRIPTION =
    nodeSchedulingMode === "fixed" || nodeSchedulingMode === "label"
      ? nodeSchedulingMode
      : "auto";

  return (
    <>
      <Form.Item
        name="nodeSchedulingMode"
        rules={[{ required: true, message: "请选择调度模式" }]}
        style={{ marginBottom: 8 }}
      >
        <Segmented
          options={[
            { value: "auto", label: "自动调度" },
            { value: "fixed", label: "指定主机" },
            { value: "label", label: "标签选择" },
          ]}
        />
      </Form.Item>

      <Typography.Paragraph
        type="secondary"
        className="vmManageDrawer-modeHelpText"
        style={{ marginTop: 0, marginBottom: 16 }}
      >
        {SCHEDULING_MODE_DESCRIPTION[schedulingModeForHelp]}
      </Typography.Paragraph>

      {nodeSchedulingMode === "fixed" && (
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <Flex gap="small" align="center" wrap="wrap" justify="flex-start">
            <Input
              allowClear
              placeholder="搜索主机名称 / IP"
              value={nodeKeyword}
              onChange={(e) => setNodeKeyword(e.target.value)}
              style={{ width: 200 }}
            />
            <Select
              value={nodeReadyFilter}
              style={{ width: 100 }}
              onChange={(v) => setNodeReadyFilter(v || "all")}
              options={[
                { value: "all", label: "全部主机" },
                { value: "running", label: "健康主机" },
                { value: "notready", label: "未就绪主机" },
              ]}
            />
            <Button
              icon={<ReloadOutlined />}
              onClick={() => reloadNodes?.()}
              loading={nodesLoading}
              aria-label="刷新节点列表"
            />
          </Flex>

          <Table
            size="middle"
            bordered={false}
            className="changeNodeScheduling-fixedHostTable"
            style={{ width: "100%" }}
            tableLayout="fixed"
            rowKey={nodeRowKey}
            columns={[
              {
                title: "主机名称",
                key: "name",
                render: (_: any, r: any) => {
                  const name =
                    r?.name || r?.metadata?.name || "-";
                  const ip =
                    r?.internalIP ||
                    r?.status?.addresses?.find((a: any) => a.type === "InternalIP")
                      ?.address ||
                    "-";
                  return (
                    <Space direction="vertical" size={0}>
                      <Typography.Text>{name}</Typography.Text>
                      <Typography.Text type="secondary">{ip}</Typography.Text>
                    </Space>
                  );
                },
              },
              {
                title: "状态",
                key: "ready",
                width: 110,
                render: (_: any, r: any) => {
                  const ready = isNodeReady(r);
                  return ready ? (
                    <Tag color="green" style={{ fontWeight: 400 }}>
                      Ready
                    </Tag>
                  ) : (
                    <Tag color="red" style={{ fontWeight: 400 }}>
                      NotReady
                    </Tag>
                  );
                },
              },
              {
                title: "CPU",
                key: "cpu",
                width: 100,
                render: (_: any, r: any) => {
                  const cpuRaw = r?.cpu ?? r?.status?.capacity?.cpu;
                  const cores =
                    typeof cpuRaw === "number"
                      ? cpuRaw
                      : Number(String(cpuRaw || "").replace(/[^0-9]/g, "")) ||
                        0;
                  return cores ? `${cores} 核` : "—";
                },
              },
              {
                title: "内存",
                key: "memory",
                width: 100,
                render: (_: any, r: any) => {
                  const memRaw = r?.memory ?? r?.status?.capacity?.memory;
                  const raw = String(memRaw || "").toUpperCase();
                  const num = Number(String(raw).replace(/[^0-9]/g, "")) || 0;
                  let gb = 0;
                  if (/KI$/.test(raw)) {
                    gb = Math.round(num / (1024 * 1024));
                  } else if (/MI$/.test(raw)) {
                    gb = Math.round(num / 1024);
                  } else if (/GI$/.test(raw)) {
                    gb = num;
                  } else if (typeof memRaw === "number") {
                    gb = Math.round(Number(memRaw) / (1024 * 1024 * 1024));
                  }
                  return gb ? `${gb} GiB` : "—";
                },
              },
            ]}
            dataSource={displayNodes}
            loading={nodesLoading}
            pagination={false}
            rowSelection={{
              type: "radio",
              columnWidth: 48,
              selectedRowKeys: selectedNodeName ? [selectedNodeName] : [],
              onChange: (keys) => {
                const k = keys[0];
                form.setFieldsValue({
                  fixedNode: k != null && k !== "" ? String(k) : undefined,
                });
              },
            }}
            onRow={(r) => ({
              onClick: () => {
                const name = nodeRowKey(r);
                if (name) {
                  form.setFieldsValue({ fixedNode: name });
                }
              },
            })}
          />
        </Space>
      )}

      {nodeSchedulingMode === "label" && (
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <Form.List name="nodeSelectorPairs">
            {(fields, { add, remove }) => (
              <Space direction="vertical" size="middle" style={{ width: "100%", minWidth: 0 }}>
                {fields.map(({ key, name }, idx) => (
                  <Card
                    key={key}
                    size="small"
                    style={{ width: "100%" }}
                    title={`标签选择器 #${idx + 1}`}
                    extra={
                      <Button
                        type="text"
                        icon={<MinusCircleOutlined />}
                        onClick={() => remove(name)}
                        danger
                        size="small"
                      />
                    }
                  >
                    <Row gutter={[12, 12]}>
                      <Col xs={24} sm={12}>
                        <Form.Item
                          name={[name, "key"]}
                          noStyle
                          rules={[{ required: true, message: "请输入键" }]}
                        >
                          <Input placeholder="Key（如 kubernetes.io/hostname）" />
                        </Form.Item>
                      </Col>
                      <Col xs={24} sm={12}>
                        <Form.Item
                          name={[name, "value"]}
                          noStyle
                          rules={[{ required: true, message: "请输入值" }]}
                        >
                          <Input placeholder="Value" />
                        </Form.Item>
                      </Col>
                    </Row>
                  </Card>
                ))}
                <Button
                  type="dashed"
                  onClick={() => add({ key: "", value: "" })}
                  icon={<PlusOutlined />}
                  block
                >
                  新增选择器
                </Button>
              </Space>
            )}
          </Form.List>
        </Space>
      )}

      <Form.Item name="fixedNode" hidden>
        <Input />
      </Form.Item>
    </>
  );
};

export default ChangeNodeScheduling;
