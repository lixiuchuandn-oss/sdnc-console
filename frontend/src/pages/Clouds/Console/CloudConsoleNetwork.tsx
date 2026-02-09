import React, { useState, useEffect, useMemo } from 'react';
import { Tabs, Table, Tag, Button, Space, Modal, Alert, Form, Input, Select, message, MenuProps } from 'antd';
import { ReloadOutlined, FileTextOutlined, PlusOutlined, DeleteOutlined, EyeOutlined } from '@ant-design/icons';
import ResourceActionsDropdown from '../../../components/ResourceActionsDropdown';
import { 
  fetchCloudProviderVpcs 
} from '../../../services/api';
import { 
  fetchCloudProviderOvnEips, 
  fetchCloudProviderOvnFips, 
  fetchCloudProviderOvnSnatRules, 
  fetchCloudProviderOvnDnatRules,
  createCloudProviderOvnEip
} from '../../../services/harvesterApi';
import { CloudConsoleVpcTable } from './CloudConsoleVpcTable';
import { DEFAULT_PAGINATION_CONFIG } from '../../../constants/pagination';

export interface CloudConsoleNetworkProps {
  cloudId: string;
  vpcs: any[];
  subnets: any[];
  vpcLoading: boolean;
  onRefreshVpc: () => void;
}

