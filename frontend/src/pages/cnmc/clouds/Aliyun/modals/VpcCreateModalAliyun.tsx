import React, { useEffect, useState } from 'react';
import { Modal, Form, Input, message } from 'antd';
import { createCloudProviderVpc } from '../../../../../services/aliyunApi';

interface Props {
  open: boolean;
  onCancel: () => void;
  onOk: () => void;
  cloudId: string;
}

const VpcCreateModalAliyun: React.FC<Props> = ({ open, onCancel, onOk, cloudId }) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      form.resetFields();
      form.setFieldsValue({ CidrBlock: '192.168.0.0/16' });
    }
  }, [open, form]);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      await createCloudProviderVpc(cloudId, {
        VpcName: values.VpcName,
        CidrBlock: values.CidrBlock,
        Description: values.Description,
      });
      message.success('创建成功');
      onOk();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e?.message || '创建失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal title="创建 VPC" open={open} onCancel={onCancel} onOk={handleOk} confirmLoading={loading} okText="创建" cancelText="取消" destroyOnClose>
      <Form form={form} layout="vertical">
        <Form.Item name="VpcName" label="名称" rules={[{ required: true, message: '请输入 VPC 名称' }]}>
          <Input placeholder="请输入名称" maxLength={128} allowClear />
        </Form.Item>
        <Form.Item
          name="CidrBlock"
          label="IPv4 网段"
          rules={[
            { required: true, message: '请输入 IPv4 网段' },
            { pattern: /^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/, message: '请输入合法的 CIDR，如 192.168.0.0/16' },
          ]}
          extra="建议使用 10.0.0.0/8、172.16.0.0/12、192.168.0.0/16 及其子网"
        >
          <Input placeholder="如 192.168.0.0/16" />
        </Form.Item>
        <Form.Item name="Description" label="描述">
          <Input.TextArea placeholder="选填" rows={2} maxLength={256} />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default VpcCreateModalAliyun;
