import React, { useEffect, useState, useMemo } from 'react';
import { Tag, Button, Modal, Form, Input, message, Select, Badge } from 'antd';
import PageContainer from '../../../../components/PageContainer';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import { SearchOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { fetchCens, createCen, deleteCen, attachVpcToCen, fetchTenants, fetchCenAttachments } from '../../../../services/api';
import { listSecurityDomains } from '../../../../services/securityDomainApi';

interface Cen {
  id: string;
  name: string;
  description?: string;
  strategy?: string;
  topology?: string;
  hubId?: string;
  status: 'creating' | 'available';
  createdAt: string;
  tenantId: string;
  attachCount: number;
  loss?: number;
  latency?: number;
  sla?: number;
  accessIp?: string;
  publicIp?: string;
  privateIp?: string;
}

interface SecurityDomainOption { id:string; name:string; type?:string; category?:string; subType?:string; vpcId?:string; provider?:string; region?:string; cloudId?:string; cidr?:string; cidr6?:string; vrName?:string; vrUuid?:string; vrInstanceIds?:string; vrPublicEniIds?:string; vrPrivateEniIds?:string; vrPublicIp?:string; vrPublicEip?:string; vrPrivateIp?:string; vrPublicSubnetCidr?:string; vrPrivateSubnetCidr?:string }

const CenPage: React.FC = () => {
  const navigate = useNavigate();
  const [cens, setCens] = useState<Cen[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [form] = Form.useForm();

  const [tenants, setTenants] = useState<any[]>([]);

  const [attachModal, setAttachModal] = useState<{open:boolean; cenId?:string}>({open:false});
  const [domains, setDomains] = useState<SecurityDomainOption[]>([]);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [attachmentCache, setAttachmentCache] = useState<{[k:string]:any[]}>({});
  const [filterForm] = Form.useForm();

  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  const load = async () => {
    setLoading(true);
    try {
      const data = await fetchCens();
      const dataWithCnt = await Promise.all(data.map(async (c:any)=>{
        try{
          const list = await fetchCenAttachments(c.id);
          return { ...c, attachCount: list.length };
        }catch{ return { ...c, attachCount: 0 }; }
      }));
      const dataWithMetrics = dataWithCnt.map((c:any)=>({
        ...c,
        loss: parseFloat((Math.random()*2).toFixed(2)),
        latency: Math.floor(30+Math.random()*70),
        sla: parseFloat((98+Math.random()*2).toFixed(2))
      }));
      setCens(dataWithMetrics);
      const t = await fetchTenants();
      setTenants(t);
    } catch(err){}
    setLoading(false);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(()=>{ load(); }, []);

  const statusBadge = (s:Cen['status'])=>{
    const color = s==='available'? 'green': s==='creating'? 'blue':'default';
    const text = s==='available'? '可用':'创建中';
    return <Badge color={color} text={<span style={{ fontSize: 13 }}>{text}</span>} />;
  };

  const tenantNameById = (id:string)=> tenants.find(t=>t.id===id)?.name || '-';

  const planeStatsByAttachCount = (cnt:number)=>{
    const total = Math.floor((cnt||0)/2);
    const active = total;
    return { total, active };
  };



  const [planeFilter, setPlaneFilter] = useState<string|undefined>();
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<string[]|undefined>();
  const [tenantFilter, setTenantFilter] = useState<string|undefined>();
  const [attachDomainIds, setAttachDomainIds] = useState<string[]>([]);
  const [attachPlaneIndex, setAttachPlaneIndex] = useState<number | undefined>();
  // Removed unused states

  const filteredCens = useMemo(()=>{
    return cens.filter(c=>{
      if(keyword && !c.name.toLowerCase().includes(keyword.toLowerCase())) return false;
      if(statusFilter && statusFilter.length && !statusFilter.includes(c.status)) return false;
      if(tenantFilter && c.tenantId!==tenantFilter) return false;
      if(planeFilter==='active' && Math.floor((c.attachCount||0)/2)<=0) return false;
      if(planeFilter==='none' && (c.attachCount||0)>=2) return false;
      return true;
    });
  }, [cens, keyword, statusFilter, tenantFilter, planeFilter]);

  const openDetail = (r: Cen, tab: string = 'domains') => {
    const rid = String(r?.id || '');
    if (!rid) return;
    navigate(`/admin/sec-mgr-plane/cascade-channels/${encodeURIComponent(rid)}?tab=${encodeURIComponent(tab)}`);
  };

  const columns = [
    { title:'名称', dataIndex:'name', key:'name', render:(text: string, record: Cen) => (
      <Button type="link" onClick={() => openDetail(record)} style={{ color: '#1677ff', padding: 0 }}>{text}</Button>
    ) },
    { title:'租户', dataIndex:'tenantId', key:'tenant', render:(tid:string)=>tenantNameById(tid) },
    { title:'策略', dataIndex:'strategy', key:'strategy', render:(s:string)=><Tag color={s==='IPsec'?'cyan':'blue'}>{s||'SRv6'}</Tag> },
    { title:'状态', dataIndex:'status', key:'status', render:(s:Cen['status'])=>statusBadge(s) },
    { title:'丢包率', dataIndex:'loss', key:'loss', render:(v:number)=> v!==undefined? <Tag color={v<1?'green':v<3?'orange':'red'}>{v?.toFixed(2)}%</Tag>:'--' },
    { title:'延迟', dataIndex:'latency', key:'latency', render:(v:number)=> v? <Tag color={v<50?'green':v<100?'orange':'red'}>{v}ms</Tag>:'--' },
    { title:'SLA', dataIndex:'sla', key:'sla', render:(v:number)=> v? <Tag color={v>99?'green':v>95?'orange':'red'}>{v}%</Tag>:'--', onCell:(r:any)=>({onClick:()=>openDetail(r,'domains')}) },
    { title:'级联通道', key:'planes', render:(_:any, r:Cen)=>{ const { total, active } = planeStatsByAttachCount(r.attachCount||0); return <Tag color={active>0?'green':'default'}>{`${active}/${total}`}</Tag>; }, onCell:(r:any)=>({onClick:()=>openDetail(r,'topology')}) },
    { title:'已挂载安全域', dataIndex:'attachCount', key:'cnt', render:(v:number,r:Cen)=>(<Button type="link" onClick={()=>openDetail(r,'domains')} style={{ padding: 0 }}>{v||0}</Button>) },
    { title:'创建时间', dataIndex:'createdAt', key:'time' },
    { title:'操作', key:'act', fixed: 'right' as const, render:(_:any, r:Cen)=>{
      const items = [
        { key: 'view', label: '查看详情' },
        { key: 'attach', label: '挂载安全域' },
        { type: 'divider' as const },
        { key: 'delete', label: '删除级联通道', danger: true },
        { key: 'forceDelete', label: '强制删除（释放挂载）', danger: true },
      ];
      const onMenuClick = ({ key }: { key: string }) => {
        if (key === 'view') return openDetail(r, 'domains');
        if (key === 'attach') return openAttachModal(r.id);
        if (key === 'delete') return handleDelete(r.id);
        if (key === 'forceDelete') return handleForceDelete(r.id);
      };
      return (
        <ResourceActionsDropdown
          items={items}
          onClick={onMenuClick}
          buttonProps={{ className: 'row-actions-trigger', style: { margin: 0 } }}
        />
      );
    } },
  ];



  const handleCreate = async (vals:any) => {
    try {
      await createCen(vals);
      message.success('级联通道创建中');
      setModalVisible(false); form.resetFields();
      load();
    } catch(err){ message.error('创建失败'); }
  };

  const handleDelete = (id:string)=>{
    Modal.confirm({ title:'确认删除该级联通道？', onOk:async ()=>{
      try { await deleteCen(id); message.success('删除成功'); load(); } catch(err){ message.error('删除失败'); }
    }});
  };

  const handleForceDelete = (id:string)=>{
    Modal.confirm({ title:'确认强制删除该级联通道？', content:'将释放所有已挂载安全域（不删除安全域本身），并删除级联通道。', okText:'强制删除', onOk:async ()=>{
      try { const { forceDeleteCen } = await import('../../../../services/api'); await forceDeleteCen(id); message.success('已强制删除并释放挂载'); load(); } catch(err){ message.error('强制删除失败'); }
    }});
  };

  const openAttachModal = async (cenId:string)=>{
    setAttachDomainIds([]);
    setAttachPlaneIndex(undefined);
    try{
      const list = await listSecurityDomains();
      const opts: SecurityDomainOption[] = (Array.isArray(list)? list: []).map((d:any)=>({
        id: d.id,
        name: d.name,
        type: d.type,
        category: d.category,
        subType: d.subType,
        vpcId: d.vpcId,
        provider: d.provider,
        region: d.region,
        cloudId: d.cloudId,
          cidr: d.cidr,
          cidr6: d.cidr6,
          vrName: d.vrName,
          vrUuid: d.vrUuid,
          vrInstanceIds: d.vrInstanceIds,
          vrPublicEniIds: d.vrPublicEniIds,
          vrPrivateEniIds: d.vrPrivateEniIds,
          vrPublicIp: d.vrPublicIp,
          vrPublicEip: d.vrPublicEip,
          vrPrivateIp: d.vrPrivateIp,
          vrPublicSubnetCidr: d.vrPublicSubnetCidr,
          vrPrivateSubnetCidr: d.vrPrivateSubnetCidr,
      }));
      setDomains(opts);
    }catch(err){}
    try{
      const list = await fetchCenAttachments(cenId);
      setAttachmentCache(prev=>({...prev,[cenId]:list}));
    }catch{}
    setAttachModal({open:true, cenId});
  };

  const handleAttach = async ()=>{
    const cenId = attachModal.cenId;
    if(!cenId){ message.warning('请选择级联通道'); return; }
    if(!attachPlaneIndex && attachPlaneIndex!==0){ message.warning('请选择目标级联通道'); return; }
    if(!attachDomainIds.length){ message.warning('请选择至少一个安全域'); return; }
    let ok=0, fail=0;
    for(const did of attachDomainIds){
      const domain = domains.find(d=> d.id===did);
      if(!domain){ fail++; continue; }
      try{
        await attachVpcToCen(cenId, undefined, String(domain.id));
        ok++;
      }catch{ fail++; }
    }
    try{
      const fresh = await fetchCenAttachments(cenId);
      setAttachmentCache(prev=>({ ...prev, [cenId]: fresh }));
    }catch{}
    setAttachModal({open:false});
    message.success(`附加提交完成：成功 ${ok}，失败 ${fail}`);
    load();
  };

  return (
    <PageContainer
      titleLevel={3}
      asCard={false}
      pagePadding="24px 36px 0 36px"
      toolbarLeft={(
        <Form
          className="toolbar-container"
          form={filterForm}
          layout="inline"
          style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
          onValuesChange={(_, all) => {
            setKeyword(all.keyword || '');
            setStatusFilter(all.status);
            setTenantFilter(all.tenant);
            setPlaneFilter(all.plane);
          }}
          initialValues={{ status: [], tenant: undefined, plane: undefined }}
        >
          <Form.Item name="keyword" style={{ marginBottom: 0 }}>
            <Input
              allowClear
              placeholder="级联通道"
              className="toolbar-search"
              suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            />
          </Form.Item>
          <Form.Item name="status" style={{ marginBottom: 0 }}>
            <Select
              allowClear
              placeholder="状态"
              mode="multiple"
              className="toolbar-filter-sm"
              options={[
                { value: 'creating', label: '创建中' },
                { value: 'available', label: '可用' },
              ]}
            />
          </Form.Item>
          <Form.Item name="tenant" style={{ marginBottom: 0 }}>
            <Select
              allowClear
              placeholder="租户"
              className="toolbar-filter-sm"
              options={tenants.map((t) => ({ value: t.id, label: t.name }))}
            />
          </Form.Item>
          <button
            type="button"
            className="toolbar-reset-btn"
            onClick={() => {
              filterForm.resetFields();
              setKeyword('');
              setStatusFilter(undefined);
              setTenantFilter(undefined);
              setPlaneFilter(undefined);
            }}
          >
            重置
          </button>
        </Form>
      )}
      primaryAction={{ text: '新建级联通道', onClick: ()=>setModalVisible(true) }}
      moreMenuItems={[
        { key: 'bulkDelete', label: '批量删除', danger: true, disabled: selectedRowKeys.length === 0, onClick: () => {
              Modal.confirm({
                title: '确认批量删除',
                content: `将删除选中的 ${selectedRowKeys.length} 个级联通道，操作不可恢复。`,
                okText: '删除',
                cancelText: '取消',
                onOk: async () => {
                  try {
                    let ok = 0, fail = 0;
                    for (const id of selectedRowKeys) {
                      try {
                        await deleteCen(String(id));
                        ok++;
                      } catch {
                        fail++;
                      }
                    }
                    message.success(`删除成功 ${ok} 个，失败 ${fail} 个`);
                    setSelectedRowKeys([]);
                    load();
                  } catch (e: any) {
                    message.error('批量删除失败');
                  }
                }
              });
            } 
        },
      ]}
      onRefresh={load}
      actionsSize="middle"
      tableProps={{
        columns: columns as any,
        dataSource: filteredCens,
        rowKey: "id",
        className: "vr-table std-table",
        rowSelection: {
          selectedRowKeys,
          onChange: (keys: React.Key[]) => setSelectedRowKeys(keys),
        },
        pagination: {
          size: 'small',
          showTotal: (total) => `共 ${total} 条`,
        },
        scroll: { x: 'max-content' },
        tableLayout: "auto",
      }}
    >
      <Modal title="新建级联通道" open={modalVisible} onCancel={()=>{ setModalVisible(false); form.resetFields(); }} footer={null} destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={handleCreate}>
          <Form.Item name="name" label="名称" rules={[{ required:true }]}><Input /></Form.Item>
          <Form.Item name="tenantId" label="租户" rules={[{ required:true, message:'请选择租户' }]}>
            <Select placeholder="请选择租户" options={tenants.map(t=>({ value:t.id, label:t.name }))} />
          </Form.Item>
          <Form.Item name="strategy" label="互联策略" rules={[{ required:true, message:'请选择互联策略' }]} initialValue="SRv6">
            <Select options={[{ value:'SRv6', label:'SRv6 (支持 PE/CE VR)' }, { value:'IPsec', label:'IPsec (支持标准 VR)' }]} />
          </Form.Item>
          <Form.Item name="description" label="说明"><Input /></Form.Item>
          <Form.Item><Button type="primary" htmlType="submit">创建</Button></Form.Item>
        </Form>
      </Modal>

      <Modal title="挂载安全域" open={attachModal.open} onOk={handleAttach} onCancel={()=> setAttachModal({open:false})} destroyOnHidden>
        <Form layout="vertical">
          <Form.Item label="安全域">
            <Select mode="multiple" value={attachDomainIds} onChange={setAttachDomainIds} options={domains.map(d=>({ value:d.id, label:d.name }))} />
          </Form.Item>
          <Form.Item label="目标通道编号" tooltip="用于将选中的安全域挂载到该级联通道的指定编号，用于通道分组与后续隧道编排。">
            <Select value={attachPlaneIndex} onChange={setAttachPlaneIndex} options={[{ value:0, label:'通道 0' }, { value:1, label:'通道 1' }, { value:2, label:'通道 2' }]} />
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
};

export default CenPage;
