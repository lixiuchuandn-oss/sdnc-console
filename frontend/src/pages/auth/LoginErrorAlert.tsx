import React from 'react';
import { Alert } from 'antd';

type LoginErrorAlertProps = {
  message: string | null;
};

/** 登录失败（未锁定）：表单内固定提示，避免 toast 重复内容被吞 */
export const LoginErrorAlert: React.FC<LoginErrorAlertProps> = ({ message }) => {
  if (!message) return null;
  return <Alert type="error" showIcon message={message} style={{ marginBottom: 16 }} />;
};
