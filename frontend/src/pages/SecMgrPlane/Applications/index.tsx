import React, { useEffect, useMemo, useState } from 'react';
import { Button, Divider, Form, Input, Modal, Select, Space, Table, Tag, message, Dropdown, Typography, Tabs, Alert, Popover, Checkbox } from 'antd';
import { PlusOutlined, EllipsisOutlined, ReloadOutlined, SafetyCertificateOutlined, GlobalOutlined, DeleteOutlined, FileTextOutlined, SettingOutlined } from '@ant-design/icons';
import PageContainer from '../../../components/PageContainer';
import ResourceActionsDropdown from '../../../components/ResourceActionsDropdown';
import { listSecurityDomains } from '../../../services/securityDomainApi';
import { fetchServices, deleteService, createService, updateService, fetchAllInstances } from '../../../services/api';
import { createACLRule } from '../../../services/networkApi';
import { AppWizard } from './AppWizard';
import { useNavigate } from 'react-router-dom';
import '../../common/filters.css';

const { Text } = Typography;

interface AppItem {
  id: string;
  name: string;
  domainId: string;
  domainName?: string;
  type: 'vm' | 'container' | 'mixed';
  instanceCount: number;
  status: 'running' | 'stopped' | 'degraded';
  strategies: Array<'RBAC' | 'ABAC'>;
  instances?: string[];
  description?: string;
  owner?: string;
  version?: string;
  policyIds?: string[];
}

