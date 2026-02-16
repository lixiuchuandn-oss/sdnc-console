import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Table, Tag, Dropdown, Card, Space, Button, Input, Select, Tabs, Descriptions, Row, Col, Statistic, Form, Drawer, Modal, InputNumber, App, Tooltip, Alert, DatePicker, Divider } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useNavigate, useLocation } from 'react-router-dom';
import { HomeOutlined, CloudUploadOutlined, ReloadOutlined, ArrowLeftOutlined, MoreOutlined, EditOutlined, DeleteOutlined, CheckOutlined, CloseOutlined, PlayCircleOutlined, PoweroffOutlined, CopyOutlined, EyeOutlined, DashboardOutlined, LineChartOutlined, WindowsOutlined, CodeOutlined, CloudServerOutlined, ClusterOutlined, SafetyCertificateOutlined, GlobalOutlined, DeploymentUnitOutlined, SwapOutlined, NodeIndexOutlined, HddOutlined, CameraOutlined, BranchesOutlined } from '@ant-design/icons';
import PageDetailContainer from '../../../components/PageDetailContainer';
import { fetchClouds, fetchCloudProviderVpcs, fetchCloudProviderEcs, fetchCloudProviderSubnets, fetchCloudProviderSecurityGroups, fetchCloudProviderEips, fetchCloudProviderLoadBalancers, fetchCloudProviderNatGateways, fetchCloudProviderRouteTables, fetchCloudProviderDisks, fetchCloudProviderSnapshots, fetchCloudProviderEcsVncUrl, createCloudProviderRouteTable, updateCloudProviderRouteTable, associateCloudProviderRouteTable, deleteCloudProviderRouteTable, fetchCloudProviderRouteEntries, modCloudProviderRouteEntry, deleteCloudProviderRouteEntry, deleteCloudProviderVpc, startCloudProviderEcs, stopCloudProviderEcs, rebootCloudProviderEcs, deleteCloudProviderEcs } from '../../../services/api';
import { showCloudProviderVpc, showCloudProviderSecurityGroup, deleteHuaweiCloudSecurityGroup, createHuaweiCloudSecurityGroupRule, deleteHuaweiCloudSecurityGroupRule, updateHuaweiCloudSecurityGroupRule, fetchHuaweiEcsMetrics, fetchHuaweiEcsAuditLogs, fetchHuaweiPorts, updateHuaweiPortSourceDestCheck, bindHuaweiEip, unbindHuaweiEip, fetchHuaweiCesMetrics, fetchHuaweiCesAvailableMetrics, fetchHuaweiEcsAuditTraces, addHuaweiPortSecurityGroup, removeHuaweiPortSecurityGroup, deleteHuaweiCloudSubnet as deleteCloudProviderSubnet } from '../../../services/huaweiApi';
import StdFormModal from '../../../components/StdFormModal';
import StdSideDrawer from '../../../components/StdSideDrawer';
import { statusTag, EllipsisText, SubResourceCard, collectIpv4FromAddresses, collectInstanceIpv4 } from './components/Common';
import { normalizeErr } from './utils/net';
// force update
import VpcCreateModal from './modals/VpcCreateModal';
import SubnetCreateModal from './modals/SubnetCreateModal';
import SubnetEditModal from './modals/SubnetEditModal';
import VpcEditModal from './modals/VpcEditModal';
import RouteTableCreateModal from './modals/RouteTableCreateModal';
import RouteTableEditModal from './modals/RouteTableEditModal';
import RouteEntryEditDrawer from './drawers/RouteEntryEditDrawer';
import RouteEntryCreateDrawer from './drawers/RouteEntryCreateDrawer';
import RouteEntryManageDrawer from './drawers/RouteEntryManageDrawer';
import SecurityGroupRuleManageDrawer from './drawers/SecurityGroupRuleManageDrawer';
import SecurityGroupRefsModal from './modals/SecurityGroupRefsModal';
import SecurityGroupCreateModal from './modals/SecurityGroupCreateModal';
import RouteTableAssociateModal from './modals/RouteTableAssociateModal';
import EcsSection, { Icon as EcsIcon, Label as EcsLabel } from './sections/EcsSection';
import VpcSection, { Icon as VpcIcon, Label as VpcLabel } from './sections/VpcSection';
import SubnetSection, { Icon as SubnetIcon, Label as SubnetLabel } from './sections/SubnetSection';
import SecurityGroupSection, { Icon as SgIcon, Label as SgLabel } from './sections/SecurityGroupSection';
import RouteTableSection, { Icon as RtIcon, Label as RtLabel } from './sections/RouteTableSection';
import EipSection, { Icon as EipIcon, Label as EipLabel } from './sections/EipSection';
import LoadBalancerSection, { Icon as SlbIcon, Label as SlbLabel } from './sections/LoadBalancerSection';
import NatGatewaySection, { Icon as NatIcon, Label as NatLabel } from './sections/NatGatewaySection';
import DiskSection, { Icon as DiskIcon, Label as DiskLabel } from './sections/DiskSection';
import SnapshotSection, { Icon as SnapshotIcon, Label as SnapshotLabel } from './sections/SnapshotSection';
import VmDetailModal from './modals/VmDetailModal';
import ResourceDetailModal from './modals/ResourceDetailModal';
import RouteTableSubnetsViewModal from './modals/RouteTableSubnetsViewModal';
import EipManageModal from './modals/EipManageModal';

