import React, { useEffect, useMemo, useState } from 'react';
import { Breadcrumb, Button, Card, Form, Input, Select, Space, Table, Tag, Divider, Dropdown, Transfer, message } from 'antd';
import StdSideDrawer from '../../../components/StdSideDrawer';
import StdFormModal from '../../../components/StdFormModal';
import { LockOutlined, PlusOutlined, EllipsisOutlined, DeleteOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import PageContainer from '../../../components/PageContainer';
import '../../common/filters.css';
import { GROUPS, groupOf, featureLabelOf } from '../../../catalogs/navCatalog';

type RBACRole = {
  id: string;
  name: string;
  description?: string;
  scope: 'system' | 'tenant';
  permissions?: string;
  status: 'active' | 'inactive';
  createdAt?: string;
  updatedAt?: string;
};

type Policy = {
  id: string;
  name: string;
  type: '系统策略' | '自定义策略';
  description?: string;
  actions: string[];
  groups: string[];
};
const normalizeGroupName = (g: string): string => g;
const featureNameOf = (resource: string): string => featureLabelOf(resource);

const mapGroupOf = (val: string): string => groupOf(val);

const computeSystemPoliciesFrom = (actions: string[]): Policy[] => {
  const byGroup = new Map<string, string[]>();
  actions.forEach(a => {
    const g = mapGroupOf(a);
    const arr = byGroup.get(g) || [];
    arr.push(a);
    byGroup.set(g, arr);
  });
  const list: Policy[] = [];
  Array.from(byGroup.entries()).forEach(([group, arr]) => {
    const readActions = arr.filter(a => a.endsWith(':read'));
    const writeActions = arr.filter(a => a.endsWith(':write'));
    if (arr.length) {
      list.push({
        id: `sys-${group}-full`,
        name: `${group}-全部权限`,
        type: '系统策略',
        description: `授权「${group}」分组下的所有功能的全部权限（包含 read、write）`,
        actions: Array.from(new Set(arr)),
        groups: [group]
      });
    }
    if (readActions.length) {
      list.push({
        id: `sys-${group}-ro`,
        name: `${group}-只读权限`,
        type: '系统策略',
        description: `授权「${group}」分组下的所有功能的只读权限（仅 read 操作）`,
        actions: Array.from(new Set(readActions)),
        groups: [group]
      });
    }
    if (writeActions.length) {
      list.push({
        id: `sys-${group}-write`,
        name: `${group}-写入权限`,
        type: '系统策略',
        description: `授权「${group}」分组下的所有功能的写入权限（仅 write 操作）`,
        actions: Array.from(new Set(writeActions)),
        groups: [group]
      });
    }
  });
  return list;
};

 

const AccessRolesPage: React.FC = () => {
  const [roles, setRoles] = useState<RBACRole[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm] = Form.useForm();
  const [roleKw, setRoleKw] = useState('');
  const [activeGroup, setActiveGroup] = useState<string>('全部');
  const [kw, setKw] = useState('');
  const [permVerb, setPermVerb] = useState<'全部'|'read'|'write'>('全部');
  const [grantType, setGrantType] = useState<'all' | '系统策略' | '自定义策略'>('all');
  const [type, setType] = useState<'all' | '系统策略' | '自定义策略'>('all');
  const [selectedPolicyIds, setSelectedPolicyIds] = useState<string[]>([]);
  const [actionAtoms, setActionAtoms] = useState<string[]>([]);
  const [policies, setPolicies] = useState<Policy[]>(() => {
    try {
      const raw = localStorage.getItem('ct_policies_custom') || '[]';
      const arr: Policy[] = JSON.parse(raw) || [];
      return arr;
    } catch { return []; }
  });
  const [grantOpen, setGrantOpen] = useState(false);
  const [grantTarget, setGrantTarget] = useState<RBACRole | null>(null);
  const [grantSelectedIds, setGrantSelectedIds] = useState<string[]>([]);

  const groups = GROUPS;

  const filteredPolicies = useMemo(() => {
    const lower = kw.toLowerCase();
    return policies.filter(p => (type==='all' || p.type===type) && p.groups.includes(activeGroup) && (p.name.toLowerCase().includes(lower) || (p.description||'').toLowerCase().includes(lower)));
  }, [policies, type, activeGroup, kw]);

  const policyRows = filteredPolicies.map(p => ({ key: p.id, name: p.name, type: p.type, desc: p.description }));

  const fetchRoles = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/system/rbac/roles', { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
      const data = await res.json();
      setRoles(data.roles || []);
    } catch {}
  };

  useEffect(() => { fetchRoles(); }, []);

  useEffect(() => {
    const loadActions = async () => {
      try {
        const token = localStorage.getItem('token');
        const resp = await fetch('/api/system/rbac/actions', { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
        let arr: string[] = [];
        try { const json = await resp.json(); arr = Array.isArray(json?.actions) ? json.actions : []; } catch {}
        setActionAtoms(arr);
      } catch {
        setActionAtoms([]);
      }
    };
    loadActions();
  }, []);

  useEffect(() => {
    const sys = computeSystemPoliciesFrom(actionAtoms);
    try {
      const raw = localStorage.getItem('ct_policies_custom') || '[]';
      const custom: Policy[] = JSON.parse(raw) || [];
      setPolicies([...custom, ...sys]);
    } catch {
      setPolicies(sys);
    }
  }, [actionAtoms]);

  // 三权默认角色：审计员（只读）、运维操作员（只读+运维写）、策略管理员（只读+管理写）
  useEffect(() => {
    const seedDefaults = async () => {
      if (!actionAtoms.length) return;
      try {
        const names = new Set(roles.map(r => r.name));
        const need: { name: string; description: string; permissions: string[] }[] = [];
        const allRead = actionAtoms.filter(a => a.endsWith(':read'));
        const opGroups = new Set(['资源控制台','流量编排','跨地域互联','安全运营','安全管理面']);
        const mgmtGroups = new Set(['租户管理','售卖管理']);
        const writeOps = actionAtoms.filter(a => a.endsWith(':write') && opGroups.has(mapGroupOf(a)));
        const writeMgmt = actionAtoms.filter(a => a.endsWith(':write') && mgmtGroups.has(mapGroupOf(a)));
        const defs = [
          { name: '三权-审计员', description: '仅具备各分组的只读权限，用于安全审计与合规检查', permissions: Array.from(new Set(allRead)) },
          { name: '三权-运维操作员', description: '具备运维相关分组的写入权限，并具备全局只读权限', permissions: Array.from(new Set([...allRead, ...writeOps])) },
          { name: '三权-策略管理员', description: '具备管理分组的写入权限，并具备全局只读权限；用于策略与资源管理', permissions: Array.from(new Set([...allRead, ...writeMgmt])) },
        ];
        const token = localStorage.getItem('token');
        for (const d of defs) {
          if (!names.has(d.name)) {
            await fetch('/api/system/rbac/roles', {
              method: 'POST',
              headers: { 'Content-Type':'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
              body: JSON.stringify({ name: d.name, description: d.description, scope: 'system', permissions: d.permissions })
            });
          }
        }
        fetchRoles();
      } catch {}
    };
    seedDefaults();
  }, [roles, actionAtoms]);

  const handleCreate = async () => {
    const vals = await createForm.validateFields();
    const payload = { name: vals.name, description: vals.description || '' };
    const token = localStorage.getItem('token');
    const res = await fetch('/api/system/rbac/roles', { method:'POST', headers: { 'Content-Type':'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(payload) });
    if (res.ok) {
      const role = await res.json();
      setCreateOpen(false);
      createForm.resetFields();
      fetchRoles();
      setGrantTarget(role);
      const permArr: string[] = (()=>{ try{ return Array.isArray(JSON.parse(String(role?.permissions||'[]'))) ? JSON.parse(String(role?.permissions||'[]')) : []; }catch{ return []; } })();
      const initialIds = policies.filter(p => p.actions.every(a => permArr.includes(a))).map(p => p.id);
      setGrantSelectedIds(initialIds);
      setGrantOpen(true);
    }
  };

  const handleDelete = async (row: RBACRole) => {
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/system/rbac/roles/${row.id}`, { method:'DELETE', headers: token ? { Authorization: `Bearer ${token}` } : undefined });
    if (res.ok) { message.success('已删除'); fetchRoles(); }
    else { try { message.error(await res.text()); } catch { message.error('删除失败'); } }
  };

  const openAuthorize = (row: RBACRole) => {
    setGrantTarget(row);
    let arr: string[] = [];
    const raw: any = (row as any).permissions;
    if (Array.isArray(raw)) { arr = raw as string[]; }
    else if (typeof raw === 'string') { try { arr = JSON.parse(raw || '[]') || []; } catch {} }
    try {
      const mapRaw = localStorage.getItem('ct_role_policies') || '{}';
      const map = JSON.parse(mapRaw || '{}') || {};
      const savedIds: string[] = map[String(row.id)] || [];
      if (savedIds.length) {
        setGrantSelectedIds(savedIds);
      } else {
        const ids = policies.filter(p => p.actions.every(a => arr.includes(a))).map(p => p.id);
        setGrantSelectedIds(ids);
      }
    } catch {
      const ids = policies.filter(p => p.actions.every(a => arr.includes(a))).map(p => p.id);
      setGrantSelectedIds(ids);
    }
    setGrantOpen(true);
  };

  const saveAuthorization = async () => {
    if (!grantTarget) return;
    const actions = Array.from(new Set(grantSelectedIds.flatMap(id => policies.find(p => p.id === id)?.actions || [])));
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/system/rbac/roles/${grantTarget.id}`, { method:'PUT', headers: { 'Content-Type':'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ permissions: actions }) });
    if (res.ok) {
      try {
        const raw = localStorage.getItem('ct_role_policies') || '{}';
        const map = JSON.parse(raw || '{}') || {};
        map[String(grantTarget.id)] = grantSelectedIds;
        localStorage.setItem('ct_role_policies', JSON.stringify(map));
      } catch {}
      message.success('授权已保存');
      setGrantOpen(false);
      setGrantTarget(null);
      fetchRoles();
    }
    else { try { message.error(await res.text()); } catch { message.error('保存失败'); } }
  };

  return (
    <PageContainer
      title="角色管理"
      titleLevel={3}
      subtitle="角色用于将权限策略批量授权给用户或租户，便于统一管理与快速复用。"
      asCard={false}
    >
      <Divider style={{ margin: '0 0 20px 0' }} />
      <div className="filters-row">
        <Form
          className="filter-tools filter-tools--center"
          layout="vertical"
        style={{ rowGap: 12, columnGap: 12, display:'flex', alignItems:'flex-end' }}
        onValuesChange={(_, all) => {
          setRoleKw(all.keyword || '');
        }}
      >
        <Form.Item name="keyword" label="关键字">
          <Input allowClear placeholder="搜索角色名称或说明" style={{ width: 240 }} />
        </Form.Item>
      </Form>
        <div className="filter-actions">
          <Space>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => { setCreateOpen(true); }}>新建角色</Button>
          </Space>
        </div>
      </div>
      <Table
        className="vr-table vr-table--middle"
        rowKey="id"
        size="middle"
        dataSource={roles.filter(r => {
          const matchKw = roleKw ? ((r.name||'').toLowerCase().includes(roleKw.toLowerCase()) || (r.description||'').toLowerCase().includes(roleKw.toLowerCase())) : true;
          return matchKw;
        })}
        columns={[
          { title:'角色名称', dataIndex:'name' },
          { title:'描述', dataIndex:'description', width: 300 },
          { title:'权限', dataIndex:'permissions', width: 600, render:(p:any)=>{ let arr:string[]=[]; if (Array.isArray(p)) { arr = p as string[]; } else if (typeof p === 'string') { try{ arr = JSON.parse(p || '[]') || []; } catch{} } if(!arr.length) return '—'; return (<div style={{ display:'flex', flexWrap:'wrap', gap: 8, maxWidth: 600 }}>{arr.map((it,idx)=> (<Tag key={idx}>{String(it)}</Tag>) )}</div>); } },
          { title:'已分配策略', key:'assignedPolicies', width: 280, render: (_:any, row: RBACRole) => { try { const raw = localStorage.getItem('ct_role_policies') || '{}'; const map = JSON.parse(raw || '{}') || {}; const ids: string[] = map[String(row.id)] || []; if (!ids.length) return '—'; const assigned = policies.filter(p => ids.includes(p.id)); if (!assigned.length) return '—'; return assigned.slice(0,6).map((p,idx)=>(<Tag key={idx}>{p.name}</Tag>)); } catch { return '—'; } } },
          { title:'操作', key:'actions', width: 120, render: (_:any, row: RBACRole) => {
            const items = [
              { key:'auth', label:'授权配置', icon:<SafetyCertificateOutlined />, onClick: () => openAuthorize(row) },
              { key:'del', label:'删除角色', icon:<DeleteOutlined />, onClick: () => handleDelete(row) },
            ].map(it => ({ key: it.key, label: (
              <Space onClick={it.onClick}><span style={{ display:'inline-flex', alignItems:'center' }}>{it.icon}</span><span>{it.label}</span></Space>
            ) }));
            return <Dropdown menu={{ items }} trigger={['click']}><Button type="text" icon={<EllipsisOutlined />} /></Dropdown>;
          } },
        ] as any}
        pagination={{ pageSize: 10, showSizeChanger: true, pageSizeOptions: ['10','20','50'], size: 'default' }}
        scroll={{ x: 'max-content' }}
        bordered
      />

      <StdFormModal title="新建授权角色" open={createOpen} onCancel={()=> setCreateOpen(false)} okText="创建" destroyOnClose width={600} form={createForm} onFinish={handleCreate}>
        <Form.Item name="name" label="角色名称" rules={[{ required: true, message: '请输入角色名称' }]}> 
          <Input placeholder="例如：安全管理员" />
        </Form.Item>
        <Form.Item name="description" label="描述">
          <Input.TextArea placeholder="角色用途说明（可选）" autoSize={{ minRows: 3, maxRows: 6 }} />
        </Form.Item>
      </StdFormModal>

      <StdSideDrawer title="授权配置" open={grantOpen} onClose={()=> { setGrantOpen(false); setGrantTarget(null); }} onOk={saveAuthorization} width={1200}>
        <Form layout="vertical" style={{ display:'flex', gap: 16, marginBottom: 20 }}>
          <Form.Item label="分组" style={{ width: 220, marginBottom: 0 }}>
            <Select value={activeGroup} onChange={(v:any)=> setActiveGroup(v)} options={groups.map(g => ({ value:g, label:g }))} />
          </Form.Item>
          <Form.Item label="策略类型" style={{ width: 160, marginBottom: 0 }}>
            <Select value={grantType} onChange={(v:any)=> setGrantType(v)} options={[{ value:'all', label:'全部' }, { value:'系统策略', label:'系统策略' }, { value:'自定义策略', label:'自定义策略' }]} />
          </Form.Item>
          <Form.Item label="读写" style={{ width: 160, marginBottom: 0 }}>
            <Select value={permVerb} onChange={(v:any)=> setPermVerb(v)} options={[{ value:'全部', label:'全部' }, { value:'read', label:'read' }, { value:'write', label:'write' }]} />
          </Form.Item>
          <Form.Item label="关键字" style={{ flex: 1, marginBottom: 0 }}>
            <Input.Search allowClear placeholder="搜索策略名称或说明" value={kw} onChange={e => setKw(e.target.value)} />
          </Form.Item>
        </Form>
        <Transfer
          dataSource={policies
            .filter(p => (activeGroup==='全部' ? true : p.groups.includes(activeGroup)))
            .filter(p => (grantType==='all' ? true : p.type===grantType))
            .filter(p => (permVerb==='全部' ? true : (permVerb==='read' ? p.actions.some(a => a.endsWith(':read')) : p.actions.some(a => a.endsWith(':write')))))
            .filter(p => ((kw||'') ? ((p.name||'').toLowerCase().includes(kw.toLowerCase()) || (p.description||'').toLowerCase().includes(kw.toLowerCase())) : true))
            .map(p => ({ key: p.id, title: p.name, description: p.description }))}
          titles={["策略库","已选策略"]}
          targetKeys={grantSelectedIds}
          onChange={(next) => setGrantSelectedIds(next.map(String))}
          showSearch
          filterOption={(inputValue, item) => {
            const v = inputValue.toLowerCase();
            return (item.title || '').toLowerCase().includes(v) || (item.description || '').toLowerCase().includes(v);
          }}
          style={{ width: '100%' }}
          listStyle={{ flex: '1 1 0', minWidth: 0, height: 580 }}
          render={item => (
            <div style={{ display:'flex', flexDirection:'column' }}>
              <span style={{ fontWeight: 500 }}>{item.title}</span>
              <span style={{ color:'#888', fontSize: 12 }}>{item.description || '—'}</span>
            </div>
          )}
        />
      </StdSideDrawer>
    </PageContainer>
  );
};

export default AccessRolesPage;
