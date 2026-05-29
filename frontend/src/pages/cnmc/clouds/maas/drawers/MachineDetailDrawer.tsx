import React, { useCallback, useEffect, useMemo, useState } from "react";
import { SyncOutlined } from "@ant-design/icons";
import { Alert, Descriptions, Drawer, Spin, Table, Tabs, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  fetchMaasEvents,
  fetchMaasMachineDetail,
} from "../../../../../services/maasApi";
import { resolveMaasStatusLabel } from "../lib/maasStatus";
import { machineBucketFromStatus } from "../lib/maasMachineBuckets";

type MachineEvent = {
  key: string;
  created: string;
  level: string;
  description: string;
  hostname: string;
};

function normalizeMachineEvent(
  raw: Record<string, unknown>,
  idx: number,
): MachineEvent {
  const type = (
    raw.type && typeof raw.type === "object" ? raw.type : {}
  ) as Record<string, unknown>;
  const desc =
    String(raw.description || "").trim() ||
    String(type.description || type.name || "").trim() ||
    "—";
  return {
    key: String(raw.id ?? idx),
    created: String(raw.created ?? raw.time ?? "—"),
    level: String(raw.level ?? type.level ?? "INFO").toUpperCase(),
    description: desc,
    hostname: String(raw.hostname ?? raw.node ?? "").trim(),
  };
}

type Props = {
  poolId: string;
  systemId: string | null;
  open: boolean;
  onClose: () => void;
};

