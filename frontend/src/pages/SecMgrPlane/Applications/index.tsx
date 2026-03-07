import React, { useEffect, useMemo, useState } from 'react';
import { Button, Divider, Form, Input, Modal, Select, Space, Table, Tag, message, Dropdown, Typography, Tabs, Alert, Popover, Checkbox, Card, Row, Col, InputNumber } from 'antd';
import { 
  PlusOutlined, 
  EllipsisOutlined, 
  ReloadOutlined, 
  SafetyCertificateOutlined, 
  DeleteOutlined, 
  FileTextOutlined, 
  SettingOutlined,
  AppstoreOutlined,
  SecurityScanOutlined
} from '@ant-design/icons';
import PageContainer from '../../../components/PageContainer';
import ResourceActionsDropdown from '../../../components/ResourceActionsDropdown';
import { listSecurityDomains } from '../../../services/securityDomainApi';
import { fetchServices, deleteService, createService, updateService, fetchAllInstances, fetchCloudProviderEcs } from '../../../services/api';
import { createACLRule } from '../../../services/networkApi';
import { AppWizard } from './AppWizard';
import DiscoveredAssets from './DiscoveredAssets';
import { useNavigate } from 'react-router-dom';
const { Text } = Typography;

interface AppItem {
  id: string;
  name: string;
  domainId: string;
  domainName?: string;
  type: 'vm' | 'container' | 'mixed' | 'service_address';
  instanceCount: number;
  status: 'running' | 'stopped' | 'degraded';
  strategies: Array<'RBAC' | 'ABAC'>;
  instances?: string[];
  serviceAddresses?: Array<{ protocol: string; ip: string; port: string }>;
  servicePorts?: Array<{ protocol: string; port: string }>;
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
  const [activeTab, setActiveTab] = useState('list');
  const [filterForm] = Form.useForm();
  
  const [createOpen, setCreateOpen] = useState(false);
  const [editingApp, setEditingApp] = useState<AppItem | undefined>(undefined);
  
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
  const [ecsIpMap, setEcsIpMap] = useState<Record<string, string>>({});
  const [discoveredCount, setDiscoveredCount] = useState(0);
  const columnLabels: Record<string, string> = {
    name: '应用名称',
    version: '版本',
    owner: '负责人',
    domainName: '所属安全域',
    type: '部署类型',
    protocolPort: '协议/端口',
    ip: 'IP地址',
    instanceCount: '实例数',
    status: '状态',
    strategies: '授权策略',
  };

  useEffect(() => {
    if (allDomains.length === 0 || apps.length === 0) return;
    const cloudIds = new Set<string>();
    apps.forEach(app => {
        if (app.type === 'vm' || app.type === 'container' || app.type === 'mixed') {
             const dom = allDomains.find(d => String(d.id) === String(app.domainId));
             if (dom?.cloudId) cloudIds.add(dom.cloudId);
        }
    });
    
    cloudIds.forEach(cid => {
       fetchCloudProviderEcs(cid).then((res: any) => {
         const list = res?.data?.Instances?.Instance || res?.data?.servers || res?.data?.InstanceSet || res?.data || [];
         const map: Record<string, string> = {};
         if (Array.isArray(list)) {
           list.forEach((inst: any) => {
             let ip = '';
             const pubArr = inst?.PublicIpAddress?.IpAddress;
             const pub = Array.isArray(pubArr) && pubArr.length > 0 ? pubArr[0] : (inst?.EipAddress?.IpAddress || inst?.publicIpAddress || (Array.isArray(inst?.publicIps)?inst.publicIps[0]:null));
             const priArr = inst?.VpcAttributes?.PrivateIpAddress?.IpAddress;
             const pri = Array.isArray(priArr) && priArr.length > 0 ? priArr[0] : (inst?.privateIpAddress || (Array.isArray(inst?.privateIps)?inst.privateIps[0]:null));
             
             if (pub) ip = pub;
             else if (pri) ip = pri;
             
             const iid = inst?.InstanceId || inst?.id || inst?.uuid;
             if (iid && ip) {
                map[iid] = ip;
             }
           });
         }
         setEcsIpMap(prev => ({ ...prev, ...map }));
       }).catch(() => {});
    });
  }, [apps, allDomains]);

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
        const parsedInstances: any[] = (() => { try { return s.instances ? JSON.parse(s.instances) : []; } catch { return []; } })();
        const rawType = String(s.type || '').toLowerCase();
        let type: AppItem['type'] = 'vm';
        if (rawType === 'container') type = 'container';
        else if (rawType === 'mixed') type = 'mixed';
        else if (rawType === 'service_address') type = 'service_address';
        
