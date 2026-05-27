/**
 * 租户列表主视图；逻辑见 `hooks/useTenantsPage.tsx`。
 */
import React, { useState } from 'react';
import { Button, Col, Dropdown, Form, Input, Row, Select, Table } from 'antd';
import { EllipsisOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import PageContainer from '../../../components/PageContainer';
import TenantUpsertModal from '../modals/TenantUpsertModal';
import TenantRepairModal from '../modals/TenantRepairModal';
import { useTenantsPage } from '../hooks/useTenantsPage';

const TenantsWorkspace: React.FC = () => {
  const [repairModalOpen, setRepairModalOpen] = useState(false);
  const {
    loading,
    filteredTenants,
    tenantColumns,
    selectedTenantRowKeys,
    setSelectedTenantRowKeys,
    fetchTenants,
    filterForm,
    handleFilterChange,
    resetFilter,
    tenantUpsertModalOpen,
    editingTenant,
    tenantForm,
    handleTenantSubmit,
    closeTenantUpsertModal,
    handleBatchDeleteTenants,
    openCreateTenantModal,
  } = useTenantsPage();

  return (
    <PageContainer titleLevel={3} asCard={false}>
      <div className="page-toolbar">
        <Form
          className="toolbar-container"
          form={filterForm}
          layout="vertical"
          style={{ rowGap: 12, columnGap: 12, display: 'flex', alignItems: 'flex-end' }}
          onValuesChange={handleFilterChange}
        >
          <Form.Item name="keyword">
            <Input
              className="toolbar-search"
              allowClear
              placeholder="关键字搜索"
              suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            />
          </Form.Item>
          <Form.Item name="hasUsers">
            <Select
              className="toolbar-filter-sm"
              allowClear
              placeholder="是否有用户"
              options={[
                { value: 'yes', label: '有用户' },
                { value: 'no', label: '无用户' },
              ]}
            />
          </Form.Item>
          <button
            type="button"
            className="toolbar-reset-btn"
            onClick={resetFilter}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
          >
            重置
          </button>
        </Form>
        <div className="toolbar-actions">
          <Button type="primary" onClick={openCreateTenantModal}>
            添加租户
          </Button>
          <Button onClick={() => setRepairModalOpen(true)}>
            租户数据修复
          </Button>
          <Dropdown
            menu={{
              items: [
                {
                  key: 'batchDelete',
                  label: '批量删除',
                  danger: true,
                  disabled: selectedTenantRowKeys.length === 0,
                },
              ],
              onClick: ({ key }) => {
                if (key === 'batchDelete') {
                  handleBatchDeleteTenants();
                }
              },
            }}
          >
            <Button icon={<EllipsisOutlined />} />
          </Dropdown>
          <Button icon={<ReloadOutlined />} onClick={() => fetchTenants(true)} loading={loading} />
        </div>
      </div>

      <Row gutter={[16, 16]}>
        <Col span={24}>
          <Table
            className="std-table"
            bordered={false}
            columns={tenantColumns}
            dataSource={filteredTenants}
            rowKey="id"
            rowSelection={{
              selectedRowKeys: selectedTenantRowKeys,
              onChange: (keys) => setSelectedTenantRowKeys(keys as string[]),
            }}
            pagination={{
              size: 'small',
              showTotal: (total) => `共 ${total} 条`,
            }}
          />
        </Col>
      </Row>

      <TenantUpsertModal
        open={tenantUpsertModalOpen}
        editingTenant={editingTenant}
        form={tenantForm}
        onCancel={closeTenantUpsertModal}
        onFinish={handleTenantSubmit}
      />

      <TenantRepairModal
        open={repairModalOpen}
        onClose={() => setRepairModalOpen(false)}
        onRepaired={() => fetchTenants(true)}
      />
    </PageContainer>
  );
};

export default TenantsWorkspace;
