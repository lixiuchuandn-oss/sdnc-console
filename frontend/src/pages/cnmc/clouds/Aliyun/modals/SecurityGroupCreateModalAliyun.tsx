import React, { useState, useEffect } from 'react';
import { Modal, Form, Input, Select, message } from 'antd';
import { createCloudProviderSecurityGroup } from '../../../../../services/securityGroups';

interface Props {
  open: boolean;
  onCancel: () => void;
  onOk: () => void;
  cloudId: string;
  vpcs: any[];
}

const SecurityGroupCreateModalAliyun: React.FC<Props> = ({ open, onCancel, onOk, cloudId, vpcs }) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      form.resetFields();
    }
  }, [open, form]);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      await createCloudProviderSecurityGroup(cloudId, {
        name: values.name,
        description: values.description,
        vpcId: values.vpcId,
      });
      message.success('创建成功');
      onOk();
    } catch (e: any) {
      message.error(e.message || '创建失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title="创建安全组"
      open={open}
      onCancel={onCancel}
      onOk={handleOk}
      confirmLoading={loading}
    >
      <Form form={form} layout="vertical">
        <Form.Item
          name="name"
          label="名称"
          rules={[{ required: true, message: '请输入安全组名称' }]}
        >
          <Input placeholder="请输入名称" />
        </Form.Item>
        <Form.Item
          name="vpcId"
          label="所属 VPC"
          rules={[{ required: true, message: '请选择所属 VPC' }]}
        >
          <Select
            placeholder="请选择 VPC"
            options={vpcs.map((v) => ({
              label: `${v.VpcName || v.name} (${v.VpcId || v.id})`,
              value: v.VpcId || v.id,
            }))}
            showSearch
            filterOption={(input, option) =>
              (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
            }
          />
        </Form.Item>
        <Form.Item name="description" label="描述">
          <Input.TextArea placeholder="请输入描述" />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default SecurityGroupCreateModalAliyun;
