import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Table, Button, message, Input, Select, Form, Modal, Transfer, Dropdown } from 'antd';
import { ReloadOutlined, UserAddOutlined, DeleteOutlined, SearchOutlined, EllipsisOutlined } from '@ant-design/icons';
import type { MenuProps } from 'antd';
import { ColumnsType } from 'antd/es/table';
import axios from 'axios';
import PageContainer from '../../../components/PageContainer';
import StdFormModal from '../../../components/StdFormModal';
import ResourceActionsDropdown from '../../../components/ResourceActionsDropdown';
import { useTableColumnSettings } from '../../../hooks/useTableColumnSettings';
import TableColumnSettingsButton from '../../../components/TableColumnSettingsButton';
import { getToken } from '../../../utils/tokenStorage';
const { Option } = Select;

interface TenantUser {
  id: string;
  username: string;
  email: string;
  fullName: string;
  role: string;
  status: 'active' | 'inactive';
  createdAt: string;
  tenant: {
    id: string;
    name: string;
    description?: string;
  } | null;
  organization: {
    id: string;
    name: string;
    level: number;
  } | null;
}

interface RBACRole {
  id: string;
  name: string;
  description: string;
  status: 'active' | 'inactive';
  type: 'system' | 'custom';
  scope?: 'system' | 'tenant';  // 角色作用域
}

interface Assignment {
  id: string;
  roleId: string;
  userId: string;
}

interface CreateUserFormValues {
  username: string;
  email: string;
  password: string;
  tenantId: string;
  organizationId?: string;
  role: string;
}

