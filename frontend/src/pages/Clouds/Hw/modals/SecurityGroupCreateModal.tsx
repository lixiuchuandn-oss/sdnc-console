import React from 'react';
import { App, Form, Input } from 'antd';
import StdFormModal from '../../../../components/StdFormModal';
import { fetchCloudProviderSecurityGroups, createHuaweiCloudSecurityGroup } from '../../../../services/api';
import { normalizeErr } from '../utils/net';

type Props = {
  open: boolean;
  cloudId: string;
  onClose: () => void;
  onSuccess: (groups: any[]) => void;
};

const SecurityGroupCreateModal: React.FC<Props> = ({ open, cloudId, onClose, onSuccess }) => {
  const { message } = App.useApp();
  const [form] = Form.useForm();

  return (
    <StdFormModal
      open={open}
      title="创建 安全组（华为云）"
      form={form}
      onCancel={onClose}
      onFinish={async (values: any) => {
        try {
          const payload = { name: String(values.name||'').trim(), description: String(values.desc||'').trim() || undefined, enterprise_project_id: String(values.epid||'').trim() || undefined };
          if (!payload.name) { message.warning('请输入名称'); return; }
          await createHuaweiCloudSecurityGroup(cloudId, payload);
          const json = await fetchCloudProviderSecurityGroups(cloudId).catch(()=>null);
          const sgList: any[] = (json?.data?.security_groups) || (json?.security_groups) || (json?.data?.securityGroups) || (json?.securityGroups) || [];
          onSuccess(Array.isArray(sgList) ? sgList : []);
          message.success('创建成功');
          onClose();
        } catch (e:any) { message.error(normalizeErr(e, '创建失败')); }
      }}
    >
      <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}> <Input placeholder="安全组名称" /> </Form.Item>
      <Form.Item name="desc" label="描述"> <Input placeholder="可选描述" /> </Form.Item>
      <Form.Item name="epid" label="企业项目ID"> <Input placeholder="可选，企业项目 ID" /> </Form.Item>
    </StdFormModal>
  );
};

export default SecurityGroupCreateModal;