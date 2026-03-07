import React, { useEffect, useMemo, useState } from 'react';
import { Button, Form, Input, Select, Table, Dropdown, message, Popover, Modal, Space, Tag, Popconfirm, Typography } from 'antd';
import { EllipsisOutlined, ReloadOutlined } from '@ant-design/icons';
import StdSideDrawer from '../../components/StdSideDrawer';
import StdFormModal from '../../components/StdFormModal';
import PageContainer from '../../components/PageContainer';
import { featureLabelOf } from '../../constants/navCatalog';
import PermissionTreeTransfer from '../../components/TreeTransfer';
import { useTableColumnSettings } from '../../hooks/useTableColumnSettings';
import TableColumnSettingsButton from '../../components/TableColumnSettingsButton';

const { Text } = Typography;

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
  
  // 角色列表表格
  const fullColumns = useMemo(() => [
    { title:'角色名称', key:'name', dataIndex:'name', width:180, render: (v:any, row: RBACRole) => (
      <Space>
        { row.scope === 'system' ? <Tag color="blue">System</Tag> : <Tag color="green">Tenant</Tag> }
        <Text strong>{v}</Text>
      </Space>
    ) },
    { title:'描述', key:'description', dataIndex:'description', ellipsis:true },
    { title:'创建时间', key:'createdAt', dataIndex:'createdAt', width:180, render: (v:string) => v ? new Date(v).toLocaleString() : '-' },
    { title:'操作', key:'action', width:150, fixed:'right' as const, render: (_:any, row: RBACRole) => (
      <Space>
        <Button type="link" size="small" onClick={() => openAuthorize(row)}>授权</Button>
        <Popconfirm title="确认删除？" onConfirm={() => handleDelete(row)}>
          <Button type="link" size="small" danger disabled={row.scope==='system'}>删除</Button>
        </Popconfirm>
      </Space>
    ) },
  ], []);

  // 使用新的 hook 管理列设置
  const { displayColumns: displayedColumns } = useTableColumnSettings(fullColumns, 'access_roles_table');

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
  const handleCreate = React.useCallback(async () => {
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
  }, [createForm]);

  // 提交授权
  const handleGrantSave = React.useCallback(async (targetKeys: string[]) => {
    if (!grantTarget) return;
    const res = await fetch(`/api/system/rbac/roles/${grantTarget.id}/permissions`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
      body: JSON.stringify({ permissions: targetKeys })
    });
    if (res.ok) {
      message.success('授权成功');
      setGrantOpen(false);
      fetchRoles();
    }
    else { try { message.error(await res.text()); } catch { message.error('保存失败'); } }
  }, [grantTarget]);

  const openAuthorize = React.useCallback((role: RBACRole) => {
    setGrantTarget(role);
    setGrantSelectedIds(role.actions || []);
    setGrantOpen(true);
  }, []);

  const handleDelete = React.useCallback(async (role: RBACRole) => {
    const res = await fetch(`/api/system/rbac/roles/${role.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
    if (res.ok) { message.success('删除成功'); fetchRoles(); }
    else { message.error('删除失败'); }
  }, []);

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
          form={filterForm}
          initialValues={{ type: '全部' }}
          onValuesChange={(_, all) => {
            setRoleKw(all.keyword || '');
            setRoleType(all.type || '全部');
          }}
        >
          <Form.Item name="keyword" label="关键字">
            <Input allowClear placeholder="搜索角色名称或说明" className="toolbar-search" />
          </Form.Item>
          <Form.Item name="type" label="类型">
            <Select className="toolbar-filter" placeholder="全部类型">
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
          <TableColumnSettingsButton
            allColumns={fullColumns}
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
          // type 筛选逻辑可能需要根据实际数据调整，这里假设前端不做严格过滤或数据源已有 type 字段
          // 如果数据源没有 type 字段，可能需要根据 scope 或其他属性推断
          const matchType = roleType === '全部' ? true : (r.type === roleType || (roleType === '系统策略' && r.scope === 'system') || (roleType === '自定义策略' && r.scope === 'tenant'));
          return matchKw && matchType;
        })}
        columns={displayedColumns}
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
      <StdSideDrawer title="授权配置" open={grantOpen} onClose={()=> { setGrantOpen(false); setGrantTarget(null); }} onOk={() => handleGrantSave(grantSelectedIds)} width={1200} styles={{ body: { display: 'flex', flexDirection: 'column', overflow: 'hidden' } }}>
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
