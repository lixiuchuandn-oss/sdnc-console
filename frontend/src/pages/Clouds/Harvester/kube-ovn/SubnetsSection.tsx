import React, { useMemo, useState, useEffect } from 'react';
import { Table, Tag, Space, Input, Select, Button, Modal, Form, message, Dropdown, MenuProps, Radio, Alert, Checkbox, Row, Col, Tabs } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useParams } from 'react-router-dom';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import TableColumnSettings from '../../../../components/TableColumnSettings';
import { createKubeOvnSubnet, deleteKubeOvnSubnet, updateKubeOvnSubnet } from '../../../../services/harvesterApi';

type Props = {
  subnets: any[];
  vpcList?: any[];
  loading: boolean;
  onRefresh?: (force?: boolean) => void;
};

const KubeOvnSubnetsSection: React.FC<Props> = ({ subnets, vpcList = [], loading, onRefresh }) => {
  const { id: cloudId } = useParams<{ id: string }>();
  const [keyword, setKeyword] = useState<string>('');
  const [vpc, setVpc] = useState<string | undefined>(undefined);
  const [protocol, setProtocol] = useState<string | undefined>(undefined);
  const [nat, setNat] = useState<string | undefined>(undefined);
  const [dhcp, setDhcp] = useState<string | undefined>(undefined);
  const [tableColumns, setTableColumns] = useState<any[]>([]);

  // Create/Edit Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [currentSubnet, setCurrentSubnet] = useState<any>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();
  
  // Metadata View Modal
  const [metadataModalVisible, setMetadataModalVisible] = useState(false);
  const [currentMetadata, setCurrentMetadata] = useState<any>(null);

  // Fetch VPCs logic removed - now using props


  const vpcOptions = useMemo(() => {
    const set = new Set<string>();
    for (const s of subnets || []) {
      const v = String(s?.vpc || s?.spec?.vpc || '').trim();
      // Only exclude if it's strictly empty. ovn-cluster is now allowed for ovn-default subnet.
      if (v) set.add(v);
    }
    return Array.from(set).map((x) => ({ label: x, value: x }));
  }, [subnets]);

  const protocolOptions = useMemo(() => {
    const set = new Set<string>();
    for (const s of subnets || []) {
      const p = String(s?.protocol || '').trim();
      if (p) set.add(p);
    }
    return Array.from(set).map((x) => ({ label: x, value: x }));
  }, [subnets]);

  const filtered = useMemo(() => {
    const kw = String(keyword || '').toLowerCase().trim();
    return (subnets || []).filter((r: any) => {
      const vpcVal = String(r?.vpc || r?.spec?.vpc || '');
      const name = String(r?.name || r?.metadata?.name || '').toLowerCase();
      
      // Exclude public networks (those with a provider, unless it's the default 'ovn' overlay or ends with .ovn)
      // We rely solely on the provider configuration, ignoring name patterns
      const provider = r?.provider || r?.spec?.provider;
      const isPublic = !!provider && provider.trim().length > 0 && provider !== 'ovn' && !provider.endsWith('.ovn');
      
      if (isPublic) return false;

      // 'join' subnet is system reserved
      // if (name === 'join') return false;

      if (kw && !name.includes(kw)) return false;
      if (vpc) {
        if (vpcVal !== vpc) return false;
      }
      if (protocol) {
        const p = String(r?.protocol || '');
        if (p !== protocol) return false;
      }
      if (nat) {
        const val = r?.nat ? 'on' : 'off';
        if (val !== nat) return false;
      }
      if (dhcp) {
        const val = r?.allowDhcp ? 'on' : 'off';
        if (val !== dhcp) return false;
      }
      return true;
    });
  }, [subnets, keyword, vpc, protocol, nat, dhcp]);

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      
      // Process excludeIps
      if (values.excludeIps && typeof values.excludeIps === 'string') {
        values.excludeIps = values.excludeIps.split(/[\n,]/).map((s: string) => s.trim()).filter(Boolean);
      }
      
      if (isEditMode && currentSubnet) {
        const name = currentSubnet.name || currentSubnet.metadata?.name;
        await updateKubeOvnSubnet(cloudId!, name, values);
        message.success('更新子网成功');
      } else {
        await createKubeOvnSubnet(cloudId!, values);
        message.success('创建子网成功');
      }
      
      setIsModalOpen(false);
      setIsEditMode(false);
      setCurrentSubnet(null);
      form.resetFields();
      onRefresh?.(true);
    } catch (e: any) {
      message.error(`${isEditMode ? '更新' : '创建'}失败: ${e.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = (record: any) => {
    setIsEditMode(true);
    setCurrentSubnet(record);
    
    const name = record.name || record.metadata?.name;
    const vpcVal = record.vpc || record.spec?.vpc;
    const cidr = record.cidrBlock || record.spec?.cidrBlock;
    const gateway = record.gateway || record.spec?.gateway;
    const protocol = record.protocol || record.spec?.protocol || 'IPv4';
    const excludeIps = record.excludeIps || record.spec?.excludeIps || [];
    
    // Check various locations for nat/dhcp as they might be flat or in spec
    const nat = record.nat ?? record.spec?.natOutgoing ?? true;
    const allowDhcp = record.allowDhcp ?? true;

    form.setFieldsValue({
      name,
      vpc: vpcVal,
      cidrBlock: cidr,
      gateway,
      protocol,
      nat,
      allowDhcp,
      excludeIps: Array.isArray(excludeIps) ? excludeIps.join(',') : excludeIps
    });
    
    setIsModalOpen(true);
  };

  const handleDelete = (name: string) => {
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除子网 ${name} 吗？此操作不可恢复。`,
      okType: 'danger',
      onOk: async () => {
        try {
          await deleteKubeOvnSubnet(cloudId!, name);
          message.success('删除成功');
          onRefresh?.(true);
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
      title: '子网名称', 
      key: 'name', 
      render: (_: any, r: any) => <b>{r?.name || r?.metadata?.name}</b> 
    },
    { 
      title: 'CIDR', 
      key: 'cidr', 
      render: (_: any, r: any) => <Tag color="blue">{r?.cidrBlock || '-'}</Tag> 
    },
    { 
      title: 'VPC', 
      key: 'vpc', 
      render: (_: any, r: any) => r?.vpc || r?.spec?.vpc || '-' 
    },
    { 
      title: '网关', 
      key: 'gateway', 
      render: (_: any, r: any) => r?.gateway || '-' 
    },
    { 
      title: '协议', 
      key: 'protocol', 
      render: (_: any, r: any) => r?.protocol || 'IPv4' 
    },
    { 
      title: 'NAT', 
      key: 'nat', 
      render: (_: any, r: any) => r?.nat ? <Tag color="green">开启</Tag> : <Tag>关闭</Tag> 
    },
    { 
      title: 'DHCP', 
      key: 'dhcp', 
      render: (_: any, r: any) => r?.allowDhcp ? <Tag color="green">开启</Tag> : <Tag>关闭</Tag> 
    },
    { 
      title: '操作', 
      key: 'actions', 
      render: (_: any, r: any) => {
        const name = r?.name || r?.metadata?.name;
        return (
          <ResourceActionsDropdown items={[
            { key: 'metadata', label: '查看 MetaData', onClick: () => handleShowMetadata(r) },
            { 
              key: 'edit', 
              label: '编辑', 
              onClick: () => handleEdit(r) 
            },
            { type: 'divider' },
            { 
              key: 'delete', 
              label: '删除', 
              danger: true, 
              onClick: () => handleDelete(name) 
            }
          ]} buttonProps={{ className: 'row-actions-trigger' }} />
        );
      } 
    }
  ], []);

  return (
    <PageDetailSection
      asCard={false}
      toolbarLeft={(
        <>
          <Input allowClear placeholder="搜索名称" value={keyword} onChange={(e)=> setKeyword(e.target.value)} className="toolbar-search" />
          <Select allowClear placeholder="VPC" options={vpcOptions} value={vpc} onChange={(v)=> setVpc(v)} className="toolbar-filter" />
          <Select allowClear placeholder="协议" options={protocolOptions} value={protocol} onChange={(v)=> setProtocol(v)} className="toolbar-filter-sm" />
          <Select allowClear placeholder="NAT" options={[{ label:'启用', value:'on' }, { label:'关闭', value:'off' }]} value={nat} onChange={(v)=> setNat(v)} className="toolbar-filter-sm" />
          <Select allowClear placeholder="DHCP" options={[{ label:'启用', value:'on' }, { label:'关闭', value:'off' }]} value={dhcp} onChange={(v)=> setDhcp(v)} className="toolbar-filter-sm" />
        </>
      )}
      toolbarRight={(
        <>
          <Button type="primary" onClick={() => { setIsEditMode(false); setCurrentSubnet(null); form.resetFields(); setIsModalOpen(true); }}>新建子网</Button>
          <TableColumnSettings 
            columns={allColumns} 
            onChange={setTableColumns}
            settingsKey="harvester_subnets_table"
          />
          <Button icon={<ReloadOutlined />} onClick={() => onRefresh?.(true)} />
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
        title={isEditMode ? "编辑业务私有子网" : "新建业务私有子网 (VPC Subnet)"}
        open={isModalOpen}
        onCancel={() => setIsModalOpen(false)}
        onOk={handleSubmit}
        confirmLoading={submitting}
        width={600}
        destroyOnClose
      >
        {!isEditMode && <Alert 
            type="info" 
            showIcon 
            style={{ marginBottom: 16 }}
            message="创建业务私有子网"
            description="此操作将创建 VPC 内部的隔离网络，用于托管虚拟机并通过 NAT 访问外部网络。"
        />}

        <Form form={form} layout="vertical">
                <>
                    <Form.Item 
                        name="name" 
                        label="子网名称" 
                        rules={[{ required: true, message: '请输入子网名称' }]}
                    >
                        <Input placeholder="例如: web-subnet-01" style={{ width: '100%' }} disabled={isEditMode} />
                    </Form.Item>
                    
                    <Form.Item 
                        name="vpc" 
                        label="所属 VPC" 
                        rules={[{ required: true, message: '请选择 VPC' }]}
                    >
                        <Select placeholder="请选择 VPC" style={{ width: '100%' }} disabled={isEditMode}>
                            {vpcList.map(v => (
                                <Select.Option key={v.name} value={v.name}>
                                    {v.name} (UID: {v.uid})
                                </Select.Option>
                            ))}
                        </Select>
                    </Form.Item>

                    <Row gutter={16}>
                        <Col span={12}>
                            <Form.Item 
                                name="cidrBlock" 
                                label="CIDR 网段" 
                                rules={[
                                    { required: true, message: '请输入 CIDR' },
                                    { pattern: /^([0-9]{1,3}\.){3}[0-9]{1,3}\/[0-9]{1,2}$/, message: '格式错误' }
                                ]}
                            >
                                <Input placeholder="10.0.1.0/24" style={{ width: '100%' }} disabled={isEditMode} />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item 
                                name="gateway" 
                                label="网关地址" 
                                rules={[
                                    { required: true, message: '请输入网关地址' },
                                    { pattern: /^([0-9]{1,3}\.){3}[0-9]{1,3}$/, message: '格式错误' }
                                ]}
                            >
                                <Input placeholder="10.0.1.1" style={{ width: '100%' }} />
                            </Form.Item>
                        </Col>
                    </Row>

                    <Form.Item name="protocol" label="IP 协议" initialValue="IPv4">
                        <Radio.Group disabled={isEditMode}>
                            <Radio value="IPv4">IPv4</Radio>
                            <Radio value="IPv6" disabled>IPv6 (暂不支持)</Radio>
                        </Radio.Group>
                    </Form.Item>

                    <Row gutter={16}>
                        <Col span={12}>
                            <Form.Item name="nat" valuePropName="checked" initialValue={true}>
                                <Checkbox>启用 NAT 出网</Checkbox>
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item name="allowDhcp" valuePropName="checked" initialValue={true}>
                                <Checkbox>启用 DHCP 服务</Checkbox>
                            </Form.Item>
                        </Col>
                    </Row>

                    <Form.Item
                        name="excludeIps"
                        label="排除 IP 范围 (保留 IP)"
                        extra="这些 IP 将不会被分配给虚拟机。支持单 IP 或范围 (e.g. 10.0.1.1..10.0.1.10)，用逗号分隔。"
                    >
                        <Input.TextArea placeholder="10.0.1.1..10.0.1.10" rows={3} />
                    </Form.Item>
                </>
        </Form>
      </Modal>
    </PageDetailSection>
  );
};

export default KubeOvnSubnetsSection;
