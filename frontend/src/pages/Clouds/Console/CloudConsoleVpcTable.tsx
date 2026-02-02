import React, { useState, useMemo } from 'react';
import { Table, Button, Space, Modal, Input, Tag, Tooltip } from 'antd';
import { FileTextOutlined } from '@ant-design/icons';
import SharedToolbar from '../../../components/SharedToolbar';
import { DEFAULT_PAGINATION_CONFIG } from '../../../constants/pagination';

interface CloudConsoleVpcTableProps {
  dataSource: any[];
  subnets: any[];
  loading?: boolean;
  onRefresh?: () => void;
}

const VPC_COLUMNS_CONFIG = [
  { label: '名称', value: 'name', disabled: true },
  { label: 'UID', value: 'uid' },
  { label: '命名空间', value: 'namespace' },
  { label: '状态', value: 'status' },
  { label: '创建时间', value: 'createdAt' },
  { label: '操作', value: 'actions', disabled: true }
];

export const CloudConsoleVpcTable: React.FC<CloudConsoleVpcTableProps> = ({ 
  dataSource = [], 
  subnets = [],
  loading = false, 
  onRefresh 
}) => {
  const [searchText, setSearchText] = useState('');
  const [visibleColumns, setVisibleColumns] = useState<string[]>(VPC_COLUMNS_CONFIG.map(c => c.value));
  
  // JSON View Modal
  const [jsonModalVisible, setJsonModalVisible] = useState(false);
  const [currentJson, setCurrentJson] = useState<any>(null);

  const filteredData = useMemo(() => {
    if (!searchText) return dataSource;
    const lower = searchText.toLowerCase();
    return dataSource.filter(item => 
      item?.metadata?.name?.toLowerCase().includes(lower) ||
      item?.metadata?.uid?.toLowerCase().includes(lower)
    );
  }, [dataSource, searchText]);

  const columns = [
    {
      title: '名称',
      key: 'name',
      render: (_: any, r: any) => <span style={{ fontWeight: 500 }}>{r.metadata?.name}</span>
    },
    {
      title: 'UID',
      key: 'uid',
      render: (_: any, r: any) => <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{r.metadata?.uid}</span>
    },
    {
      title: '命名空间',
      key: 'namespace',
      render: (_: any, r: any) => r.metadata?.namespace || '-'
    },
    {
      title: '状态',
      key: 'status',
      render: (_: any, r: any) => {
        const status = r.status?.phase || 'Unknown';
        const ready = r.status?.conditions?.find((c: any) => c.type === 'Ready')?.status === 'True';
        const available = r.status?.conditions?.find((c: any) => c.type === 'Available')?.status === 'True';
        
        let color = 'default';
        if (ready && available) color = 'success';
        else if (status === 'Bound') color = 'success';
        else if (status === 'Pending') color = 'warning';
        
        return <Tag color={color}>{status}</Tag>;
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

  // 展开行渲染：显示该 VPC 下的子网列表
  const expandedRowRender = (record: any) => {
    const vpcName = record.metadata?.name;
    // 过滤属于当前 VPC 的子网（通过 spec.vpc 或 label 匹配）
    const vpcSubnets = subnets.filter(s => {
        const specVpc = s.spec?.vpc;
        const labelVpc = s.metadata?.labels?.['kube-ovn/vpc'];
        return specVpc === vpcName || labelVpc === vpcName;
    });

    const subnetColumns = [
        {
            title: '子网名称',
            key: 'name',
            render: (_: any, r: any) => <span style={{ fontWeight: 500 }}>{r.metadata?.name}</span>
        },
        {
            title: 'CIDR',
            key: 'cidr',
            render: (_: any, r: any) => <Tag>{r.spec?.cidrBlock || r.spec?.cidr}</Tag>
        },
        {
            title: '网关',
            key: 'gateway',
            render: (_: any, r: any) => r.spec?.gateway || '-'
        },
        {
            title: '协议',
            key: 'protocol',
            render: (_: any, r: any) => r.spec?.protocol || 'IPv4'
        },
        {
            title: '类型',
            key: 'type',
            render: (_: any, r: any) => (
                <Space size={4}>
                    {r.spec?.private && <Tag color="gold">Private</Tag>}
                    {r.spec?.nat && <Tag color="blue">NAT</Tag>}
                    {!r.spec?.private && !r.spec?.nat && <Tag>Standard</Tag>}
                </Space>
            )
        },
        {
            title: '可用IP',
            key: 'ips',
            render: (_: any, r: any) => {
                const available = r.status?.availableIps;
                const total = r.status?.totalIps; // Note: Total IPs might not be directly available in status for all versions
                if (available !== undefined) {
                    return <span>{available} Available</span>
                }
                return '-';
            }
        },
        {
            title: '操作',
            key: 'actions',
            render: (_: any, r: any) => (
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
            )
        }
    ];

    return (
        <div style={{ margin: '0 16px' }}>
            <h4 style={{ marginBottom: 8, color: '#666' }}>关联子网 ({vpcSubnets.length})</h4>
            <Table
                columns={subnetColumns}
                dataSource={vpcSubnets}
                pagination={false}
                rowKey={r => r.metadata?.uid}
                size="small"
            />
        </div>
    );
  };

  return (
    <div>
      <SharedToolbar
        left={
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <span style={{ fontSize: '14px', color: 'rgba(0,0,0,0.88)', marginRight: '8px' }}>搜索:</span>
            <Input
              placeholder="搜索VPC名称或UID"
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
          options: VPC_COLUMNS_CONFIG,
          onChange: setVisibleColumns
        }}
      />

      <Table 
        rowKey={r => r.metadata?.uid || r.metadata?.name}
        columns={columns.filter(c => visibleColumns.includes(c.key as string))}
        dataSource={filteredData}
        loading={loading}
        pagination={DEFAULT_PAGINATION_CONFIG}
        size="middle"
        expandable={{
            expandedRowRender,
            rowExpandable: record => true,
        }}
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
