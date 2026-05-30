import React from 'react';
import { message } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { ADMIN_HOME_BASE, fetchAdminDefaultHomeFromApi } from '../../utils/adminHome';
import { isTenantAccount, resolvePostLoginPath } from '../../utils/accountType';
import LoginPageShell from './LoginPageShell';
import { useLoginPageForm } from './useLoginPageForm';

const AdminLogin: React.FC = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const page = useLoginPageForm();

  const onFinish = async (values: { username: string; password: string }) => {
    await page.runLogin(async () => {
      const loggedInUser = await login(values.username, values.password);
      message.success('登录成功');
      if (isTenantAccount(loggedInUser)) {
        navigate(resolvePostLoginPath(loggedInUser));
        return;
      }

      const role = String(loggedInUser?.role || '').toLowerCase();
      if (role === 'super_admin' || role === 'admin') {
        navigate(ADMIN_HOME_BASE);
        return;
      }

      const home = await fetchAdminDefaultHomeFromApi();
      navigate(String(home?.defaultPath || '/admin/coming-soon').trim() || '/admin/coming-soon');
    });
  };

  return (
    <LoginPageShell
      form={page.form}
      formName="admin-login"
      headingId="admin-login-heading"
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

export default AdminLogin;
