import React, { useEffect, useState, useMemo } from 'react';
import { Table, Button, Space, Modal, Input, Tag } from 'antd';
import { FileTextOutlined } from '@ant-design/icons';
import SharedToolbar from '../../../components/SharedToolbar';
import { DEFAULT_PAGINATION_CONFIG } from '../../../constants/pagination';

interface CloudConsoleImageTableProps {
  dataSource: any[];
  loading?: boolean;
  onRefresh?: () => void;
}

const IMAGE_COLUMNS_CONFIG = [
  { label: '名称', value: 'name', disabled: true },
  { label: '命名空间', value: 'namespace' },
  { label: '显示名称', value: 'displayName' },
  { label: '状态', value: 'status' },
  { label: '进度', value: 'progress' },
  { label: '大小', value: 'size' },
  { label: '创建时间', value: 'createdAt' },
  { label: '操作', value: 'actions', disabled: true }
];

const CloudConsoleImageTable: React.FC<CloudConsoleImageTableProps> = ({ dataSource = [], loading = false, onRefresh }) => {
  const [searchText, setSearchText] = useState('');
  const [visibleColumns, setVisibleColumns] = useState<string[]>(IMAGE_COLUMNS_CONFIG.map(c => c.value));
  
  // JSON View Modal
  const [jsonModalVisible, setJsonModalVisible] = useState(false);
  const [currentJson, setCurrentJson] = useState<any>(null);

  const filteredData = useMemo(() => {
    if (!searchText) return dataSource;
    const lower = searchText.toLowerCase();
    return dataSource.filter(item => 
      item?.metadata?.name?.toLowerCase().includes(lower) ||
      item?.metadata?.namespace?.toLowerCase().includes(lower) ||
      item?.spec?.displayName?.toLowerCase().includes(lower)
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
      title: '显示名称',
      key: 'displayName',
      render: (_: any, r: any) => r.spec?.displayName || '-'
    },
    {
      title: '状态',
      key: 'status',
      render: (_: any, r: any) => {
        const conds = r.status?.conditions || [];
        const initialized = conds.find((c: any) => c.type === 'Initialized');
        const imported = conds.find((c: any) => c.type === 'Imported');
        
        let status = 'Unknown';
        let color = 'default';

        if (imported?.status === 'True') {
            status = 'Ready';
            color = 'success';
        } else if (initialized?.status === 'False') {
            status = 'Failed';
            color = 'error';
        } else if (r.status?.progress !== undefined && r.status?.progress < 100) {
            status = `Downloading (${r.status.progress}%)`;
            color = 'processing';
        }

        return <Tag color={color}>{status}</Tag>;
      }
    },
    {
      title: '进度',
      key: 'progress',
      render: (_: any, r: any) => {
          const p = r.status?.progress;
          return p !== undefined ? `${p}%` : '-';
      }
    },
    {
      title: '大小',
      key: 'size',
      render: (_: any, r: any) => {
          const size = r.status?.size;
          if (!size) return '-';
          const sizeMb = (size / 1024 / 1024).toFixed(0);
          return `${sizeMb} MB`;
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
              placeholder="搜索名称或显示名称"
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
          options: IMAGE_COLUMNS_CONFIG,
          onChange: setVisibleColumns
        }}
      />

      <Table 
        rowKey={r => r.metadata?.uid || `${r.metadata?.namespace}/${r.metadata?.name}`}
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

export default CloudConsoleImageTable;