const CloudDetailHw: React.FC<{ cloudId: string }> = ({ cloudId }) => {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const [cloud, setCloud] = useState<any | null>(null);
  const [vpcs, setVpcs] = useState<any[]>([]);
  const [subnets, setSubnets] = useState<any[]>([]);
  const [ecs, setEcs] = useState<any[]>([]);
  const [secGroups, setSecGroups] = useState<any[]>([]);
  const [eips, setEips] = useState<any[]>([]);
  const [slbs, setSlbs] = useState<any[]>([]);
  const [natGateways, setNatGateways] = useState<any[]>([]);
  const [routeTables, setRouteTables] = useState<any[]>([]);
  const [rtSubnetsViewOpen, setRtSubnetsViewOpen] = useState<boolean>(false);
  const [rtSubnetsViewTarget, setRtSubnetsViewTarget] = useState<any | null>(null);
  const [disks, setDisks] = useState<any[]>([]);

  const [vmCes, setVmCes] = useState<any | null>(null);
  const [vmCesMetrics, setVmCesMetrics] = useState<string[]>(['cpu_usage_idle','cpu_usage_iowait','cpu_usage_user']);
  const [vmCesPeriod, setVmCesPeriod] = useState<number>(1);
  const [vmCesRange, setVmCesRange] = useState<number>(60*60*1000);
  const [vmDetailTabKey, setVmDetailTabKey] = useState<string>('network');
  const [vmMonitorError, setVmMonitorError] = useState<string>('');
  const [vmCesError, setVmCesError] = useState<string>('');
  const [lastCesAt, setLastCesAt] = useState<number>(0);
  const [vmCesFilter, setVmCesFilter] = useState<string>('average');
  const [vmCesAvailable, setVmCesAvailable] = useState<string[]>([]);

  const [snapshots, setSnapshots] = useState<any[]>([]);

  const [detailOpen, setDetailOpen] = useState<boolean>(false);
  const [detailData, setDetailData] = useState<any>(null);
  const [detailTitle, setDetailTitle] = useState<string>('详情');
  const [detailType, setDetailType] = useState<string>('');
  const [vmDetailOpen, setVmDetailOpen] = useState<boolean>(false);
  const [vmDetail, setVmDetail] = useState<any | null>(null);
  const [vmEnis, setVmEnis] = useState<any[]>([]);
  const [vmPorts, setVmPorts] = useState<any[]>([]);
  const [eipManageOpen, setEipManageOpen] = useState<boolean>(false);
  const [eipManagePortId, setEipManagePortId] = useState<string>('');
  const [eipManageBusy, setEipManageBusy] = useState<boolean>(false);
  const [eipManageSelId, setEipManageSelId] = useState<string>('');

  const [sgCreateOpen, setSgCreateOpen] = useState<boolean>(false);
  const [loading, setLoading] = useState(false);

  const refreshMonitor = useCallback(async () => {
    const iid = vmDetail?.id || vmDetail?.InstanceId; if (!iid) return;
    const now0 = Date.now();
    if (now0 - lastCesAt < 20000) return;
    setLastCesAt(now0);
    try {
      setVmMonitorError('');
      setVmCesError('');
      let avail: any = null;
      for (let i=0;i<2;i++){ try { avail = await fetchHuaweiCesAvailableMetrics(cloudId, String(iid)); break; } catch(e:any){ await new Promise(r=> setTimeout(r, 800)); if (i===1) break; } }
      const availList: string[] = (avail?.data?.metrics) || (avail?.metrics) || [];
      setVmCesAvailable(Array.isArray(availList) ? availList : []);
      const now = Date.now();
      const periodMs = Math.max(1, Number(vmCesPeriod || 1)) * 1000;
      const toAligned = Math.floor(now / periodMs) * periodMs;
      const fromAligned = Math.max(0, toAligned - Number(vmCesRange || (60*60*1000)));
      const base: any = { period: vmCesPeriod, filter: vmCesFilter, from: fromAligned, to: toAligned };
      const availSet = new Set<string>(['cpu_util', ...(Array.isArray(availList) ? availList : vmCesAvailable)]);
      setVmCesMetrics((prev)=> prev.filter((n)=> n==='cpu_util' || availSet.has(n)));
      const uniq = Array.from(new Set(['cpu_util', ...vmCesMetrics])).filter((n)=> n==='cpu_util' || availSet.has(n));
      const metrics = uniq.map((n)=> {
        const baseNs = (n==='cpu_util' || n==='mem_util') ? 'SYS.ECS' : 'AGT.ECS';
        return { namespace: baseNs, metric_name: n, dimensions: [{ name:'instance_id', value: String(iid) }] };
      });
      let m2: any = null;
      for (let i=0;i<2;i++){ try { m2 = await fetchHuaweiCesMetrics(cloudId, String(iid), { ...base, metrics }); break; } catch(e:any){ await new Promise(r=> setTimeout(r, 800)); if (i===1) throw e; } }
      setVmCes(m2?.data || m2 || null);
      message.success('监控已刷新');
    } catch(e: any) { const msg = e?.message || '刷新监控失败'; if (/ces/i.test(String(msg))) setVmCesError(msg); else setVmMonitorError(msg); message.error(msg); }
  }, [cloudId, vmDetail, lastCesAt, vmCesPeriod, vmCesRange, vmCesFilter, vmCesMetrics, vmCesAvailable]);

  const [sgRuleDrawerOpen, setSgRuleDrawerOpen] = useState<boolean>(false);
  const [sgRuleTarget, setSgRuleTarget] = useState<any | null>(null);
  const [sgRefsDrawerOpen, setSgRefsDrawerOpen] = useState<boolean>(false);
  const [sgRefsTarget, setSgRefsTarget] = useState<any | null>(null);

  const [rtCreateOpen, setRtCreateOpen] = useState(false);

  const [rtEditOpen, setRtEditOpen] = useState(false);
  const [vpcEditOpen, setVpcEditOpen] = useState(false);
  const [vpcEditTarget, setVpcEditTarget] = useState<any | null>(null);
  const [vpcCreateOpen, setVpcCreateOpen] = useState(false);
  const [subnetCreateOpen, setSubnetCreateOpen] = useState(false);
  const [subnetEditOpen, setSubnetEditOpen] = useState(false);
  const [subnetEditTarget, setSubnetEditTarget] = useState<any | null>(null);
  const [rtAssocOpen, setRtAssocOpen] = useState(false);
  const [routeDrawerOpen, setRouteDrawerOpen] = useState(false);
  const [rtEntryOpen, setRtEntryOpen] = useState(false);
  const [rtEntryEditOpen, setRtEntryEditOpen] = useState(false);
  const [rtEditTarget, setRtEditTarget] = useState<any | null>(null);
  const [rtAssocTarget, setRtAssocTarget] = useState<any | null>(null);
  const [rtEntryTarget, setRtEntryTarget] = useState<any | null>(null);
  const [rtEntryList, setRtEntryList] = useState<any[]>([]);

  const [rtEntryEditTarget, setRtEntryEditTarget] = useState<any | null>(null);

  const [vpcEditInitial, setVpcEditInitial] = useState<any>({});
  const extractHwRouteEntries = (json: any): any[] => {
    const d = (json && (json as any).data) ? (json as any).data : json;
    const arr = Array.isArray(d)
      ? d
      : Array.isArray((d || {}).routes)
      ? (d || {}).routes
      : Array.isArray((d || {}).route_entries)
      ? (d || {}).route_entries
      : Array.isArray((json || {}).routes)
      ? (json || {}).routes
      : Array.isArray((json || {}).route_entries)
      ? (json || {}).route_entries
      : [];
    return Array.isArray(arr) ? arr : [];
  };

  const loadRtEntriesWithFallback = async (rtId: string): Promise<any[]> => {
    try {
      const json = await fetchCloudProviderRouteEntries(cloudId, rtId);
      const list = extractHwRouteEntries(json);
      return Array.isArray(list) ? list : [];
    } catch (e:any) { message.error(e?.message || '加载路由条目失败'); return []; }
  };

  const loadAll = async () => {
    setLoading(true);
    try {
      const cloudsRes = await fetchClouds();
      const cloudList: any[] = Array.isArray(cloudsRes) ? cloudsRes : (Array.isArray(cloudsRes?.data) ? cloudsRes.data : []);
      setCloud((cloudList || []).find((c:any)=> String(c.id) === String(cloudId)) || null);

      const [vpcJson, ecsJson, subnetJson, sgJson, eipJson, slbJson, natJson, rtJson, diskJson, snapJson] = await Promise.all([
        fetchCloudProviderVpcs(cloudId),
        fetchCloudProviderEcs(cloudId),
        fetchCloudProviderSubnets(cloudId),
        fetchCloudProviderSecurityGroups(cloudId).catch(()=>null),
        fetchCloudProviderEips(cloudId).catch(()=>null),
        fetchCloudProviderLoadBalancers(cloudId).catch(()=>null),
        fetchCloudProviderNatGateways(cloudId).catch(()=>null),
        fetchCloudProviderRouteTables(cloudId).catch(()=>null),
        fetchCloudProviderDisks(cloudId).catch(()=>null),
        fetchCloudProviderSnapshots(cloudId).catch(()=>null),
      ]);

      const vpcList: any[] = (vpcJson?.data?.vpcs) || (vpcJson?.vpcs) || [];
      const subnetList: any[] = (subnetJson?.data?.subnets) || (subnetJson?.subnets) || [];
      const ecsList: any[] = (ecsJson?.data?.servers) || (ecsJson?.servers) || [];
      const sgList: any[] = (sgJson?.data?.security_groups) || (sgJson?.security_groups) || (sgJson?.data?.securityGroups) || (sgJson?.securityGroups) || [];
      const eipList: any[] = (eipJson?.data?.publicips) || (eipJson?.publicips) || (eipJson?.data?.publicIps) || (eipJson?.publicIps) || [];
      const slbList: any[] = (slbJson?.data?.loadbalancers) || (slbJson?.loadbalancers) || [];
      const natList: any[] = (natJson?.data?.nat_gateways) || (natJson?.nat_gateways) || [];
      const rtList: any[] = (rtJson?.data?.route_tables) || (rtJson?.route_tables) || (rtJson?.data?.routetables) || (rtJson?.routetables) || [];
      const diskList: any[] = (diskJson?.data?.volumes) || (diskJson?.volumes) || [];
      const snapList: any[] = (snapJson?.data?.snapshots) || (snapJson?.snapshots) || [];

      setVpcs(Array.isArray(vpcList) ? vpcList : []);
      setSubnets(Array.isArray(subnetList) ? subnetList : []);
      setEcs(Array.isArray(ecsList) ? ecsList : []);
      setSecGroups(Array.isArray(sgList) ? sgList : []);
      setEips(Array.isArray(eipList) ? eipList : []);
      setSlbs(Array.isArray(slbList) ? slbList : []);
      setNatGateways(Array.isArray(natList) ? natList : []);
      setRouteTables(Array.isArray(rtList) ? rtList : []);
      setDisks(Array.isArray(diskList) ? diskList : []);
      setSnapshots(Array.isArray(snapList) ? snapList : []);
      
    } catch (e: any) {
      message.error(e?.message || '查询华为云资源失败');
      setVpcs([]); setSubnets([]); setEcs([]); setSecGroups([]); setEips([]); setSlbs([]); setNatGateways([]); setRouteTables([]); setDisks([]); setSnapshots([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (cloudId) loadAll(); }, [cloudId]);

  const renderProtoPort = (r:any) => {
    const p = String(r?.protocol || '').toLowerCase();
    const min = r?.port_min;
    const max = r?.port_max;
    if (!p || p === 'all') return '全部';
    if (p === 'icmp') return 'ICMP: 全部';
    if (min != null && max != null && min === max) return `${p.toUpperCase()}: ${min}`;
    if (min != null || max != null) return `${p.toUpperCase()}: ${(min ?? '')}-${(max ?? '')}`;
    return p.toUpperCase();
  };

  const protoSorter = (a:any, b:any) => {
    const order = (p:string) => {
      const x = String(p || '').toLowerCase();
      if (x === 'all') return 0;
      if (x === 'icmp') return 1;
      if (x === 'tcp') return 2;
      if (x === 'udp') return 3;
      return 9;
    };
    const oa = order(a?.protocol);
    const ob = order(b?.protocol);
    if (oa !== ob) return oa - ob;
    const am = Number(a?.port_min ?? -1);
    const bm = Number(b?.port_min ?? -1);
    if (am !== bm) return am - bm;
    const ax = Number(a?.port_max ?? -1);
    const bx = Number(b?.port_max ?? -1);
    return ax - bx;
  };

  const diskColumns = useMemo(() => ([
    { title: '名称', dataIndex: 'name', key: 'name', render: (t:string)=> t || '-', sorter: (a:any,b:any)=> String(a?.name||'').localeCompare(String(b?.name||'')) },
    { title: 'ID', dataIndex: 'id', key: 'id', render: (t:string)=> t || '-', sorter: (a:any,b:any)=> String(a?.id||'').localeCompare(String(b?.id||'')) },
    { title: '容量/类型', key: 'size_type', render: (_:any, r:any): React.ReactNode => { const size=r?.size; const tp=r?.volume_type; const sTxt=(size!=null&&size!=='')? `${size}GB`:'-'; const tTxt=tp||'-'; return `${sTxt}（${tTxt}）`; }, sorter: (a:any,b:any)=> Number(a?.size||0)-Number(b?.size||0) },
    { title: '状态', dataIndex: 'status', key: 'status', render: (s:string)=> statusTag(s), sorter: (a:any,b:any)=> String(a?.status||'').localeCompare(String(b?.status||'')) },
    { title: '挂载实例/设备', key: 'attach', ellipsis: true, render: (_:any, r:any): React.ReactNode => { const atts: any[] = Array.isArray(r?.attachments)? r?.attachments : []; const list = atts.map((a:any)=> `${a?.server_id || a?.instance_id || '-'}（${a?.device || '-'}）`).filter(Boolean); return list.length? list.join('；') : '-'; } },
    { title: '可用区/加密', key: 'az_enc', render: (_:any, r:any): React.ReactNode => { const az=r?.availability_zone||r?.zone||r?.ZoneId||'-'; const enc = r?.encrypted===true ? '是' : r?.encrypted===false ? '否' : '-'; return `${az}；加密: ${enc}`; } },
    { title: '标签', key: 'tags', ellipsis: true, render: (_:any, r:any)=> { const tags=r?.tags; const pairs: string[]=[]; if (Array.isArray(tags)) { for (const t of tags){ const k=t?.key??t?.Key; const v=t?.value??t?.Value; if(k!=null&&v!=null) pairs.push(`${k}=${v}`);} } else if (tags && typeof tags==='object'){ for(const k of Object.keys(tags)){ const v=(tags as any)[k]; if(v!=null) pairs.push(`${k}=${v}`);} } return pairs.length? pairs.join('；'):'-'; } },
    { title: '操作', key: 'actions', render: (_: any, r: any) => {
      const items = [ { key: 'detail', label: '详情' } ];
      return (
        <Dropdown
          menu={{ items, onClick: async ({ key }) => {
            if (key === 'detail') { const name=r?.name||'-'; const id=r?.id||'-'; setDetailTitle(`云盘 ${name}（${id}）`); setDetailData(r); setDetailType('disk'); setDetailOpen(true); }
          } }}
        >
          <Button type="link" icon={<MoreOutlined />} />
        </Dropdown>
      );
    } },
  ]), []);

  const snapshotColumns = useMemo(() => ([
    { title: '名称', dataIndex: 'name', key: 'name', render: (t:string)=> t || '-', sorter: (a:any,b:any)=> String(a?.name||'').localeCompare(String(b?.name||'')) },
    { title: 'ID', dataIndex: 'id', key: 'id', render: (t:string)=> t || '-', sorter: (a:any,b:any)=> String(a?.id||'').localeCompare(String(b?.id||'')) },
    { title: '源磁盘', dataIndex: 'volume_id', key: 'src', render: (t:string)=> t || '-', sorter: (a:any,b:any)=> String(a?.volume_id||'').localeCompare(String(b?.volume_id||'')) },
    { title: '状态', dataIndex: 'status', key: 'status', render: (s:string)=> statusTag(s), sorter: (a:any,b:any)=> String(a?.status||'').localeCompare(String(b?.status||'')) },
    { title: '操作', key: 'actions', render: (_: any, r: any) => {
      const items = [ { key: 'detail', label: '详情' } ];
      return (
        <Dropdown
          menu={{ items, onClick: async ({ key }) => {
            if (key === 'detail') { const name=r?.name||'-'; const id=r?.id||'-'; setDetailTitle(`快照 ${name}（${id}）`); setDetailData(r); setDetailType('snapshot'); setDetailOpen(true); }
          } }}
        >
          <Button type="link" icon={<MoreOutlined />} />
        </Dropdown>
      );
    } },
  ]), []);

  return (
    <PageDetailContainer
      breadcrumbs={[
        { title: <HomeOutlined />, href: '/' },
        { title: '资源控制台' },
        { title: '资源池管理', href: '/admin/clouds' },
        { title: `华为云 ${cloud?.name || '-'}` }
      ]}
      icon={<CloudUploadOutlined />}
      title={`华为云 ${cloud?.name || '-'}`}
      titleLevel={3}
      onBack={() => navigate('/admin/clouds')}
      backTooltip="返回列表"
      moreMenuItems={[
        { key: 'refresh', label: '刷新' },
      ]}
      onMoreMenuClick={({ key }) => { if (key === 'refresh') loadAll(); }}
      asCard={false}
      subtitle="集中展示云资源池信息，提供多种资源类型的生命周期管理能力"
      overviewContent={(
        <Descriptions bordered size="small" column={4}>
          <Descriptions.Item label="资源名称">{cloud?.name || '-'}</Descriptions.Item>
          <Descriptions.Item label="资源供应商">{(cloud?.config?.provider === 'huaweicloud' ? '华为云' : (cloud?.config?.provider || cloud?.type || '-'))}</Descriptions.Item>
          <Descriptions.Item label="资源地域">{cloud?.region || '-'}</Descriptions.Item>
          <Descriptions.Item label="资源类型">{cloud?.type || '-'}</Descriptions.Item>
          <Descriptions.Item label="资源状态">
            {cloud?.status === 'online' ? <Tag color="green">在线</Tag> : cloud?.status === 'maintenance' ? <Tag color="orange">维护</Tag> : cloud?.status === 'offline' ? <Tag color="red">离线</Tag> : <Tag>未知</Tag>}
          </Descriptions.Item>
          <Descriptions.Item label="Endpoint">{cloud?.endpoint || '-'}</Descriptions.Item>
          <Descriptions.Item label="项目ID">{cloud?.config?.projectId || '-'}</Descriptions.Item>
          <Descriptions.Item label="资源ID">{cloud?.id || '-'}</Descriptions.Item>
          <Descriptions.Item label="创建时间">{cloud?.createdAt || '-'}</Descriptions.Item>
          <Descriptions.Item label="更新时间">{cloud?.updatedAt || '-'}</Descriptions.Item>
        </Descriptions>
      )}
      defaultActiveTabKey={(location.state as any)?.tabKey || 'overview'}
      tabs={[
        {
          key: 'overview',
          label: '资源总览',
          icon: <DashboardOutlined />,
          children: (
            <>
              <Row gutter={[16, 16]}>
                <Col xs={24} sm={12} md={6}>
                  <Card size="small" style={{ borderRadius: 8, border: '1px solid #f0f0f0' }}>
                    <Statistic title={<span style={{ display:'flex', alignItems:'center' }}><ClusterOutlined style={{ color:'#1677ff', marginRight:8 }} />VPC 数量</span>} value={vpcs.length} valueStyle={{ fontSize: 24, fontWeight: 700 }} />
                  </Card>
                </Col>
                <Col xs={24} sm={12} md={6}>
                  <Card size="small" style={{ borderRadius: 8, border: '1px solid #f0f0f0' }}>
                    <Statistic title={<span style={{ display:'flex', alignItems:'center' }}><CloudServerOutlined style={{ color:'#1677ff', marginRight:8 }} />ECS 实例数</span>} value={ecs.length} valueStyle={{ fontSize: 24, fontWeight: 700 }} />
                  </Card>
                </Col>
                <Col xs={24} sm={12} md={6}>
                  <Card size="small" style={{ borderRadius: 8, border: '1px solid #f0f0f0' }}>
                    <Statistic title={<span style={{ display:'flex', alignItems:'center' }}><NodeIndexOutlined style={{ color:'#1677ff', marginRight:8 }} />子网</span>} value={subnets.length} valueStyle={{ fontSize: 24, fontWeight: 700 }} />
                  </Card>
                </Col>
                <Col xs={24} sm={12} md={6}>
                  <Card size="small" style={{ borderRadius: 8, border: '1px solid #f0f0f0' }}>
                    <Statistic title={<span style={{ display:'flex', alignItems:'center' }}><SafetyCertificateOutlined style={{ color:'#1677ff', marginRight:8 }} />安全组</span>} value={secGroups.length} valueStyle={{ fontSize: 24, fontWeight: 700 }} />
                  </Card>
                </Col>
                <Col xs={24} sm={12} md={6}>
                  <Card size="small" style={{ borderRadius: 8, border: '1px solid #f0f0f0' }}>
                    <Statistic title={<span style={{ display:'flex', alignItems:'center' }}><GlobalOutlined style={{ color:'#1677ff', marginRight:8 }} />EIP</span>} value={eips.length} valueStyle={{ fontSize: 24, fontWeight: 700 }} />
                  </Card>
                </Col>
                <Col xs={24} sm={12} md={6}>
                  <Card size="small" style={{ borderRadius: 8, border: '1px solid #f0f0f0' }}>
                    <Statistic title={<span style={{ display:'flex', alignItems:'center' }}><DeploymentUnitOutlined style={{ color:'#1677ff', marginRight:8 }} />负载均衡</span>} value={slbs.length} valueStyle={{ fontSize: 24, fontWeight: 700 }} />
                  </Card>
                </Col>
                <Col xs={24} sm={12} md={6}>
                  <Card size="small" style={{ borderRadius: 8, border: '1px solid #f0f0f0' }}>
                    <Statistic title={<span style={{ display:'flex', alignItems:'center' }}><SwapOutlined style={{ color:'#1677ff', marginRight:8 }} />NAT 网关</span>} value={natGateways.length} valueStyle={{ fontSize: 24, fontWeight: 700 }} />
                  </Card>
                </Col>
                <Col xs={24} sm={12} md={6}>
                  <Card size="small" style={{ borderRadius: 8, border: '1px solid #f0f0f0' }}>
                    <Statistic title={<span style={{ display:'flex', alignItems:'center' }}><BranchesOutlined style={{ color:'#1677ff', marginRight:8 }} />路由表</span>} value={routeTables.length} valueStyle={{ fontSize: 24, fontWeight: 700 }} />
                  </Card>
                </Col>
                <Col xs={24} sm={12} md={6}>
                  <Card size="small" style={{ borderRadius: 8, border: '1px solid #f0f0f0' }}>
                    <Statistic title={<span style={{ display:'flex', alignItems:'center' }}><HddOutlined style={{ color:'#1677ff', marginRight:8 }} />云盘</span>} value={disks.length} valueStyle={{ fontSize: 24, fontWeight: 700 }} />
                  </Card>
                </Col>
                <Col xs={24} sm={12} md={6}>
                  <Card size="small" style={{ borderRadius: 8, border: '1px solid #f0f0f0' }}>
                    <Statistic title={<span style={{ display:'flex', alignItems:'center' }}><CameraOutlined style={{ color:'#1677ff', marginRight:8 }} />快照</span>} value={snapshots.length} valueStyle={{ fontSize: 24, fontWeight: 700 }} />
                  </Card>
                </Col>
              </Row>
            </>
          )
        },
        {
          key: 'ecs',
          label: EcsLabel,
          icon: EcsIcon,
          count: ecs.length,
          children: (
            <EcsSection
              cloudId={cloudId}
              ecs={ecs}
              onRefreshAll={loadAll}
              onOpenVmDetail={async (r:any) => {
                const iid = r?.id || r?.InstanceId; if (!iid) return;
                setVmDetail(r);
                setVmDetailOpen(true);
                try {
                  const jsonPorts: any = await fetchHuaweiPorts(cloudId, { deviceId: String(iid||'') });
                  const listPorts: any[] = jsonPorts?.data?.ports || jsonPorts?.ports || [];
                  setVmPorts(Array.isArray(listPorts) ? listPorts : []);
                } catch {}
              }}
            />
          )
        },
        {
          key: 'vpc',
          label: VpcLabel,
          icon: VpcIcon,
          count: vpcs.length,
          children: (
            <VpcSection
              cloudId={cloudId}
              vpcs={vpcs}
              onSetVpcs={(list)=> setVpcs(list)}
              onOpenDetail={(type, title, data)=> { setDetailTitle(title); setDetailType(type); setDetailData(data); setDetailOpen(true); }}
              onOpenCreate={()=> { setVpcCreateOpen(true); }}
            />
          )
        },
        {
          key: 'subnets',
          label: SubnetLabel,
          icon: SubnetIcon,
          count: subnets.length,
          children: (
            <SubnetSection
              cloudId={cloudId}
              subnets={subnets}
              vpcs={vpcs}
              onSetSubnets={(list)=> setSubnets(list)}
              onOpenDetail={(type, title, data)=> { setDetailTitle(title); setDetailType(type); setDetailData(data); setDetailOpen(true); }}
              onOpenCreate={()=> { setSubnetCreateOpen(true); }}
            />
          )
        },
        {
          key: 'securityGroups',
          label: SgLabel,
          icon: SgIcon,
          count: secGroups.length,
          children: (
            <SecurityGroupSection
              cloudId={cloudId}
              secGroups={secGroups}
              ecs={ecs}
              onSetSecGroups={(list)=> setSecGroups(list)}
              onOpenDetail={(type, title, data)=> { setDetailTitle(title); setDetailType(type); setDetailData(data); setDetailOpen(true); }}
              onOpenRuleDrawer={(sg)=> { setSgRuleTarget(sg); setSgRuleDrawerOpen(true); }}
              onOpenRefsDrawer={(sg)=> { setSgRefsTarget(sg); setSgRefsDrawerOpen(true); }}
            />
          )
        },
        {
          key: 'eips',
          label: EipLabel,
          icon: EipIcon,
          count: eips.length,
          children: (
            <EipSection
              cloudId={cloudId}
              eips={eips}
              onSetEips={(list)=> setEips(list)}
              onOpenDetail={(type, title, data)=> { setDetailTitle(title); setDetailType(type); setDetailData(data); setDetailOpen(true); }}
            />
          )
        },
        {
          key: 'loadBalancers',
          label: SlbLabel,
          icon: SlbIcon,
          count: slbs.length,
          children: (
            <LoadBalancerSection
              cloudId={cloudId}
              slbs={slbs}
              vpcs={vpcs}
              subnets={subnets}
              onSetSlbs={(list)=> setSlbs(list)}
              onOpenDetail={(type, title, data)=> { setDetailTitle(title); setDetailType(type); setDetailData(data); setDetailOpen(true); }}
            />
          )
        },
        {
          key: 'natGateways',
          label: NatLabel,
          icon: NatIcon,
          count: natGateways.length,
          children: (
            <NatGatewaySection
              cloudId={cloudId}
              natGateways={natGateways}
              eips={eips}
              vpcs={vpcs}
              subnets={subnets}
              onSetNatGateways={(list)=> setNatGateways(list)}
              onOpenDetail={(type, title, data)=> { setDetailTitle(title); setDetailType(type); setDetailData(data); setDetailOpen(true); }}
            />
          )
        },
        {
          key: 'routeTables',
          label: RtLabel,
          icon: RtIcon,
          count: routeTables.length,
          children: (
            <RouteTableSection
              cloudId={cloudId}
              routeTables={routeTables}
              vpcs={vpcs}
              subnets={subnets}
              onSetRouteTables={(list)=> setRouteTables(list)}
              onOpenDetail={(type, title, data)=> { setDetailTitle(title); setDetailType(type); setDetailData(data); setDetailOpen(true); }}
              onOpenCreate={()=> { setRtCreateOpen(true); }}
              onOpenAssoc={(rt)=> { setRtAssocTarget(rt); setRtAssocOpen(true); }}
              onManageRoutes={async (rt)=> { try { setRtEntryTarget(rt); setRouteDrawerOpen(true); const id0 = rt?.id || rt?.RouteTableId; if (!id0) return; const list = await loadRtEntriesWithFallback(id0); setRtEntryList(list); } catch(e:any){ message.error(e?.message || '加载路由条目失败'); } }}
              onOpenSubnetsView={(rt)=> { setRtSubnetsViewTarget(rt); setRtSubnetsViewOpen(true); }}
            />
          )
        },
        {
          key: 'disks',
          label: DiskLabel,
          icon: DiskIcon,
          count: disks.length,
          children: (
            <>
              <Table
                bordered
                tableLayout="auto"
                size="middle"
                className="vr-table vr-table--middle"
                rowKey={(r:any)=> r?.id || r?.VolumeId || r?.volume_id || ''}
                columns={diskColumns as ColumnsType<any>}
                dataSource={disks}
                pagination={{ pageSize: 10 }}
              />
              <Divider />
              <Table
                bordered
                tableLayout="auto"
                size="middle"
                className="vr-table vr-table--middle"
                rowKey={(r:any)=> r?.id || r?.SnapshotId || ''}
                columns={snapshotColumns as ColumnsType<any>}
                dataSource={snapshots}
                pagination={{ pageSize: 10 }}
              />
            </>
          )
        },
      ]}
    >

      <SecurityGroupRuleManageDrawer
        open={sgRuleDrawerOpen}
        cloudId={cloudId}
        secGroups={secGroups}
        target={sgRuleTarget}
        onClose={()=>{ setSgRuleDrawerOpen(false); setSgRuleTarget(null); }}
        onUpdated={(group)=>{ const gid = group?.id || group?.SecurityGroupId; setSgRuleTarget(group); setSecGroups((prev:any[])=> (prev||[]).map((g:any)=> { const id=g?.id || g?.SecurityGroupId; return String(id||'')===String(gid||'') ? group : g; })); }}
      />

      <SecurityGroupRefsModal
        open={sgRefsDrawerOpen}
        cloudId={cloudId}
        target={sgRefsTarget}
        ecs={ecs}
        onClose={()=>{ setSgRefsDrawerOpen(false); setSgRefsTarget(null); }}
        onSetEips={(list)=> setEips(list)}
        onRefreshAll={loadAll}
        onOpenVmDetail={async (r:any)=>{ const iid = r?.id || r?.InstanceId; setVmDetail(r); setVmDetailOpen(true); try { const jsonPorts: any = await fetchHuaweiPorts(cloudId, { deviceId: String(iid||'') }); const listPorts: any[] = jsonPorts?.data?.ports || jsonPorts?.ports || []; setVmPorts(Array.isArray(listPorts) ? listPorts : []); } catch {} }}
      />
      
      <ResourceDetailModal
        open={detailOpen}
        cloudId={cloudId}
        detailType={detailType}
        detailTitle={detailTitle}
        detailData={detailData}
        vpcs={vpcs}
        subnets={subnets}
        routeTables={routeTables}
        ecs={ecs}
        secGroups={secGroups}
        eips={eips}
        onCancel={()=>{ setDetailOpen(false); setDetailData(null); setDetailType(''); }}
        onOpenVmDetail={async (r:any)=>{ const iid = r?.id || r?.InstanceId; if (!iid) return; setVmDetail(r); setVmDetailOpen(true); try { const jsonPorts: any = await fetchHuaweiPorts(cloudId, { deviceId: String(iid||'') }); const listPorts: any[] = jsonPorts?.data?.ports || jsonPorts?.ports || []; setVmPorts(Array.isArray(listPorts) ? listPorts : []); } catch {} }}
      />
      <VmDetailModal
        open={vmDetailOpen}
        cloudId={cloudId}
        vmDetail={vmDetail}
        vpcs={vpcs}
        subnets={subnets}
        secGroups={secGroups}
        eips={eips}
        vmEnis={vmEnis}
        vmPorts={vmPorts}
        disks={disks}
        snapshots={snapshots}
        tabKey={vmDetailTabKey}
        onChangeTab={(k)=> setVmDetailTabKey(k)}
        onRefreshAll={loadAll}
        onCloseModal={()=>{ setVmDetailOpen(false); setVmDetail(null); setVmEnis([]); setVmPorts([]); }}
        onOpenEipManage={(portId)=>{ setEipManagePortId(String(portId||'')); setEipManageSelId(''); setEipManageOpen(true); }}
        onSetVmPorts={(list)=> setVmPorts(list)}
        onSetEips={(list)=> setEips(list)}
        onSetVmDetail={(vm)=> setVmDetail(vm)}
        onRefreshMonitor={refreshMonitor}
        vmCes={vmCes}
        vmCesAvailable={vmCesAvailable}
        vmMonitorError={vmMonitorError}
        vmCesError={vmCesError}
        vmCesRange={vmCesRange}
        vmCesPeriod={vmCesPeriod}
        vmCesFilter={vmCesFilter}
        vmCesMetrics={vmCesMetrics}
        setVmCesRange={(v)=> setVmCesRange(v)}
        setVmCesPeriod={(v)=> setVmCesPeriod(v)}
        setVmCesFilter={(v)=> setVmCesFilter(v)}
        setVmCesMetrics={(v)=> setVmCesMetrics(v)}
        onOpenDetail={(type, title, data)=>{ setDetailTitle(title); setDetailType(type); setDetailData(data); setDetailOpen(true); }}
      />
      
      <VpcCreateModal
        open={vpcCreateOpen}
        cloudId={cloudId}
        onClose={()=> setVpcCreateOpen(false)}
        onSuccess={(list)=> setVpcs(list)}
      />
      <SubnetCreateModal
        open={subnetCreateOpen}
        cloudId={cloudId}
        vpcs={vpcs}
        subnets={subnets}
        onClose={()=> setSubnetCreateOpen(false)}
        onSuccess={(list)=> setSubnets(list)}
      />

      <SubnetEditModal
        open={subnetEditOpen}
        cloudId={cloudId}
        target={subnetEditTarget}
        onClose={()=> setSubnetEditOpen(false)}
        onSuccess={(list)=> setSubnets(list)}
      />
      
      <VpcEditModal
        open={vpcEditOpen}
        cloudId={cloudId}
        target={vpcEditTarget}
        onClose={()=> setVpcEditOpen(false)}
        onSuccess={(list)=> setVpcs(list)}
      />

      <RouteTableCreateModal
        open={rtCreateOpen}
        cloudId={cloudId}
        vpcs={vpcs}
        onClose={()=> setRtCreateOpen(false)}
        onSuccess={(list)=> setRouteTables(list)}
      />

      <RouteTableEditModal
        open={rtEditOpen}
        cloudId={cloudId}
        target={rtEditTarget}
        onClose={()=> setRtEditOpen(false)}
        onSuccess={(list)=> setRouteTables(list)}
      />

      <RouteTableSubnetsViewModal
        open={rtSubnetsViewOpen}
        target={rtSubnetsViewTarget}
        subnets={subnets}
        onClose={()=>{ setRtSubnetsViewOpen(false); setRtSubnetsViewTarget(null); }}
      />

      <EipManageModal
        open={eipManageOpen}
        cloudId={cloudId}
        eips={eips}
        vmDetail={vmDetail}
        portId={String(eipManagePortId || '')}
        selId={eipManageSelId}
        busy={eipManageBusy}
        onClose={()=>{ setEipManageOpen(false); setEipManagePortId(''); setEipManageSelId(''); }}
        onSetSelId={(v)=> setEipManageSelId(v)}
        onSetBusy={(v)=> setEipManageBusy(v)}
        onSetEips={(list)=> setEips(list)}
        onSetVmPorts={(list)=> setVmPorts(list)}
      />

      <RouteTableAssociateModal
        open={rtAssocOpen}
        cloudId={cloudId}
        target={rtAssocTarget}
        subnets={subnets}
        onClose={()=> setRtAssocOpen(false)}
        onSuccess={(list)=> setRouteTables(list)}
      />

      <RouteEntryManageDrawer
        open={routeDrawerOpen}
        cloudId={cloudId}
        ecs={ecs}
        routeTableTarget={rtEntryTarget}
        entries={rtEntryList}
        onClose={()=> setRouteDrawerOpen(false)}
        onUpdated={(list)=> setRtEntryList(list)}
        onOpenCreate={()=> setRtEntryOpen(true)}
        onOpenEdit={(entry)=>{ setRtEntryEditTarget(entry); setRtEntryEditOpen(true); }}
      />

      <RouteEntryCreateDrawer
        open={rtEntryOpen}
        cloudId={cloudId}
        ecs={ecs}
        routeTableTarget={rtEntryTarget}
        onClose={()=> setRtEntryOpen(false)}
        onUpdated={(list)=> setRtEntryList(list)}
      />

      <RouteEntryEditDrawer
        open={rtEntryEditOpen}
        cloudId={cloudId}
        ecs={ecs}
        routeTableTarget={rtEntryTarget}
        editTarget={rtEntryEditTarget}
        onClose={()=> { setRtEntryEditOpen(false); setRtEntryEditTarget(null); }}
        onUpdated={(list)=> setRtEntryList(list)}
      />
    </PageDetailContainer>
  );
};

export default CloudDetailHw;
