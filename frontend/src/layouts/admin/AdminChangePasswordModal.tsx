/**
 * 管理员改密弹窗（表现层）：与 `hooks/useAdminPasswordGate` 配套。
 * 强制改密时不可关闭；新密码按 `adminPasswordPolicy` 客户端校验、确认密码需一致。
 */
import React from 'react';
import { Form, Input, Modal } from 'antd';
import type { FormInstance } from 'antd';
import {
  DEFAULT_ADMIN_PASSWORD_POLICY,
  validateAdminPasswordClient,
  type AdminPasswordPolicy,
} from '../../utils/adminPasswordPolicy';

type Props = {
  open: boolean;
  forcePasswordChange: boolean;
  saving: boolean;
  form: FormInstance;
  policy: AdminPasswordPolicy | null;
  username?: string;
  onOk: () => void;
  onClose: () => void;
};

const AdminChangePasswordModal: React.FC<Props> = ({
  open,
  forcePasswordChange,
  saving,
  form,
  policy,
  username,
  onOk,
  onClose,
}) => {
  return (
    <Modal
      title={forcePasswordChange ? '密码已过期，请修改密码' : '修改密码'}
      open={open}
      onCancel={() => {
        if (!forcePasswordChange) onClose();
      }}
      onOk={onOk}
      confirmLoading={saving}
      okText="确认修改"
      cancelText="取消"
      closable={!forcePasswordChange}
      maskClosable={!forcePasswordChange}
      destroyOnHidden
    >
      <Form form={form} layout="vertical">
        <Form.Item
          label="原密码"
          name="oldPassword"
          rules={[{ required: true, message: '请输入原密码' }]}
        >
          <Input.Password autoComplete="current-password" />
        </Form.Item>
        <Form.Item
          label="新密码"
          name="newPassword"
          rules={[
            { required: true, message: '请输入新密码' },
            {
              validator: async (_, v) => {
                const pol = policy || DEFAULT_ADMIN_PASSWORD_POLICY;
                const err = validateAdminPasswordClient(pol, String(v || ''), username);
                if (err) throw new Error(err);
              },
            },
          ]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Form.Item
          label="确认新密码"
          name="confirmPassword"
          dependencies={['newPassword']}
          rules={[
            { required: true, message: '请再次输入新密码' },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue('newPassword') === value) return Promise.resolve();
                return Promise.reject(new Error('两次输入的新密码不一致'));
              },
            }),
          ]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default AdminChangePasswordModal;
