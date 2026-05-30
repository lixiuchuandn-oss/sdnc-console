/**
 * 改密闸门：弹窗开合、密码策略拉取、强制改密、提交。
 * Admin / Tenant 壳共用；`mode` 决定 mustChangePassword 对谁生效。
 */
import { useEffect, useMemo, useState } from 'react';
import { App, Form } from 'antd';
import { useAuth } from '../../../contexts/AuthContext';
import { apiPost } from '../../../services/api';
import { getPublicAdminPasswordPolicy } from '../../../services/systemApi';
import { isTenantAccount } from '../../../utils/accountType';
import { type AdminPasswordPolicy } from '../../../utils/adminPasswordPolicy';

export type ChangePasswordGateMode = 'system' | 'tenant';

export function useChangePasswordGate(mode: ChangePasswordGateMode) {
  const { user, refreshUser } = useAuth();
  const { message } = App.useApp();
  const [changePasswordForm] = Form.useForm();
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [changePasswordSaving, setChangePasswordSaving] = useState(false);
  const [adminPwdPolicy, setAdminPwdPolicy] = useState<AdminPasswordPolicy | null>(null);

  const forcePasswordChange = useMemo(() => {
    if (user?.mustChangePassword !== true) return false;
    const tenant = isTenantAccount(user);
    return mode === 'tenant' ? tenant : !tenant;
  }, [mode, user]);

  useEffect(() => {
    getPublicAdminPasswordPolicy().then(setAdminPwdPolicy);
  }, []);

  useEffect(() => {
    if (forcePasswordChange) {
      changePasswordForm.resetFields();
      setChangePasswordOpen(true);
    }
  }, [forcePasswordChange, user?.id, changePasswordForm]);

  const openChangePassword = () => {
    changePasswordForm.resetFields();
    setChangePasswordOpen(true);
  };

  const submitChangePassword = async () => {
    try {
      const values = await changePasswordForm.validateFields();
      setChangePasswordSaving(true);
      await apiPost('/api/users/me/password', {
        oldPassword: String(values.oldPassword || ''),
        newPassword: String(values.newPassword || ''),
      });
      await refreshUser();
      message.success('密码修改成功');
      setChangePasswordOpen(false);
    } catch (e: any) {
      if (Array.isArray(e?.errorFields) && e.errorFields.length > 0) return;
      message.error(e?.message || '修改密码失败');
    } finally {
      setChangePasswordSaving(false);
    }
  };

  return {
    changePasswordForm,
    changePasswordOpen,
    setChangePasswordOpen,
    changePasswordSaving,
    adminPwdPolicy,
    forcePasswordChange,
    openChangePassword,
    submitChangePassword,
  };
}
