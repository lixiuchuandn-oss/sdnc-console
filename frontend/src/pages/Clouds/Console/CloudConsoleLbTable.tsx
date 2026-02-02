import React, { useState, useMemo } from 'react';
import { Table, Button, Space, Modal, Input, Tag } from 'antd';
import { FileTextOutlined } from '@ant-design/icons';
import SharedToolbar from '../../../components/SharedToolbar';
import { DEFAULT_PAGINATION_CONFIG } from '../../../constants/pagination';

interface CloudConsoleLbTableProps {
  dataSource: any[];
  loading?: boolean;
  onRefresh?: () => void;
}

const LB_COLUMNS_CONFIG = [
  { label: '名称', value: 'name', disabled: true },
  { label: '命名空间', value: 'namespace' },
  { label: 'IP地址', value: 'address' },
  { label: '类型', value: 'type' },
  { label: '监听器', value: 'listeners' },
  { label: '后端工作负载', value: 'workloads' },
  { label: '创建时间', value: 'createdAt' },
  { label: '操作', value: 'actions', disabled: true }
];

const CloudConsoleLbTable: React.FC<CloudConsoleLbTableProps> = ({ 
  dataSource = [], 
  loading = false, 
  onRefresh 
}) => {
  const [searchText, setSearchText] = useState('');
  const [visibleColumns, setVisibleColumns] = useState<string[]>(LB_COLUMNS_CONFIG.map(c => c.value));
  
  // JSON View Modal
  const [jsonModalVisible, setJsonModalVisible] = useState(false);
  const [currentJson, setCurrentJson] = useState<any>(null);

  const filteredData = useMemo(() => {
    if (!searchText) return dataSource;
    const lower = searchText.toLowerCase();
    return dataSource.filter(item => 
      item?.metadata?.name?.toLowerCase().includes(lower) ||
      item?.status?.address?.toLowerCase().includes(lower)
    );
  }, [dataSource, searchText]);

  const columns = [
    {
      title: '名称',
      key: 'name',
      render: (_: any, r: any) => <span style={{ fontWeight: 500 }}>{r.metadata?.name}</span>
    },
    {
      title: '命名空间',
      key: 'namespace',
      render: (_: any, r: any) => r.metadata?.namespace || '-'
    },
    {
      title: 'IP地址',
      key: 'address',
      render: (_: any, r: any) => <Tag color="blue">{r.status?.address || '-'}</Tag>
    },
    {
      title: '类型',
      key: 'type',
      render: (_: any, r: any) => <Tag>{r.spec?.ipam || '-'}</Tag>
    },
    {
      title: '监听器',
      key: 'listeners',
      render: (_: any, r: any) => {
        const listeners = r.spec?.listeners || [];
        if (!listeners.length) return '-';
        return (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {listeners.map((p: any, idx: number) => (
              <Tag key={idx} style={{ margin: 0 }}>
                {p.port}/{p.protocol} -&gt; {p.backendPort}
              </Tag>
            ))}
          </div>
        );
      }
    },
    {
      title: '后端工作负载',
      key: 'workloads',
      render: (_: any, r: any) => {
        const workloads = r.spec?.workloadIds || [];
        if (!workloads.length) return '-';
        return (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {workloads.map((s: string, idx: number) => (
              <Tag key={idx} color="cyan" style={{ margin: 0 }}>{s}</Tag>
            ))}
          </div>
        );
      }
    },
    {
      title: '创建时间',
      key: 'createdAt',
      render: (_: any, r: any) => {
        const time = r.metadata?.creationTimestamp;
        return time ? new Date(time).toLocaleString() : '-';
      }
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: any, r: any) => (
        <Space>
          <Button 
            type="link" 
            size="small" 
            icon={<FileTextOutlined />}
            onClick={() => {
              setCurrentJson(r);
              setJsonModalVisible(true);
            }}
          >
            JSON
          </Button>
        </Space>
      )
    }
  ];

  return (
    <div>
      <SharedToolbar
        left={
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <span style={{ fontSize: '14px', color: 'rgba(0,0,0,0.88)', marginRight: '8px' }}>搜索:</span>
            <Input
              placeholder="搜索名称或IP"
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              style={{ width: 260 }}
              allowClear
            />
          </div>
        }
        onRefresh={onRefresh}
        refreshLoading={loading}
        columnsConfig={{
          value: visibleColumns,
          options: LB_COLUMNS_CONFIG,
          onChange: setVisibleColumns
        }}
      />

      <Table 
        rowKey={r => r.metadata?.uid || r.metadata?.name}
        columns={columns.filter(c => visibleColumns.includes(c.key as string))}
        dataSource={filteredData}
        loading={loading}
        pagination={DEFAULT_PAGINATION_CONFIG}
        scroll={{ x: 'max-content' }}
      />

      <Modal
        title="资源 JSON 数据"
        open={jsonModalVisible}
        onCancel={() => setJsonModalVisible(false)}
        footer={null}
        width={800}
        bodyStyle={{ maxHeight: '70vh', overflow: 'auto' }}
      >
        <pre style={{ maxHeight: '60vh', overflow: 'auto', backgroundColor: '#f5f5f5', padding: 12, borderRadius: 4 }}>
          {JSON.stringify(currentJson, null, 2)}
        </pre>
      </Modal>
    </div>
  );
};

export default CloudConsoleLbTable;
