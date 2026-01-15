import React, { useState, useEffect } from 'react';
import { 
  Card, Row, Col, Button, Tag, Modal, Form, Input, Select, Switch,
  message, Space, Tooltip, Typography, Dropdown, Badge
} from 'antd';
import { 
  UnorderedListOutlined,
  EllipsisOutlined,
  CloudUploadOutlined,
  CloudServerOutlined,
  ClusterOutlined,
  HddOutlined,
  DatabaseOutlined,
  CodepenOutlined,
  SafetyCertificateOutlined
} from '@ant-design/icons';
import axios from 'axios';
import { fetchAllInstances, fetchCloudProviderVpcs, fetchKubeOvnVpcs, fetchInventoryInstancesByCloud, fetchCloudmapVirtualElements, fetchClouds as fetchCloudsApi } from '../../services/api';
import PageContainer from '../../components/PageContainer';
import SharedToolbar from '../../components/SharedToolbar';
 
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import CloudWizard from './CloudWizard';
 
import '../common/filters.css';

 

const MetricCard:React.FC<{title:string;total:number;unit?:string;used:number;midLabel:string;midValue:number;mainColor:string;usedLabel?:string}> = ({title,total,unit='',used,midLabel,midValue,mainColor,usedLabel})=>{
  const remain = Math.max(total-used-midValue,0);
  const percent = total? used/total*100:0;
  const trail='#d8dee8';
  return (
    <Card styles={{ body: { padding:12 } }} style={{ borderRadius:6 }}>
      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8 }}>
        <span style={{ fontWeight:600, fontSize:13 }}>{title}</span>
        <span style={{ color:'#8c8c8c', fontSize:12 }}>总{unit} {total}{unit}</span>
      </div>
      <div style={{ height:8, background:trail, borderRadius:4, overflow:'hidden', marginBottom:8 }}>
        <div style={{ width:`${percent}%`, height:'100%', background:mainColor }} />
      </div>
      <div style={{ display:'flex' }}>
        {[ 
          {label:usedLabel || '已用',value:used,color:mainColor},
          {label:midLabel,value:midValue,color:'#8c8c8c'},
          ...(remain>0? [{label:'剩余',value:remain,color:'#8c8c8c'}]:[])
        ].map((m,i,arr)=>(
          <div key={i} style={{ flex:1, padding:'8px 12px', background:'#fff', borderRight:i< arr.length-1?'1px solid #f0f0f0':'none' }}>
            <div style={{ display:'flex', alignItems:'center', gap:3, fontSize:12, marginBottom:2 }}>
              <span style={{ width:8, height:8, background:m.color, borderRadius:2 }} /> {m.label}
            </div>
            <div style={{ fontSize:24, fontWeight:700, color:'#1f1f1f', lineHeight:1 }}>{m.value}{unit && <span style={{ fontSize:12, color:'#8c8c8c', marginLeft:3 }}>{unit}</span>}</div>
          </div>
        ))}
      </div>
    </Card>
  );
};

const { Text } = Typography;

interface Cloud {
  id: string;
  name: string;
  description: string;
  type: 'central' | 'private' | 'edge' | 'virtualization' | 'object_storage' | 'security_pool' | 'sase_gateway' | 'hybrid';
  status: 'online' | 'offline' | 'maintenance';
  region: string;
  endpoint: string;
  accessKey?: string;
  secretKey?: string;
  config?: any;
  totalCpu: number;
  usedCpu: number;
  totalMemory: number;
  usedMemory: number;
  totalStorage: number;
  usedStorage: number;
  createdBy?: string;
  lastTestAt?: string;
  createdAt: string;
  updatedAt: string;
  computeResources?: ComputeResource[];
}

interface ComputeResource {
  id: string;
  name: string;
  description?: string;
  type: 'virtual_machine' | 'container' | 'bare_metal' | 'file_storage' | 'parallel_file_storage' | 'object_storage';
  status: 'running' | 'stopped' | 'starting' | 'stopping' | 'error';
  cloudId: string;
  cpu: number;
  memory: number;
  storage: number;
  config?: any;
  metadata?: any;
  ipAddress?: string;
  publicIp?: string;
  createdAt: string;
  updatedAt: string;
}

