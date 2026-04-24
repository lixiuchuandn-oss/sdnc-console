import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Input, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../../../../components/PageDetailSection';
import {
  fetchRancherClusterMembers,
  type RancherMemberRow,
} from '../../../../../../../services/rancherClusterApi';

const cols: ColumnsType<RancherMemberRow> = [
  { title: '角色模板', dataIndex: 'roleTemplateId', key: 'roleTemplateId', ellipsis: true, width: 200 },
  { title: '用户', dataIndex: 'userPrincipalName', key: 'userPrincipalName', ellipsis: true },
  { title: '用户 ID', dataIndex: 'userId', key: 'userId', width: 120, ellipsis: true },
  { title: '组', dataIndex: 'groupPrincipalName', key: 'groupPrincipalName', ellipsis: true },
];

type Props = { poolId: string; clusterId: string };

const ClusterMembersPanel: React.FC<Props> = ({ poolId, clusterId }) => {
  const [rows, setRows] = useState<RancherMemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');

  const load = useCallback(async () => {
    if (!poolId || !clusterId) return;
    setLoading(true);
    setErr(null);
    try {
      setRows(await fetchRancherClusterMembers(poolId, clusterId));
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
      const blob = [
        r.roleTemplateId,
        r.userPrincipalName,
        r.userId,
        r.groupPrincipalName,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
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
            placeholder="用户 / 角色 / 组"
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
        rowKey="id"
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

export default ClusterMembersPanel;
