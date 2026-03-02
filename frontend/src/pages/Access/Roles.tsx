import React, { useEffect, useMemo, useState } from 'react';
import { Button, Form, Input, Select, Table, Dropdown, message, Popover, Modal } from 'antd';
import StdSideDrawer from '../../components/StdSideDrawer';
import StdFormModal from '../../components/StdFormModal';
import { EllipsisOutlined, ReloadOutlined } from '@ant-design/icons';
import PageContainer from '../../components/PageContainer';
import { featureLabelOf } from '../../catalogs/navCatalog';
import PermissionTreeTransfer from '../../components/TreeTransfer';
import TableColumnSettings from '../../components/TableColumnSettings';

// 角色数据结构定义
type RBACRole = {
  id: string;
  name: string;
  description?: string;
  scope: 'system' | 'tenant'; // 角色范围：系统级或租户级
  permissions?: string;       // 权限字符串 (JSON)
  actions?: string[];         // 权限原子列表
  type?: '系统策略' | '自定义策略'; // 角色类型：系统角色(预置)或自定义角色
  status: 'active' | 'inactive';
  createdAt?: string;
  updatedAt?: string;
};

// 获取功能模块名称
const featureNameOf = (resource: string): string => featureLabelOf(resource);

// 将权限原子转换为可读描述
const describeAction = (action: string): string => {
  const [resource, op] = String(action).split(':');
  const f = featureNameOf(resource || action);
  // 特殊资源的自定义描述
  if (resource?.startsWith('tenants.leased-lines.list')) {
    if (op === 'read') return '查看专线列表与详情';
  }
  if (resource?.startsWith('tenants.leased-lines.manage')) {
    if (op === 'write') return '创建、修改、删除租户专线记录';
  }
  if (resource?.startsWith('tenants.leased-lines.reports')) {
    if (op === 'read') return '查看任务进度、下载安全报告';
    if (op === 'write') return '创建、取消、删除安全报告任务';
  }
  if (resource?.startsWith('tenants.leased-lines.alert-logs')) {
    if (op === 'read') return '查看告警日志文件和分析输入';
  }
  // 通用描述生成
  if (op === 'read') return `查看${f}列表与详情`;
  if (op === 'write') return `创建、修改、删除${f}`;
  return `${f}操作`;
};

