import React, { useMemo, useState } from 'react';
import { Table, Button, message, Tag, Input, Space, Modal } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import CreateLoadBalancerModal from '../modals/CreateLoadBalancerModal';
import HarvesterResourceDrawer from '../components/HarvesterResourceDrawer';
import { deleteHarvesterService } from '../../../../services/harvesterApi';

interface Props {
  cloudId: string;
  loadBalancers: any[];
  namespaces?: any[];
  loading: boolean;
  onRefresh?: (force?: boolean) => void;
}

const LoadBalancersSection: React.FC<Props> = ({ cloudId, loadBalancers, namespaces = [], loading, onRefresh }) => {
  const [keyword, setKeyword] = useState<string>('');
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState('detail');
  const [selectedRecord, setSelectedRecord] = useState<any>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  
  const dataSource = useMemo(() => {
    return (loadBalancers || []).map((raw: any) => {
      const listeners = (raw.spec?.listeners || []).map((l: any) => `${l.port}:${l.backendPort}/${l.protocol}`).join(', ');

      return {
        key: raw.metadata?.uid,
        name: raw.metadata?.name,
        namespace: raw.metadata?.namespace,
        address: raw.status?.address || '-',
        ipam: raw.spec?.ipam || '-',
        listeners: listeners || '-',
        creationTimestamp: raw.metadata?.creationTimestamp,
        raw,
      };
    });
  }, [loadBalancers]);

  const filteredData = useMemo(() => {
    let d = dataSource;
    if (keyword) {
      const k = keyword.toLowerCase();
      d = d.filter((x: any) => x.name.toLowerCase().includes(k) || x.namespace.toLowerCase().includes(k));
    }
    return d;
  }, [dataSource, keyword]);

  const handleOpenDrawer = (record: any) => {
    if (record?.raw) {
      setSelectedRecord(record.raw);
      setDrawerTab('detail');
      setDrawerOpen(true);
    }
  };

  const handleDelete = (record: any) => {
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除负载均衡 ${record.name} 吗？此操作不可恢复。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await deleteHarvesterService(cloudId, record.namespace, record.name);
          message.success('删除成功');
          onRefresh?.(true);
        } catch (e: any) {
          message.error(e.message || '删除失败');
        }
      }
    });
  };

  const handleBatchDelete = () => {
    Modal.confirm({
      title: '确认批量删除',
      content: `确定要删除选中的 ${selectedRowKeys.length} 个负载均衡吗？此操作不可恢复。`,
      okText: '批量删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          const promises = selectedRowKeys.map(key => {
            const item = dataSource.find(d => d.key === key);
            if (item) {
              return deleteHarvesterService(cloudId, item.namespace, item.name);
            }
            return Promise.resolve();
          });
          
          await Promise.all(promises);
          message.success('批量删除成功');
          setSelectedRowKeys([]);
          onRefresh?.(true);
        } catch (e: any) {
          message.error(e.message || '部分删除失败');
          onRefresh?.(true);
        }
      }
    });
  };

  const rowSelection = {
    selectedRowKeys,
    onChange: (keys: React.Key[]) => setSelectedRowKeys(keys),
  };

  const columns = [
    { 
      title: '名称', 
      dataIndex: 'name', 
      key: 'name', 
      width: 200, 
      render: (t: string, record: any) => (
        <a 
          style={{ fontWeight: 500 }}
          onClick={() => handleOpenDrawer(record)}
        >
          {t}
        </a>
      ) 
    },
    { title: '命名空间', dataIndex: 'namespace', key: 'namespace', width: 150 },
    { title: '地址', dataIndex: 'address', key: 'address', width: 150 },
    { title: 'IPAM', dataIndex: 'ipam', key: 'ipam', width: 100, render: (t: string) => <Tag>{t}</Tag> },
    { title: '监听器', dataIndex: 'listeners', key: 'listeners', width: 250, ellipsis: true },
    { title: '创建时间', dataIndex: 'creationTimestamp', key: 'creationTimestamp', width: 180 },
    {
      title: '操作',
      key: 'action',
      width: 80,
      fixed: 'right' as const,
      render: (_: any, record: any) => (
        <ResourceActionsDropdown 
          items={[
            { 
              key: 'detail', 
              label: '资源详情', 
              onClick: () => handleOpenDrawer(record)
            },
            { type: 'divider' },
            { key: 'delete', label: '删除', danger: true, onClick: () => handleDelete(record) }
          ]}
        />
      ),
    },
  ];

  return (
    <PageDetailSection
      asCard={false}
      toolbarLeft={
        <Input
          className="toolbar-search"
          placeholder="搜索名称或命名空间"
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          allowClear
        />
      }
      toolbarRight={
        <Space>
            {selectedRowKeys.length > 0 && (
              <Button danger onClick={handleBatchDelete}>批量删除</Button>
            )}
            <Button type="primary" onClick={() => setCreateModalOpen(true)}>创建负载均衡</Button>
            <Button icon={<ReloadOutlined />} onClick={() => onRefresh && onRefresh(true)} loading={loading}>刷新</Button>
        </Space>
      }
    >
      <Table
        className="std-table"
        bordered
        dataSource={filteredData}
        columns={columns}
        rowKey="key"
        loading={loading}
        pagination={{size: 'small'}}
        rowSelection={rowSelection}
      />
      
      <CreateLoadBalancerModal
        open={createModalOpen}
        cloudId={cloudId}
        namespaces={namespaces}
        onClose={() => setCreateModalOpen(false)}
        onSuccess={() => onRefresh && onRefresh(true)}
      />

      <HarvesterResourceDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        resourceType="LoadBalancer"
        record={selectedRecord}
        activeTab={drawerTab}
        onTabChange={setDrawerTab}
        cloudId={cloudId}
      />
    </PageDetailSection>
  );
};

export default LoadBalancersSection;
