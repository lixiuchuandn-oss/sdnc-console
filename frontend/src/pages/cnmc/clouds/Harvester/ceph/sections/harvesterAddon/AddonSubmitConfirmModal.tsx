import React from 'react';
import { Alert, Checkbox, Form, Input, Modal, Typography } from 'antd';
import ConfigSummaryDescriptions from './ConfigSummaryDescriptions';
import type { HarvesterAddonFormValues } from '../../hooks/harvesterAddonFormTypes';

export type AddonSubmitConfirmModalProps = {
  open: boolean;
  title: string;
  okText: string;
  isRunningCluster: boolean;
  submitting: boolean;
  submitConfirmReady: boolean;
  submitRiskAck: boolean;
  onSubmitRiskAckChange: (checked: boolean) => void;
  submitAdminPassword: string;
  onSubmitAdminPasswordChange: (value: string) => void;
  submitRiskItems: string[];
  values: HarvesterAddonFormValues;
  blockDevicesRaw: unknown;
  onCancel: () => void;
  onOk: () => void;
};

const AddonSubmitConfirmModal: React.FC<AddonSubmitConfirmModalProps> = ({
  open,
  title,
  okText,
  isRunningCluster,
  submitting,
  submitConfirmReady,
  submitRiskAck,
  onSubmitRiskAckChange,
  submitAdminPassword,
  onSubmitAdminPasswordChange,
  submitRiskItems,
  values,
  blockDevicesRaw,
  onCancel,
  onOk,
}) => {
  const hasExpertYaml = !!String(values.valuesContentOverride || '').trim();

  return (
    <Modal
      title={title}
      open={open}
      width={560}
      maskClosable={false}
      destroyOnClose
      okText={okText}
      cancelText="取消"
      okButtonProps={{ disabled: !submitConfirmReady, loading: submitting }}
      onCancel={onCancel}
      onOk={onOk}
    >
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        {isRunningCluster
          ? '提交后将向集群应用扩容配置（仅新增数据盘），请确认已核对配置摘要并了解以下风险：'
          : '提交后将向集群应用统一存储配置，请确认已核对配置摘要并了解以下风险：'}
      </Typography.Paragraph>
      {hasExpertYaml ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="将使用专家模式 YAML 提交"
          description="向导中的选项将被忽略，请确认 YAML 内容正确。"
        />
      ) : (
        <div style={{ marginBottom: 16 }}>
          <ConfigSummaryDescriptions values={values} blockDevicesRaw={blockDevicesRaw} column={1} />
        </div>
      )}
      <ul style={{ margin: '0 0 16px', paddingLeft: 20 }}>
        {submitRiskItems.map((item) => (
          <li key={item} style={{ marginBottom: 8 }}>
            {item}
          </li>
        ))}
      </ul>
      <Checkbox
        checked={submitRiskAck}
        onChange={(e) => onSubmitRiskAckChange(e.target.checked)}
        style={{ marginBottom: 16 }}
      >
        我已阅读并理解上述风险
      </Checkbox>
      <Form layout="vertical" requiredMark={false}>
        <Form.Item label="管理员密码" required style={{ marginBottom: 0 }}>
          <Input.Password
            placeholder="请输入当前登录管理员密码"
            value={submitAdminPassword}
            onChange={(e) => onSubmitAdminPasswordChange(e.target.value)}
            onPressEnter={() => {
              if (submitConfirmReady && !submitting) onOk();
            }}
            autoComplete="current-password"
            disabled={submitting}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default AddonSubmitConfirmModal;
