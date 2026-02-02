import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Table, Tag, Space, Button, Statistic, Row, Col, Alert, Tabs, Descriptions, Modal, Select, Popconfirm, message, Dropdown, Typography } from 'antd';
import NodesSection from './sections/NodesSection';
import ImagesSection from './sections/ImagesSection';
import VolumesSection from './sections/VolumesSection';
import NadsSection from './sections/NadsSection';
import KubeOvnVpcsSection from './sections/KubeOvnVpcsSection';
import KubeOvnSubnetsSection from './sections/KubeOvnSubnetsSection';
import KubeOvnPublicNetworksSection from './sections/KubeOvnPublicNetworksSection';
import GpusSection from './sections/GpusSection';
import StorageClassesSection from './sections/StorageClassesSection';
// Re-trigger compilation
import NamespacesTab from './sections/NamespacesTab';
import { CloudUploadOutlined, CloudServerOutlined, GlobalOutlined, HddOutlined, NodeIndexOutlined, CameraOutlined, ClusterOutlined, ReloadOutlined, ArrowLeftOutlined, UnorderedListOutlined, HomeOutlined, AppstoreOutlined, LoginOutlined } from '@ant-design/icons';
import PageDetailContainer from '../../../components/PageDetailContainer';
import { API_BASE_URL, fetchClouds, fetchCloudProviderEcs, fetchHarvesterNads, fetchHarvesterImages, fetchHarvesterVolumes, fetchHarvesterNodes, fetchHarvesterSystemPods, fetchHarvesterVmDetail, fetchKubeOvnVpcs, fetchKubeOvnSubnets, startCloudProviderEcs, stopCloudProviderEcs, rebootCloudProviderEcs, softRebootCloudProviderEcs, pauseCloudProviderEcs, unpauseCloudProviderEcs, deleteCloudProviderEcs, fetchHarvesterGpuResources, fetchHarvesterNamespaces, fetchHarvesterStorageClasses, fetchHarvesterCapabilities } from '../../../services/api';
import VmReconfigureModal from './modals/VmReconfigureModal';
import VmSection from './sections/VmSection';

interface CloudItem { id: string; name: string; region: string; type: string; config?: any; status?: string; endpoint?: string; description?: string; createdAt?: string; updatedAt?: string; }

const statusTag = (s?: string) => {
  const color = s === 'Available' ? 'green' : s === 'Pending' ? 'orange' : 'blue';
  return <Tag color={color}>{s || '-'}</Tag>;
};

