import { useState } from 'react';
import { Form } from 'antd';
import { useSettings } from '../../contexts/SettingsContext';
import {
  getLockedUntilFromLoginError,
  getLoginErrorHint,
  getRemainSecFromLockedUntil,
} from '../../utils/loginLockMessage';
import { useLoginPageHeroStyle } from './loginPageHeroStyle';

/** /login 与 /admin/login 共用的表单状态、锁屏与背景样式 */
export function useLoginPageForm() {
  const [loading, setLoading] = useState(false);
  const [lockUntil, setLockUntil] = useState<number | null>(null);
  const [loginErrorHint, setLoginErrorHint] = useState<string | null>(null);
  const isLoginLocked = lockUntil != null && getRemainSecFromLockedUntil(lockUntil) > 0;
  const [form] = Form.useForm();
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

  const runLogin = async (submit: () => Promise<void>) => {
    setLoading(true);
    try {
      await submit();
      setLockUntil(null);
      setLoginErrorHint(null);
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

  return {
    form,
    loading,
    lockUntil,
    setLockUntil,
    loginErrorHint,
    isLoginLocked,
    heroStyle,
    buttonColor,
    buttonHoverColor,
    runLogin,
    loginTitle: settings.loginTitle ?? '',
    loginSubtitle: settings.loginSubtitle ?? '',
  };
}
