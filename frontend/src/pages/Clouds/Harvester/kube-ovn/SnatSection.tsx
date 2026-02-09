import React, { useState } from 'react';
import { Table, Tag, Button, Space, Modal, Form, Input, Select, message, MenuProps } from 'antd';
import { ReloadOutlined, PlusOutlined, DeleteOutlined, EyeOutlined } from '@ant-design/icons';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import { createCloudProviderOvnSnatRule, deleteCloudProviderOvnSnatRule } from '../../../../services/harvesterApi';
import { DEFAULT_PAGINATION_CONFIG } from '../../../../constants/pagination';
import MetadataModal from './MetadataModal';

interface BaseSectionProps {
  cloudId: string;
  loading: boolean;
  onRefresh: () => void;
}

interface SnatSectionProps extends BaseSectionProps {
  snatRules: any[];
  eips: any[];
  vpcs: any[]; // Used to filter subnets or context
  subnets: any[];
}

export const SnatSection: React.FC<SnatSectionProps> = ({ cloudId, snatRules, eips, subnets, loading, onRefresh }) => {
  const [isCreateVisible, setIsCreateVisible] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [form] = Form.useForm();
  const [metadataRecord, setMetadataRecord] = useState<any>(null);

  const handleCreate = async () => {
    try {
      const values = await form.validateFields();
      setCreateLoading(true);
      await createCloudProviderOvnSnatRule(cloudId, values);
      message.success('SNAT 规则创建成功');
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
        content: `确定要删除 SNAT 规则 ${record.metadata?.name} 吗？`,
        okText: '删除',
        okType: 'danger',
        cancelText: '取消',
        onOk: async () => {
          try {
            await deleteCloudProviderOvnSnatRule(cloudId, record.metadata?.name);
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
    { title: 'CIDR', key: 'cidr', render: (_: any, r: any) => <Tag>{r.spec?.vpcSubnet}</Tag> },
    { title: 'VPC', key: 'vpc', render: (_: any, r: any) => r.spec?.vpc },
    { title: 'EIP', key: 'eip', render: (_: any, r: any) => r.spec?.ovnEip },
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
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setIsCreateVisible(true)}>创建SNAT规则</Button>
          <Button icon={<ReloadOutlined />} onClick={onRefresh} loading={loading}>刷新</Button>
        </Space>
      </div>
      <Table 
        dataSource={snatRules} 
        columns={columns} 
        loading={loading} 
        rowKey={r => r.metadata?.uid} 
        pagination={DEFAULT_PAGINATION_CONFIG} 
      />
      <MetadataModal visible={!!metadataRecord} record={metadataRecord} onClose={() => setMetadataRecord(null)} />

      <Modal
        title="创建 SNAT 规则"
        open={isCreateVisible}
        onCancel={() => setIsCreateVisible(false)}
        onOk={handleCreate}
        confirmLoading={createLoading}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入规则名称' }]}>
            <Input placeholder="例如: my-snat-rule" />
          </Form.Item>
          <Form.Item name="ovnEip" label="EIP" rules={[{ required: true, message: '请选择EIP' }]}>
            <Select placeholder="请选择EIP">
              {eips.map(e => (
                <Select.Option key={e.metadata?.name} value={e.metadata?.name}>
                  {e.metadata?.name} ({e.spec?.v4Ip})
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item name="vpcSubnet" label="VPC子网" rules={[{ required: true, message: '请选择VPC子网' }]}>
            <Select placeholder="请选择子网">
              {subnets.map(s => (
                <Select.Option key={s.metadata?.name || s.name} value={s.metadata?.name || s.name}>
                  {s.metadata?.name || s.name} (VPC: {s.spec?.vpc || s.vpc})
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
};

export default SnatSection;