const SecurityApps: React.FC = () => {
  const navigate = useNavigate();
  const [apps, setApps] = useState<AppItem[]>([]);
  const [domains, setDomains] = useState<{ id: string; name: string }[]>([]);
  const [allDomains, setAllDomains] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterForm] = Form.useForm();
  
  const [createOpen, setCreateOpen] = useState(false);
  
  const [securityOpen, setSecurityOpen] = useState(false);
  const [policyForm] = Form.useForm();
  const [currentApp, setCurrentApp] = useState<AppItem | null>(null);
  const [aclForm] = Form.useForm();
  const [aclContext, setAclContext] = useState<{ vrId: string; sourceCandidates: string[]; destCandidates: string[] } | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailApp, setDetailApp] = useState<AppItem | null>(null);
  const [allInstances, setAllInstances] = useState<any[]>([]);
  const [policyOptions, setPolicyOptions] = useState<{ label: string; value: string }[]>([]);
  const [allPolicies, setAllPolicies] = useState<any[]>([]);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [visibleCols, setVisibleCols] = useState<Record<string, boolean>>({});
  const columnLabels: Record<string, string> = {
    name: '应用名称',
    version: '版本',
    owner: '负责人',
    domainName: '所属安全域',
    type: '部署类型',
    instanceCount: '实例数',
    status: '状态',
    strategies: '授权策略',
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const list = await listSecurityDomains();
      const opts = (Array.isArray(list) ? list : []).map((d: any) => ({ id: String(d.id), name: String(d.name || d.id) }));
      setDomains(opts);
      setAllDomains(Array.isArray(list) ? list : []);
    } catch {}
    try {
      const raws = await fetchServices();
      const normalized = (Array.isArray(raws) ? raws : []).map((s: any) => {
        const parsedInstances: string[] = (() => { try { return s.instances ? JSON.parse(s.instances) : []; } catch { return []; } })();
        return {
          id: s.id,
          name: s.name,
          domainId: s.domainId,
          domainName: s.domainName,
          type: s.type,
          instanceCount: parsedInstances.length || Number(s.instanceCount || 0),
          status: s.status || 'running',
          strategies: typeof s.strategies === 'string' ? s.strategies.split(',').map((x: string) => x.trim()).filter(Boolean) : (s.strategies || []),
          instances: parsedInstances,
          description: s.description,
          owner: s.owner,
          version: s.version,
          policyIds: typeof s.policyIds === 'string' ? s.policyIds.split(',').map((x: string) => x.trim()).filter(Boolean) : (s.policyIds || []),
        };
      });
      setApps(normalized);
    } catch {
      try {
        const saved = localStorage.getItem('security_apps');
        const parsed = saved ? JSON.parse(saved) : [];
        setApps(Array.isArray(parsed) ? parsed : []);
      } catch { setApps([]); }
    } finally {
      setLoading(false);
    }
    try {
      const res: any = await fetchAllInstances().catch(() => null);
      const list = Array.isArray(res?.data) ? res.data : [];
      setAllInstances(list);
    } catch {}
    try {
      const raw = localStorage.getItem('ct_policies_custom') || '[]';
      const arr = JSON.parse(raw) || [];
      setAllPolicies(Array.isArray(arr) ? arr : []);
      const opts = (Array.isArray(arr) ? arr : []).map((p: any) => ({ label: p.name || p.id, value: p.id }));
      setPolicyOptions(opts);
    } catch { 
      setPolicyOptions([]); 
      setAllPolicies([]);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('security_apps', JSON.stringify(apps));
    } catch {}
  }, [apps]);

  const [keyword, setKeyword] = useState('');
  const [domainFilter, setDomainFilter] = useState<string | undefined>();
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  
  const filtered = useMemo(() => {
    return apps.filter(a => {
      if (keyword && !a.name.toLowerCase().includes(keyword.toLowerCase())) return false;
      if (domainFilter && a.domainId !== domainFilter) return false;
      if (statusFilter && a.status !== statusFilter) return false;
      return true;
    });
  }, [apps, keyword, domainFilter, statusFilter]);

  const statusTag = (s: AppItem['status']) => {
    const map: any = { running: 'green', stopped: 'default', degraded: 'orange' };
    const txt: any = { running: '运行中', stopped: '已停止', degraded: '告警' };
    return <Tag color={map[s]}>{txt[s]}</Tag>;
  };

  const typeTag = (t: AppItem['type']) => {
    const map: any = { vm: 'blue', container: 'cyan', mixed: 'purple' };
    const txt: any = { vm: '虚机', container: '容器', mixed: '混合' };
    return <Tag color={map[t]}>{txt[t]}</Tag>;
  };

  const columns: any[] = [
    { title: '应用名称', dataIndex: 'name', key: 'name', render: (t: string, r: AppItem) => (
      <Space direction="vertical" size={0}>
        <span>{t}</span>
        {r.description && <Text type="secondary" style={{fontSize: 12}}>{r.description}</Text>}
      </Space>
    ) },
    { title: '版本', dataIndex: 'version', key: 'version' },
    { title: '负责人', dataIndex: 'owner', key: 'owner' },
    { title: '所属安全域', dataIndex: 'domainName', key: 'domainName', render: (t: string) => t || '-' },
    { title: '部署类型', dataIndex: 'type', key: 'type', render: (t: any) => typeTag(t) },
    { title: '实例数', dataIndex: 'instanceCount', key: 'instanceCount' },
    { title: '状态', dataIndex: 'status', key: 'status', render: (s: any) => statusTag(s) },
    { title: '授权策略', dataIndex: 'strategies', key: 'strategies', render: (arr: AppItem['strategies']) => (
      <Space wrap>
        {arr.map(s => <Tag key={s}>{s}</Tag>)}
      </Space>
    ) },
    { title: '操作', key: 'act', render: (_: any, r: AppItem) => {
      const items: any[] = [
        { key: 'security', label: '安全配置', icon: <SafetyCertificateOutlined /> },
        { key: 'detail', label: '详情', icon: <FileTextOutlined /> },
        { type: 'divider' },
        { key: 'delete', label: '删除', icon: <DeleteOutlined />, danger: true },
      ];
      const onClick = ({ key }: any) => {
        if (key === 'security') return openSecurity(r);
        if (key === 'detail') return openDetail(r);
        if (key === 'delete') return removeApp(r.id);
      };
      return (
        <ResourceActionsDropdown items={items} onClick={onClick} buttonType="text" />
      );
    } },
  ];
  const displayColumns = useMemo(() => {
    return (columns as any[]).filter((c) => visibleCols[String(c.key)] !== false);
  }, [columns, visibleCols]);

  const openSecurity = (app: AppItem) => {
    setCurrentApp(app);
    // Policy Init
    policyForm.setFieldsValue({ policyIds: app.policyIds || [] });
    
    // ACL Init
    const dom = allDomains.find(d => String(d.id) === String(app.domainId));
    const vrId = String(dom?.vrUuid || '').trim() || String(dom?.vrInstanceIds || '').split(',')[0]?.trim();
    
    const instanceIps = (app.instances || []).flatMap(id => {
      const ins = allInstances.find(x => String(x.id) === String(id));
      const ips: string[] = Array.isArray(ins?.privateIps) ? ins.privateIps : [];
      return ips;
    }).filter(Boolean);
    const domainCidrs = [
      String(dom?.vrPrivateSubnetCidr || '').trim(),
      String(dom?.vrPublicSubnetCidr || '').trim(),
    ].filter(Boolean);
    
    const candidates = Array.from(new Set([ 'any', ...instanceIps, ...domainCidrs ]));
    setAclContext({ vrId, sourceCandidates: candidates, destCandidates: candidates });
    
    aclForm.resetFields();
    if (instanceIps.length > 0) {
      aclForm.setFieldsValue({ destinationIp: instanceIps });
    }
    
    setSecurityOpen(true);
  };

  const openDetail = (app: AppItem) => {
    setDetailApp(app);
    setDetailOpen(true);
  };

  const submitPolicy = async () => {
    try {
      const vals = await policyForm.validateFields();
      if (!currentApp) return;
      
      const policyIds: string[] = (vals.policyIds || []).map((x: any) => String(x));
      const hasAbac = policyIds.some((pid: string) => {
        const p = allPolicies.find(x => x.id === pid);
        return p?.conditions && (p.conditions.timeWindow || p.conditions.ipRange);
      });
      const strategies: ('RBAC' | 'ABAC')[] = hasAbac ? ['RBAC', 'ABAC'] : ['RBAC'];

      await updateService(currentApp.id, { strategies, policyIds });
      setApps(prev => prev.map(a => a.id === currentApp.id ? { ...a, strategies, policyIds } : a));
      message.success('授权策略已更新');
    } catch (e: any) {}
  };
  const submitAcl = async () => {
    try {
      const vals = await aclForm.validateFields();
      if (!aclContext?.vrId) {
        message.error('当前安全域缺少 VR 标识，无法创建网络ACL');
        return;
      }
      const src = Array.isArray(vals.sourceIp) ? (vals.sourceIp.join(',') || 'any') : (vals.sourceIp || 'any');
      const dst = Array.isArray(vals.destinationIp) ? (vals.destinationIp.join(',') || 'any') : (vals.destinationIp || 'any');
      await createACLRule({
        vrId: aclContext.vrId,
        name: vals.name,
        description: vals.description,
        priority: Number(vals.priority || 100),
        action: vals.action || 'permit',
        protocol: vals.protocol || 'any',
        sourceIp: src,
        destinationIp: dst,
        sourcePort: vals.sourcePort || 'any',
        destinationPort: vals.destinationPort || 'any'
      });
      aclForm.resetFields();
      message.success('网络ACL创建成功');
    } catch (e: any) {
      message.error('网络ACL创建失败');
    }
  };

  const removeApp = async (id: string) => {
    try {
      await deleteService(id);
      setApps(prev => prev.filter(a => a.id !== id));
      message.success('服务已删除');
    } catch (e) {
      message.error('删除失败');
    }
  };

  const forceRefresh = () => {
    loadData();
  };
  const removeSelectedApps = async () => {
    if (!selectedRowKeys.length) return;
    try {
      await Promise.all(selectedRowKeys.map(id => deleteService(id)));
      setApps(prev => prev.filter(a => !selectedRowKeys.includes(a.id)));
      setSelectedRowKeys([]);
      message.success('已批量删除所选应用');
    } catch {
      message.error('批量删除失败');
    }
  };

  return (
    <PageContainer
      titleLevel={3}
      asCard={false}
      title="应用管理"
    >

      <div className="filters-row filters-row--compact">
        <Form
          className="filter-tools filter-tools--center"
          form={filterForm}
          layout="vertical"
          style={{ rowGap: 12, columnGap: 12, display: 'flex', alignItems: 'flex-end' }}
          onValuesChange={(_, all) => {
            setKeyword(all.keyword || '');
            setDomainFilter(all.domainId || undefined);
            setStatusFilter(all.status || undefined);
          }}
        >
          <Form.Item name="keyword" label="名称/描述">
            <Input allowClear placeholder="搜索应用" style={{ width: 200 }} />
          </Form.Item>
          <Form.Item name="domainId" label="安全域">
            <Select allowClear placeholder="全部" style={{ width: 220 }} options={domains.map(d => ({ value: d.id, label: d.name }))} />
          </Form.Item>
          <Form.Item name="status" label="状态">
            <Select allowClear placeholder="全部" style={{ width: 180 }}>
              <Select.Option value="running">运行中</Select.Option>
              <Select.Option value="stopped">已停止</Select.Option>
              <Select.Option value="degraded">告警</Select.Option>
            </Select>
          </Form.Item>
        </Form>
        <Space className="filter-actions">
          <Button type="primary" onClick={() => setCreateOpen(true)}>创建应用</Button>
          <Dropdown
            menu={{
              items: [
                { key: 'refresh', label: '刷新' },
                { key: 'bulkDel', label: '批量删除', disabled: selectedRowKeys.length === 0 },
              ],
              onClick: ({ key }) => {
                if (key === 'refresh') return forceRefresh();
                if (key === 'bulkDel') return removeSelectedApps();
              },
            }}
            trigger={['click']}
          >
            <Button icon={<EllipsisOutlined />} />
          </Dropdown>
          <Popover
            placement="bottomRight"
            trigger="click"
            content={
              <div style={{ minWidth: 220 }}>
                {['name','version','owner','domainName','type','instanceCount','status','strategies'].map((k) => (
                  <div key={k} style={{ marginBottom: 6 }}>
                    <Checkbox
                      checked={visibleCols[k] !== false}
                      onChange={(e) => setVisibleCols((prev) => ({ ...prev, [k]: e.target.checked }))}
                    >
                      {columnLabels[k]}
                    </Checkbox>
                  </div>
                ))}
              </div>
            }
          >
            <Button icon={<SettingOutlined />} />
          </Popover>
        </Space>
      </div>

      <Table
        columns={displayColumns as any}
        dataSource={filtered}
        rowKey={r => r.id}
        pagination={{ pageSize: 10, showSizeChanger: true, pageSizeOptions: ['10', '20', '50'] }}
        loading={loading}
        bordered
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys as string[]),
        }}
      />

      <AppWizard 
        open={createOpen} 
        onClose={() => setCreateOpen(false)} 
        onSuccess={loadData}
      />

      <Modal
        title={`安全配置 - ${currentApp?.name}`}
        open={securityOpen}
        onCancel={() => { setSecurityOpen(false); setCurrentApp(null); }}
        footer={null}
        width={720}
        destroyOnHidden
      >
        <Tabs items={[
          {
            key: 'web',
            label: 'Web 访问控制 (策略)',
            children: (
              <div style={{ paddingTop: 12 }}>
                <Form form={policyForm} layout="vertical">
                  <Alert 
                    type="info" 
                    showIcon 
                    style={{ marginBottom: 16 }}
                    message="策略模型说明"
                    description={
                      <ul style={{ paddingLeft: 20, margin: 0 }}>
                        <li><b>Web 角色访问控制 (RBAC)</b>: 默认启用。基于用户角色 (Principals) 授权。</li>
                        <li><b>Web 属性访问控制 (ABAC)</b>: 当绑定的策略包含环境属性 (Conditions) 时自动启用。</li>
                      </ul>
                    }
                  />
                  <Form.Item name="policyIds" label="绑定授权策略">
                    <Select mode="multiple" allowClear placeholder="选择策略库中的策略" options={policyOptions} />
                  </Form.Item>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: 24 }}>
                    <span style={{ color:'#888' }}>在此选择应用使用的授权模型；如需管理具体策略条目与权限原子，请前往策略中心。</span>
                    <Button type="link" onClick={() => navigate('/admin/access/policies')}>前往策略中心</Button>
                  </div>
                  <Form.Item style={{ textAlign: 'right', marginBottom: 0 }}>
                    <Button type="primary" onClick={submitPolicy}>保存策略配置</Button>
                  </Form.Item>
                </Form>
              </div>
            )
          },
          {
            key: 'net',
            label: '网络访问控制 (ACL)',
            children: (
              <div style={{ paddingTop: 12 }}>
                {!aclContext?.vrId && <Tag color="error" style={{marginBottom:16}}>当前应用所属安全域未关联 VR，无法下发 ACL。</Tag>}
                <Form form={aclForm} layout="vertical" disabled={!aclContext?.vrId}>
                  <Form.Item name="name" label="规则名称" rules={[{ required: true, message: '请输入名称' }]}>
                    <Input placeholder="例如：Allow-Admin-Access" />
                  </Form.Item>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                    <Form.Item name="action" label="动作" initialValue="permit" rules={[{ required: true }]}>
                      <Select options={[{ value:'permit', label:'允许' }, { value:'deny', label:'拒绝' }]} />
                    </Form.Item>
                    <Form.Item name="protocol" label="协议" initialValue="any" rules={[{ required: true }]}>
                      <Select options={[{ value:'any', label:'任意' }, { value:'tcp', label:'TCP' }, { value:'udp', label:'UDP' }, { value:'icmp', label:'ICMP' }]} />
                    </Form.Item>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                    <Form.Item name="sourceIp" label="源IP/CIDR" initialValue="any" rules={[{ required: true }]}>
                      <Select
                        mode="tags"
                        tokenSeparators={[',',';',' ']}
                        placeholder="选择或输入源IP"
                        options={(aclContext?.sourceCandidates || []).map(v => ({ label: v, value: v }))}
                      />
                    </Form.Item>
                    <Form.Item name="destinationIp" label="目的IP/CIDR" initialValue="any" rules={[{ required: true }]}>
                      <Select
                        mode="tags"
                        tokenSeparators={[',',';',' ']}
                        placeholder="选择或输入目的IP"
                        options={(aclContext?.destCandidates || []).map(v => ({ label: v, value: v }))}
                      />
                    </Form.Item>
                  </div>
                  <Form.Item name="priority" label="优先级 (1-100)" initialValue={100}>
                    <Input type="number" placeholder="数值越小优先级越高" />
                  </Form.Item>
                  <Form.Item style={{ textAlign: 'right', marginBottom: 0 }}>
                    <Button type="primary" onClick={submitAcl} icon={<PlusOutlined />}>添加 ACL 规则</Button>
                  </Form.Item>
                </Form>
              </div>
            )
          }
        ]} />
      </Modal>
      <Modal
        title="应用详情"
        open={detailOpen}
        footer={null}
        onCancel={() => { setDetailOpen(false); setDetailApp(null); }}
        destroyOnHidden
        width={720}
      >
        {detailApp && (
          <div style={{ paddingTop: 8 }}>
            <Typography.Title level={5} style={{ marginBottom: 12 }}>{detailApp.name}</Typography.Title>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div><Text type="secondary">安全域</Text><div>{detailApp.domainName || detailApp.domainId}</div></div>
              <div><Text type="secondary">部署类型</Text><div>{typeTag(detailApp.type)}</div></div>
              <div><Text type="secondary">负责人</Text><div>{detailApp.owner || '-'}</div></div>
              <div><Text type="secondary">版本</Text><div>{detailApp.version || '-'}</div></div>
              <div><Text type="secondary">状态</Text><div>{statusTag(detailApp.status)}</div></div>
              <div><Text type="secondary">实例数</Text><div>{detailApp.instanceCount}</div></div>
            </div>
            <Divider />
            <Text type="secondary">描述</Text>
            <div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{detailApp.description || '-'}</div>
            <Divider />
            <Text type="secondary">授权策略</Text>
            <div style={{ marginTop: 4 }}>
              <Space wrap>{(detailApp.strategies || []).map(s => <Tag key={s}>{s}</Tag>)}</Space>
            </div>
            <Divider />
            <Text type="secondary">包含实例</Text>
            <div style={{ marginTop: 4 }}>
              <Space wrap>{(detailApp.instances || []).map(id => <Tag key={id}>{id}</Tag>)}</Space>
            </div>
          </div>
        )}
      </Modal>

    </PageContainer>
  );
};

export default SecurityApps;
