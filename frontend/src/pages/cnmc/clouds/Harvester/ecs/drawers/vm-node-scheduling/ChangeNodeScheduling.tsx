/**
 * ChangeNodeScheduling.tsx
 *
 * 节点调度修改组件
 * 参考创建虚拟机时的节点选择设计
 */
import React, { useEffect, useMemo, useState } from "react";
import {
  App,
  Checkbox,
  Form,
  Segmented,
  Table,
  Input,
  Select,
  Button,
  Space,
  Typography,
  Flex,
} from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { buildHarvesterNodePickerTableColumns } from "../shared/lib/harvesterNodePickerTableColumns";
import { useHarvesterNodeResourceMaps } from "../shared/lib/useHarvesterNodeResourceMaps";
import {
  fetchFailureDomainOverview,
  type FailureDomainRow,
} from "services/harvester/failureDomains";
import {
  buildVmFailureDomainSelectOptions,
  parseFailureDomainFromNodeSelector,
  VM_FAILURE_DOMAIN_SELECT_EMPTY_HINT,
} from "../../lib/vmFailureDomainNodeSelector";
import { readVmDeploymentSetId } from "../../lib/vmDeploymentSet";
import {
  readVmMetricAutoScheduled,
  trySetVmRecordMetricAutoScheduledExclusive,
} from "../../lib/vmSchedulingExclusion";

const SCHEDULING_MODE_DESCRIPTION: Record<
  "auto" | "fixed" | "label",
  string
> = {
  auto:
    "由平台依据资源与策略自动选择运行主机，无需绑定具体物理服务器。虚拟机经迁移或重启后，运行位置可能发生变更。无单机绑定类业务诉求时，建议采用自动调度作为默认策略。",

  fixed:
    "将虚拟机固定在同一台物理主机上运行，适用于依赖本机硬件、与他机同机部署或需固定物理落点等场景。所选主机异常将直接影响可用性；无此类约束时建议使用自动调度。",

  label:
    "选择集群已定义的故障域，限定 VM 落在对应物理节点。优先、避让等调度偏好请使用「节点亲和性」。",
};

type Props = {
  form: any;
  record: any;
  cloudId?: string;
  nodes?: any[];
  reloadNodes?: () => Promise<any>;
  nodesLoading?: boolean;
  pciDevices?: any[];
};

const ChangeNodeScheduling: React.FC<Props> = ({
  form,
  record,
  cloudId,
  nodes = [],
  reloadNodes,
  nodesLoading = false,
  pciDevices = [],
}) => {
  const { message } = App.useApp();
  const { metricsMap, requestsMap, nodesDetailMap, resourceLoading } =
    useHarvesterNodeResourceMaps(cloudId);
  const [nodeKeyword, setNodeKeyword] = useState("");
  const [nodeReadyFilter, setNodeReadyFilter] = useState<
    "all" | "running" | "notready"
  >("all");
  const [failureDomains, setFailureDomains] = useState<FailureDomainRow[]>([]);
  const [failureDomainsLoading, setFailureDomainsLoading] = useState(false);

  useEffect(() => {
    if (!cloudId) {
      setFailureDomains([]);
      return;
    }
    let cancelled = false;
    setFailureDomainsLoading(true);
    void fetchFailureDomainOverview(cloudId)
      .then((json: unknown) => {
        if (cancelled) return;
        const data = (json as { data?: { domains?: FailureDomainRow[] } })?.data;
        setFailureDomains(Array.isArray(data?.domains) ? data?.domains ?? [] : []);
      })
      .catch(() => {
        if (!cancelled) setFailureDomains([]);
      })
      .finally(() => {
        if (!cancelled) setFailureDomainsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cloudId]);

  const failureDomainName = Form.useWatch("failureDomainName", form);

  const failureDomainOptions = useMemo(
    () =>
      buildVmFailureDomainSelectOptions(failureDomains, {
        extraIncludeNames: failureDomainName ? [String(failureDomainName)] : [],
      }),
    [failureDomains, failureDomainName],
  );

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
    let failureDomainName: string | undefined;
    if (
      nodeSelector &&
      nodeSelector !== null &&
      typeof nodeSelector === "object" &&
      Object.keys(nodeSelector).length > 0
    ) {
      const parsed = parseFailureDomainFromNodeSelector(
        nodeSelector as Record<string, unknown>,
      );
      failureDomainName = parsed.failureDomainName;
      labelPairs.push(...parsed.otherPairs);
    }

    let mode: "auto" | "fixed" | "label" = "auto";
    if (currentNode) {
      mode = "fixed";
    } else if (failureDomainName) {
      mode = "label";
    } else if (labelPairs.length > 0) {
      mode = "label";
    }

    form.setFieldsValue({
      nodeSchedulingMode: mode,
      fixedNode: currentNode || undefined,
      failureDomainName,
      metricAutoScheduled: mode === "auto" ? readVmMetricAutoScheduled(record) : false,
    });
  }, [record, form]);

  const nodeSchedulingMode = Form.useWatch("nodeSchedulingMode", form);
  const deploymentSetId = readVmDeploymentSetId(record);
  useEffect(() => {
    if (nodeSchedulingMode === "auto") {
      form.setFieldsValue({
        fixedNode: undefined,
        failureDomainName: undefined,
      });
    } else if (nodeSchedulingMode === "fixed") {
      form.setFieldsValue({
        failureDomainName: undefined,
      });
    } else if (nodeSchedulingMode === "label") {
      form.setFieldsValue({
        fixedNode: undefined,
      });
    }
    if (nodeSchedulingMode !== "auto") {
      form.setFieldsValue({ metricAutoScheduled: false });
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

  const nodePickerColumns = useMemo(
    () =>
      buildHarvesterNodePickerTableColumns({
        metricsMap,
        requestsMap,
        nodesDetailMap,
        resourceLoading,
      }),
    [metricsMap, requestsMap, nodesDetailMap, resourceLoading],
  );

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
            { value: "label", label: "故障域" },
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

      {nodeSchedulingMode === "auto" ? (
        <Form.Item
          name="metricAutoScheduled"
          valuePropName="checked"
          style={{ marginBottom: 16 }}
        >
          <Checkbox
            disabled={!!deploymentSetId}
            onChange={(e) => {
              const err = trySetVmRecordMetricAutoScheduledExclusive(
                form,
                e.target.checked,
                record,
                nodeSchedulingMode,
                { pciDevices },
              );
              if (err) message.error(err);
            }}
          >
            参与指标自动调度
          </Checkbox>
        </Form.Item>
      ) : null}

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
            size="small"
            bordered
            className="changeNodeScheduling-fixedHostTable wizard-node-table"
            style={{ width: "100%" }}
            rowKey={nodeRowKey}
            columns={nodePickerColumns}
            dataSource={displayNodes}
            loading={nodesLoading || resourceLoading}
            pagination={false}
            scroll={{ x: true }}
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
        <Form.Item name="failureDomainName" label="故障域">
          <Select
            allowClear
            showSearch
            loading={failureDomainsLoading}
            placeholder="选择故障域"
            options={failureDomainOptions}
            optionFilterProp="label"
            notFoundContent={
              failureDomainsLoading ? undefined : VM_FAILURE_DOMAIN_SELECT_EMPTY_HINT
            }
          />
        </Form.Item>
      )}

      <Form.Item name="fixedNode" hidden>
        <Input />
      </Form.Item>
    </>
  );
};

export default ChangeNodeScheduling;
