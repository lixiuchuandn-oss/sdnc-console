import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, Table, Tag, Space, Button, Statistic, Row, Col, Alert, Divider, Tabs, Descriptions, Modal, Form, Input, Checkbox, Select, Popconfirm, Dropdown, Radio, InputNumber, App } from 'antd';
import { CloudOutlined, HomeOutlined, GlobalOutlined, ReloadOutlined, ArrowLeftOutlined, CloudUploadOutlined, CloudServerOutlined, ClusterOutlined, SafetyCertificateOutlined, HddOutlined, DeploymentUnitOutlined, SwapOutlined, BranchesOutlined, NodeIndexOutlined, CameraOutlined, UnorderedListOutlined, EditOutlined, CheckOutlined, CloseOutlined } from '@ant-design/icons';
import PageDetailContainer from '../../components/PageDetailContainer';
import { bc, build } from '../../components/Breadcrumbs';
import { normalizeVpcs } from '../../utils/cloudNormalize';
import CloudDetailHw from './Hw/CloudDetailHw';
import CloudDetailHarvester from './Harvester/CloudDetailHarvester';
import CloudDetailAliyun from './Aliyun/CloudDetailAliyun';
import CloudDetailCloudmap from './Cloudmap/CloudDetailCloudmap';
import { fetchClouds, fetchCloudProviderVpcs, fetchCloudProviderEcs, fetchCloudProviderVSwitches, fetchCloudProviderSecurityGroups, fetchCloudProviderEips, fetchCloudProviderLoadBalancers, fetchCloudProviderNatGateways, fetchCloudProviderRouteTables, fetchCloudProviderDisks, fetchCloudProviderSnapshots, fetchCloudProviderSubnets, fetchCloudProviderRouteEntries, createCloudProviderVpc, createCloudProviderVSwitch, fetchCloudProviderSubnetsByVpc, deleteCloudProviderVpc, updateCloudProviderVpc, deleteCloudProviderVSwitch, startCloudProviderEcs, stopCloudProviderEcs, rebootCloudProviderEcs, deleteCloudProviderEcs, fetchCloudProviderEnis, createCloudProviderEni, updateCloudProviderEni, deleteCloudProviderEni, fetchCloudProviderNetworkAcls, createCloudProviderNetworkAcl, updateCloudProviderNetworkAcl, deleteCloudProviderNetworkAcl, createCloudProviderSecurityGroup, updateCloudProviderSecurityGroup, deleteCloudProviderSecurityGroup, fetchHarvesterNads, fetchHarvesterVolumes, fetchHarvesterImages, fetchHarvesterNodes, fetchHarvesterSystemPods, fetchHarvesterVmDetail, fetchHarvesterHealth, fetchKubeOvnVpcs, fetchKubeOvnSubnets, fetchAliyunEcsVncUrl } from '../../services/api';

interface AliyunVpc {
  VpcId: string;
  VpcName?: string;
  Description?: string;
  CidrBlock?: string;
  Ipv6CidrBlock?: string;
  Status?: string;
  IsDefault?: boolean;
  CreationTime?: string;
  ResourceGroupId?: string;
  RegionId?: string;
}

interface CloudItem {
  id: string;
  name: string;
  region: string;
  type: string;
  config?: any;
  status?: string;
  endpoint?: string;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
}

const statusTag = (s?: string) => {
  const color = s === 'Available' ? 'green' : s === 'Pending' ? 'orange' : 'blue';
  return <Tag color={color}>{s || '-'}</Tag>;
};

