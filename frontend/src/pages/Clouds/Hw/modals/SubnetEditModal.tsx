import React, { useEffect } from 'react';
import { App, Form, Input, Select } from 'antd';
import StdFormModal from '../../../../components/StdFormModal';
import { fetchCloudProviderSubnets, updateHuaweiCloudSubnet } from '../../../../services/api';
import { normalizeErr } from '../utils/net';

type Props = {
  open: boolean;
  cloudId: string;
  target: any | null;
  onClose: () => void;
  onSuccess: (subnets: any[]) => void;
};

const SubnetEditModal: React.FC<Props> = ({ open, cloudId, target, onClose, onSuccess }) => {
  const { message } = App.useApp();
  const [form] = Form.useForm();

  useEffect(() => {
    const prefill = () => {
      if (!open || !target) return;
      const name0 = target?.name;
      const desc0 = target?.description;
      const dhcp0 = target?.dhcp_enable;
      const dns1 = target?.primary_dns;
      const dns2 = target?.secondary_dns;
      setTimeout(() => { form.setFieldsValue({ name: name0, description: desc0, dhcp_enable: dhcp0, primary_dns: dns1, secondary_dns: dns2 }); }, 0);
    };
    prefill();
  }, [open, target, form]);

  return (
    <StdFormModal
      open={open}
      title="编辑子网"
      form={form}
      onCancel={onClose}
      onFinish={async (values: any) => {
        try {
          const id0 = target?.id || target?.SubnetId; if (!id0) return;
          await updateHuaweiCloudSubnet(cloudId, id0, { name: values.name, description: values.description, dhcp_enable: values.dhcp_enable, primary_dns: values.primary_dns, secondary_dns: values.secondary_dns });
          const json = await fetchCloudProviderSubnets(cloudId);
          const subnetList: any[] = (json?.data?.subnets) || (json?.subnets) || [];
          onSuccess(Array.isArray(subnetList) ? subnetList : []);
          message.success('更新成功');
          onClose();
        } catch (e: any) { message.error(normalizeErr(e, '更新失败')); }
      }}
    >
      <Form.Item name="name" label="名称"> <Input placeholder="请输入名称" /> </Form.Item>
      <Form.Item name="description" label="描述"> <Input placeholder="请输入描述" /> </Form.Item>
      <Form.Item name="dhcp_enable" label="DHCP"> <Select allowClear placeholder="启用/关闭" options={[{ label:'启用', value:true }, { label:'关闭', value:false }]} style={{ width: 160 }} /> </Form.Item>
      <Form.Item name="primary_dns" label="主DNS"> <Input placeholder="例如 114.xx.xx.114" /> </Form.Item>
      <Form.Item name="secondary_dns" label="备DNS"> <Input placeholder="例如 114.xx.xx.115" /> </Form.Item>
    </StdFormModal>
  );
};

export default SubnetEditModal;