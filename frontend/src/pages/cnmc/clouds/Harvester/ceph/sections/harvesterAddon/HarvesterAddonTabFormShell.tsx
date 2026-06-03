/**
 * 存储配置 · 说明 Alert + 表单内容区（Operate Tab / 部署向导步骤共用）。
 */
import React from 'react';
import { Alert, Space } from 'antd';
import {
  OPERATE_TAB_BODY_STYLE,
  OPERATE_TAB_FORM_CLASS,
  OPERATE_TAB_FORM_FIELD_STYLE,
  OPERATE_TAB_INFO_ALERT_PROPS,
} from './addonUiConstants';

export type HarvesterAddonTabFormShellProps = {
  infoMessage: React.ReactNode;
  /** Alert 右侧操作（刷新、添加节点等） */
  alertActions?: React.ReactNode;
  /** 说明 Alert 下方的附加提示（warning / error 等） */
  extraAlerts?: React.ReactNode;
  children: React.ReactNode;
  /** 步骤切换时减少内容区高度跳动 */
  contentMinHeight?: number;
};

const HarvesterAddonTabFormShell: React.FC<HarvesterAddonTabFormShellProps> = ({
  infoMessage,
  alertActions,
  extraAlerts,
  children,
  contentMinHeight,
}) => (
  <>
    <Alert
      {...OPERATE_TAB_INFO_ALERT_PROPS}
      message={infoMessage}
      action={alertActions ? <Space wrap size={8}>{alertActions}</Space> : undefined}
    />
    {extraAlerts}
    <div
      className={OPERATE_TAB_FORM_CLASS}
      style={{
        ...OPERATE_TAB_BODY_STYLE,
        ...(contentMinHeight != null ? { minHeight: contentMinHeight } : null),
        ...OPERATE_TAB_FORM_FIELD_STYLE,
      }}
    >
      {children}
    </div>
  </>
);

export default HarvesterAddonTabFormShell;
