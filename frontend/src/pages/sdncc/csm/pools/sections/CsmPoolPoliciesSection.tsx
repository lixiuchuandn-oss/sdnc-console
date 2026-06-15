import React, { useMemo, useState } from 'react';
import { Tag, Input, Modal, message, Table } from 'antd';
import { SearchOutlined, PlusOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../../components/ResourceActionsDropdown';
import { csmListPagination, csmStdTableLayoutProps } from '../utils/csmListTableProps';

type Props = { cloudId: string };

/** 池级阻断策略；演示数据，接入时按 cloudId 请求 CSM 接口。 */
const CsmPoolPoliciesSection: React.FC<Props> = ({ cloudId: _cloudId }) => {
  const [searchText, setSearchText] = useState('');

  type PolicyRow = {
    id: string;
    name: string;
    priority: number;
    sourceZone: string;
    destZone: string;
    sourceIp: string;
    destIp: string;
    serviceChain: string;
    protocol: string;
    port: string;
    status: 'active' | 'inactive';
    description: string;
  };

  const mockData: PolicyRow[] = useMemo(
    () => [
      {
        id: '2',
        name: 'Block-Malicious',
        priority: 10,
        sourceZone: 'Untrust',
        destZone: 'Trust',
        sourceIp: '10.0.0.5',
        destIp: 'Any',
        serviceChain: '-',
        protocol: 'Any',
        port: 'Any',
        status: 'active',
        description: 'Block known malicious IP',
      },
    ],
    [],
  );

  const filteredData = useMemo(
    () => mockData.filter((item) => item.name.toLowerCase().includes(searchText.toLowerCase())),
    [mockData, searchText],
  );

  const columns: any = [
    { title: '策略名称', dataIndex: 'name', key: 'name' },
    {
      title: '优先级',
      dataIndex: 'priority',
      key: 'priority',
      sorter: (a: PolicyRow, b: PolicyRow) => a.priority - b.priority,
    },
    { title: '源 CSM 安全域', dataIndex: 'sourceZone', key: 'sourceZone' },
    { title: '目的 CSM 安全域', dataIndex: 'destZone', key: 'destZone' },
    { title: '源IP', dataIndex: 'sourceIp', key: 'sourceIp' },
    { title: '目的IP', dataIndex: 'destIp', key: 'destIp' },
    { title: '服务链', dataIndex: 'serviceChain', key: 'serviceChain' },
    { title: '协议', dataIndex: 'protocol', key: 'protocol' },
    { title: '端口', dataIndex: 'port', key: 'port' },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => (
        <Tag color={status === 'active' ? 'success' : 'default'}>
          {status === 'active' ? '已激活' : '未激活'}
        </Tag>
      ),
    },
    { title: '描述', dataIndex: 'description', key: 'description' },
    {
      title: '操作',
      key: 'action',
      fixed: 'right' as 'right',
      width: 120,
      render: (_: any, record: PolicyRow) => (
        <ResourceActionsDropdown
          items={[
            { key: 'edit', label: '编辑' },
            { type: 'divider' },
            { key: 'delete', label: '删除', danger: true },
          ]}
          onClick={({ key }) => {
            if (key === 'edit') message.info(`编辑策略: ${record.name}`);
            if (key === 'delete') {
              Modal.confirm({
                title: '删除策略',
                content: `确定删除「${record.name}」吗？`,
                okText: '删除',
                okType: 'danger' as 'danger',
                cancelText: '取消',
                onOk: () => message.info('删除流程待接入后端'),
              });
            }
          }}
          buttonProps={{ className: 'row-actions-trigger', style: { margin: 0 } }}
        />
      ),
    },
  ];

  return (
    <PageDetailSection
      asCard={false}
      showHeaderTitle
      title="阻断策略"
      titleLevel={5}
      toolbarLeft={
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Input
            allowClear
            placeholder="策略名称"
            className="toolbar-search"
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
          <button
            type="button"
            className="toolbar-reset-btn"
            onClick={() => setSearchText('')}
          >
            重置
          </button>
        </div>
      }
      primaryAction={{
        label: (
          <>
            <PlusOutlined /> 新建策略
          </>
        ),
        onClick: () => {
          message.info('新建策略功能待开发');
        },
      }}
      onRefresh={() => message.info('刷新待接入后端')}
    >
      <Table
        {...csmStdTableLayoutProps}
        rowKey="id"
        columns={columns}
        dataSource={filteredData}
        pagination={csmListPagination}
        className="vr-table std-table"
      />
    </PageDetailSection>
  );
};

export default CsmPoolPoliciesSection;
