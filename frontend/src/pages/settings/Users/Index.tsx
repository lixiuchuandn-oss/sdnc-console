import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Checkbox, Dropdown, Form, Input, Modal, Select, Space, Table, Tag, Tooltip, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ReloadOutlined, EllipsisOutlined, SearchOutlined } from '@ant-design/icons';
import PageContainer from '../../../components/PageContainer';
import ResourceActionsDropdown from '../../../components/ResourceActionsDropdown';
import { useTableColumnSettings } from '../../../hooks/useTableColumnSettings';
import TableColumnSettingsButton from '../../../components/TableColumnSettingsButton';
import { apiRequest, apiPost, apiDelete, apiPatch } from '../../../services/api';
import { getPublicAdminPasswordPolicy } from '../../../services/systemApi';
import type { AdminPasswordPolicy } from '../../../utils/adminPasswordPolicy';
import {
  DEFAULT_ADMIN_PASSWORD_POLICY,
  validateAdminPasswordClient,
} from '../../../utils/adminPasswordPolicy';
import { SecuritySettingsDrawer } from './SecuritySettings';
import { useAuth } from '../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../utils/accessMapping';

const { Text } = Typography;
type SysUser = {
  id: string;
  username: string;
  email: string;
  fullName: string;
  role: 'super_admin' | 'admin' | 'tenant';
  status: 'active' | 'inactive' | 'suspended';
  createdAt?: string;
  builtIn?: boolean;
};

type RBACRole = { id: string; name: string; description?: string; scope: 'system'|'tenant'; status?: 'active'|'inactive'; };
type Assignment = { id: string; roleId: string; userType: 'system'|'tenant'; userId: string; createdAt: string };

