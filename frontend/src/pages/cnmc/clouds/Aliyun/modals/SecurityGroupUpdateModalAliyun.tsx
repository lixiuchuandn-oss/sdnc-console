import React, { useState, useEffect } from 'react';
import { Modal, Form, Input, message } from 'antd';
import { updateCloudProviderSecurityGroup } from '../../../../../services/securityGroups';

interface Props {
  open: boolean;
  onCancel: () => void;
  onOk: () => void;
  cloudId: string;
  securityGroup: any;
}

const SecurityGroupUpdateModalAliyun: React.FC<Props> = ({ open, onCancel, onOk, cloudId, securityGroup }) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && securityGroup) {
      form.setFieldsValue({
        name: securityGroup.SecurityGroupName || securityGroup.name,
        description: securityGroup.Description || securityGroup.description,
      });
    } else {
      form.resetFields();
    }
  }, [open, securityGroup, form]);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      const sgId = securityGroup.SecurityGroupId || securityGroup.id;
      
      await updateCloudProviderSecurityGroup(cloudId, sgId, {
        name: values.name,
        description: values.description,
      });
      
      message.success('更新成功');
      onOk();
    } catch (e: any) {
      message.error(e.message || '更新失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title="编辑安全组"
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
        <Form.Item name="description" label="描述">
          <Input.TextArea placeholder="请输入描述" />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default SecurityGroupUpdateModalAliyun;