const Clouds: React.FC = () => {
  const navigate = useNavigate();
  const [clouds, setClouds] = useState<Cloud[]>([]);
  const [loading, setLoading] = useState(false);
  const [wizardVisible, setWizardVisible] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingCloud, setEditingCloud] = useState<Cloud | null>(null);
  const [testingConnection, setTestingConnection] = useState<string | null>(null);
  const [vmStats, setVmStats] = useState<{ total: number; online: number; offline: number }>({ total: 0, online: 0, offline: 0 });
  const [vpcStats, setVpcStats] = useState<{ total: number; online: number; offline: number }>({ total: 0, online: 0, offline: 0 });
  
  const [filterForm] = Form.useForm();
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<string[]|undefined>(undefined);
  const [typeFilter, setTypeFilter] = useState<string[]|undefined>(undefined);
  const [vendorFilter, setVendorFilter] = useState<string|undefined>(undefined);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  
  
  const [form] = Form.useForm();
  const { user } = useAuth();

  const hasAdminPermission = user?.role === 'super_admin';

  

  useEffect(() => {
    fetchClouds();
  }, []);

  useEffect(() => {
    const loadVmStats = async () => {
      try {
        const cloudList: any[] = Array.isArray(clouds) && clouds.length > 0
          ? clouds
          : (Array.isArray(await fetchCloudsApi()) ? await fetchCloudsApi() : []);
        if (!Array.isArray(cloudList) || cloudList.length === 0) {
          setVmStats({ total: 0, online: 0, offline: 0 });
          return;
        }
        const cloudIds: string[] = cloudList.slice(0, 10).map((c: any) => c.id);
        let total = 0;
        let online = 0;
        const results = await Promise.allSettled(
          cloudIds.map((id: string) => {
            const cloud = cloudList.find((c: any) => c.id === id);
            const providerRaw = String(cloud?.config?.provider || '');
            if (providerRaw === 'cloudmap.csm') {
              return fetchCloudmapVirtualElements(id);
            }
            return fetchInventoryInstancesByCloud(id);
          })
        );
        results.forEach((res: any) => {
          if (res.status !== 'fulfilled') return;
          const raw = res.value;
          const list: any[] =
            Array.isArray(raw?.data) ? raw.data :
            Array.isArray(raw?.items) ? raw.items :
            Array.isArray(raw?.data?.items) ? raw.data.items :
            Array.isArray(raw) ? raw : [];
          total += list.length;
          online += list.filter((item: any) => {
            const rawStatus = item?.status ?? (item as any)?.Status ?? (item as any)?.state;
            const s = String(rawStatus || '').toLowerCase();
            if (!s) return false;
            if (s.includes('run')) return true;
            if (s === 'active' || s === 'on' || s === '1') return true;
            if (item.status === 1) return true;
            return false;
          }).length;
        });
        setVmStats({ total, online, offline: Math.max(0, total - online) });
      } catch {
        setVmStats({ total: 0, online: 0, offline: 0 });
      }
    };
    loadVmStats();
  }, [clouds]);

  useEffect(() => {
    const loadVpcStats = async () => {
      try {
        const ids = (clouds || []).map(c => c.id);
        const results = await Promise.all(ids.map(async id => {
          try {
            const prov = String((clouds.find(c => c.id === id)?.config?.provider) || '').toLowerCase();
            if (prov === 'harvester') {
              const json: any = await fetchKubeOvnVpcs(id);
              const list: any[] = Array.isArray(json?.data?.items) ? json.data.items : Array.isArray(json?.items) ? json.items : [];
              return Array.isArray(list) ? list : [];
            }
            const json: any = await fetchCloudProviderVpcs(id);
            const list: any[] = json?.data?.Vpcs?.Vpc || json?.data?.vpcs || json?.vpcs || [];
            return Array.isArray(list) ? list : [];
          } catch {
            return [];
          }
        }));
        const flat = results.flat();
        const total = flat.length;
        const norm = (s: any) => String(s || '').toLowerCase();
        const online = flat.filter(r => ['available','active','ok','running','enabled'].includes(norm(r?.Status || r?.status))).length;
        setVpcStats({ total, online, offline: Math.max(0, total - online) });
      } catch {
        setVpcStats({ total: 0, online: 0, offline: 0 });
      }
    };
    if (clouds.length > 0) loadVpcStats();
  }, [clouds]);

  const fetchClouds = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get('/api/clouds', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setClouds(response.data);
    } catch (error: any) {
      message.error('获取云资源列表失败：' + (error.response?.data?.message || error.message));
    } finally {
      setLoading(false);
    }
  };

  // 已移除算力配额相关方法

  const testConnection = async (cloudId: string) => {
    setTestingConnection(cloudId);
    try {
      const token = localStorage.getItem('token');
      const response = await axios.post(`/api/clouds/${cloudId}/test`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      message.success(response.data.message);
      fetchClouds(); // 刷新列表以更新状态
    } catch (error: any) {
      message.error('连接测试失败：' + (error.response?.data?.message || error.message));
    } finally {
      setTestingConnection(null);
    }
  };

  

  const getStatusText = (status: string) => {
    switch (status) {
      case 'online': return '在线';
      case 'offline': return '离线';
      case 'maintenance': return '维护中';
      default: return '未知';
    }
  };

  const getTypeText = (type: string) => {
    switch (type) {
      case 'central': return '公有云';
      case 'private': return '私有云';
      case 'edge': return '边缘计算';
      case 'virtualization': return '虚拟化';
      case 'object_storage': return '对象存储';
      case 'security_pool': return '云安全资源池';
      case 'sase_gateway': return 'SASE网关';
      case 'hybrid': return '混合云';
      default: return '未知';
    }
  };

  const getTypeIcon = (type?: string): React.ReactNode => {
    const t = String(type || '').toLowerCase();
    switch (t) {
      case 'central':
        return <CloudUploadOutlined />;
      case 'private':
        return <CloudServerOutlined />;
      case 'edge':
        return <CloudServerOutlined />;
      case 'virtualization':
        return <HddOutlined />;
      case 'object_storage':
        return <DatabaseOutlined />;
      case 'security_pool':
        return <CloudServerOutlined />;
      case 'sase_gateway':
        return <ClusterOutlined />;
      case 'hybrid':
        return <CloudUploadOutlined />;
      default:
        return <CloudUploadOutlined />;
    }
  };

  

  const getProviderInfo = (config: any) => {
    if (!config?.provider) return { name: '未知', logo: <CodepenOutlined /> };
    
    const providerMap: Record<string, { name: string; logo: React.ReactNode }> = {
      aliyun: { name: '阿里云', logo: <CodepenOutlined /> },
      aws: { name: 'AWS', logo: <CodepenOutlined /> },
      azure: { name: 'Azure', logo: <CodepenOutlined /> },
      huaweicloud: { name: '华为云', logo: <CodepenOutlined /> },
      tencentcloud: { name: '腾讯云', logo: <CodepenOutlined /> },
      ucloud: { name: 'UCloud', logo: <CodepenOutlined /> },
      google: { name: 'Google Cloud', logo: <CodepenOutlined /> },
      tianyi: { name: '天翼云', logo: <CodepenOutlined /> },
      yidong: { name: '移动云', logo: <CodepenOutlined /> },
      vmware: { name: 'VMware', logo: <CodepenOutlined /> },
      openstack: { name: 'OpenStack', logo: <CodepenOutlined /> },
      dstack: { name: 'DStack', logo: <CodepenOutlined /> },
      zstack: { name: 'ZStack', logo: <CodepenOutlined /> },
      feitiancloud: { name: '飞天', logo: <CodepenOutlined /> },
      s3: { name: 'S3', logo: <CodepenOutlined /> },
      ceph: { name: 'Ceph', logo: <CodepenOutlined /> },
      sky: { name: 'SKY', logo: <CodepenOutlined /> },
      builtinprivate: { name: '内置私有云', logo: <CodepenOutlined /> },
      kvm: { name: 'KVM', logo: <CodepenOutlined /> },
      rancher: { name: 'Rancher', logo: <CodepenOutlined /> },
      harvester: { name: 'Harvester', logo: <CodepenOutlined /> },
      'cloudmap.edge': { name: 'Cloudmap融合边缘云', logo: <CloudServerOutlined /> },
      'cloudmap.private': { name: 'Cloudmap私有云', logo: <CloudServerOutlined /> },
      'cloudmap.csm': { name: 'Cloudmap CSM', logo: <SafetyCertificateOutlined /> },
      parallel_file_storage: { name: '高速并行文件存储', logo: <CodepenOutlined /> },
    };

    return providerMap[config.provider] || { name: '未知', logo: <CodepenOutlined /> };
  };

  // 根据云厂商返回认证字段标签
  const getCredentialLabels = (provider?: string) => {
    switch (provider) {
      case 'aliyun':
        return { akLabel: 'AccessKeyId', skLabel: 'AccessKeySecret', akPlaceholder: '请输入 AccessKeyId', skPlaceholder: '请输入 AccessKeySecret' };
      case 'huaweicloud':
        return { akLabel: '访问密钥（Access Key）', skLabel: '私有密钥（Secret Key）', akPlaceholder: '请输入访问密钥（Access Key）', skPlaceholder: '请输入私有密钥（Secret Key）' };
      case 'tencentcloud':
        return { akLabel: '密钥ID（SecretId）', skLabel: '私有密钥（SecretKey）', akPlaceholder: '请输入密钥ID（SecretId）', skPlaceholder: '请输入私有密钥（SecretKey）' };
      case 'harvester':
      case 'cloudmap':
        return { akLabel: '访问密钥（可选）', skLabel: 'API令牌（Token）', akPlaceholder: 'Harvester通常无需 Access Key', skPlaceholder: '请输入 API 令牌（Bearer Token）' };
      default:
        return { akLabel: '访问密钥 (Access Key)', skLabel: '私有密钥 (Secret Key)', akPlaceholder: '请输入访问密钥', skPlaceholder: '请输入私有密钥' };
    }
  };

  // 编辑模态框样式：分组标题与表单标签/输入字号
  const groupTitleStyle: React.CSSProperties = {
    fontSize: 13,
    fontWeight: 400,
    color: '#1677ff',
    margin: '8px 0',
    paddingBottom: 6,
    borderBottom: '1px solid #e5e7eb'
  };
  const titleLabelStyle: React.CSSProperties = { fontSize: 13, fontWeight: 400 };
  const inputStyle: React.CSSProperties = { fontSize: 13 };

  const handleEdit = (cloud: Cloud) => {
    if (!hasAdminPermission) {
      message.error('权限不足，只有超级管理员可以编辑云资源');
      return;
    }
    setEditingCloud(cloud);
    form.setFieldsValue({
      name: cloud.name,
      description: cloud.description,
      region: cloud.region,
      endpoint: cloud.endpoint,
      accessKey: '', // 不预填敏感信息
      secretKey: '',
      // 高级参数（从 config 预填）
      autoSync: !!cloud?.config?.autoSync,
      enableSSO: !!cloud?.config?.enableSSO,
      ignoreTls: !!cloud?.config?.ignoreTls,
      proxyType: cloud?.config?.proxyType || 'direct',
      resourceProject: cloud?.config?.resourceProject || 'system',
      harvesterVersion: cloud?.config?.harvesterVersion || 'auto'
    });
    setEditModalVisible(true);
  };

  const handleDelete = (cloudId: string) => {
    if (!hasAdminPermission) {
      message.error('权限不足，只有超级管理员可以删除云资源');
      return;
    }
    
    Modal.confirm({
      title: '确认删除',
      content: '确定要删除这个云资源吗？如果有关联的计算资源，将无法删除。',
      okText: '确定',
      cancelText: '取消',
      onOk: async () => {
        try {
          const token = localStorage.getItem('token');
          await axios.delete(`/api/clouds/${cloudId}`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          message.success('云资源删除成功');
          fetchClouds();
        } catch (error: any) {
          message.error('删除失败：' + (error.response?.data?.message || error.message));
        }
      },
    });
  };

  const handleEditSubmit = async (values: any) => {
    try {
      const token = localStorage.getItem('token');
      
      // 过滤掉空的accessKey和secretKey
      const submitData: any = {
        name: values.name,
        description: values.description,
        region: values.region,
        endpoint: values.endpoint,
      };
      if (values.accessKey) submitData.accessKey = values.accessKey;
      if (values.secretKey) submitData.secretKey = values.secretKey;
      // 合并更新 config（保持 provider 不变）
      const prevCfg = (editingCloud as any)?.config || {};
      submitData.config = {
        ...prevCfg,
        autoSync: !!values.autoSync,
        enableSSO: !!values.enableSSO,
        ignoreTls: !!values.ignoreTls,
        proxyType: values.proxyType || prevCfg.proxyType || 'direct',
        resourceProject: values.resourceProject || prevCfg.resourceProject || 'system',
        harvesterVersion: values.harvesterVersion || prevCfg.harvesterVersion || 'auto',
        provider: prevCfg.provider
      };
      
      await axios.put(`/api/clouds/${editingCloud?.id}`, submitData, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      message.success('云资源更新成功');
      setEditModalVisible(false);
      setEditingCloud(null);
      form.resetFields();
      fetchClouds();
    } catch (error: any) {
      message.error('更新失败：' + (error.response?.data?.message || error.message));
    }
  };

  

  const formatLastTestTime = (lastTestAt?: string) => {
    if (!lastTestAt) return '未测试';
    const date = new Date(lastTestAt);
    return date.toLocaleString('zh-CN');
  };

  const tableColumns = [
    {
      title: '云平台',
      dataIndex: 'config',
      key: 'provider',
      width: 220,
      fixed:'left' as 'left',
      render: (config: any, record: Cloud) => {
        const provider = getProviderInfo(config);
        return (
          <Tooltip title={record.name}>
            <div style={{ whiteSpace:'nowrap' }}>
              <span style={{ display:'inline-flex', alignItems:'center', lineHeight:1 }}>
                <span style={{ fontSize: 16, marginRight: 6, display:'inline-flex', alignItems:'center', color:'#1677ff' }}>{getTypeIcon(record.type)}</span>
                <Button type="link" style={{ padding:0, height:'auto', lineHeight:1, fontSize: 13 }} onClick={()=>navigate(`/admin/clouds/${record.id}`)}>{record.name}</Button>
              </span><br/>
              <Text type="secondary" style={{ fontSize: 13 }}>{provider.name}</Text>
            </div>
          </Tooltip>
        );
      }
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => (
        <Badge
          status={status==='online' ? 'processing' : status==='offline' ? 'error' : 'warning'}
          text={<span style={{ fontSize: 13 }}>{getStatusText(status)}</span>}
        />
      )
    },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      render: (type: string) => <Tag color="blue" style={{ fontSize: 13 }}>{getTypeText(type)}</Tag>
    },
    {
      title: '地域',
      dataIndex: 'region',
      key: 'region',
      width: 400,
      render: (_: any, record: Cloud) => (
        <div style={{ fontSize: 13 }}>
          <div>地域信息：{record?.region || '-'}</div>
          <div>端点信息：{record?.endpoint || '-'}</div>
        </div>
      )
    },
    
    {
      title: '最后测试',
      dataIndex: 'lastTestAt',
      key: 'lastTestAt',
      render: (lastTestAt: string) => <Text style={{ fontSize: 13 }}>{formatLastTestTime(lastTestAt)}</Text>
    },
  {
      title: '操作',
      key: 'actions',
      width: 60,
      render: (record: Cloud) => {
        const items = [
          { key: 'test', label: '连接测试', disabled: !hasAdminPermission || testingConnection===record.id },
          { key: 'detail', label: '资源详情' },
          { key: 'edit', label: '编辑', disabled: !hasAdminPermission },
          { key: 'del', label: '删除', danger: true, disabled: !hasAdminPermission },
        ];
        const onMenuClick = ({ key }: { key: string }) => {
          if (key === 'test') return testConnection(record.id);
          if (key === 'detail') return navigate(`/admin/clouds/${record.id}`);
          if (key === 'edit') return handleEdit(record);
          if (key === 'del') return handleDelete(record.id);
        };
        return (
          <Dropdown menu={{ items, onClick: onMenuClick }} trigger={["click"]}>
            <Button type="link" icon={<EllipsisOutlined />} />
          </Dropdown>
        );
      }
    }
  ];

  // 过滤后的云资源池
  const filteredClouds = clouds.filter(c=>{
    if(keyword && !c.name.toLowerCase().includes(keyword.toLowerCase())) return false;
    if(statusFilter && statusFilter.length && !statusFilter.includes(c.status)) return false;
    if(typeFilter && typeFilter.length && !typeFilter.includes(c.type)) return false;
    if(vendorFilter) {
      const prov = (c.config?.provider || '').toLowerCase();
      if (prov !== vendorFilter) return false;
    }
    return true;
  });

  // 统计数据
  const totalCnt = clouds.length;
  const onlineCnt = clouds.filter(c=>c.status==='online').length;
  const offlineCnt = totalCnt - onlineCnt;
  // 资源类型统计（在线/离线）
  const containerCounts = (() => {
    const all = clouds.flatMap(c => c.computeResources || []);
    const list = all.filter(r => r.type === 'container');
    const total = list.length;
    const online = list.filter(r => String(r?.status || '').toLowerCase() === 'running').length;
    return { total, online, offline: Math.max(0, total - online) };
  })();
  const vmCounts = vmStats;
  const vpcCounts = vpcStats;

  

  const handleFilterChange = (_: any, all: any) => {
    setKeyword(all.keyword || '');
    setStatusFilter(all.status ? [all.status] : undefined);
    // 类型映射到内部 type
    const cat = all.category as string | undefined;
    if (cat && cat !== '') {
      const mapped =
        cat === 'public' ? 'central' :
        cat === 'private' ? 'private' :
        cat === 'edge' ? 'edge' :
        cat === 'virtualization' ? 'virtualization' :
        cat === 'storage' ? 'object_storage' :
        cat === 'security' ? 'security_pool' :
        cat === 'sase' ? 'sase_gateway' : undefined;
      setTypeFilter(mapped ? [mapped] : undefined);
    } else {
      setTypeFilter(undefined);
    }
    setVendorFilter(all.vendor ? all.vendor : undefined);
  };

  return (
    <PageContainer
      titleLevel={3}
      collapsibleChildren={(
        <Row gutter={[12,12]} style={{ marginBottom:16 }}>
          <Col xs={24} sm={12} md={6}><MetricCard title="资源池数量" total={totalCnt} unit="个" used={onlineCnt} midLabel="离线" midValue={offlineCnt} usedLabel="在线" mainColor="#1677ff" /></Col>
          <Col xs={24} sm={12} md={6}><MetricCard title="云主机数量" total={vmCounts.total} unit="个" used={vmCounts.online} midLabel="离线" midValue={vmCounts.offline} usedLabel="在线" mainColor="#1677ff" /></Col>
          <Col xs={24} sm={12} md={6}><MetricCard title="容器集群数量" total={containerCounts.total} unit="个" used={containerCounts.online} midLabel="离线" midValue={containerCounts.offline} usedLabel="在线" mainColor="#1677ff" /></Col>
          <Col xs={24} sm={12} md={6}><MetricCard title="VPC 网络数量" total={vpcCounts.total} unit="个" used={vpcCounts.online} midLabel="离线" midValue={vpcCounts.offline} usedLabel="在线" mainColor="#1677ff" /></Col>
        </Row>
      )}
      asCard={false}
      toolbarLeft={(
        <Form
          className="filter-tools"
          form={filterForm}
          layout="vertical"
          style={{ rowGap:12, columnGap:12, display:'flex', alignItems:'flex-end' }}
          onValuesChange={handleFilterChange}
          initialValues={{ vendor: '', status: '', category: '' }}
        >
          <Form.Item name="keyword" label="资源池名称">
            <Input allowClear placeholder="支持模糊查询" style={{ width:200 }} />
          </Form.Item>
          <Form.Item name="vendor" label="供应商">
            <Select allowClear placeholder="选择供应商" style={{ width:200 }}>
              <Select.Option value="">全部</Select.Option>
              <Select.Option value="aliyun">阿里云</Select.Option>
              <Select.Option value="aws">AWS</Select.Option>
              <Select.Option value="azure">Azure</Select.Option>
              <Select.Option value="huaweicloud">华为云</Select.Option>
              <Select.Option value="tencentcloud">腾讯云</Select.Option>
              <Select.Option value="ucloud">UCloud</Select.Option>
              <Select.Option value="google">Google Cloud</Select.Option>
              <Select.Option value="ctyun">天翼云</Select.Option>
              <Select.Option value="cmcccloud">移动云</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="status" label="状态">
            <Select allowClear placeholder="选择状态" style={{ width:200 }}>
              <Select.Option value="">全部</Select.Option>
              <Select.Option value="online">在线</Select.Option>
              <Select.Option value="offline">离线</Select.Option>
              <Select.Option value="maintenance">维护中</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="category" label="类型">
            <Select allowClear placeholder="选择类型" style={{ width:200 }}>
              <Select.Option value="">全部</Select.Option>
              <Select.Option value="public">公有云</Select.Option>
              <Select.Option value="private">私有云</Select.Option>
              <Select.Option value="edge">边缘计算</Select.Option>
              <Select.Option value="virtualization">虚拟化</Select.Option>
              <Select.Option value="object_storage">对象存储</Select.Option>
              <Select.Option value="security">云安全资源池</Select.Option>
              <Select.Option value="sase">SASE网关</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item>
            <Button type="link" style={{ padding:0 }} onClick={()=>{filterForm.resetFields(); setKeyword(''); setStatusFilter(undefined); setTypeFilter(undefined); setVendorFilter(undefined);}}>重置</Button>
          </Form.Item>
        </Form>
      )}
      primaryAction={{ text: '新增资源池', onClick: ()=>setWizardVisible(true) }}
      moreMenuItems={[
        { key: 'refresh', label: '全局刷新', onClick: () => fetchClouds() },
        { key: 'bulkDelete', label: '批量删除', danger: true, disabled: !hasAdminPermission || selectedRowKeys.length === 0, onClick: async () => {
          if (!hasAdminPermission) { message.error('权限不足，只有超级管理员可以删除云资源'); return; }
          Modal.confirm({
            title: '确认批量删除',
            content: `将删除选中的 ${selectedRowKeys.length} 个资源池，操作不可恢复。`,
            okText: '删除',
            cancelText: '取消',
            onOk: async () => {
              try {
                const token = localStorage.getItem('token');
                let ok = 0, fail = 0;
                for (const id of selectedRowKeys) {
                  try {
                    await axios.delete(`/api/clouds/${id}`, { headers: { Authorization: `Bearer ${token}` } });
                    ok++;
                  } catch {
                    fail++;
                  }
                }
                message.success(`删除成功 ${ok} 个，失败 ${fail} 个`);
                setSelectedRowKeys([]);
                fetchClouds();
              } catch (e: any) {
                message.error('批量删除失败');
              }
            }
          });
        } },
      ]}
      actionsSize="middle"
      tableProps={{
        columns: tableColumns,
        dataSource: filteredClouds,
        rowKey: "id",
        style: { fontSize: 13 },
        rowSelection: {
          selectedRowKeys,
          onChange: (keys: React.Key[]) => setSelectedRowKeys(keys as string[]),
        },
        pagination: { pageSize: 10 },
        scroll: { x: 'max-content' },
        tableLayout: "auto",
        expandable: undefined,
      }}
    >
      {/* 多云接入向导 */}
      <CloudWizard
        visible={wizardVisible}
        onCancel={() => setWizardVisible(false)}
        onSuccess={fetchClouds}
      />

      {/* 编辑云资源模态框（随云厂商动态） */}
      <Modal
              title={(() => {
                const name = editingCloud ? getProviderInfo(editingCloud?.config || {}).name : '';
                const typeText = editingCloud ? getTypeText(editingCloud.type) : '';
                return editingCloud ? `编辑云资源 [${typeText}-${name}]` : '编辑云资源';
              })()}
        open={editModalVisible}
        onCancel={() => {
          setEditModalVisible(false);
          setEditingCloud(null);
          form.resetFields();
        }}
        footer={null}
        width={600}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleEditSubmit}
        >
          {/* 分组：基础信息（无外卡片，仅标题 + 一列表单） */}
            <div style={{...groupTitleStyle, marginTop: 16}}>基础信息</div>
            <Form.Item
              name="name"
              label={<span style={titleLabelStyle}>云资源名称</span>}
              rules={[{ required: true, message: '请输入云资源名称' }]}
            >
              <Input prefix={<CodepenOutlined />} placeholder="请输入云资源名称" style={inputStyle} />
            </Form.Item>

            <Form.Item
              name="description"
              label={<span style={titleLabelStyle}>描述</span>}
              rules={[{ required: true, message: '请输入描述' }]}
            >
              <Input.TextArea placeholder="请输入描述" rows={3} style={inputStyle} />
            </Form.Item>

            <Form.Item label={<span style={titleLabelStyle}>资源类型</span>}>
              <Tag color="blue">{getTypeText(String(editingCloud?.type || ''))}</Tag>
            </Form.Item>


          {/* 分组：连接信息（无外卡片） */}
          <div style={groupTitleStyle}>连接信息</div>
            <Form.Item
              name="region"
              label={<span style={titleLabelStyle}>地域</span>}
              rules={[{ required: true, message: '请输入地域' }]}
            >
              <Input placeholder="请输入地域" style={inputStyle} />
            </Form.Item>

            <Form.Item
              name="endpoint"
              label={<span style={titleLabelStyle}>端点</span>}
              rules={[{ required: true, message: '请输入端点' }]}
            >
              <Input placeholder="https://api.example.com" style={inputStyle} />
            </Form.Item>


          {/* 分组：认证配置（动态标签，无外卡片） */}
          {(() => {
            const provider = editingCloud?.config?.provider as string | undefined;
            const { akLabel, skLabel, akPlaceholder, skPlaceholder } = getCredentialLabels(provider);
            return (
              <>
                <div style={groupTitleStyle}>认证配置</div>
                {!(provider === 'harvester' || provider === 'cloudmap') && (
                  <Form.Item
                    name="accessKey"
                    label={<span style={titleLabelStyle}>{akLabel}</span>}
                    extra="留空表示不修改"
                  >
                    <Input.Password placeholder={akPlaceholder} style={inputStyle} />
                  </Form.Item>
                )}

                <Form.Item
                  name="secretKey"
                  label={<span style={titleLabelStyle}>{skLabel}</span>}
                  extra="留空表示不修改"
                >
                  <Input.Password placeholder={skPlaceholder} style={inputStyle} />
                </Form.Item>
              </>
            );
          })()}

          {/* 分组：高级选项（与创建向导一致） */}
          <div style={groupTitleStyle}>高级选项</div>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="autoSync" label="自动同步" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="enableSSO" label="开启免密登录" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="ignoreTls" label="忽略TLS证书校验" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="proxyType" label="代理">
            <Select placeholder="DIRECT（直连）" defaultValue="direct" style={{ width: 240 }}>
              <Select.Option value="direct">DIRECT（直连）</Select.Option>
              <Select.Option value="http">HTTP代理</Select.Option>
              <Select.Option value="socks">SOCKS代理</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item name="resourceProject" label="资源归属项目">
            <Select placeholder="system" defaultValue="system" style={{ width: 240 }}>
              <Select.Option value="system">system</Select.Option>
              <Select.Option value="default">default</Select.Option>
            </Select>
          </Form.Item>

          {(() => {
            const provider = editingCloud?.config?.provider as string | undefined;
            if (provider === 'harvester' || provider === 'cloudmap') {
              return (
                <Form.Item name="harvesterVersion" label="Harvester版本">
                  <Select placeholder="自动识别" defaultValue="auto" style={{ width: 240 }}>
                    <Select.Option value="auto">自动</Select.Option>
                    <Select.Option value="1.5">1.5</Select.Option>
                    <Select.Option value="1.6">1.6</Select.Option>
                  </Select>
                </Form.Item>
              );
            }
            return null;
          })()}

          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">
                更新
              </Button>
              <Button onClick={() => {
                setEditModalVisible(false);
                setEditingCloud(null);
                form.resetFields();
              }}>
                取消
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>


      
    </PageContainer>
  );
};

export default Clouds;
