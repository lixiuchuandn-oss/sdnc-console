import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Descriptions, Table, Tag, Typography, Space, Input, Select, Row, Col, Card, Statistic, Drawer, message, Button, Modal, Form } from 'antd';

import {
  GlobalOutlined,
  ShareAltOutlined,
  LockOutlined,
  AppstoreOutlined,
  SafetyCertificateOutlined,
  NodeIndexOutlined,
  DashboardOutlined,
  ApartmentOutlined,
  SwapOutlined,
  SecurityScanOutlined,
  StopOutlined,
  DesktopOutlined,
  EditOutlined,
  DisconnectOutlined
} from '@ant-design/icons';
import PageDetailContainer from '../../../../components/PageDetailContainer';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import { getSecurityDomain, updateSecurityDomain } from '../../../../services/securityDomainApi';
import { SecurityDomain } from '../index';
import { apiPost, fetchCsmElementGroups, fetchCloudProviderEcs } from '../../../../services/api';
import { fetchVrCachePageList } from '../../../../services/virtualRouterApi';

const SecurityDomainDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<SecurityDomain | null>(null);
  const [csmElementGroupMap, setCsmElementGroupMap] = useState<Record<string, any>>({});
  const [csmElementGroupsLoading, setCsmElementGroupsLoading] = useState(false);
  const [ecsIpMap, setEcsIpMap] = useState<Record<string, string>>({});
  const [changeVrOpen, setChangeVrOpen] = useState(false);
  const [vrList, setVrList] = useState<any[]>([]);
  const [vrLoading, setVrLoading] = useState(false);
  const [changeVrForm] = Form.useForm();

  const loadVrList = async () => {
    setVrLoading(true);
    try {
      // 使用 vrcache 获取 VR 列表
      const res = await fetchVrCachePageList(1000, 1);
      
      let list: any[] = [];
      const data = res?.data || res;
      if (data && Array.isArray(data.page)) {
          list = data.page;
      } else if (data && Array.isArray(data.list)) {
          list = data.list;
      } else if (Array.isArray(data)) {
          list = data;
      }
      
      // Filter out deleted VRs
      list = list.filter((item: any) => !item.is_deleted);
      
      const options = list.map((item: any) => ({
        label: `${item.name || item.uuid} ${item.role ? `[${item.role}]` : ''}`,
        value: item.uuid || item.vr_unique_id,
      }));
      setVrList(options);
    } catch (e: any) {
      console.error('Failed to load VR list', e);
      const errMsg = typeof e === 'string' ? e : (e?.message || JSON.stringify(e));
      message.error(`加载 VR 列表失败: ${errMsg}`);
    } finally {
      setVrLoading(false);
    }
  };

  const handleChangeVr = async () => {
    try {
      const values = await changeVrForm.validateFields();
      setLoading(true);
      await updateSecurityDomain(id!, {
          vrUuid: values.vrUuid,
          vrName: null, 
          vrInstanceIds: null, 
      } as any);
      message.success('VR 实例已更换');
      setChangeVrOpen(false);
      fetchDetail(id!);
    } catch (e) {
      console.error('Failed to change VR', e);
    } finally {
      setLoading(false);
    }
  };

  const handleUnbindVr = async () => {
    Modal.confirm({
      title: '确认解绑 VR',
      content: '解绑 VR 实例将清除相关的网络配置（ENI/IP），是否继续？',
      onOk: async () => {
        setLoading(true);
        try {
            await updateSecurityDomain(id!, {
              vrUuid: '',
              vrName: null,
              vrInstanceIds: null,
              vrPublicEniIds: null,
              vrPrivateEniIds: null,
              vrPublicIp: null,
              vrPrivateIp: null,
              vrPublicEip: null,
              vrPublicSubnetCidr: null,
              vrPrivateSubnetCidr: null
            } as any);
            message.success('VR 实例已解绑');
            fetchDetail(id!);
        } catch (e) {
            console.error('Unbind VR failed', e);
            message.error('解绑失败');
        } finally {
            setLoading(false);
        }
      }
    });
  };

  useEffect(() => {
    const apps = (data as any)?.appInstances || [];
    const vmApps = apps.filter((app: any) => app.type === 'vm' || app.type === 'container' || app.type === 'mixed');
    if (vmApps.length === 0) return;
    const cloudId = (data as any)?.cloudId;
    if (!cloudId) return;

    fetchCloudProviderEcs(cloudId)
      .then((res: any) => {
        const list = res?.data?.Instances?.Instance || res?.data?.servers || res?.data?.InstanceSet || res?.data || [];
        const map: Record<string, string> = {};
        if (Array.isArray(list)) {
            list.forEach((inst: any) => {
                let ip = '';
                const pubArr = inst?.PublicIpAddress?.IpAddress;
                const pub = Array.isArray(pubArr) && pubArr.length > 0 ? pubArr[0] : (inst?.EipAddress?.IpAddress || inst?.publicIpAddress || (Array.isArray(inst?.publicIps)?inst.publicIps[0]:null));
                const priArr = inst?.VpcAttributes?.PrivateIpAddress?.IpAddress;
                const pri = Array.isArray(priArr) && priArr.length > 0 ? priArr[0] : (inst?.privateIpAddress || (Array.isArray(inst?.privateIps)?inst.privateIps[0]:null));
                
                if (pub) ip = pub;
                else if (pri) ip = pri;
                
                const iid = inst?.InstanceId || inst?.id || inst?.uuid;
                if (iid && ip) {
                    map[String(iid)] = ip;
                }
            });
            setEcsIpMap(prev => ({ ...prev, ...map }));
        }
      })
      .catch(() => {});
  }, [data]);

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
  }, [data]);





  useEffect(() => {
    if (id) {
      fetchDetail(id);
    }
  }, [id]);

  const [rawDetail, setRawDetail] = useState<any>(null);

  const [logDrawerOpen, setLogDrawerOpen] = useState(false);





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
    <>
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
        <Descriptions.Item label="VR 实例">
          <Space>
            {data?.vrName || data?.vrUuid || '-'}
            <Space size={4}>
              <Button 
                type="link" 
                size="small" 
                icon={<EditOutlined />} 
                onClick={() => {
                  setChangeVrOpen(true);
                  loadVrList();
                  changeVrForm.setFieldsValue({ vrUuid: data?.vrUuid });
                }}
              >
                更换
              </Button>
              {(data?.vrUuid || data?.vrName) && (
                <Button 
                  type="link" 
                  size="small" 
                  danger 
                  icon={<DisconnectOutlined />} 
                  onClick={handleUnbindVr}
                >
                  解绑
                </Button>
              )}
            </Space>
          </Space>
        </Descriptions.Item>
        <Descriptions.Item label="状态">
          <Tag color={data?.status === 'active' ? 'success' : 'default'}>
            {data?.status || 'Unknown'}
          </Tag>
        </Descriptions.Item>
        <Descriptions.Item label="描述" span={2}>{data?.description || '-'}</Descriptions.Item>
        <Descriptions.Item label="创建时间">{data?.createdAt || '-'}</Descriptions.Item>
        <Descriptions.Item label="更新时间">{data?.updatedAt || '-'}</Descriptions.Item>
      </Descriptions>
      <Modal
        title="更换 VR 实例"
        open={changeVrOpen}
        onCancel={() => setChangeVrOpen(false)}
        onOk={handleChangeVr}
        confirmLoading={loading}
      >
        <Form form={changeVrForm} layout="vertical">
          <Form.Item 
            name="vrUuid" 
            label="选择 VR 实例" 
            rules={[{ required: true, message: '请选择 VR 实例' }]}
          >
            <Select
              placeholder="请选择 VR"
              options={vrList}
              loading={vrLoading}
              showSearch
              optionFilterProp="label"
            />
          </Form.Item>
          <div style={{ color: '#888', fontSize: 12 }}>
            注意：更换 VR 实例将清除原有的网卡绑定信息（ENI/IP），请在更换后确认网络配置。
          </div>
        </Form>
      </Modal>
    </>
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
        onChange: () => {
          // 列配置变化，无需处理
        }
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
      {
        title: '操作',
        key: 'op',
        width: 100,
        render: (_: any, r: any) => (
          <ResourceActionsDropdown
            size="small"
            items={[
              { key: 'detail', label: '查看详情' }
            ]}
            onClick={({ key }) => {
              if (key === 'detail') navigate(`/admin/sec-mgr-plane/cascade-channels/${r.id}`);
            }}
          />
        )
      }
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
          pagination={{
            size: 'small',
            showTotal: (total) => `共 ${total} 条`,
          }}
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
          pagination={{
            size: 'small',
            showTotal: (total) => `共 ${total} 条`,
          }}
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
          pagination={{
            size: 'small',
            showTotal: (total) => `共 ${total} 条`,
          }}
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
          pagination={{
            size: 'small',
            showTotal: (total) => `共 ${total} 条`,
          }}
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
          pagination={{
            size: 'small',
            showTotal: (total) => `共 ${total} 条`,
          }}
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
          pagination={{
            size: 'small',
            showTotal: (total) => `共 ${total} 条`,
          }}
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
          pagination={{
            size: 'small',
            showTotal: (total) => `共 ${total} 条`,
          }}
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
      { 
        title: '协议/端口', 
        key: 'ports', 
        render: (_: any, r: any) => {
          if (r.type === 'service_address') {
            let addrs = r.serviceAddresses || [];
            if (!addrs.length) {
                if (Array.isArray(r.instances) && r.instances.length > 0 && typeof r.instances[0] === 'object') {
                    addrs = r.instances;
                } else if (typeof r.instances === 'string') {
                    try {
                        const parsed = JSON.parse(r.instances);
                        if (Array.isArray(parsed)) addrs = parsed;
                    } catch {}
                }
            }
            if (!addrs.length) return '-';
            return addrs.map((a: any, idx: number) => (
                <div key={idx} style={{ fontSize: 12 }}>
                {a.protocol} : {a.port}
                </div>
            ));
          } else {
            const ports = (() => { try { return r.servicePorts ? (Array.isArray(r.servicePorts) ? r.servicePorts : JSON.parse(r.servicePorts)) : []; } catch { return []; } })();
            if (!ports.length) return '-';
            return ports.map((p: any, idx: number) => (
              <div key={idx} style={{ fontSize: 12 }}>
                {p.protocol} : {p.port}
              </div>
            ));
          }
        }
      },
      { 
        title: 'IP地址', 
        key: 'ips',
        render: (_: any, r: any) => {
          if (r.type === 'service_address') {
            let addrs = r.serviceAddresses || [];
            if (!addrs.length) {
                if (Array.isArray(r.instances) && r.instances.length > 0 && typeof r.instances[0] === 'object') {
                    addrs = r.instances;
                } else if (typeof r.instances === 'string') {
                    try {
                        const parsed = JSON.parse(r.instances);
                        if (Array.isArray(parsed)) addrs = parsed;
                    } catch {}
                }
            }
            if (!addrs.length) return '-';
            // De-duplicate IPs
            const ips = Array.from(new Set(addrs.map((a: any) => a.ip).filter(Boolean)));
            return ips.map((ip: any, idx: number) => <div key={idx} style={{ fontSize: 12 }}>{ip}</div>);
          } else {
            // Check instanceIps first
            let ips = r.instanceIps || [];
            if (!ips.length && r.instances) {
               // Try to resolve from map
               ips = (Array.isArray(r.instances) ? r.instances : []).map((id: string) => ecsIpMap[id]).filter(Boolean);
            }
            if (!ips.length) return '-';
            const unique = Array.from(new Set(ips));
            if (unique.length > 3) {
              return (
                <div style={{ fontSize: 12 }}>
                  {unique.slice(0, 3).map((ip: any, i: number) => <div key={i}>{ip}</div>)}
                  <div style={{ color: '#999' }}>+{unique.length - 3} more</div>
                </div>
              );
            }
            return unique.map((ip: any, idx: number) => <div key={idx} style={{ fontSize: 12 }}>{ip}</div>);
          }
        }
      },
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
          pagination={{
            size: 'small',
            showTotal: (total) => `共 ${total} 条`,
          }}
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

    const handleRemoveSecurityService = (r: any) => {
      Modal.confirm({
        title: '确认移除安全服务',
        content: `确定要移除安全服务 "${r.name || r.title || r.displayName || r.id}" 吗？`,
        okType: 'danger',
        onOk: async () => {
          try {
            const currentServices = (data?.securityServices || []).map((s: any) => s.id);
            const newServices = currentServices.filter((id: string) => id !== r.id).join(',');
            await updateSecurityDomain(id!, {
              securityServiceIds: newServices
            });
            message.success('移除成功');
            fetchDetail(id!);
          } catch (e: any) {
            message.error(`移除失败: ${e.message}`);
          }
        }
      });
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
            <ResourceActionsDropdown
              size="small"
              items={[
                { key: 'sso', label: 'SSO访问' },
                { type: 'divider' },
                { key: 'remove', label: '移除安全服务', danger: true }
              ]}
              onClick={({ key }) => {
                if (key === 'sso') handleSSO(r);
                if (key === 'remove') handleRemoveSecurityService(r);
              }}
            />
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
          pagination={{
            size: 'small',
            showTotal: (total) => `共 ${total} 条`,
          }}
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
          pagination={{
            size: 'small',
            showTotal: (total) => `共 ${total} 条`,
          }}
        />
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
