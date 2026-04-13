import React, { useState, useEffect, useMemo } from 'react';
import { Modal, Drawer, Tabs, Table, Button, Space, Typography, Tag, message, Form, Input, Select, InputNumber, Radio, Dropdown, MenuProps } from 'antd';
import { ReloadOutlined, PlusOutlined, DeleteOutlined, DownOutlined } from '@ant-design/icons';
import { fetchCloudProviderSecurityGroupDetail, createCloudProviderSecurityGroupRule, deleteCloudProviderSecurityGroupRule } from '../../../../../services/securityGroups';

interface Props {
  open: boolean;
  onCancel: () => void;
  cloudId: string;
  securityGroup: any; // Basic info from list
  ecs?: any[];
  defaultTab?: string;
}

const RuleForm: React.FC<{ form: any; type: 'ingress' | 'egress' }> = ({ form, type }) => {
  const protocol = Form.useWatch('ipProtocol', form);
  const authType = Form.useWatch('authType', form);
  const portMin = Form.useWatch('portMin', form);
  const portMax = Form.useWatch('portMax', form);

  const handleQuickSelect = (p: string, min?: number, max?: number) => {
    form.setFieldsValue({ ipProtocol: p });
    if (min !== undefined && max !== undefined) {
      form.setFieldsValue({ portMin: min, portMax: max });
    } else {
      // For all/icmp/gre, we don't need portMin/Max visible, but reset them for logic
      form.setFieldsValue({ portMin: undefined, portMax: undefined });
    }
  };

  const menuItems: MenuProps['items'] = [
    { 
      key: 'basic', 
      label: '基本协议', 
      type: 'group',
      children: [
        { key: 'all', label: '全部协议', onClick: () => handleQuickSelect('all') },
        { key: 'tcp-all', label: '全部 TCP', onClick: () => handleQuickSelect('tcp', 1, 65535) },
        { key: 'udp-all', label: '全部 UDP', onClick: () => handleQuickSelect('udp', 1, 65535) },
        { key: 'icmp', label: '全部 ICMP', onClick: () => handleQuickSelect('icmp') },
        { key: 'gre', label: '全部 GRE', onClick: () => handleQuickSelect('gre') },
      ] 
    },
    { 
      key: 'common', 
      label: '常用协议端口', 
      type: 'group',
      children: [
        { key: 'ssh', label: 'SSH (22)', onClick: () => handleQuickSelect('tcp', 22, 22) },
        { key: 'http', label: 'HTTP (80)', onClick: () => handleQuickSelect('tcp', 80, 80) },
        { key: 'https', label: 'HTTPS (443)', onClick: () => handleQuickSelect('tcp', 443, 443) },
        { key: 'rdp', label: 'RDP (3389)', onClick: () => handleQuickSelect('tcp', 3389, 3389) },
        { key: 'mysql', label: 'MySQL (3306)', onClick: () => handleQuickSelect('tcp', 3306, 3306) },
        { key: 'redis', label: 'Redis (6379)', onClick: () => handleQuickSelect('tcp', 6379, 6379) },
      ] 
    }
  ];

  const getQuickSelectLabel = () => {
    if (protocol === 'all') return '基本协议 / 全部协议';
    if (protocol === 'icmp') return '基本协议 / 全部 ICMP';
    if (protocol === 'gre') return '基本协议 / 全部 GRE';
    if (protocol === 'tcp') {
      if (portMin === 1 && portMax === 65535) return '基本协议 / 全部 TCP';
      if (portMin === 22 && portMax === 22) return '常用协议端口 / SSH (22)';
      if (portMin === 80 && portMax === 80) return '常用协议端口 / HTTP (80)';
      if (portMin === 443 && portMax === 443) return '常用协议端口 / HTTPS (443)';
      if (portMin === 3389 && portMax === 3389) return '常用协议端口 / RDP (3389)';
      if (portMin === 3306 && portMax === 3306) return '常用协议端口 / MySQL (3306)';
      if (portMin === 6379 && portMax === 6379) return '常用协议端口 / Redis (6379)';
      return '自定义 TCP';
    }
    if (protocol === 'udp') {
      if (portMin === 1 && portMax === 65535) return '基本协议 / 全部 UDP';
      return '自定义 UDP';
    }
    return '快速选择协议端口';
  };

  return (
    <Form form={form} layout="vertical">
      <Form.Item name="authType" label="授权对象类型" initialValue="cidr">
        <Radio.Group buttonStyle="solid">
          <Radio.Button value="cidr">CIDR IP段</Radio.Button>
          <Radio.Button value="group">安全组</Radio.Button>
        </Radio.Group>
      </Form.Item>
      
      <Form.Item name="policy" label="授权策略" initialValue="accept" rules={[{ required: true }]}>
        <Radio.Group>
          <Radio value="accept">允许 (Accept)</Radio>
          <Radio value="drop">拒绝 (Drop)</Radio>
        </Radio.Group>
      </Form.Item>

      <Form.Item name="priority" label="优先级 (1-100)" initialValue={1} rules={[{ required: true }]}>
        <InputNumber min={1} max={100} style={{ width: '100%' }} />
      </Form.Item>

      <Form.Item label="协议端口">
        <Space direction="vertical" style={{ width: '100%' }}>
          <Dropdown menu={{ items: menuItems }} trigger={['click']}>
            <Button style={{ width: '100%', textAlign: 'left' }}>
              <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                {getQuickSelectLabel()}
                <DownOutlined style={{ fontSize: 10, color: '#aaa' }} />
              </Space>
            </Button>
          </Dropdown>
          
          <Space.Compact style={{ width: '100%' }}>
            <Form.Item name="ipProtocol" noStyle initialValue="tcp" rules={[{ required: true }]}>
              <Select style={{ width: '30%' }} options={[
                { label: 'TCP', value: 'tcp' },
                { label: 'UDP', value: 'udp' },
                { label: 'ICMP', value: 'icmp' },
                { label: 'GRE', value: 'gre' },
                { label: 'ALL', value: 'all' },
              ]} />
            </Form.Item>
            
            {(protocol === 'tcp' || protocol === 'udp') ? (
              <>
                <Form.Item name="portMin" noStyle rules={[{ required: true, message: '请输入' }]}>
                  <InputNumber min={1} max={65535} placeholder="起始" style={{ width: '35%', textAlign: 'center' }} />
                </Form.Item>
                <Input style={{ width: '30px', borderLeft: 0, borderRight: 0, pointerEvents: 'none', backgroundColor: '#fff' }} placeholder="-" disabled />
                <Form.Item name="portMax" noStyle rules={[{ required: true, message: '请输入' }]}>
                  <InputNumber min={1} max={65535} placeholder="结束" style={{ width: '35%', textAlign: 'center' }} />
                </Form.Item>
              </>
            ) : (
              <Input style={{ width: '70%' }} disabled value={protocol === 'icmp' || protocol === 'gre' || protocol === 'all' ? '全部 (-1/-1)' : ''} />
            )}
          </Space.Compact>
        </Space>
      </Form.Item>

      {authType === 'cidr' && (
        <Form.Item 
          name="cidrIp" 
          label={type === 'ingress' ? "源端 IP (SourceCidrIp)" : "目的端 IP (DestCidrIp)"} 
          rules={[{ required: true, message: '请输入 IP 段' }]}
          initialValue="0.0.0.0/0"
        >
          <Input placeholder="e.g. 10.0.0.0/8" />
        </Form.Item>
      )}

      {authType === 'group' && (
        <Form.Item 
          name="sourceGroupId" 
          label={type === 'ingress' ? "源端安全组 ID" : "目的端安全组 ID"} 
          rules={[{ required: true, message: '请输入安全组 ID' }]}
        >
          <Input placeholder="sg-xxxx" />
        </Form.Item>
      )}

      <Form.Item name="description" label="描述">
        <Input.TextArea rows={2} />
      </Form.Item>
    </Form>
  );
};

