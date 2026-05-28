import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SearchOutlined } from '@ant-design/icons';
import { Alert, Input, Modal, Table, Tag, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import PageDetailSection, { RowActionsButton } from '../../../../../components/PageDetailSection';
import { fetchMaasMachines, maasMachineOp, type MaasMachineOp } from '../../../../../services/maasApi';
import MachineDetailDrawer from '../drawers/MachineDetailDrawer';
import MaasDeployModal from '../modals/MaasDeployModal';
import { MAAS_LIST_TABLE_PAGINATION } from '../lib/maasTablePagination';
import { MaasToolbarRefresh } from '../lib/maasToolbar';
import { machineMatchesBucket } from '../lib/maasMachineBuckets';
import { normalizeMaasMachineRow } from '../lib/maasStatus';

type Props = {
  poolId: string;
};

type MachineRow = ReturnType<typeof normalizeMaasMachineRow>;

const MachinesSection: React.FC<Props> = ({ poolId }) => {
  const [searchParams] = useSearchParams();
  const statusBucket = searchParams.get('status');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<MachineRow[]>([]);
  const [keyword, setKeyword] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [deployId, setDeployId] = useState<string | null>(null);
  const [opLoading, setOpLoading] = useState(false);

  const load = useCallback(async () => {
    if (!poolId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchMaasMachines(poolId, { skipCache: true });
      const items = Array.isArray(res?.items) ? res.items : [];
      if (!res?.ok) {
        setError(res?.message || '拉取机器列表失败');
        setRows([]);
        return;
      }
      setRows(items.map((m) => normalizeMaasMachineRow(m as Record<string, unknown>)));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '拉取机器列表失败');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [poolId]);

  useEffect(() => {
    void load();
  }, [load]);

  const runOp = useCallback(
    async (systemId: string, op: MaasMachineOp, confirm?: { title: string; content: string }) => {
      if (confirm) {
        const ok = await new Promise<boolean>((resolve) => {
          Modal.confirm({
            title: confirm.title,
            content: confirm.content,
            onOk: () => resolve(true),
            onCancel: () => resolve(false),
          });
        });
        if (!ok) return;
      }
      setOpLoading(true);
      try {
        const res = await maasMachineOp(poolId, systemId, op);
        if (res?.ok) {
          message.success(res.message || '操作已提交');
          void load();
        } else {
          message.error(res?.message || '操作失败');
        }
      } catch (e: unknown) {
        message.error(e instanceof Error ? e.message : '操作失败');
      } finally {
        setOpLoading(false);
      }
    },
    [poolId, load],
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
      title: 'System ID',
      dataIndex: 'systemId',
      key: 'systemId',
      fixed: 'left',
      ellipsis: true,
    },
    {
      title: '主机名 / FQDN',
      dataIndex: 'hostname',
      key: 'hostname',
      ellipsis: true,
    },
    {
      title: '状态',
      dataIndex: 'statusLabel',
      key: 'statusLabel',
      render: (v: string) => <Tag>{v}</Tag>,
    },
    {
      title: 'CPU',
      dataIndex: 'cpu',
      key: 'cpu',
    },
    {
      title: '内存',
      dataIndex: 'memoryGiB',
      key: 'memoryGiB',
    },
    {
      title: '系统',
      dataIndex: 'os',
      key: 'os',
      ellipsis: true,
    },
    {
      title: '架构',
      dataIndex: 'arch',
      key: 'arch',
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      render: (_, record) => (
        <RowActionsButton
          items={[
            { key: 'detail', label: '详情' },
            { key: 'commission', label: '纳管' },
            { key: 'deploy', label: '部署' },
            { key: 'power_on', label: '开机' },
            { key: 'power_off', label: '关机' },
            { key: 'release', label: '释放', danger: true },
          ]}
          onClick={({ key }) => {
            if (key === 'detail') {
              setDetailId(record.systemId);
              return;
            }
            if (key === 'commission') {
              void runOp(record.systemId, 'commission', {
                title: '纳管（Commission）',
                content: `对 ${record.hostname} 执行硬件检测？`,
              });
              return;
            }
            if (key === 'deploy') {
              setDeployId(record.systemId);
              return;
            }
            if (key === 'power_on') {
              void runOp(record.systemId, 'power_on');
              return;
            }
            if (key === 'power_off') {
              void runOp(record.systemId, 'power_off');
              return;
            }
            if (key === 'release') {
              void runOp(record.systemId, 'release', {
                title: '释放机器',
                content: `释放 ${record.hostname}？机器将回到可用池。`,
              });
            }
          }}
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
              suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
            <button
              type="button"
              className="toolbar-reset-btn"
              onClick={() => setKeyword('')}
            >
              重置
            </button>
          </>
        }
        toolbarRight={
          <div className="toolbar-actions">
            <MaasToolbarRefresh
              loading={loading || opLoading}
              onRefresh={() => void load()}
            />
          </div>
        }
      >
        {error ? (
          <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />
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
    </>
  );
};

export default MachinesSection;
