import React, { useState } from 'react';
import { Table, Tag, Button, Space, Modal, Form, Input, Select, message, MenuProps } from 'antd';
import { ReloadOutlined, PlusOutlined, DeleteOutlined, EyeOutlined } from '@ant-design/icons';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import { createCloudProviderOvnDnatRule, deleteCloudProviderOvnDnatRule } from '../../../../services/harvesterApi';
import { DEFAULT_PAGINATION_CONFIG } from '../../../../constants/pagination';
import MetadataModal from './MetadataModal';

interface BaseSectionProps {
  cloudId: string;
  loading: boolean;
  onRefresh: (force?: boolean) => void;
}

interface DnatSectionProps extends BaseSectionProps {
  dnatRules: any[];
  eips: any[];
  vpcs: any[];
}

export const DnatSection: React.FC<DnatSectionProps> = ({ cloudId, dnatRules, eips, vpcs, loading, onRefresh }) => {
  const [isCreateVisible, setIsCreateVisible] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [form] = Form.useForm();
  const [metadataRecord, setMetadataRecord] = useState<any>(null);

  const handleCreate = async () => {
    try {
      const values = await form.validateFields();
      setCreateLoading(true);
      await createCloudProviderOvnDnatRule(cloudId, values);
      message.success('DNAT 规则创建成功');
      setIsCreateVisible(false);
      form.resetFields();
      onRefresh(true);
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
        content: `确定要删除 DNAT 规则 ${record.metadata?.name} 吗？`,
        okText: '删除',
        okType: 'danger',
        cancelText: '取消',
        onOk: async () => {
          try {
            await deleteCloudProviderOvnDnatRule(cloudId, record.metadata?.name);
            message.success('删除成功');
            onRefresh(true);
          } catch (e: any) {
            message.error(`删除失败: ${e.message}`);
          }
        }
      });
    }
  };

  const columns = [
    { title: '名称', key: 'name', render: (_: any, r: any) => <b>{r.metadata?.name}</b> },
    { title: 'EIP', key: 'eip', render: (_: any, r: any) => r.spec?.ovnEip },
    { title: '端口', key: 'port', render: (_: any, r: any) => `${r.spec?.protocol} ${r.spec?.externalPort} -> ${r.spec?.internalPort}` },
    { title: '内部IP', key: 'ip', render: (_: any, r: any) => r.spec?.internalIp },
    { title: 'VPC', key: 'vpc', render: (_: any, r: any) => r.spec?.vpc },
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
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setIsCreateVisible(true)}>创建DNAT规则</Button>
          <Button icon={<ReloadOutlined />} onClick={() => onRefresh(true)} loading={loading}>刷新</Button>
        </Space>
      </div>
      <Table 
        dataSource={dnatRules} 
        columns={columns} 
        loading={loading} 
        rowKey={r => r.metadata?.uid} 
        pagination={DEFAULT_PAGINATION_CONFIG} 
      />
      <MetadataModal visible={!!metadataRecord} record={metadataRecord} onClose={() => setMetadataRecord(null)} />

      <Modal
        title="创建 DNAT 规则"
        open={isCreateVisible}
        onCancel={() => setIsCreateVisible(false)}
        onOk={handleCreate}
        confirmLoading={createLoading}
        okText="创建"
        cancelText="取消"
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入规则名称' }]}>
            <Input placeholder="例如: my-dnat-rule" />
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
          <Form.Item name="protocol" label="协议" initialValue="tcp">
            <Select>
              <Select.Option value="tcp">TCP</Select.Option>
              <Select.Option value="udp">UDP</Select.Option>
              <Select.Option value="sctp">SCTP</Select.Option>
            </Select>
          </Form.Item>
          <Space>
             <Form.Item name="externalPort" label="外部端口" rules={[{ required: true, message: '请输入外部端口' }]}>
                <Input placeholder="例如: 80" />
             </Form.Item>
             <Form.Item name="internalPort" label="内部端口" rules={[{ required: true, message: '请输入内部端口' }]}>
                <Input placeholder="例如: 8080" />
             </Form.Item>
          </Space>
          <Form.Item name="internalIp" label="内部IP" rules={[{ required: true, message: '请输入内部IP' }]}>
             <Input placeholder="例如: 10.0.1.5" />
          </Form.Item>
          <Form.Item name="vpc" label="VPC" rules={[{ required: true, message: '请选择VPC' }]}>
             <Select placeholder="请选择VPC">
               {vpcs.map(v => (
                 <Select.Option key={v.metadata?.name} value={v.metadata?.name}>
                   {v.metadata?.name}
                 </Select.Option>
               ))}
             </Select>
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
};

export default DnatSection;
