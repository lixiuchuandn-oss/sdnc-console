/**
 * 租户用户列表主视图；逻辑见 `hooks/useTenantUsersPage.tsx`。
 */
import React, { useEffect } from 'react';
import { Button, Dropdown, Form, Input, Modal, Select, Table, Transfer } from 'antd';
import {
  ReloadOutlined,
  EllipsisOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import PageContainer from '../../../components/PageContainer';
import TableColumnSettingsButton from '../../../components/TableColumnSettingsButton';
import { useTenantUsersPage } from '../hooks/useTenantUsersPage';

const { Option } = Select;

type TenantUsersWorkspaceProps = {
  /** 嵌入系统设置「用户管理」Tab 时不套 PageContainer */
  embedded?: boolean;
  /** 列表总数变化时回调（供 Tab 统计） */
  onTotalChange?: (total: number) => void;
};

const TenantUsersWorkspace: React.FC<TenantUsersWorkspaceProps> = ({
  embedded = false,
  onTotalChange,
}) => {
  const {
    loading,
    users,
    canWriteTenantUsers,
    canWriteRoleAssignments,
    filteredUsers,
    columns,
    baseColumns,
    selectedRowKeys,
    setSelectedRowKeys,
    fetchTenantUsers,
    filterForm,
    handleFilterChange,
    resetFilters,
    tenantOptionsFromUsers,
    availableRoles,
    tenants,
    organizations,
    bulkActionsMenu,
    contextHolder,
    messageContextHolder,
    createModalOpen,
    setCreateModalOpen,
    createForm,
    handleCreateUser,
    handleCreateTenantChange,
    editModalOpen,
    editForm,
    handleEditUser,
    closeEditModal,
    assignRoleModalOpen,
    currentAssignUser,
    roleAssignSelected,
    setRoleAssignSelected,
    handleSaveRoles,
    closeAssignRoleModal,
    closeCreateModal,
  } = useTenantUsersPage();

  useEffect(() => {
    onTotalChange?.(users.length);
  }, [users.length, onTotalChange]);

  const filterToolbar = (
    <Form
      className="toolbar-container"
      form={filterForm}
      layout="vertical"
      onValuesChange={handleFilterChange}
    >
      <Form.Item name="keyword">
        <Input
          className="toolbar-search"
          allowClear
          placeholder="关键字"
          suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
        />
      </Form.Item>
      <Form.Item name="tenant">
        <Select className="toolbar-filter" allowClear placeholder="租户">
          {tenantOptionsFromUsers.map((tenant) => (
            <Option key={tenant.id} value={tenant.id}>
              {tenant.name}
            </Option>
          ))}
        </Select>
      </Form.Item>
      <Form.Item name="role">
        <Select className="toolbar-filter-sm" allowClear placeholder="角色">
          {availableRoles.map((r) => (
            <Option key={r.id} value={r.id}>
              {r.name}
            </Option>
          ))}
        </Select>
      </Form.Item>
      <Form.Item name="status">
        <Select className="toolbar-filter-sm" allowClear placeholder="状态">
          <Option value="active">活跃</Option>
          <Option value="inactive">非活跃</Option>
        </Select>
      </Form.Item>
      <Form.Item>
        <Button type="link" className="toolbar-reset-btn" onClick={resetFilters}>
          重置
        </Button>
      </Form.Item>
    </Form>
  );

  const actionsToolbar = (
    <div className="toolbar-actions">
      {canWriteTenantUsers ? (
        <Button type="primary" onClick={() => setCreateModalOpen(true)}>
              创建租户组织用户
        </Button>
      ) : null}
      {canWriteTenantUsers ? (
        <Dropdown menu={bulkActionsMenu}>
          <Button icon={<EllipsisOutlined />} />
        </Dropdown>
      ) : null}
      <TableColumnSettingsButton allColumns={baseColumns} settingsKey="tenant-users-columns" />
      <Button icon={<ReloadOutlined />} onClick={fetchTenantUsers} loading={loading} />
    </div>
  );

  const tableAndModals = (
    <>
      {contextHolder}
      {messageContextHolder}

      <Table
        className="std-table"
        columns={columns}
        dataSource={filteredUsers}
        rowKey="id"
        loading={loading}
        rowSelection={
          canWriteTenantUsers
            ? {
                selectedRowKeys,
                onChange: setSelectedRowKeys,
              }
            : undefined
        }
        pagination={{
          size: 'small',
          showSizeChanger: true,
          pageSize: 20,
          pageSizeOptions: ['10', '20', '50', '100'],
          showTotal: (total) => `共 ${total} 条`,
        }}
        bordered={false}
        scroll={{ x: 'max-content' }}
      />

      <Modal
        open={createModalOpen}
        title="创建租户组织用户"
        onCancel={closeCreateModal}
        onOk={() => createForm.submit()}
        okText="保存"
        okButtonProps={{ disabled: !canWriteTenantUsers }}
        width={600}
        centered
        destroyOnHidden
        styles={{ body: { maxHeight: '80vh', overflowY: 'auto', overflowX: 'hidden' } }}
      >
        <Form form={createForm} layout="vertical" onFinish={handleCreateUser}>
          <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input placeholder="请输入用户名" />
          </Form.Item>
          <Form.Item name="fullName" label="姓名" rules={[{ required: true, message: '请输入姓名' }]}>
            <Input placeholder="请输入姓名" />
          </Form.Item>
          <Form.Item
            name="email"
            label="邮箱"
            rules={[{ required: true, message: '请输入邮箱' }, { type: 'email', message: '请输入有效的邮箱地址' }]}
          >
            <Input placeholder="请输入邮箱" />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password placeholder="请输入密码" />
          </Form.Item>
          <Form.Item name="tenantId" label="所属租户" rules={[{ required: true, message: '请选择所属租户' }]}>
            <Select placeholder="选择租户" onChange={(v) => handleCreateTenantChange(String(v))}>
              {tenants.map((t) => (
                <Option key={t.id} value={t.id}>
                  {t.name}
                </Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item name="organizationId" label="所属组织" rules={[{ required: true, message: '请选择所属组织' }]}>
            <Select placeholder="选择组织" disabled={!organizations.length}>
              {organizations.map((o) => (
                <Option key={o.id} value={o.id}>
                  {o.name}
                </Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item name="role" label="初始角色" rules={[{ required: true, message: '请选择初始角色' }]}>
            <Select placeholder="选择角色">
              {availableRoles.map((r) => (
                <Option key={r.id} value={r.id}>
                  {r.name}
                </Option>
              ))}
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="编辑租户组织用户"
        open={editModalOpen}
        width={520}
        okText="保存"
        cancelText="取消"
        destroyOnClose
        onCancel={closeEditModal}
        onOk={handleEditUser}
        okButtonProps={{ disabled: !canWriteTenantUsers }}
      >
        <Form form={editForm} layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item name="username" label="用户名">
            <Input disabled />
          </Form.Item>
          <Form.Item name="fullName" label="姓名" rules={[{ required: true, message: '请输入姓名' }]}>
            <Input placeholder="请输入姓名" />
          </Form.Item>
          <Form.Item
            name="email"
            label="邮箱"
            rules={[{ required: true, message: '请输入邮箱' }, { type: 'email', message: '请输入有效的邮箱地址' }]}
          >
            <Input placeholder="请输入邮箱" />
          </Form.Item>
          <Form.Item name="password" label="新密码" extra="留空则不修改密码">
            <Input.Password placeholder="留空则不修改" autoComplete="new-password" />
          </Form.Item>
          <Form.Item name="status" label="状态" rules={[{ required: true, message: '请选择状态' }]}>
            <Select
              options={[
                { value: 'active', label: '活跃' },
                { value: 'inactive', label: '非活跃' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`分配角色 - ${currentAssignUser?.username ?? ''}`}
        open={assignRoleModalOpen}
        onOk={handleSaveRoles}
        onCancel={closeAssignRoleModal}
        okButtonProps={{ disabled: !canWriteRoleAssignments }}
        width={700}
      >
        <Transfer
          dataSource={availableRoles}
          titles={['可选角色', '已选角色']}
          targetKeys={roleAssignSelected}
          onChange={(nextTargetKeys) => setRoleAssignSelected(nextTargetKeys as string[])}
          disabled={!canWriteRoleAssignments}
          render={(item) => item.name}
          rowKey={(item) => item.id}
          listStyle={{ width: 300, height: 400 }}
          showSearch
        />
      </Modal>
    </>
  );

  if (embedded) {
    return (
      <>
        <div className="page-toolbar">
          {filterToolbar}
          {actionsToolbar}
        </div>
        {tableAndModals}
      </>
    );
  }

  return (
    <PageContainer
      titleLevel={3}
      subtitle="管理租户组织用户，并支持按租户、角色与状态筛选"
      asCard={false}
      toolbarLeft={filterToolbar}
      toolbarRight={actionsToolbar}
      actionsSize="middle"
    >
      {tableAndModals}
    </PageContainer>
  );
};

export default TenantUsersWorkspace;
