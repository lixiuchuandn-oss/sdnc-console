import React from 'react';
import { message } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { isTenantAccount, resolvePostLoginPath } from '../../utils/accountType';
import LoginPageShell from './LoginPageShell';
import { useLoginPageForm } from './useLoginPageForm';

const Login: React.FC = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const page = useLoginPageForm();

  const onFinish = async (values: { username: string; password: string }) => {
    await page.runLogin(async () => {
      const loggedInUser = await login(values.username, values.password);
      if (!isTenantAccount(loggedInUser)) {
        message.error('请使用管理员登录地址');
        navigate('/admin/login');
        return;
      }
      message.success('登录成功');
      navigate(resolvePostLoginPath(loggedInUser));
    });
  };

  return (
    <LoginPageShell
      form={page.form}
      formName="tenant-login"
      headingId="tenant-login-heading"
      loading={page.loading}
      isLoginLocked={page.isLoginLocked}
      lockUntil={page.lockUntil}
      onLockExpired={() => page.setLockUntil(null)}
      loginErrorHint={page.loginErrorHint}
      heroStyle={page.heroStyle}
      buttonColor={page.buttonColor}
      buttonHoverColor={page.buttonHoverColor}
      loginTitle={page.loginTitle}
      loginSubtitle={page.loginSubtitle}
      onFinish={onFinish}
    />
  );
};

export default Login;