const CloudDetailHarvester: React.FC<{ cloudId: string; defaultProvider?: string }> = ({ cloudId, defaultProvider }) => {
  const navigate = useNavigate();
  const [cloud, setCloud] = useState<CloudItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ecs, setEcs] = useState<any[]>([]);
  const [harvesterNads, setHarvesterNads] = useState<any[]>([]);
  const [harvesterImages, setHarvesterImages] = useState<any[]>([]);
  const [harvesterVolumes, setHarvesterVolumes] = useState<any[]>([]);
  const [harvesterNodes, setHarvesterNodes] = useState<any[]>([]);
  const [kubeOvnVpcs, setKubeOvnVpcs] = useState<any[]>([]);
  const [kubeOvnSubnets, setKubeOvnSubnets] = useState<any[]>([]);
  const [harvesterSystemPods, setHarvesterSystemPods] = useState<any[]>([]);
  const [vmReconfOpen, setVmReconfOpen] = useState(false);
  const [vmReconfTarget, setVmReconfTarget] = useState<any | null>(null);
  const [nsFilter, setNsFilter] = useState<string>('');
  const [nodeFilter, setNodeFilter] = useState<string>('');
  const [showLog, setShowLog] = useState<boolean>(false);
  const [rawEcs, setRawEcs] = useState<any | null>(null);
  const [rawNads, setRawNads] = useState<any | null>(null);
  const [rawImages, setRawImages] = useState<any | null>(null);
  const [rawVolumes, setRawVolumes] = useState<any | null>(null);
  const [rawNodes, setRawNodes] = useState<any | null>(null);
  const [rawPods, setRawPods] = useState<any | null>(null);
  const [rawVpcs, setRawVpcs] = useState<any | null>(null);
  const [rawSubnets, setRawSubnets] = useState<any | null>(null);
  const [harvesterGpuResources, setHarvesterGpuResources] = useState<any[]>([]);
  const [rawGpu, setRawGpu] = useState<any | null>(null);
  const [harvesterNamespaces, setHarvesterNamespaces] = useState<any[]>([]);
  const [rawNamespaces, setRawNamespaces] = useState<any | null>(null);
  const [harvesterStorageClasses, setHarvesterStorageClasses] = useState<any[]>([]);
  const [capabilities, setCapabilities] = useState<any>(null);

  // Single Resource Refresh: Nodes
  const [nodesLoading, setNodesLoading] = useState(false);
  const refreshNodes = async () => {
      if (nodesLoading) return;
      setNodesLoading(true);
      try {
        const nodesJson = await fetchHarvesterNodes(cloudId);
        const nodesList: any[] = (nodesJson as any)?.data?.items || [];
        setHarvesterNodes(Array.isArray(nodesList) ? nodesList : []);
        setRawNodes(nodesJson || null);
        message.success('节点刷新成功');
      } catch (e: any) {
        message.error(`刷新节点失败: ${e?.message || '未知错误'}`);
      } finally {
        setNodesLoading(false);
      }
  };

  // Single Resource Refresh: NADs
  const [nadsLoading, setNadsLoading] = useState(false);
  const refreshNads = async () => {
      if (nadsLoading) return;
      setNadsLoading(true);
      try {
        const nadsJson = await fetchHarvesterNads(cloudId);
        const nadsList: any[] = (nadsJson as any)?.data?.items || [];
        setHarvesterNads(Array.isArray(nadsList) ? nadsList : []);
        setRawNads(nadsJson || null);
        message.success('NAD网络刷新成功');
      } catch (e: any) {
        message.error(`刷新NAD网络失败: ${e?.message || '未知错误'}`);
      } finally {
        setNadsLoading(false);
      }
  };

  const loadAll = async () => {
    if (loading) {
      // return; // We allow force refresh
    }
    setLoading(true);
    setError(null);
    try {
      const cloudsRes = await fetchClouds();
      const cloudList: any[] = Array.isArray(cloudsRes) ? cloudsRes : (Array.isArray((cloudsRes as any)?.data) ? (cloudsRes as any).data : []);
      setCloud((cloudList || []).find((c:any)=> String(c.id) === String(cloudId)) || null);
      const [ecsJson, nadsJson, imagesJson, volsJson, nodesJson, podsJson, vpcsJson, subsJson, gpuJson, nsJson, scJson, capJson] = await Promise.all([
        fetchCloudProviderEcs(cloudId),
        fetchHarvesterNads(cloudId).catch(()=>null),
        fetchHarvesterImages(cloudId).catch(()=>null),
        fetchHarvesterVolumes(cloudId).catch(()=>null),
        fetchHarvesterNodes(cloudId).catch(()=>null),
        fetchHarvesterSystemPods(cloudId).catch(()=>null),
        fetchKubeOvnVpcs(cloudId).catch(()=>null),
        fetchKubeOvnSubnets(cloudId).catch(()=>null),
        fetchHarvesterGpuResources(cloudId).catch(()=>null),
        fetchHarvesterNamespaces(cloudId).catch(()=>null),
        fetchHarvesterStorageClasses(cloudId).catch(()=>null),
        fetchHarvesterCapabilities(cloudId).catch(()=>null),
      ]);
      const ecsList: any[] = Array.isArray((ecsJson as any)?.data) ? (ecsJson as any).data : (((ecsJson as any)?.data?.Instances?.Instance) || ((ecsJson as any)?.data?.items) || ((ecsJson as any)?.data?.data) || []);
      setEcs(Array.isArray(ecsList) ? ecsList : []);
      setRawEcs(ecsJson || null);
      const nadsList: any[] = (nadsJson as any)?.data?.items || [];
      setRawNads(nadsJson || null);
      setHarvesterNads(Array.isArray(nadsList) ? nadsList : []);
      const imagesList: any[] = (imagesJson as any)?.data?.items || [];
      setHarvesterImages(Array.isArray(imagesList) ? imagesList : []);
      setRawImages(imagesJson || null);
      const volsList: any[] = (volsJson as any)?.data?.items || [];
      setHarvesterVolumes(Array.isArray(volsList) ? volsList : []);
      setRawVolumes(volsJson || null);
      const nodesList: any[] = (nodesJson as any)?.data?.items || [];
      setHarvesterNodes(Array.isArray(nodesList) ? nodesList : []);
      setRawNodes(nodesJson || null);
      const vpcsList: any[] = (vpcsJson as any)?.data?.items || [];
      setKubeOvnVpcs(Array.isArray(vpcsList) ? vpcsList : []);
      setRawVpcs(vpcsJson || null);
      const subsList: any[] = (subsJson as any)?.data?.items || [];
      setKubeOvnSubnets(Array.isArray(subsList) ? subsList : []);
      setRawSubnets(subsJson || null);
      const podsList: any[] = (podsJson as any)?.data?.items || [];
      setHarvesterSystemPods(Array.isArray(podsList) ? podsList : []);
      setRawPods(podsJson || null);
      const gpuList: any[] = Array.isArray((gpuJson as any)?.data?.items) ? (gpuJson as any)?.data?.items : (Array.isArray((gpuJson as any)?.items) ? (gpuJson as any)?.items : []);
      setHarvesterGpuResources(Array.isArray(gpuList) ? gpuList : []);
      setRawGpu(gpuJson || null);
      const nsList: any[] = Array.isArray((nsJson as any)?.data?.items) ? (nsJson as any).data.items : (Array.isArray((nsJson as any)?.items) ? (nsJson as any).items : []);
      setHarvesterNamespaces(Array.isArray(nsList) ? nsList : []);
      setRawNamespaces(nsJson || null);
      const scList: any[] = Array.isArray((scJson as any)?.data?.items) ? (scJson as any).data.items : (Array.isArray((scJson as any)?.items) ? (scJson as any).items : []);
      setHarvesterStorageClasses(Array.isArray(scList) ? scList : []);
      setCapabilities(capJson?.data || null);
    } catch (e:any) {
      setError(e?.message || '查询失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, [cloudId]);
  useEffect(() => {
    try {
      const token = localStorage.getItem('token') || '';
      const url = `${API_BASE_URL}/api/clouds/${cloudId}/resources/ecs/stream${token ? `?token=${encodeURIComponent(token)}` : ''}`;
      const es = new EventSource(url);
      es.addEventListener('vms', (ev: MessageEvent) => {
        try {
          const json = JSON.parse(String(ev.data || '{}'));
          const items: any[] = Array.isArray(json?.items) ? json.items : [];
          setEcs(items);
        } catch {}
      });
      es.addEventListener('vm_created', (ev: MessageEvent) => {
        try {
          const json = JSON.parse(String(ev.data || '{}'));
          const r = json?.item;
          if (!r) return;
          setEcs(prev => {
            const iid = String(r?.InstanceId || r?.id || '');
            if (!iid) return prev;
            if ((prev || []).some((x:any)=> String(x?.InstanceId||x?.id||'')===iid)) return prev;
            return [r, ...(prev || [])];
          });
        } catch {}
      });
      es.addEventListener('vm_deleted', (ev: MessageEvent) => {
        try {
          const json = JSON.parse(String(ev.data || '{}'));
          const iid = String(json?.iid || '');
          if (!iid) return;
          setEcs(prev => (prev || []).filter((x:any)=> String(x?.InstanceId||x?.id||'')!==iid));
        } catch {}
      });
      es.addEventListener('vm_status', (ev: MessageEvent) => {
        try {
          const json = JSON.parse(String(ev.data || '{}'));
          const iid = String(json?.iid || '');
          const status = String(json?.status || '');
          const nodeName = String(json?.nodeName || '');
          if (!iid) return;
          setEcs(prev => (prev || []).map((x:any)=> {
            const xiid = String(x?.InstanceId||x?.id||'');
            if (xiid === iid) {
               const newItem = { ...x, Status: status, status };
               
               // Always update NodeName
               if (!newItem.Extra) newItem.Extra = {};
               newItem.Extra.NodeName = nodeName;
               
               if (!newItem.vmi) newItem.vmi = { status: {} };
               if (!newItem.vmi.status) newItem.vmi.status = {};
               newItem.vmi.status.nodeName = nodeName;
               
               return newItem;
            }
            return x;
          }));
        } catch {}
      });
      es.addEventListener('error', () => { /* ignore */ });
      return () => { try { es.close(); } catch {} };
    } catch {}
  }, [cloudId]);

  const nodesOptions = useMemo(() => {
    const s = new Set<string>();
    ecs.forEach((r:any)=>{ const n = r?.Extra?.NodeName || ''; if (n) s.add(n); });
    return Array.from(s).sort();
  }, [ecs]);
  const namespacesOptions = useMemo(() => {
    const s = new Set<string>();
    ecs.forEach((r:any)=>{ const iid = String(r?.InstanceId || ''); if (iid.includes('/')) { s.add(iid.split('/')[0]); } });
    return Array.from(s).sort();
  }, [ecs]);
  const ecsFiltered = useMemo(() => {
    return ecs.filter((r:any)=>{
      const iid = String(r?.InstanceId || '');
      const ns = iid.includes('/') ? iid.split('/')[0] : '';
      const node = r?.Extra?.NodeName || '';
      if (nsFilter && ns !== nsFilter) return false;
      if (nodeFilter && node !== nodeFilter) return false;
      return true;
    });
  }, [ecs, nsFilter, nodeFilter]);
  const providerRaw = useMemo(() => String(cloud?.config?.provider || defaultProvider || ''), [cloud, defaultProvider]);
  const provider = useMemo(() => providerRaw.toLowerCase(), [providerRaw]);
  const isCloudmap = useMemo(() => provider === 'cloudmap' || provider === 'cloudmap.private' || provider === 'cloudmap.edge', [provider]);
  const providerName = useMemo(() => (isCloudmap ? 'Cloudmap' : 'Harvester'), [isCloudmap]);
  const labelVolumes = '虚拟卷';
  const labelNad = 'NAD 网络';
  const labelKubeOvnVpcs = 'Kube-OVN VPC';
  const labelKubeOvnSubnets = 'Kube-OVN 子网';
  const versionText = useMemo(() => {
    const fromConfig = cloud?.config?.harvesterVersion;
    const fromNodes = (harvesterNodes.find((n:any)=> n?.version)?.version) || undefined;
    return fromConfig || fromNodes || '-';
  }, [cloud, harvesterNodes]);
  const hasKubeOvn = useMemo(() => (kubeOvnVpcs.length > 0 || kubeOvnSubnets.length > 0), [kubeOvnVpcs, kubeOvnSubnets]);
  const tlsIgnored = !!(cloud?.config?.ignoreTls);
  const refreshGpu = async () => {
    try {
      const r = await fetchHarvesterGpuResources(cloudId);
      const items = Array.isArray((r as any)?.data?.items) ? (r as any).data.items : (Array.isArray((r as any)?.items) ? (r as any).items : []);
      setHarvesterGpuResources(items);
      setRawGpu(r);
    } catch (e: any) {
      message.error(e?.message || '刷新失败');
    }
  };

  return (
    <PageDetailContainer
      breadcrumbs={[
        { title: <HomeOutlined />, href: '/' },
        { title: '资源控制台' },
        { title: '资源池管理', href: '/admin/clouds' },
        { title: `${providerName} ${cloud?.name || '-'}` }
      ]}
      icon={<CloudUploadOutlined />}
      title={`${providerName} ${cloud?.name || '-'}`}
      titleLevel={3}
      
      
      extra={
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/admin/clouds')}></Button>
          <Dropdown
          menu={{
            items: [
              { key: 'refresh', label: '资源刷新' },
              { key: 'toggleLog', label: (showLog ? '隐藏日志' : '显示日志') },
            ],
            onClick: ({ key }) => {
              if (key === 'refresh') { loadAll(); return; }
              if (key === 'toggleLog') { setShowLog(v => !v); return; }
            },
          }}
        >
          <Button icon={<UnorderedListOutlined />} />
        </Dropdown>
      </Space>
      }
      asCard={false}
      subtitle="集中展示云资源池信息，提供多种资源类型的生命周期管理能力"
      overviewContent={(
        <Descriptions bordered size="small" column={4}>
          <Descriptions.Item label="资源名称">{cloud?.name || '-'}</Descriptions.Item>
          <Descriptions.Item label="资源供应商">{providerName}</Descriptions.Item>
          <Descriptions.Item label="资源地域">{cloud?.region || '-'}</Descriptions.Item>
          <Descriptions.Item label="资源类型">{cloud?.type || '-'}</Descriptions.Item>
          <Descriptions.Item label="资源状态">{cloud?.status === 'online' ? <Tag color="green">在线</Tag> : cloud?.status === 'maintenance' ? <Tag color="orange">维护</Tag> : cloud?.status === 'offline' ? <Tag color="red">离线</Tag> : <Tag>未知</Tag>}</Descriptions.Item>
          <Descriptions.Item label="Endpoint">
            <Space>
              {cloud?.endpoint || '-'}
              {cloud?.endpoint && (
                <Button 
                  type="link" 
                  size="small" 
                  icon={<LoginOutlined />} 
                  style={{ padding: 0 }}
                  onClick={() => {
                    let url = cloud.endpoint || '';
                    if (url.endsWith('/v3')) {
                      url = url.substring(0, url.length - 3);
                    } else if (url.endsWith('/v3/')) {
                      url = url.substring(0, url.length - 4);
                    }
                    window.open(url, '_blank');
                  }}
                >
                  登录OPS
                </Button>
              )}
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label="版本">{versionText}</Descriptions.Item>
          <Descriptions.Item label="CPU 架构">
            {capabilities?.architecture ? (
              (capabilities.architecture === 'arm64' || capabilities.architecture === 'aarch64') 
                ? <Tag color="blue">ARM64</Tag> 
                : <Tag color="blue">x86_64</Tag>
            ) : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="TLS 忽略">{tlsIgnored ? <Tag color="orange">是</Tag> : <Tag>否</Tag>}</Descriptions.Item>
          <Descriptions.Item label="网络插件">{hasKubeOvn ? <Tag color="blue">Kube-OVN</Tag> : <Tag>未知/未启用</Tag>}</Descriptions.Item>
          <Descriptions.Item label="资源ID">{cloud?.id || '-'}</Descriptions.Item>
          <Descriptions.Item label="更新时间">{cloud?.updatedAt || '-'}</Descriptions.Item>
        </Descriptions>
      )}
    >
      {error && (
        <Alert type="error" message="查询失败" description={error} style={{ marginBottom: 16 }} showIcon />
      )}
      <Tabs
          defaultActiveKey="overview"
          items={[
            {
              key: 'overview',
              label: '资源总览',
              children: (
                <>
                  <Row gutter={[16, 16]}>
                    <Col xs={24} sm={12} md={6}><Card size="small" variant="outlined" style={{ borderRadius: 8 }}><Statistic title={<span style={{ display:'flex', alignItems:'center' }}><CloudServerOutlined style={{ color:'#1677ff', marginRight:8 }} />云主机（VM）</span>} value={ecs.length} valueStyle={{ fontSize: 24, fontWeight: 700 }} /></Card></Col>
                    <Col xs={24} sm={12} md={6}><Card size="small" variant="outlined" style={{ borderRadius: 8 }}><Statistic title={<span style={{ display:'flex', alignItems:'center' }}><AppstoreOutlined style={{ color:'#1677ff', marginRight:8 }} />命名空间</span>} value={harvesterNamespaces.length} valueStyle={{ fontSize: 24, fontWeight: 700 }} /></Card></Col>
                    <Col xs={24} sm={12} md={6}><Card size="small" variant="outlined" style={{ borderRadius: 8 }}><Statistic title={<span style={{ display:'flex', alignItems:'center' }}><CameraOutlined style={{ color:'#1677ff', marginRight:8 }} />镜像</span>} value={harvesterImages.length} valueStyle={{ fontSize: 24, fontWeight: 700 }} /></Card></Col>
                    <Col xs={24} sm={12} md={6}><Card size="small" variant="outlined" style={{ borderRadius: 8 }}><Statistic title={<span style={{ display:'flex', alignItems:'center' }}><HddOutlined style={{ color:'#1677ff', marginRight:8 }} />虚拟卷</span>} value={harvesterVolumes.length} valueStyle={{ fontSize: 24, fontWeight: 700 }} /></Card></Col>
                  </Row>
                  <Row gutter={[16, 16]} style={{ marginTop: 12 }}>
                    <Col xs={24} sm={12} md={6}><Card size="small" variant="outlined" style={{ borderRadius: 8 }}><Statistic title={<span style={{ display:'flex', alignItems:'center' }}><NodeIndexOutlined style={{ color:'#1677ff', marginRight:8 }} />节点</span>} value={harvesterNodes.length} valueStyle={{ fontSize: 24, fontWeight: 700 }} /></Card></Col>
                    <Col xs={24} sm={12} md={6}><Card size="small" variant="outlined" style={{ borderRadius: 8 }}><Statistic title={<span style={{ display:'flex', alignItems:'center' }}><GlobalOutlined style={{ color:'#1677ff', marginRight:8 }} />NAD 网络</span>} value={harvesterNads.length} valueStyle={{ fontSize: 24, fontWeight: 700 }} /></Card></Col>
                    <Col xs={24} sm={12} md={6}><Card size="small" variant="outlined" style={{ borderRadius: 8 }}><Statistic title={<span style={{ display:'flex', alignItems:'center' }}><ClusterOutlined style={{ color:'#1677ff', marginRight:8 }} />Kube-OVN VPC</span>} value={kubeOvnVpcs.length} valueStyle={{ fontSize: 24, fontWeight: 700 }} /></Card></Col>
                    <Col xs={24} sm={12} md={6}><Card size="small" variant="outlined" style={{ borderRadius: 8 }}><Statistic title={<span style={{ display:'flex', alignItems:'center' }}><NodeIndexOutlined style={{ color:'#1677ff', marginRight:8 }} />Kube-OVN 子网</span>} value={kubeOvnSubnets.length} valueStyle={{ fontSize: 24, fontWeight: 700 }} /></Card></Col>
                  </Row>
                </>
              )
            },

            {
              key: 'nodes',
              label: '节点',
              children: (
                <>
                  <NodesSection nodes={harvesterNodes} loading={loading || nodesLoading} onRefresh={refreshNodes} cloudId={cloudId} />
                  {showLog && (
                    <div style={{ marginTop: 12 }}>
                      <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(rawNodes, null, 2)}</pre>
                    </div>
                  )}
                </>
              )
            },
            {
              key: 'namespaces',
              label: '命名空间',
              children: <NamespacesTab cloudId={cloudId} namespaces={harvesterNamespaces} loading={loading} onRefresh={loadAll} showLog={showLog} raw={rawNamespaces} />
            },
            {
              key: 'ecs',
              label: '云主机',
              children: (
                <>
                  <VmSection
                    vms={ecs}
                    loading={loading}
                    namespacesOptions={namespacesOptions}
                    nodesOptions={nodesOptions}
                    cloudId={cloudId}
                    nsValue={nsFilter || undefined}
                    nodeValue={nodeFilter || undefined}
                    onNsChange={(v)=> setNsFilter(v || '')}
                    onNodeChange={(v)=> setNodeFilter(v || '')}
                    onRefresh={loadAll}
                    onOpenReconfigure={(r:any)=> { setVmReconfTarget(r); setVmReconfOpen(true); }}
                    onStart={async (iid:string)=>{ try { await startCloudProviderEcs(cloudId, iid); message.success('启动成功'); } catch(e:any){ message.error(e?.message||'启动失败'); } }}
                    onStop={async (iid:string)=>{ try { await stopCloudProviderEcs(cloudId, iid, false); message.success('停止成功'); } catch(e:any){ message.error(e?.message||'停止失败'); } }}
                    onReboot={async (iid:string)=>{ try { await rebootCloudProviderEcs(cloudId, iid, false); message.success('重启成功'); } catch(e:any){ message.error(e?.message||'重启失败'); } }}
                    onSoftReboot={async (iid:string)=>{ try { await softRebootCloudProviderEcs(cloudId, iid); message.success('软重启成功'); } catch(e:any){ message.error(e?.message||'软重启失败'); } }}
                    onPause={async (iid:string)=>{ try { await pauseCloudProviderEcs(cloudId, iid); message.success('暂停成功'); } catch(e:any){ message.error(e?.message||'暂停失败'); } }}
                    onUnpause={async (iid:string)=>{ try { await unpauseCloudProviderEcs(cloudId, iid); message.success('恢复成功'); } catch(e:any){ message.error(e?.message||'恢复失败'); } }}
                    onDelete={async (iid:string, deleteImage?: boolean)=>{ try { await deleteCloudProviderEcs(cloudId, iid, deleteImage); message.success('删除成功'); } catch(e:any){ message.error(e?.message||'删除失败'); } }}
                  />
                  <VmReconfigureModal open={vmReconfOpen} cloudId={cloudId} record={vmReconfTarget} onClose={()=>{ setVmReconfOpen(false); setVmReconfTarget(null); }} onOk={loadAll} storageClasses={harvesterStorageClasses} images={harvesterImages} gpuResources={harvesterGpuResources} />
                  {showLog && (
                    <div style={{ marginTop: 12 }}>
                      <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(rawEcs, null, 2)}</pre>
                    </div>
                  )}
                </>
              )
            },
            {
              key: 'images',
              label: '镜像',
              children: (
                <>
                  <ImagesSection cloudId={cloudId} images={harvesterImages} loading={loading} onRefresh={loadAll} />
                  {showLog && (
                    <div style={{ marginTop: 12 }}>
                      <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(rawImages, null, 2)}</pre>
                    </div>
                  )}
                </>
              )
            },
            {
              key: 'volumes',
              label: labelVolumes,
              children: (
                <>
                  <VolumesSection cloudId={cloudId} volumes={harvesterVolumes} loading={loading} vms={ecs} storageClasses={harvesterStorageClasses} onRefresh={loadAll} />
                  {showLog && (
                    <div style={{ marginTop: 12 }}>
                      <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(rawVolumes, null, 2)}</pre>
                    </div>
                  )}
                </>
              )
            },
            {
              key: 'storage_classes',
              label: '存储类',
              children: (
                <>
                  <StorageClassesSection cloudId={cloudId} storageClasses={harvesterStorageClasses} loading={loading} onRefresh={loadAll} />
                  {showLog && (
                    <div style={{ marginTop: 12 }}>
                      <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(harvesterStorageClasses, null, 2)}</pre>
                    </div>
                  )}
                </>
              )
            },
            {
              key: 'nad',
              label: labelNad,
              children: (
                <>
                  <NadsSection nads={harvesterNads} loading={loading} onRefresh={loadAll} />
                  {showLog && (
                    <div style={{ marginTop: 12 }}>
                      <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(rawNads, null, 2)}</pre>
                    </div>
                  )}
                </>
              )
            },
            {
              key: 'kubeovn_vpcs',
              label: labelKubeOvnVpcs,
              children: (
                <>
                  <KubeOvnVpcsSection vpcs={kubeOvnVpcs} subnets={kubeOvnSubnets} loading={loading} onRefresh={loadAll} />
                  {showLog && (
                    <div style={{ marginTop: 12 }}>
                      <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(rawVpcs, null, 2)}</pre>
                    </div>
                  )}
                </>
              )
            },
            {
              key: 'kubeovn_subnets',
              label: labelKubeOvnSubnets,
              children: (
                <>
                  <KubeOvnSubnetsSection subnets={kubeOvnSubnets} vpcList={kubeOvnVpcs} loading={loading} onRefresh={loadAll} />
                  {showLog && (
                    <div style={{ marginTop: 12 }}>
                      <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(rawSubnets, null, 2)}</pre>
                    </div>
                  )}
                </>
              )
            },
            {
              key: 'kubeovn_public_networks',
              label: 'Kube-OVN 公共网络',
              children: (
                <>
                  <KubeOvnPublicNetworksSection subnets={kubeOvnSubnets} loading={loading} onRefresh={loadAll} />
                  {showLog && (
                    <div style={{ marginTop: 12 }}>
                      <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(rawSubnets, null, 2)}</pre>
                    </div>
                  )}
                </>
              )
            },
            {
              key: 'gpu',
              label: 'GPU',
              children: (<GpusSection cloudId={cloudId} resources={harvesterGpuResources} onRefresh={refreshGpu} raw={rawGpu} showLog={showLog} />)
            }
          ]}
        />
    </PageDetailContainer>
  );
};

export default CloudDetailHarvester;