const SecurityGroupDetailModalAliyun: React.FC<Props> = ({ open, onCancel, cloudId, securityGroup, ecs, defaultTab }) => {
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<any>(null);
  const [activeTab, setActiveTab] = useState('ingress');

  useEffect(() => {
    if (open && defaultTab) {
      setActiveTab(defaultTab);
    } else if (open) {
      setActiveTab('ingress');
    }
  }, [open, defaultTab]);
  
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [form] = Form.useForm();

  const loadDetail = async () => {
    if (!cloudId || !securityGroup?.SecurityGroupId && !securityGroup?.id) return;
    const sgId = securityGroup.SecurityGroupId || securityGroup.id;
    setLoading(true);
    try {
      const res = await fetchCloudProviderSecurityGroupDetail(cloudId, sgId);
      // Data structure check
      // Aliyun: res.data.SecurityGroupAttribute.Permissions.Permission[]
      // Or res.data.Permissions.Permission[]
      const raw = res?.data?.SecurityGroupAttribute || res?.data || {};
      setDetail(raw);
    } catch (e: any) {
      message.error(e.message || '获取详情失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      loadDetail();
    } else {
      setDetail(null);
    }
  }, [open, cloudId, securityGroup]);

  const rules = useMemo(() => {
    const list = detail?.Permissions?.Permission || [];
    return Array.isArray(list) ? list : [];
  }, [detail]);

  const ingressRules = useMemo(() => rules.filter((r: any) => r.Direction === 'ingress'), [rules]);
  const egressRules = useMemo(() => rules.filter((r: any) => r.Direction === 'egress'), [rules]);

  const associatedInstances = useMemo(() => {
    if (!ecs || !securityGroup) return [];
    const sgId = securityGroup.SecurityGroupId || securityGroup.id;
    return ecs.filter((inst: any) => {
      const sgIds = inst?.SecurityGroupIds?.SecurityGroupId;
      return Array.isArray(sgIds) && sgIds.includes(sgId);
    });
  }, [ecs, securityGroup]);

  const handleCreateRule = async () => {
    try {
      const values = await form.validateFields();
      const sgId = securityGroup.SecurityGroupId || securityGroup.id;
      setCreateLoading(true);

      let portRange = '-1/-1';
      if (['tcp', 'udp'].includes(values.ipProtocol)) {
        const min = values.portMin ?? 1;
        const max = values.portMax ?? 65535;
        portRange = `${min}/${max}`;
      }

      const payload: any = {
        direction: activeTab,
        ipProtocol: values.ipProtocol,
        portRange: portRange,
        policy: values.policy,
        priority: values.priority,
        description: values.description,
        nicType: 'intranet',
      };

      if (values.authType === 'cidr') {
        payload.cidrIp = values.cidrIp;
      } else {
        payload.sourceGroupId = values.sourceGroupId;
      }

      await createCloudProviderSecurityGroupRule(cloudId, sgId, payload);
      message.success('规则添加成功');
      setCreateModalOpen(false);
      loadDetail();
    } catch (e: any) {
      message.error(e.message || '添加规则失败');
    } finally {
      setCreateLoading(false);
    }
  };

  const handleDeleteRule = async (record: any) => {
    Modal.confirm({
      title: '确认删除该规则?',
      content: `协议: ${record.IpProtocol}, 端口: ${record.PortRange}, 对象: ${record.SourceCidrIp || record.DestCidrIp || record.SourceGroupId || record.DestGroupId}`,
      okType: 'danger',
      onOk: async () => {
        const sgId = securityGroup.SecurityGroupId || securityGroup.id;
        try {
          const payload: any = {
            direction: record.Direction,
            ipProtocol: record.IpProtocol,
            portRange: record.PortRange,
            policy: record.Policy, // Aliyun delete needs policy? Not strictly, but helpful for matching
            priority: record.Priority,
            nicType: record.NicType,
            description: record.Description, // Not needed for identification usually
          };

          if (record.SourceCidrIp) payload.cidrIp = record.SourceCidrIp;
          else if (record.DestCidrIp) payload.cidrIp = record.DestCidrIp;
          else if (record.SourceGroupId) payload.sourceGroupId = record.SourceGroupId;
          else if (record.DestGroupId) payload.sourceGroupId = record.DestGroupId;

          await deleteCloudProviderSecurityGroupRule(cloudId, sgId, payload);
          message.success('规则删除成功');
          loadDetail();
        } catch (e: any) {
          message.error(e.message || '删除失败');
        }
      }
    });
  };

  const columns = [
    { title: '优先级', dataIndex: 'Priority', width: 80 },
    { title: '策略', dataIndex: 'Policy', width: 80, render: (t: string) => <Tag color={t === 'Accept' ? 'green' : 'red'}>{t}</Tag> },
    { title: '协议', dataIndex: 'IpProtocol', width: 80, render: (t: string) => t.toUpperCase() },
    { 
      title: '端口范围', 
      dataIndex: 'PortRange', 
      width: 120,
      render: (t: string) => {
        if (!t) return '-';
        const [min, max] = t.split('/');
        if (min === max) return min;
        if (min === '-1' && max === '-1') return '全部';
        return t;
      }
    },
    { 
      title: '授权对象', 
      key: 'target', 
      render: (_: any, r: any) => {
        const cidr = r.SourceCidrIp || r.DestCidrIp;
        const sg = r.SourceGroupId || r.DestGroupId;
        return cidr || sg || '-';
      } 
    },
    { title: '描述', dataIndex: 'Description', ellipsis: true },
    { title: '创建时间', dataIndex: 'CreateTime', width: 180 },
    {
      title: '操作',
      key: 'action',
      width: 80,
      render: (_: any, r: any) => (
        <Button type="text" danger icon={<DeleteOutlined />} onClick={() => handleDeleteRule(r)} />
      )
    }
  ];

  const currentRules = activeTab === 'ingress' ? ingressRules : egressRules;

  const instanceColumns = [
    { title: '实例ID/名称', key: 'id', render: (_: any, r: any) => <span>{r.InstanceName || r.name}<br/><span style={{fontSize:12, color:'#999'}}>{r.InstanceId || r.id}</span></span> },
    { title: '状态', key: 'status', dataIndex: 'Status', render: (t: string) => t },
    { title: 'IP地址', key: 'ip', render: (_: any, r: any) => {
        const pub = r?.PublicIpAddress?.IpAddress?.[0] || r?.EipAddress?.IpAddress || '-';
        const pri = r?.VpcAttributes?.PrivateIpAddress?.IpAddress?.[0] || r?.privateIpAddress || '-';
        return <span>公: {pub}<br/>私: {pri}</span>;
    }},
    { title: '创建时间', dataIndex: 'CreationTime', render: (t: string) => { try { return new Date(t).toLocaleString(); } catch { return t; } } }
  ];

  return (
    <>
      <Drawer
        open={open}
        onClose={onCancel}
        width={1000}
        title={`安全组详情 - ${securityGroup?.SecurityGroupName || securityGroup?.name || ''}`}
        footer={<Button onClick={onCancel}>关闭</Button>}
      >
        <div style={{ marginBottom: 16 }}>
          <Typography.Text type="secondary">ID: {securityGroup?.SecurityGroupId || securityGroup?.id}</Typography.Text>
          <span style={{ margin: '0 16px' }}>|</span>
          <Typography.Text type="secondary">VPC: {securityGroup?.VpcId || securityGroup?.vpc_id}</Typography.Text>
          <span style={{ margin: '0 16px' }}>|</span>
          <Typography.Text type="secondary">{securityGroup?.Description || securityGroup?.description}</Typography.Text>
        </div>

        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          tabBarExtraContent={
            activeTab !== 'instances' && (
              <Space>
                <Button icon={<PlusOutlined />} type="primary" onClick={() => { form.resetFields(); setCreateModalOpen(true); }}>添加规则</Button>
                <Button icon={<ReloadOutlined />} onClick={loadDetail} loading={loading} />
              </Space>
            )
          }
          items={[
            { label: '入方向规则 (Ingress)', key: 'ingress' },
            { label: '出方向规则 (Egress)', key: 'egress' },
            { label: `关联实例 (${associatedInstances.length})`, key: 'instances' },
          ]}
        />

        {activeTab === 'instances' ? (
          <Table
            dataSource={associatedInstances}
            columns={instanceColumns}
            rowKey={(r: any) => r.InstanceId || r.id}
            pagination={{
              size: 'small',
              showTotal: (total) => `共 ${total} 条`,
            }}
            size="small"
          />
        ) : (
          <Table
            dataSource={currentRules}
            columns={columns}
            rowKey={(r) => `${r.IpProtocol}-${r.PortRange}-${r.SourceCidrIp || r.DestCidrIp || r.SourceGroupId || r.DestGroupId}-${r.Priority}`}
            pagination={{
              size: 'small',
              showTotal: (total) => `共 ${total} 条`,
            }}
            loading={loading}
            size="small"
          />
        )}
      </Drawer>

      <Drawer
        title={`添加${activeTab === 'ingress' ? '入方向' : '出方向'}规则`}
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        width={720}
        destroyOnHidden
        footer={
          <Space style={{ float: 'right' }}>
            <Button onClick={() => setCreateModalOpen(false)}>取消</Button>
            <Button type="primary" onClick={handleCreateRule} loading={createLoading}>添加</Button>
          </Space>
        }
      >
        <RuleForm form={form} type={activeTab as any} />
      </Drawer>
    </>
  );
};

export default SecurityGroupDetailModalAliyun;
