import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Form, Input, Select, AutoComplete, message } from 'antd';
import { createCloudProviderVSwitch } from '../../../../../services/aliyunApi';

interface Props {
  open: boolean;
  onCancel: () => void;
  onOk: () => void;
  cloudId: string;
  vpcs: any[];
  vswitches?: any[];
}

const VSwitchCreateModalAliyun: React.FC<Props> = ({ open, onCancel, onOk, cloudId, vpcs, vswitches }) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) form.resetFields();
  }, [open, form]);

  const zoneSuggestions = useMemo(() => {
    const set = new Set<string>();
    (Array.isArray(vswitches) ? vswitches : []).forEach((s: any) => {
      const z = s?.ZoneId || s?.zone;
      if (z) set.add(z);
    });
    return Array.from(set).map((z) => ({ value: z }));
  }, [vswitches]);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      await createCloudProviderVSwitch(cloudId, {
        VpcId: values.VpcId,
        ZoneId: values.ZoneId,
        CidrBlock: values.CidrBlock,
        VSwitchName: values.VSwitchName,
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
    <Modal title="创建交换机" open={open} onCancel={onCancel} onOk={handleOk} confirmLoading={loading} okText="创建" cancelText="取消" destroyOnClose>
      <Form form={form} layout="vertical">
        <Form.Item name="VpcId" label="所属 VPC" rules={[{ required: true, message: '请选择所属 VPC' }]}>
          <Select
            placeholder="请选择 VPC"
            showSearch
            optionFilterProp="label"
            options={(vpcs || []).map((v) => ({ label: `${v.VpcName || v.name || v.VpcId || v.id}（${v.VpcId || v.id}）`, value: v.VpcId || v.id }))}
          />
        </Form.Item>
        <Form.Item name="ZoneId" label="可用区" rules={[{ required: true, message: '请输入可用区 ZoneId' }]}>
          <AutoComplete options={zoneSuggestions} placeholder="如 cn-hangzhou-i" allowClear filterOption={(v, o) => String(o?.value || '').includes(v)} />
        </Form.Item>
        <Form.Item
          name="CidrBlock"
          label="IPv4 网段"
          rules={[
            { required: true, message: '请输入 IPv4 网段' },
            { pattern: /^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/, message: '请输入合法的 CIDR，如 192.168.1.0/24' },
          ]}
          extra="须为所属 VPC 网段的子集"
        >
          <Input placeholder="如 192.168.1.0/24" />
        </Form.Item>
        <Form.Item name="VSwitchName" label="名称" rules={[{ required: true, message: '请输入交换机名称' }]}>
          <Input placeholder="请输入名称" maxLength={128} allowClear />
        </Form.Item>
        <Form.Item name="Description" label="描述">
          <Input.TextArea placeholder="选填" rows={2} maxLength={256} />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default VSwitchCreateModalAliyun;
