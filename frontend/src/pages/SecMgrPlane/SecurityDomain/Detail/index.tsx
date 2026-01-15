import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Descriptions, Table, Tag, Empty, Typography, Space, Input, Select, Row, Col, Card, Statistic, Badge, Drawer, message, Button } from 'antd';
import ReactFlow, { Controls, Background, Handle, Position, ReactFlowProvider, useReactFlow } from 'react-flow-renderer';
import {
  GlobalOutlined,
  ShareAltOutlined,
  LockOutlined,
  AppstoreOutlined,
  SafetyCertificateOutlined,
  NodeIndexOutlined,
  SettingOutlined,
  EllipsisOutlined,
  PlusOutlined,
  DeploymentUnitOutlined,
  DashboardOutlined,
  ApartmentOutlined,
  SwapOutlined,
  SecurityScanOutlined,
  StopOutlined,
  DesktopOutlined,
  GatewayOutlined,
  PartitionOutlined, 
  FullscreenOutlined,
  ClusterOutlined
} from '@ant-design/icons';
import PageDetailContainer from '../../../../components/PageDetailContainer';
import PageDetailSection from '../../../../components/PageDetailSection';
import { getSecurityDomain } from '../../../../services/securityDomainApi';
import { SecurityDomain } from '../index';
import { fetchCenAttachments, apiPost, fetchCsmElementGroups } from '../../../../services/api';

const { Title } = Typography;
const { Search } = Input;

const AutoFitFlow: React.FC<{ nodes: any[]; edges: any[]; nodeTypes: any; fitSignal: string }> = ({ nodes, edges, nodeTypes, fitSignal }) => {
  const { fitView } = useReactFlow();

  useEffect(() => {
    const id = window.requestAnimationFrame(() => {
      fitView({ padding: 0.2, maxZoom: 1.0 });
    });
    return () => window.cancelAnimationFrame(id);
  }, [fitView, fitSignal]);

  return (
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
      <Background />
    </ReactFlow>
  );
};

const SecurityDomainDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<SecurityDomain | null>(null);
  const [selectedCenId, setSelectedCenId] = useState<string | undefined>(undefined);
  const [attachmentCache, setAttachmentCache] = useState<Record<string, any[]>>({});
  const [topologyLoading, setTopologyLoading] = useState(false);
  const [topologyEl, setTopologyEl] = useState<HTMLDivElement | null>(null);
  const [topologyHeight, setTopologyHeight] = useState(460);
  const [csmElementGroupMap, setCsmElementGroupMap] = useState<Record<string, any>>({});
  const [csmElementGroupsLoading, setCsmElementGroupsLoading] = useState(false);

  useEffect(() => {
    const cloudId = String((data as any)?.cloudId || '').trim();
    const svcCount = Array.isArray((data as any)?.securityServices) ? (data as any).securityServices.length : 0;
    if (!cloudId || svcCount === 0) {
      setCsmElementGroupMap({});
      return;
    }

    setCsmElementGroupsLoading(true);
    fetchCsmElementGroups(cloudId)
      .then((raw: any) => {
        const list = (raw as any)?.data?.items || (raw as any)?.items || (raw as any)?.data || [];
        const items = Array.isArray(list) ? list : [];
        const map: Record<string, any> = {};
        items.forEach((g: any) => {
          const gid = g?.id ?? g?.vm_group_id ?? g?.vmGroupId ?? g?.group_id ?? g?.groupId ?? g?.vm_group_uuid ?? g?.vmGroupUuid;
          if (gid !== undefined && gid !== null && String(gid).trim() !== '') {
            map[String(gid)] = g;
          }
        });
        setCsmElementGroupMap(map);
      })
      .catch(() => setCsmElementGroupMap({}))
      .finally(() => setCsmElementGroupsLoading(false));
  }, [data?.cloudId, (data as any)?.securityServices?.length]);

  useEffect(() => {
    if (!topologyEl) return;
    const calc = () => {
      const rect = topologyEl.getBoundingClientRect();
      const viewportH = window.visualViewport?.height || window.innerHeight;
      const h = Math.max(460, Math.floor(viewportH - rect.top - 24));
      setTopologyHeight(h);
    };
    calc();
    const ro = new ResizeObserver(() => calc());
    ro.observe(topologyEl);
    window.addEventListener('resize', calc);
    window.addEventListener('scroll', calc, true);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', calc);
      window.removeEventListener('scroll', calc, true);
    };
  }, [topologyEl]);

  const topologyNodeTypes = useMemo(() => {
    return {
      mainNode: (props: any) => (
        <div style={{ width: 100, height: 80, borderRadius: 12, background: '#fff', border: '1px solid #e5e5e5', boxShadow: '0 4px 12px rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 0, position: 'relative' }}>
          <div style={{ width: 22, height: 22, borderRadius: '50%', border: '2px solid #1677ff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box' }}>
            <FullscreenOutlined style={{ fontSize: 14, color: '#1677ff' }} />
          </div>
          <label style={{ fontSize: 12, color: '#1f1f1f', fontWeight: 600, width: '100%',  boxSizing: 'border-box', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {props?.data?.vrName || '-'}
          </label>
          <div style={{ fontSize: 12, color: '#8c8c8c', width: '100%', boxSizing: 'border-box', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{props?.data?.eip || '-'}</div>
          <Handle type="source" position={Position.Top} id="pub" style={{ opacity: 0, left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }} />
          <Handle type="target" position={Position.Top} id="pub" style={{ opacity: 0, left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }} />
        </div>
      ),
      domainCard: (props: any) => (
        <div style={{ width: 160, height: 80, borderRadius: 10, background: '#fff', border: '1px solid #e5e5e5', boxShadow: '0 3px 10px rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6, padding: '8px 12px', position: 'relative' }}>
          <div style={{ fontSize: 12, color: '#1f1f1f', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{props?.data?.title || '-'}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', overflow: 'hidden' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 6px', borderRadius: 8, border: '1px solid #e6f0ff', background: '#f7f9ff', maxWidth: 120 }}>
              <ClusterOutlined style={{ fontSize: 12, color: '#fa8c16' }} />
              <span style={{ fontSize: 12, color: '#3a3a3a', overflow: 'hidden', textOverflow: 'ellipsis' }}>{props?.data?.vpcCidr || '-'}</span>
            </span>
          </div>
          <Handle type="source" position={Position.Top} id="card" style={{ opacity: 0, left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }} />
          <Handle type="target" position={Position.Top} id="card" style={{ opacity: 0, left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }} />
        </div>
      ),
      appCard: (props: any) => (
        <div style={{ width: 160, height: 60, borderRadius: 10, background: '#fff', border: '1px solid #e5e5e5', boxShadow: '0 3px 10px rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4, padding: '8px 12px', position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AppstoreOutlined style={{ color: '#1677ff' }} />
            <div style={{ fontSize: 12, color: '#1f1f1f', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{props?.data?.title || '-'}</div>
          </div>
          <div style={{ fontSize: 12, color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{props?.data?.subTitle || '-'}</div>
          <Handle type="source" position={Position.Top} id="app" style={{ opacity: 0, left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }} />
          <Handle type="target" position={Position.Top} id="app" style={{ opacity: 0, left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }} />
        </div>
      ),
      securityServiceCard: (props: any) => (
        <div style={{ width: 160, height: 'auto', minHeight: 70, borderRadius: 10, background: '#fff', border: '1px solid #e5e5e5', boxShadow: '0 3px 10px rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '0 0 auto' }}>
            <Badge count={Number(props?.data?.count || 0)} size="small" overflowCount={999} color="#1677ff">
              <SafetyCertificateOutlined style={{ color: '#1677ff' }} />
            </Badge>
            <div style={{ fontSize: 12, color: '#1f1f1f', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{props?.data?.title || '-'}</div>
          </div>
          <div style={{ flex: '1 1 auto', display: 'flex', flexWrap: 'wrap', gap: 4, alignContent: 'flex-start' }}>
            {(Array.isArray(props?.data?.services) ? props.data.services : []).map((name: any, idx: number) => (
              <Tag key={`${String(name)}-${idx}`} color="blue" style={{ margin: 0, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', lineHeight: '20px' }}>
                {String(name)}
              </Tag>
            ))}
          </div>
          <Handle type="source" position={Position.Top} id="svc" style={{ opacity: 0, left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }} />
          <Handle type="target" position={Position.Top} id="svc" style={{ opacity: 0, left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }} />
        </div>
      )
    };
  }, []);

  useEffect(() => {
    if (id) {
      fetchDetail(id);
    }
  }, [id]);

  const [rawDetail, setRawDetail] = useState<any>(null);
  const [attachmentRawCache, setAttachmentRawCache] = useState<Record<string, any>>({});
  const [logDrawerOpen, setLogDrawerOpen] = useState(false);

  useEffect(() => {
    const cascades = (data as any)?.cascadeChannels || [];
    if (!selectedCenId && Array.isArray(cascades) && cascades.length > 0) {
      const firstId = String(cascades[0]?.id || '');
      if (firstId) setSelectedCenId(firstId);
    }
  }, [data, selectedCenId]);

  useEffect(() => {
    const cenId = selectedCenId;
    if (!cenId) return;
    const cached = attachmentCache[cenId];
    if (cached) return;
    setTopologyLoading(true);
    fetchCenAttachments(cenId)
      .then((res: any) => {
        const list = Array.isArray(res) ? res : (res?.data || []);
        setAttachmentRawCache(prev => ({ ...prev, [cenId]: res }));
        setAttachmentCache(prev => ({ ...prev, [cenId]: Array.isArray(list) ? list : [] }));
      })
      .catch(() => {
        setAttachmentRawCache(prev => ({ ...prev, [cenId]: [] }));
        setAttachmentCache(prev => ({ ...prev, [cenId]: [] }));
      })
      .finally(() => setTopologyLoading(false));
  }, [selectedCenId, selectedCenId ? attachmentCache[selectedCenId] : undefined]);

  const fetchDetail = async (domainId: string) => {
    setLoading(true);
    try {
      const res = await getSecurityDomain(domainId);
      setRawDetail(res);
      setData(res);
    } catch (error) {
      console.error('Failed to fetch security domain detail:', error);
    } finally {
      setLoading(false);
    }
  };

  const overviewContent = (
    <Descriptions bordered size="small" column={4}>
      <Descriptions.Item label="名称">{data?.name}</Descriptions.Item>
      <Descriptions.Item label="类型">{data?.type || '-'}</Descriptions.Item>
      <Descriptions.Item label="云提供商">{data?.provider || '-'}</Descriptions.Item>
      <Descriptions.Item label="区域">{data?.region || '-'}</Descriptions.Item>
      <Descriptions.Item label="所属组织">{data?.organizationName || data?.organizationId || '-'}</Descriptions.Item>
      <Descriptions.Item label="CIDR">
        {data?.cidr || (data?.cidr4?.join(', ')) || '-'}
      </Descriptions.Item>
      <Descriptions.Item label="IPv6 CIDR">
        {data?.cidr6?.length ? data.cidr6.join(', ') : '-'}
      </Descriptions.Item>
      <Descriptions.Item label="VR 实例">{data?.vrName || data?.vrUuid || '-'}</Descriptions.Item>
      <Descriptions.Item label="状态">
        <Tag color={data?.status === 'active' ? 'success' : 'default'}>
          {data?.status || 'Unknown'}
        </Tag>
      </Descriptions.Item>
      <Descriptions.Item label="描述" span={2}>{data?.description || '-'}</Descriptions.Item>
      <Descriptions.Item label="创建时间">{data?.createdAt || '-'}</Descriptions.Item>
      <Descriptions.Item label="更新时间">{data?.updatedAt || '-'}</Descriptions.Item>
    </Descriptions>
  );

  // Common toolbar for sections
  const renderToolbar = (placeholder = "搜索...") => ({
    toolbarLeft: (
      <Space>
        {/* PRD: 关键字搜索（不要放大镜） */}
        <Input placeholder={placeholder} style={{ width: 240 }} allowClear />
        {/* PRD: 类型选择下拉框 */}
        <Select 
          placeholder="状态" 
          style={{ width: 120 }} 
          allowClear
          options={[
            { label: 'Active', value: 'active' },
            { label: 'Inactive', value: 'inactive' }
          ]}
        />
      </Space>
    ),
    onRefresh: () => id && fetchDetail(id),
    refreshLoading: loading,
    columnsConfig: {
        value: ['id', 'name', 'status'],
        options: [
            { label: 'ID', value: 'id' },
            { label: '名称', value: 'name' },
            { label: '状态', value: 'status' },
            { label: '类型', value: 'type' },
            { label: '描述', value: 'description' },
            { label: '创建时间', value: 'createdAt' },
            { label: '更新时间', value: 'updatedAt' },
            { label: '标签', value: 'tags' },
            { label: '区域', value: 'region' },
            { label: '云提供商', value: 'provider' },
        ],
        onChange: (vals: string[]) => console.log('Columns changed:', vals)
    }
  });

  // 0. 资源总览
  const renderOverview = () => {
    const infraCount = data?.vpcId || data?.vrUuid ? (data?.vpcId && data?.vrUuid ? 2 : 1) : 0;
    const cascadeCount = data?.cascadeChannels?.length || 0;
    const cloudInstancesCount = data?.cloudInstances?.length || 0;
    const appInstancesCount = data?.appInstances?.length || 0;
    const securityServicesCount = data?.securityServices?.length || 0;
    const serviceChainsCount = data?.serviceChains?.length || 0;
    const srv6Count = data?.srv6Tunnels?.length || 0;
    const natCount = data?.natRules?.length || 0;
    const aclCount = data?.aclRules?.length || 0;
    const bypassCount = data?.bypassPolicies?.length || 0;

    const srv6ActiveCount = (data?.srv6Tunnels || []).filter((t: any) => String(t?.status || '').toLowerCase() === 'active').length;
    const natActiveCount = (data?.natRules || []).filter((t: any) => String(t?.status || '').toLowerCase() === 'active').length;
    const aclActiveCount = (data?.aclRules || []).filter((t: any) => String(t?.status || '').toLowerCase() === 'active').length;

    const directSecurityServicesCount = (data?.securityServices || []).filter((s: any) => s?.source === '直接关联').length;
    const chainSecurityServicesCount = (data?.securityServices || []).filter((s: any) => s?.source === '服务链关联').length;

    return (
      <>
        <Row gutter={[16, 16]}>
          <Col xs={24} sm={12} md={6}>
            <Card size="small" style={{ borderRadius: 8, border: '1px solid #f0f0f0' }}>
              <Statistic 
                title="网络基础设施" 
                value={infraCount} 
                valueStyle={{ fontSize: 24, fontWeight: 700 }} 
              />
              <Typography.Text type="secondary">
                {data?.vpcId ? 'VPC' : ''}{data?.vpcId && data?.vrUuid ? ' + ' : ''}{data?.vrUuid ? 'VR' : ''}{!data?.vpcId && !data?.vrUuid ? '-' : ''}
              </Typography.Text>
            </Card>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Card size="small" style={{ borderRadius: 8, border: '1px solid #f0f0f0' }}>
              <Statistic title="级联通道" value={cascadeCount} valueStyle={{ fontSize: 24, fontWeight: 700 }} />
              <Typography.Text type="secondary">{data?.cascadeChannels?.[0]?.topology || '-'}</Typography.Text>
            </Card>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Card size="small" style={{ borderRadius: 8, border: '1px solid #f0f0f0' }}>
              <Statistic title="云主机实例" value={cloudInstancesCount} valueStyle={{ fontSize: 24, fontWeight: 700 }} />
              <Typography.Text type="secondary">{data?.provider ? String(data.provider).toUpperCase() : '-'} {data?.region || ''}</Typography.Text>
            </Card>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Card size="small" style={{ borderRadius: 8, border: '1px solid #f0f0f0' }}>
              <Statistic title="应用实例" value={appInstancesCount} valueStyle={{ fontSize: 24, fontWeight: 700 }} />
              <Typography.Text type="secondary">服务目录关联</Typography.Text>
            </Card>
          </Col>
        </Row>
        <Row gutter={[16, 16]} style={{ marginTop: 12 }}>
          <Col xs={24} sm={12} md={6}>
            <Card size="small" style={{ borderRadius: 8, border: '1px solid #f0f0f0' }}>
              <Statistic title="安全服务" value={securityServicesCount} valueStyle={{ fontSize: 24, fontWeight: 700 }} />
              <Typography.Text type="secondary">直接: {directSecurityServicesCount} / 服务链: {chainSecurityServicesCount}</Typography.Text>
            </Card>
          </Col>
           <Col xs={24} sm={12} md={6}>
            <Card size="small" style={{ borderRadius: 8, border: '1px solid #f0f0f0' }}>
              <Statistic title="服务链" value={serviceChainsCount} valueStyle={{ fontSize: 24, fontWeight: 700 }} />
              <Typography.Text type="secondary">{data?.serviceChains?.[0]?.type ? `示例类型: ${data?.serviceChains?.[0]?.type}` : '-'}</Typography.Text>
            </Card>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Card size="small" style={{ borderRadius: 8, border: '1px solid #f0f0f0' }}>
              <Statistic title="SRv6 隧道" value={srv6Count} valueStyle={{ fontSize: 24, fontWeight: 700 }} />
              <Typography.Text type="secondary">Active: {srv6ActiveCount}</Typography.Text>
            </Card>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Card size="small" style={{ borderRadius: 8, border: '1px solid #f0f0f0' }}>
              <Statistic title="IPsec VPN" value={0} valueStyle={{ fontSize: 24, fontWeight: 700 }} />
              <Typography.Text type="secondary">待接入数据</Typography.Text>
            </Card>
          </Col>
        </Row>
        <Row gutter={[16, 16]} style={{ marginTop: 12 }}>
          <Col xs={24} sm={12} md={6}>
            <Card size="small" style={{ borderRadius: 8, border: '1px solid #f0f0f0' }}>
              <Statistic title="NAT" value={natCount} valueStyle={{ fontSize: 24, fontWeight: 700 }} />
              <Typography.Text type="secondary">Active: {natActiveCount}</Typography.Text>
            </Card>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Card size="small" style={{ borderRadius: 8, border: '1px solid #f0f0f0' }}>
              <Statistic title="网络ACL" value={aclCount} valueStyle={{ fontSize: 24, fontWeight: 700 }} />
              <Typography.Text type="secondary">Active: {aclActiveCount}</Typography.Text>
            </Card>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Card size="small" style={{ borderRadius: 8, border: '1px solid #f0f0f0' }}>
              <Statistic title="旁路阻断" value={bypassCount} valueStyle={{ fontSize: 24, fontWeight: 700 }} />
              <Typography.Text type="secondary">策略数量</Typography.Text>
            </Card>
          </Col>
        </Row>
      </>
    );
  };

  // 1. 网络基础设施 VPC 及 VR实例 信息表格
  const renderNetworkInfra = () => {
    const infraData = [];
    if (data?.vpcId) {
      infraData.push({
        key: 'vpc',
        type: 'VPC',
        id: data.vpcId,
        name: data.newVpcName || '-',
        info: `Mode: ${data.vpcMode}, CIDR: ${data.newVpcCidr || data.cidr || '-'}`
      });
    }
    if (data?.vrUuid) {
      infraData.push({
        key: 'vr',
        type: 'VR Instance',
        id: data.vrUuid,
        name: data.vrName || '-',
        info: `Instance IDs: ${data.vrInstanceIds || '-'}, Public EIP: ${data.vrPublicEip || '-'}`
      });
    }

    const columns = [
      { title: '资源类型', dataIndex: 'type', key: 'type' },
      { title: '资源ID', dataIndex: 'id', key: 'id' },
      { title: '名称', dataIndex: 'name', key: 'name' },
      { title: '详细信息', dataIndex: 'info', key: 'info' },
    ];

    return (
      <PageDetailSection
        {...renderToolbar("搜索资源...")}
      >
        <Table 
          dataSource={infraData} 
          columns={columns} 
          pagination={false} 
          bordered
          size="middle"
        />
      </PageDetailSection>
    );
  };

  // 3. 级联通道
  const renderCascadeChannels = () => {
    const columns = [
      { title: '名称', dataIndex: 'name', key: 'name' },
      { title: '通道ID', dataIndex: 'id', key: 'id' },
      { title: '策略', dataIndex: 'strategy', key: 'strategy' },
      { title: '拓扑', dataIndex: 'topology', key: 'topology' },
      { title: '状态', dataIndex: 'status', key: 'status' },
    ];
    return (
      <PageDetailSection
        {...renderToolbar("搜索通道...")}
        primaryAction={{ label: '新建通道', onClick: () => {} }}
      >
        <Table 
          columns={columns} 
          dataSource={data?.cascadeChannels || []} 
          rowKey="id"
          locale={{ emptyText: '暂无关联级联通道' }} 
          bordered
          size="middle"
          pagination={{ pageSize: 10, size: 'default' }}
        />
      </PageDetailSection>
    );
  };

  // 2. SRv6隧道
  const renderSRv6Tunnels = () => {
    const columns = [
      { title: '名称', dataIndex: 'name', key: 'name' },
      { title: '隧道ID', dataIndex: 'id', key: 'id' },
      { title: '源地址', dataIndex: 'peA', key: 'peA' },
      { title: '目的地址', dataIndex: 'peB', key: 'peB' },
      { title: '状态', dataIndex: 'status', key: 'status' },
    ];
    return (
      <PageDetailSection
        {...renderToolbar("搜索隧道...")}
        primaryAction={{ label: '新建隧道', onClick: () => {} }}
      >
        <Table 
          columns={columns} 
          dataSource={data?.srv6Tunnels || []} 
          rowKey="id"
          locale={{ emptyText: '暂无关联 SRv6 隧道' }} 
          bordered
          size="middle"
          pagination={{ pageSize: 10, size: 'default' }}
        />
      </PageDetailSection>
    );
  };

  // 3. IPsecVPN
  const renderIPsecVPN = () => {
    const columns = [
      { title: 'VPN ID', dataIndex: 'id', key: 'id' },
      { title: '名称', dataIndex: 'name', key: 'name' },
      { title: '对端网关', dataIndex: 'peer', key: 'peer' },
      { title: '状态', dataIndex: 'status', key: 'status' },
    ];
    return (
      <PageDetailSection
        {...renderToolbar("搜索VPN...")}
        primaryAction={{ label: '新建VPN', onClick: () => {} }}
      >
        <Table 
          columns={columns} 
          dataSource={[]} 
          locale={{ emptyText: '暂无关联 IPsec VPN' }} 
          bordered
          size="middle"
          pagination={{ pageSize: 10, size: 'default' }}
        />
      </PageDetailSection>
    );
  };

  // 9. NAT
  const renderNAT = () => {
    const columns = [
      { title: '规则ID', dataIndex: 'id', key: 'id' },
      { title: '名称', dataIndex: 'name', key: 'name' },
      { title: '类型', dataIndex: 'type', key: 'type', render: (t: string) => <Tag color="blue">{t?.toUpperCase()}</Tag> },
      { title: '源地址', dataIndex: 'originalSourceIp', key: 'originalSourceIp', render: (t: any) => t || '-' },
      { title: '转换后地址', dataIndex: 'translatedSourceIp', key: 'translatedSourceIp', render: (t: any) => t || '-' },
    ];
    return (
      <PageDetailSection
        {...renderToolbar("搜索NAT规则...")}
        primaryAction={{ label: '新建NAT', onClick: () => {} }}
      >
        <Table 
          columns={columns} 
          dataSource={data?.natRules || []} 
          rowKey="id"
          locale={{ emptyText: '暂无关联 NAT 实例' }} 
          bordered
          size="middle"
          pagination={{ pageSize: 10, size: 'default' }}
        />
      </PageDetailSection>
    );
  };

  // 10. Network ACL
  const renderNetworkACL = () => {
    const columns = [
      { title: '名称', dataIndex: 'name', key: 'name' },
      { title: '规则ID', dataIndex: 'id', key: 'id' },
      { title: '优先级', dataIndex: 'priority', key: 'priority' },
      { title: '动作', dataIndex: 'action', key: 'action', render: (t: string) => <Tag color={t === 'permit' ? 'success' : 'error'}>{t?.toUpperCase()}</Tag> },
      { title: '协议', dataIndex: 'protocol', key: 'protocol' },
      { title: '源地址', dataIndex: 'sourceIp', key: 'sourceIp' },
      { title: '目的地址', dataIndex: 'destinationIp', key: 'destinationIp' },
    ];
    return (
      <PageDetailSection
        {...renderToolbar("搜索ACL规则...")}
        primaryAction={{ label: '新建ACL', onClick: () => {} }}
      >
        <Table 
          columns={columns} 
          dataSource={data?.aclRules || []} 
          rowKey="id"
          locale={{ emptyText: '暂无关联网络 ACL 实例' }} 
          bordered
          size="middle"
          pagination={{ pageSize: 10, size: 'default' }}
        />
      </PageDetailSection>
    );
  };

  // 11. Bypass Blocking
  const renderBypassBlocking = () => {
    const columns = [
      { title: '名称', dataIndex: 'name', key: 'name' },
      { title: '策略ID', dataIndex: 'id', key: 'id' },
      { title: '类型', dataIndex: 'type', key: 'type' },
      { title: '状态', dataIndex: 'status', key: 'status' },
    ];
    return (
      <PageDetailSection
        {...renderToolbar("搜索旁路阻断策略...")}
        primaryAction={{ label: '新建策略', onClick: () => {} }}
      >
        <Table 
          columns={columns} 
          dataSource={data?.bypassPolicies || []} 
          rowKey="id"
          locale={{ emptyText: '暂无关联旁路阻断策略实例' }} 
          bordered
          size="middle"
          pagination={{ pageSize: 10, size: 'default' }}
        />
      </PageDetailSection>
    );
  };

  // 4. 云主机实例
  const renderCloudInstances = () => {
    const columns = [
      { title: '名称', dataIndex: 'instanceName', key: 'instanceName' },
      { title: '主机ID', dataIndex: 'instanceId', key: 'instanceId' },
      { 
        title: 'IP地址', 
        dataIndex: 'privateIps', 
        key: 'privateIps',
        render: (text: any) => {
            if (!text) return '-';
            try {
                // Handle if text is already an array or a JSON string
                const arr = typeof text === 'string' ? JSON.parse(text) : text;
                return Array.isArray(arr) ? arr.join(', ') : String(text);
            } catch {
                return String(text);
            }
        }
      },
      { title: '状态', dataIndex: 'status', key: 'status' },
    ];
    return (
      <PageDetailSection
        {...renderToolbar("搜索云主机...")}
        primaryAction={{ label: '新建云主机', onClick: () => {} }}
      >
        <Table 
          columns={columns} 
          dataSource={data?.cloudInstances || []} 
          rowKey="id"
          locale={{ emptyText: '暂无关联云主机实例' }} 
          bordered
          size="middle"
          pagination={{ pageSize: 10, size: 'default' }}
        />
      </PageDetailSection>
    );
  };

  // 4.5 应用实例
  const renderAppInstances = () => {
    const columns = [
      { title: '名称', dataIndex: 'name', key: 'name' },
      { title: '应用ID', dataIndex: 'id', key: 'id' },
      { title: '类型', dataIndex: 'type', key: 'type', render: (t: string) => <Tag color="blue">{t?.toUpperCase()}</Tag> },
      { title: '实例数', dataIndex: 'instanceCount', key: 'instanceCount' },
      { title: '版本', dataIndex: 'version', key: 'version' },
      { title: '负责人', dataIndex: 'owner', key: 'owner' },
      { title: '状态', dataIndex: 'status', key: 'status' },
    ];
    return (
      <PageDetailSection
        {...renderToolbar("搜索应用...")}
        primaryAction={{ label: '新建应用', onClick: () => {} }}
      >
        <Table 
          columns={columns} 
          dataSource={data?.appInstances || []} 
          rowKey="id"
          locale={{ emptyText: '暂无关联应用实例' }} 
          bordered
          size="middle"
          pagination={{ pageSize: 10, size: 'default' }}
        />
      </PageDetailSection>
    );
  };

  // 5. 安全服务
  const renderSecurityServices = () => {
    const pick = (obj: any, keys: string[]) => {
      const sources = [obj, obj?.group, obj?.service, obj?.securityService, obj?.elementGroup, obj?.vmGroup];
      for (const src of sources) {
        for (const k of keys) {
          const v = src?.[k];
          if (v !== undefined && v !== null && String(v).trim() !== '') return v;
        }
      }
      return undefined;
    };

    const normalizeInstanceList = (val: any) => {
      if (!val) return [];
      if (Array.isArray(val)) return val;
      if (typeof val === 'string') return val.split(/[;,]/).map((s) => s.trim()).filter(Boolean);
      const items = val?.items || val?.list || val?.data;
      if (Array.isArray(items)) return items;
      return [];
    };

    const getInstances = (r: any) => {
      const direct = normalizeInstanceList(
        pick(r, [
          'elements',
          'elementList',
          'vmList',
          'vm_list',
          'vms',
          'vm_id_list',
          'vmIds',
          'vmIdList',
          'neList',
          'ne_id_list',
          'neIds',
          'neIdList',
          'instances',
          'instanceList',
          'members',
        ])
      );
      if (direct.length > 0) return direct;

      const gidRaw = pick(r, ['id', 'vm_group_id', 'vmGroupId', 'group_id', 'groupId', 'vm_group_uuid', 'vmGroupUuid']);
      const gid = gidRaw !== undefined && gidRaw !== null ? String(gidRaw).trim() : '';
      const g = gid ? csmElementGroupMap[gid] : undefined;
      if (!g) return [];

      return normalizeInstanceList(
        pick(g, [
          'elements',
          'elementList',
          'vmList',
          'vm_list',
          'vms',
          'vm_id_list',
          'vmIds',
          'vmIdList',
          'neList',
          'ne_id_list',
          'neIds',
          'neIdList',
          'instances',
          'instanceList',
          'members',
          'items',
        ])
      );
    };

    const calcNeCount = (r: any) => {
      const v = pick(r, ['neCount', 'count', 'Count', 'elementCount', 'elementsCount', 'elements_count', 'vm_count', 'vmCount', 'ne_count']);
      if (v === 0 || v) return Number(v);
      const list = getInstances(r);
      if (list.length > 0) return list.length;
      return '-';
    };

    const handleSSO = async (r: any) => {
        const instances = getInstances(r);
        if (instances.length === 0) {
            message.warning('该服务无实例，无法访问');
            return;
        }
        const first = instances[0];
        // first might be an object or string
        const id = typeof first === 'object' ? (first.id || first.uuid || first.vm_id || first.vrouter_id) : first;
        
        if (!id) {
             message.warning('实例ID未找到');
             return;
        }

        // We need cloudId. data.cloudId should be available.
        const cloudId = data?.cloudId;
        if (!cloudId) {
            message.error('未找到关联的云资源ID');
            return;
        }

        try {
            message.loading({ content: '正在发起SSO访问...', key: 'sso' });
            const res: any = await apiPost(`/api/clouds/${cloudId}/csm/security/domain/attach/callOnSSO`, {
                id: id,
                currentLoginWebPort: '8020'
            });
            message.success({ content: 'SSO请求成功，正在跳转...', key: 'sso' });
            
            const url = res?.data?.url || res?.url;
            if (url) {
                window.open(url, '_blank');
            } else {
                message.warning('未返回跳转URL');
            }
        } catch (e: any) {
            message.error({ content: `SSO访问失败: ${e.message}`, key: 'sso' });
        }
    };

    const columns = [
      { title: '名称', key: 'name', ellipsis: true, render: (_: any, r: any) => String(pick(r, ['name', 'vm_group_name', 'vmGroupName', 'groupName', 'securityServiceName', 'serviceName', 'title', 'displayName']) ?? '-') },
      { title: 'ID', dataIndex: 'id', key: 'id', ellipsis: true },
      { title: '类型', key: 'type', ellipsis: true, render: (_: any, r: any) => String(pick(r, ['type', 'groupType', 'vm_group_type', 'vmGroupType', 'productType', 'product_type', 'kind', 'category']) ?? '-') },
      { title: '厂商', key: 'vendor', ellipsis: true, render: (_: any, r: any) => String(pick(r, ['vendor', 'manufacturer', 'vendor_name', 'vendorName', 'factory', 'brand', 'company', 'maker', 'provider']) ?? '-') },
      { title: '防御类型', key: 'defenseType', ellipsis: true, render: (_: any, r: any) => String(pick(r, ['defenseType', 'defense_type', 'protectType', 'protect_type', 'protectionType', 'protection_type', 'securityType', 'security_type']) ?? '-') },
      { title: '网元数量', key: 'neCount', width: 100, render: (_: any, r: any) => calcNeCount(r) },
      { 
        title: '实例列表', 
        key: 'instances',
        width: 200,
        render: (_: any, r: any) => {
           const list = getInstances(r);
           if (!list || list.length === 0) {
             const cnt = calcNeCount(r);
             if (csmElementGroupsLoading && cnt !== '-' && Number(cnt) > 0) return '加载中';
             return '-';
           }
           const show = list.slice(0, 3);
           return (
             <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
               {show.map((item: any, idx: number) => {
                   const label = typeof item === 'object' ? (item.name || item.id) : item;
                   return <Tag key={idx} style={{ margin: 0, fontSize: 10 }}>{label}</Tag>;
               })}
               {list.length > 3 && <Tag style={{ margin: 0, fontSize: 10 }}>+{list.length - 3}</Tag>}
             </div>
           );
        }
      },
      {
          title: '操作',
          key: 'op',
          width: 100,
          render: (_: any, r: any) => (
              <Button type="link" size="small" onClick={() => handleSSO(r)}>SSO访问</Button>
          )
      }
    ];
    return (
      <PageDetailSection
        {...renderToolbar("搜索服务...")}
        primaryAction={{ label: '添加服务', onClick: () => {} }}
      >
        <Table 
          columns={columns} 
          dataSource={data?.securityServices || []} 
          rowKey="id"
          locale={{ emptyText: '暂无关联安全服务' }} 
          bordered
          size="middle"
          pagination={{ pageSize: 10, size: 'default' }}
        />
      </PageDetailSection>
    );
  };

  // 6. 服务链
  const renderServiceChains = () => {
    const formatProtectionTargets = (val: any) => {
      if (val === undefined || val === null) return '-';
      let obj: any = val;
      if (typeof val === 'string') {
        const s = val.trim();
        if (!s) return '-';
        try {
          obj = JSON.parse(s);
        } catch {
          return s;
        }
      }
      const mode = String(obj?.mode || '').trim();
      const objects = Array.isArray(obj?.objects) ? obj.objects : [];
      const fmt = (o: any) => {
        const name = String(o?.name || o?.vrName || o?.title || o?.id || '').trim();
        const meta: string[] = [];
        const cidr = String(o?.cidr || '').trim();
        if (cidr) meta.push(cidr);
        const provider = String(o?.provider || '').trim();
        const region = String(o?.region || '').trim();
        const pr = [provider, region].filter(Boolean).join('/');
        if (pr) meta.push(pr);
        const metaStr = meta.length ? ` (${meta.join(', ')})` : '';
        return `${name || '-'}${metaStr}`;
      };
      const list = objects.map(fmt).filter((s: string) => s && s !== '-');
      if (mode.toLowerCase() === 'vr') return list.length ? `VR：${list.join('；')}` : 'VR：-';
      if (mode) return list.length ? `${mode}：${list.join('；')}` : `${mode}：-`;
      if (list.length) return list.join('；');
      try {
        return typeof obj === 'string' ? obj : JSON.stringify(obj);
      } catch {
        return '-';
      }
    };

    const columns = [
      { title: '名称', dataIndex: 'name', key: 'name' },
      { title: '服务链ID', dataIndex: 'id', key: 'id' },
      { title: '类型', dataIndex: 'type', key: 'type' },
      { title: '防护对象', dataIndex: 'protectionTargets', key: 'protectionTargets', ellipsis: true, render: (v: any) => formatProtectionTargets(v) },
      { title: '引流方式', dataIndex: 'steeringMode', key: 'steeringMode' },
      { title: '状态', dataIndex: 'status', key: 'status' },
    ];
    return (
      <PageDetailSection
        {...renderToolbar("搜索服务链...")}
        primaryAction={{ label: '新建服务链', onClick: () => {} }}
      >
        <Table 
          columns={columns} 
          dataSource={data?.serviceChains || []} 
          rowKey="id"
          locale={{ emptyText: '暂无关联服务链' }} 
          bordered
          size="middle"
          pagination={{ pageSize: 10, size: 'default' }}
        />
      </PageDetailSection>
    );
  };

  // 7. 安全域拓扑
  const renderTopology = () => {
    const cascades: any[] = ((data as any)?.cascadeChannels || []) as any[];
    const apps: any[] = ((data as any)?.appInstances || []) as any[];
    const securityServices: any[] = ((data as any)?.securityServices || []) as any[];
    const cenId = selectedCenId || (cascades.length ? String(cascades[0]?.id || '') : undefined);
    const cen = cenId ? cascades.find((c: any) => String(c?.id) === String(cenId)) : undefined;

    const centerX = 520;
    const centerY = 260;
    const radius = 200;
    const currentDomainFallbackDx = 120;
    const currentDomainFallbackDy = -40;
    const childRadialGap = 64;
    const childPerpGap = 56;
    const mainW = 100, mainH = 80;
    const cardW = 160, cardH = 80;
    const mainDomainGap = 24;
    const topo = String(cen?.topology || 'Mesh');
    const hubId = cen?.hubId ? String(cen.hubId) : undefined;

    const attachments = cenId ? (attachmentCache[cenId] || []) : [];
    const attached = attachments.filter((l: any) => l?.status === 'attached' || l?.status === 'attaching');
    let domList = attached
      .map((att: any) => ({ att, dom: att?.securityDomain }))
      .filter((x: any) => x?.dom && String(x.dom?.id || '').trim());

    const currentDomainId = String((data as any)?.id || id || '');

    if (topo === 'Hub-Spoke' && domList.length > 0) {
      const idx = hubId ? domList.findIndex((d: any) => String(d?.dom?.id) === hubId) : 0;
      if (idx > -1 && idx < domList.length) {
        const [hub] = domList.splice(idx, 1);
        domList.unshift(hub);
      }
    }

    const total = domList.length;
    const mainNodes = domList.map((d: any, idx: number) => {
      const angle = total ? (idx * 2 * Math.PI) / total : 0;
      const x = centerX + Math.cos(angle) * radius - mainW / 2;
      const y = centerY + Math.sin(angle) * radius - mainH / 2;
      const eip = d?.dom?.vrPublicEip || d?.dom?.vrPublicIp || '-';
      const vrName = d?.dom?.vrName || d?.dom?.vrUuid || '-';
      return {
        id: `main-${String(d?.dom?.id)}`,
        type: 'mainNode',
        position: { x, y },
        data: { eip, vrName }
      };
    });

    const domainNodes = domList.map((d: any, idx: number) => {
      const angle = total ? (idx * 2 * Math.PI) / total : 0;
      const mainR = Math.sqrt((mainW / 2) ** 2 + (mainH / 2) ** 2);
      const cardR = Math.sqrt((cardW / 2) ** 2 + (cardH / 2) ** 2);
      const outerRadius = radius + mainR + cardR + mainDomainGap;
      const cx = centerX + Math.cos(angle) * outerRadius;
      const cy = centerY + Math.sin(angle) * outerRadius;
      const title = d?.dom?.name || '-';
      const vrName = d?.dom?.vrName || d?.dom?.vrUuid || '-';
      const vpcCidr = d?.dom?.cidr || (Array.isArray(d?.dom?.cidr4) ? d.dom.cidr4.join(',') : '-') || '-';
      return {
        id: `domain-${String(d?.dom?.id)}`,
        type: 'domainCard',
        position: { x: cx - cardW / 2, y: cy - cardH / 2 },
        data: { title: `${title}`, vrName, vpcCidr }
      };
    });

    const nodes: any[] = ([] as any[]).concat(mainNodes, domainNodes);
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

    const currentDomainNodeId = `domain-${currentDomainId}`;
    const currentDomainNode = domainNodes.find(n => String(n.id) === currentDomainNodeId);
    if (!currentDomainNode) {
      nodes.push({
        id: currentDomainNodeId,
        type: 'domainCard',
        position: { x: centerX + radius + currentDomainFallbackDx, y: centerY + currentDomainFallbackDy },
        data: { title: `${(data as any)?.name || '安全域'}安全域`, vrName: (data as any)?.vrName || (data as any)?.vrUuid || '-', vpcCidr: (data as any)?.cidr || ((data as any)?.cidr4 || []).join(',') || '-' }
      });
    }

    const attachFromDomainNode = currentDomainNode || nodes.find(n => String(n.id) === currentDomainNodeId);
    const domainCardW = 160;
    const domainCardH = 80;
    const calcSupport = (w: number, h: number, ux: number, uy: number) => (w / 2) * Math.abs(ux) + (h / 2) * Math.abs(uy);

    if (attachFromDomainNode) {
      const parentX = Number(attachFromDomainNode.position?.x ?? centerX);
      const parentY = Number(attachFromDomainNode.position?.y ?? centerY);
      const parentCx = parentX + domainCardW / 2;
      const parentCy = parentY + domainCardH / 2;
      const dx = parentCx - centerX;
      const dy = parentCy - centerY;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const px = -uy;
      const py = ux;
      const baseGap = childRadialGap;
      const rowGap = childPerpGap;
      const parentSupport = calcSupport(domainCardW, domainCardH, ux, uy);

      const items: Array<{ id: string; type: string; w: number; h: number; data: any; targetHandle: string; edgeStyle?: any }> = [];

      const svcCount = Array.isArray(securityServices) ? securityServices.length : 0;
      if (svcCount > 0) {
        const svcNames = (Array.isArray(securityServices) ? securityServices : [])
          .map((s: any) => s?.name || s?.title || s?.displayName || s?.id)
          .filter((x: any) => x !== undefined && x !== null && String(x).trim());
        items.push({
          id: 'security-services',
          type: 'securityServiceCard',
          w: 220,
          h: 140,
          targetHandle: 'svc',
          data: { title: '安全服务', count: svcCount, services: svcNames },
          edgeStyle: { stroke: '#fa8c16', strokeWidth: 2 }
        });
      }

      (Array.isArray(apps) ? apps : []).forEach((a: any, idx: number) => {
        const nid = `app-${String(a?.id || idx)}`;
        const title = a?.name || '密码应用';
        const subTitle = `${a?.type ? String(a.type) : '-'}${a?.version ? ` / ${a.version}` : ''}`;
        items.push({ id: nid, type: 'appCard', w: 160, h: 60, targetHandle: 'app', data: { title, subTitle } });
      });

      if (items.length > 0) {
        const parentR = Math.sqrt((domainCardW / 2) ** 2 + (domainCardH / 2) ** 2);
        const childRs = items.map(it => Math.sqrt((it.w / 2) ** 2 + (it.h / 2) ** 2));
        const maxChildR = childRs.reduce((m, r) => Math.max(m, r), 0);
        const arc = Math.PI;
        const minArc = (maxChildR * 2 + rowGap) * items.length;
        const minRadius = minArc / arc;
        const radius = Math.max(parentR + maxChildR + baseGap, minRadius);

        const outwardAngle = Math.atan2(uy, ux);
        const startAngle = outwardAngle - arc / 2;
        const step = items.length > 1 ? arc / items.length : 0;

        items.forEach((it, idx) => {
          const ang = items.length > 1 ? (startAngle + (idx + 0.5) * step) : outwardAngle;
          const cx = parentCx + Math.cos(ang) * radius;
          const cy = parentCy + Math.sin(ang) * radius;
          nodes.push({
            id: it.id,
            type: it.type,
            position: { x: cx - it.w / 2, y: cy - it.h / 2 },
            data: it.data
          });
          edges.push({
            id: `${currentDomainNodeId}-${it.id}`,
            source: currentDomainNodeId,
            target: it.id,
            sourceHandle: 'card',
            targetHandle: it.targetHandle,
            type: 'straight',
            style: it.edgeStyle || { stroke: '#bfbfbf', strokeWidth: 1.5 }
          });
        });
      }
    }

    return (
      <PageDetailSection
        title="安全域拓扑"
      >
        <div style={{ marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ color: '#666', fontSize: 12 }}>级联通道</span>
          <Select
            size="small"
            style={{ width: 260 }}
            value={cenId}
            onChange={(v) => setSelectedCenId(String(v))}
            options={cascades.map((c: any) => ({ value: String(c?.id), label: `${c?.name || '级联通道'} (${c?.id || '-'})` }))}
            placeholder="选择级联通道"
            allowClear
          />
          <span style={{ color: '#666', fontSize: 12 }}>拓扑模式</span>
          <span style={{ fontSize: 12, color: '#333' }}>{topo || '-'}</span>
        </div>
        <div ref={setTopologyEl} style={{ height: topologyHeight, minHeight: 460, border: '1px solid #e8e8e8', borderRadius: 12, background: '#fafafa', backgroundImage: 'radial-gradient(rgba(0,0,0,0.08) 1px, transparent 1px)', backgroundSize: '22px 22px', backgroundPosition: '0 0', overflow: 'hidden', position: 'relative' }}>
          {(!cenId && apps.length === 0 && (securityServices || []).length === 0) || (topologyLoading && total === 0 && apps.length === 0 && (securityServices || []).length === 0) ? (
            <div style={{ height: topologyHeight, minHeight: 460, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
              <Empty description={topologyLoading ? '拓扑加载中' : '暂无关联级联通道或应用实例'} />
            </div>
          ) : (
            <ReactFlowProvider>
              <AutoFitFlow nodes={nodes} edges={edges} nodeTypes={topologyNodeTypes} fitSignal={`${String(cenId || '')}:${nodes.length}:${edges.length}:${topologyHeight}`} />
            </ReactFlowProvider>
          )}
        </div>
      </PageDetailSection>
    );
  };

  const tabs = [
    {
      key: 'overview',
      label: '资源总览',
      icon: <DashboardOutlined />,
      children: renderOverview(),
    },

    {
      key: 'topology',
      label: '安全域拓扑',
      icon: <DeploymentUnitOutlined />,
      children: renderTopology(),
    },
    {
      key: 'cascade',
      label: '级联通道',
      icon: <ApartmentOutlined />,
      count: data?.cascadeChannels?.length || 0,
      children: renderCascadeChannels(),
    },

    {
      key: 'apps',
      label: '应用实例',
      icon: <AppstoreOutlined />,
      count: data?.appInstances?.length || 0,
      children: renderAppInstances(),
    },
    {
      key: 'security',
      label: '安全服务',
      icon: <SafetyCertificateOutlined />,
      count: data?.securityServices?.length || 0,
      children: renderSecurityServices(),
    },
    {
      key: 'service-chains',
      label: '服务链',
      icon: <NodeIndexOutlined />,
      count: data?.serviceChains?.length || 0,
      children: renderServiceChains(),
    },
        {
      key: 'network',
      label: '网络基础设施',
      icon: <GlobalOutlined />,
      count: data?.vpcId || data?.vrUuid ? (data?.vpcId && data?.vrUuid ? 2 : 1) : 0,
      children: renderNetworkInfra(),
    },
        {
      key: 'cloud-instances',
      label: '云主机实例',
      icon: <DesktopOutlined />,
      count: data?.cloudInstances?.length || 0,
      children: renderCloudInstances(),
    },
    {
      key: 'srv6',
      label: 'SRv6 隧道',
      icon: <ShareAltOutlined />,
      count: data?.srv6Tunnels?.length || 0,
      children: renderSRv6Tunnels(),
    },
    {
      key: 'ipsec',
      label: 'IPsec VPN',
      icon: <LockOutlined />,
      count: 0,
      children: renderIPsecVPN(),
    },
    {
      key: 'nat',
      label: 'NAT',
      icon: <SwapOutlined />,
      count: data?.natRules?.length || 0,
      children: renderNAT(),
    },
    {
      key: 'acl',
      label: '网络ACL',
      icon: <SecurityScanOutlined />,
      count: data?.aclRules?.length || 0,
      children: renderNetworkACL(),
    },
    {
      key: 'bypass',
      label: '旁路阻断',
      icon: <StopOutlined />,
      count: data?.bypassPolicies?.length || 0,
      children: renderBypassBlocking(),
    },
  ];

  return (
    <PageDetailContainer
      title={data?.name || '安全域详情'}
      onBack={() => navigate('/admin/sec-mgr-plane/security-domain')}
      subtitle="资源概览与网络关系"
      overviewContent={overviewContent}
      tabs={tabs}
      defaultActiveTabKey="overview"
      moreMenuItems={[
        { key: 'refresh', label: '资源刷新' },
        { key: 'logs', label: '显示日志' },
      ]}
      onMoreMenuClick={({ key }) => {
        if (key === 'refresh') {
          setAttachmentCache({});
          setAttachmentRawCache({});
          if (id) fetchDetail(id);
          return;
        }
        if (key === 'logs') {
          setLogDrawerOpen(true);
        }
      }}
    >
      <Drawer
        title="安全域日志"
        open={logDrawerOpen}
        onClose={() => setLogDrawerOpen(false)}
        width={820}
      >
        <div style={{ maxHeight: 'calc(100vh - 160px)', overflow: 'auto' }}>
          <pre style={{ margin: 0, background: '#f7f7f7', padding: 12, borderRadius: 8, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {(() => {
              const payload = {
                fetchedAt: new Date().toISOString(),
                securityDomainId: id,
                getSecurityDomain: rawDetail,
                selectedCenId,
                fetchCenAttachments: selectedCenId ? attachmentRawCache[selectedCenId] : undefined,
              };
              try {
                return JSON.stringify(payload ?? {}, null, 2);
              } catch {
                return String(payload ?? '');
              }
            })()}
          </pre>
        </div>
      </Drawer>
    </PageDetailContainer>
  );
};

export default SecurityDomainDetail;
