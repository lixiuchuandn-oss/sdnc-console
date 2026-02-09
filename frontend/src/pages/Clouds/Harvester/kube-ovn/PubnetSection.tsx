import React, { useMemo, useState, useEffect } from 'react';
import { Table, Tag, Space, Input, Button, Modal, Form, message, Dropdown, MenuProps, Alert, Select, Tabs } from 'antd';
import { ReloadOutlined, GlobalOutlined } from '@ant-design/icons';
import { useParams } from 'react-router-dom';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import TableColumnSettings from '../../../../components/TableColumnSettings';
import { createKubeOvnSubnet, deleteKubeOvnSubnet, fetchHarvesterNads } from '../../../../services/harvesterApi';

type Props = {
  subnets: any[];
  loading: boolean;
  onRefresh?: () => void;
};

const KubeOvnPublicNetworksSection: React.FC<Props> = ({ subnets, loading, onRefresh }) => {
  const { id: cloudId } = useParams<{ id: string }>();
  const [keyword, setKeyword] = useState<string>('');
  
  // NADs list for provider selection
  const [nads, setNads] = useState<any[]>([]);
  const [loadingNads, setLoadingNads] = useState(false);

  // Metadata View Modal
  const [metadataModalVisible, setMetadataModalVisible] = useState(false);
  const [currentMetadata, setCurrentMetadata] = useState<any>(null);

  // Create Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();

  // Load NADs when modal opens
  useEffect(() => {
    if (isModalOpen && cloudId) {
        setLoadingNads(true);
        fetchHarvesterNads(cloudId)
            .then(res => {
                const items = res?.data?.items || [];
                setNads(items);
            })
            .catch(console.error)
            .finally(() => setLoadingNads(false));
    }
  }, [isModalOpen, cloudId]);

  const providerOptions = useMemo(() => {
    // Default system provider
    const defaults = [{ 
        label: 'ovn-vpc-external-network.kube-system (默认)', 
        value: 'ovn-vpc-external-network.kube-system' 
    }];
    
    // Map NADs to provider strings: <name>.<namespace>
    const fromNads = nads.map(nad => {
        const name = nad.metadata?.name;
        const ns = nad.metadata?.namespace || 'default';
        const providerStr = `${name}.${ns}`;
        const config = JSON.parse(nad.spec?.config || '{}');
        const type = config.type || 'unknown';
        const master = config.master || config.bridge || '-';
        
        return {
            label: `${providerStr} (${type}: ${master})`,
            value: providerStr
        };
    });

    // Merge and deduplicate
    const all = [...defaults, ...fromNads];
    const unique = new Map();
    all.forEach(item => unique.set(item.value, item));
    return Array.from(unique.values());
  }, [nads]);

  const filtered = useMemo(() => {
    const kw = String(keyword || '').toLowerCase().trim();
    return (subnets || []).filter((r: any) => {
      const name = String(r?.name || r?.metadata?.name || '').toLowerCase();
      
      // Exclude system subnets that are NOT external/provider networks
      // 'join' is definitely internal. 'ovn-default' is usually internal but check provider to be safe.
      if (['join'].includes(name)) return false;

      // It is external if it has a provider configuration (and is not the default 'ovn' overlay or ends with .ovn)
      // We prioritize the 'provider' field which is now explicitly returned by the backend
      const provider = r?.provider || r?.spec?.provider;
      const isExternal = !!provider && provider.trim().length > 0 && provider !== 'ovn' && !provider.endsWith('.ovn');
      
      if (!isExternal) return false;

      if (kw && !name.includes(kw)) return false;
      return true;
    });
  }, [subnets, keyword]);

  const handleCreate = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      
      // Process excludeIps
      if (values.excludeIps && typeof values.excludeIps === 'string') {
        values.excludeIps = values.excludeIps.split(/[\n,]/).map((s: string) => s.trim()).filter(Boolean);
      }

      // Force disableGatewayCheck for provider networks
      values.disableGatewayCheck = true;
      
      await createKubeOvnSubnet(cloudId!, values);
      message.success('创建外部网络成功');
      setIsModalOpen(false);
      form.resetFields();
      onRefresh?.();
    } catch (e: any) {
      message.error(`创建失败: ${e.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = (name: string) => {
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除外部网络 ${name} 吗？此操作不可恢复，且可能影响依赖此网络的 EIP 和 NAT 功能。`,
      okType: 'danger',
      onOk: async () => {
        try {
          await deleteKubeOvnSubnet(cloudId!, name);
          message.success('删除成功');
          onRefresh?.();
        } catch (e: any) {
          message.error(`删除失败: ${e.message}`);
        }
      }
    });
  };

  const handleShowMetadata = (record: any) => {
    setCurrentMetadata(record);
    setMetadataModalVisible(true);
  };

  const allColumns = useMemo(() => [
    { 
      title: '名称', 
      key: 'name', 
      render: (_:any, r:any)=> (
        <Space>
          <GlobalOutlined />
          <span>{r?.name || r?.metadata?.name || '-'}</span>
        </Space>
      )
    },
    { title: 'CIDR', key: 'cidr', render: (_:any, r:any)=> <Tag>{r?.cidr || r?.spec?.cidr || r?.spec?.cidrBlock || '-'}</Tag> },
    { title: '网关', key: 'gateway', render: (_:any, r:any)=> r?.gateway || r?.spec?.gateway || '-' },
    { title: 'Provider', key: 'provider', render: (_:any, r:any)=> r?.provider || r?.spec?.provider || '-' },
    { title: 'VLAN', key: 'vlan', render: (_:any, r:any)=> r?.vlan || r?.spec?.vlanID || <span className="text-secondary">Untagged</span> },
    { title: '排除 IP', key: 'excludeIps', ellipsis: true, render: (_:any, r:any)=> (r?.excludeIps || r?.spec?.excludeIps || []).join(', ') || '-' },
    { title: '创建时间', key: 'createdAt', render: (_:any, r:any)=> r?.createdAt || '-' },
    {
      title: '操作',
      key: 'action',
      render: (_: any, r: any) => {
        const name = r?.name || r?.metadata?.name;
        const items: MenuProps['items'] = [
          {
              key: 'metadata',
              label: '查看 MetaData',
              onClick: () => handleShowMetadata(r)
          },
          ...(r?.links?.view ? [{
              key: 'view',
              label: '查看 SourceData',
              onClick: () => window.open(r.links.view, '_blank')
          }] : []),
          { type: 'divider' },
          {
            key: 'delete',
            label: '删除',
            danger: true,
            onClick: () => handleDelete(name)
          }
        ];
        return <ResourceActionsDropdown items={items} buttonProps={{ className: 'row-actions-trigger' }} />;
      } 
    }
  ], [handleShowMetadata, handleDelete]);

  const [tableColumns, setTableColumns] = useState<any[]>(allColumns);

  return (
    <PageDetailSection
      asCard={false}
      toolbarLeft={(
        <>
          <Input allowClear placeholder="搜索名称" value={keyword} onChange={(e)=> setKeyword(e.target.value)} className="toolbar-search" />
        </>
      )}
      toolbarRight={(
        <>
          <Button type="primary" onClick={() => setIsModalOpen(true)}>新建外部网络</Button>
          <TableColumnSettings 
            columns={allColumns} 
            onChange={setTableColumns}
            settingsKey="harvester_kubeovn_networks_table"
          />
          <Button icon={<ReloadOutlined />} onClick={onRefresh} />
        </>
      )}
    >
      <Table
        className="std-table"
        bordered
        rowKey={(r:any)=> r?.name || r?.metadata?.name || Math.random().toString(36).slice(2)}
        columns={tableColumns}
        dataSource={filtered}
        loading={loading}
        pagination={{size: 'small'}}
      />

      <Modal
        title="元数据查看"
        open={metadataModalVisible}
        onCancel={() => setMetadataModalVisible(false)}
        footer={null}
        width={800}
      >
        <Tabs items={[
            {
                key: 'json',
                label: 'Raw JSON',
                children: (
                    <Input.TextArea 
                        readOnly 
                        value={currentMetadata ? JSON.stringify(currentMetadata, null, 2) : ''} 
                        autoSize={{ minRows: 10, maxRows: 20 }}
                        className="metadata-viewer"
                    />
                )
            }
        ]} />
      </Modal>

      <Modal
        title="新建外部基础网络 (Provider Network)"
        open={isModalOpen}
        onCancel={() => setIsModalOpen(false)}
        onOk={handleCreate}
        confirmLoading={submitting}
        width={600}
        destroyOnClose
      >
        <Alert 
            type="info" 
            showIcon 
            style={{ marginBottom: 24 }}
            message="关于外部基础网络"
            description="创建一个绑定到物理接口的基础子网 (Provider Network)，用于提供 EIP 资源池、承载 NAT 出网流量以及实现与物理网络的互通。"
        />

        <Form form={form} layout="vertical">
            <Form.Item 
                name="name" 
                label="子网名称" 
                rules={[{ required: true, message: '请输入子网名称' }]}
                initialValue="ovn-vpc-external-network"
                extra="通常命名为 ovn-vpc-external-network，也可自定义"
            >
                <Input placeholder="ovn-vpc-external-network" />
            </Form.Item>

            <Form.Item 
                name="cidrBlock" 
                label="CIDR 网段" 
                rules={[
                    { required: true, message: '请输入 CIDR' },
                    { pattern: /^([0-9]{1,3}\.){3}[0-9]{1,3}\/[0-9]{1,2}$/, message: '格式错误，例: 10.0.1.0/24' }
                ]}
                extra="请输入物理网络的真实网段，例如 192.168.1.0/24"
            >
                <Input placeholder="192.168.1.0/24" />
            </Form.Item>

            <Form.Item 
                name="gateway" 
                label="网关地址" 
                rules={[
                    { required: true, message: '请输入网关地址' },
                    { pattern: /^([0-9]{1,3}\.){3}[0-9]{1,3}$/, message: '格式错误' }
                ]}
                extra="请输入物理网关地址"
            >
                <Input placeholder="192.168.1.1" />
            </Form.Item>

            <Form.Item
                name="excludeIps"
                label="排除 IP 范围 (保留 IP)"
                extra="这些 IP 将不会被分配给 EIP 或虚拟机。支持单 IP 或范围 (e.g. 192.168.1.1..192.168.1.10)，用逗号分隔。"
            >
                <Input.TextArea placeholder="192.168.1.1..192.168.1.10, 192.168.1.254" rows={3} />
            </Form.Item>

            <Form.Item 
                name="provider" 
                label="物理接口映射 (Provider)" 
                tooltip="对应 Kube-OVN 的 Provider Network 设置，指向一个已存在的 NetworkAttachmentDefinition (NAD)。格式: <network-name>.<namespace>"
                initialValue="ovn-vpc-external-network.kube-system"
                rules={[{ required: true, message: '请选择 Provider' }]}
            >
                <Select 
                    placeholder="请选择物理接口映射" 
                    options={providerOptions}
                    loading={loadingNads}
                    showSearch
                    allowClear
                    style={{ width: '100%' }}
                    filterOption={(input, option) => 
                        (option?.label ?? '').toLowerCase().includes(input.toLowerCase()) ||
                        (option?.value ?? '').toLowerCase().includes(input.toLowerCase())
                    }
                />
            </Form.Item>
            
            <Form.Item
                name="vlan"
                label="VLAN ID"
                tooltip="如果物理网络使用 VLAN 标记，请输入 VLAN ID (1-4094)。留空表示使用物理网络默认配置 (Untagged)。"
            >
                <Input placeholder="例如: 100" type="number" min={1} max={4094} />
            </Form.Item>

            <Form.Item name="protocol" hidden initialValue="IPv4"><Input /></Form.Item>
            <Form.Item name="nat" hidden initialValue={false}><Input /></Form.Item>
            <Form.Item name="allowDhcp" hidden initialValue={false}><Input /></Form.Item>
            <Form.Item name="vpc" hidden initialValue="ovn-cluster"><Input /></Form.Item>
        </Form>
      </Modal>
    </PageDetailSection>
  );
};

export default KubeOvnPublicNetworksSection;
