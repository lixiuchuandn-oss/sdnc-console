import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Input, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../../../../components/PageDetailSection';
import {
  fetchRancherClusterProjects,
  type RancherProjectRow,
} from '../../../../../../../services/rancherClusterApi';

const projectCols: ColumnsType<RancherProjectRow> = [
  { title: '名称', dataIndex: 'name', key: 'name', ellipsis: true },
  { title: '状态', dataIndex: 'state', key: 'state', width: 120 },
  { title: 'ID', dataIndex: 'id', key: 'id', width: 160, ellipsis: true },
];

type Props = { poolId: string; clusterId: string };

const ClusterProjectsPanel: React.FC<Props> = ({ poolId, clusterId }) => {
  const [projects, setProjects] = useState<RancherProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');

  const load = useCallback(async () => {
    if (!poolId || !clusterId) return;
    setLoading(true);
    setErr(null);
    try {
      const p = await fetchRancherClusterProjects(poolId, clusterId);
      setProjects(p);
    } catch (e: any) {
      setErr(e?.message || '加载失败');
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, [poolId, clusterId]);

  useEffect(() => {
    void load();
  }, [load]);

  const kw = keyword.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!kw) return projects;
    return projects.filter(
      (r) =>
        r.name.toLowerCase().includes(kw) ||
        r.id.toLowerCase().includes(kw) ||
        (r.state && r.state.toLowerCase().includes(kw)),
    );
  }, [projects, kw]);

  if (!poolId || !clusterId) {
    return <Alert type="warning" message="缺少资源池或集群参数" showIcon />;
  }

  return (
    <PageDetailSection asCard={false}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Input
            allowClear
            placeholder="名称 / ID / 状态"
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
        rowKey="id"
        columns={projectCols}
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

export default ClusterProjectsPanel;