const AccessUsersPage: React.FC = () => {
  const { user: authUser } = useAuth();
  const canWriteUsers =
    authUser?.role === 'super_admin' ||
    hasPermissionForAction((authUser?.permissions ?? []) as string[], 'users:write');
  const [users, setUsers] = useState<SysUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [kw, setKw] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm] = Form.useForm();
  const [filterForm] = Form.useForm();
  const [editOpen, setEditOpen] = useState(false);
  const [editForm] = Form.useForm();
  const [editingUser, setEditingUser] = useState<SysUser | null>(null);
  const [isEditingAdmin, setIsEditingAdmin] = useState(false);
  const [rolesByUser, setRolesByUser] = useState<Record<string, RBACRole[]>>({});
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [builtInStatusConfirmOpen, setBuiltInStatusConfirmOpen] = useState(false);
  const [builtInStatusAck, setBuiltInStatusAck] = useState(false);
  const pendingEditValsRef = React.useRef<Record<string, unknown> | null>(null);
  const [adminPwdPolicy, setAdminPwdPolicy] = useState<AdminPasswordPolicy | null>(null);
  const [securityDrawerOpen, setSecurityDrawerOpen] = useState(false);
  const [systemRoles, setSystemRoles] = useState<RBACRole[]>([]);

  useEffect(() => {
    getPublicAdminPasswordPolicy().then(setAdminPwdPolicy);
  }, []);

  useEffect(() => {
    const run = async () => {
      try {
        const rolesJson = await apiRequest('/api/system/rbac/roles');
        const roles = Array.isArray(rolesJson)
          ? rolesJson
          : Array.isArray(rolesJson?.roles)
            ? rolesJson.roles
            : [];
        setSystemRoles(
          roles.filter(
            (r: RBACRole) =>
              r.scope === 'system' && (r.status === 'active' || r.status == null || r.status === undefined),
          ),
        );
      } catch {
        setSystemRoles([]);
      }
    };
    void run();
  }, []);

  const syncSystemUserRbac = React.useCallback(async (userId: string, nextRoleIds: string[]) => {
    const json = await apiRequest(
      `/api/system/rbac/assignments?userType=system&userId=${encodeURIComponent(userId)}`,
    );
    const list: Assignment[] = Array.isArray(json?.assignments) ? json.assignments : [];
    const next = new Set((nextRoleIds || []).filter(Boolean));
    const currentByRole = new Map(list.map((it) => [it.roleId, it]));
    for (const it of list) {
      if (!next.has(it.roleId)) {
        await apiDelete(`/api/system/rbac/assignments/${encodeURIComponent(it.id)}`);
      }
    }
    for (const rid of next) {
      if (!currentByRole.has(rid)) {
        await apiPost('/api/system/rbac/assignments', { roleId: rid, userType: 'system', userId });
      }
    }
  }, []);

  const passwordRules = (usernameGetter: () => string | undefined) => {
    const pol = adminPwdPolicy || DEFAULT_ADMIN_PASSWORD_POLICY;
    return [
      { required: true, message: '请输入密码' },
      {
        validator: async (_: unknown, v: string) => {
          const err = validateAdminPasswordClient(pol, String(v || ''), usernameGetter());
          if (err) throw new Error(err);
        },
      },
    ];
  };

  const passwordRulesOptional = (usernameGetter: () => string | undefined) => {
    const pol = adminPwdPolicy || DEFAULT_ADMIN_PASSWORD_POLICY;
    return [
      {
        validator: async (_: unknown, v: string) => {
          if (!v || !String(v).trim()) return Promise.resolve();
          const err = validateAdminPasswordClient(pol, String(v || ''), usernameGetter());
          if (err) throw new Error(err);
        },
      },
    ];
  };

  const defaultColumns: ColumnsType<SysUser> = useMemo(() => [
    { title:'用户名', key:'username', dataIndex:'username', render: (v:any, row: SysUser) => (
      <Space>
        { row.builtIn ? <Tag color="blue">内置</Tag> : <Tag>用户</Tag> }
        <Text strong>{v}</Text>
      </Space>
    ) },
    { title:'姓名', key:'fullName', dataIndex:'fullName' },
    { title:'角色', key:'roles', render: (_:any, row: SysUser) => {
      if (row.role === 'super_admin') {
        return (
          <Tooltip title="权限为平台内置（全部权限），不由 RBAC 角色分配表控制。">
            <Tag color="error">最高权限</Tag>
          </Tooltip>
        );
      }
      const myRoles = rolesByUser[row.id] || [];
      if (!myRoles.length) return <Text type="secondary">-</Text>;
      return (
        <Space wrap size={4}>
          {myRoles.map((r, i) => (
            <Tag key={i} color={r.scope==='system'?'blue':'green'}>{r.name}</Tag>
          ))}
        </Space>
      );
    } },
    { title:'邮箱', key:'email', dataIndex:'email' },
    {
      title: '状态',
      key: 'status',
      dataIndex: 'status',
      render: (v: string) => {
        const map: Record<string, React.ReactNode> = {
          active: <Tag color="success">活跃</Tag>,
          inactive: <Tag color="default">非活跃</Tag>,
          suspended: <Tag color="error">暂停</Tag>,
        };
        return map[String(v)] || v;
      },
    },
    { title:'操作', key:'actions', width:80, fixed:'right' as const, render: (_:any, row: SysUser) => {
      if (!canWriteUsers) return null;
      const itemsRaw = row.builtIn
        ? [
            { key:'edit', label:'编辑', onClick: () => {
                setEditingUser(row);
                setIsEditingAdmin(true);
                const roleIds =
                  !row.builtIn && row.role !== 'super_admin'
                    ? (rolesByUser[row.id] || []).map((r) => r.id)
                    : undefined;
                editForm.setFieldsValue({
                  fullName: row.fullName,
                  username: row.username,
                  email: row.email,
                  status: row.status,
                  ...(roleIds !== undefined ? { roleIds } : {}),
                });
                setEditOpen(true);
              } },
          ]
        : [
            { key:'edit', label:'编辑', onClick: () => {
                setEditingUser(row);
                setIsEditingAdmin(true);
                const roleIds =
                  !row.builtIn && row.role !== 'super_admin'
                    ? (rolesByUser[row.id] || []).map((r) => r.id)
                    : undefined;
                editForm.setFieldsValue({
                  fullName: row.fullName,
                  username: row.username,
                  email: row.email,
                  status: row.status,
                  ...(roleIds !== undefined ? { roleIds } : {}),
                });
                setEditOpen(true);
              } },
            { type:'divider' },
            {
              key: 'del',
              label: '删除用户',
              danger: true,
              onClick: () => {
                Modal.confirm({
                  title: '确认删除用户',
                  content: `确定删除用户「${row.username}」吗？此操作不可恢复。`,
                  okText: '删除',
                  okType: 'danger',
                  cancelText: '取消',
                  onOk: async () => {
                    try {
                      await apiDelete(`/api/users/${row.id}`);
                      message.success('已删除');
                      fetchUsers(true);
                    } catch (error: any) {
                      message.error(error?.message || '删除失败');
                    }
                  },
                });
              },
            },
          ];
      const items = itemsRaw.filter(Boolean);
      return <ResourceActionsDropdown items={items as any} />;
    } }
  ], [canWriteUsers, rolesByUser, editForm]);

  const { displayColumns: visibleColumns } = useTableColumnSettings(defaultColumns, 'sys_users_v1');

  const handleBatchDelete = () => {
    if (!canWriteUsers) {
      message.warning('无权限执行该操作');
      return;
    }
    if (selectedRowKeys.length === 0) return;
    Modal.confirm({
      title: '批量删除',
      content: `确定要删除选中的 ${selectedRowKeys.length} 个用户吗？`,
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          setLoading(true);
          await Promise.all(selectedRowKeys.map(id => apiDelete(`/api/users/${id}`)));
          message.success('批量删除成功');
          setSelectedRowKeys([]);
          fetchUsers(true);
        } catch {
          message.error('部分或全部删除失败');
        } finally {
          setLoading(false);
        }
      }
    });
  };

  const batchMenuProps = {
    items: canWriteUsers ? [{ key: 'delete', label: '批量删除', danger: true, onClick: handleBatchDelete }] : [],
  };

  const fetchUsers = async (skipCache: boolean = false) => {
    try {
      setLoading(true);
      const json = await apiRequest('/api/users', skipCache ? { skipCache: true } : undefined);
      setUsers(Array.isArray(json) ? json : Array.isArray(json?.users) ? json.users : []);
    } catch {
      message.error('获取系统用户失败');
    } finally {
      setLoading(false);
    }
  };

  const performUserEdit = async (vals: any) => {
    if (!canWriteUsers) {
      message.warning('无权限执行该操作');
      return;
    }
    if (!editingUser) return;
    const body = isEditingAdmin
      ? { email: vals.email, status: vals.status, password: vals.password }
      : { fullName: vals.fullName, username: vals.username, email: vals.email, status: vals.status, password: vals.password };
    await apiPatch(`/api/users/${editingUser.id}`, body);
    if (!editingUser.builtIn && editingUser.role !== 'super_admin' && Array.isArray(vals.roleIds)) {
      await syncSystemUserRbac(editingUser.id, vals.roleIds);
    }
    message.success('用户更新成功');
    setEditOpen(false);
    setEditingUser(null);
    setIsEditingAdmin(false);
    await fetchUsers(true);
  };

  useEffect(() => { fetchUsers(); }, []);

  useEffect(() => {
    const run = async () => {
      if (!users.length) return;
      try {
        const rolesJson = await apiRequest('/api/system/rbac/roles').catch(() => []);
        const roles = Array.isArray(rolesJson) ? rolesJson : (Array.isArray(rolesJson?.roles) ? rolesJson.roles : []);
        const jsons = await Promise.all(users.map(u =>
          apiRequest(`/api/system/rbac/assignments?userType=system&userId=${encodeURIComponent(u.id)}`).catch(() => ({ assignments: [] }))
        ));
        const next: Record<string, RBACRole[]> = {};
        users.forEach((u, i) => {
          const list: Assignment[] = Array.isArray(jsons[i]?.assignments) ? jsons[i].assignments : [];
          const ids = list.map(it => it.roleId);
          const roleObjs = ids.map(id => roles.find((r: RBACRole) => r.id === id)).filter(Boolean) as RBACRole[];
          next[u.id] = roleObjs;
        });
        setRolesByUser(next);
      } catch {}
    };
    run();
  }, [users]);

  const filteredUsers = useMemo(() => {
    const lower = kw.toLowerCase();
    const list = users
      .filter((u) => (!statusFilter ? true : String(u.status) === statusFilter))
      .filter(
        (u) =>
          (u.username || '').toLowerCase().includes(lower) ||
          (u.fullName || '').toLowerCase().includes(lower) ||
          (u.email || '').toLowerCase().includes(lower),
      );
    return [...list].sort((a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return tb - ta;
    });
  }, [users, kw, statusFilter]);

  const handleCreate = React.useCallback(
    async (values: any) => {
      if (!canWriteUsers) {
        message.warning('无权限执行该操作');
        return;
      }
      try {
        const created: any = await apiPost('/api/users', {
          username: values.username,
          email: values.email,
          password: values.password,
          fullName: values.fullName,
        });
        const newId = String(created?.id ?? '').trim();
        const roleIds: string[] = Array.isArray(values.roleIds) ? values.roleIds.filter(Boolean) : [];
        if (newId && roleIds.length) {
          await Promise.all(
            roleIds.map((roleId) =>
              apiPost('/api/system/rbac/assignments', { roleId, userType: 'system', userId: newId }),
            ),
          );
        }
        message.success('系统用户创建成功');
        setCreateOpen(false);
        createForm.resetFields();
        fetchUsers(true);
      } catch (error: any) {
        message.error(error?.message || '创建失败');
      }
    },
    [canWriteUsers, createForm],
  );

  return (
    <PageContainer titleLevel={3} asCard={false}>
      <div className="page-toolbar">
        <Form
          form={filterForm}
          className="toolbar-container"
          layout="vertical"
          onValuesChange={(_, all) => { setKw(all.keyword || ''); setStatusFilter(all.status ?? ''); }}
        >
          <Form.Item name="keyword"><Input allowClear placeholder="搜索用户名/姓名/邮箱" className="toolbar-search" suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />} /></Form.Item>
          <Form.Item name="status"><Select allowClear placeholder="全部状态" className="toolbar-filter-sm" options={[{ value:'active', label:'活跃' }, { value:'inactive', label:'非活跃' }, { value:'suspended', label:'暂停' }]} /></Form.Item>
          <Button type="link" className="toolbar-reset-btn" onClick={() => { setKw(''); setStatusFilter(''); filterForm.resetFields(); }}>重置</Button>
        </Form>
        <div className="toolbar-actions">
          {canWriteUsers ? <Button type="primary" onClick={() => setSecurityDrawerOpen(true)}>安全设定</Button> : null}
          {canWriteUsers ? (
            <Button type="primary" onClick={() => { const rand = `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`; createForm.setFieldsValue({ username: rand }); setCreateOpen(true); }}>新建系统用户</Button>
          ) : null}
          {canWriteUsers ? <Dropdown menu={batchMenuProps}><Button icon={<EllipsisOutlined />} /></Dropdown> : null}
          <TableColumnSettingsButton allColumns={defaultColumns} settingsKey="sys_users_v1" />
          <Button icon={<ReloadOutlined />} onClick={() => fetchUsers(true)} />
        </div>
      </div>

      <Table
        className="std-table"
        rowKey="id"
        loading={loading}
        dataSource={filteredUsers}
        columns={visibleColumns}
        scroll={{ x: 'max-content' }}
        rowSelection={
          canWriteUsers
            ? {
                selectedRowKeys,
                onChange: setSelectedRowKeys,
                getCheckboxProps: (record: SysUser) => ({ disabled: !!record.builtIn }),
              }
            : undefined
        }
        pagination={{ size: 'small', showTotal: (total) => `共 ${total} 条` }}
        bordered={false}
      />

      <Modal
        title="新建系统用户"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => createForm.submit()}
        okText="创建"
        okButtonProps={{ disabled: !canWriteUsers }}
        width={600}
        centered
        destroyOnHidden
        styles={{ body: { maxHeight: '80vh', overflowY: 'auto', overflowX: 'hidden' } }}
      >
        <Form form={createForm} layout="vertical" onFinish={handleCreate}>
        <Form.Item name="fullName" label="姓名" rules={[{ required: true, message: '请输入姓名' }]}><Input placeholder="例如：运维管理员" /></Form.Item>
        <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}><Input placeholder="例如：ops_admin" /></Form.Item>
        <Form.Item name="email" label="邮箱" rules={[{ required: true, message: '请输入邮箱' }, { type:'email', message: '请输入有效邮箱' }]}><Input placeholder="例如：ops@example.com" /></Form.Item>
        <Form.Item name="password" label="密码" dependencies={['username']} rules={passwordRules(() => createForm.getFieldValue('username'))}>
          <Input.Password placeholder="符合当前管理员密码策略" />
        </Form.Item>
        <Form.Item name="roleIds" label="RBAC 角色" tooltip="可选；对应系统设置中的权限角色">
          <Select
            mode="multiple"
            allowClear
            placeholder="选择角色（可选）"
            options={systemRoles.map((r) => ({ value: r.id, label: r.name }))}
            optionFilterProp="label"
          />
        </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="编辑用户"
        open={editOpen}
        onCancel={() => { setEditOpen(false); setEditingUser(null); setIsEditingAdmin(false); }}
        onOk={() => editForm.submit()}
        okText="保存"
        okButtonProps={{ disabled: !canWriteUsers }}
        width={600}
        centered
        destroyOnHidden
        styles={{ body: { maxHeight: '80vh', overflowY: 'auto', overflowX: 'hidden' } }}
      >
        <Form
          form={editForm}
          layout="vertical"
          onFinish={async (vals) => {
            if (!editingUser) return;
            try {
              const statusChanged = String(vals.status ?? '') !== String(editingUser.status ?? '');
              if (editingUser.builtIn && statusChanged) {
                pendingEditValsRef.current = vals;
                setBuiltInStatusAck(false);
                setBuiltInStatusConfirmOpen(true);
                return;
              }
              await performUserEdit(vals);
            } catch (error: any) {
              message.error(error?.message || '更新失败');
            }
          }}
        >
        {isEditingAdmin ? (
          <>
            <Form.Item name="fullName" label="姓名"><Input disabled /></Form.Item>
            <Form.Item name="username" label="用户名"><Input disabled /></Form.Item>
            <Form.Item name="status" label="状态">
              <Select
                disabled={Boolean(editingUser?.id && authUser?.id && editingUser.id === authUser.id)}
                options={[
                  { value: 'active', label: '活跃' },
                  { value: 'inactive', label: '非活跃' },
                  { value: 'suspended', label: '暂停' },
                ]}
              />
            </Form.Item>
            <Form.Item name="email" label="邮箱" rules={[{ type:'email', message: '请输入有效邮箱' }]}><Input /></Form.Item>
            <Form.Item name="password" label="重置密码（留空则不修改）" dependencies={['username']} rules={passwordRulesOptional(() => editForm.getFieldValue('username') || editingUser?.username)}>
              <Input.Password placeholder="可选，输入则更新密码" />
            </Form.Item>
            {editingUser && !editingUser.builtIn && editingUser.role !== 'super_admin' ? (
              <Form.Item name="roleIds" label="RBAC 角色" tooltip="与权限管理中的系统角色分配一致">
                <Select
                  mode="multiple"
                  allowClear
                  placeholder="选择角色"
                  options={systemRoles.map((r) => ({ value: r.id, label: r.name }))}
                  optionFilterProp="label"
                />
              </Form.Item>
            ) : null}
          </>
        ) : (
          <>
            <Form.Item name="fullName" label="姓名" rules={[{ required: true, message: '请输入姓名' }]}><Input /></Form.Item>
            <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}><Input /></Form.Item>
            <Form.Item name="email" label="邮箱" rules={[{ type:'email', message: '请输入有效邮箱' }]}><Input /></Form.Item>
            <Form.Item name="status" label="状态">
              <Select
                disabled={Boolean(editingUser?.id && authUser?.id && editingUser.id === authUser.id)}
                options={[
                  { value: 'active', label: '活跃' },
                  { value: 'inactive', label: '非活跃' },
                  { value: 'suspended', label: '暂停' },
                ]}
              />
            </Form.Item>
            <Form.Item name="password" label="重置密码（留空则不修改）" dependencies={['username']} rules={passwordRulesOptional(() => editForm.getFieldValue('username') || editingUser?.username)}>
              <Input.Password placeholder="可选，输入则更新密码" />
            </Form.Item>
            {editingUser && !editingUser.builtIn && editingUser.role !== 'super_admin' ? (
              <Form.Item name="roleIds" label="RBAC 角色" tooltip="与权限管理中的系统角色分配一致">
                <Select
                  mode="multiple"
                  allowClear
                  placeholder="选择角色"
                  options={systemRoles.map((r) => ({ value: r.id, label: r.name }))}
                  optionFilterProp="label"
                />
              </Form.Item>
            ) : null}
          </>
        )}
        </Form>
      </Modal>

      <SecuritySettingsDrawer
        open={securityDrawerOpen}
        onClose={() => setSecurityDrawerOpen(false)}
        onSaved={() => getPublicAdminPasswordPolicy().then(setAdminPwdPolicy)}
      />

      <Modal
        title="确认修改内置账号状态"
        open={builtInStatusConfirmOpen}
        zIndex={2100}
        okText="确认保存"
        cancelText="取消"
        okButtonProps={{ disabled: !canWriteUsers || !builtInStatusAck, danger: true }}
        maskClosable={false}
        onCancel={() => {
          setBuiltInStatusConfirmOpen(false);
          pendingEditValsRef.current = null;
          setBuiltInStatusAck(false);
        }}
        onOk={async () => {
          if (!builtInStatusAck) return;
          const vals = pendingEditValsRef.current;
          if (!vals || !editingUser) return;
          try {
            await performUserEdit(vals);
            setBuiltInStatusConfirmOpen(false);
            pendingEditValsRef.current = null;
            setBuiltInStatusAck(false);
          } catch (error: any) {
            message.error(error?.message || '更新失败');
          }
        }}
      >
        <Alert
          type="warning"
          showIcon
          message="内置账号的状态变更影响登录与可用性"
          description={
            <div>
              <p>将状态改为「非活跃」或「暂停」后，该账号通常将无法登录或无法正常使用；若误操作可能影响运维、审计、安全等职责分工。</p>
              <p>请确认仍有其他可用账号可管理系统，再继续保存。</p>
            </div>
          }
          style={{ marginBottom: 16 }}
        />
        <Checkbox checked={builtInStatusAck} onChange={(e) => setBuiltInStatusAck(e.target.checked)}>
          我已阅读上述说明，确认要修改该内置账号的状态
        </Checkbox>
      </Modal>
    </PageContainer>
  );
};

export default AccessUsersPage;
