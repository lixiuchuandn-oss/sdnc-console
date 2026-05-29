import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PlusOutlined, SearchOutlined } from "@ant-design/icons";
import { Alert, Button, Input, Modal, Table, Tag, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import PageDetailSection, {
  RowActionsButton,
} from "../../../../../components/PageDetailSection";
import {
  fetchMaasMachines,
  maasDeleteMachine,
  maasMachineOp,
  type MaasMachineOp,
} from "../../../../../services/maasApi";
import MachineDetailDrawer from "../drawers/MachineDetailDrawer";
import MaasDeployModal from "../modals/MaasDeployModal";
import MaasMachineCreateModal from "../modals/MaasMachineCreateModal";
import { MAAS_LIST_TABLE_PAGINATION } from "../lib/maasTablePagination";
import { MaasToolbarRefresh } from "../lib/maasToolbar";
import { machineMatchesBucket } from "../lib/maasMachineBuckets";
import { normalizeMaasMachineRow } from "../lib/maasStatus";
import {
  maasMachineRowActions,
  type MaasRowActionKey,
} from "../lib/maasMachineActions";

type Props = {
  poolId: string;
};

type MachineRow = ReturnType<typeof normalizeMaasMachineRow>;

/** 需二次确认的操作；content 接收主机名 */
const OP_CONFIRMS: Partial<
  Record<MaasRowActionKey, { title: string; content: (h: string) => string }>
> = {
  commission: {
    title: "纳管（Commission）",
    content: (h) => `对 ${h} 执行硬件检测？`,
  },
  power_off: { title: "关机", content: (h) => `确认对 ${h} 执行关机？` },
  power_cycle: { title: "重启", content: (h) => `确认对 ${h} 执行强制重启？` },
  mark_broken: {
    title: "标记故障",
    content: (h) => `将 ${h} 标记为故障状态？`,
  },
  mark_fixed: {
    title: "标记修复",
    content: (h) => `将 ${h} 标记为已修复（可用）？`,
  },
  abort: { title: "中止操作", content: (h) => `中止 ${h} 当前进行中的操作？` },
  release: {
    title: "释放机器",
    content: (h) => `释放 ${h}？机器将回到可用池。`,
  },
  delete: { title: "删除机器", content: (h) => `删除 ${h}？该操作不可恢复。` },
};

const MachinesSection: React.FC<Props> = ({ poolId }) => {
  const [searchParams] = useSearchParams();
  const statusBucket = searchParams.get("status");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<MachineRow[]>([]);
  const [keyword, setKeyword] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [deployId, setDeployId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [opLoading, setOpLoading] = useState(false);

  const load = useCallback(async () => {
    if (!poolId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchMaasMachines(poolId, { skipCache: true });
      const items = Array.isArray(res?.items) ? res.items : [];
      if (!res?.ok) {
        setError(res?.message || "拉取机器列表失败");
        return;
      }
      setRows(
        items.map((m) => normalizeMaasMachineRow(m as Record<string, unknown>)),
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "拉取机器列表失败");
    } finally {
      setLoading(false);
    }
  }, [poolId]);

  useEffect(() => {
    void load();
  }, [load]);

  const runOp = useCallback(
    async (systemId: string, op: MaasMachineOp) => {
      setOpLoading(true);
      try {
        const res = await maasMachineOp(poolId, systemId, op);
        if (res?.ok) {
          message.success(res.message || "操作已提交");
          void load();
        } else {
          message.error(res?.message || "操作失败");
        }
      } catch (e: unknown) {
        message.error(e instanceof Error ? e.message : "操作失败");
      } finally {
        setOpLoading(false);
      }
    },
    [poolId, load],
  );

  const removeMachine = useCallback(
    async (systemId: string) => {
      setOpLoading(true);
      try {
        const res = await maasDeleteMachine(poolId, systemId);
        if (res?.ok) {
          message.success(res.message || "机器已删除");
          void load();
        } else {
          message.error(res?.message || "删除失败");
        }
      } catch (e: unknown) {
        message.error(e instanceof Error ? e.message : "删除失败");
      } finally {
        setOpLoading(false);
      }
    },
    [poolId, load],
  );

  const confirmThen = useCallback(
    async (key: MaasRowActionKey, hostname: string, run: () => void) => {
      const cfg = OP_CONFIRMS[key];
      if (!cfg) {
        run();
        return;
      }
      const ok = await new Promise<boolean>((resolve) => {
        Modal.confirm({
          title: cfg.title,
          content: cfg.content(hostname),
          okButtonProps: key === "delete" ? { danger: true } : undefined,
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      });
      if (ok) run();
    },
    [],
  );

  const handleAction = useCallback(
    (record: MachineRow, key: MaasRowActionKey) => {
      if (key === "detail") {
        setDetailId(record.systemId);
        return;
      }
      if (key === "deploy") {
        setDeployId(record.systemId);
        return;
      }
      if (key === "delete") {
        void confirmThen(
          key,
          record.hostname,
          () => void removeMachine(record.systemId),
        );
        return;
      }
      void confirmThen(
        key,
        record.hostname,
        () => void runOp(record.systemId, key as MaasMachineOp),
      );
    },
    [confirmThen, removeMachine, runOp],
  );

  const filtered = useMemo(() => {
    const byBucket = statusBucket
      ? rows.filter((r) => machineMatchesBucket(r.raw.status, statusBucket))
      : rows;
    const q = keyword.trim().toLowerCase();
    if (!q) return byBucket;
    return byBucket.filter(
      (r) =>
        r.systemId.toLowerCase().includes(q) ||
        r.hostname.toLowerCase().includes(q) ||
        r.statusLabel.toLowerCase().includes(q),
    );
  }, [rows, keyword, statusBucket]);

  const columns: ColumnsType<MachineRow> = [
    {
      title: "System ID",
      dataIndex: "systemId",
      key: "systemId",
      fixed: "left",
      ellipsis: true,
    },
    {
      title: "主机名 / FQDN",
      dataIndex: "hostname",
      key: "hostname",
      ellipsis: true,
    },
    {
      title: "状态",
      dataIndex: "statusLabel",
      key: "statusLabel",
      render: (v: string) => <Tag>{v}</Tag>,
    },
    {
      title: "CPU",
      dataIndex: "cpu",
      key: "cpu",
    },
    {
      title: "内存",
      dataIndex: "memoryGiB",
      key: "memoryGiB",
    },
    {
      title: "系统",
      dataIndex: "os",
      key: "os",
      ellipsis: true,
    },
    {
      title: "架构",
      dataIndex: "arch",
      key: "arch",
    },
    {
      title: "操作",
      key: "actions",
      fixed: "right",
      render: (_, record) => (
        <RowActionsButton
          items={maasMachineRowActions(record.raw.status)}
          onClick={({ key }) => handleAction(record, key as MaasRowActionKey)}
        />
      ),
    },
  ];

  return (
    <>
      <PageDetailSection
        asCard={false}
        title="裸金属机器"
        toolbarLeft={
          <>
            <Input
              allowClear
              className="toolbar-search"
              placeholder="System ID / 主机名"
              suffix={<SearchOutlined style={{ color: "rgba(0,0,0,.45)" }} />}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
            <button
              type="button"
              className="toolbar-reset-btn"
              onClick={() => setKeyword("")}
            >
              重置
            </button>
          </>
        }
        toolbarRight={
          <div className="toolbar-actions">
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setCreateOpen(true)}
            >
              添加机器
            </Button>
            <MaasToolbarRefresh
              loading={loading || opLoading}
              onRefresh={() => void load()}
            />
          </div>
        }
      >
        {error ? (
          <Alert
            type="error"
            showIcon
            message={error}
            style={{ marginBottom: 16 }}
          />
        ) : null}
        <Table<MachineRow>
          className="std-table"
          bordered={false}
          rowKey="systemId"
          loading={loading || opLoading}
          columns={columns}
          dataSource={filtered}
          scroll={{ x: true }}
          pagination={MAAS_LIST_TABLE_PAGINATION}
        />
      </PageDetailSection>

      <MachineDetailDrawer
        poolId={poolId}
        systemId={detailId}
        open={!!detailId}
        onClose={() => setDetailId(null)}
      />
      <MaasDeployModal
        poolId={poolId}
        systemId={deployId}
        open={!!deployId}
        onClose={() => setDeployId(null)}
        onSuccess={() => void load()}
      />
      <MaasMachineCreateModal
        poolId={poolId}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSuccess={() => void load()}
      />
    </>
  );
};

export default MachinesSection;
