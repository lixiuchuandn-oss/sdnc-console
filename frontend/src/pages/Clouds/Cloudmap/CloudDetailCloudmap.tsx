import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Tag, Space, Button, Statistic, Row, Col, Alert, Tabs, Descriptions, message, Dropdown } from 'antd';
import NodesSection from '../Harvester/sections/NodesSection';
import ImagesSection from '../Harvester/sections/ImagesSection';
import VolumesSection from '../Harvester/sections/VolumesSection';
import NadsSection from '../Harvester/sections/NadsSection';
import KubeOvnVpcsSection from '../Harvester/sections/KubeOvnVpcsSection';
import KubeOvnSubnetsSection from '../Harvester/sections/KubeOvnSubnetsSection';
import GpusSection from '../Harvester/sections/GpusSection';
import NamespacesTab from '../Harvester/sections/NamespacesTab';
import { CloudUploadOutlined, CloudServerOutlined, GlobalOutlined, HddOutlined, NodeIndexOutlined, CameraOutlined, ClusterOutlined, ArrowLeftOutlined, UnorderedListOutlined, HomeOutlined, DeploymentUnitOutlined, AppstoreOutlined } from '@ant-design/icons';
import PageDetailContainer from '../../../components/PageDetailContainer';
import { API_BASE_URL, fetchClouds, fetchCloudProviderEcs, fetchHarvesterNads, fetchHarvesterImages, fetchHarvesterVolumes, fetchHarvesterNodes, fetchHarvesterSystemPods, fetchHarvesterVmDetail, fetchKubeOvnVpcs, fetchKubeOvnSubnets, startCloudProviderEcs, stopCloudProviderEcs, deleteCloudProviderEcs, fetchHarvesterGpuResources, fetchHarvesterNamespaces } from '../../../services/api';
import VmDetailModal from '../Harvester/modals/VmDetailModal';
import VmReconfigureModal from '../Harvester/modals/VmReconfigureModal';
import VmSection from '../Harvester/sections/VmSection';

interface CloudItem { id: string; name: string; region: string; type: string; config?: any; status?: string; endpoint?: string; description?: string; createdAt?: string; updatedAt?: string; }

