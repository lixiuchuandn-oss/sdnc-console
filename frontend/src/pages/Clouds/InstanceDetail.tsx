import React, { useEffect, useMemo, useState } from 'react';
import { Card, Descriptions, Divider, Empty, message, Space, Spin, Table, Tabs, Tag, Typography } from 'antd';
import PageContainer from '../../components/PageContainer';
import { useNavigate, useParams } from 'react-router-dom';
import { fetchClouds, fetchCloudProviderEcs, fetchInventoryInstancesByCloud } from '../../services/api';
import { fetchCloudProviderEnis } from '../../services/aliyunApi';
import { cnVmStatus } from '../../utils/harvesterUtils';

const InstanceDetail: React.FC = () => {
  const navigate = useNavigate();
  const { id, instanceId } = useParams();
  const cloudId = id as string;
  const [clouds, setClouds] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [instance, setInstance] = useState<any | null>(null);
  const [enis, setEnis] = useState<any[]>([]);
  const [provider, setProvider] = useState<string>('');

  useEffect(() => {
    const initClouds = async () => {
      try {
        const list = await fetchClouds();
        setClouds(Array.isArray(list) ? list : []);
        const c = (Array.isArray(list) ? list : []).find((x:any)=> x.id === cloudId);
        const p = String(c?.config?.provider || c?.type || '').toLowerCase();
        setProvider(p);
      } catch {}
    };
    initClouds();
  }, [cloudId]);

  const loadInstance = async () => {
    if (!cloudId || !instanceId) return;
    setLoading(true);
    setError(null);
    try {
      let data: any | null = null;
      // 优先使用库存聚合接口，字段更统一
      try {
        const inv: any = await fetchInventoryInstancesByCloud(cloudId);
        const list: any[] = Array.isArray(inv?.data) ? inv.data : [];
        const hit = list.find((it:any)=> String(it?.id || it?.InstanceId || '').trim() === String(instanceId).trim());
        if (hit) data = hit;
      } catch {}
      // 回退到直连接口，兼容非库存场景
      if (!data) {
        const json: any = await fetchCloudProviderEcs(cloudId);
        const p = String(provider || (clouds.find((c:any)=>c.id===cloudId)?.config?.provider || '')).toLowerCase();
        let list: any[] = [];
        if (p === 'tencentcloud') {
          list = json?.data?.Instances?.Instance || json?.data?.InstanceSet || [];
        } else if (p === 'huaweicloud') {
          list = json?.data?.servers || [];
        } else if (p === 'harvester') {
          list = json?.data?.Instances?.Instance || [];
        } else {
          list = json?.data?.Instances?.Instance || [];
        }
        const hit = list.find((it:any)=> String(it?.InstanceId || it?.id || it?.name || '').trim() === String(instanceId).trim());
        data = hit || null;
      }
      setInstance(data);
    } catch (e:any) {
      setError(e?.message || '查询失败');
    } finally {
      setLoading(false);
    }
  };

  const loadEnis = async () => {
    if (!cloudId || !instanceId) return;
    try {
      const json: any = await fetchCloudProviderEnis(cloudId, { instanceId });
      const list: any[] = json?.data?.NetworkInterfaces?.NetworkInterface || json?.data?.enis || [];
      setEnis(Array.isArray(list) ? list : []);
    } catch {}
  };

  useEffect(() => { loadInstance(); }, [cloudId, instanceId, provider]);
  useEffect(() => { loadEnis(); }, [cloudId, instanceId]);

  const titleText = useMemo(() => {
    const cloud = clouds.find((c:any)=> c.id === cloudId);
    const prov = String(cloud?.config?.provider || cloud?.type || '').toLowerCase();
    const provName = (prov === 'aliyun' && '阿里云') || (prov === 'huaweicloud' && '华为云') || (prov === 'tencentcloud' && '腾讯云') || (prov === 'harvester' && 'Harvester') || prov || '未知厂商';
    const name = (instance?.name || instance?.InstanceName || instanceId) as string;
    return `${provName} · ${cloud?.name || cloudId} · ${name}`;
  }, [clouds, cloudId, instance, instanceId]);

  const Overview = () => (
    <Descriptions bordered column={2} size="small">
      <Descriptions.Item label="实例ID">{instanceId}</Descriptions.Item>
      <Descriptions.Item label="实例名">{instance?.name || instance?.InstanceName || '-'}</Descriptions.Item>
      <Descriptions.Item label="状态">{cnVmStatus(instance?.status || instance?.Status)}</Descriptions.Item>
      <Descriptions.Item label="规格">{instance?.instanceType || instance?.InstanceType || '-'}</Descriptions.Item>
      <Descriptions.Item label="可用区">{instance?.zoneId || instance?.ZoneId || '-'}</Descriptions.Item>
      <Descriptions.Item label="VPC">{(instance?.extra?.vpcName || instance?.VpcId || instance?.VpcAttributes?.VpcId || '-') as any}</Descriptions.Item>
      <Descriptions.Item label="私网IP">{Array.isArray(instance?.privateIps) ? instance.privateIps.join(', ') : (instance?.VpcAttributes?.PrivateIpAddress?.IpAddress || '-')}</Descriptions.Item>
      <Descriptions.Item label="创建时间">{instance?.createdAt || instance?.CreationTime || '-'}</Descriptions.Item>
    </Descriptions>
  );

  const EnisTable = () => (
    <Table
      size="small"
      rowKey={(r:any)=> r.NetworkInterfaceId || r.id}
      columns={[
        { title: 'ENI ID', dataIndex: 'NetworkInterfaceId', key: 'id' },
        { title: '名称', dataIndex: 'NetworkInterfaceName', key: 'name' },
        { title: '私网IP', key: 'ips', render: (_:any, r:any)=> (Array.isArray(r?.PrivateIpAddress?.IpAddress) ? r.PrivateIpAddress.IpAddress.join(', ') : '-') },
        { title: 'VPC', dataIndex: 'VpcId', key: 'vpc' },
        { title: '子网', dataIndex: 'VSwitchId', key: 'vsw' },
        { title: '状态', dataIndex: 'Status', key: 'status', render:(s:string)=> (<Tag color={s==='Available'?'green':'blue'}>{s||'-'}</Tag>) },
      ] as any}
      dataSource={enis}
      pagination={false}
    />
  );

  const HarvesterDetail = () => {
    const nsName = String(instanceId || '');
    const [detail, setDetail] = useState<any | null>(null);
    const [loading2, setLoading2] = useState<boolean>(false);
    useEffect(() => {
      const run = async () => {
        if (!cloudId || !nsName.includes('/')) return;
        setLoading2(true);
        try {
          const token = localStorage.getItem('token');
          const [ns, name] = nsName.split('/');
          const res = await fetch(`/api/clouds/${encodeURIComponent(cloudId)}/resources/harvester/vms/${encodeURIComponent(ns)}/${encodeURIComponent(name)}`, {
            method: 'GET', headers: { 'Content-Type':'application/json', 'Authorization': token ? `Bearer ${token}` : '' }, credentials: 'include'
          });
          const json = await res.json();
          setDetail(json?.data || json || null);
        } catch (e:any) {
          message.warning(e?.message || 'Harvester 详情查询失败');
        } finally {
          setLoading2(false);
        }
      };
      run();
    }, [cloudId, nsName]);

    if (loading2) return (<Spin />);
    if (!detail) return (<Empty description="暂无详情" />);
    const spec = detail?.spec || {};
    const tmpl = spec?.template?.spec || {};
    const status = detail?.status || {};
    const vols: any[] = Array.isArray(tmpl?.volumes) ? tmpl.volumes : [];
    const ifs: any[] = Array.isArray(tmpl?.interfaces) ? tmpl.interfaces : [];
    return (
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        <Card size="small" title="基础信息">
          <Descriptions bordered column={2} size="small">
            <Descriptions.Item label="命名空间">{detail?.metadata?.namespace || '-'}</Descriptions.Item>
            <Descriptions.Item label="名称">{detail?.metadata?.name || '-'}</Descriptions.Item>
            <Descriptions.Item label="状态">{cnVmStatus(status?.printableStatus || status?.phase)}</Descriptions.Item>
            <Descriptions.Item label="节点">{status?.nodeName || '-'}</Descriptions.Item>
            <Descriptions.Item label="镜像">{(() => { const ann = detail?.metadata?.annotations || {}; const volTpl = ann['harvesterhci.io/volumeClaimTemplates']; return volTpl ? '模板中包含镜像PVC' : '-' })()}</Descriptions.Item>
          </Descriptions>
        </Card>
        <Card size="small" title="磁盘与卷">
          <Table size="small" rowKey={(r:any)=> r.name} columns={[
            { title:'名称', dataIndex:'name', key:'name' },
            { title:'类型', key:'type', render: (_:any,r:any)=> ((r?.disk || r?.cdrom) ? 'DISK' : '其他') },
            { title:'总线', key:'bus', render: (_:any,r:any)=> r?.cdrom?.bus || r?.disk?.bus || '-' },
          ] as any} dataSource={Array.isArray(tmpl?.domain?.devices?.disks) ? tmpl.domain.devices.disks : []} pagination={false} />
          <Divider />
          <Table size="small" rowKey={(r:any)=> r.name} columns={[
            { title:'名称', dataIndex:'name', key:'name' },
            { title:'挂载', key:'mount', render: (_:any,r:any)=> (r?.dataVolume ? `DataVolume: ${r?.dataVolume?.name}` : (r?.persistentVolumeClaim ? `PVC: ${r?.persistentVolumeClaim?.claimName}` : (r?.cloudInitNoCloud?'CloudInit':'-'))) },
          ] as any} dataSource={vols} pagination={false} />
        </Card>
        <Card size="small" title="网络接口">
          <Table size="small" rowKey={(r:any)=> r.name} columns={[
            { title:'名称', dataIndex:'name', key:'name' },
            { title:'模型', dataIndex:'model', key:'model' },
            { title:'模式', key:'mode', render: (_:any,r:any)=> (r?.masquerade ? 'masquerade' : (r?.bridge ? 'bridge' : 'pod')) },
          ] as any} dataSource={ifs} pagination={false} />
        </Card>
      </Space>
    );
  };

  return (
    <PageContainer title={titleText} asCard={false} hideHeader pagePadding={12}>
      {error && (<Card size="small" style={{ marginBottom: 12 }}><Typography.Text type="danger">{error}</Typography.Text></Card>)}
      {loading ? (<Spin />) : (!instance ? (<Empty description="未找到实例" />) : (
        <Tabs
          defaultActiveKey="overview"
          items={[
            { key:'overview', label:'概览', children:(<Overview />) },
            ...(provider === 'harvester' ? [{ key:'harvester', label:'Harvester 详情', children:(<HarvesterDetail />) }] : []),
            ...(provider !== 'harvester' ? [{ key:'network', label:'网络接口', children:(<EnisTable />) }] : []),
          ]}
        />
      ))}
    </PageContainer>
  );
};

export default InstanceDetail;
