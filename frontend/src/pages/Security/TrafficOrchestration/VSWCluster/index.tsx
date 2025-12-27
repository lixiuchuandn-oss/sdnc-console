import React, { useState } from 'react';
import { Table, Button, Badge, Space, Dropdown, MenuProps, Tag, Select, Radio, Input, Form } from 'antd';
import { ReloadOutlined, EllipsisOutlined, PlusOutlined } from '@ant-design/icons';
import PageContainer from '../../../../components/PageContainer';
import type { ColumnsType } from 'antd/es/table';

// Mock Data Types
interface VSWClusterRow {
  id: string;
  name: string;
  poolName: string;
  physicalMachineCount: number;
  vswInstanceCount: number;
  serviceStatus: 'final' | 'sub-healthy' | 'unavailable';
}

interface VSWInstanceRow {
  id: string;
  name: string;
  clusterName: string;
  physicalMachineIp: string;
  status: 'running' | 'stopped' | 'error' | 'undeployed';
}

const VSWCluster: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'cluster' | 'instance'>('cluster');

  // Mock Data
  const clusterData: VSWClusterRow[] = [
    { id: '1', name: 'Cluster-A', poolName: 'ResourcePool-1', physicalMachineCount: 10, vswInstanceCount: 9, serviceStatus: 'sub-healthy' },
    { id: '2', name: 'Cluster-B', poolName: 'ResourcePool-2', physicalMachineCount: 5, vswInstanceCount: 5, serviceStatus: 'final' },
    { id: '3', name: 'Cluster-C', poolName: 'ResourcePool-3', physicalMachineCount: 3, vswInstanceCount: 0, serviceStatus: 'unavailable' },
  ];

  const instanceData: VSWInstanceRow[] = [
    { id: '1', name: 'VSW-01', clusterName: 'Cluster-A', physicalMachineIp: '192.168.1.101', status: 'running' },
    { id: '2', name: 'VSW-02', clusterName: 'Cluster-A', physicalMachineIp: '192.168.1.102', status: 'running' },
    { id: '3', name: 'VSW-03', clusterName: 'Cluster-B', physicalMachineIp: '192.168.2.101', status: 'error' },
    { id: '4', name: '-', clusterName: 'Cluster-A', physicalMachineIp: '192.168.1.103', status: 'undeployed' },
  ];

  // Cluster Columns
  const clusterColumns: ColumnsType<VSWClusterRow> = [
    { title: '集群名称', dataIndex: 'name', key: 'name' },
    { title: '资源池', dataIndex: 'poolName', key: 'poolName' },
    { title: '物理机数量', dataIndex: 'physicalMachineCount', key: 'physicalMachineCount' },
    { title: 'VSW实例数量', dataIndex: 'vswInstanceCount', key: 'vswInstanceCount' },
    {
      title: '服务状态',
      dataIndex: 'serviceStatus',
      key: 'serviceStatus',
      render: (status) => {
        const statusMap = {
          'final': { color: 'success', text: '终态' },
          'sub-healthy': { color: 'warning', text: '亚健康' },
          'unavailable': { color: 'error', text: '不可用' },
        };
        const { color, text } = statusMap[status as keyof typeof statusMap] || { color: 'default', text: '未知' };
        return <Badge status={color as any} text={text} />;
      },
    },
    {
      title: '操作',
      key: 'action',
      render: (_, record) => (
        <Space size="middle">
          <a onClick={() => setActiveTab('instance')}>查看物理机部署</a>
          <a>添加资源池</a>
        </Space>
      ),
    },
  ];

  // Instance Columns
  const instanceColumns: ColumnsType<VSWInstanceRow> = [
    { title: '物理机IP', dataIndex: 'physicalMachineIp', key: 'physicalMachineIp' },
    { title: '所属集群', dataIndex: 'clusterName', key: 'clusterName' },
    { title: 'VSW实例名称', dataIndex: 'name', key: 'name' },
    {
      title: '部署状态',
      dataIndex: 'status',
      key: 'status',
      render: (status) => {
        const statusMap = {
          'running': { color: 'success', text: '运行中' },
          'stopped': { color: 'default', text: '已停止' },
          'error': { color: 'error', text: '异常' },
          'undeployed': { color: 'default', text: '未部署' },
        };
        const { color, text } = statusMap[status as keyof typeof statusMap] || { color: 'default', text: '未知' };
        return <Badge status={color as any} text={text} />;
      },
    },
    {
      title: '操作',
      key: 'action',
      render: (_, record) => (
        <Space size="middle">
          {record.status === 'undeployed' ? (
             <a>部署VSW</a>
          ) : (
             <>
               <a>重新部署</a>
               <a style={{ color: 'red' }}>删除</a>
             </>
          )}
        </Space>
      ),
    },
  ];

  return (
    <PageContainer<any>
      title="VSW 集群管理"
      subtitle="管理云安全资源池与 VSW（Virtual Switch）实例，提供物理机部署视图与集群健康状态监控，支持资源池的弹性扩缩容与网络流量的精细化调度。"
      tabList={[
        { key: 'cluster', tab: '集群列表视图' },
        { key: 'instance', tab: '物理机部署视图' },
      ]}
      tabActiveKey={activeTab}
      onTabChange={(key) => setActiveTab(key as any)}
      toolbarLeft={
        <Form layout="vertical" style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
          {activeTab === 'instance' && (
            <>
              <Form.Item label="所属集群" style={{ marginBottom: 0 }}>
                <Select 
                  style={{ width: 160 }} 
                  placeholder="选择集群" 
                  allowClear
                  options={[{ label: 'Cluster-A', value: 'Cluster-A' }]} 
                />
              </Form.Item>
              <Form.Item label="物理机" style={{ marginBottom: 0 }}>
                <Select 
                  style={{ width: 160 }} 
                  placeholder="选择物理机" 
                  allowClear
                  options={[{ label: '全部物理机', value: 'all' }]} 
                />
              </Form.Item>
              <Form.Item label="搜索" style={{ marginBottom: 0 }}>
                <Input placeholder="搜索 VSW 实例..." style={{ width: 200 }} allowClear />
              </Form.Item>
            </>
          )}
          {activeTab === 'cluster' && (
            <>
              <Form.Item label="关键字" style={{ marginBottom: 0 }}>
                <Input placeholder="搜索集群..." style={{ width: 200 }} />
              </Form.Item>
              <Form.Item label="服务状态" style={{ marginBottom: 0 }}>
                 <Select
                   style={{ width: 160 }}
                   placeholder="选择状态"
                   allowClear
                   options={[
                     { label: '终态', value: 'final' },
                     { label: '亚健康', value: 'sub-healthy' },
                     { label: '不可用', value: 'unavailable' },
                   ]}
                 />
              </Form.Item>
            </>
          )}
        </Form>
      }
      primaryAction={{
        text: activeTab === 'cluster' ? '添加云安全资源池' : '部署 VSW',
        onClick: () => {},
      }}
      moreMenuItems={[
        { key: 'refresh', label: '刷新', onClick: () => {} }
      ]}
      tableProps={{
        columns: activeTab === 'cluster' ? clusterColumns : instanceColumns,
        dataSource: activeTab === 'cluster' ? clusterData : instanceData,
        rowKey: "id",
      }}
    />
  );
};

export default VSWCluster;
