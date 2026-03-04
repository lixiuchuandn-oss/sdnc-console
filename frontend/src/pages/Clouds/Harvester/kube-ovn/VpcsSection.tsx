import React, { useState, useMemo, useEffect } from 'react';
import { Table, Button, Space, Modal, Input, Tag, Tooltip, Tabs, Form, Select, message, Switch, Radio } from 'antd';
import { ReloadOutlined, PlusOutlined, MinusCircleOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useParams } from 'react-router-dom';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import TableColumnSettings from '../../../../components/TableColumnSettings';
import HarvesterResourceDrawer from '../components/HarvesterOpsinfoDrawer';
import { createHarvesterVpc, fetchHarvesterNamespaces, createKubeOvnSubnet, deleteHarvesterVpc, deleteKubeOvnSubnet, updateKubeOvnSubnet, updateHarvesterVpc } from '../../../../services/harvesterApi';
import { isSystemNamespace } from '../../../../utils/harvesterUtils';

/**
 * 接口定义
 */
interface KubeOvnVpcsSectionProps {
  cloudId?: string;
  vpcs: any[];
  subnets?: any[];
  namespaces?: any[];
  loading: boolean;
  onRefresh?: (force?: boolean) => void;
  bordered?: boolean;
  showYaml?: boolean;
}

/**
 * 数据提取辅助函数 (统一处理 CRD 结构兼容性)
 */
const SafeRead = {
  name: (data: any) => data?.name || data?.metadata?.name || '',
  alias: (data: any) => data?.metadata?.annotations?.['tower.io/alias'] || '',
  displayName: (data: any) => data?.metadata?.annotations?.['tower.io/alias'] || data?.name || data?.metadata?.name || '',
  uid: (data: any) => data?.uid || data?.metadata?.uid || '',
  creationTimestamp: (data: any) => data?.createdAt || data?.metadata?.creationTimestamp,
  
  // VPC 特有字段
  vpcCidr: (data: any) => data?.cidr || data?.spec?.cidr || '-',
  vpcNamespaces: (data: any) => data?.namespaces || data?.spec?.namespaces || [],
  vpcNamespace: (data: any) => {
    // 优先取 metadata.namespace (VPC 自身的 Namespace)
    // 其次尝试从 spec.namespaces 中取第一个 (绑定的 Namespaces)
    // 最后返回 default
    const selfNs = data?.namespace || data?.metadata?.namespace;
    if (selfNs && selfNs !== 'default') return selfNs;
    
    const boundNs = data?.namespaces || data?.spec?.namespaces;
    if (Array.isArray(boundNs) && boundNs.length > 0) return boundNs[0];

    return 'default';
  },
  
  // Subnet 特有字段
  subnetVpc: (data: any) => data?.vpc || data?.spec?.vpc || 'ovn-cluster',
  subnetCidr: (data: any) => data?.cidr || data?.spec?.cidrBlock || data?.spec?.cidr || '-',
  subnetNamespace: (data: any) => {
    const provider = data?.provider || data?.spec?.provider;
    if (provider) {
       const parts = provider.split('.');
       // 倒数第二个部分通常是 Namespace (处理 Name 中可能包含点的情况)
       if (parts.length >= 2) return parts[parts.length - 2];
    }
    return '-';
  },
  subnetGateway: (data: any) => data?.gateway || data?.spec?.gateway || '-',
  subnetProtocol: (data: any) => data?.protocol || data?.spec?.protocol || 'IPv4',
  subnetPrivate: (data: any) => !!(data?.private || data?.spec?.private),
  subnetNat: (data: any) => !!(data?.nat || data?.spec?.natOutgoing),
  subnetDhcp: (data: any) => data?.allowDhcp ?? data?.spec?.enableDhcp ?? true,
  subnetExcludeIps: (data: any) => data?.excludeIps || data?.spec?.excludeIps || [],
};

// Helper
const generateResourceId = (prefix: string) => `id-${prefix}-${Math.random().toString(36).substring(2, 13)}`;