        const isServiceAddress = type === 'service_address';
        const instances = isServiceAddress ? [] : parsedInstances;
        // Robustly extract serviceAddresses: prioritize explicit field, fallback to instances if it contains objects
        let serviceAddresses: any[] = [];
        if (isServiceAddress) {
           if (s.serviceAddresses && Array.isArray(s.serviceAddresses)) {
               serviceAddresses = s.serviceAddresses;
           } else if (typeof s.serviceAddresses === 'string') {
               try { serviceAddresses = JSON.parse(s.serviceAddresses); } catch {}
           } 
           
           if (serviceAddresses.length === 0 && parsedInstances.length > 0) {
               serviceAddresses = parsedInstances;
           }
        }

        return {
          id: s.id,
          name: s.name,
          domainId: s.domainId,
          domainName: s.domainName,
          type,
          instanceCount: isServiceAddress ? serviceAddresses.length : (instances.length || Number(s.instanceCount || 0)),
          status: s.status || 'running',
          strategies: typeof s.strategies === 'string' ? s.strategies.split(',').map((x: string) => x.trim()).filter(Boolean) : (s.strategies || []),
          instances,
          serviceAddresses,
          servicePorts: (() => { try { return s.servicePorts ? (Array.isArray(s.servicePorts) ? s.servicePorts : JSON.parse(s.servicePorts)) : []; } catch { return []; } })(),
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

  const typeTag = (t: any) => {
    const key = String(t || '').toLowerCase();
    const map: any = { vm: 'blue', container: 'cyan', mixed: 'purple', service_address: 'geekblue' };
    const txt: any = { vm: '虚机', container: '容器', mixed: '混合', service_address: '服务地址' };
    const color = map[key] || 'default';
    const label = txt[key] || '未知';
    return <Tag color={color}>{label}</Tag>;
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
    { title: '协议/端口', key: 'protocolPort', render: (_: any, r: AppItem) => {
      let items: any[] = [];
      if (r.type === 'service_address') {
        items = r.serviceAddresses || [];
      } else {
        items = r.servicePorts || [];
      }
      if (!items.length) {
         if (r.type === 'vm') return 'all';
         return '-';
      }
      const unique = Array.from(new Set(items.map((p: any) => `${p.protocol || '-'}:${p.port || '-'}`)));
      if (unique.length > 2) {
         return (
           <div style={{fontSize: 12}}>
             {unique.slice(0, 2).map((s: string, i: number) => <div key={i}>{s}</div>)}
             <div style={{color: '#999'}}>+{unique.length - 2} more</div>
           </div>
         );
      }
      return unique.map((s: string, i: number) => <div key={i} style={{fontSize: 12}}>{s}</div>);
    } },
    { title: 'IP地址', key: 'ip', render: (_: any, r: AppItem) => {
        let ips: string[] = [];
        if (r.type === 'service_address') {
             ips = (r.serviceAddresses || []).map(a => a.ip).filter(Boolean);
        } else {
             ips = (r.instances || []).map(id => ecsIpMap[id]).filter(Boolean);
        }
        if (!ips.length) return '-';
        const unique = Array.from(new Set(ips));
        if (unique.length > 2) {
          return (
             <div style={{fontSize: 12}}>
               {unique.slice(0, 2).map((ip: string, i: number) => <div key={i}>{ip}</div>)}
               <div style={{color: '#999'}}>+{unique.length - 2} more</div>
             </div>
          );
        }
        return unique.map((ip: string, i: number) => <div key={i} style={{fontSize: 12}}>{ip}</div>);
    } },
    { title: '实例数', dataIndex: 'instanceCount', key: 'instanceCount' },
    { title: '状态', dataIndex: 'status', key: 'status', render: (s: any) => statusTag(s) },
    { title: '授权策略', dataIndex: 'strategies', key: 'strategies', render: (arr: AppItem['strategies']) => (
      <Space wrap>
        {arr.map(s => <Tag key={s}>{s}</Tag>)}
      </Space>
    ) },
    { title: '操作', key: 'act', render: (_: any, r: AppItem) => {
      const items: any[] = [
        { key: 'edit', label: '编辑', icon: <SettingOutlined /> },
        { key: 'security', label: '安全配置', icon: <SafetyCertificateOutlined /> },
        { key: 'detail', label: '详情', icon: <FileTextOutlined /> },
        { type: 'divider' },
        { key: 'delete', label: '删除', icon: <DeleteOutlined />, danger: true },
      ];
      const onClick = ({ key }: any) => {
        if (key === 'edit') {
            setEditingApp(r);
            setCreateOpen(true);
            return;
        }
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
    return (columns as any[]);
  }, [columns]);

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

  const handleCreateFromAsset = (asset: any) => {
    const partialApp: any = {
      name: `App-${asset.value}`,
      type: 'service_address',
      serviceAddresses: [{ protocol: 'TCP', ip: asset.value, port: asset.port || '80' }],
      instanceCount: 1,
      domainId: '',
      strategies: [],
      status: 'running',
      owner: 'admin',
      version: 'v1'
    };
    setEditingApp(partialApp);
    setCreateOpen(true);
    setActiveTab('list');
  };

  const handleLinkToApp = (asset: any) => {
    message.info('请在应用列表中找到目标应用，点击编辑并添加此IP地址。');
    setActiveTab('list');
  };

  const renderList = () => (
    <PageContainer
      hideHeader
      asCard={false}
      pagePadding={0}
      toolbarLeft={(
          <Form
            className="toolbar-container"
            form={filterForm}
            layout="vertical"
            style={{ rowGap: 12, columnGap: 12, display: 'flex', alignItems: 'flex-end' }}
            onValuesChange={(_, all) => {
              setKeyword(all.keyword || '');
              setDomainFilter(all.domainId || undefined);
              setStatusFilter(all.status || undefined);
            }}
          >
            <Form.Item name="keyword" label="名称/描述" style={{ marginBottom: 0 }}>
              <Input allowClear placeholder="搜索应用" className="toolbar-search" />
            </Form.Item>
            <Form.Item name="domainId" label="安全域" style={{ marginBottom: 0 }}>
              <Select allowClear placeholder="全部" className="toolbar-filter" options={domains.map(d => ({ value: d.id, label: d.name }))} />
            </Form.Item>
            <Form.Item name="status" label="状态" style={{ marginBottom: 0 }}>
              <Select allowClear placeholder="全部" className="toolbar-filter">
                <Select.Option value="running">运行中</Select.Option>
                <Select.Option value="stopped">已停止</Select.Option>
                <Select.Option value="degraded">告警</Select.Option>
              </Select>
            </Form.Item>
          </Form>
      )}
      primaryAction={{
        text: '创建应用',
        onClick: () => setCreateOpen(true)
      }}
      moreMenuItems={[
        { 
          key: 'bulkDel', 
          label: '批量删除', 
          danger: true, 
          disabled: selectedRowKeys.length === 0,
          onClick: removeSelectedApps 
        },
      ]}
      onRefresh={forceRefresh}
      tableProps={{
        columns: displayColumns,
        dataSource: filtered,
        rowKey: "id",
        loading,
        rowSelection: {
          selectedRowKeys,
          onChange: (keys: React.Key[]) => setSelectedRowKeys(keys as string[]),
        },
        pagination: { pageSize: 10, showSizeChanger: true },
        scroll: { x: 'max-content' }
      }}
      defaultHiddenColumns={['strategies', 'version', 'owner']}
    />
  );

  return (
    <PageContainer
      titleLevel={3}
      asCard={false}
      bordered={false}
      tabList={[
        { key: 'list', tab: <span><AppstoreOutlined /> 应用列表 ({apps.length})</span> },
        { key: 'discovery', tab: <span><SecurityScanOutlined /> 资产发现 {discoveredCount > 0 ? `(${discoveredCount})` : ''}</span> }
      ]}
      tabActiveKey={activeTab}
      onTabChange={setActiveTab}
    >
      {activeTab === 'list' ? renderList() : (
          <DiscoveredAssets 
            domains={allDomains} 
            existingApps={apps}
            onCreateApp={handleCreateFromAsset}
            onLinkApp={handleLinkToApp}
            onCountChange={setDiscoveredCount}
          />
      )}

      <AppWizard 
        open={createOpen} 
        onClose={() => { setCreateOpen(false); setEditingApp(undefined); }} 
        onSuccess={loadData}
        editingApp={editingApp}
      />

      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <SafetyCertificateOutlined style={{ color: '#1890ff' }} />
            <span>安全配置 - {currentApp?.name}</span>
          </div>
        }
        open={securityOpen}
        onCancel={() => { setSecurityOpen(false); setCurrentApp(null); }}
        footer={null}
        width={800}
        destroyOnHidden
        styles={{ body: { padding: 0 } }}
      >
        <div style={{ display: 'flex', height: 500 }}>
          <Tabs
            tabPosition="left"
            style={{ flex: 1, height: '100%' }}
            items={[
              {
                key: 'web',
                label: 'Web 访问控制',
                children: (
                  <div style={{ padding: '0 24px', height: '100%', overflowY: 'auto' }}>
                    <Typography.Title level={5} style={{ marginTop: 16 }}>Web 访问策略</Typography.Title>
                    <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
                      配置基于角色的访问控制 (RBAC) 或基于属性的访问控制 (ABAC)，保护 Web 应用资源。
                    </Text>
                    
                    <Form form={policyForm} layout="vertical">
                      <Form.Item name="policyIds" label="绑定授权策略">
                        <Select 
                          mode="multiple" 
                          allowClear 
                          placeholder="选择策略库中的策略" 
                          options={policyOptions} 
                          style={{ width: '100%' }}
                        />
                      </Form.Item>
                      
                      <div style={{ background: '#f5f5f5', padding: 16, borderRadius: 8, marginBottom: 24 }}>
                        <div style={{ fontWeight: 500, marginBottom: 8 }}>策略模型说明：</div>
                        <ul style={{ paddingLeft: 20, margin: 0, color: '#666', fontSize: 13 }}>
                          <li><b>RBAC (Web 角色访问控制)</b>: 默认启用。基于用户角色 (Principals) 授权。</li>
                          <li><b>ABAC (Web 属性访问控制)</b>: 当绑定的策略包含环境属性 (Conditions) 时自动启用。</li>
                        </ul>
                      </div>

                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop: 48, borderTop: '1px solid #f0f0f0', paddingTop: 16 }}>
                        <Button type="link" onClick={() => navigate('/admin/access/policies')} icon={<SettingOutlined />}>
                          前往策略中心管理
                        </Button>
                        <Button type="primary" onClick={submitPolicy}>保存 Web 策略配置</Button>
                      </div>
                    </Form>
                  </div>
                )
              },
              {
                key: 'net',
                label: '网络访问控制 (ACL)',
                children: (
                  <div style={{ padding: '0 24px', height: '100%', overflowY: 'auto' }}>
                    <Typography.Title level={5} style={{ marginTop: 16 }}>快速添加 ACL 规则</Typography.Title>
                    <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
                      向应用所属的安全域 VR 下发网络访问控制列表 (ACL) 规则。
                    </Text>

                    {!aclContext?.vrId ? (
                      <Alert type="warning" message="当前应用所属安全域未关联 VR，无法下发 ACL。" showIcon />
                    ) : (
                      <Form form={aclForm} layout="vertical">
                        <Row gutter={16}>
                          <Col span={16}>
                            <Form.Item name="name" label="规则名称" rules={[{ required: true, message: '请输入名称' }]}>
                              <Input placeholder="例如：Allow-Admin-Access" />
                            </Form.Item>
                          </Col>
                          <Col span={8}>
                             <Form.Item name="priority" label="优先级" initialValue={100} tooltip="数值越小优先级越高 (1-100)">
                              <InputNumber style={{ width: '100%' }} min={1} max={100} />
                            </Form.Item>
                          </Col>
                        </Row>

                        <Divider orientation="left" style={{ margin: '12px 0' }}><span style={{ fontSize: 12, color: '#999' }}>匹配条件</span></Divider>
                        
                        <Row gutter={16}>
                          <Col span={12}>
                            <Form.Item name="sourceIp" label="源 IP/CIDR" initialValue="any" rules={[{ required: true }]}>
                              <Select
                                mode="tags"
                                tokenSeparators={[',',';',' ']}
                                placeholder="选择或输入源IP"
                                options={(aclContext?.sourceCandidates || []).map(v => ({ label: v, value: v }))}
                              />
                            </Form.Item>
                          </Col>
                          <Col span={12}>
                            <Form.Item name="destinationIp" label="目的 IP/CIDR" initialValue="any" rules={[{ required: true }]}>
                              <Select
                                mode="tags"
                                tokenSeparators={[',',';',' ']}
                                placeholder="选择或输入目的IP"
                                options={(aclContext?.destCandidates || []).map(v => ({ label: v, value: v }))}
                              />
                            </Form.Item>
                          </Col>
                        </Row>

                        <Divider orientation="left" style={{ margin: '12px 0' }}><span style={{ fontSize: 12, color: '#999' }}>执行动作</span></Divider>

                        <Row gutter={16}>
                          <Col span={12}>
                            <Form.Item name="protocol" label="协议" initialValue="any" rules={[{ required: true }]}>
                              <Select options={[
                                { value:'any', label:'任意 (Any)' }, 
                                { value:'tcp', label:'TCP' }, 
                                { value:'udp', label:'UDP' }, 
                                { value:'icmp', label:'ICMP' }
                              ]} />
                            </Form.Item>
                          </Col>
                          <Col span={12}>
                            <Form.Item name="action" label="动作" initialValue="permit" rules={[{ required: true }]}>
                              <Select options={[
                                { value:'permit', label: <span style={{color:'green'}}>允许 (Permit)</span> }, 
                                { value:'deny', label: <span style={{color:'red'}}>拒绝 (Deny)</span> }
                              ]} />
                            </Form.Item>
                          </Col>
                        </Row>
                        <Row gutter={16}>
                          <Col span={12}>
                             <Form.Item name="sourcePort" label="源端口" initialValue="any">
                               <Input placeholder="e.g. 80 or 1000-2000" />
                             </Form.Item>
                          </Col>
                          <Col span={12}>
                             <Form.Item name="destinationPort" label="目的端口" initialValue="any">
                               <Input placeholder="e.g. 80 or 443" />
                             </Form.Item>
                          </Col>
                        </Row>

                        <div style={{ display:'flex', justifyContent:'flex-end', marginTop: 24, borderTop: '1px solid #f0f0f0', paddingTop: 16 }}>
                          <Button type="primary" onClick={submitAcl} icon={<PlusOutlined />}>立即添加 ACL 规则</Button>
                        </div>
                      </Form>
                    )}
                  </div>
                )
              }
            ]} 
          />
        </div>
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
