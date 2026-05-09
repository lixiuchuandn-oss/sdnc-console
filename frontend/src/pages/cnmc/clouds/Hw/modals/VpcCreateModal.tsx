import React from 'react';
import { App, Form, Input, Modal, Select } from 'antd';
import { fetchCloudProviderVpcs } from '../../../../../services/api';
import { createHuaweiCloudVpc } from '../../../../../services/huaweiApi';
import { normalizeErr } from '../utils/net';

type Props = {
  open: boolean;
  cloudId: string;
  onClose: () => void;
  onSuccess: (vpcs: any[]) => void;
};

const VpcCreateModal: React.FC<Props> = ({ open, cloudId, onClose, onSuccess }) => {
  const { message } = App.useApp();
  const [form] = Form.useForm();

  return (
    <Modal
      open={open}
      title="创建VPC"
      centered
      destroyOnHidden
      onCancel={onClose}
      onOk={() => form.submit()}
      okText="保存"
      width={600}
      styles={{ body: { maxHeight: '80vh', overflowY: 'auto', overflowX: 'hidden' } }}
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={async (values: any) => {
          try {
            const nameVal = String(values.name || '').trim();
            const descVal = String(values.description || '').trim();
            await createHuaweiCloudVpc(cloudId, { cidr: values.cidr, name: nameVal, description: descVal || undefined });
            const json = await fetchCloudProviderVpcs(cloudId);
            const vpcList: any[] = (json?.data?.vpcs) || (json?.vpcs) || [];
            onSuccess(Array.isArray(vpcList) ? vpcList : []);
            message.success('创建成功');
            onClose();
          } catch (e: any) {
            message.error(normalizeErr(e, '创建失败'));
          }
        }}
      >
      <Form.Item name="name" label="名称" validateTrigger={["onChange","onBlur","onSubmit"]} rules={[{ required: true, transform: (v:any)=> String(v||'').trim(), message: '请输入名称' }]}> <Input placeholder="请输入名称" /> </Form.Item>
      <Form.Item shouldUpdate noStyle>
        {({ getFieldValue }) => {
          const v0 = String(getFieldValue('cidr') || '').trim();
          const ok0 = /^((25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\/(3[0-2]|[12]?\d)$/.test(v0);
          const tip0 = v0 ? (<span style={{ color: ok0 ? '#52c41a' : '#ff4d4f' }}>{ok0 ? 'CIDR 合法' : 'CIDR 格式不合法'}</span>) : null;
          return (
            <Form.Item name="cidr" label="IPv4 CIDR" validateFirst validateTrigger={["onChange","onBlur","onSubmit"]} rules={[{ required: true, transform: (v:any)=> String(v||'').trim(), message: '请输入IPv4 CIDR' }, { validator: (_:any, val:string)=>{ const v = String(val||'').trim(); if (!v) return Promise.resolve(); const m = v.match(/^((25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\/(3[0-2]|[12]?\d)$/); return m ? Promise.resolve() : Promise.reject('请输入合法CIDR，如 10.0.0.0/16'); } }]} extra={tip0}>
              <Input placeholder="例如 10.0.0.0/16" />
            </Form.Item>
          );
        }}
      </Form.Item>
      <Form.Item name="description" label="描述"> <Input placeholder="请输入描述" /> </Form.Item>
      <Form.Item name="tags" label="标签"> <Select mode="tags" placeholder="输入后回车添加" style={{ width: '100%' }} /> </Form.Item>
      </Form>
    </Modal>
  );
};

export default VpcCreateModal;