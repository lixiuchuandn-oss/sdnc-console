import React from 'react';
import { Alert } from 'antd';
import { useLoginLockCountdown } from './useLoginLockCountdown';

type LoginLockAlertProps = {
  lockedUntil: number | null;
  onExpired?: () => void;
};

/** 登录锁定：展示随剩余时间变化的提示 */
export const LoginLockAlert: React.FC<LoginLockAlertProps> = ({ lockedUntil, onExpired }) => {
  const text = useLoginLockCountdown(lockedUntil, onExpired);

  if (!text) return null;
  return <Alert type="error" showIcon message={text} style={{ marginBottom: 16 }} />;
};
