import React, { useEffect, useMemo, useState } from 'react';
import { Button, Dropdown, Form, Input, Modal, Select, Space, Table, Tag, Transfer, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ReloadOutlined, SafetyCertificateOutlined, EllipsisOutlined } from '@ant-design/icons';
import StdFormModal from '../../components/StdFormModal';
import StdSideDrawer from '../../components/StdSideDrawer';
import PageContainer from '../../components/PageContainer';
import ResourceActionsDropdown from '../../components/ResourceActionsDropdown';
import { useTableColumnSettings } from '../../hooks/useTableColumnSettings';
import TableColumnSettingsButton from '../../components/TableColumnSettingsButton';
import { apiRequest, apiPost, apiDelete, apiPatch } from '../../services/api';

const { Text } = Typography;
type SysUser = {
  id: string;
  username: string;
  email: string;
  fullName: string;
  role: 'super_admin' | 'tenant' | 'leased_lines_admin';
  status: 'active' | 'inactive' | 'suspended';
  createdAt?: string;
  builtIn?: boolean;
};

type RBACRole = { id: string; name: string; description?: string; scope: 'system'|'tenant'; status?: 'active'|'inactive'; };
type Assignment = { id: string; roleId: string; userType: 'system'|'tenant'; userId: string; createdAt: string };

