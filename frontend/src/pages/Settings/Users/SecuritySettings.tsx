import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Form,
  Button,
  App,
  InputNumber,
  Checkbox,
  Switch,
  Space,
  Drawer,
} from 'antd';
import { getSystemSetting as apiGetSystemSetting, updateSystemSetting as apiUpdateSystemSetting } from '../../../services/systemApi';
import type { AdminPasswordPolicy } from '../../../utils/adminPasswordPolicy';

export type SecuritySettingsDrawerProps = {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
};

export const SecuritySettingsDrawer: React.FC<SecuritySettingsDrawerProps> = ({
  open,
  onClose,
  onSaved,
}) => {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const passwordExpiryEnabled = Form.useWatch('passwordExpiryEnabled', form);

  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const res = await apiGetSystemSetting('auth.admin_password_policy');
        const raw = (res as any)?.value ?? (res as any)?.data?.value ?? '';
        let parsed: Partial<AdminPasswordPolicy> = {};
        try {
          parsed = raw ? JSON.parse(String(raw)) : {};
        } catch {
          parsed = {};
        }
        const days = parsed.maxPasswordAgeDays ?? 0;
        const enabled = days > 0;
        form.setFieldsValue({
          minLength: parsed.minLength ?? 8,
          maxLength: parsed.maxLength ?? 64,
          requireUppercase: !!parsed.requireUppercase,
          requireLowercase: !!parsed.requireLowercase,
          requireDigit: !!parsed.requireDigit,
          requireSpecial: !!parsed.requireSpecial,
          passwordExpiryEnabled: enabled,
          maxPasswordAgeDays: enabled ? days : 90,
          requirePasswordChangeOnFirstLogin: !!parsed.requirePasswordChangeOnFirstLogin,
        });
      } catch {
        form.setFieldsValue({
          minLength: 8,
          maxLength: 64,
          requireUppercase: false,
          requireLowercase: false,
          requireDigit: false,
          requireSpecial: false,
          passwordExpiryEnabled: false,
          maxPasswordAgeDays: 90,
          requirePasswordChangeOnFirstLogin: false,
        });
      }
    })();
  }, [open, form]);

  return (
    <Drawer
      title={<span>安全管理</span>}
      placement="right"
      width={720}
      open={open}
      onClose={onClose}
      destroyOnHidden
      styles={{ body: { paddingBottom: 24 } }}
    >
      <Form
        form={form}
        layout="vertical"
        requiredMark={false}
        colon={false}
        onFinish={async (values) => {
          try {
            const enabled = !!values.passwordExpiryEnabled;
            const payload: AdminPasswordPolicy = {
              minLength: Number(values.minLength) || 8,
              maxLength: Number(values.maxLength) || 64,
              requireUppercase: !!values.requireUppercase,
              requireLowercase: !!values.requireLowercase,
              requireDigit: !!values.requireDigit,
              requireSpecial: !!values.requireSpecial,
              maxPasswordAgeDays: enabled
                ? Math.max(1, Math.min(3650, Number(values.maxPasswordAgeDays) || 90))
                : 0,
              requirePasswordChangeOnFirstLogin: !!values.requirePasswordChangeOnFirstLogin,
            };
            if (payload.minLength > payload.maxLength) {
              message.error('最短长度不能大于最长长度');
              return;
            }
            await apiUpdateSystemSetting('auth.admin_password_policy', JSON.stringify(payload));
            message.success('管理员密码策略已保存');
            onSaved?.();
          } catch {
            message.error('保存失败');
          }
        }}
      >
        <Form.Item label="最短长度" name="minLength" rules={[{ required: true, message: '请输入' }]}>
          <InputNumber min={1} max={128} suffix="位" style={{ width: '50%' }} />
        </Form.Item>
        <Form.Item label="最长长度" name="maxLength" rules={[{ required: true, message: '请输入' }]}>
          <InputNumber min={1} max={256} suffix="位" style={{ width: '50%' }} />
        </Form.Item>

        <Form.Item label="启用密码有效期">
          <Space size="middle" align="center" wrap>
            <Form.Item name="passwordExpiryEnabled" valuePropName="checked" noStyle>
              <Switch
                checkedChildren="开启"
                unCheckedChildren="关闭"
                onChange={(checked) => {
                  if (checked) {
                    const v = form.getFieldValue('maxPasswordAgeDays');
                    if (!v || v < 1) {
                      form.setFieldValue('maxPasswordAgeDays', 90);
                    }
                  }
                }}
              />
            </Form.Item>
            {passwordExpiryEnabled ? (
              <Form.Item
                name="maxPasswordAgeDays"
                noStyle
                rules={[{ required: true, message: '请输入天数' }]}
              >
                <InputNumber min={1} max={3650} suffix="天后需更换密码" style={{ minWidth: 220 }} />
              </Form.Item>
            ) : null}
          </Space>
        </Form.Item>

        <Form.Item
          name="requirePasswordChangeOnFirstLogin"
          valuePropName="checked"
          style={{ marginTop: 8 }}
          label="首次登录须修改密码"
        >
          <Switch checkedChildren="开启" unCheckedChildren="关闭" />
        </Form.Item>

        <Form.Item name="requireUppercase" valuePropName="checked" style={{ marginTop: 8 }}>
          <Checkbox>至少包含一个大写字母（A-Z）</Checkbox>
        </Form.Item>
        <Form.Item name="requireLowercase" valuePropName="checked">
          <Checkbox>至少包含一个小写字母（a-z）</Checkbox>
        </Form.Item>
        <Form.Item name="requireDigit" valuePropName="checked">
          <Checkbox>至少包含一个数字（0-9）</Checkbox>
        </Form.Item>
        <Form.Item name="requireSpecial" valuePropName="checked">
          <Checkbox>至少包含一个特殊字符（如标点符号）</Checkbox>
        </Form.Item>

        <Form.Item style={{ marginTop: 24 }}>
          <Button type="primary" htmlType="submit">
            保存策略
          </Button>
        </Form.Item>
      </Form>
    </Drawer>
  );
};

const SecuritySettings: React.FC = () => {
  const navigate = useNavigate();
  return (
    <SecuritySettingsDrawer open onClose={() => navigate('/admin/access/users', { replace: true })} />
  );
};

export default SecuritySettings;
