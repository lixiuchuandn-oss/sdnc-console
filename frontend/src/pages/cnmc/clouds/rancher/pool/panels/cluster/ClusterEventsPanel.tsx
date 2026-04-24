import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Input, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../../../../components/PageDetailSection';
import {
  fetchRancherClusterEvents,
  type RancherEventRow,
} from '../../../../../../../services/rancherClusterApi';

const cols: ColumnsType<RancherEventRow> = [
  {
    title: '类型',
    dataIndex: 'type',
    key: 'type',
    width: 90,
    render: (t) => (t === 'Warning' ? <Tag color="orange">{t}</Tag> : <Tag>{t || '—'}</Tag>),
  },
  { title: '命名空间', dataIndex: 'namespace', key: 'namespace', width: 120, ellipsis: true },
  {
    title: '对象',
    key: 'obj',
    width: 160,
    ellipsis: true,
    render: (_, r) => `${r.kind || ''}/${r.name || ''}`,
  },
  { title: '原因', dataIndex: 'reason', key: 'reason', width: 140, ellipsis: true },
  { title: '消息', dataIndex: 'message', key: 'message', ellipsis: true },
  { title: '时间', dataIndex: 'lastTimestamp', key: 'lastTimestamp', width: 180 },
];

type Props = { poolId: string; clusterId: string };

const ClusterEventsPanel: React.FC<Props> = ({ poolId, clusterId }) => {
  const [rows, setRows] = useState<RancherEventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');

  const load = useCallback(async () => {
    if (!poolId || !clusterId) return;
    setLoading(true);
    setErr(null);
    try {
      setRows(await fetchRancherClusterEvents(poolId, clusterId));
    } catch (e: any) {
      setErr(e?.message || '加载失败');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [poolId, clusterId]);

  useEffect(() => {
    void load();
  }, [load]);

  const kw = keyword.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!kw) return rows;
    return rows.filter((r) => {
      const blob = [r.namespace, r.reason, r.message, r.type, r.kind, r.name].join(' ').toLowerCase();
      return blob.includes(kw);
    });
  }, [rows, kw]);

  if (!poolId || !clusterId) {
    return <Alert type="warning" message="缺少资源池或集群参数" showIcon />;
  }

  return (
    <PageDetailSection asCard={false}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Input
            allowClear
            placeholder="命名空间 / 原因 / 消息 / 对象"
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
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()} />
        </div>
      </div>
      {err && <Alert type="error" message={err} showIcon style={{ marginBottom: 16 }} />}
      <Table
        className="std-table"
        bordered={false}
        size="small"
        rowKey={(r, i) => `${r.namespace}-${r.reason}-${r.lastTimestamp}-${i}`}
        columns={cols}
        dataSource={filtered}
        loading={loading}
        pagination={{
          size: 'small',
          showTotal: (total) => `共 ${total} 条`,
        }}
        scroll={{ x: 960 }}
      />
    </PageDetailSection>
  );
};

export default ClusterEventsPanel;