const AccessUsersPage: React.FC = () => {
  const [users, setUsers] = useState<SysUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [kw, setKw] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all'|'active'|'inactive'|'suspended'>('active');
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm] = Form.useForm();
  const [filterForm] = Form.useForm();
  const [roles, setRoles] = useState<RBACRole[]>([]);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignUser, setAssignUser] = useState<SysUser | null>(null);
  const [assignSelected, setAssignSelected] = useState<string[]>([]);
  const [assignExisting, setAssignExisting] = useState<Assignment[]>([]);
  const [assignRoleKw, setAssignRoleKw] = useState('');
  const [assignScope, setAssignScope] = useState<'all'|'system'|'tenant'>('system');
  const [assignStatus, setAssignStatus] = useState<'all'|'active'|'inactive'>('active');
  const [editOpen, setEditOpen] = useState(false);
  const [editForm] = Form.useForm();
  const [editingUser, setEditingUser] = useState<SysUser | null>(null);
  const [isEditingAdmin, setIsEditingAdmin] = useState(false);
  const [rolesByUser, setRolesByUser] = useState<Record<string, RBACRole[]>>({});
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  const openAssign = React.useCallback(async (u: SysUser) => {
    if (u.username === 'admin') { message.warning('系统管理员不支持修改权限'); return; }
    try {
      setAssignUser(u);
      const json = await apiRequest(`/api/system/rbac/assignments?userType=system&userId=${encodeURIComponent(u.id)}`);
      const list: Assignment[] = Array.isArray(json?.assignments) ? json.assignments : [];
      setAssignExisting(list);
      const selected = list.map(it => it.roleId);
      setAssignSelected(selected);
      setAssignOpen(true);
    } catch {}
  }, []);

  const defaultColumns: ColumnsType<SysUser> = useMemo(() => [
    { title:'用户名', key:'username', dataIndex:'username', render: (v:any, row: SysUser) => (
      <Space>
        { row.username === 'admin' ? <Tag color="gold">Admin</Tag> : (row.builtIn ? <Tag color="blue">BuiltIn</Tag> : <Tag>User</Tag>) }
        <Text strong>{v}</Text>
      </Space>
    ) },
    { title:'姓名', key:'fullName', dataIndex:'fullName' },
    { title:'角色', key:'roles', render: (_:any, row: SysUser) => {
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
    { title:'状态', key:'status', render: (v:any) => {
      const map: any = { 'active': <Tag color="success">活跃</Tag>, 'inactive': <Tag color="default">非活跃</Tag>, 'suspended': <Tag color="error">暂停</Tag> };
      return map[String(v)] || v;
    } },
    { title:'操作', key:'actions', width:80, fixed:'right' as const, render: (_:any, row: SysUser) => {
      if (row.username === 'admin') return null;
      const itemsRaw = [
        { key:'assign', label:'分配角色', onClick: () => openAssign(row) },
        { key:'edit', label:'编辑', onClick: () => { setEditingUser(row); setIsEditingAdmin(false); editForm.setFieldsValue({ fullName: row.fullName, username: row.username, email: row.email, status: row.status }); setEditOpen(true); } },
        { type:'divider' },
        { key:'del', label:'删除用户', danger: true, onClick: async () => {
            try {
              await apiDelete(`/api/users/${row.id}`);
              message.success('已删除');
              fetchUsers(true); // 强制刷新，跳过缓存
            } catch (error: any) {
              message.error(error?.message || '删除失败');
            }
          } },
      ];
      // Filter out invalid items or dividers if needed
      const items = itemsRaw.filter(Boolean);
      return <ResourceActionsDropdown items={items as any} />;
    } }
  ], [rolesByUser, openAssign]);

  // 使用新的 hook 管理列设置
  const { displayColumns: visibleColumns } = useTableColumnSettings(defaultColumns, 'sys_users_v1');

  const handleBatchDelete = () => {
    if (selectedRowKeys.length === 0) return;
    Modal.confirm({
      title: '批量删除',
      content: `确定要删除选中的 ${selectedRowKeys.length} 个用户吗？`,
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          setLoading(true);
          await Promise.all(selectedRowKeys.map(id => 
            apiDelete(`/api/users/${id}`)
          ));
          message.success('批量删除成功');
          setSelectedRowKeys([]);
          fetchUsers(true); // 强制刷新，跳过缓存
        } catch (e) {
          message.error('部分或全部删除失败');
        } finally {
          setLoading(false);
        }
      }
    });
  };

  const batchMenuProps = {
    items: [
      { key: 'delete', label: '批量删除', danger: true, onClick: handleBatchDelete },
    ]
  };

  const fetchUsers = async (skipCache: boolean = false) => {
    try {
      setLoading(true);
      const json = await apiRequest('/api/users', skipCache ? { skipCache: true } : undefined);
      setUsers(Array.isArray(json) ? json : Array.isArray(json?.users) ? json.users : []);
    } catch {
      message.error('获取系统用户失败');
    } finally { setLoading(false); }
  };

  const fetchRoles = async () => {
    try {
      const json = await apiRequest('/api/system/rbac/roles');
      setRoles(Array.isArray(json?.roles) ? json.roles : []);
    } catch {}
  };

  useEffect(() => { fetchUsers(); fetchRoles(); }, []);

  useEffect(() => {
    const run = async () => {
      if (!users.length || !roles.length) return;
      try {
        const jsons = await Promise.all(users.map(u => 
          apiRequest(`/api/system/rbac/assignments?userType=system&userId=${encodeURIComponent(u.id)}`).catch(() => ({ assignments: [] }))
        ));
        const next: Record<string, RBACRole[]> = {};
        users.forEach((u, i) => {
          const list: Assignment[] = Array.isArray(jsons[i]?.assignments) ? jsons[i].assignments : [];
          const ids = list.map(it => it.roleId);
          const roleObjs = ids.map(id => roles.find(r => r.id === id)).filter(Boolean) as RBACRole[];
          next[u.id] = roleObjs;
        });
        setRolesByUser(next);
      } catch {}
    };
    run();
  }, [users, roles]);

  const filteredUsers = useMemo(() => {
    const lower = kw.toLowerCase();
    return users
      .filter(u => statusFilter === 'all' ? true : (String(u.status) === statusFilter))
      .filter(u => (u.username||'').toLowerCase().includes(lower) || (u.fullName||'').toLowerCase().includes(lower) || (u.email||'').toLowerCase().includes(lower));
  }, [users, kw, statusFilter]);

  const saveAssign = React.useCallback(async () => {
    if (!assignUser) return;
    const current = new Set(assignExisting.map(x => x.roleId));
    const needAdd = assignSelected.filter(id => !current.has(id));
    const needRemove = assignExisting.filter(x => !assignSelected.includes(x.roleId));
    try {
      for (const roleId of needAdd) {
        await apiPost('/api/system/rbac/assignments', { roleId, userType:'system', userId: assignUser.id });
      }
      for (const it of needRemove) {
        await apiDelete(`/api/system/rbac/assignments/${encodeURIComponent(it.id)}`);
      }
      message.success('角色赋权已保存');
      setAssignOpen(false); setAssignUser(null); setAssignExisting([]); setAssignSelected([]);
      fetchUsers(true); // 强制刷新，跳过缓存
    } catch { message.error('保存失败'); }
  }, [assignUser, assignExisting, assignSelected]);

  const handleCreate = React.useCallback(async (values: any) => {
    try {
      await apiPost('/api/users', values);
      message.success('系统用户创建成功');
      setCreateOpen(false);
      createForm.resetFields();
      fetchUsers(true); // 强制刷新，跳过缓存
    } catch (error: any) {
      message.error(error?.message || '创建失败');
    }
  }, [createForm]);

  return (
    <PageContainer
      titleLevel={3}
      asCard={false}
    >
      <div className="page-toolbar">
        <Form 
          form={filterForm}
          className="toolbar-container" 
          layout="vertical" 
          onValuesChange={(_,all)=> { setKw(all.keyword||''); setStatusFilter(all.status||'active'); }}
        >
          <Form.Item name="keyword" label="关键字"><Input allowClear placeholder="搜索用户名/姓名/邮箱" className="toolbar-search" /></Form.Item>
          <Form.Item name="status" label="状态" initialValue={statusFilter}><Select allowClear placeholder="全部" className="toolbar-filter-sm" options={[{ value:'all', label:'全部' }, { value:'active', label:'活跃' }, { value:'inactive', label:'非活跃' }, { value:'suspended', label:'暂停' }]} /></Form.Item>
          <a className="toolbar-reset-btn" onClick={() => {
            setKw('');
            setStatusFilter('active');
            filterForm.resetFields();
            filterForm.setFieldsValue({ status: 'active' });
          }}>重置</a>
        </Form>
        <div className="toolbar-actions">
          <Button type="primary" onClick={() => { const rand = `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`; createForm.setFieldsValue({ username: rand }); setCreateOpen(true); }}>新建系统用户</Button>
          <Dropdown menu={batchMenuProps}>
            <Button icon={<EllipsisOutlined />} />
          </Dropdown>
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
        scroll={{ 
          x: 'max-content',
        }}
        rowSelection={{
          selectedRowKeys,
          onChange: setSelectedRowKeys,
          getCheckboxProps: (record: SysUser) => ({
            disabled: (typeof record.builtIn === 'boolean') ? record.builtIn : (record.username === 'admin'),
          }),
        }}
        pagination={{ pageSize: 10, showSizeChanger: true, pageSizeOptions: ['10','20','50','100'], size: 'small', showQuickJumper: false }}
        bordered={false}
      />

      <StdFormModal title="新建系统用户" open={createOpen} onCancel={()=> setCreateOpen(false)} okText="创建" width={600} form={createForm} onFinish={handleCreate}>
        <Form.Item name="fullName" label="姓名" rules={[{ required: true, message: '请输入姓名' }]}> 
          <Input placeholder="例如：运维管理员" />
        </Form.Item>
        <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}> 
          <Input placeholder="例如：ops_admin" />
        </Form.Item>
        <Form.Item name="email" label="邮箱" rules={[{ required: true, message: '请输入邮箱' }, { type:'email', message: '请输入有效邮箱' }]}> 
          <Input placeholder="例如：ops@example.com" />
        </Form.Item>
        <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}> 
          <Input.Password placeholder="至少 8 位密码" />
        </Form.Item>
        <Form.Item name="role" label="系统角色" rules={[{ required: true, message: '请选择系统角色' }]}> 
          <Select placeholder="请选择系统角色" options={[{ value:'super_admin', label:'超级管理员' }, { value:'leased_lines_admin', label:'管理员' }]} />
        </Form.Item>
      </StdFormModal>

      <StdFormModal title="编辑用户" open={editOpen} onCancel={()=> { setEditOpen(false); setEditingUser(null); setIsEditingAdmin(false); }} okText="保存" width={600} form={editForm} onFinish={async (vals)=> {
        if (!editingUser) return;
        try {
          const body = isEditingAdmin
            ? { email: vals.email, password: vals.password }
            : { fullName: vals.fullName, username: vals.username, email: vals.email, status: vals.status, password: vals.password };
          await apiPatch(`/api/users/${editingUser.id}`, body);
          message.success('用户更新成功');
          setEditOpen(false);
          setEditingUser(null);
          setIsEditingAdmin(false);
          fetchUsers(true); // 强制刷新，跳过缓存
        } catch (error: any) {
          message.error(error?.message || '更新失败');
        }
      }}>
        {isEditingAdmin ? (
          <>
            <Form.Item name="fullName" label="姓名">
              <Input disabled />
            </Form.Item>
            <Form.Item name="username" label="用户名">
              <Input disabled />
            </Form.Item>
            <Form.Item name="status" label="状态">
              <Select disabled options={[{ value:'active', label:'活跃' }, { value:'inactive', label:'非活跃' }, { value:'suspended', label:'暂停' }]} />
            </Form.Item>
            <Form.Item name="email" label="邮箱" rules={[{ type:'email', message: '请输入有效邮箱' }]}> 
              <Input />
            </Form.Item>
            <Form.Item name="password" label="重置密码（留空则不修改）">
              <Input.Password placeholder="可选，输入则更新密码" />
            </Form.Item>
          </>
        ) : (
          <>
            <Form.Item name="fullName" label="姓名" rules={[{ required: true, message: '请输入姓名' }]}> 
              <Input />
            </Form.Item>
            <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}> 
              <Input />
            </Form.Item>
            <Form.Item name="email" label="邮箱" rules={[{ type:'email', message: '请输入有效邮箱' }]}> 
              <Input />
            </Form.Item>
            <Form.Item name="status" label="状态">
              <Select options={[{ value:'active', label:'活跃' }, { value:'inactive', label:'非活跃' }, { value:'suspended', label:'暂停' }]} />
            </Form.Item>
            <Form.Item name="password" label="重置密码（留空则不修改）">
              <Input.Password placeholder="可选，输入则更新密码" />
            </Form.Item>
          </>
        )}
      </StdFormModal>

      <StdSideDrawer title="配置角色" open={assignOpen} onClose={()=> { setAssignOpen(false); setAssignUser(null); }} onOk={saveAssign} width={800}>
        <Form layout="vertical" style={{ display:'flex', gap: 16, marginBottom: 16 }}>
          <Form.Item label="角色范围" style={{ width: 160, marginBottom: 0 }}>
            <Select value={assignScope} onChange={(v: 'all'|'system'|'tenant')=> setAssignScope(v)} options={[{ value:'all', label:'全部' }, { value:'system', label:'系统' }, { value:'tenant', label:'租户' }]} />
          </Form.Item>
          <Form.Item label="状态" style={{ width: 160, marginBottom: 0 }}>
            <Select value={assignStatus} onChange={(v: 'all'|'active'|'inactive')=> setAssignStatus(v)} options={[{ value:'all', label:'全部' }, { value:'active', label:'活跃' }, { value:'inactive', label:'非活跃' }]} />
          </Form.Item>
          <Form.Item label="关键字" style={{ flex: 1, marginBottom: 0 }}>
            <Input.Search allowClear placeholder="搜索角色名称或说明" value={assignRoleKw} onChange={e => setAssignRoleKw(e.target.value)} />
          </Form.Item>
        </Form>
        <Transfer
          dataSource={roles
            .filter(r => (assignScope==='all' ? true : r.scope === assignScope))
            .filter(r => (assignStatus==='all' ? true : String(r.status || 'active') === assignStatus))
            .filter(r => (assignRoleKw ? ((r.name||'').toLowerCase().includes(assignRoleKw.toLowerCase()) || (r.description||'').toLowerCase().includes(assignRoleKw.toLowerCase())) : true))
            .map(r => {
              const roleNameMap: Record<string, string> = {
                'Super Admin': '超级管理员',
                'Tenant Admin': '租户管理员',
                'User': '普通用户'
              };
              return { key: r.id, title: roleNameMap[r.name] || r.name, description: r.description };
            })}
          titles={["角色库","已选角色"]}
          targetKeys={assignSelected}
          onChange={(next)=> setAssignSelected(next.map(String))}
          showSearch
          filterOption={(inputValue, item) => {
            const v = inputValue.toLowerCase();
            return (item.title || '').toLowerCase().includes(v) || (item.description || '').toLowerCase().includes(v);
          }}
          style={{ width: '100%' }}
          listStyle={{ flex: '1 1 0', minWidth: 0, height: 420 }}
          render={item => (
            <div style={{ display:'flex', flexDirection:'column' }}>
              <span style={{ fontWeight: 500 }}>{item.title}</span>
              <span style={{ color:'#888', fontSize: 12 }}>{item.description || '—'}</span>
            </div>
          )}
        />
        <div style={{ marginTop: 8, fontSize: 12, color: '#888' }}>保存将同步新增与移除的角色赋权</div>
      </StdSideDrawer>
    </PageContainer>
  );
};

export default AccessUsersPage;
