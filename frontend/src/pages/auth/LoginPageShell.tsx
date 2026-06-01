import React from 'react';
import { Form, Input, Button, Card } from 'antd';
import type { FormInstance } from 'antd/es/form';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { LoginLockAlert } from './LoginLockAlert';
import { LoginErrorAlert } from './LoginErrorAlert';
import { renderMarkdownBold } from '../../utils/markdown';
import './Login.css';

export type LoginPageShellProps = {
  form: FormInstance;
  formName: string;
  headingId: string;
  loading: boolean;
  isLoginLocked: boolean;
  lockUntil: number | null;
  onLockExpired: () => void;
  loginErrorHint: string | null;
  heroStyle: React.CSSProperties;
  buttonColor?: string;
  buttonHoverColor?: string;
  loginTitle: string;
  loginSubtitle: string;
  onFinish: (values: { username: string; password: string }) => void | Promise<void>;
  footer?: React.ReactNode;
};

const LoginPageShell: React.FC<LoginPageShellProps> = ({
  form,
  formName,
  headingId,
  loading,
  isLoginLocked,
  lockUntil,
  onLockExpired,
  loginErrorHint,
  heroStyle,
  buttonColor,
  buttonHoverColor,
  loginTitle,
  loginSubtitle,
  onFinish,
  footer,
}) => (
  <div className="login-page" style={heroStyle}>
    <section className="login-page__panel" aria-labelledby={headingId}>
      <div className="login-page__content">
        <Card className="login-card login-page__card" variant="borderless">
          <div className="login-header login-page__header">
            <h1 id={headingId} className="login-title login-page__title">
              {renderMarkdownBold(loginTitle)}
            </h1>
            <p className="login-subtitle login-page__subtitle">{loginSubtitle}</p>
          </div>
          <Form
            form={form}
            name={formName}
            onFinish={onFinish}
            autoComplete="off"
            size="large"
          >
            <LoginLockAlert lockedUntil={lockUntil} onExpired={onLockExpired} />
            <LoginErrorAlert message={!isLoginLocked ? loginErrorHint : null} />
            <Form.Item name="username" rules={[{ required: true, message: '请输入用户名!' }]}>
              <Input prefix={<UserOutlined />} placeholder="用户名或邮箱" autoComplete="username" />
            </Form.Item>
            <Form.Item name="password" rules={[{ required: true, message: '请输入密码!' }]}>
              <Input.Password prefix={<LockOutlined />} placeholder="密码" autoComplete="current-password" />
            </Form.Item>
            <Form.Item>
              <Button
                type="primary"
                htmlType="submit"
                loading={loading}
                disabled={isLoginLocked}
                block
                size="large"
                style={
                  buttonColor
                    ? {
                        background: `linear-gradient(135deg, ${buttonColor} 0%, ${buttonColor} 100%) !important`,
                        border: 'none !important',
                        boxShadow: `0 4px 12px ${buttonColor}40 !important`,
                      }
                    : undefined
                }
                onMouseEnter={(e) => {
                  if (!buttonColor || !buttonHoverColor) return;
                  e.currentTarget.style.setProperty(
                    'background',
                    `linear-gradient(135deg, ${buttonHoverColor} 0%, ${buttonHoverColor} 100%)`,
                    'important',
                  );
                  e.currentTarget.style.setProperty(
                    'box-shadow',
                    `0 6px 16px ${buttonHoverColor}60`,
                    'important',
                  );
                }}
                onMouseLeave={(e) => {
                  if (!buttonColor) return;
                  e.currentTarget.style.setProperty(
                    'background',
                    `linear-gradient(135deg, ${buttonColor} 0%, ${buttonColor} 100%)`,
                    'important',
                  );
                  e.currentTarget.style.setProperty(
                    'box-shadow',
                    `0 4px 12px ${buttonColor}40`,
                    'important',
                  );
                }}
              >
                登录
              </Button>
            </Form.Item>
          </Form>
          {footer}
        </Card>
      </div>
    </section>
  </div>
);

export default LoginPageShell;
