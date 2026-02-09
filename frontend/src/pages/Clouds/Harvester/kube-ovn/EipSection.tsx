import React, { useState } from 'react';
import { Table, Tag, Button, Space, Modal, Form, Input, Select, message, Alert, MenuProps } from 'antd';
import { ReloadOutlined, PlusOutlined, DeleteOutlined, EyeOutlined } from '@ant-design/icons';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import { createCloudProviderOvnEip, deleteCloudProviderOvnEip } from '../../../../services/harvesterApi';
import { DEFAULT_PAGINATION_CONFIG } from '../../../../constants/pagination';
import MetadataModal from './MetadataModal';

interface BaseSectionProps {
  cloudId: string;
  loading: boolean;
  onRefresh: () => void;
}

interface EipSectionProps extends BaseSectionProps {
  eips: any[];
  subnets: any[]; // Needed for creating EIP (external subnets)
}

export const EipSection: React.FC<EipSectionProps> = ({ cloudId, eips, subnets, loading, onRefresh }) => {
  const [isCreateVisible, setIsCreateVisible] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [form] = Form.useForm();
  const [metadataRecord, setMetadataRecord] = useState<any>(null);

  const externalSubnets = subnets.filter(s => {
    const vpc = s.spec?.vpc || s.vpc;
    return !vpc || vpc === 'ovn-vpc-external-network';
  });

  const handleCreate = async () => {
    try {
      const values = await form.validateFields();
      setCreateLoading(true);
      await createCloudProviderOvnEip(cloudId, values);
      message.success('EIP 创建成功');
      setIsCreateVisible(false);
      form.resetFields();
      onRefresh();
    } catch (e: any) {
      let errMsg = e.message || '创建失败';
      try {
        const errObj = JSON.parse(errMsg);
        if (errObj && typeof errObj === 'object') {
          errMsg = errObj.message || errMsg;
          if (errObj.error) errMsg += `: ${errObj.error}`;
        }
      } catch (parseError) {
        // ignore
      }
      message.error(errMsg);
    } finally {
      setCreateLoading(false);
    }
  };

  const handleMenuClick = async (key: string, record: any) => {
    if (key === 'metadata') {
      setMetadataRecord(record);
    } else if (key === 'delete') {
      Modal.confirm({
        title: '确认删除',
        content: `确定要删除 EIP ${record.metadata?.name} 吗？`,
        okText: '删除',
        okType: 'danger',
        cancelText: '取消',
        onOk: async () => {
          try {
            await deleteCloudProviderOvnEip(cloudId, record.metadata?.name);
            message.success('删除成功');
            onRefresh();
          } catch (e: any) {
            message.error(`删除失败: ${e.message}`);
          }
        }
      });
    }
  };

  const columns = [
    { title: '名称', key: 'name', render: (_: any, r: any) => <b>{r.metadata?.name}</b> },
    { title: '外部子网', key: 'externalSubnet', render: (_: any, r: any) => r.spec?.externalSubnet },
    { title: 'IP地址', key: 'ip', render: (_: any, r: any) => <Tag color="blue">{r.spec?.v4Ip}</Tag> },
    { title: 'MAC地址', key: 'mac', render: (_: any, r: any) => r.spec?.macAddress },
    { title: '类型', key: 'type', render: (_: any, r: any) => r.spec?.type },
    { title: '状态', key: 'status', render: (_: any, r: any) => r.status?.ready ? <Tag color="success">Ready</Tag> : <Tag color="warning">Not Ready</Tag> },
    {
      title: '操作', key: 'action', width: 80, render: (_: any, r: any) => {
        const menuItems: MenuProps['items'] = [
          { key: 'metadata', label: '查看元数据', icon: <EyeOutlined /> },
          { type: 'divider' },
          { key: 'delete', label: '删除', icon: <DeleteOutlined />, danger: true }
        ];
        return <ResourceActionsDropdown items={menuItems} onClick={({ key }) => handleMenuClick(key, r)} />;
      }
    }
  ];

  return (
    <>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'flex-end' }}>
        <Space>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setIsCreateVisible(true)}>创建EIP</Button>
          <Button icon={<ReloadOutlined />} onClick={onRefresh} loading={loading}>刷新</Button>
        </Space>
      </div>
      <Table 
        dataSource={eips} 
        columns={columns} 
        loading={loading} 
        rowKey={r => r.metadata?.uid} 
        pagination={DEFAULT_PAGINATION_CONFIG} 
      />
      
      <MetadataModal visible={!!metadataRecord} record={metadataRecord} onClose={() => setMetadataRecord(null)} />

      <Modal
        title="创建 EIP"
        open={isCreateVisible}
        onCancel={() => setIsCreateVisible(false)}
        onOk={handleCreate}
        confirmLoading={createLoading}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入EIP名称' }]}>
            <Input placeholder="例如: my-eip-1" />
          </Form.Item>
          
          {externalSubnets.length === 0 && (
            <Alert
              type="warning"
              showIcon
              message="未找到外部子网"
              description="当前没有任何可用的外部子网 (Provider Network)。"
              style={{ marginBottom: 24 }}
            />
          )}

          <Form.Item name="externalSubnet" label="外部子网" rules={[{ required: true, message: '请选择外部子网' }]}>
            <Select placeholder="请选择子网">
              {externalSubnets.map(s => (
                <Select.Option key={s.metadata?.name || s.name} value={s.metadata?.name || s.name}>
                  {s.metadata?.name || s.name} ({s.spec?.cidrBlock || s.cidr})
                </Select.Option>
              ))}
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

export default EipSection;
