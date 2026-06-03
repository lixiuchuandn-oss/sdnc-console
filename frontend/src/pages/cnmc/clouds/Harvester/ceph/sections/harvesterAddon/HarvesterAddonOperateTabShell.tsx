/**
 * 已部署集群 · 存储配置 Operate Tab 统一布局（说明 Alert / 内容区 / 底栏提交）。
 * 用于「扩容存储」「变更存储网」「SDRS 策略」等 Tab，避免各页重复拼装。
 */
import React from 'react';
import { Button } from 'antd';
import WriteGuard from 'components/WriteGuard';
import HarvesterAddonTabFormShell from './HarvesterAddonTabFormShell';
import WizardFooter from './WizardFooter';

export type OperateTabSubmitConfig = {
  label: string;
  loading?: boolean;
  disabled?: boolean;
  /** 默认 true；false 时 WriteGuard 隐藏提交按钮 */
  canWrite?: boolean;
  onClick: () => void;
};

export type HarvesterAddonOperateTabShellProps = {
  infoMessage: React.ReactNode;
  /** Alert 右侧操作（刷新、添加节点等） */
  alertActions?: React.ReactNode;
  /** 说明 Alert 下方的附加提示（warning / error 等） */
  extraAlerts?: React.ReactNode;
  children: React.ReactNode;
  submit?: OperateTabSubmitConfig;
};

export type OperateTabRefreshButtonProps = {
  loading?: boolean;
  disabled?: boolean;
  label?: string;
  onClick: () => void;
};

/** Operate Tab 顶栏刷新按钮（无 icon，与扩容存储一致） */
export function OperateTabRefreshButton({
  loading,
  disabled,
  label = '刷新',
  onClick,
}: OperateTabRefreshButtonProps) {
  return (
    <Button loading={loading} disabled={disabled} onClick={onClick}>
      {label}
    </Button>
  );
}

const HarvesterAddonOperateTabShell: React.FC<HarvesterAddonOperateTabShellProps> = ({
  infoMessage,
  alertActions,
  extraAlerts,
  children,
  submit,
}) => (
  <>
    <HarvesterAddonTabFormShell
      infoMessage={infoMessage}
      alertActions={alertActions}
      extraAlerts={extraAlerts}
    >
      {children}
    </HarvesterAddonTabFormShell>
    {submit ? (
      <WizardFooter>
        <span />
        <WriteGuard canWrite={submit.canWrite !== false}>
          <Button
            type="primary"
            loading={submit.loading}
            disabled={submit.disabled}
            onClick={submit.onClick}
          >
            {submit.label}
          </Button>
        </WriteGuard>
      </WizardFooter>
    ) : null}
  </>
);

export default HarvesterAddonOperateTabShell;
