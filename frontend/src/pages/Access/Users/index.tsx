import React, { useEffect, useMemo, useState } from 'react';
import { Button, Form, Input, Modal, Select, Space, Table, Tag, Transfer, message } from 'antd';
import StdFormModal from '../../../components/StdFormModal';
import StdSideDrawer from '../../../components/StdSideDrawer';
import { ReloadOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import PageContainer from '../../../components/PageContainer';
import ResourceActionsDropdown from '../../../components/ResourceActionsDropdown';
import '../../common/filters.css';

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
  const [rolesByUser, setRolesByUser] = useState<Record<string, string[]>>({});

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const res = await fetch('/api/users', { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
      const json = await res.json();
      setUsers(Array.isArray(json) ? json : Array.isArray(json?.users) ? json.users : []);
    } catch {
      message.error('获取系统用户失败');
    } finally { setLoading(false); }
  };

  const fetchRoles = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/system/rbac/roles', { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
      const json = await res.json();
      setRoles(Array.isArray(json?.roles) ? json.roles : []);
    } catch {}
  };

  useEffect(() => { fetchUsers(); fetchRoles(); }, []);

  useEffect(() => {
    const run = async () => {
      if (!users.length || !roles.length) return;
      try {
        const token = localStorage.getItem('token');
        const resps = await Promise.all(users.map(u => fetch(`/api/system/rbac/assignments?userType=system&userId=${encodeURIComponent(u.id)}`, { headers: token ? { Authorization: `Bearer ${token}` } : undefined })));
        const jsons = await Promise.all(resps.map(r => r.json().catch(() => ({ assignments: [] }))));
        const next: Record<string, string[]> = {};
        users.forEach((u, i) => {
          const list: Assignment[] = Array.isArray(jsons[i]?.assignments) ? jsons[i].assignments : [];
          const ids = list.map(it => it.roleId);
          const names = ids.map(id => roles.find(r => r.id === id)?.name).filter(Boolean) as string[];
          next[u.id] = names;
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

  const openAssign = async (u: SysUser) => {
    if (u.username === 'admin') { message.warning('系统管理员不支持修改权限'); return; }
    try {
      setAssignUser(u);
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/system/rbac/assignments?userType=system&userId=${encodeURIComponent(u.id)}`, { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
      const json = await res.json();
      const list: Assignment[] = Array.isArray(json?.assignments) ? json.assignments : [];
      setAssignExisting(list);
      const selected = list.map(it => it.roleId);
      setAssignSelected(selected);
      setAssignOpen(true);
    } catch {}
  };

  const saveAssign = async () => {
    if (!assignUser) return;
    const token = localStorage.getItem('token');
    const current = new Set(assignExisting.map(x => x.roleId));
    const needAdd = assignSelected.filter(id => !current.has(id));
    const needRemove = assignExisting.filter(x => !assignSelected.includes(x.roleId));
    try {
      for (const roleId of needAdd) {
        await fetch('/api/system/rbac/assignments', { method:'POST', headers: { 'Content-Type':'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ roleId, userType:'system', userId: assignUser.id }) });
      }
      for (const it of needRemove) {
        await fetch(`/api/system/rbac/assignments/${encodeURIComponent(it.id)}`, { method:'DELETE', headers: token ? { Authorization: `Bearer ${token}` } : undefined });
      }
      message.success('角色赋权已保存');
      setAssignOpen(false); setAssignUser(null); setAssignExisting([]); setAssignSelected([]);
      fetchUsers();
    } catch { message.error('保存失败'); }
  };

  const handleCreate = async () => {
    const vals = await createForm.validateFields();
    const token = localStorage.getItem('token');
    const res = await fetch('/api/users', { method:'POST', headers: { 'Content-Type':'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(vals) });
    if (res.ok) { message.success('系统用户创建成功'); setCreateOpen(false); createForm.resetFields(); fetchUsers(); }
    else { try { message.error(await res.text()); } catch { message.error('创建失败'); } }
  };

  return (
    <PageContainer
      titleLevel={3}
      asCard={false}
    >
      <div className="filters-row">
        <Form 
          form={filterForm}
          className="filter-tools filter-tools--center" 
          layout="vertical" 
          style={{ rowGap: 12, columnGap: 12, display:'flex', alignItems:'flex-end' }} 
          onValuesChange={(_,all)=> { setKw(all.keyword||''); setStatusFilter(all.status||'active'); }}
        >
          <Form.Item name="keyword" label="关键字"><Input allowClear placeholder="搜索用户名/姓名/邮箱" style={{ width: 240 }} /></Form.Item>
          <Form.Item name="status" label="状态" initialValue={statusFilter}><Select allowClear placeholder="全部" style={{ width: 160 }} options={[{ value:'all', label:'全部' }, { value:'active', label:'活跃' }, { value:'inactive', label:'非活跃' }, { value:'suspended', label:'暂停' }]} /></Form.Item>
          <a className="filter-reset-link" onClick={() => {
            setKw('');
            setStatusFilter('active');
            filterForm.resetFields();
            filterForm.setFieldsValue({ status: 'active' });
          }}>重置</a>
        </Form>
        <div className="filter-actions">
          <Space>
            <Button type="primary" onClick={() => { const rand = `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`; createForm.setFieldsValue({ username: rand }); setCreateOpen(true); }}>新建系统用户</Button>
            <Button icon={<ReloadOutlined />} onClick={fetchUsers} />
          </Space>
        </div>
      </div>

      <Table
        className="vr-table"
        rowKey="id"
        loading={loading}
        dataSource={filteredUsers}
        columns={[
          { title:'姓名', dataIndex:'fullName' },
          { title:'用户名', dataIndex:'username' },
          { title:'邮箱', dataIndex:'email' },
          { title:'类型', dataIndex:'builtIn', render: (_: any, row: SysUser) => { const b = (typeof row.builtIn === 'boolean') ? row.builtIn : (row.username === 'admin'); return <Tag color={b?'blue':'default'}>{b?'内置':'自定义'}</Tag>; } },
          { title:'角色', dataIndex:'roles', render: (_: any, row: SysUser) => {
            const assigned = rolesByUser[row.id] || [];
            const sysMap: Record<string,string> = { super_admin:'超级管理员', leased_lines_admin:'管理员', tenant:'系统用户' };
            const sys = sysMap[row.role];
            const all = sys ? [sys, ...assigned] : assigned;
            return all.length ? <Space wrap>{all.map(n => <Tag key={n}>{n}</Tag>)}</Space> : <span>-</span>;
          } },
          { title:'状态', dataIndex:'status', render:(s:string)=> <Tag color={s==='active'?'green':s==='suspended'?'orange':'default'}>{ s==='active'?'活跃': s==='suspended'?'暂停':'非活跃' }</Tag> },
          { title:'操作', key:'actions', render: (_:any, row: SysUser) => {
            const itemsRaw = [
              { key:'assign', label:'配置角色', icon:<SafetyCertificateOutlined />, onClick: () => openAssign(row) },
              { key:'edit', label:'编辑用户', onClick: () => { setEditingUser(row); setIsEditingAdmin(row.username === 'admin'); editForm.setFieldsValue({ fullName: row.fullName, username: row.username, email: row.email, role: row.role, status: row.status }); setEditOpen(true); } },
              { type: 'divider' },
              { key:'del', label:'删除用户', danger: true, onClick: async () => { const token = localStorage.getItem('token'); const res = await fetch(`/api/users/${row.id}`, { method:'DELETE', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) } }); if (res.ok) { message.success('删除成功'); fetchUsers(); } else { try { message.error(await res.text()); } catch { message.error('删除失败'); } } } },
            ];
            const built = (typeof row.builtIn === 'boolean') ? row.builtIn : (row.username === 'admin');
            const items = itemsRaw
              .filter(it => built ? (it.key === 'edit') : true);
            
            return <ResourceActionsDropdown items={items as any} />;
          } }
        ] as any}
        pagination={{ pageSize: 10, showSizeChanger: true, pageSizeOptions: ['10','20','50'], size: 'default' }}
        scroll={{ x: 'max-content' }}
        bordered
      />

      <StdFormModal title="新建系统用户" open={createOpen} onCancel={()=> setCreateOpen(false)} okText="创建" width={600} form={createForm} onFinish={handleCreate}>
        <Form.Item name="fullName" label="姓名" rules={[{ required: true, message: '请输入姓名' }]}> 
          <Input placeholder="例如：运维管理员" />
        </Form.Item>
        <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}> 
          <Input placeholder="例如：ops_admin" />
        </Form.Item>
        <Form.Item name="email" label="邮箱" rules={[{ type:'email', message: '请输入有效邮箱' }]}> 
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
        const token = localStorage.getItem('token');
        const body = isEditingAdmin
          ? { email: vals.email, password: vals.password }
          : { fullName: vals.fullName, username: vals.username, email: vals.email, status: vals.status, password: vals.password };
        const res = await fetch(`/api/users/${editingUser.id}`, { method:'PUT', headers: { 'Content-Type':'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
        if (res.ok) { message.success('用户更新成功'); setEditOpen(false); setEditingUser(null); setIsEditingAdmin(false); fetchUsers(); }
        else { try { message.error(await res.text()); } catch { message.error('更新失败'); } }
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
            <Select value={assignScope} onChange={(v:any)=> setAssignScope(v)} options={[{ value:'all', label:'全部' }, { value:'system', label:'系统' }, { value:'tenant', label:'租户' }]} />
          </Form.Item>
          <Form.Item label="状态" style={{ width: 160, marginBottom: 0 }}>
            <Select value={assignStatus} onChange={(v:any)=> setAssignStatus(v)} options={[{ value:'all', label:'全部' }, { value:'active', label:'活跃' }, { value:'inactive', label:'非活跃' }]} />
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
            .map(r => ({ key: r.id, title: r.name, description: r.description }))}
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
