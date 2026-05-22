import React, { useState, useEffect, useMemo, useCallback } from 'react';
import type { MenuProps } from 'antd';
import { Form, message, Modal } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import ResourceActionsDropdown from '../../../components/ResourceActionsDropdown';
import { useTableColumnSettings } from '../../../hooks/useTableColumnSettings';
import { apiDelete, apiPost, apiPut, apiRequest } from '../../../services/api';
import type {
  Assignment,
  CreateUserFormValues,
  RBACRole,
  TenantUser,
} from '../lib/tenantUsers';
import { displayRolesForTenantUser } from '../lib/tenantUsers';

export function useTenantUsersPage() {
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<TenantUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [selectedTenant, setSelectedTenant] = useState('');
  const [selectedRole, setSelectedRole] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');

  const [modal, contextHolder] = Modal.useModal();
  const [messageApi, messageContextHolder] = message.useMessage();

  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createForm] = Form.useForm();
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<TenantUser | null>(null);
  const [editForm] = Form.useForm();
  const [tenants, setTenants] = useState<Array<{ id: string; name: string }>>([]);
  const [organizations, setOrganizations] = useState<Array<{ id: string; name: string }>>([]);

  const [assignRoleModalOpen, setAssignRoleModalOpen] = useState(false);
  const [currentAssignUser, setCurrentAssignUser] = useState<TenantUser | null>(null);
  const [availableRoles, setAvailableRoles] = useState<RBACRole[]>([]);
  const [roleAssignExisting, setRoleAssignExisting] = useState<Assignment[]>([]);
  const [roleAssignSelected, setRoleAssignSelected] = useState<string[]>([]);

  const [filterForm] = Form.useForm();

  const fetchTenantUsers = useCallback(async () => {
    try {
      setLoading(true);
      const data = await apiRequest('/api/users/tenant-users');
      const list = Array.isArray(data) ? data : [];
      setUsers(list);
      setFilteredUsers(list);
      setSelectedRowKeys([]);
    } catch (error: unknown) {
      const err = error as { message?: string };
      messageApi.error(err?.message || '获取用户列表失败');
    } finally {
      setLoading(false);
    }
  }, [messageApi]);

  const fetchTenants = useCallback(async () => {
    try {
      const data = await apiRequest('/api/tenants');
      const tenantList = Array.isArray(data) ? data : data?.tenants || [];
      setTenants(tenantList);
    } catch (error) {
      console.error('Failed to fetch tenants', error);
    }
  }, []);

  const fetchOrganizations = useCallback(async (tenantId: string) => {
    try {
      const data = await apiRequest(`/api/tenants/${tenantId}/organizations`);
      setOrganizations(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to fetch organizations', error);
      setOrganizations([]);
    }
  }, []);

  const fetchRoles = useCallback(async () => {
    try {
      const raw = await apiRequest('/api/system/rbac/roles?limit=1000', { enableCache: true });
      const list: RBACRole[] = Array.isArray(raw) ? raw : Array.isArray(raw?.roles) ? raw.roles : [];
      setAvailableRoles(list.filter((r) => r.scope === 'tenant' && String(r.status || 'active') === 'active'));
    } catch (error) {
      console.error('Failed to fetch roles', error);
    }
  }, []);

  useEffect(() => {
    fetchTenantUsers();
    fetchTenants();
    fetchRoles();
  }, [fetchTenantUsers, fetchTenants, fetchRoles]);

  const handleFilterChange = useCallback((_: unknown, all: Record<string, unknown>) => {
    setSearchText((all.keyword as string) || '');
    setSelectedTenant((all.tenant as string) || '');
    setSelectedRole((all.role as string) || '');
    setSelectedStatus((all.status as string) || '');
  }, []);

  useEffect(() => {
    let filtered = users;
    if (searchText) {
      const kw = searchText.toLowerCase();
      filtered = filtered.filter(
        (user) =>
          user.username.toLowerCase().includes(kw) ||
          user.fullName.toLowerCase().includes(kw) ||
          user.email.toLowerCase().includes(kw) ||
          user.tenant?.name.toLowerCase().includes(kw) ||
          user.organization?.name.toLowerCase().includes(kw) ||
          displayRolesForTenantUser(user, availableRoles).some((r) =>
            String(r.name || '').toLowerCase().includes(kw),
          ),
      );
    }
    if (selectedTenant) {
      filtered = filtered.filter((user) => user.tenant?.id === selectedTenant);
    }
    if (selectedRole) {
      filtered = filtered.filter((user) =>
        displayRolesForTenantUser(user, availableRoles).some((r) => r.id === selectedRole),
      );
    }
    if (selectedStatus) {
      filtered = filtered.filter((user) => user.status === selectedStatus);
    }
    setFilteredUsers(filtered);
  }, [users, searchText, selectedTenant, selectedRole, selectedStatus, availableRoles]);

  const tenantOptionsFromUsers = useMemo(() => {
    return users.reduce((acc, user) => {
      if (user.tenant && !acc.find((t) => t.id === user.tenant!.id)) {
        acc.push(user.tenant);
      }
      return acc;
    }, [] as Array<{ id: string; name: string; description?: string }>);
  }, [users]);

  const handleCreateTenantChange = useCallback(
    (tenantId: string) => {
      createForm.setFieldsValue({ organizationId: undefined });
      fetchOrganizations(tenantId);
    },
    [createForm, fetchOrganizations],
  );

  const handleCreateUser = useCallback(
    async (values: CreateUserFormValues) => {
      try {
        if (!values.tenantId || !values.organizationId) {
          messageApi.error('请选择租户和组织');
          return;
        }
        await apiPost(
          `/api/tenants/${values.tenantId}/organizations/${values.organizationId}/users`,
          values,
        );
        messageApi.success('创建用户成功');
        setCreateModalOpen(false);
        createForm.resetFields();
        fetchTenantUsers();
      } catch (error: unknown) {
        const err = error as { message?: string };
        messageApi.error(err?.message || '创建用户失败');
      }
    },
    [createForm, fetchTenantUsers, messageApi],
  );

  const openEditModal = useCallback(
    (user: TenantUser) => {
      if (!user.tenant?.id || !user.organization?.id) {
        messageApi.error('用户数据缺失租户或组织信息，无法编辑');
        return;
      }
      setEditingUser(user);
      editForm.setFieldsValue({
        username: user.username,
        fullName: user.fullName,
        email: user.email,
        status: user.status,
        password: '',
      });
      setEditModalOpen(true);
    },
    [editForm, messageApi],
  );

  const handleEditUser = useCallback(async () => {
    if (!editingUser?.tenant?.id || !editingUser.organization?.id) {
      messageApi.error('用户数据缺失租户或组织信息，无法保存');
      throw new Error('missing-tenant-org');
    }
    try {
      const values = await editForm.validateFields();
      const payload: { email: string; fullName: string; status: string; password?: string } = {
        email: values.email,
        fullName: values.fullName,
        status: values.status,
      };
      const pwd = String(values.password || '').trim();
      if (pwd) payload.password = pwd;
      await apiPut(
        `/api/tenants/${editingUser.tenant.id}/organizations/${editingUser.organization.id}/users/${editingUser.id}`,
        payload,
      );
      messageApi.success('保存成功');
      setEditModalOpen(false);
      setEditingUser(null);
      editForm.resetFields();
      fetchTenantUsers();
    } catch (e: unknown) {
      const err = e as { errorFields?: unknown; message?: string };
      if (err?.errorFields) return;
      messageApi.error(err?.message || '保存失败');
      throw e;
    }
  }, [editForm, editingUser, fetchTenantUsers, messageApi]);

  const handleDeleteUser = useCallback(
    async (user: TenantUser) => {
      if (!user.tenant || !user.organization) {
        messageApi.error('用户数据缺失租户或组织信息，无法删除');
        return;
      }
      try {
        await apiDelete(
          `/api/tenants/${user.tenant.id}/organizations/${user.organization.id}/users/${user.id}`,
        );
        messageApi.success('删除用户成功');
        fetchTenantUsers();
      } catch (error: unknown) {
        const err = error as { message?: string };
        messageApi.error(err?.message || '删除用户失败');
      }
    },
    [fetchTenantUsers, messageApi],
  );

  const handleBatchDelete = useCallback(() => {
    modal.confirm({
      title: '确认批量删除用户',
      content: `确定要删除选中的 ${selectedRowKeys.length} 个用户吗？删除后无法恢复。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          const deletePromises = selectedRowKeys.map((key) => {
            const user = users.find((u) => u.id === key);
            if (user?.tenant && user.organization) {
              return apiDelete(
                `/api/tenants/${user.tenant.id}/organizations/${user.organization.id}/users/${user.id}`,
              );
            }
            return Promise.resolve();
          });
          await Promise.all(deletePromises);
          messageApi.success('批量删除成功');
          fetchTenantUsers();
        } catch {
          messageApi.error('批量删除过程中发生错误');
        }
      },
    });
  }, [modal, messageApi, selectedRowKeys, users, fetchTenantUsers]);

  const bulkActionsMenu: MenuProps = useMemo(
    () => ({
      items: [
        {
          key: 'bulkDelete',
          label: '批量删除',
          danger: true,
          disabled: selectedRowKeys.length === 0,
          onClick: handleBatchDelete,
        },
      ],
    }),
    [handleBatchDelete, selectedRowKeys.length],
  );

  const openAssignRoleModal = useCallback(
    async (user: TenantUser) => {
      setCurrentAssignUser(user);
      setAssignRoleModalOpen(true);
      setRoleAssignExisting([]);
      setRoleAssignSelected([]);

      try {
        const raw = await apiRequest(
          `/api/system/rbac/assignments?userType=tenant&userId=${encodeURIComponent(user.id)}`,
        );
        const rawList = (Array.isArray((raw as { assignments?: unknown[] })?.assignments)
          ? (raw as { assignments: unknown[] }).assignments
          : []) as Record<string, unknown>[];
        const list: Assignment[] = rawList.map((it) => ({
          ...it,
          roleId: (it.roleId ?? it.role_id) as string,
        })) as Assignment[];
        setRoleAssignExisting(list);
        setRoleAssignSelected(list.map((it) => it.roleId));
      } catch {
        messageApi.error('获取用户角色失败');
      }
    },
    [messageApi],
  );

  const handleSaveRoles = useCallback(async () => {
    if (!currentAssignUser) return;

    const currentRoleIds = new Set(roleAssignExisting.map((x) => x.roleId));
    const needAdd = roleAssignSelected.filter((id) => !currentRoleIds.has(id));
    const needRemove = roleAssignExisting.filter((x) => !roleAssignSelected.includes(x.roleId));

    try {
      for (const roleId of needAdd) {
        await apiPost('/api/system/rbac/assignments', {
          roleId,
          userType: 'tenant',
          userId: currentAssignUser.id,
        });
      }
      for (const it of needRemove) {
        await apiDelete(`/api/system/rbac/assignments/${encodeURIComponent(it.id)}`);
      }
      messageApi.success('角色赋权已保存');
      setAssignRoleModalOpen(false);
      setCurrentAssignUser(null);
    } catch {
      messageApi.error('保存角色赋权失败');
    }
  }, [currentAssignUser, messageApi, roleAssignExisting, roleAssignSelected]);

  const baseColumns: ColumnsType<TenantUser> = useMemo(
    () => [
      { title: '姓名', dataIndex: 'fullName', key: 'fullName' },
      { title: '用户名', dataIndex: 'username', key: 'username' },
      { title: '邮箱', dataIndex: 'email', key: 'email' },
      { title: '租户', key: 'tenant.name', render: (_, record) => record.tenant?.name || '-' },
      {
        title: '租户描述',
        key: 'tenant.description',
        render: (_, record) => record.tenant?.description || '-',
      },
      { title: '组织', key: 'organization.name', render: (_, record) => record.organization?.name || '-' },
      {
        title: '组织级别',
        key: 'organization.level',
        render: (_, record) => {
          const lvl = record.organization?.level;
          const label = lvl === 1 ? '根组织' : lvl === 2 ? '二级' : lvl === 3 ? '三级' : '-';
          const badgeClass =
            lvl === 1
              ? 'std-badge std-badge-info'
              : lvl === 2
                ? 'std-badge std-badge-success'
                : lvl === 3
                  ? 'std-badge std-badge-warning'
                  : 'std-badge std-badge-default';
          return <span className={badgeClass}>{label}</span>;
        },
      },
      {
        title: '角色',
        dataIndex: 'rbacRoles',
        key: 'role',
        render: (_: unknown, record: TenantUser) => {
          const list = displayRolesForTenantUser(record, availableRoles);
          if (!list.length) {
            return <span className="std-badge std-badge-default">未分配</span>;
          }
          return (
            <span>
              {list.map((r) => {
                const inCatalog = availableRoles.find((c) => c.id === r.id);
                const useInfo =
                  String(inCatalog?.scope || r.scope || '') === 'system' ||
                  (inCatalog?.type && String(inCatalog.type) === 'system');
                const badgeClass = useInfo ? 'std-badge std-badge-info' : 'std-badge std-badge-success';
                return (
                  <span key={r.id} className={badgeClass} style={{ marginRight: 6 }}>
                    {r.name}
                  </span>
                );
              })}
            </span>
          );
        },
      },
      {
        title: '状态',
        dataIndex: 'status',
        key: 'status',
        render: (status: string) => (
          <span
            className={status === 'active' ? 'std-badge std-badge-success' : 'std-badge std-badge-error'}
          >
            {status === 'active' ? '活跃' : '非活跃'}
          </span>
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
              { key: 'edit', label: '编辑' },
              { key: 'assign', label: '分配角色' },
              { type: 'divider', key: 'divider-before-delete' },
              { key: 'delete', label: '删除', danger: true },
            ]}
            onClick={({ key }) => {
              if (key === 'edit') openEditModal(record);
              if (key === 'assign') void openAssignRoleModal(record);
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
        ),
      },
    ],
    [modal, availableRoles, openAssignRoleModal, openEditModal, handleDeleteUser],
  );

  const { displayColumns: columns } = useTableColumnSettings(baseColumns, 'tenant-users-columns');

  const resetFilters = useCallback(() => {
    filterForm.resetFields();
    setSearchText('');
    setSelectedTenant('');
    setSelectedRole('');
    setSelectedStatus('');
  }, [filterForm]);

  const closeCreateModal = useCallback(() => {
    setCreateModalOpen(false);
  }, []);

  const closeEditModal = useCallback(() => {
    setEditModalOpen(false);
    setEditingUser(null);
    editForm.resetFields();
  }, [editForm]);

  const closeAssignRoleModal = useCallback(() => {
    setAssignRoleModalOpen(false);
  }, []);

  return {
    loading,
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
    editingUser,
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
  };
}
