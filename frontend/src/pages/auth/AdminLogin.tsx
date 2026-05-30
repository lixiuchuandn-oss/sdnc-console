import React, { useState } from 'react';
import { Form, Input, Button, Card, message } from 'antd';
import {
  getLockedUntilFromLoginError,
  getLoginErrorHint,
  getRemainSecFromLockedUntil,
} from '../../utils/loginLockMessage';
import { LoginLockAlert } from './LoginLockAlert';
import { LoginErrorAlert } from './LoginErrorAlert';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { ADMIN_HOME_BASE, fetchAdminDefaultHomeFromApi } from '../../utils/adminHome';
import { isTenantAccount, resolvePostLoginPath } from '../../utils/accountType';
import { useSettings } from '../../contexts/SettingsContext';
import { renderMarkdownBold } from '../../utils/markdown';
import { useLoginPageHeroStyle } from './loginPageHeroStyle';
import './Login.css';

const AdminLogin: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [lockUntil, setLockUntil] = useState<number | null>(null);
  const [loginErrorHint, setLoginErrorHint] = useState<string | null>(null);
  const isLoginLocked = lockUntil != null && getRemainSecFromLockedUntil(lockUntil) > 0;
  const [form] = Form.useForm();
  const { login } = useAuth();
  const navigate = useNavigate();
  const { settings } = useSettings();
  const backgroundColor = settings.loginBackgroundColor;
  const gradientStart = settings.loginBackgroundGradientStart || backgroundColor;
  const gradientEnd = settings.loginBackgroundGradientEnd || backgroundColor;

  const buttonColor = settings.loginButtonColor;
  const buttonHoverColor = settings.loginButtonHoverColor;

  const heroStyle = useLoginPageHeroStyle({
    backgroundColor,
    gradientStart,
    gradientEnd,
  });

  const onFinish = async (values: { username: string; password: string }) => {
    setLoading(true);
    try {
      const loggedInUser = await login(values.username, values.password);
      setLockUntil(null);
      setLoginErrorHint(null);
      message.success('登录成功');
      if (isTenantAccount(loggedInUser)) {
        navigate(resolvePostLoginPath(loggedInUser));
        return;
      }

      const role = String((loggedInUser as any)?.role || '').toLowerCase();

      // 系统管理员：先进 `/admin`，由 `AdminHomeGate` 请求 `GET /api/auth/admin-default-home` 落地
      if (role === 'super_admin' || role === 'admin') {
        navigate(ADMIN_HOME_BASE);
        return;
      }

      const home = await fetchAdminDefaultHomeFromApi();
      navigate(String(home?.defaultPath || '/admin/coming-soon').trim() || '/admin/coming-soon');
    } catch (error) {
      const until = getLockedUntilFromLoginError(error);
      if (until) {
        setLockUntil(until);
        setLoginErrorHint(null);
      } else {
        setLockUntil(null);
        setLoginErrorHint(getLoginErrorHint(error) ?? '登录失败');
      }
    } finally {
      setLoading(false);
    }
  };

  const onFinishFailed = (_errorInfo: unknown) => {
    /* Form 校验由 antd 处理 */
  };

  return (
    <div className="login-page" style={heroStyle}>
      <section className="login-page__panel" aria-labelledby="admin-login-heading">
        <div className="login-page__content">
          <Card className="login-card login-page__card" variant="borderless">
            <div className="login-header login-page__header">
              <h1 id="admin-login-heading" className="login-title login-page__title">
                {renderMarkdownBold(settings.loginTitle ?? '')}
              </h1>
              <p className="login-subtitle login-page__subtitle">{settings.loginSubtitle ?? ''}</p>
            </div>
            <Form
              form={form}
              name="admin-login"
              onFinish={onFinish}
              onFinishFailed={onFinishFailed}
              autoComplete="off"
              size="large"
            >
              <LoginLockAlert lockedUntil={lockUntil} onExpired={() => setLockUntil(null)} />
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
                    e.currentTarget.style.setProperty('box-shadow', `0 6px 16px ${buttonHoverColor}60`, 'important');
                  }}
                  onMouseLeave={(e) => {
                    if (!buttonColor) return;
                    e.currentTarget.style.setProperty(
                      'background',
                      `linear-gradient(135deg, ${buttonColor} 0%, ${buttonColor} 100%)`,
                      'important',
                    );
                    e.currentTarget.style.setProperty('box-shadow', `0 4px 12px ${buttonColor}40`, 'important');
                  }}
                >
                  登录
                </Button>
              </Form.Item>
            </Form>
          </Card>
        </div>
      </section>
    </div>
  );
};

export default AdminLogin;