const MachineDetailDrawer: React.FC<Props> = ({
  poolId,
  systemId,
  open,
  onClose,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [machine, setMachine] = useState<Record<string, unknown> | null>(null);
  const [blockdevices, setBlockdevices] = useState<Record<string, unknown>[]>(
    [],
  );
  const [interfaces, setInterfaces] = useState<Record<string, unknown>[]>([]);
  const [events, setEvents] = useState<MachineEvent[]>([]);

  const load = useCallback(async () => {
    if (!poolId || !systemId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchMaasMachineDetail(poolId, systemId, {
        skipCache: true,
      });
      if (!res?.ok) {
        setError(res?.message || "加载详情失败");
        return;
      }
      setMachine(res.machine || null);
      setBlockdevices(Array.isArray(res.blockdevices) ? res.blockdevices : []);
      setInterfaces(Array.isArray(res.interfaces) ? res.interfaces : []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "加载详情失败");
    } finally {
      setLoading(false);
    }
  }, [poolId, systemId]);

  const loadEvents = useCallback(async () => {
    if (!poolId || !systemId) return;
    try {
      const res = await fetchMaasEvents(poolId, 50, { skipCache: true });
      const items = Array.isArray(res?.items) ? res.items : [];
      setEvents(
        items.map((e, i) =>
          normalizeMachineEvent(e as Record<string, unknown>, i),
        ),
      );
    } catch {
      /* 保留上次事件，避免轮询抖动清空 */
    }
  }, [poolId, systemId]);

  useEffect(() => {
    if (open && systemId) {
      void load();
      void loadEvents();
    }
  }, [open, systemId, load, loadEvents]);

  const statusCode = machine?.status;
  const inProgress = useMemo(
    () => machineBucketFromStatus(statusCode) === "provisioning",
    [statusCode],
  );

  useEffect(() => {
    if (!open || !systemId || !inProgress) return;
    const timer = setInterval(() => {
      void load();
      void loadEvents();
    }, 8000);
    return () => clearInterval(timer);
  }, [open, systemId, inProgress, load, loadEvents]);

  const diskCols: ColumnsType<Record<string, unknown>> = [
    {
      title: "设备",
      key: "name",
      fixed: "left",
      render: (_, r) => String(r.name ?? r.id ?? "—"),
    },
    {
      title: "容量",
      key: "size",
      render: (_, r) => String(r.size ?? r.block_size ?? "—"),
    },
    {
      title: "类型",
      key: "type",
      render: (_, r) => String(r.type ?? r.filesystem ?? "—"),
    },
  ];

  const ifaceCols: ColumnsType<Record<string, unknown>> = [
    {
      title: "接口",
      key: "name",
      fixed: "left",
      render: (_, r) => String(r.name ?? r.id ?? "—"),
    },
    {
      title: "MAC",
      key: "mac",
      render: (_, r) => String(r.mac_address ?? "—"),
    },
    {
      title: "链路",
      key: "link",
      render: (_, r) => String(r.link_connected ?? r.link ?? "—"),
    },
  ];

  const m = machine || {};
  const statusLabel = resolveMaasStatusLabel(m);
  const statusMessage = String(
    m.status_message ?? m.status_action ?? "",
  ).trim();
  const machineHost = String(m.hostname ?? m.fqdn ?? "")
    .trim()
    .toLowerCase();
  const machineEvents = useMemo(() => {
    if (!machineHost) return events;
    const matched = events.filter((e) =>
      e.hostname.toLowerCase().includes(machineHost.split(".")[0]),
    );
    return matched.length ? matched : events;
  }, [events, machineHost]);

  const eventCols: ColumnsType<MachineEvent> = [
    {
      title: "时间",
      dataIndex: "created",
      key: "created",
      fixed: "left",
      width: 200,
    },
    {
      title: "级别",
      dataIndex: "level",
      key: "level",
      width: 90,
      render: (v: string) => (
        <Tag
          color={
            v === "ERROR" || v === "CRITICAL"
              ? "red"
              : v === "WARNING"
                ? "orange"
                : "default"
          }
        >
          {v}
        </Tag>
      ),
    },
    { title: "描述", dataIndex: "description", key: "description" },
  ];

  return (
    <Drawer
      title={systemId ? `机器 ${systemId}` : "机器详情"}
      width={720}
      open={open}
      onClose={onClose}
      destroyOnClose
    >
      {error ? (
        <Alert
          type="error"
          showIcon
          message={error}
          style={{ marginBottom: 16 }}
        />
      ) : null}
      {inProgress ? (
        <Alert
          type="info"
          showIcon
          icon={<SyncOutlined spin />}
          message={`正在${statusLabel}…（每 8 秒自动刷新进度）`}
          description={statusMessage || undefined}
          style={{ marginBottom: 16 }}
        />
      ) : null}
      <Spin spinning={loading}>
        <Descriptions
          bordered
          size="small"
          column={1}
          style={{ marginBottom: 16 }}
        >
          <Descriptions.Item label="System ID">{systemId}</Descriptions.Item>
          <Descriptions.Item label="主机名">
            {String(m.hostname ?? m.fqdn ?? "—")}
          </Descriptions.Item>
          <Descriptions.Item label="状态">
            <Tag>{resolveMaasStatusLabel(m)}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="CPU">
            {String(m.cpu_count ?? "—")}
          </Descriptions.Item>
          <Descriptions.Item label="内存 (MiB)">
            {String(m.memory ?? m.memory_MiB ?? "—")}
          </Descriptions.Item>
          <Descriptions.Item label="系统">
            {[m.osystem, m.distro_series].filter(Boolean).join(" ") || "—"}
          </Descriptions.Item>
          <Descriptions.Item label="架构">
            {String(m.architecture ?? "—")}
          </Descriptions.Item>
          <Descriptions.Item label="电源">
            {String(m.power_type ?? "—")}
          </Descriptions.Item>
          <Descriptions.Item label="IP">
            {String(
              m.ip ||
                (Array.isArray(m.ip_addresses)
                  ? (m.ip_addresses as string[]).join(", ")
                  : "") ||
                "—",
            )}
          </Descriptions.Item>
        </Descriptions>
        <Tabs
          items={[
            {
              key: "disks",
              label: `磁盘 (${blockdevices.length})`,
              children: (
                <Table
                  className="std-table"
                  bordered={false}
                  rowKey={(r, i) => String(r.id ?? i)}
                  columns={diskCols}
                  dataSource={blockdevices}
                  scroll={{ x: true }}
                  pagination={false}
                />
              ),
            },
            {
              key: "ifaces",
              label: `网卡 (${interfaces.length})`,
              children: (
                <Table
                  className="std-table"
                  bordered={false}
                  rowKey={(r, i) => String(r.id ?? i)}
                  columns={ifaceCols}
                  dataSource={interfaces}
                  scroll={{ x: true }}
                  pagination={false}
                />
              ),
            },
            {
              key: "events",
              label: `事件 (${machineEvents.length})`,
              children: (
                <Table<MachineEvent>
                  className="std-table"
                  bordered={false}
                  rowKey="key"
                  columns={eventCols}
                  dataSource={machineEvents}
                  scroll={{ x: true }}
                  pagination={{ pageSize: 10, size: "small" }}
                />
              ),
            },
          ]}
        />
      </Spin>
    </Drawer>
  );
};

export default MachineDetailDrawer;