const AccessRolesPage: React.FC = () => {
  // 状态管理
  const [roles, setRoles] = useState<RBACRole[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm] = Form.useForm();
  const [filterForm] = Form.useForm();
  
  // 筛选状态
  const [roleKw, setRoleKw] = useState('');
  const [roleType, setRoleType] = useState<string>('全部');
  
  // 授权抽屉状态
  const [kw, setKw] = useState('');
  const [permVerb, setPermVerb] = useState<'全部'|'read'|'write'>('全部');
  const [actionAtoms, setActionAtoms] = useState<string[]>([]);
  const [grantOpen, setGrantOpen] = useState(false);
  const [grantTarget, setGrantTarget] = useState<RBACRole | null>(null);
  const [grantSelectedIds, setGrantSelectedIds] = useState<string[]>([]);
  
  // 表格选择与列配置
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [displayedColumns, setDisplayedColumns] = useState<any[]>([]);

  // 获取角色列表
  const fetchRoles = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/system/rbac/roles', { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
      const data = await res.json();
      if (Array.isArray(data)) {
        setRoles(data);
      } else {
        setRoles(data.roles || []);
      }
    } catch {}
  };

  // 初始化加载
  useEffect(() => { fetchRoles(); }, []);

  // 加载系统权限原子
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

  // 处理角色创建
  const handleCreate = async () => {
    const vals = await createForm.validateFields();
    const payload = { name: vals.name, description: vals.description || '', scope: vals.scope };
    const token = localStorage.getItem('token');
    const res = await fetch('/api/system/rbac/roles', { method:'POST', headers: { 'Content-Type':'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(payload) });
    if (res.ok) {
      const role = await res.json();
      message.success('角色创建成功');
      setCreateOpen(false);
      createForm.resetFields();
      fetchRoles();
      // 创建后直接打开授权界面
      setGrantTarget(role);
      const permArr: string[] = (()=>{ try{ return Array.isArray(JSON.parse(String(role?.permissions||'[]'))) ? JSON.parse(String(role?.permissions||'[]')) : []; }catch{ return []; } })();
      setGrantSelectedIds(permArr);
      setGrantOpen(true);
    } else {
      try {
        const err = await res.json();
        message.error(err.message || '创建角色失败');
      } catch {
        message.error('创建角色失败');
      }
    }
  };

  // 处理角色删除
  const handleDelete = async (row: RBACRole) => {
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/system/rbac/roles/${row.id}`, { method:'DELETE', headers: token ? { Authorization: `Bearer ${token}` } : undefined });
    if (res.ok) { message.success('已删除'); fetchRoles(); }
    else { try { message.error(await res.text()); } catch { message.error('删除失败'); } }
  };

  // 打开授权配置抽屉
  const openAuthorize = (row: RBACRole) => {
    setGrantTarget(row);
    let arr: string[] = [];
    if (Array.isArray(row.actions)) { arr = row.actions; }
    else {
      const raw: any = (row as any).permissions;
      if (Array.isArray(raw)) { arr = raw as string[]; }
      else if (typeof raw === 'string') { try { arr = JSON.parse(raw || '[]') || []; } catch {} }
    }
    setGrantSelectedIds(arr);
    setGrantOpen(true);
  };

  // 保存授权配置
  const saveAuthorization = async () => {
    if (!grantTarget) return;
    const actions = Array.from(new Set(grantSelectedIds));
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/system/rbac/roles/${grantTarget.id}`, { method:'PUT', headers: { 'Content-Type':'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ permissions: actions }) });
    if (res.ok) {
      message.success('授权已保存');
      setGrantOpen(false);
      setGrantTarget(null);
      fetchRoles();
    }
    else { try { message.error(await res.text()); } catch { message.error('保存失败'); } }
  };

  // 角色列表表格
  const fullColumns = useMemo(() => [
    { title: '角色名称', dataIndex: 'name', key: 'name', width: 200, render: (t: any) => <span>{t}</span> },
    // 角色类型：映射后端"系统策略"为"系统角色"
    { title: '类型', dataIndex: 'type', key: 'type', render: (t: any) => <span className={`std-badge ${t === '系统策略' ? 'std-badge-info' : 'std-badge-success'}`}>{t === '系统策略' ? '系统角色' : (t === '自定义策略' ? '自定义角色' : t)}</span> },
    { title: '描述', dataIndex: 'description', key: 'description', ellipsis: true },
    // { title: '范围', dataIndex: 'scope', key: 'scope', width: 100, render: (t: any) => t === 'system' ? '系统' : '租户' }, // 已根据需求移除
    { title: '权限数', key: 'perms', width: 100, render: (_: any, r: RBACRole) => {
        let acts: string[] = [];
        if (Array.isArray(r.actions)) acts = r.actions;
        else if (Array.isArray((r as any).permissions)) acts = (r as any).permissions;
        else if (typeof r.permissions === 'string') { try { acts = JSON.parse(r.permissions) } catch { } }
        
        const c = acts.length;
        if (c === 0) return 0;
        
        return (
          <Popover 
            title={`权限列表 (${c})`} 
            content={
              <div style={{ maxHeight: '300px', overflowY: 'auto', maxWidth: '300px' }}>
                {acts.map((a, i) => <div key={i} style={{ padding: '4px 0', borderBottom: '1px solid #f0f0f0' }}>{a}</div>)}
              </div>
            }
          >
            <span className="stat-trigger">{c}</span>
          </Popover>
        );
    }},
    { title: '操作', key: 'actions', width: 80, fixed: 'right' as const, render: (_: any, r: RBACRole) => {
        const items = [
          { key: 'auth', label: '授权配置', onClick: () => openAuthorize(r) },
          { type: 'divider' },
          { key: 'del', label: '删除角色', danger: true, onClick: () => handleDelete(r) },
        ];
        return <Dropdown menu={{ items: items as any }} trigger={['click']}><Button type="text" icon={<EllipsisOutlined />} className="row-actions-trigger" /></Dropdown>;
    }}
  ], [openAuthorize, handleDelete]);

  return (
    <PageContainer
      titleLevel={3}
      asCard={false}
    >
      <div className="page-toolbar">
        {/* 筛选工具栏 */}
        <Form
          className="toolbar-container"
          layout="vertical"
          style={{ display:'flex', alignItems:'flex-end', rowGap:12, columnGap:12 }}
          onValuesChange={(_, all) => {
            setRoleKw(all.keyword || '');
            setRoleType(all.type || '全部');
          }}
        >
          <Form.Item name="keyword" label="关键字">
            <Input allowClear placeholder="搜索角色名称或说明" className="toolbar-search" />
          </Form.Item>
          <Form.Item name="type" label="类型">
            <Select className="toolbar-filter" placeholder="全部类型" defaultValue="全部">
              <Select.Option value="全部">全部类型</Select.Option>
              <Select.Option value="系统策略">系统角色</Select.Option>
              <Select.Option value="自定义策略">自定义角色</Select.Option>
            </Select>
          </Form.Item>
          <a className="toolbar-reset-btn" onClick={() => { filterForm.resetFields(); setRoleKw(''); setRoleType('全部'); }}>重置</a>
        </Form>
        
        {/* 操作按钮区 */}
        <div className="toolbar-actions">
          <Button type="primary" onClick={() => { setCreateOpen(true); }}>新建角色</Button>
          <Dropdown menu={{ 
            items: [
              { key: 'delete', label: '批量删除', danger: true, onClick: () => {
                if (!selectedRowKeys.length) return message.warning('请先选择角色');
                Modal.confirm({
                  title: '确认批量删除？',
                  content: `即将删除 ${selectedRowKeys.length} 个角色`,
                  okButtonProps: { danger: true },
                  onOk: async () => {
                    // TODO: Implement batch delete
                    message.success('已触发批量删除（演示）');
                    setSelectedRowKeys([]);
                  }
                });
              }}
            ] 
          }} trigger={['click']}>
            <Button icon={<EllipsisOutlined />} />
          </Dropdown>
          <TableColumnSettings 
            columns={fullColumns} 
            onChange={setDisplayedColumns} 
            settingsKey="access_roles_table"
          />
          <Button icon={<ReloadOutlined />} onClick={fetchRoles} />
        </div>
      </div>
      
      {/* 角色列表表格 */}
      <Table
        className="std-table"
        rowKey="id"
        rowSelection={{
          selectedRowKeys,
          onChange: setSelectedRowKeys
        }}
        dataSource={roles.filter(r => {
          const matchKw = roleKw ? ((r.name||'').toLowerCase().includes(roleKw.toLowerCase()) || (r.description||'').toLowerCase().includes(roleKw.toLowerCase())) : true;
          const matchType = roleType === '全部' ? true : r.type === roleType;
          return matchKw && matchType;
        })}
        columns={displayedColumns.length > 0 ? displayedColumns : fullColumns}
        pagination={{ size: 'small', showSizeChanger: true, pageSize: 10, pageSizeOptions: ['10','20','50','100'], showQuickJumper: false }}
        scroll={{ x: 'max-content' }}
        bordered
      />

      {/* 新建角色模态框 */}
      <StdFormModal title="新建授权角色" open={createOpen} onCancel={()=> setCreateOpen(false)} okText="创建" destroyOnHidden width={600} form={createForm} onFinish={handleCreate}>
        <Form.Item name="name" label="角色名称" rules={[{ required: true, message: '请输入角色名称' }]}>
          <Input placeholder="例如：安全管理员" />
        </Form.Item>
        <Form.Item name="scope" label="角色范围" rules={[{ required: true, message: '请选择角色范围' }]}>
          <Select placeholder="请选择角色范围">
            <Select.Option value="system">系统角色</Select.Option>
            <Select.Option value="tenant">租户角色</Select.Option>
          </Select>
        </Form.Item>
        <Form.Item name="description" label="描述">
          <Input.TextArea placeholder="角色用途说明（可选）" autoSize={{ minRows: 3, maxRows: 6 }} />
        </Form.Item>
      </StdFormModal>

      {/* 授权配置抽屉 */}
      <StdSideDrawer title="授权配置" open={grantOpen} onClose={()=> { setGrantOpen(false); setGrantTarget(null); }} onOk={saveAuthorization} width={1200} styles={{ body: { display: 'flex', flexDirection: 'column', overflow: 'hidden' } }}>
        <Form layout="vertical" style={{ display:'flex', gap: 16, marginBottom: 20 }}>
          <Form.Item label="读写" style={{ width: 160, marginBottom: 0 }}>
            <Select value={permVerb} onChange={(v:any)=> setPermVerb(v)} options={[{ value:'全部', label:'全部' }, { value:'read', label:'read' }, { value:'write', label:'write' }]} />
          </Form.Item>
          <Form.Item label="关键字" style={{ flex: 1, marginBottom: 0 }}>
            <Input.Search allowClear placeholder="搜索权限原子" value={kw} onChange={e => setKw(e.target.value)} />
          </Form.Item>
        </Form>
        <PermissionTreeTransfer
          dataSource={(() => {
            const base = actionAtoms
              .filter(a => permVerb === '全部' || a.endsWith(`:${permVerb}`))
              .filter(a => (kw||'').length === 0 || a.toLowerCase().includes(kw.toLowerCase()))
              .map(a => ({ key: a, title: a, description: describeAction(a) }));
            const selected = (grantSelectedIds || []).map(k => ({ key: String(k), title: String(k), description: describeAction(String(k)) }));
            const map = new Map<string, any>();
            [...base, ...selected].forEach(it => { map.set(String(it.key), it); });
            return Array.from(map.values());
          })()}
          targetKeys={grantSelectedIds}
          onChange={(next) => setGrantSelectedIds(next)}
          titles={["权限原子 (层级视图)","已选权限"]}
          style={{ width: '100%', flex: 1, overflow: 'hidden' }}
          listStyle={{ flex: '1 1 0', minWidth: 0, height: '100%' }}
        />
      </StdSideDrawer>
    </PageContainer>
  );
};

export default AccessRolesPage;
