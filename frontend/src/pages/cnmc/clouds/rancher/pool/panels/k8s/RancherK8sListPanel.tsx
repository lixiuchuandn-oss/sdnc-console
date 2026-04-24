import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Input, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../../../../components/PageDetailSection';
import {
  fetchRancherClusterK8sList,
  type RancherK8sListKind,
} from '../../../../../../../services/rancherClusterApi';

const { Text } = Typography;

const KIND_TITLE: Record<RancherK8sListKind, string> = {
  services: 'Service',
  ingresses: 'Ingress',
  persistentvolumes: 'PersistentVolume',
  persistentvolumeclaims: 'PersistentVolumeClaim',
  storageclasses: 'StorageClass',
  networkpolicies: 'NetworkPolicy',
  configmaps: 'ConfigMap',
  secrets: 'Secret',
  catalogapps: '已装应用 (catalog.cattle.io)',
};

function columnsFor(kind: RancherK8sListKind): ColumnsType<Record<string, unknown>> {
  const ns = (title = '命名空间') => ({
    title,
    dataIndex: 'namespace',
    key: 'namespace',
    width: 160,
    ellipsis: true,
  });
  const name = { title: '名称', dataIndex: 'name', key: 'name', ellipsis: true };
  const created = {
    title: '创建时间',
    dataIndex: 'created',
    key: 'created',
    width: 200,
    ellipsis: true,
  };
  switch (kind) {
    case 'services':
      return [
        ns(),
        name,
        { title: '类型', dataIndex: 'type', key: 'type', width: 100 },
        { title: 'Cluster IP', dataIndex: 'clusterIP', key: 'clusterIP', width: 140, ellipsis: true },
        created,
      ];
    case 'ingresses':
      return [ns(), name, { title: '规则/主机', dataIndex: 'hosts', key: 'hosts', ellipsis: true }, created];
    case 'persistentvolumes':
      return [
        { title: '名称', dataIndex: 'name', key: 'name', ellipsis: true },
        { title: '容量', dataIndex: 'capacity', key: 'capacity', width: 100 },
        { title: '状态', dataIndex: 'state', key: 'state', width: 100 },
        created,
      ];
    case 'persistentvolumeclaims':
      return [
        ns(),
        name,
        { title: '状态', dataIndex: 'status', key: 'status', width: 100 },
        { title: '卷', dataIndex: 'volume', key: 'volume', ellipsis: true },
        created,
      ];
    case 'storageclasses':
      return [
        { title: '名称', dataIndex: 'name', key: 'name', ellipsis: true },
        { title: 'Provisioner', dataIndex: 'provisioner', key: 'provisioner', ellipsis: true },
        { title: '默认', dataIndex: 'default', key: 'default', width: 64 },
        created,
      ];
    case 'networkpolicies':
      return [ns(), name, created];
    case 'configmaps':
      return [ns(), name, created];
    case 'secrets':
      return [ns(), name, { title: '类型', dataIndex: 'type', key: 'type', width: 120, ellipsis: true }, created];
    case 'catalogapps':
      return [ns(), name, { title: '状态', dataIndex: 'state', key: 'state', width: 120, ellipsis: true }, created];
    default:
      return [ns(), name, created];
  }
}

type Props = {
  poolId: string;
  clusterId: string;
  listKind: RancherK8sListKind;
};

const RancherK8sListPanel: React.FC<Props> = ({ poolId, clusterId, listKind }) => {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');

  const load = useCallback(async () => {
    if (!poolId || !clusterId) return;
    setLoading(true);
    setErr(null);
    try {
      const data = await fetchRancherClusterK8sList(poolId, clusterId, listKind);
      setRows(data);
    } catch (e: any) {
      setErr(e?.message || '加载失败');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [poolId, clusterId, listKind]);

  useEffect(() => {
    void load();
  }, [load]);

  const kw = keyword.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!kw) return rows;
    return rows.filter((r) => {
      const s = [r.namespace, r.name, r.hosts, r.state, r.status, r.type, r.provisioner]
        .filter(Boolean)
        .map((x) => String(x).toLowerCase());
      return s.some((p) => p.includes(kw));
    });
  }, [rows, kw]);

  const cols = useMemo(() => columnsFor(listKind), [listKind]);

  if (!poolId || !clusterId) {
    return <Alert type="warning" message="缺少资源池或集群参数" showIcon />;
  }

  return (
    <PageDetailSection asCard={false}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
        <Text type="secondary" style={{ fontSize: 13 }}>
          {KIND_TITLE[listKind] ?? listKind}（Rancher Steve 代理，只读展示）
        </Text>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Input
            allowClear
            placeholder="搜索"
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            className="toolbar-search"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            style={{ width: 200 }}
          />
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
          style={{ marginBottom: 12 }}
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
        scroll={{ x: 'max-content' }}
      />
    </PageDetailSection>
  );
};

export default RancherK8sListPanel;
