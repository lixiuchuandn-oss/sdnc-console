import React, { useEffect, useState, useMemo, useRef } from 'react';
import '../../common/filters.css';
import { Typography, Card, Row, Col, Table, Tag, Space as AntSpace, Button, Modal, Form, Input, message, Select, Badge, Divider, Dropdown, Descriptions } from 'antd';
import PageContainer from '../../../components/PageContainer';
import { 
  GlobalOutlined, 
  PlusOutlined, 
  DeleteOutlined, 
  LinkOutlined, 
  GatewayOutlined, 
  DeploymentUnitOutlined, 
  PartitionOutlined, 
  SafetyOutlined, 
  EllipsisOutlined, 
  EyeOutlined, 
  ReloadOutlined,
  SearchOutlined,
  EnvironmentOutlined,
  BranchesOutlined
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { fetchCens, createCen, deleteCen, attachVpcToCen, fetchTenants, fetchCenAttachments, detachVpcFromCen, fetchCloudProviderVpcs, fetchClouds, updateCen } from '../../../services/api';
import { getDomainClass, netClassLabel, netClassColor } from '../../../utils/netClass';
import { listInfoDomains } from '../../../services/infoDomainApi';
import ReactFlow, { Controls, Background, Handle, Position } from 'react-flow-renderer';
import SharedToolbar from '../../../components/SharedToolbar';

import ResourceDetailContainer from '../../../components/ResourceDetailContainer';
	
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

interface InfoDomainOption { id:string; name:string; type?:string; category?:string; subType?:string; vpcId?:string; provider?:string; region?:string; cloudId?:string; cidr?:string; cidr6?:string; vrName?:string; vrUuid?:string; vrInstanceIds?:string; vrPublicEniIds?:string; vrPrivateEniIds?:string; vrPublicIp?:string; vrPublicEip?:string; vrPrivateIp?:string; vrPublicSubnetCidr?:string; vrPrivateSubnetCidr?:string }

const CenPage: React.FC = () => {
  const [cens, setCens] = useState<Cen[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [planeTotal, setPlaneTotal] = useState(0);
  const [form] = Form.useForm();

  const [tenants, setTenants] = useState<any[]>([]);

  const [attachModal, setAttachModal] = useState<{open:boolean; cenId?:string}>({open:false});
  const [domains, setDomains] = useState<InfoDomainOption[]>([]);
  const [drawer, setDrawer] = useState<{open:boolean; cen?:Cen; tab?:string}>({open:false});

  const [planeActive, setPlaneActive] = useState(0);

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
          if (Array.isArray(raw)) return raw;
          if (Array.isArray((raw as any)?.Vpcs)) return (raw as any).Vpcs;
          if (Array.isArray((raw as any)?.vpcs)) return (raw as any).vpcs;
          if (Array.isArray((raw as any)?.Vpc)) return (raw as any).Vpc;
          if (Array.isArray((raw as any)?.list)) return (raw as any).list;
          if (Array.isArray((raw as any)?.items)) return (raw as any).items;
          if (Array.isArray((res as any)?.data?.Vpcs?.Vpc)) return (res as any)?.data?.Vpcs?.Vpc;
          if (Array.isArray((res as any)?.data?.vpcs)) return (res as any)?.data?.vpcs;
          if (Array.isArray((res as any)?.data?.items)) return (res as any)?.data?.items;
          return [];
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
      setAllDomains(opts);
        setDomainTotal(opts.length);
      }catch{ setDomainTotal(0); }
      setAttachedDomain(attachedDomainTimes);
      setAttachedDomainUnique(attachedDomainSet.size);
    } catch(err){}
    setLoading(false);
  };

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
  const [planeAssignments, setPlaneAssignments] = useState<{[cenId:string]: {[attachId:string]: number}}>({});
  const [domainCache, setDomainCache] = useState<{[vpcId:string]: InfoDomainOption}>({});
  const [attachDomainIds, setAttachDomainIds] = useState<string[]>([]);
  const [attachPlaneIndex, setAttachPlaneIndex] = useState<number | undefined>();
  const [channelStrategy, setChannelStrategy] = useState<{[cenId:string]:'SRv6'|'IPsec'}>({});

  const [detailModal, setDetailModal] = useState<{ open: boolean; cen?: Cen; tab: string }>({ open: false, tab: 'domains' });
  const [commKeyword, setCommKeyword] = useState('');
  const [domainKeyword, setDomainKeyword] = useState('');

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
        setAllDomains(opts);
      }catch{}
    })();
  }, []);

  useEffect(() => {
    if (detailModal.open && detailModal.cen) {
      const cid = detailModal.cen.id;
      fetchCenAttachments(cid).then((list) => {
        setAttachmentCache((prev) => ({ ...prev, [cid]: list }));
      }).catch(() => {});
    }
  }, [detailModal.open, detailModal.cen]);

  const domainOfAttachment = (att:any): InfoDomainOption | undefined => {
    if(!att) return undefined;
    const id = att?.infoDomain?.id || att?.infoDomainId;
    if(id){
      const found = allDomains.find(d=> String(d.id)===String(id));
      if(found) return found;
    }
    return undefined;
  };

  const openDetailModal = (r: Cen, tab: string = 'domains') => {
    console.log('openDetailModal called', r.id, tab);
    setDetailModal({ open: true, cen: r, tab });
  };

  const columns = [
    { title:'名称', dataIndex:'name', key:'name' },
    { title:'租户', dataIndex:'tenantId', key:'tenant', render:(tid:string)=>tenantNameById(tid) },
    { title:'策略', dataIndex:'strategy', key:'strategy', render:(s:string)=><Tag color={s==='IPsec'?'cyan':'blue'}>{s||'SRv6'}</Tag> },
    { title:'状态', dataIndex:'status', key:'status', render:(s:Cen['status'])=>statusBadge(s) },
    { title:'丢包率', dataIndex:'loss', key:'loss', render:(v:number)=> v!==undefined? <Tag color={v<1?'green':v<3?'orange':'red'}>{v?.toFixed(2)}%</Tag>:'--' },
    { title:'延迟', dataIndex:'latency', key:'latency', render:(v:number)=> v? <Tag color={v<50?'green':v<100?'orange':'red'}>{v}ms</Tag>:'--' },
    { title:'SLA', dataIndex:'sla', key:'sla', render:(v:number)=> v? <Tag color={v>99?'green':v>95?'orange':'red'}>{v}%</Tag>:'--', onCell:(r:any)=>({onClick:()=>openDetailModal(r,'metrics')}) },
    { title:'级联通道', key:'planes', render:(_:any, r:Cen)=>{ const { total, active } = planeStatsByAttachCount(r.attachCount||0); return <Tag color={active>0?'green':'default'}>{`${active}/${total}`}</Tag>; }, onCell:(r:any)=>({onClick:()=>openDetailModal(r,'topology')}) },
    { title:'已挂载信息域', dataIndex:'attachCount', key:'cnt', render:(v:number,r:Cen)=>(<a onClick={()=>openDetailModal(r,'domains')}>{v||0}</a>) },
    { title:'创建时间', dataIndex:'createdAt', key:'time' },
    { title:'操作', key:'act', render:(_:any, r:Cen)=>{
      const items = [
            { key:'view', label:(<span>查看详情</span>), icon:<EyeOutlined /> },
            { key:'attach', label:(<span>挂载信息域</span>), icon:<LinkOutlined /> },
        { type:'divider' as any },
            { key:'delete', label:(<span>删除级联通道</span>), icon:<DeleteOutlined />, danger:true },
            { key:'forceDelete', label:(<span>强制删除（释放挂载）</span>), icon:<DeleteOutlined />, danger:true },
      ];
      const onMenuClick = ({ key }:{ key:string })=>{
        if(key==='view') return openDetailModal(r);
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
    Modal.confirm({ title:'确认强制删除该级联通道？', content:'将释放所有已挂载信息域（不删除信息域本身），并删除级联通道。', okText:'强制删除', onOk:async ()=>{
      try { const { forceDeleteCen } = await import('../../../services/api'); await forceDeleteCen(id); message.success('已强制删除并释放挂载'); load(); } catch(err){ message.error('强制删除失败'); }
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

  const renderOverview = () => {
    if (!detailModal.cen) return null;
    const r = detailModal.cen;
    const { total, active } = planeStatsByAttachCount(r.attachCount || 0);
    return (
      <Descriptions bordered size="small" column={3} style={{ marginBottom: 16 }}>
        <Descriptions.Item label="名称">{r.name}</Descriptions.Item>
        <Descriptions.Item label="租户">{tenantNameById(r.tenantId)}</Descriptions.Item>
        <Descriptions.Item label="创建时间">{r.createdAt}</Descriptions.Item>
        <Descriptions.Item label="策略">
            <Tag color={r.strategy === 'IPsec' ? 'cyan' : 'geekblue'}>{r.strategy || 'SRv6'}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="状态">{statusBadge(r.status)}</Descriptions.Item>
        <Descriptions.Item label="接入地址">
            {r.accessIp || r.publicIp || r.privateIp || '--'}
        </Descriptions.Item>
        <Descriptions.Item label="级联通道">
            <Tag color={active > 0 ? 'green' : 'default'}>{`${active}/${total}`}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="丢包率">
            {r.loss !== undefined ? <Tag color={r.loss < 1 ? 'green' : r.loss < 3 ? 'orange' : 'red'}>{r.loss.toFixed(2)}%</Tag> : '--'}
        </Descriptions.Item>
        <Descriptions.Item label="延迟">
            {r.latency ? <Tag color={r.latency < 50 ? 'green' : r.latency < 100 ? 'orange' : 'red'}>{r.latency}ms</Tag> : '--'}
        </Descriptions.Item>
        <Descriptions.Item label="SLA">
            {r.sla ? <Tag color={r.sla > 99 ? 'green' : r.sla > 95 ? 'orange' : 'red'}>{r.sla}%</Tag> : '--'}
        </Descriptions.Item>
      </Descriptions>
    );
  };

  const renderDetailContent = () => {
    if (!detailModal.cen) return [];
    const record = detailModal.cen;
    const list = attachmentCache[record.id]||[];
    // 为了演示效果更佳，attaching 状态也参与通信关系计算
    const attached = list.filter((l:any)=>l.status==='attached' || l.status==='attaching');
    const filteredList = list.filter((att: any) => {
      if (!domainKeyword) return true;
      const kw = domainKeyword.toLowerCase();
      const dom = domainOfAttachment(att);
      const title = dom?.name || att.vpcName || att.vpcId || '';
      const id = dom?.id || att.id || '';
      return title.toLowerCase().includes(kw) || String(id).toLowerCase().includes(kw);
    });
    const topo = record.topology || 'Mesh';
    const strat = record.strategy || 'SRv6';
    const hubId = record.hubId;

    let doms = attached.map((att:any)=>({ att, dom: domainOfAttachment(att) })).filter(x=>!!x.dom);
    if (topo === 'Hub-Spoke') {
      // 如果选了 Hub，将其排到第一位；未选则默认第一个为 Hub
      const idx = hubId ? doms.findIndex((d:any) => String(d.dom!.id) === hubId) : 0;
      if (idx > -1 && idx < doms.length) {
        const [hub] = doms.splice(idx, 1);
        doms.unshift(hub);
      }
    }

    return [
      {
        key: 'domains',
        label: '信息域',
        icon: <EnvironmentOutlined />,
        children: (
          <div>
            <SharedToolbar
              left={<Input placeholder="请输入信息域名称/ID" allowClear value={domainKeyword} onChange={e => setDomainKeyword(e.target.value)} style={{ width: 220 }} prefix={<SearchOutlined style={{ color: '#ccc' }} />} />}
              right={
                <AntSpace>
                  <Button icon={<ReloadOutlined />} onClick={() => {
                    if (detailModal.cen) {
                      fetchCenAttachments(detailModal.cen.id).then((l) => {
                        setAttachmentCache((prev) => ({ ...prev, [detailModal.cen!.id]: l }));
                        message.success('刷新成功');
                      });
                    }
                  }} />
                  <Button type="primary" icon={<LinkOutlined />} onClick={() => openAttachModal(record.id)}>挂载信息域</Button>
                </AntSpace>
              }
            />
            <Table
              size="small"
              rowKey="id"
              dataSource={filteredList}
            pagination={false}
            columns={[
              {
                title: '信息域',
                key: 'info',
                render: (_: any, r: any) => {
                  const dom = domainOfAttachment(r);
                  const title = dom?.name || r.vpcName || r.vpcId;
                  const cls = getDomainClass({ category: dom?.category, subType: dom?.subType });
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontWeight: 500 }}>{title}</span>
                        {dom && <Tag color={netClassColor(cls)} style={{ margin: 0, fontSize: 10, lineHeight: '18px' }}>{netClassLabel(cls)}</Tag>}
                      </div>
                      <div style={{ fontSize: 12, color: '#888' }}>{dom?.id || '-'}</div>
                    </div>
                  );
                }
              },
              {
                title: 'VPC / CIDR',
                key: 'vpc',
                render: (_: any, r: any) => {
                  const dom = domainOfAttachment(r);
                  return (
                    <div style={{ fontSize: 12 }}>
                      <div>{dom?.vpcId || r.vpcId || '-'}</div>
                      <div style={{ color: '#888' }}>{dom?.cidr || r.vpcCidr || '-'}</div>
                      {dom?.cidr6 && <div style={{ color: '#888' }}>{dom.cidr6}</div>}
                    </div>
                  );
                }
              },
              {
                title: '云商 / 地域',
                key: 'region',
                render: (_: any, r: any) => {
                  const dom = domainOfAttachment(r);
                  return (
                    <div style={{ fontSize: 12 }}>
                      <div>{dom?.provider || '-'}</div>
                      <div style={{ color: '#888' }}>{dom?.region || '-'}</div>
                    </div>
                  );
                }
              },
              {
                title: '关联 VR',
                key: 'vr',
                render: (_: any, r: any) => {
                  const dom = domainOfAttachment(r);
                  return (
                    <div style={{ fontSize: 12 }}>
                      <div>{dom?.vrName || dom?.vrUuid || '-'}</div>
                      {dom?.vrPublicEip && <div style={{ color: '#888' }}>EIP: {dom.vrPublicEip}</div>}
                      {dom?.vrPrivateIp && <div style={{ color: '#888' }}>Pri: {dom.vrPrivateIp}</div>}
                    </div>
                  );
                }
              },
              {
                title: '状态',
                dataIndex: 'status',
                key: 'status',
                width: 100,
                render: (s: string) => <Badge status={s === 'attached' ? 'success' : 'processing'} text={s === 'attached' ? '已挂载' : s} />
              },
              {
                title: '操作',
                key: 'op',
                width: 80,
                render: (_: any, r: any) => (
                  r.status === 'attached' ? (
                    <Button type="link" danger size="small" style={{ padding: 0 }} onClick={async () => {
                      try {
                        await detachVpcFromCen(record.id, r.id);
                        message.success('已解除挂载');
                        load();
                      } catch {
                        message.error('解除失败');
                      }
                    }}>解除</Button>
                  ) : null
                )
              }
            ]}
          />
          </div>
        )
      },
      {
        key: 'topology',
        label: '级联通道拓扑',
        icon: <BranchesOutlined />,
        children: (() => {
          const domList = doms;
          const total = domList.length;
          const centerX = 520;
          const centerY = 260;
          const radius = 200;
          const nodeTypes = {
            mainNode: (props: any) => (
              <div style={{ width: 100, height: 60, borderRadius: 12, background: '#fff', border: '1px solid #e5e5e5', boxShadow: '0 4px 12px rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, position: 'relative' }}>
                <DeploymentUnitOutlined style={{ fontSize: 18, color: '#1677ff' }} />
                <div style={{ fontSize: 14, color: '#333', fontWeight: 500, maxWidth: 112, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{props?.data?.eip || '-'}</div>
                <Handle type="source" position={Position.Top} id="pub" style={{ opacity: 0, left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }} />
                <Handle type="target" position={Position.Top} id="pub" style={{ opacity: 0, left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }} />
              </div>
            ),
            domainCard: (props: any) => (
              <div style={{ width: 240, height: 72, borderRadius: 10, background: '#fff', border: '1px solid #e5e5e5', boxShadow: '0 3px 10px rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6, padding: '8px 12px', position: 'relative' }}>
                <div style={{ fontSize: 12, color: '#1f1f1f', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{props?.data?.title || '-'}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', overflow: 'hidden' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 6px', borderRadius: 8, border: '1px solid #e6f0ff', background: '#f7f9ff', maxWidth: 80 }}>
                    <GatewayOutlined style={{ fontSize: 12, color: '#1677ff' }} />
                    <span style={{ fontSize: 12, color: '#3a3a3a', overflow: 'hidden', textOverflow: 'ellipsis' }}>{props?.data?.vrName || '-'}</span>
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 6px', borderRadius: 8, border: '1px solid #e6f0ff', background: '#f7f9ff', maxWidth: 120 }}>
                    <PartitionOutlined style={{ fontSize: 12, color: '#fa8c16' }} />
                    <span style={{ fontSize: 12, color: '#3a3a3a', overflow: 'hidden', textOverflow: 'ellipsis' }}>{props?.data?.vpcCidr || '-'}</span>
                  </span>
                </div>
                <Handle type="source" position={Position.Top} id="card" style={{ opacity: 0, left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }} />
                <Handle type="target" position={Position.Top} id="card" style={{ opacity: 0, left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }} />
              </div>
            )
          };
          const mainNodes = domList.map((d: any, idx: number) => {
            const angle = total ? (idx * 2 * Math.PI) / total : 0;
            const x = centerX + Math.cos(angle) * radius;
            const y = centerY + Math.sin(angle) * radius;
            const eip = d?.dom?.vrPublicEip || d?.dom?.vrPublicIp || '-';
            return {
              id: `main-${String(d?.dom?.id)}`,
              type: 'mainNode',
              position: { x, y },
              data: { eip }
            };
          });
          const domainNodes = domList.map((d: any, idx: number) => {
            const mpos = mainNodes[idx]?.position || { x: centerX, y: centerY };
            const dx = mpos.x - centerX;
            const dy = mpos.y - centerY;
            const len = Math.sqrt(dx * dx + dy * dy) || 1;
            const ux = dx / len;
            const uy = dy / len;
            const mainW = 100, mainH = 60;
            const cardW = 220, cardH = 72;
            const gap = 24;
            const mainSupport = (mainW / 2) * Math.abs(ux) + (mainH / 2) * Math.abs(uy);
            const cardSupport = (cardW / 2) * Math.abs(ux) + (cardH / 2) * Math.abs(uy);
            const offset = mainSupport + cardSupport + gap;
            const outX = mpos.x + ux * offset - 55;
            const outY = mpos.y + uy * offset;
            const title = d?.dom?.name || d?.att?.vpcName || d?.att?.vpcId || '-';
            const vrName = d?.dom?.vrName || d?.dom?.vrUuid || '-';
            const vrPrivateIp = d?.dom?.vrPrivateIp || '-';
            const vpcCidr = d?.dom?.cidr || d?.att?.vpcCidr || '-';
            return {
              id: `domain-${String(d?.dom?.id)}`,
              type: 'domainCard',
              position: { x: outX, y: outY },
              data: { title: `${title}信息域`, vrName, vrPrivateIp, vpcCidr }
            };
          });
          const nodes = ([] as any[]).concat(mainNodes, domainNodes);
          const edges: any[] = [];
          if (total >= 2) {
            if (topo === 'Mesh') {
              for (let i = 0; i < domList.length; i++) {
                for (let j = i + 1; j < domList.length; j++) {
                  const a = `main-${String(domList[i]?.dom?.id)}`;
                  const b = `main-${String(domList[j]?.dom?.id)}`;
                  edges.push({ id: `${a}-${b}`, source: a, target: b, sourceHandle: 'pub', targetHandle: 'pub', type: 'straight', style: { stroke: '#1677ff', strokeWidth: 2 } });
                }
              }
            } else {
              const hub = `main-${String(domList[0]?.dom?.id)}`;
              for (let i = 1; i < domList.length; i++) {
                const spoke = `main-${String(domList[i]?.dom?.id)}`;
                edges.push({ id: `${hub}-${spoke}`, source: hub, target: spoke, sourceHandle: 'pub', targetHandle: 'pub', type: 'straight', style: { stroke: '#1677ff', strokeWidth: 2 } });
              }
            }
          }
          for (let i = 0; i < domList.length; i++) {
            const mid = `main-${String(domList[i]?.dom?.id)}`;
            const did = `domain-${String(domList[i]?.dom?.id)}`;
            edges.push({ id: `${mid}-${did}`, source: mid, target: did, sourceHandle: 'pub', targetHandle: 'card', type: 'straight', style: { stroke: '#bfbfbf', strokeWidth: 1.5 } });
          }
          return (
            <div style={{ height: 460, border: '1px solid #e8e8e8', borderRadius: 12, background: '#fafafa', backgroundImage: 'radial-gradient(rgba(0,0,0,0.08) 1px, transparent 1px)', backgroundSize: '22px 22px', backgroundPosition: '0 0', overflow: 'hidden', position: 'relative' }}>
              <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 10, display: 'flex', gap: 8, alignItems: 'center', background: 'rgba(255,255,255,0.8)', padding: '4px 8px', borderRadius: 6, backdropFilter: 'blur(4px)', border: '1px solid rgba(0,0,0,0.05)' }}>
                <span style={{ color: '#666', fontSize: 12 }}>拓扑模式</span>
                <Select 
                  size="small"
                  value={topo} 
                  style={{ width: 110 }} 
                  onChange={async (v) => {
                    try {
                      await updateCen(record.id, { topology: v });
                      const newCen = { ...record, topology: v };
                      setDetailModal(prev => ({ ...prev, cen: newCen }));
                      setCens(prev => prev.map(c => c.id === record.id ? newCen : c));
                      message.success('拓扑模式已更新');
                    } catch { message.error('更新失败'); }
                  }} 
                  options={[{ value: 'Mesh', label: 'Mesh' }, { value: 'Hub-Spoke', label: 'Hub-Spoke' }]} 
                />
                {topo === 'Hub-Spoke' && (
                  <>
                    <span style={{ color: '#666', fontSize: 12, marginLeft: 8 }}>中心节点</span>
                    <Select
                      size="small"
                      value={hubId || (domList.length > 0 ? String(domList[0].dom!.id) : undefined)}
                      placeholder="选择Hub"
                      style={{ width: 140 }}
                      onChange={async (v) => {
                        try {
                          await updateCen(record.id, { hubId: v });
                          const newCen = { ...record, hubId: v };
                          setDetailModal(prev => ({ ...prev, cen: newCen }));
                          setCens(prev => prev.map(c => c.id === record.id ? newCen : c));
                          message.success('中心节点已更新');
                        } catch { message.error('更新失败'); }
                      }}
                      options={domList.map((d: any) => ({ value: String(d.dom!.id), label: d.dom!.name }))}
                    />
                  </>
                )}
              </div>
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes as any}
                fitView
                fitViewOptions={{ padding: 0.2, maxZoom: 1.0 }}
                minZoom={0.4}
                maxZoom={1.6}
                style={{ background: 'transparent', width: '100%', height: '100%' }}
              >
                <Controls showInteractive={false} />
              </ReactFlow>
            </div>
          );
        })()
      }
    ];
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
          <Col xs={24} sm={12} md={6}><MetricCard title="信息域" total={domainTotal} unit="个" used={attachedDomainUnique} midLabel="未挂载" midValue={domainTotal-attachedDomainUnique} usedLabel="已挂载" mainColor="#1677ff" /></Col>
          <Col xs={24} sm={12} md={6}><MetricCard title="云端VPC" total={vpcTotal} unit="个" used={attachedVpcUnique} midLabel="未挂载" midValue={vpcTotal-attachedVpcUnique} usedLabel="已挂载" mainColor="#1677ff" /></Col>
        </Row>
      )}
      toolbarLeft={(
        <Form
          className="filter-tools"
          form={filterForm}
          layout="vertical"
          style={{ rowGap:12, columnGap:12, display:'flex', alignItems:'flex-end' }}
          onValuesChange={(_,all)=>{ setKeyword(all.keyword||''); setStatusFilter(all.status); setTenantFilter(all.tenant); setPlaneFilter(all.plane); }}
          initialValues={{ status: [], tenant: undefined, plane: undefined }}
        >
          <Form.Item name="keyword" label="关键字">
            <Input allowClear placeholder="搜索级联通道" style={{ width:200 }} />
          </Form.Item>
          <Form.Item name="status" label="状态">
            <Select allowClear placeholder="选择状态" mode="multiple" style={{ width:200 }} options={[{ value:'creating', label:'创建中' }, { value:'available', label:'可用' }]} />
          </Form.Item>
          <Form.Item name="tenant" label="租户">
            <Select allowClear placeholder="选择租户" style={{ width:200 }} options={tenants.map(t=>({ value:t.id, label:t.name }))} />
          </Form.Item>
          <Form.Item name="plane" label="级联通道">
            <Select allowClear placeholder="选择级联通道状态" style={{ width:200 }} options={[{ value:'active', label:'已生效（≥2信息域）' }, { value:'none', label:'未生效（＜2信息域）' }]} />
          </Form.Item>
          <Form.Item>
            <Button type="link" style={{ padding:0 }} onClick={()=>{filterForm.resetFields(); setKeyword(''); setStatusFilter(undefined); setTenantFilter(undefined); setPlaneFilter(undefined);}}>重置</Button>
          </Form.Item>
        </Form>
      )}
      primaryAction={{ text: '新建级联通道', onClick: ()=>setModalVisible(true) }}
      moreMenuItems={[
            { key:'refresh', label: '全局刷新', onClick: () => load() },
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
        } },
      ]}
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
      <ResourceDetailContainer
        open={detailModal.open}
        overviewNode={renderOverview()}
        width="95%"
        cloudId=""
        vmDetail={detailModal.cen}
        tabKey={detailModal.tab}
        onChangeTab={(k) => setDetailModal(prev => ({ ...prev, tab: k }))}
        onCloseModal={() => setDetailModal({ open: false, tab: 'domains' })}
        onRefreshAll={load}
        tabsItems={renderDetailContent()}
      />
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

      <Modal title="挂载信息域" open={attachModal.open} onOk={handleAttach} onCancel={()=> setAttachModal({open:false})} destroyOnHidden>
        <Form layout="vertical">
          <Form.Item label="信息域">
            <Select mode="multiple" value={attachDomainIds} onChange={setAttachDomainIds} options={domains.map(d=>({ value:d.id, label:d.name }))} />
          </Form.Item>
          <Form.Item label="目标通道编号" tooltip="用于将选中的信息域挂载到该级联通道的指定编号，用于通道分组与后续隧道编排。">
            <Select value={attachPlaneIndex} onChange={setAttachPlaneIndex} options={[{ value:0, label:'通道 0' }, { value:1, label:'通道 1' }, { value:2, label:'通道 2' }]} />
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
};

export default CenPage;
