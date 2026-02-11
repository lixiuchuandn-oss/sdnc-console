import React, { useMemo, useState } from 'react';
import { Table, Button, message, Input, Modal } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import IPPoolCreateModal from '../modals/IPPoolCreateModal';
import HarvesterResourceDrawer from '../components/HarvesterResourceDrawer';
import { deleteHarvesterIpPool } from '../../../../services/harvesterApi';

interface Props {
  cloudId: string;
  ippools: any[];
  loading: boolean;
  onRefresh?: (force?: boolean) => void;
}

const IPPoolsSection: React.FC<Props> = ({ cloudId, ippools, loading, onRefresh }) => {
  const [keyword, setKeyword] = useState<string>('');
  const [createVisible, setCreateVisible] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState('detail');
  const [selectedRecord, setSelectedRecord] = useState<any>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  
  const dataSource = useMemo(() => {
    return (ippools || []).map((pool: any) => {
      const raw = pool.rawData || pool;
      
      const ranges = (raw.spec?.ranges || []).map((r: any) => `${r.start}-${r.end}`).join(', ');
      const cidrs = (raw.spec?.cidrs || []).join(', ');

      return {
        key: raw.metadata?.uid || pool.id,
        name: raw.metadata?.name || pool.name,
        namespace: raw.metadata?.namespace || pool.namespace || '-',
        ranges: ranges || cidrs || '-',
        selector: raw.spec?.selector ? JSON.stringify(raw.spec.selector) : '-',
        creationTimestamp: raw.metadata?.creationTimestamp || pool.createdAt,
        raw,
      };
    });
  }, [ippools]);

  const filteredData = useMemo(() => {
    let d = dataSource;
    if (keyword) {
      const k = keyword.toLowerCase();
      d = d.filter((x: any) => x.name.toLowerCase().includes(k) || (x.namespace && x.namespace.toLowerCase().includes(k)));
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
      content: `确定要删除地址池 ${record.name} 吗？此操作不可恢复。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await deleteHarvesterIpPool(cloudId, record.name);
          message.success('删除成功');
          onRefresh?.(true);
        } catch (e: any) {
          const errMsg = e.message || '';
          if (errMsg.includes("can't delete pool before releasing all the allocated IP")) {
            Modal.error({
              title: '删除失败',
              content: (
                <div>
                  <p>无法删除该地址池，因为其中仍有已分配的 IP 地址。</p>
                  <p>请先删除使用该地址池的 LoadBalancer 或其他服务，释放所有 IP 后再试。</p>
                  <div style={{ marginTop: 8, color: '#999', fontSize: 12, wordBreak: 'break-all' }}>
                    原始错误: {errMsg}
                  </div>
                </div>
              ),
            });
          } else {
            message.error(errMsg || '删除失败');
          }
        }
      }
    });
  };

  const handleBatchDelete = () => {
    Modal.confirm({
      title: '确认批量删除',
      content: `确定要删除选中的 ${selectedRowKeys.length} 个地址池吗？此操作不可恢复。`,
      okText: '批量删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          const promises = selectedRowKeys.map(key => {
            const item = dataSource.find(d => d.key === key);
            if (item) {
              return deleteHarvesterIpPool(cloudId, item.name);
            }
            return Promise.resolve();
          });
          
          await Promise.all(promises);
          message.success('批量删除成功');
          setSelectedRowKeys([]);
          onRefresh?.(true);
        } catch (e: any) {
           const errMsg = e.message || '';
           if (errMsg.includes("can't delete pool before releasing all the allocated IP")) {
             Modal.error({
               title: '部分删除失败',
               content: (
                 <div>
                   <p>无法删除部分地址池，因为其中仍有已分配的 IP 地址。</p>
                   <p>请先删除使用该地址池的 LoadBalancer 或其他服务，释放所有 IP 后再试。</p>
                   <div style={{ marginTop: 8, color: '#999', fontSize: 12, wordBreak: 'break-all' }}>
                     原始错误: {errMsg}
                   </div>
                 </div>
               ),
             });
           } else {
             message.error(errMsg || '部分删除失败');
           }
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
    { title: 'IP 范围/CIDR', dataIndex: 'ranges', key: 'ranges', width: 250 },
    { title: '选择器', dataIndex: 'selector', key: 'selector', width: 200, ellipsis: true },
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
        <>
          {selectedRowKeys.length > 0 && (
            <Button danger onClick={handleBatchDelete}>批量删除</Button>
          )}
          <Button type="primary" onClick={() => setCreateVisible(true)}>创建</Button>
          <Button icon={<ReloadOutlined />} onClick={() => onRefresh?.(true)} loading={loading}></Button>
        </>
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
      <IPPoolCreateModal
        open={createVisible}
        cloudId={cloudId}
        onClose={() => setCreateVisible(false)}
        onSuccess={() => onRefresh?.(true)}
      />

      <HarvesterResourceDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        resourceType="IPPool"
        record={selectedRecord}
        activeTab={drawerTab}
        onTabChange={setDrawerTab}
        cloudId={cloudId}
      />
    </PageDetailSection>
  );
};

export default IPPoolsSection;