const CloudDetailCloudmap: React.FC<{ cloudId: string; defaultProvider?: string }> = ({ cloudId, defaultProvider }) => {
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
  const [vmDetailOpen, setVmDetailOpen] = useState(false);
  const [vmDetail, setVmDetail] = useState<any | null>(null);
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

  const loadAll = async () => {
    setLoading(true);
    setError(null);
    try {
      const cloudsRes = await fetchClouds();
      const cloudList: any[] = Array.isArray(cloudsRes) ? cloudsRes : (Array.isArray((cloudsRes as any)?.data) ? (cloudsRes as any).data : []);
      setCloud((cloudList || []).find((c:any)=> String(c.id) === String(cloudId)) || null);
      const [ecsJson, nadsJson, imagesJson, volsJson, nodesJson, podsJson, vpcsJson, subsJson, gpuJson, nsJson] = await Promise.all([
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
          try {
            setVmDetail((prev:any)=>{
              if (!prev) return prev;
              const ns = String(prev?.metadata?.namespace || '');
              const name = String(prev?.metadata?.name || '');
              const currIid = ns && name ? `${ns}/${name}` : String(prev?.InstanceId || '');
              const it = items.find((x:any)=> String(x?.InstanceId||x?.id||'') === currIid);
              if (it && it.Extra) return { ...prev, Extra: it.Extra };
              return prev;
            });
          } catch {}
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
          if (!iid) return;
          setEcs(prev => (prev || []).map((x:any)=> {
            const xiid = String(x?.InstanceId||x?.id||'');
            if (xiid === iid) return { ...x, Status: status, status };
            return x;
          }));
          try {
            setVmDetail((prev:any)=>{
              if (!prev) return prev;
              const ns = String(prev?.metadata?.namespace || '');
              const name = String(prev?.metadata?.name || '');
              const currIid = ns && name ? `${ns}/${name}` : String(prev?.InstanceId || '');
              if (currIid === iid) {
                const newStatus = { ...(prev?.status || {}), printableStatus: status || (prev?.status?.printableStatus || prev?.status?.phase), phase: status || (prev?.status?.phase || prev?.status?.printableStatus) };
                return { ...prev, status: newStatus };
              }
              return prev;
            });
          } catch {}
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
  
  const providerRaw = useMemo(() => String(cloud?.config?.provider || defaultProvider || ''), [cloud, defaultProvider]);
  const provider = useMemo(() => providerRaw.toLowerCase(), [providerRaw]);
  // Always true for Cloudmap component
  const isCloudmap = true;
  const providerName = 'Cloudmap';
  
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
      subtitle="Cloudmap 详情（独立页面），汇总平台内资源与网络"
      overviewContent={(
        <Descriptions bordered size="small" column={4}>
          <Descriptions.Item label="资源名称">{cloud?.name || '-'}</Descriptions.Item>
          <Descriptions.Item label="资源供应商">{providerName}</Descriptions.Item>
          <Descriptions.Item label="资源地域">{cloud?.region || '-'}</Descriptions.Item>
          <Descriptions.Item label="资源类型">{cloud?.type || '-'}</Descriptions.Item>
          <Descriptions.Item label="资源状态">{cloud?.status === 'online' ? <Tag color="green">在线</Tag> : cloud?.status === 'maintenance' ? <Tag color="orange">维护</Tag> : cloud?.status === 'offline' ? <Tag color="red">离线</Tag> : <Tag>未知</Tag>}</Descriptions.Item>
          <Descriptions.Item label="Endpoint">{cloud?.endpoint || '-'}</Descriptions.Item>
          <Descriptions.Item label="版本">{versionText}</Descriptions.Item>
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
                  <NodesSection nodes={harvesterNodes} loading={loading} />
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
              children: <NamespacesTab cloudId={cloudId} showLog={showLog} />
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
                    onOpenDetail={async (r:any)=>{
                      const iid = String(r?.InstanceId || r?.id || '');
                      setVmDetail(r);
                      setVmDetailOpen(true);
                      try {
                        const ns = iid.includes('/') ? iid.split('/')[0] : '';
                        const name = iid.includes('/') ? iid.split('/')[1] : '';
                        if (ns && name) {
                          const json = await fetchHarvesterVmDetail(cloudId, ns, name);
                          setVmDetail((prev:any)=> ({ ...(((json as any)?.data || json) as any), Extra: (prev as any)?.Extra || (r as any)?.Extra }));
                        }
                      } catch {}
                    }}
                    onOpenReconfigure={(r:any)=> { setVmReconfTarget(r); setVmReconfOpen(true); }}
                    onStart={async (iid:string)=>{ try { await startCloudProviderEcs(cloudId, iid); message.success('启动成功'); } catch(e:any){ message.error(e?.message||'启动失败'); } }}
                    onStop={async (iid:string)=>{ try { await stopCloudProviderEcs(cloudId, iid, false); message.success('停止成功'); } catch(e:any){ message.error(e?.message||'停止失败'); } }}
                    onReboot={async (iid:string)=>{ try { await startCloudProviderEcs(cloudId, iid); message.success('重启指令已发送（请手动确认）'); } catch(e:any){ message.error(e?.message||'重启失败'); } }}
                    onDelete={async (iid:string, deleteImage?: boolean)=>{ try { await deleteCloudProviderEcs(cloudId, iid, deleteImage); message.success('删除成功'); } catch(e:any){ message.error(e?.message||'删除失败'); } }}
                  />
                  <VmDetailModal open={vmDetailOpen} cloudId={cloudId} vm={vmDetail} volumes={harvesterVolumes} onClose={() => { setVmDetailOpen(false); setVmDetail(null); }} onRefreshAll={loadAll} />
                  <VmReconfigureModal open={vmReconfOpen} cloudId={cloudId} record={vmReconfTarget} onClose={()=>{ setVmReconfOpen(false); setVmReconfTarget(null); }} onOk={loadAll} />
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
                  <VolumesSection cloudId={cloudId} volumes={harvesterVolumes} loading={loading} vms={ecs} onRefresh={loadAll} />
                  {showLog && (
                    <div style={{ marginTop: 12 }}>
                      <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(rawVolumes, null, 2)}</pre>
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
                  <NadsSection nads={harvesterNads} loading={loading} />
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
                  <KubeOvnVpcsSection vpcs={kubeOvnVpcs} loading={loading} />
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
                  <KubeOvnSubnetsSection subnets={kubeOvnSubnets} loading={loading} />
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

export default CloudDetailCloudmap;
