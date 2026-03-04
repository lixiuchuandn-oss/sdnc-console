/**
 * Harvester - 负载均衡 (LoadBalancer Service) 列表 Section
 * 展示基于 Harvester/Kubernetes Service 的负载均衡资源，
 * 支持：
 * - 关键字过滤（名称 / 命名空间）
 * - 创建负载均衡
 * - 单个/批量删除
 * - 打开 HarvesterResourceDrawer 查看 Service 详情
 */
import React, { useMemo, useState } from 'react';
import { Table, Button, message, Tag, Input, Space, Modal } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import CreateLoadBalancerModal from '../modals/CreateLoadBalancerModal';
import HarvesterResourceDrawer from '../components/HarvesterOpsinfoDrawer';
import { deleteHarvesterService } from '../../../../services/harvesterApi';

/**
 * 组件入参说明
 * - cloudId: 当前云 ID，用于调用删除 Service 的 API
 * - loadBalancers: 负载均衡 Service 列表
 * - namespaces: 命名空间列表，供创建弹窗选择
 * - loading: 外层传入的加载状态
 * - onRefresh: 刷新回调，支持传入 force=true
 */
interface Props {
  cloudId: string;
  loadBalancers: any[];
  namespaces?: any[];
  loading: boolean;
  onRefresh?: (force?: boolean) => void;
}

const LoadBalancersSection: React.FC<Props> = ({ cloudId, loadBalancers, namespaces = [], loading, onRefresh }) => {
  // 工具栏与弹窗状态
  const [keyword, setKeyword] = useState<string>('');
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState('detail');
  const [selectedRecord, setSelectedRecord] = useState<any>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  /**
   * 将 Service 对象转换为表格可直接展示的数据结构
   * - listeners 字段将监听端口列表拼接为 "port:backendPort/protocol" 格式
   */
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

  /**
   * 根据关键字对名称/命名空间进行模糊匹配
   */
  const filteredData = useMemo(() => {
    let d = dataSource;
    if (keyword) {
      const k = keyword.toLowerCase();
      d = d.filter((x: any) => x.name.toLowerCase().includes(k) || x.namespace.toLowerCase().includes(k));
    }
    return d;
  }, [dataSource, keyword]);

  /**
   * 打开 HarvesterResourceDrawer 展示 Service 详情
   */
  const handleOpenDrawer = (record: any) => {
    if (record?.raw) {
      setSelectedRecord(record.raw);
      setDrawerTab('detail');
      setDrawerOpen(true);
    }
  };

  /**
   * 删除单个负载均衡 Service
   */
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

  /**
   * 批量删除选中的负载均衡
   */
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

  // 表格多选配置
  const rowSelection = {
    selectedRowKeys,
    onChange: (keys: React.Key[]) => setSelectedRowKeys(keys),
  };

  /**
   * 表格列定义
   * - 名称列可点击打开详情抽屉
   * - IPAM 列使用 Tag 高亮展示地址分配模式
   */
  const columns = [
    { 
      title: '名称', 
      dataIndex: 'name', 
      key: 'name', 
      width: 200, 
      render: (t: string, record: any) => (
        <span 
          className="cell-link"
          style={{ fontWeight: 500 }}
          onClick={() => handleOpenDrawer(record)}
        >
          {t}
        </span>
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
        pagination={{
          size: 'small',
          showQuickJumper: false,
        }}
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
