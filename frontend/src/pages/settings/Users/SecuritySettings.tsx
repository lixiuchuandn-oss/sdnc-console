import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Form,
  Button,
  App,
  InputNumber,
  Switch,
  Space,
  Drawer,
  Divider,
  Typography,
  Flex,
  Tooltip,
} from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';
import { getSystemSetting as apiGetSystemSetting, updateSystemSetting as apiUpdateSystemSetting } from '../../../services/systemApi';
import {
  buildAdminPasswordPolicyPayload,
  inferPasswordComplexityEnabled,
} from '../../../utils/adminPasswordPolicy';
import type { AdminPasswordPolicy } from '../../../utils/adminPasswordPolicy';
import {
  DEFAULT_ADMIN_AUTH_CONFIG,
  parseAdminAuthConfig,
  type AdminAuthConfig,
} from '../../../utils/adminAuthConfig';

export type SecuritySettingsDrawerProps = {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
};

const SECURITY_INLINE_LABEL_COL = { flex: '0 0 192px' };
const SECURITY_INLINE_WRAPPER_COL = { flex: '0 0 auto' };
const securityInlineRowClass = 'security-settings-inline-row';
const SECURITY_SETTINGS_FORM_ID = 'security-settings-form';

const PASSWORD_COMPLEXITY_HELP =
  '开启密码复杂度要求：密码至少 8 位，且须包含数字、大写字母、小写字母、特殊字符中的至少三项。';

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
      let passwordDefaults: Record<string, unknown> = {
        passwordComplexityEnabled: false,
        passwordExpiryEnabled: false,
        maxPasswordAgeDays: 90,
        requirePasswordChangeOnFirstLogin: false,
      };
      let authDefaults: AdminAuthConfig = { ...DEFAULT_ADMIN_AUTH_CONFIG };

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
        passwordDefaults = {
          passwordComplexityEnabled: inferPasswordComplexityEnabled(parsed),
          passwordExpiryEnabled: enabled,
          maxPasswordAgeDays: enabled ? days : 90,
          requirePasswordChangeOnFirstLogin: !!parsed.requirePasswordChangeOnFirstLogin,
        };
      } catch {
        /* keep passwordDefaults */
      }

      try {
        const authRes = await apiGetSystemSetting('auth.admin_auth_config');
        const authRaw = (authRes as any)?.value ?? (authRes as any)?.data?.value ?? '';
        authDefaults = parseAdminAuthConfig(authRaw ? String(authRaw) : null);
      } catch {
        /* keep authDefaults */
      }

      form.setFieldsValue({ ...passwordDefaults, ...authDefaults });
    })();
  }, [open, form]);

  return (
    <Drawer
      title={<span>安全设定</span>}
      placement="right"
      width={720}
      open={open}
      onClose={onClose}
      destroyOnHidden
      styles={{ body: { paddingBottom: 24 } }}
      footer={
        <Flex justify="flex-end">
          <Button type="primary" htmlType="submit" form={SECURITY_SETTINGS_FORM_ID}>
            保存
          </Button>
        </Flex>
      }
    >
      <Form
        id={SECURITY_SETTINGS_FORM_ID}
        form={form}
        className="security-settings-form"
        layout="vertical"
        requiredMark={false}
        colon={false}
        labelAlign="left"
        onFinish={async (values) => {
          try {
            const enabled = !!values.passwordExpiryEnabled;
            const payload: AdminPasswordPolicy = buildAdminPasswordPolicyPayload({
              passwordComplexityEnabled: !!values.passwordComplexityEnabled,
              maxPasswordAgeDays: enabled
                ? Math.max(1, Math.min(3650, Number(values.maxPasswordAgeDays) || 90))
                : 0,
              requirePasswordChangeOnFirstLogin: !!values.requirePasswordChangeOnFirstLogin,
            });

            const authPayload: AdminAuthConfig = {
              maxLoginAttempts: Math.max(1, Number(values.maxLoginAttempts) || 5),
              loginFailureWindowMinutes: Math.max(1, Number(values.loginFailureWindowMinutes) || 5),
              loginLockDurationMinutes: Math.max(1, Number(values.loginLockDurationMinutes) || 3),
              pageTimeoutMinutes: Math.max(1, Number(values.pageTimeoutMinutes) || 60),
            };

            await Promise.all([
              apiUpdateSystemSetting('auth.admin_password_policy', JSON.stringify(payload)),
              apiUpdateSystemSetting('auth.admin_auth_config', JSON.stringify(authPayload)),
            ]);
            message.success('安全设定已保存');
            onSaved?.();
            onClose();
          } catch {
            message.error('保存失败');
          }
        }}
      >
        <Typography.Title level={5} style={{ marginTop: 0, marginBottom: 16 }}>
          密码策略
        </Typography.Title>

        <Form.Item
          label="启用密码有效期"
          layout="horizontal"
          labelAlign="left"
          labelCol={SECURITY_INLINE_LABEL_COL}
          wrapperCol={SECURITY_INLINE_WRAPPER_COL}
          className={securityInlineRowClass}
          style={{ marginBottom: 16 }}
        >
          <Space size="middle" align="center" wrap={false}>
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
              <>
                <Form.Item
                  name="maxPasswordAgeDays"
                  noStyle
                  rules={[{ required: true, message: '请输入天数' }]}
                >
                  <InputNumber min={1} max={3650} suffix="天" className="security-settings-control" />
                </Form.Item>
                <span>后需更换密码</span>
              </>
            ) : null}
          </Space>
        </Form.Item>

        <Form.Item
          label="首次登录须修改密码"
          layout="horizontal"
          labelAlign="left"
          labelCol={SECURITY_INLINE_LABEL_COL}
          wrapperCol={SECURITY_INLINE_WRAPPER_COL}
          className={securityInlineRowClass}
          style={{ marginBottom: 24 }}
        >
          <Form.Item name="requirePasswordChangeOnFirstLogin" valuePropName="checked" noStyle>
            <Switch checkedChildren="开启" unCheckedChildren="关闭" />
          </Form.Item>
        </Form.Item>

        <Form.Item
          label={
            <span>
              启用密码复杂度
              <Tooltip title={PASSWORD_COMPLEXITY_HELP} placement="top">
                <QuestionCircleOutlined
                  style={{ marginLeft: 4, color: 'rgba(0,0,0,.45)', fontSize: 12, cursor: 'help' }}
                />
              </Tooltip>
            </span>
          }
          layout="horizontal"
          labelAlign="left"
          labelCol={SECURITY_INLINE_LABEL_COL}
          wrapperCol={SECURITY_INLINE_WRAPPER_COL}
          className={securityInlineRowClass}
          style={{ marginBottom: 24 }}
        >
          <Form.Item name="passwordComplexityEnabled" valuePropName="checked" noStyle>
            <Switch checkedChildren="开启" unCheckedChildren="关闭" />
          </Form.Item>
        </Form.Item>

        <Divider />

        <Typography.Title level={5} style={{ marginTop: 0, marginBottom: 16 }}>
          登录策略
        </Typography.Title>

        <Form.Item
          label="登录允许错误次数"
          name="maxLoginAttempts"
          layout="horizontal"
          labelAlign="left"
          labelCol={SECURITY_INLINE_LABEL_COL}
          wrapperCol={SECURITY_INLINE_WRAPPER_COL}
          className={securityInlineRowClass}
          rules={[{ required: true, message: '请输入' }]}
          style={{ marginBottom: 16 }}
        >
          <InputNumber min={1} max={100} suffix="次" controls={false} className="security-settings-control" />
        </Form.Item>

        <Form.Item
          label="错误统计周期"
          name="loginFailureWindowMinutes"
          layout="horizontal"
          labelAlign="left"
          labelCol={SECURITY_INLINE_LABEL_COL}
          wrapperCol={SECURITY_INLINE_WRAPPER_COL}
          className={securityInlineRowClass}
          rules={[{ required: true, message: '请输入' }]}
          style={{ marginBottom: 16 }}
        >
          <InputNumber min={1} max={1440} suffix="分钟" controls={false} className="security-settings-control" />
        </Form.Item>

        <Form.Item
          label="登录失败锁定间隔"
          name="loginLockDurationMinutes"
          layout="horizontal"
          labelAlign="left"
          labelCol={SECURITY_INLINE_LABEL_COL}
          wrapperCol={SECURITY_INLINE_WRAPPER_COL}
          className={securityInlineRowClass}
          rules={[{ required: true, message: '请输入' }]}
          style={{ marginBottom: 16 }}
        >
          <InputNumber min={1} max={1440} suffix="分钟" controls={false} className="security-settings-control" />
        </Form.Item>

        <Form.Item
          label="页面超时时间"
          name="pageTimeoutMinutes"
          layout="horizontal"
          labelAlign="left"
          labelCol={SECURITY_INLINE_LABEL_COL}
          wrapperCol={SECURITY_INLINE_WRAPPER_COL}
          className={securityInlineRowClass}
          rules={[{ required: true, message: '请输入' }]}
          style={{ marginBottom: 0 }}
        >
          <InputNumber min={1} max={1440} suffix="分钟" controls={false} className="security-settings-control" />
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
