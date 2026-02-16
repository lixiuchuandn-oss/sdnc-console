import React, { useEffect, useState, useMemo, useRef } from 'react';
import { Card, Row, Col, Table, Tag, Space as AntSpace, Button, Modal, Form, Input, message, Select, Badge, Dropdown } from 'antd';
import PageContainer from '../../../components/PageContainer';
import { 
  DeleteOutlined, 
  LinkOutlined, 
  EllipsisOutlined, 
  EyeOutlined, 
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { fetchCens, createCen, deleteCen, attachVpcToCen, fetchTenants, fetchCenAttachments, detachVpcFromCen, fetchCloudProviderVpcs, fetchClouds, updateCen, fetchServices } from '../../../services/api';
import { getDomainClass, netClassLabel, netClassColor } from '../../../utils/netClass';
import { listSecurityDomains } from '../../../services/securityDomainApi';

const MetricCard:React.FC<{title:string;total:number;unit?:string;used:number;midLabel:string;midValue:number;mainColor:string;usedLabel?:string}> = ({title,total,unit='',used,midLabel,midValue,mainColor,usedLabel})=>{
  const remain = Math.max(total - used - midValue, 0);
  const percent = total ? (used / total) * 100 : 0;
  const trail = '#d8dee8';
  return (
    <Card styles={{ body: { padding: 12 } }} style={{ borderRadius: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>{title}</span>
        <span style={{ color: '#8c8c8c', fontSize: 12 }}>总{unit} {total}{unit}</span>
      </div>
      <div style={{ height: 8, background: trail, borderRadius: 4, overflow: 'hidden', marginBottom: 8 }}>
        <div style={{ width: `${percent}%`, height: '100%', background: mainColor }} />
      </div>
      <div style={{ display: 'flex' }}>
        {[
          { label: usedLabel || '已用', value: used, color: mainColor },
          { label: midLabel, value: midValue, color: '#8c8c8c' },
          ...(remain > 0 ? [{ label: '剩余', value: remain, color: '#8c8c8c' }] : [])
        ].map((m, i, arr) => (
          <div key={i} style={{ flex: 1, padding: '8px 12px', background: '#fff', borderRight: i < arr.length - 1 ? '1px solid #f0f0f0' : 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 12, marginBottom: 2 }}>
              <span style={{ width: 8, height: 8, background: m.color, borderRadius: 2 }} /> {m.label}
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, color: '#1f1f1f', lineHeight: 1 }}>{m.value}{unit && <span style={{ fontSize: 12, color: '#8c8c8c', marginLeft: 3 }}>{unit}</span>}</div>
          </div>
        ))}
      </div>
    </Card>
  );
};

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
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [planeTotal, setPlaneTotal] = useState(0);
  const [form] = Form.useForm();

  const [tenants, setTenants] = useState<any[]>([]);

  const [attachModal, setAttachModal] = useState<{open:boolean; cenId?:string}>({open:false});
  const [domains, setDomains] = useState<SecurityDomainOption[]>([]);

  const [planeActive, setPlaneActive] = useState(0);

  const [attachmentCache, setAttachmentCache] = useState<{[k:string]:any[]}>({});
  const [filterForm] = Form.useForm();

  const [appTotal, setAppTotal] = useState(0);
  const [appRunning, setAppRunning] = useState(0);
  const [domainTotal,setDomainTotal]=useState(0);
  const [attachedDomain,setAttachedDomain]=useState(0);
  const [attachedDomainUnique,setAttachedDomainUnique]=useState(0);
  
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  const load = async () => {
    setLoading(true);
    try {
      const data = await fetchCens();
      const attachedVpcSet = new Set<string>();
      let attachedTimes = 0;
      const attachedDomainSet = new Set<string>();
      let attachedDomainTimes = 0;
      const dataWithCnt = await Promise.all(data.map(async (c:any)=>{
        try{
          const list = await fetchCenAttachments(c.id);
          list.forEach((att:any)=>{
            if(att?.vpcId && att.status==='attached') { attachedVpcSet.add(att.vpcId); attachedTimes += 1; }
            const domId = String(att?.securityDomain?.id || att?.securityDomainId || '');
            if(domId && att.status==='attached') { attachedDomainSet.add(domId); attachedDomainTimes += 1; }
          });
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

      const totalPlanes = dataWithCnt.length;
      const activePlanes = dataWithCnt.filter((c:any)=>c.attachCount>=2).length;
      setPlaneTotal(totalPlanes);
      setPlaneActive(activePlanes);

      try {
        const apps = await fetchServices();
        const list = Array.isArray(apps) ? apps : [];
        setAppTotal(list.length);
        setAppRunning(list.filter((a:any) => (a.status || 'running') === 'running').length);
      } catch {
        setAppTotal(0);
        setAppRunning(0);
      }
      try{
        const domains = await listSecurityDomains();
        const opts: any[] = Array.isArray(domains) ? domains : [];
        setDomainTotal(opts.length);
      }catch{ setDomainTotal(0); }
      setAttachedDomain(attachedDomainTimes);
      setAttachedDomainUnique(attachedDomainSet.size);
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
      <a onClick={() => openDetail(record)} style={{ color: '#1677ff' }}>{text}</a>
    ) },
    { title:'租户', dataIndex:'tenantId', key:'tenant', render:(tid:string)=>tenantNameById(tid) },
    { title:'策略', dataIndex:'strategy', key:'strategy', render:(s:string)=><Tag color={s==='IPsec'?'cyan':'blue'}>{s||'SRv6'}</Tag> },
    { title:'状态', dataIndex:'status', key:'status', render:(s:Cen['status'])=>statusBadge(s) },
    { title:'丢包率', dataIndex:'loss', key:'loss', render:(v:number)=> v!==undefined? <Tag color={v<1?'green':v<3?'orange':'red'}>{v?.toFixed(2)}%</Tag>:'--' },
    { title:'延迟', dataIndex:'latency', key:'latency', render:(v:number)=> v? <Tag color={v<50?'green':v<100?'orange':'red'}>{v}ms</Tag>:'--' },
    { title:'SLA', dataIndex:'sla', key:'sla', render:(v:number)=> v? <Tag color={v>99?'green':v>95?'orange':'red'}>{v}%</Tag>:'--', onCell:(r:any)=>({onClick:()=>openDetail(r,'metrics')}) },
    { title:'级联通道', key:'planes', render:(_:any, r:Cen)=>{ const { total, active } = planeStatsByAttachCount(r.attachCount||0); return <Tag color={active>0?'green':'default'}>{`${active}/${total}`}</Tag>; }, onCell:(r:any)=>({onClick:()=>openDetail(r,'topology')}) },
    { title:'已挂载安全域', dataIndex:'attachCount', key:'cnt', render:(v:number,r:Cen)=>(<a onClick={()=>openDetail(r,'domains')}>{v||0}</a>) },
    { title:'创建时间', dataIndex:'createdAt', key:'time' },
    { title:'操作', key:'act', render:(_:any, r:Cen)=>{
      const items = [
            { key:'view', label:(<span>查看详情</span>), icon:<EyeOutlined /> },
            { key:'attach', label:(<span>挂载安全域</span>), icon:<LinkOutlined /> },
        { type:'divider' as any },
            { key:'delete', label:(<span>删除级联通道</span>), icon:<DeleteOutlined />, danger:true },
            { key:'forceDelete', label:(<span>强制删除（释放挂载）</span>), icon:<DeleteOutlined />, danger:true },
      ];
      const onMenuClick = ({ key }:{ key:string })=>{
        if(key==='view') return openDetail(r, 'domains');
        if(key==='attach') return openAttachModal(r.id);
        if(key==='delete') return handleDelete(r.id);
        if(key==='forceDelete') return handleForceDelete(r.id);
      };
      return (
        <Dropdown menu={{ items, onClick:onMenuClick }} trigger={["click"]}>
          <Button type="text" icon={<EllipsisOutlined />} />
        </Dropdown>
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
      try { const { forceDeleteCen } = await import('../../../services/api'); await forceDeleteCen(id); message.success('已强制删除并释放挂载'); load(); } catch(err){ message.error('强制删除失败'); }
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
      collapsibleChildren={(
        <Row gutter={[12,12]} style={{ marginBottom:16 }}>
          <Col xs={24} sm={12} md={6}><MetricCard title="级联通道" total={planeTotal} unit="个" used={planeActive} midLabel="未生效" midValue={planeTotal-planeActive} usedLabel="生效" mainColor="#1677ff" /></Col>
          <Col xs={24} sm={12} md={6}><MetricCard title="活跃通道" total={cens.length} unit="个" used={cens.filter(c=>c.status==='available').length} midLabel="创建中" midValue={cens.filter(c=>c.status==='creating').length} usedLabel="可用" mainColor="#1677ff" /></Col>
          <Col xs={24} sm={12} md={6}><MetricCard title="安全域" total={domainTotal} unit="个" used={attachedDomainUnique} midLabel="未挂载" midValue={domainTotal-attachedDomainUnique} usedLabel="已挂载" mainColor="#1677ff" /></Col>
          <Col xs={24} sm={12} md={6}><MetricCard title="应用数量" total={appTotal} unit="个" used={appRunning} midLabel="未运行" midValue={appTotal-appRunning} usedLabel="运行中" mainColor="#1677ff" /></Col>
        </Row>
      )}
      toolbarLeft={(
        <Form
          className="toolbar-container"
          form={filterForm}
          layout="vertical"
          style={{ rowGap:12, columnGap:12, display:'flex', alignItems:'flex-end' }}
          onValuesChange={(_,all)=>{ setKeyword(all.keyword||''); setStatusFilter(all.status); setTenantFilter(all.tenant); setPlaneFilter(all.plane); }}
          initialValues={{ status: [], tenant: undefined, plane: undefined }}
        >
          <Form.Item name="keyword" label="关键字">
            <Input allowClear placeholder="搜索级联通道" className="toolbar-search" />
          </Form.Item>
          <Form.Item name="status" label="状态">
            <Select allowClear placeholder="选择状态" mode="multiple" className="toolbar-filter" options={[{ value:'creating', label:'创建中' }, { value:'available', label:'可用' }]} />
          </Form.Item>
          <Form.Item name="tenant" label="租户">
            <Select allowClear placeholder="选择租户" className="toolbar-filter" options={tenants.map(t=>({ value:t.id, label:t.name }))} />
          </Form.Item>
          <Form.Item name="plane" label="级联通道">
            <Select allowClear placeholder="选择级联通道状态" className="toolbar-filter" options={[{ value:'active', label:'已生效（≥2安全域）' }, { value:'none', label:'未生效（＜2安全域）' }]} />
          </Form.Item>
          <Form.Item>
            <Button
              type="link"
              className="toolbar-reset-btn"
              onClick={()=>{filterForm.resetFields(); setKeyword(''); setStatusFilter(undefined); setTenantFilter(undefined); setPlaneFilter(undefined);}}
            >
              重置
            </Button>
          </Form.Item>
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
        style: { fontSize: 13 },
        rowSelection: {
          selectedRowKeys,
          onChange: (keys: React.Key[]) => setSelectedRowKeys(keys),
        },
        pagination: { pageSize: 10, showSizeChanger: true },
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