const CloudConsoleNetwork: React.FC<CloudConsoleNetworkProps> = ({ 
  cloudId, 
  vpcs, 
  subnets, 
  vpcLoading, 
  onRefreshVpc 
}) => {
  const [activeTab, setActiveTab] = useState('vpc');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Data states
  const [eips, setEips] = useState<any[]>([]);
  const [fips, setFips] = useState<any[]>([]);
  const [snatRules, setSnatRules] = useState<any[]>([]);
  const [dnatRules, setDnatRules] = useState<any[]>([]);

  // Create EIP Modal
  const [isCreateEipVisible, setIsCreateEipVisible] = useState(false);
  const [createEipLoading, setCreateEipLoading] = useState(false);
  const [createEipForm] = Form.useForm();

  // Metadata View
  const [metadataModalVisible, setMetadataModalVisible] = useState(false);
  const [currentMetadata, setCurrentMetadata] = useState<any>(null);

  const externalSubnets = useMemo(() => {
    return subnets.filter(s => {
      // Allow subnets with no VPC (legacy) OR explicit external network VPC
      const vpc = s.spec?.vpc || s.vpc;
      return !vpc || vpc === 'ovn-vpc-external-network';
    });
  }, [subnets]);

  const showMetadata = (record: any) => {
    setCurrentMetadata(record);
    setMetadataModalVisible(true);
  };

  const handleMenuClick = (key: string, record: any) => {
    if (key === 'metadata') {
      showMetadata(record);
    } else if (key === 'delete') {
      message.info('删除功能暂未实现');
    }
  };

  const handleCreateEip = async () => {
    try {
        const values = await createEipForm.validateFields();
        setCreateEipLoading(true);
        await createCloudProviderOvnEip(cloudId, values);
        message.success('EIP 创建成功');
        setIsCreateEipVisible(false);
        createEipForm.resetFields();
        loadData(); // Refresh list
    } catch (e: any) {
        let errMsg = e.message || '创建失败';
        try {
            const errObj = JSON.parse(errMsg);
            if (errObj && typeof errObj === 'object') {
                // Construct a more readable error message
                errMsg = errObj.message || '创建失败';
                if (errObj.error) errMsg += `: ${errObj.error}`;
                if (errObj.details) {
                    console.error('EIP Creation Error Details:', errObj.details);
                    // Optionally append detail summary if available
                    if (errObj.details.message) errMsg += ` (${errObj.details.message})`;
                }
            }
        } catch (parseError) {
            // Not a JSON string, use original message
        }
        message.error(errMsg);
    } finally {
        setCreateEipLoading(false);
    }
  };

  const loadData = async () => {
    if (!cloudId) return;
    setLoading(true);
    setError(null);
    try {
      switch (activeTab) {
        case 'vpc':
          onRefreshVpc();
          break;
        case 'eip':
          const eipsRes = await fetchCloudProviderOvnEips(cloudId);
          setEips(eipsRes?.data?.items || []);
          break;
        case 'fip':
          const fipsRes = await fetchCloudProviderOvnFips(cloudId);
          setFips(fipsRes?.data?.items || []);
          break;
        case 'snat':
          const snatRes = await fetchCloudProviderOvnSnatRules(cloudId);
          setSnatRules(snatRes?.data?.items || []);
          break;
        case 'dnat':
          const dnatRes = await fetchCloudProviderOvnDnatRules(cloudId);
          setDnatRules(dnatRes?.data?.items || []);
          break;
      }
    } catch (e: any) {
      console.error('Failed to load network data:', e);
      setError(e.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab !== 'vpc') {
      loadData();
    }
  }, [cloudId, activeTab]);

  // Columns Definitions
  const eipColumns = [
    { title: '名称', key: 'name', render: (_: any, r: any) => <b>{r.metadata?.name}</b> },
    { title: '外部子网', key: 'externalSubnet', render: (_: any, r: any) => r.spec?.externalSubnet },
    { title: 'IP地址', key: 'ip', render: (_: any, r: any) => <Tag color="blue">{r.spec?.v4Ip}</Tag> },
    { title: 'MAC地址', key: 'mac', render: (_: any, r: any) => r.spec?.macAddress },
    { title: '类型', key: 'type', render: (_: any, r: any) => r.spec?.type },
    { title: '状态', key: 'status', render: (_: any, r: any) => r.status?.ready ? <Tag color="success">Ready</Tag> : <Tag color="warning">Not Ready</Tag> },
    {
      title: '操作', key: 'action', width: 80, render: (_: any, r: any) => {
        const menuItems: MenuProps['items'] = [
          {
            key: 'metadata',
            label: '查看元数据',
            icon: <EyeOutlined />,
          },
          {
            type: 'divider',
          },
          {
            key: 'delete',
            label: '删除',
            icon: <DeleteOutlined />,
            danger: true,
          }
        ];
        return (
          <ResourceActionsDropdown 
            items={menuItems} 
            onClick={({ key }) => handleMenuClick(key, r)} 
          />
        );
      }
    }
  ];

  const fipColumns = [
    { title: '名称', key: 'name', render: (_: any, r: any) => <b>{r.metadata?.name}</b> },
    { title: 'EIP', key: 'eip', render: (_: any, r: any) => r.spec?.ovnEip },
    { title: '内部IP', key: 'ip', render: (_: any, r: any) => <Tag>{r.spec?.ipName}</Tag> },
    { title: '类型', key: 'type', render: (_: any, r: any) => r.spec?.ipType },
    { title: 'VPC', key: 'vpc', render: (_: any, r: any) => r.spec?.vpc },
    {
      title: '操作', key: 'action', width: 80, render: (_: any, r: any) => {
        const menuItems: MenuProps['items'] = [
          {
            key: 'metadata',
            label: '查看元数据',
            icon: <EyeOutlined />,
          },
          {
            type: 'divider',
          },
          {
            key: 'delete',
            label: '删除',
            icon: <DeleteOutlined />,
            danger: true,
          }
        ];
        return (
          <ResourceActionsDropdown 
            items={menuItems} 
            onClick={({ key }) => handleMenuClick(key, r)} 
          />
        );
      }
    }
  ];

  const snatColumns = [
    { title: '名称', key: 'name', render: (_: any, r: any) => <b>{r.metadata?.name}</b> },
    { title: 'CIDR', key: 'cidr', render: (_: any, r: any) => <Tag>{r.spec?.eip}</Tag> },
    { title: 'VPC', key: 'vpc', render: (_: any, r: any) => r.spec?.vpc },
    { title: 'EIP', key: 'eip', render: (_: any, r: any) => r.spec?.ovnEip },
    {
      title: '操作', key: 'action', width: 80, render: (_: any, r: any) => {
        const menuItems: MenuProps['items'] = [
          {
            key: 'metadata',
            label: '查看元数据',
            icon: <EyeOutlined />,
          },
          {
            type: 'divider',
          },
          {
            key: 'delete',
            label: '删除',
            icon: <DeleteOutlined />,
            danger: true,
          }
        ];
        return (
          <ResourceActionsDropdown 
            items={menuItems} 
            onClick={({ key }) => handleMenuClick(key, r)} 
          />
        );
      }
    }
  ];

  const dnatColumns = [
    { title: '名称', key: 'name', render: (_: any, r: any) => <b>{r.metadata?.name}</b> },
    { title: 'EIP', key: 'eip', render: (_: any, r: any) => r.spec?.ovnEip },
    { title: '端口', key: 'port', render: (_: any, r: any) => `${r.spec?.protocol} ${r.spec?.eipPort} -> ${r.spec?.internalPort}` },
    { title: '内部IP', key: 'ip', render: (_: any, r: any) => r.spec?.internalIp },
    { title: 'VPC', key: 'vpc', render: (_: any, r: any) => r.spec?.vpc },
    {
      title: '操作', key: 'action', width: 80, render: (_: any, r: any) => {
        const menuItems: MenuProps['items'] = [
          {
            key: 'metadata',
            label: '查看元数据',
            icon: <EyeOutlined />,
          },
          {
            type: 'divider',
          },
          {
            key: 'delete',
            label: '删除',
            icon: <DeleteOutlined />,
            danger: true,
          }
        ];
        return (
          <ResourceActionsDropdown 
            items={menuItems} 
            onClick={({ key }) => handleMenuClick(key, r)} 
          />
        );
      }
    }
  ];

  const items = [
    {
      label: 'VPC / 子网',
      key: 'vpc',
      children: (
        <CloudConsoleVpcTable 
          dataSource={vpcs}
          subnets={subnets}
          loading={vpcLoading}
          onRefresh={onRefreshVpc}
        />
      )
    },
    {
      label: 'EIP (公网IP)',
      key: 'eip',
      children: (
        <>
          <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'flex-end' }}>
             <Space>
               <Button type="primary" icon={<PlusOutlined />} onClick={() => setIsCreateEipVisible(true)}>创建EIP</Button>
               <Button icon={<ReloadOutlined />} onClick={loadData} loading={loading}>刷新</Button>
             </Space>
          </div>
          <Table dataSource={eips} columns={eipColumns} loading={loading} rowKey={r => r.metadata?.uid} pagination={DEFAULT_PAGINATION_CONFIG} />
        </>
      )
    },
    {
      label: 'FIP (浮动IP)',
      key: 'fip',
      children: (
        <>
          <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'flex-end' }}>
             <Button icon={<ReloadOutlined />} onClick={loadData} loading={loading}>刷新</Button>
          </div>
          <Table dataSource={fips} columns={fipColumns} loading={loading} rowKey={r => r.metadata?.uid} pagination={DEFAULT_PAGINATION_CONFIG} />
        </>
      )
    },
    {
      label: 'SNAT 规则',
      key: 'snat',
      children: (
        <>
          <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'flex-end' }}>
             <Button icon={<ReloadOutlined />} onClick={loadData} loading={loading}>刷新</Button>
          </div>
          <Table dataSource={snatRules} columns={snatColumns} loading={loading} rowKey={r => r.metadata?.uid} pagination={DEFAULT_PAGINATION_CONFIG} />
        </>
      )
    },
    {
      label: 'DNAT 规则',
      key: 'dnat',
      children: (
        <>
          <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'flex-end' }}>
             <Button icon={<ReloadOutlined />} onClick={loadData} loading={loading}>刷新</Button>
          </div>
          <Table dataSource={dnatRules} columns={dnatColumns} loading={loading} rowKey={r => r.metadata?.uid} pagination={DEFAULT_PAGINATION_CONFIG} />
        </>
      )
    }
  ];

  return (
    <>
      <Tabs  activeKey={activeTab} onChange={setActiveTab} items={items} />
      
      <Modal
        title="元数据查看"
        open={metadataModalVisible}
        onCancel={() => setMetadataModalVisible(false)}
        footer={null}
        width={800}
      >
        <Tabs items={[
          {
            key: 'raw',
            label: '原始数据',
            children: (
              <Input.TextArea
                readOnly
                autoSize={{ minRows: 10, maxRows: 20 }}
                value={currentMetadata ? JSON.stringify(currentMetadata, null, 2) : ''}
                style={{ fontFamily: 'monospace', backgroundColor: '#f5f5f5' }}
              />
            )
          }
        ]} />
      </Modal>

      <Modal
        title="创建 EIP"
        open={isCreateEipVisible}
        onCancel={() => setIsCreateEipVisible(false)}
        onOk={handleCreateEip}
        confirmLoading={createEipLoading}
      >
        <Form form={createEipForm} layout="vertical">
            <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入EIP名称' }]}>
                <Input placeholder="例如: my-eip-1" />
            </Form.Item>
            
            {externalSubnets.length === 0 && (
              <Alert
                type="warning"
                showIcon
                message="未找到外部子网"
                description={
                  <div>
                    当前没有任何可用的外部子网 (Provider Network)。
                    <br />
                    请联系管理员在 <b>云资源池管理 &gt; Kube-OVN 子网</b> 中创建一个属于 <code>ovn-vpc-external-network</code> 的子网。
                  </div>
                }
                style={{ marginBottom: 24 }}
              />
            )}

            <Form.Item name="externalSubnet" label="外部子网" rules={[{ required: true, message: '请选择外部子网' }]}>
                <Select placeholder="请选择子网">
                    {externalSubnets.map(s => {
                         const name = s.metadata?.name || s.name;
                         const cidr = s.spec?.cidrBlock || s.cidr;
                         return (
                            <Select.Option key={name} value={name}>
                                {name} ({cidr})
                            </Select.Option>
                         );
                    })}
                </Select>
            </Form.Item>
            <Form.Item name="v4Ip" label="指定IP (可选)">
                <Input placeholder="例如: 1.2.3.4 (留空自动分配)" />
            </Form.Item>
            <Form.Item name="type" label="类型" initialValue="nat">
                <Select>
                    <Select.Option value="nat">NAT</Select.Option>
                    <Select.Option value="distributed">Distributed</Select.Option>
                    <Select.Option value="centralized">Centralized</Select.Option>
                </Select>
            </Form.Item>
        </Form>
      </Modal>
    </>
  );
};

export default CloudConsoleNetwork;
