import React, { useState, useMemo } from 'react';
import { Table, Button, Space, Modal, Input, Tag, Tooltip } from 'antd';
import { FileTextOutlined, ReloadOutlined } from '@ant-design/icons';
import SharedToolbar from '../../../components/SharedToolbar';
import { DEFAULT_PAGINATION_CONFIG } from '../../../constants/pagination';

interface CloudConsoleNadTableProps {
  dataSource: any[];
  loading?: boolean;
  onRefresh?: () => void;
}

const NAD_COLUMNS_CONFIG = [
  { label: '网络名称', value: 'name', disabled: true },
  { label: '命名空间', value: 'namespace' },
  { label: 'VLAN', value: 'vlan' },
  { label: 'IPAM类型', value: 'ipam' },
  { label: '混杂模式', value: 'promisc' },
  { label: '网桥信息', value: 'bridge' },
  { label: 'CNI版本', value: 'cni' },
  { label: '操作', value: 'actions', disabled: true }
];

const CloudConsoleNadTable: React.FC<CloudConsoleNadTableProps> = ({ dataSource = [], loading = false, onRefresh }) => {
  const [searchText, setSearchText] = useState('');
  const [visibleColumns, setVisibleColumns] = useState<string[]>(NAD_COLUMNS_CONFIG.map(c => c.value));
  
  // JSON View Modal
  const [jsonModalVisible, setJsonModalVisible] = useState(false);
  const [currentJson, setCurrentJson] = useState<any>(null);

  const processedData = useMemo(() => {
    return dataSource.map(item => {
        // Robust extraction of name and namespace
        // Handle both flattened backend response and raw K8s/Harvester object
        const name = item?.metadata?.name || item?.name || '';
        const namespace = item?.metadata?.namespace || item?.namespace || '';

        // Robust extraction of config
        // Check spec.config (K8s standard), item.config (Backend flattened), or direct properties
        let config: any = {};
        let rawConfig = item?.spec?.config || item?.config;

        try {
            if (rawConfig) {
                if (typeof rawConfig === 'string') {
                    config = JSON.parse(rawConfig);
                } else if (typeof rawConfig === 'object') {
                    config = rawConfig;
                }
            }
        } catch (e) {
            console.warn('Failed to parse NAD config for', name, e);
        }

        return {
            ...item,
            _config: config,
            _name: name,
            _namespace: namespace,
            _vlan: config?.vlan,
            _ipamType: config?.ipam?.type,
            _promisc: config?.promiscMode,
            _bridge: config?.bridge,
            _type: config?.type,
            _cniVersion: config?.cniVersion
        };
    });
  }, [dataSource]);

  const filteredData = useMemo(() => {
    if (!searchText) return processedData;
    const lower = searchText.toLowerCase();
    return processedData.filter(item => 
      String(item?._name || '').toLowerCase().includes(lower) ||
      String(item?._namespace || '').toLowerCase().includes(lower) ||
      String(item?._vlan || '').includes(lower)
    );
  }, [processedData, searchText]);

  const columns = [
    {
      title: '网络名称',
      key: 'name',
      render: (_: any, r: any) => <span style={{ fontWeight: 500 }}>{r._name || '-'}</span>
    },
    {
      title: '命名空间',
      key: 'namespace',
      render: (_: any, r: any) => r._namespace || '-'
    },
    {
      title: 'VLAN',
      key: 'vlan',
      render: (_: any, r: any) => r._vlan ? <Tag color="blue">{r._vlan}</Tag> : '-'
    },
    {
      title: 'IPAM类型',
      key: 'ipam',
      render: (_: any, r: any) => r._ipamType ? <Tag>{r._ipamType}</Tag> : <Tag style={{color: '#ccc'}}>未配置</Tag>
    },
    {
      title: '混杂模式',
      key: 'promisc',
      render: (_: any, r: any) => r._promisc ? <Tag color="orange">开启</Tag> : '-'
    },
    {
      title: '网桥信息',
      key: 'bridge',
      render: (_: any, r: any) => {
          const br = r._bridge || '-';
          const tp = r._type || '-';
          return <span>{br} <span style={{color: '#999', fontSize: 12}}>({tp})</span></span>;
      }
    },
    {
      title: 'CNI版本',
      key: 'cni',
      render: (_: any, r: any) => r._cniVersion || '-'
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right' as const,
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
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <SharedToolbar
        left={
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <span style={{ fontSize: '14px', color: 'rgba(0,0,0,0.88)', marginRight: '8px' }}>搜索:</span>
            <Input
              placeholder="搜索名称/命名空间/VLAN"
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
          options: NAD_COLUMNS_CONFIG,
          onChange: setVisibleColumns
        }}
      />

      <div style={{ flex: 1, overflow: 'hidden' }}>
        <Table 
          rowKey={r => r?.metadata?.uid || `${r?._namespace}/${r?._name}` || Math.random().toString()}
          columns={columns.filter(c => visibleColumns.includes(c.key as string))}
          dataSource={filteredData}
          loading={loading}
          pagination={DEFAULT_PAGINATION_CONFIG}
          scroll={{ x: 'max-content' }}
        />
      </div>

      <Modal
        title="网络配置详情 (JSON)"
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

export default CloudConsoleNadTable;
