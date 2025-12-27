import React, { useEffect, useMemo, useState } from 'react';
import { Button, Divider, Form, Input, Modal, Select, Space, Table, Tag, message, Transfer, Dropdown } from 'antd';
import { PlusOutlined, EditOutlined, AppstoreOutlined, MoreOutlined } from '@ant-design/icons';
import PageContainer from '../../../components/PageContainer';
import { listInfoDomains } from '../../../services/infoDomainApi';
import { fetchCloudProviderEcs, fetchServices, createService, deleteService } from '../../../services/api';

interface AppItem {
  id: string;
  name: string;
  domainId: string;
  domainName?: string;
  type: 'vm' | 'container' | 'mixed';
  instanceCount: number;
  status: 'running' | 'stopped' | 'degraded';
  strategies: Array<'IBAC' | 'RBAC' | 'ABAC'>;
  instances?: string[];
}

const SecurityApps: React.FC = () => {
  const [apps, setApps] = useState<AppItem[]>([]);
  const [domains, setDomains] = useState<{ id: string; name: string }[]>([]);
  const [allDomains, setAllDomains] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [vmTransferData, setVmTransferData] = useState<{ key: string; title: string }[]>([]);
  const [vmTargetKeys, setVmTargetKeys] = useState<string[]>([]);
  const [filterForm] = Form.useForm();
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm] = Form.useForm();
  const [policyOpen, setPolicyOpen] = useState(false);
  const [policyForm] = Form.useForm();
  const [currentApp, setCurrentApp] = useState<AppItem | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const list = await listInfoDomains();
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
          };
        });
        setApps(normalized);
      } catch {
        try {
          const saved = localStorage.getItem('security_apps');
          const parsed = saved ? JSON.parse(saved) : [];
          setApps(Array.isArray(parsed) ? parsed : []);
        } catch { setApps([]); }
      }
    })();
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
    { title: '服务名称', dataIndex: 'name', key: 'name' },
    { title: '所属信息域', dataIndex: 'domainName', key: 'domainName' },
    { title: '部署类型', dataIndex: 'type', key: 'type', render: (t: any) => typeTag(t) },
    { title: '实例数', dataIndex: 'instanceCount', key: 'instanceCount' },
    { title: '状态', dataIndex: 'status', key: 'status', render: (s: any) => statusTag(s) },
    { title: '授权策略', dataIndex: 'strategies', key: 'strategies', render: (arr: AppItem['strategies']) => (
      <Space>
        {arr.map(s => <Tag key={s}>{s}</Tag>)}
      </Space>
    ) },
    { title: '操作', key: 'act', render: (_: any, r: AppItem) => {
      const items = [
        { key: 'policy', label: '策略' },
        { key: 'delete', label: '删除', danger: true },
      ];
      const onClick = ({ key }: any) => {
        if (key === 'policy') return openPolicy(r);
        if (key === 'delete') return removeApp(r.id);
      };
      return (
        <Dropdown menu={{ items, onClick }} trigger={["click"]}>
          <Button type="link" icon={<MoreOutlined />} />
        </Dropdown>
      );
    } },
  ];

  const openCreate = () => {
    createForm.resetFields();
    setVmTransferData([]);
    setVmTargetKeys([]);
    setCreateOpen(true);
  };

  const submitCreate = async () => {
    try {
      const vals = await createForm.validateFields();
      const domainName = domains.find(d => d.id === vals.domainId)?.name || '-';
      const payload = {
        name: vals.name,
        domainId: vals.domainId,
        domainName,
        type: vals.type,
        instanceCount: vmTargetKeys.length,
        status: 'running',
        strategies: vals.strategies || [],
        instances: vmTargetKeys,
      };
      try {
        const saved = await createService(payload);
        const parsedInstances: string[] = (() => { try { return saved.instances ? JSON.parse(saved.instances) : vmTargetKeys; } catch { return vmTargetKeys; } })();
        const one: AppItem = {
          id: saved.id,
          name: saved.name,
          domainId: saved.domainId,
          domainName: saved.domainName,
          type: saved.type,
          instanceCount: parsedInstances.length || Number(saved.instanceCount || vmTargetKeys.length),
          status: saved.status || 'running',
          strategies: typeof saved.strategies === 'string' ? saved.strategies.split(',').map((x: string) => x.trim()).filter(Boolean) : (saved.strategies || []),
          instances: parsedInstances,
        };
        setApps(prev => [one, ...prev]);
      } catch {
        const localItem: AppItem = {
          id: `app-${Math.random().toString(36).slice(2)}`,
          name: payload.name,
          domainId: payload.domainId,
          domainName: payload.domainName,
          type: payload.type,
          instanceCount: payload.instanceCount,
          status: payload.status as AppItem['status'],
          strategies: payload.strategies,
          instances: payload.instances,
        };
        setApps(prev => [localItem, ...prev]);
      }
      setCreateOpen(false);
      createForm.resetFields();
      setVmTransferData([]);
      setVmTargetKeys([]);
      message.success('服务已创建');
    } catch (e: any) {}
  };

  const handleDomainChange = async (domainId: string) => {
    try {
      setVmTransferData([]);
      setVmTargetKeys([]);
      const dom = allDomains.find((d: any) => String(d.id) === String(domainId));
      const cloudId = dom?.cloudId;
      const vpcId = dom?.vpcId;
      if (!cloudId) {
        return;
      }
      const list = await fetchCloudProviderEcs(String(cloudId));
      const arr = Array.isArray(list)
        ? list
        : Array.isArray((list as any)?.data?.Instances?.Instance)
        ? (list as any).data.Instances.Instance
        : Array.isArray((list as any)?.Instances?.Instance)
        ? (list as any).Instances.Instance
        : [];
      const items = arr
        .filter((e: any) => {
          const vid = String((e.VpcAttributes && e.VpcAttributes.VpcId) || e.VpcId || e.vpcId || e.VPCId || '');
          return vpcId ? String(vpcId) === vid : true;
        })
        .map((e: any) => ({
          key: String(e.instanceId || e.id || e.InstanceId || e.uuid || e.name),
          title: String(e.InstanceName || e.name || e.instanceName || e.id || e.InstanceId || '未命名'),
        }));
      setVmTransferData(items);
    } catch (err) {
      setVmTransferData([]);
    }
  };

  const openPolicy = (app: AppItem) => {
    setCurrentApp(app);
    policyForm.setFieldsValue({ strategies: app.strategies });
    setPolicyOpen(true);
  };

  const submitPolicy = async () => {
    try {
      const vals = await policyForm.validateFields();
      if (!currentApp) return;
      setApps(prev => prev.map(a => a.id === currentApp.id ? { ...a, strategies: vals.strategies || [] } : a));
      setPolicyOpen(false);
      setCurrentApp(null);
      message.success('授权策略已更新');
    } catch (e: any) {}
  };

  const removeApp = async (id: string) => {
    try {
      await deleteService(id);
    } catch {}
    setApps(prev => prev.filter(a => a.id !== id));
    message.success('服务已删除');
  };

  return (
    <PageContainer
      title="服务目录管理"
      titleLevel={3}
      subtitle="服务目录是信息域内由若干虚机或容器实例组合而成的业务单元，可对其进行 IBAC、RBAC、ABAC 授权策略管理。"
      asCard={false}
    >
      <Divider style={{ margin: '0 0 20px 0' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <Form
          form={filterForm}
          layout="vertical"
          style={{ rowGap: 12, columnGap: 12, display: 'flex', alignItems: 'flex-end' }}
          onValuesChange={(_, all) => {
            setKeyword(all.keyword || '');
            setDomainFilter(all.domainId || undefined);
            setStatusFilter(all.status || undefined);
          }}
        >
          <Form.Item name="keyword" label="名称">
            <Input allowClear placeholder="搜索名称" style={{ width: 200 }} />
          </Form.Item>
          <Form.Item name="domainId" label="信息域">
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
        <Space>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate} style={{ borderRadius: 4 }}>创建服务</Button>
        </Space>
      </div>

      <Table
        columns={columns}
        dataSource={filtered}
        rowKey={r => r.id}
        pagination={{ pageSize: 10, showSizeChanger: true, pageSizeOptions: ['10', '20', '50'] }}
        loading={loading}
        bordered
        style={{ marginTop: 12 }}
      />

      <Modal
        title="创建服务"
        open={createOpen}
        onOk={submitCreate}
        onCancel={() => { setCreateOpen(false); createForm.resetFields(); }}
        destroyOnHidden
        width={640}
      >
        <Form form={createForm} layout="vertical">
          <Form.Item name="name" label="服务名称" rules={[{ required: true, message: '请输入服务名称' }]}> 
            <Input placeholder="例如：订单结算服务" />
          </Form.Item>
          <Form.Item name="domainId" label="信息域" rules={[{ required: true, message: '请选择信息域' }]}>
            <Select placeholder="选择信息域" options={domains.map(d => ({ value: d.id, label: d.name }))} onChange={handleDomainChange} />
          </Form.Item>
          <Form.Item name="type" label="类型" rules={[{ required: true, message: '请选择类型' }]}
            getValueFromEvent={(v)=>{ return v; }}>
            <Select
              options={[{ value: 'vm', label: '虚拟机部署' }, { value: 'container', label: '容器部署' }]}
              onChange={(val)=>{
                const domainId = createForm.getFieldValue('domainId');
                if(val==='vm' && domainId){ handleDomainChange(domainId); }
              }}
            />
          </Form.Item>

          { (createForm.getFieldValue('type')==='vm') && (
            <Form.Item label="选择虚拟机（信息域内 VPC）">
              <Transfer
                dataSource={vmTransferData}
                targetKeys={vmTargetKeys}
                onChange={(nextTargetKeys)=> setVmTargetKeys(nextTargetKeys as string[])}
                showSearch
                render={(item)=> item.title}
                listStyle={{ width: 260, height: 320 }}
              />
            </Form.Item>
          ) }
          <Form.Item name="strategies" label="授权策略">
            <Select mode="multiple" options={[{ value: 'IBAC', label: 'IBAC' }, { value: 'RBAC', label: 'RBAC' }, { value: 'ABAC', label: 'ABAC' }]} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="授权策略"
        open={policyOpen}
        onOk={submitPolicy}
        onCancel={() => { setPolicyOpen(false); policyForm.resetFields(); setCurrentApp(null); }}
        destroyOnHidden
        width={560}
      >
        <Form form={policyForm} layout="vertical">
          <Form.Item name="strategies" label="策略">
            <Select mode="multiple" options={[{ value: 'IBAC', label: 'IBAC' }, { value: 'RBAC', label: 'RBAC' }, { value: 'ABAC', label: 'ABAC' }]} />
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
};

export default SecurityApps;