/**
 * 组件: KubeOvnVpcsSection
 * 描述: 展示 Kube-OVN VPC 列表及其关联的 Subnets
 */
const KubeOvnVpcsSection: React.FC<KubeOvnVpcsSectionProps> = ({ 
  cloudId: propCloudId,
  vpcs = [], 
  subnets = [], 
  namespaces: propNamespaces,
  loading, 
  onRefresh,
  bordered = true,
  showYaml = true,
}) => {
  // --- State ---
  const { id: paramCloudId } = useParams<{ id: string }>();
  const cloudId = propCloudId || paramCloudId;
  const [searchText, setSearchText] = useState('');
  const [namespaceFilter, setNamespaceFilter] = useState<string>('');
  const [tableColumns, setTableColumns] = useState<any[]>([]);
  
  // Drawer State
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [currentDrawerRecord, setCurrentDrawerRecord] = useState<any>(null);
  const [drawerTab, setDrawerTab] = useState<string>('detail');
  const [currentDrawerType, setCurrentDrawerType] = useState<string>('Vpc');
  
  // Create Modal State
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm();
  const [isEditVpc, setIsEditVpc] = useState(false);
  const [currentVpc, setCurrentVpc] = useState<any>(null);

  // Create Subnet State
  const [createSubnetModalVisible, setCreateSubnetModalVisible] = useState(false);
  const [creatingSubnet, setCreatingSubnet] = useState(false);
  const [subnetForm] = Form.useForm();
  const [targetVpc, setTargetVpc] = useState<string>('');
  const [targetNamespace, setTargetNamespace] = useState<string>('default');
  const [isEditSubnet, setIsEditSubnet] = useState(false);
  const [currentSubnet, setCurrentSubnet] = useState<any>(null);
  
  // Namespaces State
  const [namespaces, setNamespaces] = useState<any[]>([]);
  const [nsLoading, setNsLoading] = useState(false);

  useEffect(() => {
    // 优先使用父组件传入的 namespaces
    if (propNamespaces) {
      setNamespaces(propNamespaces);
      return;
    }

    if (cloudId) {
      setNsLoading(true);
      fetchHarvesterNamespaces(cloudId)
        .then(res => {
          setNamespaces(res?.data?.items || []);
        })
        .catch(() => {
          // silent fail
        })
        .finally(() => {
          setNsLoading(false);
        });
    }
  }, [cloudId, propNamespaces]);

  // --- Logic ---
  
  const handleOpenCreateVpc = () => {
    setIsEditVpc(false);
    setCurrentVpc(null);
    form.resetFields();
    setCreateModalVisible(true);
  };

  const handleEditVpc = (record: any) => {
    const name = SafeRead.name(record);
    const alias = SafeRead.alias(record) || name;
    const namespaces = SafeRead.vpcNamespaces(record);
    const staticRoutes = record.spec?.staticRoutes?.map((r: any) => ({
      cidr: r.cidr,
      nextHopIP: r.nextHopIP
    })) || [];

    setIsEditVpc(true);
    setCurrentVpc(record);
    form.resetFields();
    form.setFieldsValue({
      name: alias,
      namespaces,
      staticRoutes
    });
    setCreateModalVisible(true);
  };

  const handleVpcModalSubmit = async () => {
    try {
      const values = await form.validateFields();
      if (!cloudId) {
        message.error('缺少云平台 ID');
        return;
      }
      setCreating(true);

      const payload: any = {
        ...values,
        namespaces: values.namespaces || [],
        staticRoutes: values.staticRoutes || [],
      };

      if (isEditVpc && currentVpc) {
         const name = SafeRead.name(currentVpc);
         
         // Handle alias update
         payload.annotations = {
           'tower.io/alias': values.name,
         };
         delete payload.name; // remove name as it is alias

         await updateHarvesterVpc(cloudId, name, payload);
         message.success('VPC 更新成功');
      } else {
        // Generate ID for metadata.name
        const generatedName = generateResourceId('vpc');
        payload.name = generatedName;
        payload.annotations = {
          'tower.io/alias': values.name, // Store user input as alias
        };
        
        await createHarvesterVpc(cloudId, payload);
        message.success('VPC 创建成功');
      }
      
      setCreateModalVisible(false);
      form.resetFields();
      onRefresh?.(true);
    } catch (error: any) {
      message.error(`${isEditVpc ? '更新' : '创建'} VPC 失败: ${error.message}`);
    } finally {
      setCreating(false);
    }
  };

  const handleOpenCreateSubnet = (record: any) => {
    const vpcName = SafeRead.name(record);
    const ns = SafeRead.vpcNamespace(record); // 使用新的提取逻辑
    setTargetVpc(vpcName);
    setTargetNamespace(ns);
    setIsEditSubnet(false);
    setCurrentSubnet(null);
    subnetForm.resetFields();
    subnetForm.setFieldsValue({
      vpc: vpcName,
      namespace: ns,
      protocol: 'IPv4',
      nat: false,
      allowDhcp: true,
      excludeIps: [],
    });
    setCreateSubnetModalVisible(true);
  };

  const handleEditSubnet = (record: any) => {
    const name = SafeRead.name(record);
    const alias = SafeRead.alias(record) || name; // Use alias if available, fallback to name
    const vpcName = SafeRead.subnetVpc(record);
    const cidr = SafeRead.subnetCidr(record);
    const gateway = SafeRead.subnetGateway(record);
    const protocol = SafeRead.subnetProtocol(record);
    const nat = SafeRead.subnetNat(record);
    const allowDhcp = SafeRead.subnetDhcp(record);
    const excludeIps = SafeRead.subnetExcludeIps(record);
    const ns = SafeRead.subnetNamespace(record);

    setTargetVpc(vpcName);
    setTargetNamespace(ns);
    setIsEditSubnet(true);
    setCurrentSubnet(record);
    
    subnetForm.resetFields();
    subnetForm.setFieldsValue({
      name: alias,
      vpc: vpcName,
      namespace: ns,
      cidrBlock: cidr,
      gateway,
      protocol,
      nat,
      allowDhcp,
      excludeIps,
    });
    setCreateSubnetModalVisible(true);
  };

  const handleSubnetModalSubmit = async () => {
    try {
      const values = await subnetForm.validateFields();
      if (!cloudId) {
        message.error('缺少云平台 ID');
        return;
      }
      setCreatingSubnet(true);
      
      const payload: any = {
        ...values,
        vpc: targetVpc,
        namespace: targetNamespace,
        excludeIps: values.excludeIps?.filter((ip: string) => !!ip) || [],
      };

      if (isEditSubnet && currentSubnet) {
        const name = SafeRead.name(currentSubnet);
        
        // Update mode: Map frontend fields to Kube-OVN Spec fields
        payload.enableDhcp = payload.allowDhcp;
        payload.natOutgoing = payload.nat;
        delete payload.allowDhcp;
        delete payload.nat;

        // Handle alias update
        payload.annotations = {
          'tower.io/alias': values.name,
        };
        // Remove name from payload (since it's now the alias value from form)
        delete payload.name;

        await updateKubeOvnSubnet(cloudId, name, payload);
        message.success('子网更新成功');
      } else {
        // Create mode: Generate ID and set alias
        const generatedName = generateResourceId('sub');
        payload.name = generatedName;
        payload.annotations = {
          'tower.io/alias': values.name,
        };
        
        await createKubeOvnSubnet(cloudId, payload);
        message.success('子网创建成功');
      }

      setCreateSubnetModalVisible(false);
      onRefresh?.(true);
    } catch (error: any) {
      message.error(`${isEditSubnet ? '更新' : '创建'}子网失败: ${error.message}`);
    } finally {
      setCreatingSubnet(false);
    }
  };

  const handleDelete = (record: any) => {
    const name = SafeRead.name(record);
    if (!cloudId || !name) return;

    Modal.confirm({
      title: `删除 VPC: ${name}`,
      content: '确认要删除此 VPC 吗？此操作不可撤销，且会同时删除关联的子网。',
      okType: 'danger',
      onOk: async () => {
        try {
          await deleteHarvesterVpc(cloudId, name);
          message.success('删除成功');
          onRefresh?.(true);
        } catch (e: any) {
          message.error(`删除失败: ${e.message}`);
        }
      },
    });
  };

  const handleDeleteSubnet = (record: any) => {
    const name = SafeRead.name(record);
    if (!cloudId || !name) return;

    Modal.confirm({
      title: `删除子网: ${name}`,
      content: '确认要删除此子网吗？此操作不可撤销。',
      okType: 'danger',
      onOk: async () => {
        try {
          await deleteKubeOvnSubnet(cloudId, name);
          message.success('删除成功');
          onRefresh?.(true);
        } catch (e: any) {
          message.error(`删除失败: ${e.message}`);
        }
      },
    });
  };

  // 过滤逻辑
  const dataSource = useMemo(() => {
    let filtered = vpcs;

    // 搜索过滤
    if (searchText) {
      const key = searchText.toLowerCase().trim();
      filtered = filtered.filter(item => {
        const name = SafeRead.name(item).toLowerCase();
        const uid = SafeRead.uid(item).toLowerCase();
        return name.includes(key) || uid.includes(key);
      });
    }

    // 命名空间过滤
    if (namespaceFilter) {
      filtered = filtered.filter(item => {
        const nsList = SafeRead.vpcNamespaces(item);
        if (!Array.isArray(nsList)) return false;
        return nsList.includes(namespaceFilter);
      });
    }

    return filtered;
  }, [vpcs, searchText, namespaceFilter]);

  // 详情抽屉
  const handleShowYaml = (record: any, type: string) => {
    setCurrentDrawerRecord(record);
    setCurrentDrawerType(type);
    setDrawerTab(record?.links?.view ? 'view_link' : 'detail');
    setDrawerVisible(true);
  };

  // --- Columns ---

  // 子网列定义
  const subnetColumns = [
    {
      title: '子网名称',
      key: 'name',
      render: (_: any, r: any) => {
        const name = SafeRead.name(r);
        const alias = SafeRead.alias(r);
        return (
          <Space>
            <div>
              <div>{alias || name}</div>
              {alias && alias !== name && <div style={{ fontSize: 12, color: '#999' }}>{name}</div>}
            </div>
          </Space>
        );
      },
    },
    {
      title: 'CIDR',
      key: 'cidr',
      render: (_: any, r: any) => <Tag>{SafeRead.subnetCidr(r)}</Tag>,
    },
    {
      title: 'Namespace',
      key: 'namespace',
      render: (_: any, r: any) => <Tag>{SafeRead.subnetNamespace(r)}</Tag>,
    },
    {
      title: '网关',
      key: 'gateway',
      render: (_: any, r: any) => SafeRead.subnetGateway(r),
    },
    {
      title: '协议',
      key: 'protocol',
      render: (_: any, r: any) => SafeRead.subnetProtocol(r),
    },
    {
      title: '类型',
      key: 'type',
      render: (_: any, r: any) => {
        const isPrivate = SafeRead.subnetPrivate(r);
        const isNat = SafeRead.subnetNat(r);
        return (
          <Space size={4}>
            {isPrivate && <Tag color="gold">Private</Tag>}
            {isNat && <Tag color="blue">NAT</Tag>}
            {!isPrivate && !isNat && <Tag>Standard</Tag>}
          </Space>
        );
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 80,
      fixed: 'right' as const,
      render: (_: any, r: any) => {
        const items = [
          { key: 'edit', label: '编辑子网', onClick: () => handleEditSubnet(r) },
          ...(showYaml ? [{ key: 'view_yaml', label: '查看YAML', onClick: () => handleShowYaml(r, 'Subnet') }] : []),
          { type: 'divider' as const },
          { key: 'delete', label: '删除', danger: true, onClick: () => handleDeleteSubnet(r) },
        ];
        return <ResourceActionsDropdown items={items} buttonProps={{ className: 'row-actions-trigger' }} />;
      },
    },
  ];

  // VPC 列定义
  const allColumns = useMemo(() => [
    {
      title: 'VPC名称',
      key: 'name',
      render: (_: any, r: any) => {
        const name = SafeRead.name(r);
        const alias = SafeRead.alias(r);
        let tag = null;
        if (name === 'ovn-cluster') tag = <Tag color="gold">Default</Tag>;
        if (name === 'ovn-vpc-external-network') tag = <Tag color="purple">Provider</Tag>;
        
        return (
          <Space>
            <div>
               <div>{alias || name}</div>
               {alias && alias !== name && <div style={{ fontSize: 12, color: '#999' }}>{name}</div>}
            </div>
            {tag}
          </Space>
        );
      },
    },
    {
      title: 'UID',
      key: 'uid',
      render: (_: any, r: any) => {
        const uid = SafeRead.uid(r);
        if (!uid) return '-';
        return <span>{uid}</span>;
      },
    },
    {
      title: 'CIDR',
      key: 'cidr',
      render: (_: any, r: any) => <Tag>{SafeRead.vpcCidr(r)}</Tag>,
    },
    {
      title: '命名空间',
      key: 'namespace',
      render: (_: any, r: any) => {
        const ns = SafeRead.vpcNamespaces(r);
        if (Array.isArray(ns) && ns.length > 0) {
          return (
            <Space size={2} wrap>
              {ns.map((n: string) => <Tag key={n} style={{ fontSize: 10 }}>{n}</Tag>)}
            </Space>
          );
        }
        return '-';
      },
    },
    {
      title: '创建时间',
      key: 'createdAt',
      render: (_: any, r: any) => {
        const time = SafeRead.creationTimestamp(r);
        return time ? new Date(time).toLocaleString() : '-';
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 80,
      fixed: 'right' as const,
      render: (_: any, r: any) => {
        const name = SafeRead.name(r);
        const isSystem = name === 'ovn-cluster' || name === 'ovn-vpc-external-network';
        const items = [
          { key: 'edit', label: '编辑VPC', onClick: () => handleEditVpc(r) },
          { key: 'createSubnet', label: '添加子网', onClick: () => handleOpenCreateSubnet(r) },
          ...(showYaml ? [{ key: 'view_yaml', label: '查看YAML', onClick: () => handleShowYaml(r, 'Vpc') }] : []),
          ...(!isSystem ? [
            { type: 'divider' as const },
            { key: 'delete', label: '删除', danger: true, onClick: () => handleDelete(r) }
          ] : []),
        ];
        return <ResourceActionsDropdown items={items} buttonProps={{ className: 'row-actions-trigger' }} />;
      },
    },
  ], [cloudId, onRefresh]);

  // --- Render Helpers ---

  const renderExpandedRow = (record: any) => {
    const vpcName = SafeRead.name(record);
    
    // 核心关联逻辑：筛选出 spec.vpc 等于当前 VPC 名称的子网
    const relatedSubnets = subnets.filter(s => {
      const targetVpc = SafeRead.subnetVpc(s);
      return String(targetVpc).trim() === String(vpcName).trim();
    });

    if (relatedSubnets.length === 0) {
      return <div>暂无关联子网</div>;
    }

    return (
      <div style={{ padding: 12,  background: '#EDF0F7', border: '1px solid #e5e5e5', borderRadius: 8 }}>
        <Table
          columns={subnetColumns}
          dataSource={relatedSubnets}
          pagination={false}
          rowKey={(r) => SafeRead.name(r) || Math.random().toString()}
          size="small"
          bordered={bordered}
        />
      </div>
    );
  };

  // --- Main Render ---

  return (
    <PageDetailSection
      
      toolbarLeft={(
        <Space>
          <Input 
            className="toolbar-search"
            placeholder="搜索 VPC 名称或 UID" 
            value={searchText} 
            onChange={(e) => setSearchText(e.target.value)} 
            allowClear
          />
          <Select
            className="toolbar-filter"
            placeholder="筛选命名空间"
            allowClear
            showSearch
            value={namespaceFilter}
            onChange={setNamespaceFilter}
            options={namespaces.map(n => ({
              label: SafeRead.name(n),
              value: SafeRead.name(n)
            }))}
            loading={nsLoading}
          />
        </Space>
      )}
      toolbarRight={(
        <div className="toolbar-actions">
          <Button type="primary" onClick={handleOpenCreateVpc}>创建 VPC</Button>
          <TableColumnSettings 
            columns={allColumns} 
            onChange={setTableColumns}
            settingsKey="harvester_vpcs_table"
          />
          <Button icon={<ReloadOutlined />} onClick={() => onRefresh?.(true)} loading={loading} />
        </div>
      )}
    >
      <Table
        className="std-table"
        bordered={bordered}
        rowKey={(r) => SafeRead.name(r) || Math.random().toString()}
        columns={tableColumns}
        dataSource={dataSource}
        loading={loading}
        pagination={{ size: 'small', showQuickJumper: false }}
        expandable={{
          expandedRowRender: renderExpandedRow,
          rowExpandable: () => true,
        }}
      />

      <HarvesterResourceDrawer
        open={drawerVisible}
        onClose={() => setDrawerVisible(false)}
        resourceType={currentDrawerType}
        record={currentDrawerRecord}
        activeTab={drawerTab}
        onTabChange={setDrawerTab}
        cloudId={cloudId}
      />

      <Modal
        title={`${isEditSubnet ? '编辑子网' : '添加子网'} (VPC: ${targetVpc})`}
        open={createSubnetModalVisible}
        onOk={handleSubnetModalSubmit}
        onCancel={() => setCreateSubnetModalVisible(false)}
        confirmLoading={creatingSubnet}
        width={600}
        destroyOnHidden
      >
        <Form form={subnetForm} layout="vertical">
          <Form.Item
            name="name"
            label="名称"
            rules={[
              { required: true, message: '请输入子网名称' },
            ]}
          >
            <Input placeholder="请输入子网名称 (支持中文)" />
          </Form.Item>

          <Form.Item
             label="所属命名空间"
             tooltip="子网将创建在此 Namespace 中"
          >
             <Tag>{targetNamespace || '-'}</Tag>
             <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>
                * 子网必须与所属 VPC 处于同一 Namespace 范围
             </div>
          </Form.Item>

          <Form.Item
            name="cidrBlock"
            label="CIDR"
            rules={[
              { required: true, message: '请输入 CIDR' },
              { pattern: /^([0-9]{1,3}\.){3}[0-9]{1,3}\/[0-9]+$/, message: '请输入有效的 CIDR 格式 (e.g. 10.0.1.0/24)' }
            ]}
          >
            <Input placeholder="e.g. 10.0.1.0/24" />
          </Form.Item>

          <Form.Item
            name="gateway"
            label="网关"
            rules={[
              { required: true, message: '请输入网关 IP' },
              { pattern: /^([0-9]{1,3}\.){3}[0-9]{1,3}$/, message: '请输入有效的 IP 地址' }
            ]}
          >
            <Input placeholder="e.g. 10.0.1.1" />
          </Form.Item>

          <Form.Item
            name="protocol"
            label="协议"
            initialValue="IPv4"
          >
            <Radio.Group>
              <Radio.Button value="IPv4">IPv4</Radio.Button>
              <Radio.Button value="IPv6" disabled>IPv6 (暂不支持)</Radio.Button>
            </Radio.Group>
          </Form.Item>

          <Space size={24}>
            <Form.Item
              name="nat"
              label="NAT"
              valuePropName="checked"
              tooltip="是否启用 NAT 转发"
            >
              <Switch />
            </Form.Item>
            
            <Form.Item
              name="allowDhcp"
              label="DHCP"
              valuePropName="checked"
              tooltip="是否启用 DHCP 服务"
            >
              <Switch />
            </Form.Item>
          </Space>

          <Form.Item
            label="排除 IP 范围"
            tooltip="这些 IP 将不会分配给 Pod 或 VM"
            style={{ marginBottom: 0 }}
          >
            <Form.List name="excludeIps">{(fields, { add, remove }) => (
                <>
                  {fields.map(({ key, name, ...restField }) => (
                    <Space key={key} style={{ display: 'flex', marginBottom: 8 }} align="baseline">
                      <Form.Item
                        {...restField}
                        name={name}
                        rules={[{ required: true, message: '请输入 IP 或 IP 范围' }]}
                        style={{ width: 300, marginBottom: 0 }}
                      >
                        <Input placeholder="IP 或 CIDR (e.g. 10.0.1.10..10.0.1.20)" />
                      </Form.Item>
                      <MinusCircleOutlined onClick={() => remove(name)} style={{ color: '#ff4d4f' }} />
                    </Space>
                  ))}
                  <Form.Item style={{ marginTop: 8 }}>
                    <Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />}>
                      添加排除 IP
                    </Button>
                  </Form.Item>
                </>
              )}</Form.List>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={isEditVpc ? "编辑 VPC" : "创建 VPC"}
        open={createModalVisible}
        onOk={handleVpcModalSubmit}
        onCancel={() => setCreateModalVisible(false)}
        confirmLoading={creating}
        width={600}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label="名称"
            rules={[
              { required: true, message: '请输入 VPC 名称' },
            ]}
          >
            <Input placeholder="请输入 VPC 名称 (支持中文)" />
          </Form.Item>
          
          <Form.Item
            name="namespaces"
            label="绑定命名空间"
            tooltip="VPC 将接管这些命名空间下的网络流量，实现租户隔离"
          >
            <Select 
              mode="tags" 
              placeholder="选择或输入命名空间" 
              tokenSeparators={[',', ' ']} 
              style={{ width: '100%' }}
              loading={nsLoading}
              options={namespaces.map(n => {
                const name = n.metadata?.name || n.name || '';
                return { label: name, value: name };
              })}
            />
          </Form.Item>

          <Form.Item
            label="静态路由"
            tooltip="配置 VPC 内的静态路由规则"
            style={{ marginBottom: 0 }}
          >
            <Form.List name="staticRoutes">{(fields, { add, remove }) => (
                <>
                  {fields.map(({ key, name, ...restField }) => (
                    <Space key={key} style={{ display: 'flex', marginBottom: 8 }} align="baseline">
                      <Form.Item
                        {...restField}
                        name={[name, 'cidr']}
                        rules={[{ required: true, message: '请输入 CIDR' }]}
                        style={{ width: 200, marginBottom: 0 }}
                      >
                        <Input placeholder="CIDR (e.g. 192.168.0.0/24)" />
                      </Form.Item>
                      <Form.Item
                        {...restField}
                        name={[name, 'nextHopIP']}
                        rules={[{ required: true, message: '请输入下一跳 IP' }]}
                        style={{ width: 200, marginBottom: 0 }}
                      >
                        <Input placeholder="Next Hop IP" />
                      </Form.Item>
                      <MinusCircleOutlined onClick={() => remove(name)} style={{ color: '#ff4d4f' }} />
                    </Space>
                  ))}
                  <Form.Item style={{ marginTop: 8 }}>
                    <Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />}>
                      添加静态路由
                    </Button>
                  </Form.Item>
                </>
              )}</Form.List>
          </Form.Item>
        </Form>
      </Modal>
    </PageDetailSection>
  );
};

export default KubeOvnVpcsSection;
