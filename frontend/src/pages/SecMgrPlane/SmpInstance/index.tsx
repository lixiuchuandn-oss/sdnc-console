import React, { useEffect, useState, useMemo } from 'react';
import '../../common/filters.css';
import { Breadcrumb, Typography, Card, Row, Col, Statistic, Table, Tag, Space as AntSpace, Button, Modal, Form, Input, message, Select, Drawer, Tabs, Badge, Collapse, Divider, Progress, Dropdown, Alert, Transfer } from 'antd';
import TestChart from '../../../components/TestChart';
import PageContainer from '../../../components/PageContainer';
import { HomeOutlined, GlobalOutlined, PlusOutlined, DeleteOutlined, LinkOutlined, CloudOutlined, DeploymentUnitOutlined, CheckOutlined, EnvironmentOutlined, SafetyOutlined, EllipsisOutlined, InfoCircleOutlined, EyeOutlined, ReloadOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { fetchCens, createCen, deleteCen, attachVpcToCen, fetchTenants, fetchCenAttachments, detachVpcFromCen, fetchCloudProviderVpcs, fetchClouds } from '../../../services/api';
import { getDomainClass, netClassLabel, netClassColor } from '../../../utils/netClass';
import { listInfoDomains } from '../../../services/infoDomainApi';
import { ReactNode } from 'react';

const StatCard:React.FC<{title:string;icon:ReactNode;color:string;value:number}> = ({title,icon,color,value})=> {
  const bg = `${color}26`;
  return (
    <Card styles={{ body: { padding:20 } }} style={{ background:'#fff', borderRadius:8, border:'1px solid #f0f0f0' }}>
      <div style={{ display:'flex', alignItems:'center', gap:16 }}>
        <div style={{ width:48, height:48, borderRadius:'50%', background:bg, display:'flex', alignItems:'center', justifyContent:'center', color:color, fontSize:22 }}>
          {icon}
        </div>
        <div style={{ lineHeight:1, flex:1 }}>
          <div style={{ fontSize:24, fontWeight:600, color:'#333' }}>{value}</div>
          <div style={{ fontSize:13, color:'#888', marginTop:4 }}>{title}</div>
        </div>
      </div>
    </Card>
  );
};

interface ResourceCardProps {title:string; total:number; partA:{label:string; value:number; color:string}; partB:{label:string; value:number; color:string}}

const MetricCard:React.FC<{title:string;total:number;unit?:string;used:number;midLabel:string;midValue:number;mainColor:string}> = ({title,total,unit='',used,midLabel,midValue,mainColor})=>{
  const remain = Math.max(total - used - midValue, 0);
  const percent = total ? (used / total) * 100 : 0;
  const trail = '#d8dee8';
  return (
    <Card styles={{ body: { padding: 24 } }} style={{ borderRadius: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <span style={{ fontWeight: 600 }}>{title}</span>
        <span style={{ color: '#8c8c8c' }}>总{unit} {total}{unit}</span>
      </div>
      <div style={{ height: 14, background: trail, borderRadius: 7, overflow: 'hidden', marginBottom: 12 }}>
        <div style={{ width: `${percent}%`, height: '100%', background: mainColor }} />
      </div>
      <div style={{ display: 'flex' }}>
        {[
          { label: '已用', value: used, color: mainColor },
          { label: midLabel, value: midValue, color: '#8c8c8c' },
          ...(remain > 0 ? [{ label: '剩余', value: remain, color: '#8c8c8c' }] : [])
        ].map((m, i, arr) => (
          <div key={i} style={{ flex: 1, padding: '12px 16px', background: '#fff', borderRight: i < arr.length - 1 ? '1px solid #f0f0f0' : 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 14, marginBottom: 2 }}>
              <span style={{ width: 10, height: 10, background: m.color, borderRadius: 2 }} /> {m.label}
            </div>
            <div style={{ fontSize: 32, fontWeight: 700, color: '#1f1f1f', lineHeight: 1 }}>{m.value}{unit && <span style={{ fontSize: 14, color: '#8c8c8c', marginLeft: 4 }}>{unit}</span>}</div>
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
  status: 'creating' | 'available';
  createdAt: string;
  tenantId: string;
  attachCount: number;
  loss?: number;
  latency?: number;
  sla?: number;
}

  interface InfoDomainOption { id:string; name:string; type?:string; category?:string; subType?:string; vpcId?:string; provider?:string; region?:string; cloudId?:string; cidr?:string; cidr6?:string; vpcMode?:'existing'|'new' }

const CenPage: React.FC = () => {
  const [cens, setCens] = useState<Cen[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [planeTotal, setPlaneTotal] = useState(0);
  const [form] = Form.useForm();

  const [tenants, setTenants] = useState<any[]>([]);

  const [attachModal, setAttachModal] = useState<{open:boolean; cenId?:string}>({open:false});
  const [domains, setDomains] = useState<InfoDomainOption[]>([]);
  const [selectedDomainId, setSelectedDomainId] = useState<string | undefined>();
  const [drawer, setDrawer] = useState<{open:boolean; cen?:Cen; tab?:string}>({open:false});

  const navigate = useNavigate();

  const [planeActive, setPlaneActive] = useState(0);
  const [planeInactive, setPlaneInactive] = useState(0);
  const [planeOverviewOpen, setPlaneOverviewOpen] = useState(false);

  const [attachmentCache, setAttachmentCache] = useState<{[k:string]:any[]}>({});
  const [filterForm] = Form.useForm();
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<string[]|undefined>();
  const [tenantFilter, setTenantFilter] = useState<string|undefined>();

  const [vpcTotal,setVpcTotal]=useState(0);
  const [attachedVpc,setAttachedVpc]=useState(0);
  const [attachedVpcUnique,setAttachedVpcUnique]=useState(0);
  const [domainTotal,setDomainTotal]=useState(0);
  const [attachedDomain,setAttachedDomain]=useState(0);
  const [attachedDomainUnique,setAttachedDomainUnique]=useState(0);

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
            const domId = String(att?.infoDomain?.id || att?.infoDomainId || '');
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
        const clouds = await fetchClouds();
        const arr = await Promise.all((Array.isArray(clouds) ? clouds : []).map((c:any)=> fetchCloudProviderVpcs(String(c.id)).catch(()=>[])));
        const flat = ([] as any[]).concat(...arr.map((res:any)=> {
          const raw = res?.data || res || [];
          return Array.isArray(raw?.vpcs) ? raw.vpcs : Array.isArray(raw?.Vpcs) ? raw.Vpcs : Array.isArray(raw?.list) ? raw.list : (Array.isArray(raw) ? raw : []);
        }));
        setVpcTotal(flat.length);
      } catch {
        setVpcTotal(0);
      }
      setAttachedVpc(attachedTimes);
      setAttachedVpcUnique(attachedVpcSet.size);
      try{
        const domains = await listInfoDomains();
        const opts: InfoDomainOption[] = (Array.isArray(domains)? domains: []).map((d:any)=>({
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
          vpcMode: d.vpcMode,
        }));
        setAllDomains(opts);
        setDomainTotal(opts.length);
      }catch{ setDomainTotal(0); }
      setAttachedDomain(attachedDomainTimes);
      setAttachedDomainUnique(attachedDomainSet.size);
    } catch(err){}
    setLoading(false);
  };

  useEffect(()=>{ load(); }, []);

  const statusTag = (s:Cen['status'])=>{
    const map:any = { creating:'blue', available:'green' };
    const txt:any = { creating:'创建中', available:'可用' };
    return <Tag color={map[s]}>{txt[s]}</Tag>;
  };

  const statusBadge = (s:Cen['status'])=>{
    const color = s==='available'? 'green': s==='creating'? 'blue':'default';
    const text = s==='available'? '可用':'创建中';
    return <Badge color={color} text={text} />;
  };

  const tenantNameById = (id:string)=> tenants.find(t=>t.id===id)?.name || '-';

  const planeStatsByAttachCount = (cnt:number)=>{
    const total = Math.floor((cnt||0)/2);
    const active = total;
    return { total, active };
  };

  const groupPlanes = (list:any[], assignment?:{[attachId:string]:number})=>{
    const planes:any[] = [];
    if(!list || !list.length) return planes;
    const assignedGroups: { [idx:number]: any[] } = {};
    const unassigned: any[] = [];
    if(assignment && Object.keys(assignment).length){
      for(const att of list){
        const idx = assignment[att.id];
        if(idx!==undefined){
          if(!assignedGroups[idx]) assignedGroups[idx] = [];
          assignedGroups[idx].push(att);
        }else{
          unassigned.push(att);
        }
      }
      const sortedIdx = Object.keys(assignedGroups).map(n=>Number(n)).sort((a,b)=>a-b);
      for(const i of sortedIdx){
        const group = assignedGroups[i] || [];
        planes.push({ vpcs: group, active: group.length>=2 });
      }
      let j=0;
      while(j<unassigned.length){
        const remain = unassigned.length - j;
        if(remain===1){ planes.push({ vpcs:[unassigned[j]], active:false }); break; }
        const size = remain>=3 ? 3 : 2;
        const group = unassigned.slice(j, j+size);
        planes.push({ vpcs:group, active:group.length>=2 });
        j += size;
      }
      return planes;
    }
    let i=0;
    while(i<list.length){
      const remain = list.length - i;
      if(remain===1){
        planes.push({ vpcs:[list[i]], active:false });
        break;
      }
      const size = remain>=3 ? 3 : 2;
      const group = list.slice(i, i+size);
      planes.push({ vpcs:group, active:group.length>=2 });
      i += size;
    }
    return planes;
  };

  const [planeFilter, setPlaneFilter] = useState<string|undefined>();
  const [allDomains, setAllDomains] = useState<InfoDomainOption[]>([]);
  const [planeModal, setPlaneModal] = useState<{open:boolean}>({ open:false });
  const [planeCenId, setPlaneCenId] = useState<string|undefined>();
  const [planeDomainIds, setPlaneDomainIds] = useState<string[]>([]);
  const [planeSubmitting, setPlaneSubmitting] = useState<boolean>(false);
  const [planeAssignments, setPlaneAssignments] = useState<{[cenId:string]: {[attachId:string]: number}}>({});
  const [domainCache, setDomainCache] = useState<{[vpcId:string]: InfoDomainOption}>({});
  const [attachDomainIds, setAttachDomainIds] = useState<string[]>([]);
  const [attachPlaneIndex, setAttachPlaneIndex] = useState<number | undefined>();

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

  useEffect(()=>{
    (async()=>{
      try{
        const list = await listInfoDomains();
        const opts: InfoDomainOption[] = (Array.isArray(list)? list: []).map((d:any)=>({
          id: d.id,
          name: d.name,
          type: d.type,
          category: d.category,
          subType: d.subType,
          vpcId: d.vpcId,
          provider: d.provider,
          region: d.region,
          cloudId: d.cloudId,
          newVpcCidr: d.newVpcCidr,
          cidr: d.cidr,
          cidr6: d.cidr6,
          vpcMode: d.vpcMode,
        }));
        setAllDomains(opts);
      }catch{}
    })();
  }, []);

  const domainByVpc = (vpc:any): InfoDomainOption | undefined => {
    if(!vpc) return undefined;
    const cidr = String(vpc.cidrBlock||'').trim();
    const vid = vpc.id ? String(vpc.id) : undefined;
    if(vid && domainCache[vid]) return domainCache[vid];
    if(vid){
      const byId = allDomains.find(d=> String(d.vpcId||'')===vid);
      if(byId) return byId;
    }
    const byCidr = allDomains.find(d=> String(d.cidr || d.cidr6 || '').trim() === cidr);
    if(byCidr) return byCidr;
    return allDomains.find(d=> String(d.name||'')===String(vpc.name||''));
  };

  const domainOfAttachment = (att:any): InfoDomainOption | undefined => {
    if(!att) return undefined;
    const id = att?.infoDomain?.id || att?.infoDomainId;
    if(id){
      const found = allDomains.find(d=> String(d.id)===String(id));
      if(found) return found;
    }
    return undefined;
  };

  const columns = [
    { title:'名称', dataIndex:'name', key:'name' },
    { title:'租户', dataIndex:'tenantId', key:'tenant', render:(tid:string)=>tenantNameById(tid) },
    { title:'状态', dataIndex:'status', key:'status', render:(s:Cen['status'])=>statusBadge(s) },
    { title:'丢包率', dataIndex:'loss', key:'loss', render:(v:number)=> v!==undefined? <Tag color={v<1?'green':v<3?'orange':'red'}>{v?.toFixed(2)}%</Tag>:'--' },
    { title:'延迟', dataIndex:'latency', key:'latency', render:(v:number)=> v? <Tag color={v<50?'green':v<100?'orange':'red'}>{v}ms</Tag>:'--' },
    { title:'SLA', dataIndex:'sla', key:'sla', render:(v:number)=> v? <Tag color={v>99?'green':v>95?'orange':'red'}>{v}%</Tag>:'--', onCell:(r:any)=>({onClick:()=>openDrawer(r,'metrics')}) },
    { title:'安全面', key:'planes', render:(_:any, r:Cen)=>{ const { total, active } = planeStatsByAttachCount(r.attachCount||0); return <Tag color={active>0?'green':'default'}>{`${active}/${total}`}</Tag>; }, onCell:(r:any)=>({onClick:()=>openDrawer(r,'security')}) },
    { title:'已挂载信息域', dataIndex:'attachCount', key:'cnt', render:(v:number,r:Cen)=>(<a onClick={()=>openDrawer(r)}>{v||0}</a>) },
    { title:'创建时间', dataIndex:'createdAt', key:'time' },
    { title:'操作', key:'act', render:(_:any, r:Cen)=>{
      const items = [
            { key:'view', label:(<span>查看详情</span>), icon:<EyeOutlined /> },
            { key:'attach', label:(<span>挂载信息域</span>), icon:<LinkOutlined /> },
            { key:'security', label:(<span>打开安全面</span>), icon:<SafetyOutlined /> },
        { type:'divider' as any },
            { key:'delete', label:(<span>删除切片</span>), icon:<DeleteOutlined />, danger:true },
      ];
      const onMenuClick = ({ key }:{ key:string })=>{
        if(key==='view') return openDrawer(r);
        if(key==='attach') return openAttachModal(r.id);
        if(key==='security') return openDrawer(r,'security');
        if(key==='delete') return handleDelete(r.id);
      };
      return (
        <Dropdown menu={{ items, onClick:onMenuClick }} trigger={["click"]}>
          <Button type="text" icon={<EllipsisOutlined />} />
        </Dropdown>
      );
    } },
  ];

  const openDrawer = (r: Cen, tab?: string) => {
    setDrawer({ open: true, cen: r, tab });
  };

  const handleCreate = async (vals:any) => {
    try {
      await createCen(vals);
      message.success('CEN 创建中');
      setModalVisible(false); form.resetFields();
      load();
    } catch(err){ message.error('创建失败'); }
  };

  const handleDelete = (id:string)=>{
    Modal.confirm({ title:'确认删除该 CEN ?', onOk:async ()=>{
      try { await deleteCen(id); message.success('删除成功'); load(); } catch(err){ message.error('删除失败'); }
    }});
  };

  const openAttachModal = async (cenId:string)=>{
    setAttachDomainIds([]);
    setAttachPlaneIndex(undefined);
    try{
      const list = await listInfoDomains();
      const opts: InfoDomainOption[] = (Array.isArray(list)? list: []).map((d:any)=>({
        id: d.id,
        name: d.name,
        type: d.type,
        category: d.category,
        subType: d.subType,
        vpcId: d.vpcId,
        provider: d.provider,
        region: d.region,
        cloudId: d.cloudId,
          newVpcCidr: d.newVpcCidr,
          cidr: d.cidr,
          cidr6: d.cidr6,
          vpcMode: d.vpcMode,
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
    if(!cenId){ message.warning('请选择网络切片'); return; }
    if(!attachPlaneIndex && attachPlaneIndex!==0){ message.warning('请选择目标安全管理面'); return; }
    if(!attachDomainIds.length){ message.warning('请选择至少一个信息域'); return; }
    let ok=0, fail=0;
    const newlyAttachedDomainIds: string[] = [];
    for(const did of attachDomainIds){
      const domain = domains.find(d=> d.id===did);
      if(!domain){ fail++; continue; }
      try{
        await attachVpcToCen(cenId, undefined, String(domain.id));
        newlyAttachedDomainIds.push(String(domain.id));
        ok++;
      }catch{ fail++; }
    }
    try{
      const fresh = await fetchCenAttachments(cenId);
      setAttachmentCache(prev=>({ ...prev, [cenId]: fresh }));
      const assignments = { ...(planeAssignments[cenId]||{}) };
      for(const att of (fresh||[])){
        const domId = String(att?.infoDomain?.id||att?.infoDomainId||'');
        if(domId && newlyAttachedDomainIds.includes(domId)){
          assignments[att.id] = Number(attachPlaneIndex);
        }
      }
      setPlaneAssignments(prev=>({ ...prev, [cenId]: assignments }));
    }catch{}
    setAttachModal({open:false});
    message.success(`附加提交完成：成功 ${ok}，失败 ${fail}`);
    load();
  };

  const expandedRowRender = (record:Cen)=>{
    const list = attachmentCache[record.id]||[];
    if(!list.length) return <Tag color="warning">暂无挂载</Tag>;
    const planes = groupPlanes(list.filter((l:any)=>l.status==='attached'), planeAssignments[record.id]);
    return (
      <div style={{ background:'#fafafa', padding:12, borderRadius:6 }}>
        <div style={{ display:'flex', alignItems:'center', marginBottom:8 }}>
          <EnvironmentOutlined style={{ marginRight:6, color:'#1677ff' }} />
          <span style={{ fontWeight:'normal' }}>信息域</span>
        </div>
        <Row gutter={[12,12]}>
          {list.map((att:any)=>(
            <Col xs={24} sm={12} md={6} key={att.id}>
              <Card size="small" title={(() => {
                const dom = domainOfAttachment(att);
                const title = dom?.name || att.vpcName || att.vpcId;
                const cls = getDomainClass({ category: dom?.category, subType: dom?.subType });
                return (
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                    <span>{title}</span>
                    {dom && <Tag color={netClassColor(cls)}>{netClassLabel(cls)}</Tag>}
                  </div>
                );
              })()}
                extra={att.status==='attached' ? (<Button size="small" danger type="link" onClick={async()=>{ try{ await detachVpcFromCen(record.id, att.vpcId); message.success('已解除挂载'); load(); }catch{ message.error('解除失败'); } }}>解除</Button>) : undefined}
               >
                <div style={{ fontSize:12, color:'#888' }}>
                  <div>VPC：{att.vpcName || att.vpcId || '-'}</div>
                  <div>状态：{att.status || '-'}</div>
                </div>
              </Card>
            </Col>
          ))}
        </Row>
      </div>
    );
  };

  return (
    <PageContainer
      title="实例管理"
      titleLevel={3}
      subtitle="跨地域互联的中心网实例（CEN），支持挂载信息域并抽象为安全管理面用于统一治理。"
      asCard={false}
    >
      <Divider style={{ margin:'0 0 16px 0' }} />
      <div style={{ padding:'0 24px' }}>
        <Row gutter={[12,12]}>
          <Col xs={24} sm={12} md={6}><StatCard title="安全管理面（活跃/总计）" icon={<DeploymentUnitOutlined />} color="#52c41a" value={planeActive} /></Col>
          <Col xs={24} sm={12} md={6}><StatCard title="信息域（已挂载/唯一）" icon={<EnvironmentOutlined />} color="#1677ff" value={attachedDomainUnique} /></Col>
          <Col xs={24} sm={12} md={6}><StatCard title="云端VPC（已挂载/唯一）" icon={<CloudOutlined />} color="#722ed1" value={attachedVpcUnique} /></Col>
          <Col xs={24} sm={12} md={6}><StatCard title="活跃中心网（实例总数）" icon={<GlobalOutlined />} color="#fa8c16" value={planeActive} /></Col>
        </Row>

        <Card style={{ marginTop:12 }}>
          <div className="filters-row">
            <Form form={filterForm} layout="inline" onValuesChange={(_,all)=>{ setKeyword(all.keyword||''); setStatusFilter(all.status); setTenantFilter(all.tenant); setPlaneFilter(all.plane); }}>
              <Form.Item name="keyword" label="关键字"><Input allowClear placeholder="搜索中心网实例" style={{ width:220 }} /></Form.Item>
              <Form.Item name="status" label="状态"><Select allowClear placeholder="选择状态" style={{ width:160 }} options={[{ value:'creating', label:'创建中' }, { value:'available', label:'可用' }]} /></Form.Item>
              <Form.Item name="tenant" label="租户"><Select allowClear placeholder="选择租户" style={{ width:160 }} options={tenants.map(t=>({ value:t.id, label:t.name }))} /></Form.Item>
              <Form.Item name="plane" label="安全面"><Select allowClear placeholder="选择安全面状态" style={{ width:180 }} options={[{ value:'active', label:'已生效（≥2信息域）' }, { value:'none', label:'未生效（＜2信息域）' }]} /></Form.Item>
              <Form.Item style={{ marginLeft:'auto' }}>
                <AntSpace>
                  <Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>
                  <Button type="primary" icon={<PlusOutlined />} onClick={()=>{ setModalVisible(true); }}>新建中心网实例</Button>
                </AntSpace>
              </Form.Item>
            </Form>
          </div>
          <Divider style={{ margin:'12px 0' }} />
          <Table columns={columns as any} dataSource={filteredCens} rowKey="id" loading={loading} pagination={{ pageSize: 10, showSizeChanger: true }} expandable={{ expandedRowRender }} />
        </Card>

        <Modal title="新建中心网实例" open={modalVisible} onCancel={()=>{ setModalVisible(false); form.resetFields(); }} footer={null} destroyOnHidden>
          <Form form={form} layout="vertical" onFinish={handleCreate}>
            <Form.Item name="name" label="名称" rules={[{ required:true }]}><Input /></Form.Item>
            <Form.Item name="description" label="说明"><Input /></Form.Item>
            <Form.Item><Button type="primary" htmlType="submit">创建</Button></Form.Item>
          </Form>
        </Modal>

        <Modal title="挂载信息域" open={attachModal.open} onOk={handleAttach} onCancel={()=> setAttachModal({open:false})} destroyOnHidden>
          <Form layout="vertical">
            <Form.Item label="信息域">
              <Select mode="multiple" value={attachDomainIds} onChange={setAttachDomainIds} options={domains.map(d=>({ value:d.id, label:d.name }))} />
            </Form.Item>
            <Form.Item label="安全面索引">
              <Select value={attachPlaneIndex} onChange={setAttachPlaneIndex} options={[{ value:0, label:'索引 0' }, { value:1, label:'索引 1' }, { value:2, label:'索引 2' }]} />
            </Form.Item>
          </Form>
        </Modal>
      </div>
    </PageContainer>
  );
};

export default CenPage;