const CloudDetail: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [cloud, setCloud] = useState<CloudItem | null>(null);
  const [vpcs, setVpcs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ecs, setEcs] = useState<any[]>([]);
  const [vswitches, setVSwitches] = useState<any[]>([]);
  const [secGroups, setSecGroups] = useState<any[]>([]);
  const [eips, setEips] = useState<any[]>([]);
  const [slbs, setSlbs] = useState<any[]>([]);
  const [natGateways, setNatGateways] = useState<any[]>([]);
  const [routeTables, setRouteTables] = useState<any[]>([]);
  const [routeEntriesMap, setRouteEntriesMap] = useState<Record<string, any[]>>({});
  const [enis, setEnis] = useState<any[]>([]);
  const [networkAcls, setNetworkAcls] = useState<any[]>([]);
  const [createVpcOpen, setCreateVpcOpen] = useState(false);
  const [createVpcForm] = Form.useForm();
  const [createVswOpen, setCreateVswOpen] = useState(false);
  const [createVswForm] = Form.useForm();
  const [editVpcOpen, setEditVpcOpen] = useState(false);
  const [editVpcForm] = Form.useForm();
  const [editingVpc, setEditingVpc] = useState<any | null>(null);
  const [createSgOpen, setCreateSgOpen] = useState(false);
  const [createSgForm] = Form.useForm();
  const [editSgOpen, setEditSgOpen] = useState(false);
  const [editSgForm] = Form.useForm();
  const [editingSg, setEditingSg] = useState<any | null>(null);
  const [createEniOpen, setCreateEniOpen] = useState(false);
  const [createEniForm] = Form.useForm();
  const [editEniOpen, setEditEniOpen] = useState(false);
  const [editEniForm] = Form.useForm();
  const [editingEni, setEditingEni] = useState<any | null>(null);
  const [remoteOpen, setRemoteOpen] = useState(false);
  const [rowEditingVpcNameId, setRowEditingVpcNameId] = useState<string | null>(null);
  const [rowEditingVpcNameValue, setRowEditingVpcNameValue] = useState<string>('');
  
  
  const [remoteType, setRemoteType] = useState<'ssh' | 'rdp'>('ssh');
  const [remoteTarget, setRemoteTarget] = useState<any | null>(null);
  const [remoteForm] = Form.useForm();
  const [createAclOpen, setCreateAclOpen] = useState(false);
  const [createAclForm] = Form.useForm();
  const [editAclOpen, setEditAclOpen] = useState(false);
  const [editAclForm] = Form.useForm();
  const [editingAcl, setEditingAcl] = useState<any | null>(null);
  const [subnetsByVpc, setSubnetsByVpc] = useState<Record<string, any[]>>({});
  const [disks, setDisks] = useState<any[]>([]);
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [harvesterNads, setHarvesterNads] = useState<any[]>([]);
  const [harvesterVolumes, setHarvesterVolumes] = useState<any[]>([]);
  const [harvesterImages, setHarvesterImages] = useState<any[]>([]);
  const [harvesterNodes, setHarvesterNodes] = useState<any[]>([]);
  const [harvesterSystemPods, setHarvesterSystemPods] = useState<any[]>([]);
  const [kubeOvnVpcs, setKubeOvnVpcs] = useState<any[]>([]);
  const [kubeOvnSubnets, setKubeOvnSubnets] = useState<any[]>([]);
  const [vmDetailOpen, setVmDetailOpen] = useState(false);
  const [vmDetail, setVmDetail] = useState<any | null>(null);
  const [caps, setCaps] = useState<any>({});
  const provider = useMemo(() => (cloud?.config?.provider || cloud?.type || '').toLowerCase().trim(), [cloud]);
  const providerName = useMemo(() => (
    (provider === 'aliyun' && '阿里云') ||
    (provider === 'huaweicloud' && '华为云') ||
    (provider === 'harvester' && 'Harvester') ||
    (provider === 'cloudmap' && 'Cloudmap') ||
    provider || '-'
  ), [provider]);

  const [harvesterHealthItems, setHarvesterHealthItems] = useState<any[]>([]);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthError, setHealthError] = useState<string | null>(null);

  const runHealthCheck = async () => {
    if (!id) return;
    setHealthLoading(true);
    setHealthError(null);
    try {
      const r:any = await fetchHarvesterHealth(id);
      const items = Array.isArray(r?.data?.items) ? r.data.items : [];
      setHarvesterHealthItems(items);
      if (!items.some((x:any)=>x.ok)) {
        message.error('Harvester 连接体检失败：所有关键路径不可用');
      } else if (items.some((x:any)=>x.key==='nodes' && !x.ok)) {
        message.warning('Harvester 凭据缺少 Kubernetes 节点读取权限（nodes）');
      } else {
        message.success('Harvester 连接体检完成');
      }
    } catch (e:any) {
      setHealthError(e?.message || String(e));
      message.error('Harvester 连接体检失败');
    } finally {
      setHealthLoading(false);
    }
  };

  const loadCloud = async () => {
    try {
      const all = await fetchClouds();
      const c = (all || []).find((x: any) => x.id === id);
      if (c) setCloud({ id: c.id, name: c.name, region: c.region, type: c.type, config: c.config, status: c.status, endpoint: c.endpoint, description: c.description, createdAt: c.createdAt, updatedAt: c.updatedAt });
    } catch (e) {
      // ignore
    }
  };

  const loadVpcs = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const json = await fetchCloudProviderVpcs(id);
      const provider = (cloud?.config?.provider || cloud?.type || '').toLowerCase();
      let rawList: any = [];
      if (provider.includes('tencent')) {
        rawList = (json as any)?.data?.VpcSet || [];
      } else if (provider.includes('huawei')) {
        rawList = (json as any)?.data?.vpcs || [];
      } else { // 默认按阿里云结构
        rawList = (json as any)?.data?.Vpcs?.Vpc || [];
      }
      const list: any[] = Array.isArray(rawList) ? rawList : [];
      setVpcs(normalizeVpcs(provider, list));
      if (json?.capabilities) setCaps((prev:any)=> ({ ...prev, ...json.capabilities }));
    } catch (e: any) {
      setError(e?.message || '查询失败');
    } finally {
      setLoading(false);
    }
  };

  const loadEcs = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const json = await fetchCloudProviderEcs(id);
      const provider = (cloud?.config?.provider || cloud?.type || '').toLowerCase();
      let rawList: any = [];
      if (provider.includes('tencent')) {
        rawList = (json as any)?.data?.InstanceSet || [];
      } else if (provider.includes('huawei')) {
        rawList = (json as any)?.data?.servers || [];
      } else if (provider === 'harvester') {
        rawList = Array.isArray((json as any)?.data) ? (json as any).data : ((json as any)?.data?.Instances?.Instance || (json as any)?.data?.items || (json as any)?.data?.data || []);
      } else {
        rawList = (json as any)?.data?.Instances?.Instance || [];
      }
      const list: any[] = Array.isArray(rawList) ? rawList : [];
      setEcs(list);
      if (json?.capabilities) setCaps((prev:any)=> ({ ...prev, ...json.capabilities }));
    } catch (e: any) {
      setError(e?.message || '查询失败');
    } finally {
      setLoading(false);
    }
  };

  const loadHarvesterNads = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const json = await fetchHarvesterNads(id);
      const list: any[] = Array.isArray((json as any)?.data?.items) ? (json as any)?.data?.items : [];
      setHarvesterNads(list);
    } catch (e: any) {
      setError(e?.message || '查询失败');
    } finally {
      setLoading(false);
    }
  };

  const loadHarvesterVolumes = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const json = await fetchHarvesterVolumes(id);
      const list: any[] = Array.isArray((json as any)?.data?.items) ? (json as any)?.data?.items : [];
      setHarvesterVolumes(list);
    } catch (e: any) {
      setError(e?.message || '查询失败');
    } finally {
      setLoading(false);
    }
  };

  const loadHarvesterImages = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const json = await fetchHarvesterImages(id);
      const list: any[] = Array.isArray((json as any)?.data?.items) ? (json as any)?.data?.items : [];
      setHarvesterImages(list);
    } catch (e: any) {
      setError(e?.message || '查询失败');
    } finally {
      setLoading(false);
    }
  };

  const loadHarvesterNodes = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const json = await fetchHarvesterNodes(id);
      const list: any[] = Array.isArray((json as any)?.data?.items) ? (json as any)?.data?.items : [];
      setHarvesterNodes(list);
      try { const vpcs:any = await fetchKubeOvnVpcs(id); setKubeOvnVpcs(Array.isArray(vpcs?.data?.items)?vpcs.data.items:[]); } catch {}
      try { const subs:any = await fetchKubeOvnSubnets(id); setKubeOvnSubnets(Array.isArray(subs?.data?.items)?subs.data.items:[]); } catch {}
    } catch (e: any) {
      setError(e?.message || '查询失败');
    } finally {
      setLoading(false);
    }
  };
  const loadHarvesterSystemPods = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const json = await fetchHarvesterSystemPods(id);
      const list: any[] = Array.isArray((json as any)?.data?.items) ? (json as any)?.data?.items : [];
      setHarvesterSystemPods(list);
    } catch (e: any) {
      setError(e?.message || '查询失败');
    } finally {
      setLoading(false);
    }
  };

  const loadVSwitches = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const json = await fetchCloudProviderVSwitches(id);
      const list: any[] = json?.data?.VSwitches?.VSwitch || [];
      setVSwitches(list);
      if (json?.capabilities) setCaps((prev:any)=> ({ ...prev, ...json.capabilities }));
    } catch (e: any) {
      setError(e?.message || '查询失败');
    } finally {
      setLoading(false);
    }
  };


  const loadSecurityGroups = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const json = await fetchCloudProviderSecurityGroups(id);
      const list: any[] = json?.data?.SecurityGroups?.SecurityGroup || [];
      setSecGroups(list);
      if (json?.capabilities) setCaps((prev:any)=> ({ ...prev, ...json.capabilities }));
    } catch (e: any) {
      setError(e?.message || '查询失败');
    } finally {
      setLoading(false);
    }
  };

  const loadEips = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const json = await fetchCloudProviderEips(id);
      const list: any[] = json?.data?.EipAddresses?.EipAddress || [];
      setEips(list);
      if (json?.capabilities) setCaps((prev:any)=> ({ ...prev, ...json.capabilities }));
    } catch (e: any) {
      setError(e?.message || '查询失败');
    } finally {
      setLoading(false);
    }
  };

  const loadSlbs = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const json = await fetchCloudProviderLoadBalancers(id);
      const list: any[] = json?.data?.LoadBalancers?.LoadBalancer || [];
      setSlbs(list);
      if (json?.capabilities) setCaps((prev:any)=> ({ ...prev, ...json.capabilities }));
    } catch (e: any) {
      setError(e?.message || '查询失败');
    } finally {
      setLoading(false);
    }
  };

  const loadNatGateways = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const json = await fetchCloudProviderNatGateways(id);
      const raw = json?.data?.NatGateways?.NatGateway || json?.data?.NatGateways || json?.data || [];
      const list: any[] = Array.isArray(raw) ? raw : [];
      setNatGateways(list);
      if (json?.capabilities) setCaps((prev:any)=> ({ ...prev, ...json.capabilities }));
    } catch (e: any) {
      setError(e?.message || '查询失败');
    } finally {
      setLoading(false);
    }
  };

  const loadEnis = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const json = await fetchCloudProviderEnis(id);
      const raw = json?.data?.NetworkInterfaces?.NetworkInterface || json?.data?.NetworkInterfaces || json?.data || [];
      const list: any[] = Array.isArray(raw) ? raw : [];
      setEnis(list);
      if (json?.capabilities) setCaps((prev:any)=> ({ ...prev, ...json.capabilities }));
    } catch (e: any) {
      setError(e?.message || '查询失败');
    } finally {
      setLoading(false);
    }
  };

  const resolveInstanceIp = (r: any): string | undefined => {
    const pubArr = r?.PublicIpAddress?.IpAddress;
    const pub = Array.isArray(pubArr) ? pubArr[0] : (typeof pubArr === 'string' ? pubArr : undefined);
    const eip = r?.EipAddress?.IpAddress || r?.EipAddress;
    const privArr = r?.VpcAttributes?.PrivateIpAddress?.IpAddress;
    const priv = Array.isArray(privArr) ? privArr[0] : (typeof privArr === 'string' ? privArr : undefined);
    return pub || eip || priv;
  };

  const openRemoteConnect = (r: any) => {
    setRemoteTarget(r);
    const host = resolveInstanceIp(r);
    const osName: string = r?.OSName || r?.OSType || '';
    const isWindows = /windows/i.test(osName);
    const defaultUser = isWindows ? 'Administrator' : 'root';
    setRemoteType(isWindows ? 'rdp' : 'ssh');
    remoteForm.setFieldsValue({
      user: defaultUser,
      host,
      port: isWindows ? 3389 : 22,
    });
    setRemoteOpen(true);
  };

  const loadNetworkAcls = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const json = await fetchCloudProviderNetworkAcls(id);
      const raw = json?.data?.NetworkAcls?.NetworkAcl || json?.data?.NetworkAcls || json?.data || [];
      const list: any[] = Array.isArray(raw) ? raw : [];
      setNetworkAcls(list);
      if (json?.capabilities) setCaps((prev:any)=> ({ ...prev, ...json.capabilities }));
    } catch (e: any) {
      setError(e?.message || '查询失败');
    } finally {
      setLoading(false);
    }
  };

  const loadRouteTables = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const json = await fetchCloudProviderRouteTables(id);
      const provider = (cloud?.config?.provider || cloud?.type || '').toLowerCase();
      let raw: any = [];
      if (provider.includes('huawei')) {
        raw = (json as any)?.data?.routetables || (json as any)?.data?.route_tables || [];
      } else {
        raw = json?.data?.RouteTables?.RouteTable || json?.data?.RouteTables || json?.data || [];
      }
      const list: any[] = Array.isArray(raw) ? raw : [];
      setRouteTables(list);
      if (json?.capabilities) setCaps((prev:any)=> ({ ...prev, ...json.capabilities }));
    } catch (e: any) {
      setError(e?.message || '查询失败');
    } finally {
      setLoading(false);
    }
  };

  const loadDisks = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const json = await fetchCloudProviderDisks(id);
      const raw = json?.data?.Disks?.Disk || json?.data?.Disks || json?.data || [];
      const list: any[] = Array.isArray(raw) ? raw : [];
      setDisks(list);
      if (json?.capabilities) setCaps((prev:any)=> ({ ...prev, ...json.capabilities }));
    } catch (e: any) {
      setError(e?.message || '查询失败');
    } finally {
      setLoading(false);
    }
  };

  const loadSnapshots = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const json = await fetchCloudProviderSnapshots(id);
      const raw = json?.data?.Snapshots?.Snapshot || json?.data?.Snapshots || json?.data || [];
      const list: any[] = Array.isArray(raw) ? raw : [];
      setSnapshots(list);
      if (json?.capabilities) setCaps((prev:any)=> ({ ...prev, ...json.capabilities }));
    } catch (e: any) {
      setError(e?.message || '查询失败');
    } finally {
      setLoading(false);
    }
  };

  // 统一子网加载：阿里云使用 vswitches，华为云/腾讯云为 subnets
  const loadSubnets = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const json = await fetchCloudProviderSubnets(id);
      const provider = (cloud?.config?.provider || cloud?.type || '').toLowerCase();
      let list: any[] = [];
      if (provider.includes('huawei')) {
        list = (json as any)?.data?.subnets || [];
      } else if (provider.includes('tencent')) {
        list = (json as any)?.data?.SubnetSet || [];
      } else {
        // 兼容阿里云（仍沿用 vswitches 接口）
        list = json?.data?.VSwitches?.VSwitch || [];
      }
      setVSwitches(Array.isArray(list) ? list : []);
      if (json?.capabilities) setCaps((prev:any)=> ({ ...prev, ...json.capabilities }));
    } catch (e: any) {
      setError(e?.message || '查询失败');
    } finally {
      setLoading(false);
    }
  };

  // 按 VPC 加载子网（展开行时触发）
  const loadSubnetsForVpc = async (vpcId: string) => {
    if (!id || !vpcId) return;
    try {
      const json = await fetchCloudProviderSubnetsByVpc(id, vpcId);
      const provider = (cloud?.config?.provider || cloud?.type || '').toLowerCase();
      let list: any[] = [];
      if (provider === 'huaweicloud') {
        list = (json as any)?.data?.subnets || [];
      } else if (provider === 'tencentcloud') {
        list = (json as any)?.data?.SubnetSet || [];
      } else {
        list = (json as any)?.data?.VSwitches?.VSwitch || [];
      }
      setSubnetsByVpc(prev => ({ ...prev, [vpcId]: Array.isArray(list) ? list : [] }));
      if (json?.capabilities) setCaps((prev:any)=> ({ ...prev, ...json.capabilities }));
    } catch (e) {
      // 忽略展开加载错误，以免影响主表体验
    }
  };

  // 展开时加载指定路由表的详细条目
  const loadRouteEntries = async (rt: any) => {
    if (!id) return;
    const rtId = rt?.RouteTableId || rt?.id;
    if (!rtId) return;
    try {
      const json = await fetchCloudProviderRouteEntries(id, rtId);
      const list: any[] = json?.data || [];
      setRouteEntriesMap(prev => ({ ...prev, [rtId]: list }));
    } catch (e) {
      // ignore load error but keep UX smooth
    }
  };

  // 首次进入，加载云信息
  useEffect(() => {
    loadCloud();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // 根据云厂商加载对应已支持的资源，避免华为云命中“仅支持阿里云”接口
  useEffect(() => {
    if (!id) return;
    const provider = (cloud?.config?.provider || '').toLowerCase();
    if (provider === 'huaweicloud') {
      loadVpcs();
      loadEcs();
      loadSubnets();
      loadRouteTables();
      loadSnapshots();
    } else if (provider === 'aliyun') {
      loadVpcs();
      loadEcs();
      loadVSwitches();
      loadSecurityGroups();
      loadEips();
      loadSlbs();
      loadNatGateways();
      loadRouteTables();
      loadDisks();
      loadSnapshots();
      loadEnis();
      loadNetworkAcls();
    } else if (provider === 'harvester') {
      loadEcs();
      loadHarvesterNads();
      loadHarvesterVolumes();
      loadHarvesterImages();
      loadHarvesterNodes();
      loadHarvesterSystemPods();
    } else {
      loadVpcs();
      loadEcs();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, cloud?.config?.provider]);

  const columns = useMemo(() => [
    { title: '名称', dataIndex: 'name', key: 'name', width: 320, render: (t: string, record: any) => {
      const canInlineEdit = provider === 'aliyun';
      const isEditing = rowEditingVpcNameId && String(rowEditingVpcNameId) === String(record?.id);
      if (isEditing) {
        return (
          <Space size={4} style={{ whiteSpace: 'nowrap' }}>
            <Input size="small" value={rowEditingVpcNameValue} onChange={(e)=> setRowEditingVpcNameValue(e.target.value)} style={{ width: 140 }} />
            <Button type="link" size="small" style={{ padding: 0 }} icon={<CheckOutlined />} onClick={async ()=>{
              const newName = String(rowEditingVpcNameValue || '').trim();
              if (!newName) { message.warning('请输入名称'); return; }
              try {
                await updateCloudProviderVpc(id!, record.id, { VpcName: newName } as any);
                setRowEditingVpcNameId(null);
                setRowEditingVpcNameValue('');
                await loadVpcs();
                message.success('已更新');
              } catch (e:any) { message.error(e?.message || '更新失败'); }
            }} />
            <Button type="link" size="small" style={{ padding: 0 }} icon={<CloseOutlined />} onClick={()=> { setRowEditingVpcNameId(null); setRowEditingVpcNameValue(''); }} />
          </Space>
        );
      }
      return (
        <span style={{ whiteSpace: 'nowrap' }}>
          {t || '-'}
          <Button type="link" size="small" style={{ padding: 0, marginLeft: 4 }} icon={<EditOutlined />} disabled={!canInlineEdit} onClick={()=>{
            setRowEditingVpcNameId(String(record?.id||''));
            const initial = record?.name || record?.raw?.VpcName || record?.VpcName || '';
            setRowEditingVpcNameValue(String(initial || ''));
          }} />
        </span>
      );
    } },
    { title: 'ID', dataIndex: 'id', key: 'id' },
                  { title: 'IPv4 CIDR', dataIndex: 'cidr', key: 'cidr', render: (t: string) => t || '-' },
    { title: 'IPv6 CIDR', dataIndex: 'ipv6Cidr', key: 'cidr6', render: (t: string) => t || '-' },
    { title: '状态', dataIndex: 'status', key: 'status', render: (s: string) => statusTag(s) },
    { title: '默认', dataIndex: 'isDefault', key: 'default', render: (v: boolean) => (v ? <Tag color="blue">是</Tag> : <Tag>否</Tag>) },
    { title: '创建时间', dataIndex: 'createdAt', key: 'ctime' },
    { title: '资源组/企业项目', dataIndex: 'resourceGroupId', key: 'rg', render: (t: string) => t || '-' },
    {
      title: '操作',
      key: 'actions',
      render: (_: any, record: any) => {
        const disabled = provider !== 'aliyun';
        const items = [
          { key: 'edit', label: '编辑', disabled },
          { key: 'delete', label: '删除', danger: true, disabled },
        ];
        return (
          <Dropdown
            menu={{ items, onClick: async ({ key }) => {
              if (key === 'edit') {
                setEditingVpc(record);
                editVpcForm.setFieldsValue({ name: record?.name, desc: record?.description ?? record?.raw?.Description ?? record?.raw?.description });
                setEditVpcOpen(true);
              }
              if (key === 'delete') {
                Modal.confirm({
                  title: '确认删除该 VPC？',
                  content: '删除后不可恢复，且需确保没有子网/资源依赖。',
                  okText: '删除', okType: 'danger', cancelText: '取消',
                  onOk: async () => {
                    try {
                      await deleteCloudProviderVpc(id!, record.id);
                      message.success('删除成功');
                      await loadVpcs();
                    } catch (e: any) {
                      message.error(e?.message || '删除失败');
                    }
                  }
                });
              }
            } }}
            trigger={["click"]}
          >
            <Button type="link" icon={<UnorderedListOutlined />} />
          </Dropdown>
        );
      }
    }
  ], [provider, rowEditingVpcNameId, rowEditingVpcNameValue]);

  useEffect(() => {
    if (editVpcOpen && editingVpc) {
      editVpcForm.setFieldsValue({ name: editingVpc?.name, desc: editingVpc?.description ?? editingVpc?.raw?.Description ?? editingVpc?.raw?.description });
    }
  }, [editVpcOpen, editingVpc]);
  const tablePagination = useMemo(() => ({
    showSizeChanger: true,
    showQuickJumper: true,
    showTotal: (t: number) => `共 ${t} 条记录`,
    pageSize: 10,
    pageSizeOptions: [10, 20, 50, 100],
  }), []);

  if (provider.includes('huawei') && id) {
    return (<CloudDetailHw cloudId={id} />);
  }
  if (provider.includes('aliyun') && id) {
    return (<CloudDetailAliyun cloudId={id} />);
  }
  if ((provider === 'cloudmap' || provider.startsWith('cloudmap')) && id) {
    return (<CloudDetailCloudmap cloudId={id} />);
  }
  if ((provider === 'harvester') && id) {
    return (<CloudDetailHarvester cloudId={id} defaultProvider={provider} />);
  }
  // 避免闪屏：在 provider 未解析前不渲染回退页面
  if (!cloud || !provider) {
    return null;
  }
  // 已解析但不受支持的供应商时，显示轻量提示
  if (id) {
    return (
      <PageDetailContainer
        icon={<CloudUploadOutlined style={{ fontSize: 24, color: '#1890ff' }} />}
        title={`${providerName} ${cloud?.name || '-'}`}
        titleLevel={3}
        onBack={() => navigate('/admin/clouds')}
        backTooltip="返回列表"
        moreMenuItems={[
          { key: 'refresh', label: '刷新' },
        ]}
        onMoreMenuClick={({ key }) => { /* 保留刷新入口以便后续扩展 */ }}
        asCard={false}
      >
        <Alert
          type="info"
          message="该供应商暂未提供专属详情视图"
          description="请返回列表或稍后再试"
          style={{ marginBottom: 16 }}
          showIcon
        />
      </PageDetailContainer>
    );
  }
  return (
    <PageDetailContainer
      icon={<CloudUploadOutlined style={{ fontSize: 24, color: '#1890ff' }} />}
      title={`${providerName} ${cloud?.name || '-'}`}
      titleLevel={3}
      
      onBack={() => navigate('/admin/clouds')}
      backTooltip="返回列表"
      moreMenuItems={[
        { key: 'refresh', label: '刷新' },
      ]}
      onMoreMenuClick={({ key }) => { if (key === 'refresh') loadVpcs(); }}
      asCard={false}
    >
      {error && (
        <Alert
          type="error"
          message="查询失败"
          description={error.includes('403') ? '权限不足，只有超级管理员可以查看资源详情' : error}
          style={{ marginBottom: 16 }}
          showIcon
        />
      )}
      {/* 紧凑资源信息摘要（移除外层卡片背景，仅保留分割线） */}
      <div style={{ marginBottom: 16 }}>
        <Descriptions bordered size="small" column={4}>
          <Descriptions.Item label="资源名称">{cloud?.name || '-'}</Descriptions.Item>
          <Descriptions.Item label="资源供应商">{(cloud?.config?.provider === 'aliyun' && '阿里云') || (cloud?.config?.provider === 'huaweicloud' && '华为云') || (cloud?.config?.provider === 'tencentcloud' && '腾讯云') || (cloud?.config?.provider === 'harvester' && 'Harvester') || (cloud?.config?.provider || '-')}</Descriptions.Item>
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
      </div>


      <Card styles={{ body: { paddingBottom: 16 } }}>
        <Tabs
          defaultActiveKey="overview"
          items={[
            {
              key: 'overview',
              label: '资源总览',
              children: (
                <>
                  {provider !== 'harvester' && (
                  <Row gutter={[16, 16]}>
                    <Col xs={24} sm={12} md={6}>
                      <Card size="small" style={{ borderRadius: 8, border: '1px solid #f0f0f0' }}>
                        <Statistic
                          title={<span style={{ display:'flex', alignItems:'center' }}><ClusterOutlined style={{ color:'#1677ff', marginRight:8 }} />VPC 数量</span>}
                          value={vpcs.length}
                          valueStyle={{ fontSize: 24, fontWeight: 700 }}
                        />
                      </Card>
                    </Col>
                    <Col xs={24} sm={12} md={6}>
                      <Card size="small" style={{ borderRadius: 8, border: '1px solid #f0f0f0' }}>
                        <Statistic
                          title={<span style={{ display:'flex', alignItems:'center' }}><CloudServerOutlined style={{ color:'#1677ff', marginRight:8 }} />ECS 实例数</span>}
                          value={ecs.length}
                          valueStyle={{ fontSize: 24, fontWeight: 700 }}
                        />
                      </Card>
                    </Col>
                    <Col xs={24} sm={12} md={6}>
                      <Card size="small" style={{ borderRadius: 8, border: '1px solid #f0f0f0' }}>
                        <Statistic
                          title={<span style={{ display:'flex', alignItems:'center' }}><NodeIndexOutlined style={{ color:'#1677ff', marginRight:8 }} />子网(VSwitch)</span>}
                          value={vswitches.length}
                          valueStyle={{ fontSize: 24, fontWeight: 700 }}
                        />
                      </Card>
                    </Col>
                    <Col xs={24} sm={12} md={6}>
                      <Card size="small" style={{ borderRadius: 8, border: '1px solid #f0f0f0' }}>
                        <Statistic
                          title={<span style={{ display:'flex', alignItems:'center' }}><SafetyCertificateOutlined style={{ color:'#1677ff', marginRight:8 }} />安全组</span>}
                          value={secGroups.length}
                          valueStyle={{ fontSize: 24, fontWeight: 700 }}
                        />
                      </Card>
                    </Col>
                    <Col xs={24} sm={12} md={6}>
                      <Card size="small" style={{ borderRadius: 8, border: '1px solid #f0f0f0' }}>
                        <Statistic
                          title={<span style={{ display:'flex', alignItems:'center' }}><GlobalOutlined style={{ color:'#1677ff', marginRight:8 }} />弹性公网IP</span>}
                          value={eips.length}
                          valueStyle={{ fontSize: 24, fontWeight: 700 }}
                        />
                      </Card>
                    </Col>
                    <Col xs={24} sm={12} md={6}>
                      <Card size="small" style={{ borderRadius: 8, border: '1px solid #f0f0f0' }}>
                        <Statistic
                          title={<span style={{ display:'flex', alignItems:'center' }}><DeploymentUnitOutlined style={{ color:'#1677ff', marginRight:8 }} />负载均衡</span>}
                          value={slbs.length}
                          valueStyle={{ fontSize: 24, fontWeight: 700 }}
                        />
                      </Card>
                    </Col>
                    <Col xs={24} sm={12} md={6}>
                      <Card size="small" style={{ borderRadius: 8, border: '1px solid #f0f0f0' }}>
                        <Statistic
                          title={<span style={{ display:'flex', alignItems:'center' }}><SwapOutlined style={{ color:'#1677ff', marginRight:8 }} />NAT 网关</span>}
                          value={natGateways.length}
                          valueStyle={{ fontSize: 24, fontWeight: 700 }}
                        />
                      </Card>
                    </Col>
                    <Col xs={24} sm={12} md={6}>
                      <Card size="small" style={{ borderRadius: 8, border: '1px solid #f0f0f0' }}>
                        <Statistic
                          title={<span style={{ display:'flex', alignItems:'center' }}><BranchesOutlined style={{ color:'#1677ff', marginRight:8 }} />路由表</span>}
                          value={routeTables.length}
                          valueStyle={{ fontSize: 24, fontWeight: 700 }}
                        />
                      </Card>
                    </Col>
                    <Col xs={24} sm={12} md={6}>
                      <Card size="small" style={{ borderRadius: 8, border: '1px solid #f0f0f0' }}>
                        <Statistic
                          title={<span style={{ display:'flex', alignItems:'center' }}><HddOutlined style={{ color:'#1677ff', marginRight:8 }} />云盘</span>}
                          value={disks.length}
                          valueStyle={{ fontSize: 24, fontWeight: 700 }}
                        />
                      </Card>
                    </Col>
                    <Col xs={24} sm={12} md={6}>
                      <Card size="small" style={{ borderRadius: 8, border: '1px solid #f0f0f0' }}>
                        <Statistic
                          title={<span style={{ display:'flex', alignItems:'center' }}><CameraOutlined style={{ color:'#1677ff', marginRight:8 }} />快照</span>}
                          value={snapshots.length}
                          valueStyle={{ fontSize: 24, fontWeight: 700 }}
                        />
                      </Card>
                    </Col>
                  </Row>
                  )}
                  {provider === 'harvester' && (
                    <>
                      <Row gutter={[16, 16]} style={{ marginTop: 12 }}>
                        <Col xs={24} sm={12} md={6}>
                          <Card size="small" style={{ borderRadius: 8, border: '1px solid #f0f0f0' }}>
                            <Statistic title={<span style={{ display:'flex', alignItems:'center' }}><CloudServerOutlined style={{ color:'#1677ff', marginRight:8 }} />云主机（VM）</span>} value={ecs.length} valueStyle={{ fontSize: 24, fontWeight: 700 }} />
                          </Card>
                        </Col>
                        <Col xs={24} sm={12} md={6}>
                          <Card size="small" style={{ borderRadius: 8, border: '1px solid #f0f0f0' }}>
                            <Statistic title={<span style={{ display:'flex', alignItems:'center' }}><GlobalOutlined style={{ color:'#1677ff', marginRight:8 }} />NAD 网络</span>} value={harvesterNads.length} valueStyle={{ fontSize: 24, fontWeight: 700 }} />
                          </Card>
                        </Col>
                        <Col xs={24} sm={12} md={6}>
                          <Card size="small" style={{ borderRadius: 8, border: '1px solid #f0f0f0' }}>
                            <Statistic title={<span style={{ display:'flex', alignItems:'center' }}><CameraOutlined style={{ color:'#1677ff', marginRight:8 }} />镜像</span>} value={harvesterImages.length} valueStyle={{ fontSize: 24, fontWeight: 700 }} />
                          </Card>
                        </Col>
                        <Col xs={24} sm={12} md={6}>
                          <Card size="small" style={{ borderRadius: 8, border: '1px solid #f0f0f0' }}>
                            <Statistic title={<span style={{ display:'flex', alignItems:'center' }}><HddOutlined style={{ color:'#1677ff', marginRight:8 }} />卷</span>} value={harvesterVolumes.length} valueStyle={{ fontSize: 24, fontWeight: 700 }} />
                          </Card>
                        </Col>
                      </Row>
                      <Row gutter={[16, 16]} style={{ marginTop: 12 }}>
                        <Col xs={24} sm={12} md={6}>
                          <Card size="small" style={{ borderRadius: 8, border: '1px solid #f0f0f0' }}>
                            <Statistic title={<span style={{ display:'flex', alignItems:'center' }}><NodeIndexOutlined style={{ color:'#1677ff', marginRight:8 }} />节点</span>} value={harvesterNodes.length} valueStyle={{ fontSize: 24, fontWeight: 700 }} />
                          </Card>
                        </Col>
                        <Col xs={24} sm={12} md={6}>
                          <Card size="small" style={{ borderRadius: 8, border: '1px solid #f0f0f0' }}>
                            <Statistic title={<span style={{ display:'flex', alignItems:'center' }}><ClusterOutlined style={{ color:'#1677ff', marginRight:8 }} />VPC（Kube-OVN）</span>} value={kubeOvnVpcs.length} valueStyle={{ fontSize: 24, fontWeight: 700 }} />
                          </Card>
                        </Col>
                        <Col xs={24} sm={12} md={6}>
                          <Card size="small" style={{ borderRadius: 8, border: '1px solid #f0f0f0' }}>
                            <Statistic title={<span style={{ display:'flex', alignItems:'center' }}><NodeIndexOutlined style={{ color:'#1677ff', marginRight:8 }} />子网（Kube-OVN）</span>} value={kubeOvnSubnets.length} valueStyle={{ fontSize: 24, fontWeight: 700 }} />
                          </Card>
                        </Col>
                      </Row>
                    </>
                  )}
                  </>
                )
              },
            ...(provider === 'harvester' ? [] : [{
              key: 'vpc',
              label: 'VPC 列表',
              children: (
                <>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom: 12 }}>
                    <Space>
                      {/* 预留其他筛选与操作 */}
                    </Space>
                    <Space>
                      <Button type="primary" onClick={() => setCreateVpcOpen(true)} disabled={!caps?.supportsVpc}>
                        创建 VPC{!caps?.supportsVpc ? '（当前云不支持）' : ''}
                      </Button>
                      <Button onClick={() => setCreateVswOpen(true)} disabled={!caps?.supportsSubnets}>
                        创建子网 / VSwitch{!caps?.supportsSubnets ? '（当前云不支持）' : ''}
                      </Button>
                      <Button icon={<ReloadOutlined />} onClick={loadVpcs}>刷新</Button>
                    </Space>
                  </div>
                  <Table
                    bordered
                    size="middle"
                    className="vr-table vr-table--middle"
                    rowKey="id"
                    columns={columns as any}
                    dataSource={vpcs}
                    loading={loading}
                    expandable={{
                      expandedRowRender: (record: any) => {
                        const list = subnetsByVpc[record.id];
                        return (
                          <Table
                            size="middle"
                            bordered={false}
                            className="vr-table vr-table--middle"
                            rowKey={(r:any)=> r.VSwitchId || r.id || r.SubnetId}
                          columns={[
                            { title: '子网名称', dataIndex: 'VSwitchName', key: 'name', render:(t:any, r:any)=> t || r.Name || r.SubnetName || '-' },
                            { title: '子网ID', dataIndex: 'VSwitchId', key: 'id', render:(t:any, r:any)=> t || r.Id || r.SubnetId || '-' },
                            { title: 'IPv4 CIDR', dataIndex: 'CidrBlock', key: 'cidr', render:(t:any, r:any)=> t || r.Cidr || '-' },
                            { title: '可用区', dataIndex: 'ZoneId', key: 'zone', render:(t:any, r:any)=> t || r.Zone || '-' },
                            { title: '状态', dataIndex: 'Status', key: 'status', render:(s:any)=> statusTag(s || '-') },
                            { title: '操作', key: 'actions', render: (_: any, r: any) => (
                              <Space>
                                <Popconfirm
                                  title="确认删除该子网？"
                                  description="删除后不可恢复，需确保没有挂载的资源（ECS/SLB/NAT/EIP等）。"
                                  onConfirm={async () => {
                                    try {
                                      const vswId = r?.VSwitchId || r?.Id || r?.SubnetId;
                                      if (!vswId) {
                                        message.error('缺少子网标识');
                                        return;
                                      }
                                      if (provider !== 'aliyun') {
                                        message.warning('当前仅支持阿里云子网删除');
                                        return;
                                      }
                                      await deleteCloudProviderVSwitch(id!, vswId);
                                      message.success('子网删除成功');
                                      // 删除后刷新该 VPC 的子网列表
                                      await loadSubnetsForVpc(record.id);
                                    } catch (e: any) {
                                      message.error(e?.message || '删除失败');
                                    }
                                  }}
                                >
                                  <Button size="small" danger disabled={!caps?.supportsSubnets}>删除</Button>
                                </Popconfirm>
                              </Space>
                            ) },
                          ] as any}
                            dataSource={Array.isArray(list) ? list : []}
                            pagination={false}
                          />
                        );
                      },
                      onExpand: (expanded: boolean, record: any) => {
                        if (expanded && !subnetsByVpc[record.id]) {
                          loadSubnetsForVpc(record.id);
                        }
                      }
                    }}
                    pagination={tablePagination}
                  />

                  <Modal
                    title="创建 VPC（阿里云）"
                    open={createVpcOpen}
                    onCancel={() => { setCreateVpcOpen(false); createVpcForm.resetFields(); }}
                    onOk={async () => {
                      try {
                        const values = await createVpcForm.validateFields();
                        const payload = {
                          VpcName: values.name || undefined,
                          CidrBlock: values.cidr,
                          Description: values.desc || undefined,
                          EnableIpv6: !!values.enableIpv6,
                          Ipv6CidrBlock: values.ipv6Cidr || undefined,
                        } as any;
                        const resp = await createCloudProviderVpc(id!, payload);
                        message.success('创建成功');
                        setCreateVpcOpen(false);
                        createVpcForm.resetFields();
                        // 刷新列表
                        await loadVpcs();
                      } catch (err: any) {
                        message.error(err?.message || '创建失败');
                      }
                    }}
                    destroyOnHidden
                    okText="创建"
                  >
                    <Form form={createVpcForm} layout="vertical">
                      <Form.Item name="name" label="名称">
                        <Input placeholder="例如：prod-vpc" />
                      </Form.Item>
                      <Form.Item name="cidr" label="IPv4 CIDR" rules={[{ required: true, message: '请输入IPv4 CIDR，如 10.0.0.0/16' }]}>
                        <Input placeholder="例如：10.0.0.0/16" />
                      </Form.Item>
                      <Form.Item name="desc" label="描述">
                        <Input placeholder="可选：用途或备注" />
                      </Form.Item>
                      <Form.Item name="enableIpv6" valuePropName="checked">
                        <Checkbox>启用 IPv6（可选）</Checkbox>
                      </Form.Item>
                      <Form.Item name="ipv6Cidr" label="IPv6 CIDR（可选）">
                        <Input placeholder="例如：2408:4000::/48" />
                      </Form.Item>
                    </Form>
                  </Modal>
                  <Modal
                    title="编辑 VPC（阿里云）"
                    open={editVpcOpen}
                    onCancel={() => { setEditVpcOpen(false); setEditingVpc(null); editVpcForm.resetFields(); }}
                    onOk={async () => {
                      try {
                        const values = await editVpcForm.validateFields();
                        if (!editingVpc?.id) {
                          message.error('缺少 VPC 标识');
                          return;
                        }
                        await updateCloudProviderVpc(id!, editingVpc.id, {
                          VpcName: values.name || undefined,
                          Description: values.desc || undefined,
                        } as any);
                        message.success('更新成功');
                        setEditVpcOpen(false);
                        setEditingVpc(null);
                        editVpcForm.resetFields();
                        await loadVpcs();
                      } catch (e: any) {
                        message.error(e?.message || '更新失败');
                      }
                    }}
                    destroyOnHidden
                    okText="保存"
                  >
                    <Form form={editVpcForm} layout="vertical">
                      <Form.Item name="name" label="名称">
                        <Input placeholder="例如：prod-vpc" />
                      </Form.Item>
                      <Form.Item name="desc" label="描述">
                        <Input placeholder="可选：用途或备注" />
                      </Form.Item>
                    </Form>
                  </Modal>

                  <Modal
                    title="创建子网 / VSwitch（阿里云）"
                    open={createVswOpen}
                    onCancel={() => { setCreateVswOpen(false); createVswForm.resetFields(); }}
                    onOk={async () => {
                      try {
                        const values = await createVswForm.validateFields();
                        const payload = {
                          VpcId: values.vpcId,
                          ZoneId: values.zoneId,
                          CidrBlock: values.cidr,
                          VSwitchName: values.name || undefined,
                          Description: values.desc || undefined,
                        } as any;
                        const resp = await createCloudProviderVSwitch(id!, payload);
                        message.success('创建成功');
                        setCreateVswOpen(false);
                        createVswForm.resetFields();
                        await loadVSwitches();
                      } catch (err: any) {
                        message.error(err?.message || '创建失败');
                      }
                    }}
                    destroyOnHidden
                    okText="创建"
                  >
                    <Form form={createVswForm} layout="vertical">
                      <Form.Item name="vpcId" label="所属 VPC" rules={[{ required: true, message: '请选择或填写 VPC' }]}>
                        <Select
                          placeholder="选择 VPC"
                          showSearch
                          optionFilterProp="label"
                          options={(vpcs || []).map((v: any) => {
                            const vid = v.VpcId || v.id || v.vpcId;
                            const name = v.VpcName || v.name || vid;
                            return { value: vid, label: `${name} (${vid})` };
                          })}
                        />
                      </Form.Item>
                      <Form.Item name="zoneId" label="可用区" rules={[{ required: true, message: '请输入可用区，例如：cn-shanghai-e' }]}>
                        <Input placeholder="例如：cn-shanghai-e" />
                      </Form.Item>
                      <Form.Item name="cidr" label="IPv4 CIDR" rules={[{ required: true, message: '请输入IPv4 CIDR，如 10.0.1.0/24' }]}>
                        <Input placeholder="例如：10.0.1.0/24" />
                      </Form.Item>
                      <Form.Item name="name" label="名称">
                        <Input placeholder="例如：prod-subnet-a" />
                      </Form.Item>
                      <Form.Item name="desc" label="描述">
                        <Input placeholder="可选：用途或备注" />
                      </Form.Item>
                    </Form>
                  </Modal>
                </>
              )
            }]),
            {
              key: 'ecs',
              label: '云主机',
              children: (
                <>
                  <Table
                    bordered
                    rowKey={(r:any)=> r.InstanceId || r.id || Math.random().toString(36).slice(2)}
                    columns={[
                      { title: '实例', key: 'inst', ellipsis: true, render: (_: any, r: any) => (
                        <span>{r?.InstanceName || r?.name || '-'}<br />{r?.InstanceId || r?.id || '-'}</span>
                      ) },
                      ...(provider === 'harvester' ? [{ title: '实例ID', dataIndex: 'InstanceId', key: 'id' }] : []),
                      ...(provider === 'harvester' ? [
                        { title: '命名空间', key: 'ns', render: (_: any, r: any) => {
                          const s = String(r?.InstanceId || '');
                          return s.includes('/') ? s.split('/')[0] : '-';
                        } },
                        { title: '所属主机', key: 'node', render: (_: any, r: any) => (r?.Extra?.NodeName || '-') },
                        { title: '网络', key: 'networks', ellipsis: true, render: (_: any, r: any) => {
                          const vpc = r?.VpcId || '';
                          const subnet = r?.Extra?.SubnetName || '';
                          const nads = Array.isArray(r?.Extra?.Networks) ? r?.Extra?.Networks : [];
                          const items: string[] = [];
                          if (vpc) items.push(subnet ? `${vpc}/${subnet}` : vpc);
                          const nadNames = nads.map((n: any) => {
                            const s = String(n || '');
                            return s.includes('/') ? s.split('/').pop() : s;
                          }).filter((s: string) => !!s);
                          items.push(...nadNames);
                          return items.length ? items.join(' | ') : '-';
                        } },
                        { title: 'vCPU 分配', key: 'cpu', render: (_: any, r: any) => (r?.Extra?.CPU ?? '-') },
                        { title: '内存分配', key: 'mem', render: (_: any, r: any) => (r?.Extra?.Memory || '-') },
                        { title: '镜像', key: 'image', ellipsis: true, render: (_: any, r: any) => (r?.Extra?.Image || '-') },
                        { title: '已使用 CPU（%）', key: 'cpuUsed', render: (_: any, r: any) => (typeof r?.Extra?.CpuUsagePct === 'number') ? `${r.Extra.CpuUsagePct}%` : '-' },
                        { title: '已使用内存', key: 'memUsed', render: (_: any, r: any) => (r?.Extra?.MemUsage || '-') },
                      ] : []),
                      { title: '状态', key: 'status', render: (_: any, r: any) => statusTag(r?.Status || r?.status) },
                      ...(provider === 'harvester' ? [] : [
                        { title: '实例规格', key: 'spec', ellipsis: true, render: (_: any, r: any) => {
                          const os = r?.OSName || r?.OSType || r?.Platform || r?.os || r?.image?.name || r?.image?.id || r?.metadata?.image_name || r?.metadata?.image_id || '-';
                          const it = r?.InstanceType || r?.flavor?.original_name || r?.flavor?.name || r?.flavor?.id || r?.instanceType || '-';
                          return (<span>{os}<br />{it}</span>);
                        } }
                      ]),
                      ...(provider === 'harvester' ? [] : [
                        { title: 'IP地址', key: 'ips', ellipsis: true, render: (_: any, r: any) => {
                          const isHuawei = String(provider || '').includes('huawei');
                          let pub = '-';
                          let pri = '-';
                          if (isHuawei) {
                            const addrsRaw = r?.addresses;
                            const nets: any[] = Array.isArray(addrsRaw) ? addrsRaw : Object.values(addrsRaw || {}).reduce((acc: any[], v: any) => acc.concat(Array.isArray(v) ? v : [v]), []);
                            const items: any[] = Array.isArray(nets) ? nets : [];
                            const floats = items.filter((a:any)=> String((a && (a['OS-EXT-IPS:type'] || a.type)) || '').toLowerCase() === 'floating').map((a:any)=> a?.addr || a?.ipAddress || a?.ip).filter(Boolean);
                            const fixeds = items.filter((a:any)=> String((a && (a['OS-EXT-IPS:type'] || a.type)) || '').toLowerCase() === 'fixed').map((a:any)=> a?.addr || a?.ipAddress || a?.ip).filter(Boolean);
                            pub = (floats.length ? floats.join(', ') : (r?.accessIPv4 || r?.publicIpAddress || r?.publicip || '-')) || '-';
                            pri = (fixeds.length ? fixeds.join(', ') : (r?.accessIPv4 || r?.privateIpAddress || r?.privateip || '-')) || '-';
                          } else {
                            const pubArr = r?.PublicIpAddress?.IpAddress;
                            const eip = r?.EipAddress?.IpAddress || r?.publicIpAddress;
                            pub = Array.isArray(pubArr) && pubArr.length > 0 ? pubArr.join(', ') : (eip || '-');
                            const priArr = r?.VpcAttributes?.PrivateIpAddress?.IpAddress;
                            pri = Array.isArray(priArr) && priArr.length > 0 ? priArr.join(', ') : (r?.privateIpAddress || '-');
                          }
                          const bw = r?.InternetMaxBandwidthOut;
                          const pubLine = (!isHuawei && bw) ? `${pub || '-'} / ${bw}Mbps` : (pub || '-');
                          return (<span>{`公网IP：${pubLine}`}<br />{`内网IP：${pri || '-'}`}</span>);
                        } }
                      ]),
                      ...(provider === 'harvester' ? [] : [
                        { title: 'VPC/子网网段', key: 'vpc_cidr', ellipsis: true, render: (_: any, r: any) => {
                          const isHuawei = String(provider || '').includes('huawei');
                          if (isHuawei) {
                            const names = r?.addresses && !Array.isArray(r.addresses) ? Object.keys(r.addresses) : [];
                            const firstNet = Array.isArray(names) && names.length ? names[0] : '';
                            const subnetMatch = (vswitches || []).find((s:any)=> (String(s?.name || s?.SubnetName || '').toLowerCase()) === String(firstNet || '').toLowerCase());
                            const vpcMatch = (vpcs || []).find((v:any)=> (String(v?.id || v?.VpcId || '').toLowerCase()) === String(subnetMatch?.vpc_id || subnetMatch?.VpcId || '').toLowerCase());
                            const vpcName = vpcMatch?.name || vpcMatch?.VpcName || '-';
                            const subnetName = subnetMatch?.name || subnetMatch?.SubnetName || firstNet || '-';
                            const subnetCidr = subnetMatch?.cidr || subnetMatch?.CidrBlock || '';
                            return (
                              <span>{`VPC：${vpcName || '-'}`}<br />{`子网：${subnetName}${subnetCidr ? ` (${subnetCidr})` : ''}`}</span>
                            );
                          }
                          const vpcId = r?.VpcId;
                          const vswId = r?.VSwitchId;
                          const vpcMatch = (vpcs || []).find((v:any)=> (v?.id === vpcId) || (v?.VpcId === vpcId));
                          const vpcName = vpcMatch?.name || vpcMatch?.VpcName || vpcId || '-';
                          const vpcCidr = vpcMatch?.cidr || vpcMatch?.CidrBlock || '';
                          const vswMatch = (vswitches || []).find((s:any)=> (s?.VSwitchId === vswId) || (s?.id === vswId));
                          const vswCidr = vswMatch?.CidrBlock || vswMatch?.cidr || '';
                          const vpcLine = `${vpcName || '-'}` + (vpcCidr ? ` (${vpcCidr})` : '');
                          const vswLine = `${vswId || '-'}` + (vswCidr ? ` (${vswCidr})` : '');
                          return (<span>{`VPC：${vpcLine}`}<br />{`子网：${vswLine}`}</span>);
                        } }
                      ]),
                      ...(provider === 'harvester' ? [] : [
                        { title: '安全组', key: 'sgs', ellipsis: true, render: (_: any, r: any) => {
                          const isHuawei = String(provider || '').includes('huawei');
                          if (isHuawei) {
                            const groups = r?.security_groups || r?.securityGroups;
                            const names = Array.isArray(groups) ? groups.map((g:any)=> g?.name || g?.id).filter(Boolean) : [];
                            return names.length ? names.join(', ') : '-';
                          }
                          const ids = r?.SecurityGroupIds?.SecurityGroupId || r?.securityGroupIds;
                          return Array.isArray(ids) && ids.length ? ids.join(', ') : '-';
                        } }
                      ]),
                      { title: '创建时间', key: 'ctime_charge', ellipsis: true, render: (_: any, r: any) => {
                        const ct = r?.CreationTime || r?.created || r?.created_at || r?.createdAt || '-';
                        const charge = r?.InstanceChargeType || r?.chargeType;
                        const line2 = charge ? `计费模式：${charge}` : '计费模式：-';
                        return (<span>{ct}<br />{line2}</span>);
                      } },
                      { title: '操作', key: 'actions', render: (_: any, r: any) => {
                        const disabled = false;
                        const iid = r?.InstanceId || r?.id;
                        const items = [
                          { key: 'connect', label: '远程连接' },
                          { key: 'webssh', label: 'WebSSH（浏览器）' },
                          { key: 'webvnc', label: 'WebVNC（浏览器）' },
                          { key: 'detail', label: '详情' },
                          { key: 'start', label: '启动' },
                          { key: 'stop', label: '停止' },
                          { key: 'reboot', label: '重启' },
                          { key: 'delete', label: '删除', danger: true },
                        ];
                        return (
                          <Dropdown
                            menu={{ items, onClick: async ({ key }) => {
                              if (key === 'connect') {
                                openRemoteConnect(r);
                                return;
                              }
                              if (key === 'webvnc') {
                                const isAliyun = String(provider || '').toLowerCase().includes('aliyun');
                                const isHuawei = String(provider || '').toLowerCase().includes('huawei');
                                const isHarvester = String(provider || '').toLowerCase().includes('harvester');
                                if ((isAliyun || isHuawei) && id && iid) {
                                  try {
                                    const json = await fetchAliyunEcsVncUrl(id!, iid);
                                    const url = json?.data?.VncUrl || json?.data?.vncUrl;
                                    if (url) {
                                      const w = Math.max(1280, (window.screen?.availWidth || 1600) - 40);
                                      const h = Math.max(800, (window.screen?.availHeight || 900) - 80);
                                      const features = `width=${w},height=${h},top=0,left=0,menubar=no,toolbar=no,location=no,status=no,scrollbars=yes,resizable=yes`;
                                      if (isAliyun) {
                                        const osRaw = String(r?.OSName || r?.OSType || r?.Platform || '').toLowerCase();
                                        const isWindows = osRaw.includes('win');
                                        const page = 'https://g.alicdn.com/aliyun/ecs-console-vnc2/0.0.8/index.html';
                                        const web = `${page}?vncUrl=${encodeURIComponent(url)}&instanceId=${encodeURIComponent(iid)}&isWindows=${isWindows ? 'true' : 'false'}`;
                                        window.open(web, 'webvnc', features);
                                      } else {
                                        window.open(url, 'webvnc', features);
                                      }
                                    } else {
                                      message.warning('未获取到VNC地址');
                                    }
                                  } catch (e: any) {
                                    message.error(e?.message || '获取VNC地址失败');
                                  }
                                  return;
                                }
                                if (isHarvester && id && iid) {
                                  const s = String(iid || '');
                                  const ns = s.includes('/') ? s.split('/')[0] : '';
                                  const nm = s.includes('/') ? s.split('/')[1] : s;
                                  const w = Math.max(1280, (window.screen?.availWidth || 1600) - 40);
                                  const h = Math.max(800, (window.screen?.availHeight || 900) - 80);
                                  const features = `width=${w},height=${h},top=0,left=0,menubar=no,toolbar=no,location=no,status=no,scrollbars=yes,resizable=yes`;
                                  const url = `/admin/clouds/${encodeURIComponent(id!)}/harvester/vnc?cloudId=${encodeURIComponent(id!)}&namespace=${encodeURIComponent(ns)}&name=${encodeURIComponent(nm)}`;
                                  window.open(url, 'harvester-vnc', features);
                                  return;
                                }
                                message.warning('WebVNC 已移除');
                                return;
                              }
                              if (key === 'webssh') {
                                const pubArr = r?.PublicIpAddress?.IpAddress;
                                const pub = Array.isArray(pubArr) && pubArr.length > 0 ? pubArr[0] : (r?.EipAddress?.IpAddress || r?.publicIpAddress || (Array.isArray(r?.PublicIpAddress?.IpAddress) ? r?.PublicIpAddress?.IpAddress[0] : null));
                                const priArr = r?.VpcAttributes?.PrivateIpAddress?.IpAddress;
                                const pri = Array.isArray(priArr) && priArr.length > 0 ? priArr[0] : r?.privateIpAddress;
                                const host = pub || pri || '';
                                const user = 'root';
                                navigate(`/admin/clouds/${id}/webssh?host=${encodeURIComponent(host)}&user=${encodeURIComponent(user)}&port=22`);
                                return;
                              }
                              if (key === 'detail') {
                                try {
                                  if (provider === 'harvester') {
                                    const s = String(iid || '');
                                    const ns = s.includes('/') ? s.split('/')[0] : '';
                                    const nm = s.includes('/') ? s.split('/')[1] : s;
                                    const json = await fetchHarvesterVmDetail(id!, ns, nm);
                                    setVmDetail(json?.data || null);
                                    setVmDetailOpen(true);
                                  }
                                } catch (e:any) {
                                  message.error(e?.message || '加载详情失败');
                                }
                                return;
                              }
                              if (!id || !iid) return;
                              try {
                                if (key === 'start') {
                                  await startCloudProviderEcs(id!, iid);
                                  message.success('启动指令已下发');
                                  await loadEcs();
                                } else if (key === 'stop') {
                                  await stopCloudProviderEcs(id!, iid, true);
                                  message.success('停止指令已下发');
                                  await loadEcs();
                                } else if (key === 'reboot') {
                                  await rebootCloudProviderEcs(id!, iid, true);
                                  message.success('重启指令已下发');
                                  await loadEcs();
                                } else if (key === 'delete') {
                                  Modal.confirm({
                                    title: '确认删除该云主机？',
                                    content: '删除后不可恢复，请确保已停止实例且无重要数据。',
                                    okText: '删除', okType: 'danger', cancelText: '取消',
                                    onOk: async () => {
                                      try {
                                        await deleteCloudProviderEcs(id!, iid);
                                        message.success('删除指令已下发');
                                        await loadEcs();
                                      } catch (e:any) {
                                        message.error(e?.message || '删除失败');
                                      }
                                    }
                                  });
                                }
                              } catch(e:any){
                                message.error(e?.message || '操作失败');
                              }
                            } }}
                            trigger={["click"]}
                          >
                            <Button type="link" icon={<UnorderedListOutlined />} />
                          </Dropdown>
                        );
                      } },
                    ] as any}
                    dataSource={ecs}
                    loading={loading}
                    pagination={tablePagination}
                  />

                  <Modal
                    title="远程连接"
                    open={remoteOpen}
                    onCancel={() => { setRemoteOpen(false); setRemoteTarget(null); remoteForm.resetFields(); }}
                    onOk={async () => {
                      try {
                        const values = await remoteForm.validateFields();
                        const host = values.host;
                        const user = values.user || (remoteType === 'ssh' ? 'root' : 'Administrator');
                        const port = values.port || (remoteType === 'ssh' ? 22 : 3389);
                        if (remoteType === 'ssh') {
                          const cmd = `ssh ${user}@${host} -p ${port}`;
                          await navigator.clipboard.writeText(cmd);
                          message.success('SSH 命令已复制到剪贴板');
                        } else {
                          const content = [
                            `full address:s:${host}:${port}`,
                            user ? `username:s:${user}` : '',
                          ].filter(Boolean).join('\n');
                          const blob = new Blob([content], { type: 'application/x-rdp' });
                          const a = document.createElement('a');
                          a.href = URL.createObjectURL(blob);
                          const iid = remoteTarget?.InstanceId || 'ecs';
                          a.download = `connect-${iid}.rdp`;
                          document.body.appendChild(a);
                          a.click();
                          document.body.removeChild(a);
                          message.success('RDP 文件已下载');
                        }
                        setRemoteOpen(false);
                        setRemoteTarget(null);
                        remoteForm.resetFields();
                      } catch (e:any) {
                        message.error(e?.message || '操作失败，请检查参数');
                      }
                    }}
                    okText={remoteType === 'ssh' ? '复制 SSH 命令' : '下载 RDP 文件'}
                    destroyOnHidden
                  >
                    <Alert type="info" message={remoteType === 'ssh' ? '本功能将复制 SSH 命令，请在本地终端执行。若无公网IP，请通过堡垒机或为实例绑定EIP。' : '本功能将生成并下载 RDP 文件，在本地使用远程桌面连接打开。'} style={{ marginBottom: 12 }} />
                    <Form form={remoteForm} layout="vertical">
                      <Form.Item label="连接方式" name="type">
                        <Radio.Group value={remoteType} onChange={(e)=>{
                          setRemoteType(e.target.value);
                          const port = e.target.value === 'ssh' ? 22 : 3389;
                          const v = remoteForm.getFieldValue('port');
                          if (!v) remoteForm.setFieldsValue({ port });
                        }}>
                          <Radio.Button value="ssh">SSH（Linux）</Radio.Button>
                          <Radio.Button value="rdp">RDP（Windows）</Radio.Button>
                        </Radio.Group>
                      </Form.Item>
                      <Form.Item name="host" label="主机地址" rules={[{ required: true, message: '请输入主机地址（建议公网IP）' }]}>
                        <Input placeholder="如：47.XX.XX.XX 或 主机名" />
                      </Form.Item>
                      <Form.Item name="user" label="用户名">
                        <Input placeholder={remoteType === 'ssh' ? '如：root' : '如：Administrator'} />
                      </Form.Item>
                      <Form.Item name="port" label="端口">
                        <InputNumber min={1} max={65535} placeholder={remoteType === 'ssh' ? '默认 22' : '默认 3389'} style={{ width: '100%' }} />
                      </Form.Item>
                    </Form>
                  </Modal>

                  <Modal
                    title="实例详情"
                    open={vmDetailOpen}
                    onCancel={() => { setVmDetailOpen(false); setVmDetail(null); }}
                    footer={null}
                    width={800}
                    destroyOnHidden
                  >
                    {provider === 'harvester' && vmDetail ? (
                      <Descriptions bordered column={1} size="small">
                        <Descriptions.Item label="名称">{vmDetail?.metadata?.name || '-'}</Descriptions.Item>
                        <Descriptions.Item label="命名空间">{vmDetail?.metadata?.namespace || '-'}</Descriptions.Item>
                        <Descriptions.Item label="节点">{vmDetail?.status?.nodeName || '-'}</Descriptions.Item>
                        <Descriptions.Item label="状态">{vmDetail?.status?.printableStatus || vmDetail?.status?.phase || '-'}</Descriptions.Item>
                        <Descriptions.Item label="CPU">{vmDetail?.spec?.template?.spec?.domain?.cpu?.cores ?? '-'}</Descriptions.Item>
                        <Descriptions.Item label="内存">{vmDetail?.spec?.template?.spec?.domain?.resources?.requests?.memory || vmDetail?.spec?.template?.spec?.domain?.memory?.guest || '-'}</Descriptions.Item>
                        <Descriptions.Item label="镜像">{(vmDetail?.spec?.template?.spec?.volumes || []).map((v:any)=> v?.containerDisk?.image).filter(Boolean).join(', ') || '-'}</Descriptions.Item>
                      </Descriptions>
                    ) : (
                      <Alert type="info" message="当前仅支持 Harvester 详情展示" />
                    )}
                  </Modal>

                  
                  
                </>
              )
            },
            ...(provider === 'harvester' ? [] : [{
              key: 'vsw',
              label: 'VSwitch 子网',
              children: (
                <>
                  <Table
                    bordered
                    rowKey={(r:any)=> r.VSwitchId || r.Id || r.SubnetId || r.id}
                    columns={[
                      { title: '子网名', key: 'name', render: (_:any, r:any) => r.VSwitchName || r.Name || r.SubnetName || r.name || r.SubnetId || '-' },
                      { title: '子网ID', key: 'id', render: (_:any, r:any) => r.VSwitchId || r.Id || r.SubnetId || r.id || '-' },
                      { title: '所属VPC', key: 'vpc', render: (_:any, r:any) => r.VpcId || r.vpc_id || r.vpcId || '-' },
                      { title: 'IPv4 CIDR', key: 'cidr', render: (_:any, r:any) => r.CidrBlock || r.Cidr || r.cidr || r.cidr_block || '-' },
                      { title: '可用区', key: 'zone', render: (_:any, r:any) => r.ZoneId || r.Zone || r.availability_zone || r.availabilityZone || '-' },
                      { title: '状态', key: 'status', render: (_:any, r:any) => statusTag(r.Status || r.status) },
                      { title: '创建时间', key: 'ctime', render: (_:any, r:any) => r.CreationTime || r.CreatedTime || r.created_at || r.createdAt || '-' },
                    ] as any}
                    dataSource={vswitches}
                    loading={loading}
                    pagination={tablePagination}
                  />
                </>
              )
            }]),
            ...(provider === 'harvester' ? [] : [{
              key: 'sg',
              label: '安全组',
              children: (
                <>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom: 12 }}>
                    <Space>
                      {/* 可按 VPC 过滤（预留） */}
                    </Space>
                    <Space>
                      <Button type="primary" onClick={() => setCreateSgOpen(true)} disabled={provider !== 'aliyun'}>
                        创建 安全组{provider !== 'aliyun' ? '（当前仅支持阿里云）' : ''}
                      </Button>
                      <Button icon={<ReloadOutlined />} onClick={loadSecurityGroups}>刷新</Button>
                    </Space>
                  </div>
                  <Table
                    bordered
                    rowKey={(r:any)=>r.SecurityGroupId}
                    columns={[
                      { title: '安全组名', dataIndex: 'SecurityGroupName', key: 'name' },
                      { title: '安全组ID', dataIndex: 'SecurityGroupId', key: 'id' },
                      { title: '描述', dataIndex: 'Description', key: 'desc' },
                      { title: '操作', key: 'actions', render: (_: any, r: any) => {
                        const items = [
                          { key: 'edit', label: '编辑', disabled: provider !== 'aliyun' },
                          { key: 'delete', label: '删除', danger: true, disabled: provider !== 'aliyun' },
                        ];
                        return (
                          <Dropdown
                            menu={{ items, onClick: async ({ key }) => {
                              if (key === 'edit') {
                                setEditingSg(r);
                                editSgForm.setFieldsValue({ name: r?.SecurityGroupName, desc: r?.Description });
                                setEditSgOpen(true);
                              }
                              if (key === 'delete') {
                                const sgId = r?.SecurityGroupId;
                                if (!sgId) return message.error('缺少安全组标识');
                                Modal.confirm({
                                  title: '确认删除该安全组？',
                                  content: '删除后不可恢复，请确保未被关键资源引用。',
                                  okText: '删除', okType: 'danger', cancelText: '取消',
                                  onOk: async () => {
                                    try {
                                      await deleteCloudProviderSecurityGroup(id!, sgId);
                                      message.success('删除成功');
                                      await loadSecurityGroups();
                                    } catch (e:any) {
                                      message.error(e?.message || '删除失败');
                                    }
                                  }
                                });
                              }
                            } }}
                            trigger={["click"]}
                          >
                            <Button type="link" icon={<UnorderedListOutlined />} />
                          </Dropdown>
                        );
                      } },
                    ] as any}
                    dataSource={secGroups}
                    loading={loading}
                    pagination={tablePagination}
                  />

                  <Modal
                    title="创建 安全组（阿里云）"
                    open={createSgOpen}
                    onCancel={() => { setCreateSgOpen(false); createSgForm.resetFields(); }}
                    onOk={async () => {
                      try {
                        const values = await createSgForm.validateFields();
                        const payload = { vpcId: values.vpcId, name: values.name, description: values.desc || undefined };
                        await createCloudProviderSecurityGroup(id!, payload as any);
                        message.success('创建成功');
                        setCreateSgOpen(false);
                        createSgForm.resetFields();
                        await loadSecurityGroups();
                      } catch (err:any) {
                        message.error(err?.message || '创建失败');
                      }
                    }}
                    destroyOnHidden
                    okText="创建"
                  >
                    <Form form={createSgForm} layout="vertical">
                      <Form.Item name="vpcId" label="所属 VPC" rules={[{ required: true, message: '请选择 VPC' }]}>
                        <Select
                          placeholder="选择 VPC"
                          showSearch
                          optionFilterProp="label"
                          options={(vpcs || []).map((v:any)=>{
                            const vid = v.VpcId || v.id || v.vpcId;
                            const name = v.VpcName || v.name || vid;
                            return { value: vid, label: `${name} (${vid})` };
                          })}
                        />
                      </Form.Item>
                      <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
                        <Input placeholder="例如：prod-sg-a" />
                      </Form.Item>
                      <Form.Item name="desc" label="描述">
                        <Input placeholder="可选：用途或备注" />
                      </Form.Item>
                    </Form>
                  </Modal>

                  <Modal
                    title="编辑 安全组（阿里云）"
                    open={editSgOpen}
                    onCancel={() => { setEditSgOpen(false); setEditingSg(null); editSgForm.resetFields(); }}
                    onOk={async () => {
                      try {
                        const values = await editSgForm.validateFields();
                        const sgId = editingSg?.SecurityGroupId;
                        if (!sgId) return message.error('缺少安全组标识');
                        await updateCloudProviderSecurityGroup(id!, sgId, { name: values.name || undefined, description: values.desc || undefined } as any);
                        message.success('更新成功');
                        setEditSgOpen(false);
                        setEditingSg(null);
                        editSgForm.resetFields();
                        await loadSecurityGroups();
                      } catch (e:any) {
                        message.error(e?.message || '更新失败');
                      }
                    }}
                    destroyOnHidden
                    okText="保存"
                  >
                    <Form form={editSgForm} layout="vertical">
                      <Form.Item name="name" label="名称">
                        <Input placeholder="例如：prod-sg-a" />
                      </Form.Item>
                      <Form.Item name="desc" label="描述">
                        <Input placeholder="可选：用途或备注" />
                      </Form.Item>
                    </Form>
                  </Modal>
                </>
              )
            }]),
            ...(provider === 'harvester' ? [] : [{
              key: 'eni',
              label: '弹性网卡 ENI',
              children: (
                <>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom: 12 }}>
                    <Space>
                      {/* 预留筛选：按子网或实例过滤 */}
                    </Space>
                    <Space>
                      <Button type="primary" onClick={() => setCreateEniOpen(true)} disabled={!caps?.supportsEni}>
                        创建 ENI{!caps?.supportsEni ? '（当前云不支持）' : ''}
                      </Button>
                      <Button icon={<ReloadOutlined />} onClick={loadEnis}>刷新</Button>
                    </Space>
                  </div>
                  <Table
                    bordered
                    rowKey={(r:any)=>r.NetworkInterfaceId}
                    columns={[
                      { title: '名称', dataIndex: 'NetworkInterfaceName', key: 'name' },
                      { title: 'ENI ID', dataIndex: 'NetworkInterfaceId', key: 'id' },
                      { title: '私网IP', dataIndex: 'PrimaryIpAddress', key: 'ip' },
                      { title: 'VPC', dataIndex: 'VpcId', key: 'vpc' },
                      { title: '子网', dataIndex: 'VSwitchId', key: 'vsw' },
                      { title: '绑定实例', dataIndex: 'InstanceId', key: 'ecs' },
                      { title: '状态', dataIndex: 'Status', key: 'status', render:(s:string)=>statusTag(s) },
                      { title: '创建时间', dataIndex: 'CreationTime', key: 'ctime' },
                      { title: '操作', key: 'actions', render: (_: any, r: any) => (
                        <Space>
                          <Button size="small" disabled={!caps?.supportsEni} onClick={() => {
                            setEditingEni(r);
                            editEniForm.setFieldsValue({ name: r?.NetworkInterfaceName, desc: r?.Description });
                            setEditEniOpen(true);
                          }}>编辑</Button>
                          <Popconfirm
                            title="确认删除该 ENI？"
                            description="删除后不可恢复，请确保没有重要挂载。"
                            onConfirm={async ()=>{
                              try {
                                const eniId = r?.NetworkInterfaceId;
                                if (!eniId) { message.error('缺少 ENI 标识'); return; }
                                await deleteCloudProviderEni(id!, eniId);
                                message.success('删除成功');
                                await loadEnis();
                              } catch(e:any){
                                message.error(e?.message || '删除失败');
                              }
                            }}
                          >
                            <Button size="small" danger disabled={!caps?.supportsEni}>删除</Button>
                          </Popconfirm>
                        </Space>
                      ) },
                    ] as any}
                    dataSource={enis}
                    loading={loading}
                    pagination={tablePagination}
                  />

                  <Modal
                    title="创建 ENI（阿里云）"
                    open={createEniOpen}
                    onCancel={() => { setCreateEniOpen(false); createEniForm.resetFields(); }}
                    onOk={async () => {
                      try {
                        const values = await createEniForm.validateFields();
                        const payload = {
                          vSwitchId: values.vSwitchId,
                          securityGroupId: values.securityGroupId,
                          name: values.name || undefined,
                          description: values.desc || undefined,
                          ipv4Address: values.ipv4 || undefined,
                        } as any;
                        await createCloudProviderEni(id!, payload);
                        message.success('创建成功');
                        setCreateEniOpen(false);
                        createEniForm.resetFields();
                        await loadEnis();
                      } catch (err: any) {
                        message.error(err?.message || '创建失败');
                      }
                    }}
                    destroyOnHidden
                    okText="创建"
                  >
                    <Form form={createEniForm} layout="vertical">
                      <Form.Item name="vSwitchId" label="所属子网 / VSwitch" rules={[{ required: true, message: '请选择子网' }]}>
                        <Select
                          placeholder="选择子网"
                          showSearch
                          optionFilterProp="label"
                          options={(vswitches || []).map((v: any) => {
                            const vid = v.VSwitchId || v.Id || v.SubnetId;
                            const name = v.VSwitchName || v.Name || v.SubnetName || vid;
                            return { value: vid, label: `${name} (${vid})` };
                          })}
                        />
                      </Form.Item>
                      <Form.Item name="securityGroupId" label="安全组" rules={[{ required: true, message: '请选择安全组' }]}>
                        <Select
                          placeholder="选择安全组"
                          showSearch
                          optionFilterProp="label"
                          options={(secGroups || []).map((g: any) => {
                            const gid = g.SecurityGroupId;
                            const name = g.SecurityGroupName || gid;
                            return { value: gid, label: `${name} (${gid})` };
                          })}
                        />
                      </Form.Item>
                      <Form.Item name="name" label="名称">
                        <Input placeholder="例如：prod-eni-a" />
                      </Form.Item>
                      <Form.Item name="desc" label="描述">
                        <Input placeholder="可选：用途或备注" />
                      </Form.Item>
                      <Form.Item name="ipv4" label="主私网IP（可选）">
                        <Input placeholder="例如：10.0.1.10" />
                      </Form.Item>
                    </Form>
                  </Modal>

                  <Modal
                    title="编辑 ENI（阿里云）"
                    open={editEniOpen}
                    onCancel={() => { setEditEniOpen(false); setEditingEni(null); editEniForm.resetFields(); }}
                    onOk={async () => {
                      try {
                        const values = await editEniForm.validateFields();
                        const eniId = editingEni?.NetworkInterfaceId;
                        if (!eniId) { message.error('缺少 ENI 标识'); return; }
                        await updateCloudProviderEni(id!, eniId, { name: values.name || undefined, description: values.desc || undefined } as any);
                        message.success('更新成功');
                        setEditEniOpen(false);
                        setEditingEni(null);
                        editEniForm.resetFields();
                        await loadEnis();
                      } catch (e: any) {
                        message.error(e?.message || '更新失败');
                      }
                    }}
                    destroyOnHidden
                    okText="保存"
                  >
                    <Form form={editEniForm} layout="vertical">
                      <Form.Item name="name" label="名称">
                        <Input placeholder="例如：prod-eni-a" />
                      </Form.Item>
                      <Form.Item name="desc" label="描述">
                        <Input placeholder="可选：用途或备注" />
                      </Form.Item>
                    </Form>
                  </Modal>
                </>
              )
            }]),
            ...(provider === 'harvester' ? [] : [{
              key: 'acl',
              label: '网络 ACL',
              children: (
                <>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom: 12 }}>
                    <Space>
                      {/* 预留筛选：按 VPC 过滤 */}
                    </Space>
                    <Space>
                      <Button type="primary" onClick={() => setCreateAclOpen(true)} disabled={provider !== 'aliyun'}>
                        创建 ACL{provider !== 'aliyun' ? '（当前仅支持阿里云）' : ''}
                      </Button>
                      <Button icon={<ReloadOutlined />} onClick={loadNetworkAcls}>刷新</Button>
                    </Space>
                  </div>
                  <Table
                    bordered
                    rowKey={(r:any)=>r.NetworkAclId}
                    columns={[
                      { title: '名称', dataIndex: 'NetworkAclName', key: 'name' },
                      { title: 'ACL ID', dataIndex: 'NetworkAclId', key: 'id' },
                      { title: '所属VPC', dataIndex: 'VpcId', key: 'vpc' },
                      { title: '描述', dataIndex: 'Description', key: 'desc' },
                      { title: '状态', dataIndex: 'Status', key: 'status', render:(s:string)=>statusTag(s) },
                      { title: '创建时间', dataIndex: 'CreationTime', key: 'ctime' },
                      { title: '操作', key: 'actions', render: (_: any, r: any) => (
                        <Space>
                          <Button size="small" disabled={provider !== 'aliyun'} onClick={() => {
                            setEditingAcl(r);
                            editAclForm.setFieldsValue({ name: r?.NetworkAclName, desc: r?.Description });
                            setEditAclOpen(true);
                          }}>编辑</Button>
                          <Popconfirm
                            title="确认删除该 ACL？"
                            description="删除后不可恢复。"
                            onConfirm={async ()=>{
                              try {
                                const aclId = r?.NetworkAclId;
                                if (!aclId) { message.error('缺少 ACL 标识'); return; }
                                await deleteCloudProviderNetworkAcl(id!, aclId);
                                message.success('删除成功');
                                await loadNetworkAcls();
                              } catch(e:any){
                                message.error(e?.message || '删除失败');
                              }
                            }}
                          >
                            <Button size="small" danger disabled={provider !== 'aliyun'}>删除</Button>
                          </Popconfirm>
                        </Space>
                      ) },
                    ] as any}
                    dataSource={networkAcls}
                    loading={loading}
                    pagination={tablePagination}
                  />

                  <Modal
                    title="创建 网络 ACL（阿里云）"
                    open={createAclOpen}
                    onCancel={() => { setCreateAclOpen(false); createAclForm.resetFields(); }}
                    onOk={async () => {
                      try {
                        const values = await createAclForm.validateFields();
                        const payload = {
                          vpcId: values.vpcId,
                          name: values.name,
                          description: values.desc || undefined,
                        } as any;
                        await createCloudProviderNetworkAcl(id!, payload);
                        message.success('创建成功');
                        setCreateAclOpen(false);
                        createAclForm.resetFields();
                        await loadNetworkAcls();
                      } catch (err: any) {
                        message.error(err?.message || '创建失败');
                      }
                    }}
                    destroyOnHidden
                    okText="创建"
                  >
                    <Form form={createAclForm} layout="vertical">
                      <Form.Item name="vpcId" label="所属 VPC" rules={[{ required: true, message: '请选择 VPC' }]}>
                        <Select
                          placeholder="选择 VPC"
                          showSearch
                          optionFilterProp="label"
                          options={(vpcs || []).map((v: any) => {
                            const vid = v.VpcId || v.id || v.vpcId;
                            const name = v.VpcName || v.name || vid;
                            return { value: vid, label: `${name} (${vid})` };
                          })}
                        />
                      </Form.Item>
                      <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
                        <Input placeholder="例如：prod-acl-a" />
                      </Form.Item>
                      <Form.Item name="desc" label="描述">
                        <Input placeholder="可选：用途或备注" />
                      </Form.Item>
                    </Form>
                  </Modal>

                  <Modal
                    title="编辑 网络 ACL（阿里云）"
                    open={editAclOpen}
                    onCancel={() => { setEditAclOpen(false); setEditingAcl(null); editAclForm.resetFields(); }}
                    onOk={async () => {
                      try {
                        const values = await editAclForm.validateFields();
                        const aclId = editingAcl?.NetworkAclId;
                        if (!aclId) { message.error('缺少 ACL 标识'); return; }
                        await updateCloudProviderNetworkAcl(id!, aclId, { name: values.name || undefined, description: values.desc || undefined } as any);
                        message.success('更新成功');
                        setEditAclOpen(false);
                        setEditingAcl(null);
                        editAclForm.resetFields();
                        await loadNetworkAcls();
                      } catch (e: any) {
                        message.error(e?.message || '更新失败');
                      }
                    }}
                    destroyOnHidden
                    okText="保存"
                  >
                    <Form form={editAclForm} layout="vertical">
                      <Form.Item name="name" label="名称">
                        <Input placeholder="例如：prod-acl-a" />
                      </Form.Item>
                      <Form.Item name="desc" label="描述">
                        <Input placeholder="可选：用途或备注" />
                      </Form.Item>
                    </Form>
                  </Modal>
                </>
              )
            }]),
            ...(provider === 'harvester' ? [] : [{
              key: 'eip',
              label: '弹性公网 IP',
              children: (
                <>
                  <Table
                    bordered
                    rowKey={(r:any)=>r.AllocationId}
                    columns={[
                      { title: 'IP 地址', dataIndex: 'IpAddress', key: 'ip' },
                      { title: '分配ID', dataIndex: 'AllocationId', key: 'id' },
                      { title: '状态', dataIndex: 'Status', key: 'status', render:(s:string)=>statusTag(s) },
                      { title: '带宽(Mbps)', dataIndex: 'Bandwidth', key: 'bw' },
                      { title: '计费类型', dataIndex: 'InternetChargeType', key: 'charge' },
                    ] as any}
                    dataSource={eips}
                    loading={loading}
                    pagination={tablePagination}
                  />
                </>
              )
            }]),
            ...(provider === 'harvester' ? [] : [{
              key: 'slb',
              label: '负载均衡',
              children: (
                <>
                  <Table
                    bordered
                    rowKey={(r:any)=>r.LoadBalancerId}
                    columns={[
                      { title: '名称', dataIndex: 'LoadBalancerName', key: 'name' },
                      { title: '实例ID', dataIndex: 'LoadBalancerId', key: 'id' },
                      { title: '地址', dataIndex: 'Address', key: 'addr' },
                      { title: '状态', dataIndex: 'LoadBalancerStatus', key: 'status', render:(s:string)=>statusTag(s) },
                      { title: '地址类型', dataIndex: 'AddressType', key: 'addrType' },
                      { title: 'VPC', dataIndex: 'VpcId', key: 'vpc' },
                    ] as any}
                    dataSource={slbs}
                    loading={loading}
                    pagination={tablePagination}
                  />
                </>
              )
            }]),
            ...(provider === 'harvester' ? [] : [{
              key: 'nat',
              label: 'NAT 网关',
              children: (
                <>
                  <Table
                    bordered
                    rowKey={(r:any)=>r.NatGatewayId}
                    columns={[
                      { title: '名称', dataIndex: 'Name', key: 'name' },
                      { title: '网关ID', dataIndex: 'NatGatewayId', key: 'id' },
                      { title: '规格', dataIndex: 'Spec', key: 'spec' },
                      { title: '状态', dataIndex: 'Status', key: 'status', render:(s:string)=>statusTag(s) },
                      { title: '所属VPC', dataIndex: 'VpcId', key: 'vpc' },
                      { title: '创建时间', dataIndex: 'CreationTime', key: 'ctime' },
                    ] as any}
                    dataSource={natGateways}
                    loading={loading}
                    pagination={tablePagination}
                  />
                </>
              )
            }]),
            ...(provider === 'harvester' ? [] : [{
              key: 'route',
              label: '路由表',
              children: (
                <>
                  <Table
                    bordered
                    rowKey={(r:any)=> r.RouteTableId || r.id}
                    columns={[
                      { title: '路由表ID', key: 'id', render: (_:any, r:any) => r.RouteTableId || r.id || '-' },
                      { title: '类型', key: 'type', render: (_:any, r:any) => r.RouteTableType || r.type || r.routetable_type || '-' },
                      { title: '所属VPC', key: 'vpc', render: (_:any, r:any) => r.VpcId || r.vpc_id || '-' },
                      { title: '状态', key: 'status', render: (_:any, r:any) => statusTag(r.Status || r.status) },
                      { title: '创建时间', key: 'ctime', render: (_:any, r:any) => r.CreationTime || r.created_at || r.createdAt || '-' },
                    ] as any}
                    expandable={{
                      expandedRowRender: (record:any) => {
                        const rtId = record?.RouteTableId || record?.id;
                        const routes: any[] = routeEntriesMap[rtId] ||
                          (record?.RouteEntrys && record?.RouteEntrys?.RouteEntry) ||
                          record?.RouteEntryList?.RouteEntry ||
                          record?.routes ||
                          record?.route_entries ||
                          record?.routeEntries ||
                          [];
                        const routeColumns: any[] = [
                          { title: '目的网段', key: 'dst', render: (_:any, r:any) => r.DestinationCidrBlock || r.destination || r.dest || '-' },
                          { title: '下一跳', key: 'nh', render: (_:any, r:any) => r.NextHopId || r.nexthop || r.nextHop || '-' },
                          { title: '类型', key: 'rtype', render: (_:any, r:any) => r.NextHopType || r.type || '-' },
                          { title: '状态', key: 'rstatus', render: (_:any, r:any) => statusTag(r.Status || r.status) },
                          { title: '描述', key: 'desc', render: (_:any, r:any) => r.Description || r.description || '-' },
                        ];
                        return (
                          <Table
                            size="small"
                            bordered
                            rowKey={(r:any)=> r.RouteEntryId || r.id || `${r.DestinationCidrBlock || r.destination}-${r.NextHopId || r.nexthop || ''}`}
                            columns={routeColumns}
                            dataSource={Array.isArray(routes) ? routes : []}
                            pagination={false}
                          />
                        );
                      },
                      onExpand: (expanded, record) => {
                        if (expanded) {
                          const rtId = record?.RouteTableId || record?.id;
                          if (rtId && !routeEntriesMap[rtId]) {
                            loadRouteEntries(record);
                          }
                        }
                      }
                    }}
                    dataSource={routeTables}
                    loading={loading}
                    pagination={tablePagination}
                  />
                </>
              )
            }]),
            ...(provider === 'harvester' ? [] : [{
              key: 'disks',
              label: '云盘',
              children: (
                <>
                  <Divider style={{ marginTop: 0 }} />
                  <Table
                    bordered
                    rowKey={(r:any)=>r.DiskId}
                    columns={[
                      { title: '云盘ID', dataIndex: 'DiskId', key: 'id' },
                      { title: '名称', dataIndex: 'DiskName', key: 'name' },
                      { title: '类型', dataIndex: 'Type', key: 'type' },
                      { title: '类别', dataIndex: 'Category', key: 'category' },
                      { title: '大小(GB)', dataIndex: 'Size', key: 'size' },
                      { title: '状态', dataIndex: 'Status', key: 'status', render:(s:string)=>statusTag(s) },
                      { title: '可用区', dataIndex: 'ZoneId', key: 'zone' },
                      { title: '挂载实例', dataIndex: 'InstanceId', key: 'instance' },
                    ] as any}
                    dataSource={disks}
                    loading={loading}
                    pagination={tablePagination}
                  />
                </>
              )
            }]),
            ...(provider === 'harvester' ? [] : [{
              key: 'snapshots',
              label: '快照',
              children: (
                <>
                  <Divider style={{ marginTop: 0 }} />
                  <Table
                    bordered
                    rowKey={(r:any)=>r.SnapshotId}
                    columns={[
                      { title: '快照ID', dataIndex: 'SnapshotId', key: 'id' },
                      { title: '名称', dataIndex: 'SnapshotName', key: 'name' },
                      { title: '源云盘', dataIndex: 'SourceDiskId', key: 'disk' },
                      { title: '大小(GB)', dataIndex: 'SourceDiskSize', key: 'size' },
                      { title: '进度', dataIndex: 'Progress', key: 'progress' },
                      { title: '状态', dataIndex: 'Status', key: 'status', render:(s:string)=>statusTag(s) },
                      { title: '开始时间', dataIndex: 'StartTime', key: 'start' },
                    ] as any}
                    dataSource={snapshots}
                    loading={loading}
                    pagination={tablePagination}
                  />
                </>
              )
            }])
            , ...(provider === 'harvester' ? [
            {
              key: 'harvester_nodes',
              label: '节点',
              children: (
                <>
                  <Table
                    bordered
                    rowKey={(r:any)=>r.name}
                    columns={[
                      { title: '名称', dataIndex: 'name', key: 'name' },
                      { title: '角色', dataIndex: 'roles', key: 'roles', render:(v:any)=> Array.isArray(v) ? v.join(',') : '-' },
                      { title: '内网IP', dataIndex: 'internalIP', key: 'inip' },
                      { title: '公网IP', dataIndex: 'externalIP', key: 'exip' },
                      { title: '就绪', dataIndex: 'ready', key: 'ready', render:(b:boolean)=> b ? <Tag color="green">Ready</Tag> : <Tag color="red">NotReady</Tag> },
                      { title: 'CPU', dataIndex: 'cpu', key: 'cpu' },
                      { title: '内存', dataIndex: 'memory', key: 'mem' },
                    ] as any}
                    dataSource={harvesterNodes}
                    loading={loading}
                    pagination={tablePagination}
                  />
                </>
              )
              },
              {
                key: 'harvester_cluster',
                label: '系统组件（Pods）',
                children: (
                  <>
                    <div style={{ display:'flex', justifyContent:'space-between', marginBottom: 12 }}>
                      <Space>
                        {healthError && (
                          <Alert type="error" showIcon message="体检失败" description={healthError} />
                        )}
                      </Space>
                      <Space>
                        <Button icon={<ReloadOutlined />} loading={healthLoading} onClick={runHealthCheck}>连接体检</Button>
                      </Space>
                    </div>
                    <Descriptions bordered size="small" column={3} style={{ marginBottom: 12 }}>
                      <Descriptions.Item label="Endpoint">{cloud?.endpoint || '-'}</Descriptions.Item>
                      <Descriptions.Item label="TLS 忽略">{(cloud?.config?.ignoreTls ? <Tag color="orange">是</Tag> : <Tag>否</Tag>)}</Descriptions.Item>
                      <Descriptions.Item label="连接状态">{cloud?.status === 'online' ? <Tag color="green">在线</Tag> : <Tag color="red">离线</Tag>}</Descriptions.Item>
                      <Descriptions.Item label="节点数">{harvesterNodes.length}</Descriptions.Item>
                      <Descriptions.Item label="就绪节点数">{harvesterNodes.filter((n:any)=>n.ready).length}</Descriptions.Item>
                      <Descriptions.Item label="版本">{(harvesterNodes.find((n:any)=>n.version)?.version) || '-'}</Descriptions.Item>
                      <Descriptions.Item label="支持能力" span={3}>
                        <Space>
                          <Tag color="blue">VM</Tag>
                          <Tag color="blue">NAD</Tag>
                          <Tag color="blue">Volumes</Tag>
                          <Tag color="blue">Images</Tag>
                          <Tag color="blue">Nodes</Tag>
                          <Tag>VPC</Tag>
                          <Tag>EIP</Tag>
                          <Tag>SLB</Tag>
                          <Tag>NAT</Tag>
                          <Tag>SecurityGroup</Tag>
                          <Tag>ENI</Tag>
                        </Space>
                      </Descriptions.Item>
                    </Descriptions>
                    {harvesterHealthItems.length>0 && (
                      <Table
                        bordered
                        rowKey={(r:any)=>`${r.key}:${r.url}`}
                        columns={[
                          { title: '检查项', dataIndex: 'label', key: 'label' },
                          { title: '分组', dataIndex: 'group', key: 'group' },
                          { title: '用途', dataIndex: 'purpose', key: 'purpose' },
                          { title: '地址', dataIndex: 'url', key: 'url' },
                          { title: '状态码', dataIndex: 'status', key: 'status' },
                          { title: '可用', dataIndex: 'ok', key: 'ok', render:(b:boolean)=> b ? <Tag color="green">OK</Tag> : <Tag color="red">FAIL</Tag> },
                        ] as any}
                        dataSource={harvesterHealthItems}
                        pagination={false}
                        style={{ marginBottom: 12 }}
                      />
                    )}
                    <Table
                      bordered
                      rowKey={(r:any)=>r.name}
                      columns={[
                        { title: '组件', dataIndex: 'name', key: 'name' },
                        { title: '状态', dataIndex: 'phase', key: 'phase', render:(s:string)=>statusTag(s) },
                        { title: '就绪', key: 'ready', render: (_:any, r:any)=> `${r.ready}/${r.total}` },
                      ] as any}
                      dataSource={harvesterSystemPods}
                      pagination={tablePagination}
                      loading={loading}
                    />
                  </>
                )
              }
            ,
            {
              key: 'ecs',
              label: '云主机',
              children: (
                <>
                  <Table
                    bordered
                    rowKey={(r:any)=>r.InstanceId}
                    columns={[
                      { title: '实例名', dataIndex: 'InstanceName', key: 'name' },
                      { title: '命名空间', key: 'ns', render: (_: any, r: any) => {
                        const s = String(r?.InstanceId || '');
                        return s.includes('/') ? s.split('/')[0] : '-';
                      } },
                      { title: '所属主机', key: 'node', render: (_: any, r: any) => (r?.Extra?.NodeName || '-') },
                      { title: '网络', key: 'networks', ellipsis: true, render: (_: any, r: any) => {
                        const vpc = r?.VpcId || '';
                        const subnet = r?.Extra?.SubnetName || '';
                        const nads = Array.isArray(r?.Extra?.Networks) ? r?.Extra?.Networks : [];
                        const items: string[] = [];
                        if (vpc) items.push(subnet ? `${vpc}/${subnet}` : vpc);
                        const nadNames = nads.map((n: any) => {
                          const s = String(n || '');
                          return s.includes('/') ? s.split('/').pop() : s;
                        }).filter((s: string) => !!s);
                        items.push(...nadNames);
                        return items.length ? items.join(' | ') : '-';
                      } },
                      { title: 'vCPU 分配', key: 'cpu', render: (_: any, r: any) => (r?.Extra?.CPU ?? '-') },
                      { title: '内存分配', key: 'mem', render: (_: any, r: any) => (r?.Extra?.Memory || '-') },
                      { title: '镜像', key: 'image', ellipsis: true, render: (_: any, r: any) => (r?.Extra?.Image || '-') },
                      { title: '已使用 CPU（%）', key: 'cpuUsed', render: (_: any, r: any) => (typeof r?.Extra?.CpuUsagePct === 'number') ? `${r.Extra.CpuUsagePct}%` : '-' },
                      { title: '已使用内存', key: 'memUsed', render: (_: any, r: any) => (r?.Extra?.MemUsage || '-') },
                      { title: '状态', dataIndex: 'Status', key: 'status', render: (s:string)=>statusTag(s) },
                      { title: '私网IP', dataIndex: ['VpcAttributes','PrivateIpAddress','IpAddress'], key: 'ip', render:(ips:any)=>Array.isArray(ips)? ips.join(', '): '-' },
                      { title: '创建时间', dataIndex: 'CreationTime', key: 'ctime' },
                      { title: '操作', key: 'actions', render: (_: any, r: any) => {
                        const disabled = false;
                        const iid = r?.InstanceId;
                        const items = [
                          { key: 'connect', label: '远程连接' },
                          { key: 'webssh', label: 'WebSSH（浏览器）' },
                          { key: 'webvnc', label: 'WebVNC（浏览器）' },
                          { key: 'detail', label: '详情' },
                          { key: 'start', label: '启动' },
                          { key: 'stop', label: '停止' },
                          { key: 'reboot', label: '重启' },
                          { key: 'delete', label: '删除', danger: true },
                        ];
                        return (
                          <Dropdown
                            menu={{ items, onClick: async ({ key }) => {
                              if (key === 'connect') {
                                openRemoteConnect(r);
                                return;
                              }
                              if (key === 'webvnc') {
                                const pubArr = r?.PublicIpAddress?.IpAddress;
                                const pub = Array.isArray(pubArr) && pubArr.length > 0 ? pubArr[0] : (r?.EipAddress?.IpAddress || r?.publicIpAddress || (Array.isArray(r?.PublicIpAddress?.IpAddress) ? r?.PublicIpAddress?.IpAddress[0] : null));
                                const priArr = r?.VpcAttributes?.PrivateIpAddress?.IpAddress;
                                const pri = Array.isArray(priArr) && priArr.length > 0 ? priArr[0] : r?.privateIpAddress;
                                const host = pub || pri || '';
                                navigate(`/admin/clouds/${id}/webvnc?host=${encodeURIComponent(host)}&port=5900`);
                                return;
                              }
                              if (key === 'webssh') {
                                const pubArr = r?.PublicIpAddress?.IpAddress;
                                const pub = Array.isArray(pubArr) && pubArr.length > 0 ? pubArr[0] : (r?.EipAddress?.IpAddress || r?.publicIpAddress || (Array.isArray(r?.PublicIpAddress?.IpAddress) ? r?.PublicIpAddress?.IpAddress[0] : null));
                                const priArr = r?.VpcAttributes?.PrivateIpAddress?.IpAddress;
                                const pri = Array.isArray(priArr) && pubArr?.length > 0 ? priArr[0] : r?.privateIpAddress;
                                const host = pub || pri || '';
                                const user = 'root';
                                navigate(`/admin/clouds/${id}/webssh?host=${encodeURIComponent(host)}&user=${encodeURIComponent(user)}&port=22`);
                                return;
                              }
                              if (key === 'detail') {
                                try {
                                  const s = String(iid || '');
                                  const ns = s.includes('/') ? s.split('/')[0] : '';
                                  const nm = s.includes('/') ? s.split('/')[1] : s;
                                  const json = await fetchHarvesterVmDetail(id!, ns, nm);
                                  setVmDetail(json?.data || null);
                                  setVmDetailOpen(true);
                                } catch (e:any) {
                                  message.error(e?.message || '加载详情失败');
                                }
                                return;
                              }
                              if (!id || !iid) return;
                              try {
                                if (key === 'start') {
                                  await startCloudProviderEcs(id!, iid);
                                  message.success('启动指令已下发');
                                  await loadEcs();
                                } else if (key === 'stop') {
                                  await stopCloudProviderEcs(id!, iid, true);
                                  message.success('停止指令已下发');
                                  await loadEcs();
                                } else if (key === 'reboot') {
                                  await rebootCloudProviderEcs(id!, iid, true);
                                  message.success('重启指令已下发');
                                  await loadEcs();
                                } else if (key === 'delete') {
                                  Modal.confirm({
                                    title: '确认删除该云主机？',
                                    content: '删除后不可恢复，请确保已停止实例且无重要数据。',
                                    okText: '删除', okType: 'danger', cancelText: '取消',
                                    onOk: async () => {
                                      try {
                                        await deleteCloudProviderEcs(id!, iid);
                                        message.success('删除指令已下发');
                                        await loadEcs();
                                      } catch (e:any) {
                                        message.error(e?.message || '删除失败');
                                      }
                                    }
                                  });
                                }
                              } catch(e:any){
                                message.error(e?.message || '操作失败');
                              }
                            } }}
                            trigger={["click"]}
                          >
                            <Button type="link" icon={<UnorderedListOutlined />} />
                          </Dropdown>
                        );
                      } },
                    ] as any}
                    dataSource={ecs}
                    loading={loading}
                    pagination={tablePagination}
                  />
                  
                  <Modal
                    title="实例详情"
                    open={vmDetailOpen}
                    onCancel={() => { setVmDetailOpen(false); setVmDetail(null); }}
                    footer={null}
                    width={800}
                    destroyOnHidden
                  >
                    {provider === 'harvester' && vmDetail ? (
                      <Descriptions bordered column={1} size="small">
                        <Descriptions.Item label="名称">{vmDetail?.metadata?.name || '-'}</Descriptions.Item>
                        <Descriptions.Item label="命名空间">{vmDetail?.metadata?.namespace || '-'}</Descriptions.Item>
                        <Descriptions.Item label="节点">{vmDetail?.status?.nodeName || '-'}</Descriptions.Item>
                        <Descriptions.Item label="状态">{vmDetail?.status?.printableStatus || vmDetail?.status?.phase || '-'}</Descriptions.Item>
                        <Descriptions.Item label="CPU">{vmDetail?.spec?.template?.spec?.domain?.cpu?.cores ?? '-'}</Descriptions.Item>
                        <Descriptions.Item label="内存">{vmDetail?.spec?.template?.spec?.domain?.resources?.requests?.memory || vmDetail?.spec?.template?.spec?.domain?.memory?.guest || '-'}</Descriptions.Item>
                        <Descriptions.Item label="镜像">{(vmDetail?.spec?.template?.spec?.volumes || []).map((v:any)=> v?.containerDisk?.image).filter(Boolean).join(', ') || '-'}</Descriptions.Item>
                      </Descriptions>
                    ) : (
                      <Alert type="info" message="当前仅支持 Harvester 详情展示" />
                    )}
                  </Modal>
                </>
              )
            },
            
            ] : [])
          ]}
        />
      </Card>
    </PageDetailContainer>
  );
};

export default CloudDetail;
