import React from 'react';
import { Form, Input, Modal } from 'antd';
import type { FormInstance } from 'antd/es/form';
import type { Tenant, CreateTenantRequest } from '../../../../types/tenant';

const { TextArea } = Input;

export interface TenantUpsertModalProps {
  open: boolean;
  editingTenant: Tenant | null;
  form: FormInstance<CreateTenantRequest>;
  onCancel: () => void;
  onFinish: (values: CreateTenantRequest) => void;
}

/** 租户列表 · 创建 / 编辑租户 */
export default function TenantUpsertModal({
  open,
  editingTenant,
  form,
  onCancel,
  onFinish,
}: TenantUpsertModalProps) {
  return (
    <Modal
      open={open}
      title={editingTenant ? '编辑租户' : '创建租户'}
      okText={editingTenant ? '更新' : '创建'}
      cancelText="取消"
      width={600}
      destroyOnHidden
      onCancel={onCancel}
      onOk={() => form.submit()}
    >
      <Form form={form} layout="vertical" onFinish={onFinish} preserve={false}>
        <Form.Item label="租户名称" name="name" rules={[{ required: true, message: '请输入租户名称' }]}>
          <Input placeholder="请输入租户名称" />
        </Form.Item>
        <Form.Item label="描述" name="description">
          <TextArea rows={3} placeholder="请输入租户描述" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
