import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Input, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../../../../components/PageDetailSection';
import {
  fetchRancherClusterWorkloads,
  type RancherWorkloadKind,
} from '../../../../../../../services/rancherClusterApi';
import type { RancherClusterWorkloadsSubKey } from '../../../../../../../layouts/admin/rancher/rancherClusterSidebar';
import RancherWorkloadCreateModal from './RancherWorkloadCreateModal';

type Props = { poolId: string; clusterId: string; kind: RancherClusterWorkloadsSubKey };

function columnsFor(kind: RancherClusterWorkloadsSubKey): ColumnsType<Record<string, unknown>> {
  const ns = { title: '命名空间', dataIndex: 'namespace', key: 'namespace', width: 140, ellipsis: true };
  const name = { title: '名称', dataIndex: 'name', key: 'name', ellipsis: true };
  const created = {
    title: '创建时间',
    dataIndex: 'created',
    key: 'created',
    width: 200,
    ellipsis: true,
  };
  switch (kind) {
    case 'cronjob':
      return [
        ns,
        name,
        { title: '调度', dataIndex: 'schedule', key: 'schedule', width: 140, ellipsis: true },
        { title: '暂停', dataIndex: 'suspend', key: 'suspend', width: 72 },
        { title: '活跃', dataIndex: 'active', key: 'active', width: 72 },
        {
          title: '上次调度',
          dataIndex: 'lastSchedule',
          key: 'lastSchedule',
          width: 200,
          ellipsis: true,
        },
        created,
      ];
    case 'job':
      return [
        ns,
        name,
        { title: '完成度', dataIndex: 'completions', key: 'completions', width: 100 },
        { title: '状态', dataIndex: 'status', key: 'status', width: 100 },
        created,
      ];
    case 'daemonset':
      return [
        ns,
        name,
        { title: '期望', dataIndex: 'desired', key: 'desired', width: 72 },
        { title: '当前', dataIndex: 'current', key: 'current', width: 72 },
        { title: '就绪', dataIndex: 'ready', key: 'ready', width: 72 },
        { title: '可用', dataIndex: 'available', key: 'available', width: 72 },
        created,
      ];
    case 'deployment':
    case 'statefulset':
      return [
        ns,
        name,
        { title: '就绪', dataIndex: 'ready', key: 'ready', width: 100 },
        { title: '最新', dataIndex: 'upToDate', key: 'upToDate', width: 80 },
        { title: '可用', dataIndex: 'available', key: 'available', width: 80 },
        created,
      ];
    case 'pod':
      return [
        ns,
        name,
        { title: '就绪', dataIndex: 'ready', key: 'ready', width: 90 },
        { title: '状态', dataIndex: 'status', key: 'status', width: 110 },
        { title: '重启', dataIndex: 'restarts', key: 'restarts', width: 72 },
        { title: '节点', dataIndex: 'node', key: 'node', width: 160, ellipsis: true },
        created,
      ];
    default:
      return [ns, name, created];
  }
}

const RancherWorkloadsPanel: React.FC<Props> = ({ poolId, clusterId, kind }) => {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    if (!poolId || !clusterId) return;
    setLoading(true);
    setErr(null);
    try {
      const data = await fetchRancherClusterWorkloads(
        poolId,
        clusterId,
        kind as RancherWorkloadKind,
      );
      setRows(data);
    } catch (e: any) {
      setErr(e?.message || '加载失败');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [poolId, clusterId, kind]);

  useEffect(() => {
    void load();
  }, [load]);

  const kw = keyword.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!kw) return rows;
    return rows.filter((r) => {
      const parts = [
        r.namespace,
        r.name,
        r.status,
        r.schedule,
        r.node,
        r.ready,
        r.completions,
      ]
        .filter(Boolean)
        .map((x) => String(x).toLowerCase());
      return parts.some((p) => p.includes(kw));
    });
  }, [rows, kw]);

  const cols = useMemo(() => columnsFor(kind), [kind]);

  if (!poolId || !clusterId) {
    return <Alert type="warning" message="缺少资源池或集群参数" showIcon />;
  }

  return (
    <PageDetailSection asCard={false}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Input
            allowClear
            placeholder="搜索命名空间、名称等"
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            className="toolbar-search"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <button type="button" className="toolbar-reset-btn" onClick={() => setKeyword('')}>
            重置
          </button>
        </div>
        <div className="toolbar-actions">
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            创建
          </Button>
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()} />
        </div>
      </div>
      <RancherWorkloadCreateModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        poolId={poolId}
        clusterId={clusterId}
        kind={kind}
        onSuccess={() => void load()}
      />
      {err && (
        <Alert
          type="error"
          message={err}
          showIcon
          closable
          onClose={() => setErr(null)}
          style={{ marginBottom: 16 }}
        />
      )}
      <Table
        className="std-table"
        bordered={false}
        size="small"
        rowKey={(r) => String(r.id || `${r.namespace}/${r.name}`)}
        columns={cols}
        dataSource={filtered}
        loading={loading}
        pagination={{
          size: 'small',
          showTotal: (total) => `共 ${total} 条`,
        }}
      />
    </PageDetailSection>
  );
};

export default RancherWorkloadsPanel;
