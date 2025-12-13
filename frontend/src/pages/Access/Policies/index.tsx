import React, { useMemo, useState, useEffect } from 'react';
import { Button, Card, Form, Input, Modal, Select, Space, Table, Tag, Typography, Menu, Alert, Divider, Dropdown, Transfer } from 'antd';
import StdSideDrawer from '../../../components/StdSideDrawer';
import { LockOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import axios from 'axios';
import PageContainer from '../../../components/PageContainer';
import StdFormModal from '../../../components/StdFormModal';
import '../../common/filters.css';
import { PLATFORMS, GROUPS, platformOf, groupOf, featureLabelOf } from '../../../catalogs/navCatalog';

type Policy = {
  id: string;
  name: string;
  type: '系统策略' | '自定义策略';
  description?: string;
  actions: string[];
  groups: string[];
};

const mapGroupOf = (val: string): string => groupOf(val);

const featureNameOf = (resource: string): string => featureLabelOf(resource);

const describeAction = (action: string): string => {
  const [resource, op] = String(action).split(':');
  const f = featureNameOf(resource || action);
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
  if (op === 'read') return `查看${f}列表与详情`;
  if (op === 'write') return `创建、修改、删除${f}`;
  return `${f}操作`;
};

const mapPlatformOf = (val: string): string => platformOf(val);

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

 

const AccessPoliciesPage: React.FC = () => {
  const [policies, setPolicies] = useState<Policy[]>(() => {
    try {
      const raw = localStorage.getItem('ct_policies_custom') || '[]';
      const custom = JSON.parse(raw);
      return custom;
    } catch {
      return [];
    }
  });
  const [actionAtoms, setActionAtoms] = useState<string[]>([]);
  const [activeGroup, setActiveGroup] = useState<string>('全部');
  const [kw, setKw] = useState('');
  const [type, setType] = useState<'all' | '系统策略' | '自定义策略'>('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm] = Form.useForm();
  const [selectedActions, setSelectedActions] = useState<string[]>([]);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<Policy | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignPolicy, setAssignPolicy] = useState<Policy | null>(null);
  const [assignTargetKeys, setAssignTargetKeys] = useState<React.Key[]>([]);
  const [assignKw, setAssignKw] = useState('');
  const [assignGroup, setAssignGroup] = useState<string>('全部');
  const [assignPlatform, setAssignPlatform] = useState<string>('全部');
  const [assignFeature, setAssignFeature] = useState<string>('全部');
  const [assignVerb, setAssignVerb] = useState<string>('全部');
  const featureOptions = useMemo(() => {
    const base = actionAtoms
      .filter(a => assignPlatform === '全部' || mapPlatformOf(a) === assignPlatform)
      .filter(a => assignGroup === '全部' || mapGroupOf(a) === assignGroup)
      .filter(a => assignVerb === '全部' || a.endsWith(`:${assignVerb}`));
    const set = new Set<string>();
    base.forEach(a => set.add(featureNameOf(a.split(':')[0] || a)));
    return ['全部', ...Array.from(set)];
  }, [actionAtoms, assignPlatform, assignGroup, assignVerb]);

  useEffect(() => {
    try {
      const custom = policies.filter(p => p.type === '自定义策略');
      localStorage.setItem('ct_policies_custom', JSON.stringify(custom));
    } catch {}
  }, [policies]);

  useEffect(() => {
    const loadActions = async () => {
      try {
        const token = localStorage.getItem('token');
        const resp = await axios.get('/api/system/rbac/actions', { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
        const arr: string[] = Array.isArray(resp.data?.actions) ? resp.data.actions : [];
        setActionAtoms(arr);
      } catch {
        setActionAtoms([]);
      }
    };
    loadActions();
  }, []);

  useEffect(() => {
    const sys = computeSystemPoliciesFrom(actionAtoms);
    setPolicies(prev => {
      const custom = prev.filter(p => p.type === '自定义策略');
      return [...custom, ...sys];
    });
  }, [actionAtoms]);

  const groups = GROUPS;

  const filteredPolicies = useMemo(() => {
    const lower = kw.toLowerCase();
    return policies.filter(p => (type==='all' || p.type===type) && (activeGroup === '全部' || p.groups.includes(activeGroup)) && (p.name.toLowerCase().includes(lower) || (p.description||'').toLowerCase().includes(lower)));
  }, [policies, type, activeGroup, kw]);

  const rows = filteredPolicies.map(p => ({ key: p.id, name: p.name, type: p.type, desc: p.description }));

  const groupActions = useMemo(() => {
    const lower = kw.toLowerCase();
    const featureOf = (resource: string): string => {
      const r = resource || '';
      if (r.startsWith('tenants.leased-lines')) return '租户专线';
      if (r.startsWith('networks.vpcs')) return 'VPC';
      if (r.startsWith('networks.cen')) return 'CEN';
      if (r.startsWith('networks.info-domain')) return '信息域';
      if (r.startsWith('networks.ipsec')) return 'IPsecVPN';
      if (r.startsWith('networks.nat')) return 'NAT网关';
      if (r.startsWith('networks.srv6')) return 'SRv6隧道';
      if (r.startsWith('security.services')) return '安全服务';
      if (r.startsWith('ops.')) return '仪表板';
      if (r.startsWith('tenants')) return '租户管理';
      if (r.startsWith('users')) return '系统用户';
      return r.replace(/^\w+\./, '');
    };
    const describeAction = (action: string): string => {
      const [resource, op] = String(action).split(':');
      const f = featureOf(resource || action);
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
      if (op === 'read') return `查看${f}列表与详情`;
      if (op === 'write') return `创建、修改、删除${f}`;
      return `${f}操作`;
    };
    return actionAtoms
      .filter(a => activeGroup === '全部' || mapGroupOf(a) === activeGroup)
      .filter(a => a.toLowerCase().includes(lower))
      .map(a => ({ value: a, label: a, desc: describeAction(a) }));
  }, [actionAtoms, activeGroup, kw]);

  const selectedTags = selectedActions.map(a => ({ key: a, name: a }));


  const handleSavePolicy = async (vals: any) => {
    if (isEditMode && editingPolicy) {
      setPolicies(prev => prev.map(p => p.id === editingPolicy.id ? { ...p, name: vals.name, description: vals.description || '' } : p));
    } else {
      const pol: Policy = { id: `custom-${Date.now()}`, name: vals.name, type: '自定义策略', description: vals.description || '', actions: [], groups: [] };
      setPolicies(prev => [pol, ...prev]);
    }
    setCreateOpen(false);
    setIsEditMode(false);
    setEditingPolicy(null);
    createForm.resetFields();
    setSelectedActions([]);
  };

  const handleEditPolicy = (id: string) => {
    const p = policies.find(x => x.id === id);
    if (!p || p.type !== '自定义策略') return;
    setAssignPolicy(p);
    setAssignTargetKeys(Array.isArray(p.actions) ? p.actions : []);
    setAssignGroup('全部');
    setAssignPlatform('全部');
    setAssignFeature('全部');
    setAssignKw('');
    setAssignOpen(true);
  };

  const handleDeletePolicy = (id: string) => {
    const p = policies.find(x => x.id === id);
    if (!p || p.type !== '自定义策略') return;
    Modal.confirm({
      title: '删除策略',
      content: `确定要删除策略「${p.name}」吗？`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => {
        setPolicies(prev => prev.filter(x => x.id !== id));
      }
    });
  };

  return (
    <PageContainer
      icon={<LockOutlined style={{ fontSize:24, color:'#1890ff' }} />}
      title="授权策略"
      titleLevel={3}
      subtitle="授权策略用于将权限原子（Action）按功能维度进行组合，以实现批量授权与条件控制。支持系统策略与自定义策略两类，便于复用与统一管理。"
      asCard={false}
    >
      <Divider style={{ margin: '0 0 20px 0' }} />
      <div className="filters-row">
        <Form
          className="filter-tools filter-tools--center"
          layout="vertical"
          style={{ rowGap: 12, columnGap: 12, display: 'flex', alignItems: 'flex-end' }}
          onValuesChange={(_, all) => {
            setKw(all.keyword || '');
            setType(all.type || 'all');
            setActiveGroup(all.group || '全部');
          }}
        >
          <Form.Item name="keyword" label="关键字">
            <Input allowClear placeholder="搜索策略名称或说明" style={{ width: 240 }} />
          </Form.Item>
          <Form.Item name="type" label="策略类型" initialValue={type}>
            <Select allowClear placeholder="全部" style={{ width: 200 }} options={[{ value:'all', label:'所有策略类型' }, { value:'系统策略', label:'系统策略' }, { value:'自定义策略', label:'自定义策略' }]} />
          </Form.Item>
          <Form.Item name="group" label="分组" initialValue={activeGroup}>
            <Select showSearch optionFilterProp="label" style={{ width: 220 }} options={groups.map(g => ({ value: g, label: g }))} />
          </Form.Item>
        </Form>
        <Space className="filter-actions">
          <Button type="primary" size="middle" icon={<PlusOutlined />} onClick={() => { setSelectedActions([]); setCreateOpen(true); }}>新建策略</Button>
          <Button size="middle" icon={<ReloadOutlined />} onClick={() => { /* 保留刷新入口 */ }}>刷新</Button>
        </Space>
      </div>

      <Table
        className="vr-table vr-table--middle"
        size="middle"
        rowKey={(r:any)=> r.key || r.id || Math.random().toString(36).slice(2)}
        dataSource={rows}
        columns={[
          { title:'序号', key:'index', width:70, render: (_:any, __:any, index:number)=> index+1 },
          { title:'策略名称', dataIndex:'name' },
          { title:'策略类型', dataIndex:'type', width: 120 },
          { title:'描述', dataIndex:'desc' },
          { title:'操作', key:'actions', width: 160, fixed: 'right', render: (_:any, record:any) => {
            const isCustom = record?.type === '自定义策略';
            const id = String(record?.key || '');
            if (!isCustom) return null;
            const items: any[] = [
              { key: 'assign', label: '分配权限原子' },
              { key: 'edit', label: '编辑名称/描述' },
              { type: 'divider' },
              { key: 'delete', danger: true, label: '删除' },
            ];
            const onClick = ({ key }: any) => {
              if (key === 'assign') return handleEditPolicy(id);
              if (key === 'edit') {
                const p = policies.find(x => x.id === id);
                if (!p || p.type !== '自定义策略') return;
                setIsEditMode(true);
                setEditingPolicy(p);
                createForm.setFieldsValue({ name: p.name, description: p.description || '' });
                setCreateOpen(true);
                return;
              }
              if (key === 'delete') return handleDeletePolicy(id);
            };
            return <Dropdown menu={{ items, onClick }}><Button type="link">操作</Button></Dropdown>;
          }},
        ] as any}
        pagination={{ pageSize: 10, showSizeChanger: true, pageSizeOptions: ['10','20','50'], size: 'default' }}
        scroll={{ x: 'max-content' }}
        bordered
      />

      <StdFormModal title={isEditMode ? '编辑授权策略' : '新建授权策略'} open={createOpen} onCancel={()=> { setCreateOpen(false); setIsEditMode(false); setEditingPolicy(null); }} okText={isEditMode ? '保存' : '创建'} width={600} form={createForm} onFinish={handleSavePolicy}>
        <Form.Item name="name" label="策略名称" rules={[{ required: true, message: '请输入策略名称' }]}> 
          <Input placeholder="例如：信息域只读策略" />
        </Form.Item>
        <Form.Item name="description" label="描述">
          <Input.TextArea placeholder="策略用途说明（可选）" autoSize={{ minRows: 3, maxRows: 6 }} />
        </Form.Item>
      </StdFormModal>

      <StdSideDrawer title="分配权限原子" open={assignOpen} onClose={()=> { setAssignOpen(false); setAssignPolicy(null); }} onOk={() => {
        const actions = Array.from(new Set(assignTargetKeys.map(k => String(k))));
        const groupsSel = Array.from(new Set(actions.map(a => mapGroupOf(a))));
        if (assignPolicy) {
          setPolicies(prev => prev.map(p => p.id === assignPolicy.id ? { ...p, actions, groups: groupsSel } : p));
        }
        setAssignOpen(false);
        setAssignPolicy(null);
      }} width={1280}>
        <Form layout="vertical" style={{ display:'flex', gap: 16, marginBottom: 20 }}>
          <Form.Item label="顶级目录" style={{ width: 200, marginBottom: 0 }}>
            <Select value={assignPlatform} onChange={(v)=> setAssignPlatform(v)} options={PLATFORMS.map(p => ({ value: p, label: p }))} />
          </Form.Item>
          <Form.Item label="分组" style={{ width: 200, marginBottom: 0 }}>
            <Select value={assignGroup} onChange={(v)=> setAssignGroup(v)} options={groups.map(g=>({ value:g, label:g }))} />
          </Form.Item>
          <Form.Item label="读写" style={{ width: 160, marginBottom: 0 }}>
            <Select value={assignVerb} onChange={(v)=> setAssignVerb(v)} options={[{ value:'全部', label:'全部' }, { value:'read', label:'read' }, { value:'write', label:'write' }]} />
          </Form.Item>
          <Form.Item label="功能" style={{ width: 220, marginBottom: 0 }}>
            <Select value={assignFeature} onChange={(v)=> setAssignFeature(v)} options={featureOptions.map(f => ({ value: f, label: f }))} />
          </Form.Item>
          <Form.Item label="关键字" style={{ flex: 1, marginBottom: 0 }}>
            <Input.Search allowClear placeholder="搜索权限原子" value={assignKw} onChange={e=> setAssignKw(e.target.value)} />
          </Form.Item>
        </Form>
        <Transfer
          dataSource={(() => {
            const base = actionAtoms
              .filter(a => assignPlatform === '全部' || mapPlatformOf(a) === assignPlatform)
              .filter(a => assignGroup === '全部' || mapGroupOf(a) === assignGroup)
              .filter(a => assignFeature === '全部' || featureLabelOf(a.split(':')[0]||a) === assignFeature)
              .filter(a => assignVerb === '全部' || a.endsWith(`:${assignVerb}`))
              .filter(a => (assignKw||'').length === 0 || a.toLowerCase().includes(assignKw.toLowerCase()))
              .map(a => ({ key: a, title: a, description: describeAction(a) }));
            const selected = (assignTargetKeys || []).map(k => ({ key: String(k), title: String(k), description: describeAction(String(k)) }));
            const map = new Map<string, any>();
            [...base, ...selected].forEach(it => { map.set(String(it.key), it); });
            return Array.from(map.values());
          })()}
          targetKeys={assignTargetKeys}
          onChange={(nextTargetKeys: React.Key[], _direction: any, _moveKeys: React.Key[])=> setAssignTargetKeys(nextTargetKeys)}
          showSearch
          filterOption={(input: string, item: any) => (item?.title||'').toLowerCase().includes(input.toLowerCase()) || (item?.description||'').toLowerCase().includes(input.toLowerCase())}
          render={(item: any) => (
            <div style={{ display:'flex', flexDirection:'column' }}>
              <span style={{ fontWeight: 500 }}>{item.title}</span>
              <span style={{ color:'#888', fontSize: 12 }}>{item.description}</span>
            </div>
          )}
          titles={[ '可选权限原子', '已分配' ]}
          style={{ width: '100%' }}
          listStyle={{ flex: '1 1 0', minWidth: 0, height: 580 }}
        />
      </StdSideDrawer>
    </PageContainer>
  );
};

export default AccessPoliciesPage;