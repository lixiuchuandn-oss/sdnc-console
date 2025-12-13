import React, { useEffect } from 'react';
import { App, Form, Input } from 'antd';
import StdFormModal from '../../../../components/StdFormModal';
import { fetchCloudProviderVpcs, updateHuaweiCloudVpc } from '../../../../services/api';
import { normalizeErr } from '../utils/net';

type Props = {
  open: boolean;
  cloudId: string;
  target: any | null;
  onClose: () => void;
  onSuccess: (vpcs: any[]) => void;
};

const VpcEditModal: React.FC<Props> = ({ open, cloudId, target, onClose, onSuccess }) => {
  const { message } = App.useApp();
  const [form] = Form.useForm();

  useEffect(() => {
    const prefill = () => {
      if (!open || !target) return;
      const name0 = target?.name || target?.VpcName || target?.vpcName;
      const cidr0 = target?.cidr || target?.CidrBlock;
      const desc0 = target?.description || target?.Description;
      setTimeout(() => { form.setFieldsValue({ name: name0, cidr: cidr0, description: desc0 }); }, 0);
    };
    prefill();
  }, [open, target, form]);

  return (
    <StdFormModal
      open={open}
      title="编辑VPC"
      form={form}
      onCancel={onClose}
      onFinish={async (values: any) => {
        try {
          const id0 = target?.id || target?.VpcId; if (!id0) return;
          await updateHuaweiCloudVpc(cloudId, id0, { name: values.name, cidr: values.cidr, description: values.description });
          const json = await fetchCloudProviderVpcs(cloudId);
          const vpcList: any[] = (json?.data?.vpcs) || (json?.vpcs) || [];
          onSuccess(Array.isArray(vpcList) ? vpcList : []);
          message.success('更新成功');
          onClose();
        } catch (e: any) { message.error(normalizeErr(e, '更新失败')); }
      }}
    >
      <Form.Item name="name" label="名称"> <Input placeholder="请输入名称" /> </Form.Item>
      <Form.Item name="cidr" label="IPv4 CIDR" validateTrigger={["onChange","onBlur","onSubmit"]} rules={[{ required: true, transform: (v:any)=> String(v||'').trim(), message: '请输入IPv4 CIDR' }, { validator: (_:any, val:string)=>{ const v = String(val||'').trim(); if (!v) return Promise.resolve(); const re = new RegExp('^((25[0-5]|2[0-4]\\d|1\\d{2}|[1-9]?\\d)\\.){3}(25[0-5]|2[0-4]\\d|1\\d{2}|[1-9]?\\d)\\/(3[0-2]|[12]?\\d)$'); return re.test(v) ? Promise.resolve() : Promise.reject('请输入合法CIDR，如 10.0.0.0/16'); } }]}>
        <Input placeholder="例如 192.168.0.0/16" />
      </Form.Item>
      <Form.Item name="description" label="描述"> <Input placeholder="请输入描述" /> </Form.Item>
    </StdFormModal>
  );
};

export default VpcEditModal;