const UserManagement: React.FC = () => {
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<TenantUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [selectedTenant, setSelectedTenant] = useState<string>('');
  const [selectedRole, setSelectedRole] = useState<string>('');
  const [selectedStatus, setSelectedStatus] = useState<string>('');
  
  const [modal, contextHolder] = Modal.useModal();
  const [messageApi, messageContextHolder] = message.useMessage();

  // Batch Operations State
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  // Create User State
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createForm] = Form.useForm();
  const [tenants, setTenants] = useState<Array<{ id: string; name: string }>>([]);
  const [organizations, setOrganizations] = useState<Array<{ id: string; name: string }>>([]);
  
  // Role Assignment State
  const [assignRoleModalOpen, setAssignRoleModalOpen] = useState(false);
  const [currentAssignUser, setCurrentAssignUser] = useState<TenantUser | null>(null);
  const [availableRoles, setAvailableRoles] = useState<RBACRole[]>([]);
  const [roleAssignExisting, setRoleAssignExisting] = useState<Assignment[]>([]);
  const [roleAssignSelected, setRoleAssignSelected] = useState<string[]>([]);

  const [filterForm] = Form.useForm();

  // Fetch Helper
  const apiCall = async (method: string, url: string, data?: any) => {
    const token = getToken();
    return axios({
      method,
      url,
      data,
      headers: { Authorization: `Bearer ${token}` }
    });
  };

  const fetchTenantUsers = async () => {
    try {
      setLoading(true);
      const response = await apiCall('get', '/api/users/tenant-users');
      setUsers(response.data);
      setFilteredUsers(response.data);
      setSelectedRowKeys([]); // Reset selection on refresh
    } catch (error: any) {
      messageApi.error(error.response?.data?.message || '获取用户列表失败');
    } finally {
      setLoading(false);
    }
  };

  const fetchTenants = async () => {
    try {
      const response = await apiCall('get', '/api/tenants');
      setTenants(response.data.tenants || response.data);
    } catch (error) {
      console.error('Failed to fetch tenants', error);
    }
  };

  const fetchOrganizations = async (tenantId: string) => {
    try {
      const response = await apiCall('get', `/api/tenants/${tenantId}/organizations`);
      setOrganizations(response.data);
    } catch (error) {
      console.error('Failed to fetch organizations', error);
      setOrganizations([]);
    }
  };

  const fetchRoles = async () => {
    try {
      const response = await apiCall('get', '/api/system/rbac/roles?limit=1000');
      const raw = response.data;
      const list: RBACRole[] = Array.isArray(raw) ? raw : (Array.isArray(raw?.roles) ? raw.roles : []);
      // 只显示租户级角色（修复逻辑问题：租户用户只能分配租户级角色）
      setAvailableRoles(list.filter(r => 
        r.scope === 'tenant' && 
        String(r.status || 'active') === 'active'
      ));
    } catch (error) {
      console.error('Failed to fetch roles', error);
    }
  };

  useEffect(() => {
    fetchTenantUsers();
    fetchTenants();
    fetchRoles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const availableRolesRef = useRef(availableRoles);
  useEffect(() => {
    availableRolesRef.current = availableRoles;
  }, [availableRoles]);

  const handleFilterChange = (_: any, all: any) => {
    setSearchText(all.keyword || '');
    setSelectedTenant(all.tenant || '');
    setSelectedRole(all.role || '');
    setSelectedStatus(all.status || '');
  };

  useEffect(() => {
    let filtered = users;
    if (searchText) {
      filtered = filtered.filter(user => 
        user.username.toLowerCase().includes(searchText.toLowerCase()) ||
        user.fullName.toLowerCase().includes(searchText.toLowerCase()) ||
        user.email.toLowerCase().includes(searchText.toLowerCase()) ||
        user.tenant?.name.toLowerCase().includes(searchText.toLowerCase()) ||
        user.organization?.name.toLowerCase().includes(searchText.toLowerCase())
      );
    }
    if (selectedTenant) {
      filtered = filtered.filter(user => user.tenant?.id === selectedTenant);
    }
    if (selectedRole) {
      filtered = filtered.filter(user => user.role === selectedRole);
    }
    if (selectedStatus) {
      filtered = filtered.filter(user => user.status === selectedStatus);
    }
    setFilteredUsers(filtered);
  }, [users, searchText, selectedTenant, selectedRole, selectedStatus]);

  const getTenantOptions = () => {
    const tenantList = users.reduce((acc, user) => {
      if (user.tenant && !acc.find(t => t.id === user.tenant!.id)) {
        acc.push(user.tenant);
      }
      return acc;
    }, [] as Array<{ id: string; name: string; description?: string }>);
    return tenantList;
  };

  // Handle Tenant Change in Create Form
  const handleCreateTenantChange = (tenantId: string) => {
    createForm.setFieldsValue({ organizationId: undefined });
    fetchOrganizations(tenantId);
  };

  // Create User
  const handleCreateUser = async (values: CreateUserFormValues) => {
    try {
      if (!values.tenantId || !values.organizationId) {
        messageApi.error('请选择租户和组织');
        return;
      }
      await apiCall('post', `/api/tenants/${values.tenantId}/organizations/${values.organizationId}/users`, values);
      messageApi.success('创建用户成功');
      setCreateModalOpen(false);
      createForm.resetFields();
      fetchTenantUsers();
    } catch (error: any) {
      messageApi.error(error.response?.data?.message || '创建用户失败');
    }
  };

  // Delete User
  const handleDeleteUser = useCallback(async (user: TenantUser) => {
    if (!user.tenant || !user.organization) {
      messageApi.error('用户数据缺失租户或组织信息，无法删除');
      return;
    }
    try {
      await apiCall('delete', `/api/tenants/${user.tenant.id}/organizations/${user.organization.id}/users/${user.id}`);
      messageApi.success('删除用户成功');
      fetchTenantUsers();
    } catch (error: any) {
      messageApi.error(error.response?.data?.message || '删除用户失败');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageApi]);

  // Batch Delete
  const handleBatchDelete = useCallback(() => {
    modal.confirm({
      title: '确认批量删除用户',
      content: `确定要删除选中的 ${selectedRowKeys.length} 个用户吗？删除后无法恢复。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          const deletePromises = selectedRowKeys.map(key => {
            const user = users.find(u => u.id === key);
            if (user && user.tenant && user.organization) {
              return apiCall('delete', `/api/tenants/${user.tenant.id}/organizations/${user.organization.id}/users/${user.id}`);
            }
            return Promise.resolve();
          });
          await Promise.all(deletePromises);
          messageApi.success('批量删除成功');
          fetchTenantUsers();
        } catch (error: any) {
          messageApi.error('批量删除过程中发生错误');
        }
      }
    });
  }, [modal, messageApi, selectedRowKeys, users, fetchTenantUsers]);

  // 批量操作菜单配置
  const bulkActionsMenu: MenuProps = {
    items: [
      { 
        key: 'bulkDelete', 
        label: '批量删除', 
        danger: true, 
        disabled: selectedRowKeys.length === 0,
        onClick: handleBatchDelete
      }
    ]
  };

  // Assign Roles Logic
  const openAssignRoleModal = useCallback(async (user: TenantUser) => {
    setCurrentAssignUser(user);
    setAssignRoleModalOpen(true);
    setRoleAssignExisting([]);
    setRoleAssignSelected([]);
    
    try {
      const res = await apiCall('get', `/api/system/rbac/assignments?userType=tenant&userId=${user.id}`);
      const rawList = Array.isArray((res.data as any)?.assignments) ? (res.data as any).assignments : [];
      const list: Assignment[] = rawList.map((it: any) => ({
        ...it,
        roleId: it.roleId || it.role_id
      }));
      setRoleAssignExisting(list);
      setRoleAssignSelected(list.map(it => it.roleId));
    } catch (error) {
      messageApi.error('获取用户角色失败');
    }
  }, [messageApi]);

  const handleSaveRoles = async () => {
    if (!currentAssignUser) return;
    
    const currentRoleIds = new Set(roleAssignExisting.map(x => x.roleId));
    const needAdd = roleAssignSelected.filter(id => !currentRoleIds.has(id));
    const needRemove = roleAssignExisting.filter(x => !roleAssignSelected.includes(x.roleId));

    try {
      for (const roleId of needAdd) {
        await apiCall('post', '/api/system/rbac/assignments', { 
          roleId, 
          userType: 'tenant', 
          userId: currentAssignUser.id 
        });
      }
      for (const it of needRemove) {
        await apiCall('delete', `/api/system/rbac/assignments/${encodeURIComponent(it.id)}`);
      }
      messageApi.success('角色赋权已保存');
      setAssignRoleModalOpen(false);
      setCurrentAssignUser(null);
    } catch (error) {
      messageApi.error('保存角色赋权失败');
    }
  };

  // 使用 useMemo 稳定列定义引用，避免死锁
  const baseColumns: ColumnsType<TenantUser> = useMemo(() => [
    { title: '姓名', dataIndex: 'fullName', key: 'fullName' },
    { title: '用户名', dataIndex: 'username', key: 'username' },
    { title: '邮箱', dataIndex: 'email', key: 'email' },
    { title: '租户', key: 'tenant.name', render: (_, record) => record.tenant?.name || '-' },
    { title: '租户描述', key: 'tenant.description', render: (_, record) => record.tenant?.description || '-' },
    { title: '组织', key: 'organization.name', render: (_, record) => record.organization?.name || '-' },
    { title: '组织级别', key: 'organization.level', render: (_, record) => {
      const lvl = record.organization?.level;
      const label = lvl === 1 ? '根组织' : lvl === 2 ? '二级' : lvl === 3 ? '三级' : '-';
      const badgeClass = lvl === 1 ? 'std-badge std-badge-info' : lvl === 2 ? 'std-badge std-badge-success' : lvl === 3 ? 'std-badge std-badge-warning' : 'std-badge std-badge-default';
      return <span className={badgeClass}>{label}</span>;
    } },
    {
      title: '角色',
      dataIndex: 'role',
      key: 'role',
      render: (role: string) => {
        const matchedRole = availableRolesRef.current.find(r => r.id === role || r.name === role);
        const roleName = matchedRole ? matchedRole.name : role;
        const isSystem = matchedRole?.type === 'system';
        const badgeClass = isSystem ? 'std-badge std-badge-info' : 'std-badge std-badge-success';
        return <span className={badgeClass}>{roleName}</span>;
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => (
        <span className={status === 'active' ? 'std-badge std-badge-success' : 'std-badge std-badge-error'}>{status === 'active' ? '活跃' : '非活跃'}</span>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (date: string) => <span className="std-time">{new Date(date).toLocaleString()}</span>,
    },
    {
      title: '操作',
      key: 'action',
      fixed: 'right',
      render: (_, record) => (
        <ResourceActionsDropdown
          items={[
            { key: 'assign', label: '分配角色' },
            { key: 'delete', label: '删除', danger: true }
          ]}
          onClick={({ key }) => {
            if (key === 'assign') openAssignRoleModal(record);
            if (key === 'delete') {
              modal.confirm({
                title: '确认删除用户',
                content: `确定要删除用户 "${record.username}" 吗？此操作无法撤销。`,
                okText: '删除',
                okType: 'danger',
                cancelText: '取消',
                onOk: () => handleDeleteUser(record),
              });
            }
          }}
        />
      )
    }
  ], [modal, availableRolesRef, openAssignRoleModal, handleDeleteUser]);

  // 使用新的 hook 管理列设置
  const { displayColumns: columns } = useTableColumnSettings(baseColumns, 'tenant-users-columns');

  return (
    <PageContainer
      titleLevel={3}
      subtitle="管理租户用户，并支持按租户、角色与状态筛选"
      asCard={false}
      toolbarLeft={(
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
              {getTenantOptions().map(tenant=>(<Option key={tenant.id} value={tenant.id}>{tenant.name}</Option>))}
            </Select>
          </Form.Item>
          <Form.Item name="role">
            <Select className="toolbar-filter-sm" allowClear placeholder="角色">
              {availableRoles.map(r => <Option key={r.id} value={r.id}>{r.name}</Option>)}
            </Select>
          </Form.Item>
          <Form.Item name="status">
            <Select className="toolbar-filter-sm" allowClear placeholder="状态">
              <Option value="active">活跃</Option>
              <Option value="inactive">非活跃</Option>
            </Select>
          </Form.Item>
          <Form.Item>
            <Button 
              type="link" 
              className="toolbar-reset-btn" 
              onClick={()=>{
                filterForm.resetFields(); 
                setSearchText(''); 
                setSelectedTenant(''); 
                setSelectedRole(''); 
                setSelectedStatus('');
              }}
            >
              重置
            </Button>
          </Form.Item>
        </Form>
      )}
      toolbarRight={(
        <div className="toolbar-actions">
          <Button type="primary" icon={<UserAddOutlined />} onClick={() => setCreateModalOpen(true)}>
            创建组织用户
          </Button>
          <Dropdown menu={bulkActionsMenu}>
            <Button icon={<EllipsisOutlined />} />
          </Dropdown>
          <TableColumnSettingsButton
            allColumns={baseColumns}
            settingsKey="tenant-users-columns"
          />
          <Button icon={<ReloadOutlined />} onClick={fetchTenantUsers} loading={loading} />
        </div>
      )}
      actionsSize="middle"
    >
      {contextHolder}
      {messageContextHolder}

      <Table
        className="std-table"
        columns={columns}
        dataSource={filteredUsers}
        rowKey="id"
        loading={loading}
        rowSelection={{
          selectedRowKeys,
          onChange: setSelectedRowKeys,
        }}
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

      <StdFormModal
        open={createModalOpen}
        title="创建组织用户"
        onCancel={() => setCreateModalOpen(false)}
        onFinish={handleCreateUser}
        form={createForm}
      >
        <Form.Item
          name="username"
          label="用户名"
          rules={[{ required: true, message: '请输入用户名' }]}
        >
          <Input placeholder="请输入用户名" />
        </Form.Item>
        <Form.Item
          name="fullName"
          label="姓名"
          rules={[{ required: true, message: '请输入姓名' }]}
        >
          <Input placeholder="请输入姓名" />
        </Form.Item>
        <Form.Item
          name="email"
          label="邮箱"
          rules={[{ required: true, message: '请输入邮箱' }, { type: 'email', message: '请输入有效的邮箱地址' }]}
        >
          <Input placeholder="请输入邮箱" />
        </Form.Item>
        <Form.Item
          name="password"
          label="密码"
          rules={[{ required: true, message: '请输入密码' }]}
        >
          <Input.Password placeholder="请输入密码" />
        </Form.Item>
        <Form.Item
          name="tenantId"
          label="所属租户"
          rules={[{ required: true, message: '请选择所属租户' }]}
        >
          <Select placeholder="选择租户" onChange={handleCreateTenantChange}>
            {tenants.map(t => <Option key={t.id} value={t.id}>{t.name}</Option>)}
          </Select>
        </Form.Item>
        <Form.Item
          name="organizationId"
          label="所属组织"
          rules={[{ required: true, message: '请选择所属组织' }]}
        >
          <Select placeholder="选择组织" disabled={!organizations.length}>
            {organizations.map(o => <Option key={o.id} value={o.id}>{o.name}</Option>)}
          </Select>
        </Form.Item>
        <Form.Item
          name="role"
          label="初始角色"
          rules={[{ required: true, message: '请选择初始角色' }]}
        >
          <Select placeholder="选择角色">
            {availableRoles.map(r => <Option key={r.id} value={r.id}>{r.name}</Option>)}
          </Select>
        </Form.Item>
      </StdFormModal>

      <Modal
        title={`分配角色 - ${currentAssignUser?.username}`}
        open={assignRoleModalOpen}
        onOk={handleSaveRoles}
        onCancel={() => setAssignRoleModalOpen(false)}
        width={700}
      >
        <Transfer
          dataSource={availableRoles}
          titles={['可选角色', '已选角色']}
          targetKeys={roleAssignSelected}
          onChange={(nextTargetKeys) => setRoleAssignSelected(nextTargetKeys as string[])}
          render={(item) => item.name}
          rowKey={(item) => item.id}
          listStyle={{ width: 300, height: 400 }}
          showSearch
        />
      </Modal>
    </PageContainer>
  );
};

export default UserManagement;
